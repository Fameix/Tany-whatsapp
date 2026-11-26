type StoredClaim = { businessId: string; messageId: string; token: string; status: "received" | "processed" | "failed"; leaseUntil: number; error: string | null };
type Storage = { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> };
type State = { storage: Storage };

export class MessageClaimCoordinator {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly state: State) {}
  async fetch(request: Request): Promise<Response> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await this.handle(request); }
    finally { release(); }
  }
  private async handle(request: Request): Promise<Response> {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const current = await this.state.storage.get<StoredClaim>("claim");
    if (action === "claim") {
      const businessId = typeof body.businessId === "string" ? body.businessId : "";
      const messageId = typeof body.messageId === "string" ? body.messageId : "";
      if (!businessId || !messageId) return Response.json({ error: "Invalid claim." }, { status: 400 });
      if (current?.businessId !== undefined && (current.businessId !== businessId || current.messageId !== messageId)) return Response.json({ error: "Claim scope mismatch." }, { status: 403 });
      const now = Date.now();
      if (current?.status === "processed" || (current?.status === "received" && current.leaseUntil > now)) return Response.json({ claimed: false });
      const claim: StoredClaim = { businessId, messageId, token: crypto.randomUUID(), status: "received", leaseUntil: now + 300_000, error: null };
      await this.state.storage.put("claim", claim);
      return Response.json({ claimed: true, token: claim.token, leaseUntil: claim.leaseUntil });
    }
    if (action === "finish") {
      if (!current || current.businessId !== body.businessId || current.token !== body.token) return Response.json({ error: "Claim lease was replaced." }, { status: 409 });
      const status = body.status === "processed" ? "processed" : "failed";
      await this.state.storage.put("claim", { ...current, status, leaseUntil: 0, error: typeof body.error === "string" ? body.error.slice(0, 500) : null });
      return Response.json({ finished: true });
    }
    return Response.json({ error: "Unknown claim action." }, { status: 400 });
  }
}
