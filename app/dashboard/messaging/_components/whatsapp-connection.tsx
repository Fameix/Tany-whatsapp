"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, LoaderCircle, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { EmbeddedSignupConfigError, embeddedSignupConfigIdPattern, launchEmbeddedSignupLogin, maskMetaId } from "@/lib/whatsapp/embedded-signup-login";
import type { EmbeddedSignupLoginResponse, FacebookLoginSdk } from "@/lib/whatsapp/embedded-signup-login";

type EmbeddedSignupConfig = { appId: string; configId: string; graphVersion: string };
type SignupHints = { wabaId?: string; wabaIds?: string[]; phoneNumberId?: string };
type LoginResponse = EmbeddedSignupLoginResponse;
type FacebookSdk = FacebookLoginSdk & { init: (value: object) => void };
type MetaWindow = Window & { FB?: FacebookSdk; fbAsyncInit?: () => void };
type SdkStatus = "loading" | "ready" | "failed" | "unconfigured";
type Phase = "connect" | "meta" | "connecting" | "complete";

const sdkScriptId = "meta-embedded-signup-sdk";
const sdkTimeoutMs = 15000;
const sessionInfoWaitMs = 4000;
let sdkPromise: Promise<FacebookSdk> | null = null;

/** Loads and initializes the Meta JS SDK once. sdk.js now defines a buffering
 * `window.FB` stub immediately, so readiness is signalled only by fbAsyncInit. */
function loadMetaSdk(config: EmbeddedSignupConfig) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const metaWindow = window as MetaWindow;
    const timer = window.setTimeout(() => reject(new Error("Meta SDK did not load in time.")), sdkTimeoutMs);
    metaWindow.fbAsyncInit = () => {
      window.clearTimeout(timer);
      try {
        metaWindow.FB!.init({ appId: config.appId, cookie: true, xfbml: false, version: config.graphVersion });
        resolve(metaWindow.FB!);
      } catch (error) { reject(error); }
    };
    document.getElementById(sdkScriptId)?.remove();
    const script = document.createElement("script");
    script.id = sdkScriptId; script.async = true; script.defer = true; script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () => { window.clearTimeout(timer); reject(new Error("Meta SDK could not be downloaded.")); };
    document.head.appendChild(script);
  });
  sdkPromise.catch(() => { sdkPromise = null; });
  return sdkPromise;
}

const isMetaOrigin = (origin: string) => origin === "https://www.facebook.com" || /^https:\/\/[a-z0-9-]+\.facebook\.com$/.test(origin);
const numericId = (value: unknown) => typeof value === "string" && /^\d{1,40}$/.test(value) ? value : undefined;

/** Parses the WA_EMBEDDED_SIGNUP session message Meta posts from its popup. */
function parseSignupMessage(event: MessageEvent): { kind: "finish"; hints: SignupHints } | { kind: "cancel" | "error"; message?: string } | null {
  if (!isMetaOrigin(event.origin)) return null;
  let payload: unknown = event.data;
  if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { return null; } }
  if (!payload || typeof payload !== "object") return null;
  const message = payload as { type?: unknown; event?: unknown; data?: unknown };
  if (message.type !== "WA_EMBEDDED_SIGNUP") return null;
  const data = message.data && typeof message.data === "object" ? message.data as Record<string, unknown> : {};
  const eventName = typeof message.event === "string" ? message.event : "";
  if (eventName === "CANCEL") return { kind: "cancel" };
  if (eventName === "ERROR") return { kind: "error", message: typeof data.error_message === "string" ? data.error_message : undefined };
  if (!eventName.startsWith("FINISH")) return null;
  const wabaIds = Array.isArray(data.waba_ids) ? data.waba_ids.map(numericId).filter((id): id is string => !!id) : [];
  return { kind: "finish", hints: { wabaId: numericId(data.waba_id), wabaIds: wabaIds.length ? wabaIds : undefined, phoneNumberId: numericId(data.phone_number_id) } };
}

function OnboardingProgress({ complete }: { complete: boolean }) {
  const steps = [
    { label: "Connection", state: complete ? "done" : "current" },
    { label: "Complete", state: complete ? "done" : "upcoming" },
  ] as const;
  return (
    <ol className="flex items-center gap-3 text-sm" aria-label="WhatsApp setup progress">
      {steps.map((step, index) => (
        <li key={step.label} className="flex flex-1 items-center gap-3" aria-current={step.state === "current" ? "step" : undefined}>
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${step.state === "done" ? "bg-success text-white" : step.state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {step.state === "done" ? <Check className="size-4" aria-hidden="true" /> : index + 1}
          </span>
          <span className={step.state === "upcoming" ? "text-muted-foreground" : "font-medium"}>{step.label}</span>
          {index < steps.length - 1 && <span className={`h-px flex-1 ${complete ? "bg-success" : "bg-border"}`} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

export function WhatsAppConnection({
  initialConnection,
  embeddedSignup,
  dashboardHref,
  businessId,
  connectLabel = "Connect with Meta",
}: {
  initialConnection: ClientWhatsAppConnection;
  embeddedSignup: EmbeddedSignupConfig | null;
  dashboardHref: string;
  businessId: string;
  connectLabel?: string;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState(initialConnection);
  const [phase, setPhase] = useState<Phase>("connect");
  const [sdkStatus, setSdkStatus] = useState<SdkStatus>(embeddedSignup ? "loading" : "unconfigured");
  const configMissing = "WhatsApp signup is not configured for this environment (missing Meta App ID or Embedded Signup Config ID). Please contact Tany support.";
  const [error, setError] = useState(!embeddedSignup ? configMissing : initialConnection.status === "error" ? initialConnection.setupMessage : "");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const sdkRef = useRef<FacebookSdk | null>(null);

  useEffect(() => {
    if (!embeddedSignup) return;
    let active = true;
    loadMetaSdk(embeddedSignup).then(
      (sdk) => { if (active) { sdkRef.current = sdk; setSdkStatus("ready"); } },
      (reason) => { console.error("Meta Embedded Signup SDK failed to load", reason); if (active) setSdkStatus("failed"); },
    );
    return () => { active = false; };
  }, [embeddedSignup]);

  const completeSignup = useCallback(async (code: string, hints: SignupHints) => {
    setPhase("connecting");
    try {
      const response = await fetch(`/api/dashboard/whatsapp-embedded-signup?businessId=${encodeURIComponent(businessId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...hints }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; dashboardUrl?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not complete WhatsApp signup. Please try again.");
      setPhase("complete");
      window.setTimeout(() => router.replace(result.dashboardUrl ?? dashboardHref), 1500);
    } catch (reason) {
      setPhase("connect");
      setError(reason instanceof Error ? reason.message : "Could not complete WhatsApp signup. Please try again.");
    }
  }, [businessId, dashboardHref, router]);

  const launchEmbeddedSignup = () => {
    setError("");
    if (!embeddedSignup) { setError(configMissing); return; }
    if (!embeddedSignupConfigIdPattern.test(embeddedSignup.configId.trim())) {
      setError("WhatsApp signup has an invalid Meta Embedded Signup Config ID. Please contact Tany support.");
      return;
    }
    const sdk = sdkRef.current;
    if (sdkStatus !== "ready" || !sdk) {
      setError(sdkStatus === "failed" ? "Meta could not be loaded. Disable ad or tracker blockers for this page, check your connection, then reload." : "Meta is still loading. Please try again in a moment.");
      return;
    }

    let sessionResult: ReturnType<typeof parseSignupMessage> = null;
    let notifySession: (() => void) | null = null;
    const onMessage = (event: MessageEvent) => {
      const parsed = parseSignupMessage(event);
      if (!parsed) return;
      sessionResult = parsed;
      notifySession?.();
    };
    const waitForSession = () => new Promise<void>((resolve) => {
      if (sessionResult) { resolve(); return; }
      notifySession = resolve;
      window.setTimeout(resolve, sessionInfoWaitMs);
    });
    window.addEventListener("message", onMessage);

    const handleLoginResponse = async (response: LoginResponse) => {
      const code = response.authResponse?.code;
      if (code) await waitForSession();
      window.removeEventListener("message", onMessage);
      const session = sessionResult as ReturnType<typeof parseSignupMessage>;
      if (!code) {
        setPhase("connect");
        setError(session?.kind === "error"
          ? `Meta reported an error: ${session.message ?? "signup could not be completed"}. Please try again.`
          : "The Meta window was closed before setup finished. If no window appeared, allow pop-ups for this site and try again.");
        return;
      }
      // Session hints are optional; the backend verifies the account against Meta either way.
      void completeSignup(code, session?.kind === "finish" ? session.hints : {});
    };

    setPhase("meta");
    try {
      // FB.login must run synchronously inside the click so the popup is not blocked.
      const { diagnostics } = launchEmbeddedSignupLogin(sdk, embeddedSignup.configId, (response) => { void handleLoginResponse(response); }, { window, appId: embeddedSignup.appId });
      // Masked (last 4 chars only) so support can compare the real popup request with the configured IDs.
      console.info("[Tany] Meta Embedded Signup launch", { sdkAppId: maskMetaId(embeddedSignup.appId), sdkConfigId: maskMetaId(embeddedSignup.configId), graphVersion: embeddedSignup.graphVersion, ...diagnostics });
    } catch (reason) {
      console.error("Meta Embedded Signup failed to open", reason);
      window.removeEventListener("message", onMessage);
      setPhase("connect");
      setError(reason instanceof EmbeddedSignupConfigError ? reason.message : "Meta signup could not be opened. Reload the page and try again.");
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setError("");
    try {
      const response = await fetch(`/api/dashboard/whatsapp-connection?businessId=${encodeURIComponent(businessId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Could not disconnect WhatsApp.");
      setConnection(result.connection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not disconnect WhatsApp.");
    } finally {
      setDisconnecting(false);
      setDisconnectOpen(false);
    }
  };

  const alreadyConnected = connection.status === "connected" && phase === "connect";
  const complete = phase === "complete" || alreadyConnected;
  const busy = phase === "meta" || phase === "connecting";

  return (
    <Card className="w-full max-w-md">
      <CardContent className="space-y-6 p-6 sm:p-8">
        <OnboardingProgress complete={complete} />

        {phase === "connecting" ? (
          <div className="flex flex-col items-center py-6 text-center" role="status">
            <LoaderCircle className="size-10 animate-spin text-primary" aria-hidden="true" />
            <h1 className="mt-5 text-xl font-semibold">Connecting WhatsApp…</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Verifying your number with Meta and preparing your workspace. This takes a few seconds.</p>
          </div>
        ) : complete ? (
          <div className="flex flex-col items-center py-4 text-center" role="status">
            <span className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success"><Check className="size-6" aria-hidden="true" /></span>
            <h1 className="mt-5 text-xl font-semibold">Setup complete</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {phase === "complete" ? "WhatsApp is connected. Opening your WhatsApp dashboard…" : `${connection.displayName || "Your WhatsApp number"}${connection.displayPhone ? ` · ${connection.displayPhone}` : ""} is connected.`}
            </p>
            {alreadyConnected && (
              <div className="mt-6 flex w-full flex-col gap-2">
                <Button className="min-h-11" onClick={() => router.push(dashboardHref)}>Open WhatsApp Dashboard</Button>
                <Button variant="ghost" className="min-h-11 text-destructive hover:text-destructive" onClick={() => setDisconnectOpen(true)}>Disconnect</Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageCircle className="size-6" aria-hidden="true" /></span>
              <h1 className="mt-5 text-xl font-semibold">Connect WhatsApp</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Link your business WhatsApp number to start using your inbox, automations and campaigns.</p>
            </div>
            {error && <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />{error}</p>}
            <Button className="min-h-11 w-full" disabled={busy} onClick={launchEmbeddedSignup}>
              {busy ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Waiting for Meta…</> : sdkStatus === "loading" ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading Meta…</> : connectLabel}
            </Button>
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Meta securely handles business selection and WhatsApp number verification. Tany never sees your Meta password or access token.
            </p>
          </>
        )}
      </CardContent>
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle><AlertDialogDescription>This pauses WhatsApp automation for this business. You can reconnect later.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={disconnecting}>Keep connected</AlertDialogCancel><AlertDialogAction disabled={disconnecting} onClick={(event) => { event.preventDefault(); void disconnect(); }}>{disconnecting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}Disconnect</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </Card>
  );
}
