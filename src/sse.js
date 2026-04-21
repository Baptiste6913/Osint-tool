// ================================================================
// SSE — Server-Sent Events helpers
// ================================================================
const { log } = require('./helpers');

function sseLog(res, msg, type = 'info') {
    const data = JSON.stringify({ event: 'log', msg, type });
    res.write(`data: ${data}\n\n`);
    log(`[${type}] ${msg.replace(/<[^>]+>/g, '')}`);
}

function sseProgress(res, step, total, label) {
    res.write(`data: ${JSON.stringify({ event: 'progress', step, total, label })}\n\n`);
}

function sseDone(res, payload) {
    res.write(`data: ${JSON.stringify({ event: 'done', ...payload })}\n\n`);
    res.end();
}

module.exports = { sseLog, sseProgress, sseDone };
