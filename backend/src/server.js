/**
 * backend/src/server.js (Task T4.20)
 *
 * In-House Multi-Marketplace API Backend (CR-007 / ADR-14)
 * Berjalan di port 3000 dan menyediakan endpoint REST bagi Chrome Extension
 * untuk mengekstrak data produk JSON/GraphQL dari Tokopedia, Lazada, dan Blibli.
 */

const express = require('express');
const cors = require('cors');
const { searchTokopedia } = require('./providers/tokopedia-client.js');
const { searchLazada } = require('./providers/lazada-client.js');
const { searchBlibli } = require('./providers/blibli-client.js');

const PORT = parseInt(process.env.PORT || '3000', 10);

const CLIENT_MAP = {
    tokopedia: searchTokopedia,
    lazada: searchLazada,
    blibli: searchBlibli
};

const SUPPORTED_MARKETPLACES = Object.keys(CLIENT_MAP);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (NFR-23)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        uptime: process.uptime(),
        service: 'Shopping Intelligence In-House Multi-Marketplace API',
        supportedMarketplaces: SUPPORTED_MARKETPLACES,
        timestamp: new Date().toISOString()
    });
});

/**
 * Searches one marketplace using the provided or default client map.
 * @param {string} marketplace
 * @param {string} query
 * @param {Record<string, Function>} [clients=CLIENT_MAP]
 * @returns {Promise<Array<object>>}
 */
async function searchMarketplace(marketplace, query, clients = CLIENT_MAP) {
    const fn = clients[marketplace];
    if (typeof fn !== 'function') {
        throw new Error(`Marketplace tidak didukung: ${marketplace}`);
    }
    return fn(query);
}

/**
 * Handles POST /api/search requests.
 * Body: { marketplace: 'tokopedia' | 'lazada' | 'blibli' | 'all', query: string }
 */
app.post('/api/search', async (req, res) => {
    const startTime = Date.now();
    const rawQuery = req.body?.query ?? req.body?.keyword ?? '';
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    const rawMarketplace = req.body?.marketplace ?? 'all';
    const marketplace = typeof rawMarketplace === 'string' ? rawMarketplace.trim().toLowerCase() : '';

    if (!query) {
        return res.status(400).json({
            success: false,
            error: 'Parameter query wajib disertakan dan tidak boleh kosong.'
        });
    }

    if (marketplace !== 'all' && !CLIENT_MAP[marketplace]) {
        return res.status(400).json({
            success: false,
            error: `Marketplace "${marketplace}" tidak dikenal. Gunakan salah satu dari: ${SUPPORTED_MARKETPLACES.join(', ')}, atau all.`
        });
    }

    try {
        let candidates = [];
        const errors = {};

        if (marketplace === 'all') {
            const settled = await Promise.allSettled(
                SUPPORTED_MARKETPLACES.map(m => searchMarketplace(m, query))
            );
            settled.forEach((outcome, idx) => {
                const m = SUPPORTED_MARKETPLACES[idx];
                if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
                    candidates.push(...outcome.value);
                } else if (outcome.status === 'rejected') {
                    errors[m] = outcome.reason?.message || 'Unknown upstream error';
                }
            });
        } else {
            candidates = await searchMarketplace(marketplace, query);
        }

        return res.json({
            success: true,
            count: candidates.length,
            query,
            marketplace,
            candidates,
            ...(Object.keys(errors).length > 0 ? { warnings: errors } : {}),
            tookMs: Date.now() - startTime
        });
    } catch (err) {
        console.error('[Backend:Server] Search error:', err.message);
        return res.status(500).json({
            success: false,
            error: err.message || 'Internal server error saat melakukan pencarian produk.'
        });
    }
});

function startServer(port = PORT) {
    return new Promise((resolve) => {
        const server = app.listen(port, () => {
            console.log(`[InHouseAPI] Server berjalan di http://localhost:${port}`);
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
    searchMarketplace,
    CLIENT_MAP,
    SUPPORTED_MARKETPLACES
};
