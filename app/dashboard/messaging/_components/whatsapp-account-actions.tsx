"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestWhatsAppDisconnect } from "@/lib/whatsapp/disconnect-client";
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

export function WhatsAppAccountActions({
  status: initialStatus,
  hasConfiguredPhone: initialHasConfiguredPhone,
  businessId,
}: {
  status: string;
  hasConfiguredPhone: boolean;
  businessId: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [hasConfiguredPhone, setHasConfiguredPhone] = useState(initialHasConfiguredPhone);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [startingSetup, setStartingSetup] = useState(false);
  const [message, setMessage] = useState("");
  const [disconnectError, setDisconnectError] = useState("");
  const router = useRouter();
  const connected = status === "Connected";
  const setupLabel = status.includes("unverified") ? "Continue setup" : status === "Error" || status === "Disconnected" ? "Reconnect WhatsApp" : "Connect WhatsApp";

  const startSetup = async () => {
    setStartingSetup(true);
    setMessage("");
    try {
      const response = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/whatsapp/setup/handoff`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { message?: string; path?: unknown };
      if (!response.ok || typeof result.path !== "string")
        throw new Error(result.message ?? `Could not open WhatsApp setup (HTTP ${response.status}).`);
      window.location.assign(result.path);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open WhatsApp setup.");
      setStartingSetup(false);
    }
  };

  const disconnect = async () => {
    setPending(true);
    setMessage("");
    setDisconnectError("");
    const result = await requestWhatsAppDisconnect(businessId);
    setPending(false);
    if (!result.ok) {
      // Shown inside the dialog, which stays open, so the failure is visible.
      setDisconnectError(result.message);
      return;
    }
    setStatus("Not connected");
    setHasConfiguredPhone(false);
    setMessage("WhatsApp was disconnected. You can connect a number again when ready.");
    setConfirmOpen(false);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!connected && <Button className="min-h-11" disabled={startingSetup} onClick={() => void startSetup()}>{startingSetup && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{startingSetup ? "Opening setup…" : setupLabel}</Button>}
      {hasConfiguredPhone && <Button variant="outline" className="min-h-11" onClick={() => { setMessage(""); setDisconnectError(""); setConfirmOpen(true); }}>Disconnect WhatsApp</Button>}
      {message && <p className="basis-full text-sm text-destructive" role="alert">{message}</p>}
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!pending) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>This removes the active number mapping for this business and stops WhatsApp messaging here. The account history is retained, and you can connect a number again later.</AlertDialogDescription>
          </AlertDialogHeader>
          {disconnectError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{disconnectError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep connected</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void disconnect(); }}>
              {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              Disconnect WhatsApp
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
