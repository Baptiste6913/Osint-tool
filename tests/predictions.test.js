const test = require('node:test');
const assert = require('node:assert');

const { generateEmailPatterns, matchesPattern } = require('../src/predictions');
const { getNameVariants } = require('../src/diminutives');

// Mini parseName pour tests (évite dépendance sur helpers+node-fetch)
const PARTICLES = new Set(['de','du','des','la','le','les','van','der','den','von','da','do','dos','di','al','el','y',"l'","d'"]);
function normalize(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function parseName(fullname) {
    const og = fullname.trim().split(/\s+/);
    if (og.length === 0) return { first:'', last:'', firstInitial:'', firstOg:'', lastOg:'', firstParts:[], lastParts:[] };
    const firstOg = og[0];
    const lastOg = og.slice(1).join(' ');
    const firstParts = firstOg.toLowerCase().split(/[-']+/).map(normalize).filter(Boolean);
    const lastParts = lastOg.toLowerCase().split(/[\s\-]+/).map(normalize).filter(w => w && !PARTICLES.has(w));
    const first = firstParts.join('');
    const last = lastParts.join('');
    const firstInitial = (firstParts[0] || '')[0] || '';
    const firstInitials = firstParts.map(p => p[0]).join('');
    return { first, last, firstInitial, firstInitials, firstOg, lastOg, firstParts, lastParts };
}

test('generateEmailPatterns: simple name produit au moins 20 patterns', () => {
    const n = parseName('Jean Dupont');
    const p = generateEmailPatterns(n, 'acme.com');
    assert.ok(p.length >= 20, `Expected >=20 patterns, got ${p.length}`);
    assert.ok(p.some(x => x.email === 'jean.dupont@acme.com'));
    assert.ok(p.some(x => x.email === 'j.dupont@acme.com'));
    assert.ok(p.some(x => x.email === 'jdupont@acme.com'));
});

test('compound name: Jean-Pierre Dupont produit jp.dupont + jean-pierre.dupont', () => {
    const n = parseName('Jean-Pierre Dupont');
    const p = generateEmailPatterns(n, 'acme.com');
    assert.ok(p.some(x => x.email === 'jp.dupont@acme.com'));
    assert.ok(p.some(x => x.email === 'jean-pierre.dupont@acme.com'));
    assert.ok(p.some(x => x.email === 'jeanpierre.dupont@acme.com'));
    assert.ok(p.some(x => x.email === 'jean.dupont@acme.com'));
    assert.ok(p.some(x => x.email === 'pierre.dupont@acme.com'));
});

test('particules retirées: Marie de la Rochefoucauld → marie.rochefoucauld', () => {
    const n = parseName('Marie de la Rochefoucauld');
    assert.deepEqual(n.lastParts, ['rochefoucauld']);
    const p = generateEmailPatterns(n, 'acme.com');
    assert.ok(p.some(x => x.email === 'marie.rochefoucauld@acme.com'));
});

test('diminutifs: Alexandre → alex', () => {
    const n = parseName('Alexandre Martin');
    const p = generateEmailPatterns(n, 'acme.com');
    assert.ok(p.some(x => x.email === 'alexandre.martin@acme.com'));
    assert.ok(p.some(x => x.email === 'alex.martin@acme.com'));
});

test('role-based: title=CEO produit ceo@/direction@', () => {
    const n = parseName('Jean Dupont');
    const p = generateEmailPatterns(n, 'acme.com', { title: 'CEO & Founder' });
    assert.ok(p.some(x => x.email === 'ceo@acme.com'));
    assert.ok(p.some(x => x.email === 'direction@acme.com'));
});

test('matchesPattern: diminutif alex.martin match {first}.{last} pour Alexandre', () => {
    const n = parseName('Alexandre Martin');
    assert.strictEqual(matchesPattern('alex.martin', '{first}.{last}', n), true);
});

test('matchesPattern: jean-pierre.dupont match {first}.{last}', () => {
    const n = parseName('Jean-Pierre Dupont');
    assert.strictEqual(matchesPattern('jean-pierre.dupont', '{first}.{last}', n), true);
});

test('getNameVariants: alexandre → alex + xan', () => {
    const v = getNameVariants('alexandre');
    assert.ok(v.includes('alex'));
    assert.ok(v.includes('xan'));
});

test('getNameVariants: alex → alexandre/alexandra/alexander (reverse)', () => {
    const v = getNameVariants('alex');
    assert.ok(v.includes('alexandre'));
    assert.ok(v.includes('alexandra'));
    assert.ok(v.includes('alexander'));
});

test('patterns ordonnés par priorité décroissante', () => {
    const n = parseName('Jean Dupont');
    const p = generateEmailPatterns(n, 'acme.com');
    for (let i = 1; i < p.length; i++) {
        assert.ok(p[i - 1].priority >= p[i].priority);
    }
});

test('pas de patterns malformés (start/end séparateur)', () => {
    const n = parseName('Jean Dupont');
    const p = generateEmailPatterns(n, 'acme.com');
    for (const pred of p) {
        const local = pred.email.split('@')[0];
        assert.ok(!/^[_.\-]/.test(local), `malformed: ${pred.email}`);
        assert.ok(!/[_.\-]$/.test(local), `malformed: ${pred.email}`);
        assert.ok(local.length >= 1);
    }
});
