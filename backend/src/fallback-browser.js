/**
 * backend/src/fallback-browser.js
 * 
 * Playwright Headless Browser Fallback untuk merender halaman SPA (Single Page Application)
 * jika parser statis (Cheerio) gagal mengekstrak data karena konten belum terhidrasi di HTML awal.
 */

const { getRandomUserAgent } = require('./http-client.js');

/**
 * Merender halaman web menggunakan Playwright Chromium Headless
 * @param {string} url - URL target pencarian
 * @param {Object} [options={}] - Opsi render
 * @param {number} [options.timeout=15000] - Batas waktu rendering dalam ms
 * @param {string} [options.waitForSelector=null] - Selektor CSS yang ditunggu
 * @param {string} [options.userAgent=null] - Custom User-Agent
 * @returns {Promise<string|null>} HTML hasil render atau null jika gagal
 */
async function fetchHtmlWithBrowser(url, options = {}) {
    let playwright;
    try {
        playwright = require('playwright');
    } catch {
        console.warn('[FallbackBrowser] Module playwright tidak ditemukan.');
        return null;
    }

    const { chromium } = playwright;
    if (!chromium) {
        console.warn('[FallbackBrowser] Chromium provider tidak tersedia.');
        return null;
    }

    const timeout = options.timeout || 15000;
    const userAgent = options.userAgent || getRandomUserAgent();
    let browser = null;
    let context = null;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions'
            ]
        });

        context = await browser.newContext({
            userAgent,
            viewport: { width: 1280, height: 800 },
            locale: 'id-ID',
            extraHTTPHeaders: {
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        const page = await context.newPage();
        page.setDefaultTimeout(timeout);

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout
        });

        if (options.waitForSelector) {
            try {
                await page.waitForSelector(options.waitForSelector, { timeout: Math.min(5000, timeout) });
            } catch {
                // Jangan gagalkan proses jika selector spesifik tidak muncul tepat waktu
            }
        } else {
            // Beri jeda singkat agar skrip hidrasi DOM berjalan
            await page.waitForTimeout(1500);
        }

        const html = await page.content();
        return html;
    } catch (err) {
        console.warn(`[FallbackBrowser] Gagal merender ${url}: ${err.message}`);
        return null;
    } finally {
        if (context) {
            try { await context.close(); } catch {}
        }
        if (browser) {
            try { await browser.close(); } catch {}
        }
    }
}

module.exports = {
    fetchHtmlWithBrowser
};
