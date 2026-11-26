/** Client-safe Embedded Signup launch helpers. Kept free of server-only imports
 * so the exact FB.login call can be exercised by focused tests. */
export type EmbeddedSignupLoginResponse = { status?: string; authResponse?: { code?: string } | null };
export type EmbeddedSignupLoginOptions = {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: { setup: Record<string, never> };
};
export type FacebookLoginSdk = {
  login: (callback: (response: EmbeddedSignupLoginResponse) => void, options: EmbeddedSignupLoginOptions) => void;
};
export type EmbeddedSignupPopupDiagnostics = {
  popupOpened: boolean;
  dialog: string;
  appId: string;
  configId: string;
  appIdMatch: boolean;
  configIdMatch: boolean;
  extras: string;
};
type PopupWindow = { open: (...args: Parameters<Window["open"]>) => ReturnType<Window["open"]> };

/** Meta configuration IDs are numeric. Anything else would reach Meta as an invalid config_id. */
export const embeddedSignupConfigIdPattern = /^\d{6,40}$/;

export class EmbeddedSignupConfigError extends Error {}

/** Shows only the last four characters, so diagnostics never print a full Meta ID. */
export const maskMetaId = (value: string | null | undefined) => value ? `…${value.slice(-4)}` : "missing";

export function embeddedSignupLoginOptions(configId: string): EmbeddedSignupLoginOptions {
  const id = typeof configId === "string" ? configId.trim() : "";
  if (!embeddedSignupConfigIdPattern.test(id))
    throw new EmbeddedSignupConfigError("WhatsApp signup is missing a valid Meta Embedded Signup configuration ID (NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID).");
  // Embedded Signup v4 launch (Meta implementation guide). v2/v3 extras such as
  // sessionInfoVersion and version: "v3" were deprecated on 2026-10-15 and must not be sent.
  return { config_id: id, response_type: "code", override_default_response_type: true, extras: { setup: {} } };
}

/** Reads app_id/config_id from the URL the SDK opened (following a login `next` hop) and masks them. */
export function embeddedSignupPopupDiagnostics(popupUrl: string | null, expected: { appId: string; configId: string }): EmbeddedSignupPopupDiagnostics {
  let dialog: URL | null = null;
  try {
    dialog = popupUrl ? new URL(popupUrl) : null;
    const next = dialog?.searchParams.get("next");
    if (dialog && !dialog.searchParams.get("config_id") && next) dialog = new URL(next);
  } catch { dialog = null; }
  const appId = dialog?.searchParams.get("app_id") ?? dialog?.searchParams.get("client_id") ?? "";
  const configId = dialog?.searchParams.get("config_id") ?? "";
  return {
    popupOpened: !!popupUrl,
    dialog: dialog ? `${dialog.host}${dialog.pathname}` : "not captured",
    appId: maskMetaId(appId),
    configId: maskMetaId(configId),
    appIdMatch: !!appId && appId === expected.appId.trim(),
    configIdMatch: !!configId && configId === expected.configId.trim(),
    extras: dialog?.searchParams.get("extras") ?? "",
  };
}

/** Calls FB.login synchronously with a plain callback (Meta's SDK rejects AsyncFunction
 * callbacks) and the Embedded Signup config_id. When `popup` is given, the URL the SDK
 * passes to window.open is captured for masked diagnostics. Returns what was sent. */
export function launchEmbeddedSignupLogin(
  sdk: FacebookLoginSdk,
  configId: string,
  onResponse: (response: EmbeddedSignupLoginResponse) => void,
  popup?: { window: PopupWindow; appId: string },
) {
  const options = embeddedSignupLoginOptions(configId);
  let popupUrl: string | null = null;
  const target = popup?.window;
  const originalOpen = target?.open;
  if (target && originalOpen) target.open = function captureEmbeddedSignupPopup(this: unknown, ...args) {
    if (popupUrl === null) popupUrl = args[0] == null ? "" : String(args[0]);
    return originalOpen.apply(this, args);
  };
  try {
    sdk.login(function onEmbeddedSignupLogin(response) { onResponse(response); }, options);
  } finally {
    if (target && originalOpen) target.open = originalOpen;
  }
  const diagnostics = popup ? embeddedSignupPopupDiagnostics(popupUrl, { appId: popup.appId, configId: options.config_id }) : null;
  return { options, diagnostics };
}
