// ================================================================
// TEST: Scoring engine
// ================================================================
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeScores } = require('../src/scoring');
const { SCORING } = require('../src/config');

describe('computeScores', () => {
    it('should score email found by Hunter Finder', () => {
        const candidates = [{
            value: 'john.doe@example.com', type: 'email',
            sources: ['Hunter Finder'], proofs: [], warnings: [], score: 0,
            eliminated: false, eliminatedReason: '',
            proximity: true, isDomainMatch: true, isGeneric: false,
            hunterVerified: null, abstractVerified: null, gravatarExists: null,
            apolloTitle: null, apolloLinkedin: null,
            pappersConfirmed: false, isCompanyPhone: false, isOtherEmployee: false,
        }];
        const allDomains = new Map([['example.com', { mx: { valid: true }, catchAll: false, source: 'test' }]]);

        computeScores(candidates, allDomains, null, { first: 'john', last: 'doe', firstInitial: 'j' }, null);

        assert.ok(candidates[0].score >= SCORING.HUNTER_FINDER);
        assert.ok(candidates[0].proofs.length > 0);
    });

    it('should eliminate email with invalid MX', () => {
        const candidates = [{
            value: 'john@baddomain.com', type: 'email',
            sources: ['web'], proofs: [], warnings: [], score: 0,
            eliminated: false, eliminatedReason: '',
            proximity: false, isDomainMatch: false, isGeneric: false,
            hunterVerified: null, abstractVerified: null, gravatarExists: null,
            apolloTitle: null, apolloLinkedin: null,
            pappersConfirmed: false, isCompanyPhone: false, isOtherEmployee: false,
        }];
        const allDomains = new Map([['baddomain.com', { mx: { valid: false }, catchAll: null, source: 'test' }]]);

        computeScores(candidates, allDomains, null, { first: 'john', last: 'doe', firstInitial: 'j' }, null);

        assert.strictEqual(candidates[0].eliminated, true);
        assert.ok(candidates[0].eliminatedReason.includes('MX'));
    });

    it('should score higher with multiple independent sources', () => {
        const candidate1 = {
            value: 'single@example.com', type: 'email',
            sources: ['Hunter Finder'], proofs: [], warnings: [], score: 0,
            eliminated: false, eliminatedReason: '',
            proximity: true, isDomainMatch: true, isGeneric: false,
            hunterVerified: null, abstractVerified: null, gravatarExists: null,
            apolloTitle: null, apolloLinkedin: null,
            pappersConfirmed: false, isCompanyPhone: false, isOtherEmployee: false,
        };
        const candidate2 = {
            value: 'multi@example.com', type: 'email',
            sources: ['Hunter Finder', 'Apollo.io', 'Snov.io'], proofs: [], warnings: [], score: 0,
            eliminated: false, eliminatedReason: '',
            proximity: true, isDomainMatch: true, isGeneric: false,
            hunterVerified: null, abstractVerified: null, gravatarExists: null,
            apolloTitle: null, apolloLinkedin: null,
            pappersConfirmed: false, isCompanyPhone: false, isOtherEmployee: false,
        };

        const allDomains = new Map([['example.com', { mx: { valid: true }, catchAll: false, source: 'test' }]]);
        const name = { first: 'john', last: 'doe', firstInitial: 'j' };

        computeScores([candidate1], allDomains, null, name, null);
        computeScores([candidate2], allDomains, null, name, null);

        assert.ok(candidate2.score > candidate1.score, `Multi-source (${candidate2.score}) should score higher than single (${candidate1.score})`);
    });

    it('should cap generic email score', () => {
        const candidates = [{
            value: 'contact@example.com', type: 'email',
            sources: ['web'], proofs: [], warnings: [], score: 0,
            eliminated: false, eliminatedReason: '',
            proximity: true, isDomainMatch: true, isGeneric: false,
            hunterVerified: null, abstractVerified: null, gravatarExists: null,
            apolloTitle: null, apolloLinkedin: null,
            pappersConfirmed: false, isCompanyPhone: false, isOtherEmployee: false,
        }];
        const allDomains = new Map([['example.com', { mx: { valid: true }, catchAll: false, source: 'test' }]]);

        computeScores(candidates, allDomains, null, { first: 'john', last: 'doe', firstInitial: 'j' }, null);

        assert.ok(candidates[0].score <= 5, `Generic email score should be capped at 5, got ${candidates[0].score}`);
    });

    it('should score phones from Apollo', () => {
        const candidates = [{
            value: '01 23 45 67 89', type: 'phone',
            sources: ['Apollo.io'], proofs: [], warnings: [], score: 0,
            eliminated: false, eliminatedReason: '',
            proximity: true, isDomainMatch: false, isGeneric: false,
            hunterVerified: null, abstractVerified: null, gravatarExists: null,
            apolloTitle: null, apolloLinkedin: null,
            pappersConfirmed: false, isCompanyPhone: false, isOtherEmployee: false,
        }];
        const allDomains = new Map();

        computeScores(candidates, allDomains, null, { first: 'john', last: 'doe', firstInitial: 'j' }, null);

        assert.ok(candidates[0].score >= 30, `Apollo phone should score >= 30, got ${candidates[0].score}`);
    });
});
