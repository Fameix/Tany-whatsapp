/** WhatsApp message template model shared by the editor, the starter library, Meta
 * submission and the live senders. Pure: safe for client and server. */

export type TemplateCategory = "utility" | "marketing" | "authentication";
export type TemplateStatus = "draft" | "pending" | "approved" | "rejected";
export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };

export type TemplateContent = {
  name: string;
  category: Exclude<TemplateCategory, "authentication">;
  language: string;
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  /** Example value per positional variable, in order: examples[0] is {{1}}. */
  examples: string[];
};

export const templateLanguages = [
  { code: "en", label: "English" },
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
] as const;

export const limits = { name: 120, header: 60, body: 1024, footer: 60, buttonText: 25, buttons: 10, urlButtons: 2, phoneButtons: 1, example: 200 };
const variablePattern = /\{\{(\d+)\}\}/g;

export const emptyTemplate = (): TemplateContent => ({ name: "", category: "utility", language: "en", header: "", body: "", footer: "", buttons: [], examples: [] });

/** Positional variables used in the body, ascending and de-duplicated. */
export function templateVariables(body: string) {
  return [...new Set(Array.from(body.matchAll(variablePattern), match => Number(match[1])))].sort((a, b) => a - b);
}

/** Next unused positional variable, for an "Add variable" control. */
export const nextVariable = (body: string) => (templateVariables(body).at(-1) ?? 0) + 1;

export function renderTemplateBody(body: string, examples: string[]) {
  return body.replace(variablePattern, (token, n: string) => examples[Number(n) - 1]?.trim() || token);
}

export type TemplateIssue = { field: "name" | "category" | "language" | "header" | "body" | "footer" | "buttons" | "examples"; message: string };

/** Meta's structural rules, checked before anything is submitted. */
export function validateTemplate(content: TemplateContent): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const add = (field: TemplateIssue["field"], message: string) => issues.push({ field, message });
  if (!/^[a-z0-9_]+$/.test(content.name)) add("name", "Use lowercase letters, numbers and underscores only.");
  else if (content.name.length > limits.name) add("name", `Keep the name under ${limits.name} characters.`);
  if (content.category !== "utility" && content.category !== "marketing") add("category", "Choose Utility or Marketing.");
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(content.language)) add("language", "Choose a language.");
  if (content.header.length > limits.header) add("header", `Keep the header under ${limits.header} characters.`);
  if (/\{\{/.test(content.header)) add("header", "Headers can't contain variables.");
  const body = content.body.trim();
  if (!body) add("body", "Write the message body.");
  if (content.body.length > limits.body) add("body", `Keep the body under ${limits.body} characters.`);
  const variables = templateVariables(content.body);
  if (variables.some((n, i) => n !== i + 1)) add("body", "Number variables in order without gaps: {{1}}, {{2}}, {{3}}…");
  if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}$/.test(body)) add("body", "Meta doesn't allow a variable at the very start or end of the message.");
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) add("body", "Put some text between variables.");
  if (/\{\{(?!\d+\}\})/.test(content.body)) add("body", "Variables must look like {{1}}.");
  if (variables.some((_, i) => !content.examples[i]?.trim())) add("examples", "Add an example value for every variable. Meta reviews templates with these examples.");
  if (content.examples.some(example => example.length > limits.example)) add("examples", `Keep examples under ${limits.example} characters.`);
  if (content.footer.length > limits.footer) add("footer", `Keep the footer under ${limits.footer} characters.`);
  if (/\{\{/.test(content.footer)) add("footer", "Footers can't contain variables.");
  if (content.buttons.length > limits.buttons) add("buttons", `Use at most ${limits.buttons} buttons.`);
  if (content.buttons.filter(button => button.type === "URL").length > limits.urlButtons) add("buttons", `Use at most ${limits.urlButtons} website buttons.`);
  if (content.buttons.filter(button => button.type === "PHONE_NUMBER").length > limits.phoneButtons) add("buttons", "Use at most one call button.");
  for (const button of content.buttons) {
    if (!button.text.trim() || button.text.length > limits.buttonText) add("buttons", `Button labels need 1–${limits.buttonText} characters.`);
    if (button.type === "URL" && !/^https:\/\/[^\s{}]+$/.test(button.url)) add("buttons", `Add a full https:// link for "${button.text || "website"}".`);
    if (button.type === "PHONE_NUMBER" && !/^\+[1-9]\d{7,14}$/.test(button.phoneNumber)) add("buttons", `Add a phone number like +919876543210 for "${button.text || "call"}".`);
  }
  return issues.filter((issue, i) => issues.findIndex(other => other.field === issue.field && other.message === issue.message) === i);
}

type MetaComponent = Record<string, unknown> & { type: string };

/** Components in Meta's create-template format, including review examples. */
export function metaComponents(content: TemplateContent): MetaComponent[] {
  const variables = templateVariables(content.body);
  const components: MetaComponent[] = [];
  if (content.header.trim()) components.push({ type: "HEADER", format: "TEXT", text: content.header.trim() });
  components.push({ type: "BODY", text: content.body.trim(), ...(variables.length ? { example: { body_text: [variables.map(n => content.examples[n - 1].trim())] } } : {}) });
  if (content.footer.trim()) components.push({ type: "FOOTER", text: content.footer.trim() });
  if (content.buttons.length)
    components.push({
      type: "BUTTONS",
      buttons: content.buttons.map(button =>
        button.type === "URL" ? { type: "URL", text: button.text.trim(), url: button.url.trim() }
          : button.type === "PHONE_NUMBER" ? { type: "PHONE_NUMBER", text: button.text.trim(), phone_number: button.phoneNumber.trim() }
            : { type: "QUICK_REPLY", text: button.text.trim() }),
    });
  return components;
}

/** Live senders pass body parameters only, so a template is sendable when nothing else
 * needs a parameter: text headers without variables and static buttons are fine. */
export function isSendableWithBodyParameters(components: unknown): boolean {
  if (!Array.isArray(components)) return true;
  return components.every((raw: { type?: unknown; format?: unknown; text?: unknown; buttons?: unknown }) => {
    const type = String(raw?.type ?? "").toUpperCase();
    if (type === "BODY" || type === "FOOTER") return true;
    if (type === "HEADER") return String(raw.format ?? "TEXT").toUpperCase() === "TEXT" && !String(raw.text ?? "").includes("{{");
    if (type === "BUTTONS")
      return Array.isArray(raw.buttons) && raw.buttons.every((button: { type?: unknown; url?: unknown }) => {
        const kind = String(button?.type ?? "").toUpperCase();
        return kind === "QUICK_REPLY" || kind === "PHONE_NUMBER" || (kind === "URL" && !String(button.url ?? "").includes("{{"));
      });
    return false;
  });
}

/** Restores editor content from a stored template row. */
export function templateContentFrom(row: Record<string, unknown>): TemplateContent {
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  // Rows written by the editor keep editor fields; others may only have Meta components.
  const components = Array.isArray(row.components) ? (row.components as Array<Record<string, unknown>>) : [];
  const component = (type: string) => components.find(c => String(c?.type ?? "").toUpperCase() === type);
  const metaButtons = Array.isArray(component("BUTTONS")?.buttons) ? (component("BUTTONS")!.buttons as Array<Record<string, unknown>>).map(button => ({
    type: String(button.type ?? "").toUpperCase(), text: str(button.text), url: str(button.url), phoneNumber: str(button.phone_number),
  })) as TemplateButton[] : [];
  const buttons = (Array.isArray(row.buttons) ? (row.buttons as TemplateButton[]) : metaButtons).filter(button => button && typeof button.text === "string");
  return {
    name: str(row.name),
    category: row.category === "marketing" ? "marketing" : "utility",
    language: str(row.language) || "en",
    header: str(row.header) || (String(component("HEADER")?.format ?? "TEXT").toUpperCase() === "TEXT" ? str(component("HEADER")?.text) : ""),
    body: str(row.body),
    footer: str(row.footer) || str(component("FOOTER")?.text),
    buttons: buttons.map(button => button.type === "URL" ? { type: "URL", text: button.text, url: str(button.url) } : button.type === "PHONE_NUMBER" ? { type: "PHONE_NUMBER", text: button.text, phoneNumber: str(button.phoneNumber) } : { type: "QUICK_REPLY", text: button.text }),
    examples: Array.isArray(row.examples) ? row.examples.map(value => str(value)) : [],
  };
}

/** Maps Meta's template status to Tany's lifecycle. Nothing becomes approved without Meta. */
export function statusFromMeta(status: unknown): TemplateStatus {
  const value = String(status ?? "").toUpperCase();
  if (value === "APPROVED") return "approved";
  if (value === "REJECTED" || value === "DISABLED" || value === "PAUSED") return "rejected";
  return "pending";
}
