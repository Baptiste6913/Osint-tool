// ================================================================
// SMTP DIRECT — Vérification par RCPT TO probing direct (gratuit)
// Stratégie : résout le MX, se connecte en TCP 25/587, HELO + MAIL FROM + RCPT TO,
// et interprète le code retour (250 = deliverable, 550 = undeliverable).
//
// Limites :
//  - Beaucoup de serveurs (Microsoft 365, Google) bloquent le probing anonyme
//  - L'IP du serveur Node doit avoir une réputation correcte
//  - Greylisting possible (1er essai = retry needed)
//
// Usage : fallback quand Hunter/Abstract quota épuisé.
// ================================================================
const net = require('net');
const { promises: dns } = require('dns');
const { log } = require('../helpers');
const { TIMEOUTS } = require('../config');

async function resolveMX(domain) {
    try {
        const records = await dns.resolveMx(domain);
        records.sort((a, b) => a.priority - b.priority);
        return records.map(r => r.exchange);
    } catch (e) { return []; }
}

// RFC 5321 : 220 = greeting, 250 = OK, 5xx = permanent reject, 4xx = transient
function isPositive(code) { return code >= 200 && code < 400; }
function isPermanentReject(code) { return code >= 500 && code < 600; }

// Parse les lignes SMTP : "250-foo\r\n250 bar\r\n"
function lastCode(buffer) {
    const lines = buffer.trim().split(/\r?\n/);
    if (lines.length === 0) return 0;
    const last = lines[lines.length - 1];
    const m = last.match(/^(\d{3})/);
    return m ? parseInt(m[1], 10) : 0;
}

function smtpConverse(host, port, commands, timeoutMs = 10000) {
    return new Promise((resolve) => {
        const result = { connected: false, banner: '', codes: [], responses: [], error: null };
        const socket = new net.Socket();
        let buffer = '';
        let step = 0;

        const done = (outcome) => {
            try { socket.end(); } catch {}
            resolve(outcome || result);
        };

        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => { result.error = 'timeout'; done(); });
        socket.on('error', (err) => { result.error = err.message; done(); });
        socket.on('close', () => { /* resolve déjà appelé */ });

        socket.connect(port, host, () => { result.connected = true; });

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            // Attendre une ligne "\r\n"
            while (buffer.includes('\n')) {
                const idx = buffer.indexOf('\n') + 1;
                const line = buffer.substring(0, idx);
                buffer = buffer.substring(idx);
                const code = lastCode(line);
                if (step === 0) {
                    result.banner = line.trim();
                    if (!isPositive(code)) return done();
                    socket.write(commands[step++] + '\r\n');
                } else {
                    result.codes.push(code);
                    result.responses.push(line.trim());
                    if (step < commands.length) {
                        socket.write(commands[step++] + '\r\n');
                    } else {
                        done();
                    }
                }
            }
        });
    });
}

async function smtpVerifyEmail(email, opts = {}) {
    const domain = email.split('@')[1];
    if (!domain) return { valid: null, reason: 'no-domain' };
    const timeout = opts.timeout || TIMEOUTS.SMTP_DIRECT;
    const helo = opts.helo || 'mail.example.com';
    const mailFrom = opts.mailFrom || 'verify@example.com';

    const mxHosts = await resolveMX(domain);
    if (mxHosts.length === 0) return { valid: false, reason: 'no-mx' };

    // Essayer jusqu'à 2 MX (primaire + secondaire)
    for (const host of mxHosts.slice(0, 2)) {
        for (const port of [25, 587]) {
            const conv = await smtpConverse(host, port, [
                `HELO ${helo}`,
                `MAIL FROM:<${mailFrom}>`,
                `RCPT TO:<${email}>`,
                `QUIT`,
            ], timeout);
            if (!conv.connected) continue;
            // Dernier code = réponse à RCPT TO (index 2)
            const rcptCode = conv.codes[2];
            if (rcptCode === undefined) continue;
            if (rcptCode === 250) return { valid: true, reason: 'rcpt-accepted', host, port };
            if (isPermanentReject(rcptCode)) return { valid: false, reason: `rcpt-rejected-${rcptCode}`, host, port, response: conv.responses[2] };
            // 4xx = greylist/transient → essayer port suivant
        }
    }
    return { valid: null, reason: 'inconclusive' };
}

module.exports = { smtpVerifyEmail, resolveMX };
