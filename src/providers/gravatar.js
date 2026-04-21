// ================================================================
// API: GRAVATAR
// ================================================================
const crypto = require('crypto');
const { fetchWithTimeout, log } = require('../helpers');
const { TIMEOUTS } = require('../config');

async function checkGravatar(email) {
    const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
    try {
        const r = await fetchWithTimeout(
            `https://www.gravatar.com/avatar/${hash}?d=404&s=1`,
            {}, TIMEOUTS.GRAVATAR
        );
        return r.status === 200;
    } catch (e) {
        log(`Gravatar error for ${email}: ${e.message}`);
        return false;
    }
}

module.exports = { checkGravatar };
