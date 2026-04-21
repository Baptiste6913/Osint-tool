// ================================================================
// API: ABSTRACT (email validation)
// FIX Bug 1: message explicite sur erreur 401 (mauvaise cle)
// ================================================================
const { fetchWithTimeout, isQuotaError, log } = require('../helpers');
const { KEYS, TIMEOUTS } = require('../config');

async function abstractVerify(email, exhausted) {
    if (!KEYS.abstract || (exhausted && exhausted.has('abstract'))) return null;
    try {
        const r = await fetchWithTimeout(
            `https://emailvalidation.abstractapi.com/v1/?api_key=${encodeURIComponent(KEYS.abstract)}&email=${encodeURIComponent(email)}`,
            {}, TIMEOUTS.ABSTRACT
        );
        // FIX Bug 1: diagnostic explicite du 401
        if (r.status === 401) {
            log('Abstract API 401 — Verifiez que votre cle provient de "Email Validation" (pas "Email Reputation"). Dashboard: https://app.abstractapi.com/api/email-validation/tester');
            if (exhausted) exhausted.add('abstract');
            return null;
        }
        if (isQuotaError(r.status, await r.clone().text().catch(() => ''))) {
            if (exhausted) exhausted.add('abstract');
            return { _quotaExceeded: true };
        }
        const data = await r.json();
        return {
            deliverability: data.deliverability || 'UNKNOWN',
            smtpValid: data.is_smtp_valid?.value || false,
            mxFound: data.is_mx_found?.value || false,
            disposable: data.is_disposable_email?.value || false,
            role: data.is_role_email?.value || false,
            catchall: data.is_catchall_email?.value || false,
        };
    } catch (e) { log(`Abstract error: ${e.message}`); }
    return null;
}

module.exports = { abstractVerify };
