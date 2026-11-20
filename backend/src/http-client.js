/**
 * backend/src/http-client.js
 * 
 * HTTP Client dengan Rotasi Header & Exponential Backoff Retry:
 * - Rotasi User-Agent realistis pada setiap pemanggilan
 * - Penanganan timeout & network error defensif
 * - Retry otomatis dengan jeda eksponensial untuk status 429 / 5xx / timeout
 */

const axios = require('axios');
const config = require('./config.js');

let userAgentIndex = 0;

/**
 * Mengambil User-Agent secara berputar (round-robin)
 * @returns {string}
 */
function getNextUserAgent() {
    const list = config.userAgents;
    if (!list || list.length === 0) {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    }
    const ua = list[userAgentIndex % list.length];
    userAgentIndex++;
    return ua;
}

/**
 * Mengambil User-Agent secara acak dari pool
 * @returns {string}
 */
function getRandomUserAgent() {
    const list = config.userAgents;
    if (!list || list.length === 0) {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    }
    return list[Math.floor(Math.random() * list.length)];
}

/**
 * Helper delay Promise
 * @param {number} ms 
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Melakukan HTTP GET request dengan rotasi User-Agent dan retry otomatis
 * @param {string} url - Target URL pencarian atau halaman produk
 * @param {object} options - Konfigurasi tambahan (headers, timeout, maxRetries)
 * @returns {Promise<{ html: string, status: number, headers: object }>}
 */
async function fetchHtml(url, options = {}) {
    const timeout = options.timeout || config.timeoutMs;
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : config.maxRetries;
    const retryDelayBase = options.retryDelayBaseMs || config.retryDelayBaseMs;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const userAgent = options.userAgent || getNextUserAgent();
        const headers = {
            ...config.defaultHeaders,
            'User-Agent': userAgent,
            ...(options.headers || {})
        };

        try {
            const response = await axios.get(url, {
                headers,
                timeout,
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 400
            });

            return {
                html: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
                status: response.status,
                headers: response.headers,
                url: response.request?.res?.responseUrl || url
            };

        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            const isRetryable = !err.response || status === 429 || (status >= 500 && status <= 599);

            if (attempt < maxRetries && isRetryable) {
                const backoffMs = retryDelayBase * Math.pow(2, attempt);
                console.warn(`[HttpClient] Percobaan ${attempt + 1} gagal (${err.message}). Mencoba kembali dalam ${backoffMs}ms...`);
                await sleep(backoffMs);
                continue;
            }

            break;
        }
    }

    throw new Error(`[HttpClient] Gagal memuat URL setelah ${maxRetries + 1} percobaan: ${url} (${lastError?.message || 'Unknown Error'})`);
}

module.exports = {
    fetchHtml,
    getNextUserAgent,
    getRandomUserAgent
};
