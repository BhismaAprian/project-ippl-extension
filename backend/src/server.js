/**
 * backend/src/server.js
 * 
 * In-House Resilient Scraping Engine API Server
 * Menyediakan endpoint REST API bagi Chrome Extension untuk melakukan pencarian produk
 * lintas marketplace tanpa ketergantungan pada tab browser visual atau API scraping berbayar.
 */

const express = require('express');
const cors = require('cors');
const config = require('./config.js');
const { fetchHtml } = require('./http-client.js');
const { runWithLimit } = require('./queue.js');
const { getParser } = require('./parsers/index.js');
const { fetchHtmlWithBrowser } = require('./fallback-browser.js');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        uptime: process.uptime(),
        service: 'Shopping Intelligence In-House Scraping Engine',
        timestamp: new Date().toISOString()
    });
});

/**
 * Helper untuk mengeksekusi pencarian pada satu marketplace
 * @param {string} marketplaceKey - Nama marketplace ('shopee' | 'tokopedia' | 'lazada' | 'blibli')
 * @param {string} keyword - Kata kunci pencarian
 * @param {boolean} [enableBrowserFallback=true] - Izinkan headless browser jika statis kosong
 * @returns {Promise<Array>} Array of candidate objects
 */
async function searchSingleMarketplace(marketplaceKey, keyword, enableBrowserFallback = true) {
    const key = (marketplaceKey || 'shopee').toLowerCase();
    const template = config.searchUrlTemplates[key] || config.searchUrlTemplates.shopee;
    const searchUrl = template.replace('{q}', encodeURIComponent(keyword));
    const parser = getParser(key);

    return runWithLimit(key, async () => {
        let candidates = [];
        try {
            // Tahap 1: Ekstraksi cepat melalui static HTTP GET
            const fetchResult = await fetchHtml(searchUrl);
            const html = typeof fetchResult === 'string' ? fetchResult : (fetchResult?.html || '');
            candidates = parser(html);
        } catch (fetchErr) {
            console.warn(`[Server] Static fetch error untuk ${key}: ${fetchErr.message}`);
        }

        // Tahap 2: Fallback ke Headless Browser jika parser statis tidak menghasilkan produk
        if ((!candidates || candidates.length === 0) && enableBrowserFallback) {
            try {
                const renderedHtml = await fetchHtmlWithBrowser(searchUrl);
                if (renderedHtml) {
                    candidates = parser(renderedHtml);
                }
            } catch (browserErr) {
                console.warn(`[Server] Browser fallback error untuk ${key}: ${browserErr.message}`);
            }
        }

        // Tandai marketplace dan sumber
        return (candidates || []).map(item => ({
            ...item,
            marketplace: key,
            source: 'in-house-engine'
        }));
    });
}

// Search Endpoint (POST /api/search)
app.post('/api/search', async (req, res) => {
    const startTime = Date.now();
    const keyword = (req.body.keyword || req.body.query || '').trim();
    const targetMarketplace = (req.body.marketplace || '').toLowerCase().trim();
    const enableBrowserFallback = req.body.useBrowserFallback !== false;

    if (!keyword) {
        return res.status(400).json({
            success: false,
            error: 'Parameter keyword atau query wajib disertakan.'
        });
    }

    try {
        let allCandidates = [];
        const supported = ['shopee', 'tokopedia', 'lazada', 'blibli'];

        if (targetMarketplace && targetMarketplace !== 'all') {
            // Pencarian tunggal
            allCandidates = await searchSingleMarketplace(targetMarketplace, keyword, enableBrowserFallback);
        } else {
            // Pencarian simultan ke seluruh marketplace yang didukung
            const tasks = supported.map(m =>
                searchSingleMarketplace(m, keyword, enableBrowserFallback)
                    .catch(err => {
                        console.warn(`[Server] Gagal mengambil data dari ${m}:`, err.message);
                        return [];
                    })
            );
            const results = await Promise.all(tasks);
            allCandidates = results.flat();
        }

        const tookMs = Date.now() - startTime;
        return res.json({
            success: true,
            count: allCandidates.length,
            keyword,
            marketplace: targetMarketplace || 'all',
            candidates: allCandidates,
            tookMs
        });
    } catch (err) {
        console.error('[Server] Search error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Internal server error saat melakukan pencarian produk.'
        });
    }
});

// GET /api/search alias untuk kemudahan inspeksi via browser
app.get('/api/search', async (req, res) => {
    const keyword = (req.query.keyword || req.query.q || req.query.query || '').trim();
    const targetMarketplace = (req.query.marketplace || req.query.m || '').toLowerCase().trim();
    req.body = { keyword, marketplace: targetMarketplace };
    return app._router.handle(req, res, () => {});
});

/**
 * Memulai server listener
 * @param {number} [port] 
 * @returns {Promise<import('http').Server>}
 */
function startServer(port = config.port) {
    return new Promise((resolve) => {
        const server = app.listen(port, () => {
            console.log(`[ScrapingEngine] Server berjalan di http://localhost:${port}`);
            resolve(server);
        });
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    startServer,
    searchSingleMarketplace
};
