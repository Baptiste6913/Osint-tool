// ================================================================
// TEST: Hunter provider
// ================================================================
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('hunterFinder', () => {
    it('should return null when no API key configured', async () => {
        // Save and clear the key
        const { KEYS } = require('../../src/config');
        const saved = KEYS.hunter;
        KEYS.hunter = '';

        const { hunterFinder } = require('../../src/providers/hunter');
        const result = await hunterFinder('example.com', { firstOg: 'John', lastOg: 'Doe' }, new Set());
        assert.strictEqual(result, null);

        KEYS.hunter = saved;
    });

    it('should return null when hunter is in exhausted set', async () => {
        const { hunterFinder } = require('../../src/providers/hunter');
        const exhausted = new Set(['hunter']);
        const result = await hunterFinder('example.com', { firstOg: 'John', lastOg: 'Doe' }, exhausted);
        assert.strictEqual(result, null);
    });
});

describe('hunterDomain', () => {
    it('should return empty result when no API key', async () => {
        const { KEYS } = require('../../src/config');
        const saved = KEYS.hunter;
        KEYS.hunter = '';

        const { hunterDomain } = require('../../src/providers/hunter');
        const result = await hunterDomain('example.com', new Set());
        assert.deepStrictEqual(result, { emails: [], pattern: null });

        KEYS.hunter = saved;
    });
});
