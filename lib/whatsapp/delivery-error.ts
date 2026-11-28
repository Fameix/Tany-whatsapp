/** Meta's reason for a failed WhatsApp message, from a status webhook event. Pure. */
export type DeliveryError = { code: number | null; title: string; details: string };

const clip = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The first error Meta attached to a status event, or null. Only Meta's code, title and details are kept. */
export function deliveryErrorFrom(event: unknown): DeliveryError | null {
  const errors = (event as { errors?: unknown } | null)?.errors;
  const first = Array.isArray(errors) ? errors[0] as { code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } } | undefined : undefined;
  if (!first || typeof first !== "object") return null;
  const code = typeof first.code === "number" && Number.isFinite(first.code) ? first.code : null;
  const title = clip(first.title, 200) || clip(first.message, 200);
  const details = clip(first.error_data?.details, 500);
  return code === null && !title && !details ? null : { code, title, details };
}

/** "131042 · Business eligibility payment issue · <details>" for Message Status. */
export function formatDeliveryError(error: DeliveryError) {
  return [error.code === null ? "" : String(error.code), error.title, error.details && error.details !== error.title ? error.details : ""].filter(Boolean).join(" · ").slice(0, 800);
}
