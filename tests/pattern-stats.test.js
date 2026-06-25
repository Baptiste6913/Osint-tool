const test = require('node:test');
const assert = require('node:assert');
const { patternProbability, detectTldKey, detectIndustry, reprioritizeByStats } = require('../src/pattern-stats');

test('detectTldKey', () => {
    assert.strictEqual(detectTldKey('acme.fr'), 'fr');
    assert.strictEqual(detectTldKey('acme.io'), 'io');
    assert.strictEqual(detectTldKey('acme.random'), 'com'); // fallback
});

test('detectIndustry: tech', () => {
    assert.strictEqual(detectIndustry('Acme Tech Labs'), 'tech');
});

test('detectIndustry: consulting', () => {
    assert.strictEqual(detectIndustry('McKinsey Partners'), 'consulting');
});

test('detectIndustry: law', () => {
    assert.strictEqual(detectIndustry('Dupont Avocats Associes'), 'law');
});

test('patternProbability: {first}.{last} > 0.4 pour .fr + tech', () => {
    const p = patternProbability('{first}.{last}', 'acme.fr', 'Acme Tech Labs');
    assert.ok(p > 0.4, `Got ${p}`);
});

test('reprioritizeByStats booste prenom.nom', () => {
    const preds = [
        { email: 'j.dupont@cabinet.fr', pattern: 'p.nom', priority: 78 },
        { email: 'jean.dupont@cabinet.fr', pattern: 'prenom.nom', priority: 100 },
    ];
    const r = reprioritizeByStats(preds, 'cabinet.fr', 'Dupont Avocats');
    // Le 1er résultat après reprio devrait être prenom.nom (boosté par stats)
    assert.strictEqual(r[0].email, 'jean.dupont@cabinet.fr');
});
