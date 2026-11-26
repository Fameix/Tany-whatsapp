import "server-only";
import { databaseMode, postgresRepositoryFor } from "@/lib/data/repository";
import type { TenantRow } from "@/lib/data/types";

export function postgresRuntimeMode() {
  const mode = databaseMode();
  return mode === "postgres" || mode === "dual-write";
}
export async function getRuntimeRecord<T extends TenantRow>(collection: string, businessId: string, id: string) {
  return await (await postgresRepositoryFor()).getRuntimeRecord(collection, businessId, id) as T | null;
}
export async function listRuntimeRecords<T extends TenantRow>(collection: string, businessId: string) {
  return await (await postgresRepositoryFor()).listRuntimeRecords(collection, businessId) as T[];
}
export async function getRuntimeRecordById<T extends TenantRow>(collection: string, id: string) {
  return await (await postgresRepositoryFor()).getRuntimeRecordById(collection, id) as T | null;
}
export async function putRuntimeRecord<T extends TenantRow>(collection: string, row: T) {
  await (await postgresRepositoryFor()).putRuntimeRecord(collection, row);
  return row;
}
export async function mutateRuntimeRecord<T extends TenantRow>(collection: string, businessId: string, id: string, mutate: (current: T | null) => T | Promise<T>) {
  return await (await postgresRepositoryFor()).mutateRuntimeRecord<T>(collection, businessId, id, mutate);
}
export async function mutateRuntimeRecordById<T extends TenantRow>(collection: string, id: string, mutate: (current: T) => T | Promise<T>) {
  return await (await postgresRepositoryFor()).mutateRuntimeRecordById<T>(collection, id, mutate);
}
