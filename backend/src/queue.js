/**
 * backend/src/queue.js
 * 
 * Pengendali Antrean Konkurensi Request (p-limit):
 * - Membatasi jumlah request simultan per domain marketplace
 * - Mencegah lonjakan trafik mendadak dan pemblokiran IP
 */

const pLimitModule = require('p-limit');
const config = require('./config.js');

const pLimit = typeof pLimitModule === 'function'
    ? pLimitModule
    : (pLimitModule.pLimit || pLimitModule.default);

// Cache instance limiter per marketplace
const limiters = new Map();

/**
 * Mendapatkan instance p-limit untuk domain marketplace tertentu
 * @param {string} marketplace - 'shopee' | 'tokopedia' | 'lazada' | 'blibli'
 * @returns {Function} limiter function
 */
function getLimiter(marketplace = 'default') {
    const key = (marketplace || 'default').toLowerCase();
    if (limiters.has(key)) {
        return limiters.get(key);
    }

    const concurrency = config.rateLimits[key] || config.rateLimits.default || 2;
    const limiter = pLimit(concurrency);
    limiters.set(key, limiter);
    return limiter;
}

/**
 * Menjalankan fungsi task dalam antrean pembatasan laju domain
 * @param {string} marketplace 
 * @param {Function} taskFn - async function to execute
 * @returns {Promise<any>}
 */
async function runWithLimit(marketplace, taskFn) {
    const limiter = getLimiter(marketplace);
    return limiter(taskFn);
}

module.exports = {
    getLimiter,
    runWithLimit
};
