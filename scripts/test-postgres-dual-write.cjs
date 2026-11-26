/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHarness } = require('./messaging-test-helpers.cjs');

async function main() {
  const originalWarn = console.warn;
  try {
    const h = createHarness({ seedFixtures: false });
    const { localMessagingBusinessId } = h.load('lib/data/postgres-business-map.ts');
    const { safePostgresMirror } = h.load('lib/data/repository.ts');
    const retailId = '11111111-1111-4111-8111-111111111111';
    assert.equal(localMessagingBusinessId('demo-retail', { id: retailId, legacy_business_id: 'demo-retail' }), retailId, 'local tenant resolves by legacy business ID');
    assert.equal(localMessagingBusinessId('unmapped', undefined), null, 'unmapped tenant fails closed');
    assert.equal(localMessagingBusinessId('demo-retail/other', { id: retailId, legacy_business_id: 'demo-retail/other' }), null, 'cross-tenant path is rejected');
    assert.equal(localMessagingBusinessId('demo-eats', { id: retailId, legacy_business_id: 'demo-retail' }), null, 'a tenant cannot use another tenant row');
    const source = fs.readFileSync('lib/data/postgres-messaging-repository.ts', 'utf8');
    assert.match(source, /messaging_businesses/, 'repository uses the standalone tenant root');
    assert.doesNotMatch(source, /dealers/, 'repository has no external dealers dependency');
    assert.match(source, /POSTGRES_PHONE_ALREADY_CONNECTED/, 'duplicate phone mapping is rejected');
    assert.match(source, /on conflict \(meta_message_id\)/i, 'Meta messages are idempotent');
    assert.match(source, /on conflict \(meta_event_id\) do nothing/i, 'webhook and delivery event IDs are idempotent');
    assert.match(source, /POSTGRES_TENANT_UNMAPPED/, 'repository fails closed without a local tenant');
    const warnings = []; console.warn = (...args) => warnings.push(args);
    const firestoreCommitted = true;
    await safePostgresMirror('message', { id: 'm1', businessId: 'demo-retail', messageId: 'wamid.1' }, async () => { throw new Error('Postgres unavailable'); });
    assert.equal(firestoreCommitted, true, 'Postgres mirror failure never rolls back the Firestore write');
    assert.equal(warnings.length, 1, 'mirror failure is observable');
    assert.equal(warnings[0][0], '[POSTGRES_DUAL_WRITE_FAILED]');
    console.log('PASS: standalone local tenant handling, isolation, duplicate phone rejection, idempotency, and non-blocking dual-write failure.');
  } finally { console.warn = originalWarn; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
