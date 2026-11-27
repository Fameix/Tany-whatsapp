/* eslint-disable @typescript-eslint/no-require-imports */
// WhatsApp Business Profile: tenant-scoped reads/writes with the business's own credential,
// Meta's field rules, the resumable picture upload and error mapping. Uses staging Postgres
// for tenant resolution; Meta and Secret Manager are mocked, so nothing reaches Meta.
const fs = require("node:fs");

async function main() {
  const assert = (await import("node:assert/strict")).default;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  Object.assign(process.env, { MESSAGING_DATABASE: "postgres", MESSAGING_POSTGRES_TARGET: "staging", WHATSAPP_TOKEN_SECRET_PROJECT: "tany-whatsapp", NEXT_PUBLIC_META_APP_ID: "1234567890123" });
  assert.ok(!/prod|production|live/i.test(new URL(process.env.DATABASE_URL).hostname), "staging database only");

  const model = await import("../lib/whatsapp/business-profile-model.ts");
  const credentials = await import("../lib/whatsapp/credentials.ts");
  const service = await import("../lib/whatsapp/business-profile.ts");
  const { runtimeRepositoryFor } = await import("../lib/data/repository.ts");
  const token = `EAAG${"z".repeat(48)}`;
  credentials.installWhatsAppSecretManagerAdapter(async () => ({ readSecret: async () => token, writeSecret: async () => { throw new Error("not used"); } }));

  const account = await (await runtimeRepositoryFor()).getWhatsAppAccount("test-retail");
  assert.equal(account?.status, "connected", "test-retail has a connected WhatsApp account in staging");
  const phoneNumberId = account.phoneNumberId;

  // A mocked Graph API holding one profile; the Neon driver still reaches staging over HTTPS.
  const originalFetch = globalThis.fetch;
  let stored = { about: "Old about", description: "", email: "", address: "", websites: [], vertical: "UNDEFINED", profile_picture_url: "" };
  const calls = [];
  let failNext = null;
  let phoneRecord = { verified_name: "Tany WB", display_phone_number: "+91 63814 17396", name_status: "APPROVED", quality_rating: "GREEN" };
  const graph = async (url, init = {}) => {
    const target = String(url);
    if (new URL(target).hostname.endsWith(".neon.tech")) return originalFetch(url, init);
    assert.ok(target.startsWith("https://graph.facebook.com/"), `only Graph is called: ${target}`);
    calls.push({ target, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    if (failNext) { const error = failNext; failNext = null; return Response.json({ error }, { status: error.code === 190 ? 401 : 400 }); }
    if (target.includes("/whatsapp_business_profile?fields=")) return Response.json({ data: [{ messaging_product: "whatsapp", ...stored }] });
    if (target.endsWith(`/${phoneNumberId}?fields=verified_name,display_phone_number,name_status,quality_rating`)) return Response.json(phoneRecord);
    if (target.endsWith("/whatsapp_business_profile") && init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.messaging_product, "whatsapp");
      const { messaging_product: _ignored, profile_picture_handle: handle, ...fields } = body; void _ignored;
      stored = { ...stored, ...fields, ...(handle ? { profile_picture_url: `https://pps.whatsapp.net/${handle}.jpg` } : {}) };
      return Response.json({ success: true });
    }
    if (/\/1234567890123\/uploads\?file_length=\d+&file_type=image%2Fjpeg$/.test(target) && init.method === "POST") return Response.json({ id: "upload:MTphdHRhY2htZW50" });
    if (target.endsWith("/upload:MTphdHRhY2htZW50") && init.method === "POST") return Response.json({ h: "4::aW1hZ2U" });
    throw new Error(`unexpected Graph call ${init.method ?? "GET"} ${target}`);
  };
  globalThis.fetch = graph;
  try {
    // Read.
    const read = await service.getBusinessProfile("test-retail");
    assert.equal(read.profile.about, "Old about");
    assert.deepEqual(read.displayName, { name: "Tany WB", phone: "+91 63814 17396", status: "approved", quality: "high" });
    assert.equal(read.diagnostics.phoneNumberId, phoneNumberId);
    assert.ok(Date.parse(read.diagnostics.refreshedAt) > 0, "the read time is recorded");
    assert.equal(JSON.stringify(read).includes(token), false, "the snapshot sent to the browser carries no token");
    assert.ok(calls.every(call => call.target.includes(`/${phoneNumberId}`)), "reads use this business's own phone number");
    assert.ok(calls.every(call => call.headers.Authorization === `Bearer ${token}`), "reads use this business's Secret Manager credential");
    console.log("PASS test-retail reads its profile and display-name status from its own phone number with its own credential");

    // Update every supported field; the saved result is re-read from Meta.
    const edits = { about: "Fresh groceries daily", description: "Your neighbourhood store for fruit, vegetables and essentials.", email: "hello@tanyretail.example", address: "12 Anna Nagar, Chennai 600040", websites: ["https://tanyretail.example", "https://instagram.com/tanyretail"], vertical: "GROCERY" };
    calls.length = 0;
    const updated = await service.updateBusinessProfile("test-retail", edits);
    const post = calls.find(call => call.method === "POST");
    assert.deepEqual(JSON.parse(post.body), { messaging_product: "whatsapp", ...edits }, "about, description, email, address, websites and category are sent to Meta");
    for (const [field, value] of Object.entries(edits)) assert.deepEqual(updated.profile[field], value, `${field} is confirmed by re-reading Meta`);
    assert.ok(calls.findIndex(call => call.method === "POST") < calls.findIndex(call => call.target.includes("?fields=about")), "the profile is re-read after Meta confirms the update");
    console.log("PASS update about, description, email, address, websites and category; refresh confirms Meta persisted them");

    // Validation happens before anything is sent.
    calls.length = 0;
    for (const [input, field] of [[{ about: "" }, "about"], [{ about: "x".repeat(140) }, "about"], [{ email: "not-an-email" }, "email"], [{ websites: ["ftp://x"] }, "websites"], [{ websites: ["https://a.example", "https://b.example", "https://c.example"] }, "websites"], [{ description: "x".repeat(513) }, "description"], [{ vertical: "SPACESHIPS" }, "vertical"]]) {
      assert.ok(model.validateProfile({ ...edits, ...input }).some(issue => issue.field === field), `invalid ${field} is caught`);
      await assert.rejects(service.updateBusinessProfile("test-retail", { ...edits, ...input }), error => error.code === "INVALID");
    }
    assert.equal(calls.length, 0, "invalid input never reaches Meta");
    console.log("PASS invalid about, email, websites, description and category are rejected before any Meta call");

    // Profile picture: square JPEG/PNG only, then Meta's resumable upload, then the profile handle.
    const png = (width, height, extra = 0) => { const bytes = new Uint8Array(33 + extra); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); return bytes; };
    const jpeg = (width, height) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
    assert.deepEqual(model.imageDimensions(png(640, 640)), { width: 640, height: 640 });
    assert.deepEqual(model.imageDimensions(jpeg(512, 512)), { width: 512, height: 512 });
    assert.match(model.validatePicture(png(640, 480), "image/png"), /square/);
    assert.match(model.validatePicture(png(100, 100), "image/png"), /at least 192/);
    assert.match(model.validatePicture(png(640, 640), "image/gif"), /JPG or PNG/);
    assert.match(model.validatePicture(png(640, 640, 5 * 1024 * 1024), "image/png"), /under 5 MB/);
    assert.match(model.validatePicture(new Uint8Array([1, 2, 3]), "image/png"), /couldn't be read/);
    calls.length = 0;
    await assert.rejects(service.updateProfilePicture("test-retail", png(640, 480), "image/png"), error => error.code === "INVALID");
    assert.equal(calls.length, 0, "a non-square picture never reaches Meta");
    const image = jpeg(640, 640);
    const withPicture = await service.updateProfilePicture("test-retail", image, "image/jpeg");
    const [session, upload, setHandle] = calls.filter(call => call.method === "POST");
    assert.match(session.target, /\/1234567890123\/uploads\?file_length=32&file_type=image%2Fjpeg$/, "opens a resumable upload session for the app");
    assert.equal(upload.headers.Authorization, `OAuth ${token}`, "uploads bytes with the business credential");
    assert.equal(upload.headers.file_offset, "0");
    assert.equal(upload.body.length, image.length, "sends the image bytes");
    assert.equal(JSON.parse(setHandle.body).profile_picture_handle, "4::aW1hZ2U", "sets the uploaded handle on the profile");
    assert.match(withPicture.profile.profilePictureUrl, /4::aW1hZ2U/, "refresh shows the new picture from Meta");
    console.log("PASS profile picture: square JPG/PNG validated, uploaded with Meta's resumable upload, set by handle, confirmed by refresh");

    // Meta errors map to clear messages; tokens never appear.
    for (const [error, code] of [[{ code: 190, message: `Invalid OAuth access token ${token}` }, "CREDENTIAL"], [{ code: 10, message: "Permission denied" }, "PERMISSION"], [{ code: 100, message: "Param about is invalid", error_user_msg: "About is too long" }, "INVALID"]]) {
      failNext = error;
      await assert.rejects(service.getBusinessProfile("test-retail"), thrown => thrown.code === code && !thrown.message.includes(token));
    }
    failNext = { code: 100, message: "x", error_user_msg: `Bad value ${token}` };
    await assert.rejects(service.updateBusinessProfile("test-retail", edits), thrown => thrown.code === "INVALID" && !thrown.message.includes(token));
    console.log("PASS expired credential, permission and invalid-field errors map to clear messages without the token");

    // A business without a connected number gets the empty state and no Meta call.
    calls.length = 0;
    let checked = 0;
    for (const businessId of ["test-eats", "test-motos"]) {
      const other = await (await runtimeRepositoryFor()).getWhatsAppAccount(businessId);
      if (other?.status === "connected") continue;
      await assert.rejects(service.getBusinessProfile(businessId), error => error.code === "NOT_CONNECTED");
      await assert.rejects(service.updateBusinessProfile(businessId, edits), error => error.code === "NOT_CONNECTED");
      checked++;
    }
    assert.ok(checked > 0, "at least one disconnected tenant was checked");
    assert.equal(calls.length, 0, "a disconnected tenant never touches Meta or another tenant's number");
    console.log("PASS a tenant without a connected number gets NOT_CONNECTED and never reaches Meta");

    // Server actions always authorise the dashboard session for the named business first.
    const actions = fs.readFileSync("app/business/_components/whatsapp-profile/actions.ts", "utf8");
    assert.equal((actions.match(/await requireDashboardAccess\(businessId\);/g) ?? []).length, (actions.match(/^export async function /gm) ?? []).length, "every action checks dashboard access");
    assert.ok(!/accessToken|tokenSecretName|Authorization/.test(fs.readFileSync("app/business/_components/whatsapp-profile/profile-editor.tsx", "utf8")), "the browser editor never handles credentials");
    const serviceSource = fs.readFileSync("lib/whatsapp/business-profile.ts", "utf8");
    assert.ok(serviceSource.includes('owner?.businessId !== businessId'), "phone ownership is confirmed against the business");
    assert.ok(!serviceSource.includes("META_ACCESS_TOKEN"), "no global Meta token");
    console.log("PASS actions authorise the business session; ownership checked; no global token; editor holds no credentials");

    // Display-name status and quality come from Meta's phone-number record.
    for (const [nameStatus, expected] of [["APPROVED", "approved"], ["AVAILABLE_WITHOUT_REVIEW", "approved"], ["PENDING_REVIEW", "pending"], ["DECLINED", "rejected"], ["EXPIRED", "rejected"], ["NONE", "unknown"], [undefined, "unknown"]])
      assert.equal(model.displayNameStatus(nameStatus), expected, `${nameStatus} → ${expected}`);
    for (const [rating, expected] of [["GREEN", "high"], ["YELLOW", "medium"], ["RED", "low"], [undefined, "unknown"]]) assert.equal(model.qualityRating(rating), expected);

    // Refresh re-reads Meta every time; nothing is served from a previous read.
    phoneRecord = { verified_name: "Tany WB", display_phone_number: "+91 63814 17396", name_status: "PENDING_REVIEW" };
    const first = await service.getBusinessProfile("test-retail");
    assert.equal(first.displayName.status, "pending", "pending renders from Meta");
    assert.equal(first.displayName.quality, "unknown", "quality is Unknown when Meta doesn't report it");
    phoneRecord = { ...phoneRecord, name_status: "DECLINED" };
    stored = { about: "Only about", description: "", email: "", address: "", websites: [], vertical: "UNDEFINED", profile_picture_url: "" };
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await service.getBusinessProfile("test-retail");
    assert.equal(second.displayName.status, "rejected", "a fresh read reflects Meta's new status");
    assert.ok(Date.parse(second.diagnostics.refreshedAt) > Date.parse(first.diagnostics.refreshedAt), "each refresh is a new Meta read");
    assert.equal(second.displayName.name, "Tany WB", "the display name section works with optional profile fields missing");
    assert.deepEqual(model.profileChecklist(second.profile).map(item => [item.label, item.complete]), [["Profile picture", false], ["About", true], ["Description", false], ["Category", false], ["Email", false], ["Website", false], ["Address", false]]);
    const actionsSource = fs.readFileSync("app/business/_components/whatsapp-profile/actions.ts", "utf8");
    assert.match(actionsSource, /export async function refreshBusinessProfile[\s\S]*?await requireDashboardAccess\(businessId\);[\s\S]*?getBusinessProfile\(businessId\)/, "refresh authorises the business session and reads Meta");
    console.log("PASS display-name status (approved, pending, rejected, unknown) and quality map from Meta; refresh re-reads Meta; checklist works with fields missing");

    const editor = fs.readFileSync("app/business/_components/whatsapp-profile/profile-editor.tsx", "utf8");
    for (const copy of ["Approved by Meta", "Under Meta review", "Rejected by Meta", "Refresh from Meta", "Open in WhatsApp Manager", "Advanced details", "Customer visibility",
      "Meta approval does not always mean the display name appears immediately to every WhatsApp user. Some customers may temporarily see your phone number instead.",
      "Your display name is approved. WhatsApp may still show your phone number to some users while Meta propagates or applies the business identity across clients."])
      assert.ok(editor.includes(copy), `editor shows "${copy.slice(0, 40)}…"`);
    assert.equal(/Change display name|value=\{[^}]*displayName\.name/.test(editor), false, "no editable display-name field");
    assert.equal(/setDisplayName|displayNameDraft/.test(editor), false, "display name is never edited or stored locally");
    console.log("PASS profile page shows review status, customer-visibility guidance, advanced details and actions; no editable display name");
  } finally {
    globalThis.fetch = originalFetch;
    credentials.installWhatsAppSecretManagerAdapter(undefined);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
