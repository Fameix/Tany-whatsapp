import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { listBusinessProfiles } from "@/lib/admin/services";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";

/** Product URLs resolve to a real tenant workspace, never a placeholder page. */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  await connection();
  const { product } = await params;
  if (!isActiveTanyVertical(product)) notFound();

  const business = (await listBusinessProfiles()).find(
    (candidate) => candidate.active && candidate.vertical === product,
  );
  if (!business) notFound();

  redirect(`/business/${encodeURIComponent(business.id)}`);
}
