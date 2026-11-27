/** What a business's WhatsApp page shows for a directory account status. Pure, so every
 * state (active, inactive, connected, disconnected, setup) can be tested. */
export type ConnectionStatusView = {
  title: string;
  tone: "success" | "warning" | "neutral";
  description: string;
  /** Connect / Reconnect / Disconnect only make sense for an active business. */
  showActions: boolean;
};

export function connectionStatusView(status: string): ConnectionStatusView {
  if (status === "Inactive")
    return { title: "Business inactive", tone: "neutral", description: "Activate this business to resume messaging and manage WhatsApp.", showActions: false };
  if (status === "Connected")
    return { title: "Connected", tone: "success", description: "Customers can message this number and Tany will reply.", showActions: true };
  if (status === "Not connected")
    return { title: "Not connected", tone: "neutral", description: "Connect your WhatsApp Business number to start messaging customers.", showActions: true };
  if (status.includes("unverified"))
    return { title: "Setup in progress", tone: "warning", description: "Finish setup to start receiving customer messages.", showActions: true };
  return { title: status, tone: "warning", description: "Reconnect WhatsApp to resume messaging.", showActions: true };
}
