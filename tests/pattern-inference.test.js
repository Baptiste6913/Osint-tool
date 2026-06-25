const test = require('node:test');
const assert = require('node:assert');
const { inferPattern, detectPattern } = require('../src/pattern-inference');

test('detectPattern: jean.dupont → {first}.{last}', () => {
    assert.strictEqual(detectPattern('jean.dupont', 'Jean', 'Dupont'), '{first}.{last}');
});

test('detectPattern: jdupont → {f}{last}', () => {
    assert.strictEqual(detectPattern('jdupont', 'Jean', 'Dupont'), '{f}{last}');
});

test('detectPattern: unknown local → null', () => {
    assert.strictEqual(detectPattern('random123', 'Jean', 'Dupont'), null);
});

test('detectPattern: accents normalisés', () => {
    assert.strictEqual(detectPattern('francois.dubois', 'François', 'Dubois'), '{first}.{last}');
});

test('inferPattern: vote majoritaire sur 5 emails', () => {
    const emails = [
        { email: 'jean.dupont@acme.com', first_name: 'Jean', last_name: 'Dupont' },
        { email: 'marie.durand@acme.com', first_name: 'Marie', last_name: 'Durand' },
        { email: 'alice.martin@acme.com', first_name: 'Alice', last_name: 'Martin' },
        { email: 'p.moreau@acme.com', first_name: 'Paul', last_name: 'Moreau' },
        { email: 'sophie.bernard@acme.com', first_name: 'Sophie', last_name: 'Bernard' },
    ];
    const r = inferPattern(emails);
    assert.strictEqual(r.pattern, '{first}.{last}');
    assert.strictEqual(r.voters, 4);
    assert.strictEqual(r.total, 5);
});

test('inferPattern: emails avec `name` au lieu de first_name/last_name', () => {
    const emails = [
        { email: 'jean.dupont@acme.com', name: 'Jean Dupont' },
        { email: 'marie.durand@acme.com', name: 'Marie Durand' },
    ];
    const r = inferPattern(emails);
    assert.strictEqual(r.pattern, '{first}.{last}');
});

test('inferPattern: empty array → null', () => {
    assert.strictEqual(inferPattern([]), null);
});
