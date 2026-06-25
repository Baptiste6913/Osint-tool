const test = require('node:test');
const assert = require('node:assert');
const { fingerprintMX } = require('../src/mx-fingerprint');

test('Google Workspace detection', () => {
    const r = fingerprintMX(['aspmx.l.google.com', 'alt1.aspmx.l.google.com']);
    assert.strictEqual(r.provider, 'Google Workspace');
    assert.ok(r.catchAllLikely < 0.2);
});

test('Microsoft 365 detection', () => {
    const r = fingerprintMX(['company.mail.protection.outlook.com']);
    assert.strictEqual(r.provider, 'Microsoft 365');
});

test('OVH detection', () => {
    const r = fingerprintMX(['mx1.ovh.net', 'mx2.ovh.net']);
    assert.strictEqual(r.provider, 'OVH');
});

test('Unknown MX', () => {
    const r = fingerprintMX(['unknown-mx-server.xyz']);
    assert.strictEqual(r.provider, 'unknown');
});

test('Empty MX', () => {
    const r = fingerprintMX([]);
    assert.strictEqual(r.provider, 'unknown');
});
