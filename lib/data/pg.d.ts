declare module "pg" {
  export class Pool {
    constructor(config?: { connectionString?: string; max?: number });
    connect(): Promise<{
      query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
      release(): void;
    }>;
  }
}
