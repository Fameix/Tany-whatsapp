/** Client-safe WhatsApp disconnect request. The business is always named explicitly so the
 * API can authorize it against the caller's session (business or Super Admin). */
export type DisconnectResult = { ok: true } | { ok: false; message: string };

export async function requestWhatsAppDisconnect(businessId: string, fetcher: typeof fetch = fetch): Promise<DisconnectResult> {
  try {
    const response = await fetcher(`/api/dashboard/whatsapp-connection?businessId=${encodeURIComponent(businessId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    });
    const result = await response.json().catch(() => ({})) as { message?: unknown };
    if (!response.ok) return { ok: false, message: typeof result.message === "string" && result.message ? result.message : "Could not disconnect WhatsApp. Please try again." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not reach Tany to disconnect WhatsApp. Check your connection and try again." };
  }
}
