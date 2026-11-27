/* eslint-disable @typescript-eslint/no-require-imports */
// Test & Staging: a business is activated first and connects WhatsApp later, so activation
// never requires a WhatsApp phone number ID. Create/edit and every other check are unchanged.
const fs = require("node:fs");

async function main() {
  const assert = (await import("node:assert/strict")).default;
  const { businessInput, AdminValidationError } = await import("../lib/admin/validation.ts");
  const base = { name: "Test Motos", vertical: "motos", active: true, settings: {} };
  const rejects = (input, options, field) => assert.throws(() => businessInput(input, false, options), error => error instanceof AdminValidationError && field in error.errors, field);

  for (const phone of ["", "   "]) assert.equal(businessInput({ ...base, whatsappPhoneNumberId: phone }, false, { whatsappOptional: true }).whatsappPhoneNumberId, "", "activation accepts no WhatsApp number");
  assert.equal(businessInput({ ...base, whatsappPhoneNumberId: "1234567890" }, false, { whatsappOptional: true }).whatsappPhoneNumberId, "1234567890", "a connected number is kept");
  rejects({ ...base, whatsappPhoneNumberId: "bad id/1" }, { whatsappOptional: true }, "whatsappPhoneNumberId");
  rejects({ ...base, whatsappPhoneNumberId: "" }, undefined, "whatsappPhoneNumberId");
  assert.throws(() => businessInput({ ...base, businessId: "x", whatsappPhoneNumberId: "" }, true), AdminValidationError, "creating still requires a number");
  rejects({ ...base, name: "", whatsappPhoneNumberId: "" }, { whatsappOptional: true }, "name");
  rejects({ ...base, vertical: "cabs", whatsappPhoneNumberId: "" }, { whatsappOptional: true }, "vertical");
  rejects({ ...base, whatsappPhoneNumberId: "", settings: { staff: [] } }, { whatsappOptional: true }, "settings");
  console.log("PASS activation needs no WhatsApp number; an invalid number, name, product or settings is still rejected; create/edit still require one");

  const services = fs.readFileSync("lib/admin/services.ts", "utf8");
  const toggle = services.slice(services.indexOf("export async function toggleBusiness"), services.indexOf("export async function getBusinessStats"));
  assert.equal((toggle.match(/\{ whatsappOptional: true \}/g) ?? []).length, 2, "Postgres and Firestore activation both allow no WhatsApp");
  assert.match(toggle, /if \(value && business\.whatsappPhoneNumberId\) \{\s*await assertWhatsAppPhoneMapping/, "a connected number must still belong to this business");
  const actions = fs.readFileSync("app/admin/actions.ts", "utf8");
  const action = actions.slice(actions.indexOf("export async function toggleBusinessAction"));
  assert.ok(action.indexOf("await requireSuperAdmin()") < action.indexOf("await toggleBusiness("), "only a Super Admin can activate");
  const view = (await import("../lib/whatsapp/connection-status-view.ts")).connectionStatusView("Not connected");
  assert.equal(view.title, "Not connected"); assert.equal(view.showActions, true);
  assert.match(fs.readFileSync("app/dashboard/messaging/_components/whatsapp-account-actions.tsx", "utf8"), /: "Connect WhatsApp";/, "an active business without WhatsApp is offered Connect WhatsApp");
  console.log("PASS Super Admin only; an activated business without WhatsApp shows Not connected with Connect WhatsApp");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
