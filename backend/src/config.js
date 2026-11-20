/**
 * backend/src/config.js
 * 
 * Konfigurasi In-House Resilient Scraping Engine:
 * - Port & timeout server
 * - Pool User-Agent desktop realistis untuk rotasi request
 * - Batasan rate limit & antrean per domain e-commerce
 * - Template URL pencarian per marketplace
 */

const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    timeoutMs: parseInt(process.env.TIMEOUT_MS || '10000', 10),
    maxRetries: 2,
    retryDelayBaseMs: 1000,

    // Concurrency limit per marketplace (mencegah pemblokiran IP)
    rateLimits: {
        shopee: 2,
        tokopedia: 2,
        lazada: 2,
        blibli: 2,
        default: 2
    },

    // Pool User-Agent desktop modern untuk rotasi request
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15'
    ],

    // Default request headers
    defaultHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
    },

    // Template URL pencarian per marketplace
    searchUrlTemplates: {
        shopee: 'https://shopee.co.id/search?keyword={q}',
        tokopedia: 'https://www.tokopedia.com/search?q={q}',
        lazada: 'https://www.lazada.co.id/catalog/?q={q}',
        blibli: 'https://www.blibli.com/cari/{q}'
    }
};

module.exports = config;
