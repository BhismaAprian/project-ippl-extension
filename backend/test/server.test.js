/**
 * backend/test/server.test.js (Task T4.20 / NFR-23)
 *
 * Pengujian endpoint Express Server (GET /api/health, POST /api/search),
 * validasi input (query kosong & marketplace tidak dikenal), CORS header,
 * dan deteksi offline InHouseBackendProvider di sisi ekstensi.
 */

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const { app } = require('../src/server.js');
const { InHouseBackendProvider, BACKEND_OFFLINE_MESSAGE } = require('../../extension/shared/providers/in-house-backend-provider.js');

describe('Backend API Server Test Suite (T4.20)', () => {
    let server = null;
    let baseUrl = '';
    const originalPost = axios.post;
    const originalGet = axios.get;

    before(async () => {
        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                const { port } = server.address();
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    afterEach(() => {
        axios.post = originalPost;
        axios.get = originalGet;
    });

    it('GET /api/health harus mengembalikan status OK dan daftar marketplace didukung', async () => {
        const res = await fetch(`${baseUrl}/api/health`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');

        const data = await res.json();
        assert.strictEqual(data.status, 'OK');
        assert.deepStrictEqual(data.supportedMarketplaces, ['tokopedia', 'lazada', 'blibli']);
    });

    it('POST /api/search harus mengembalikan 400 jika query kosong', async () => {
        const res = await fetch(`${baseUrl}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketplace: 'tokopedia', query: '   ' })
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.ok(data.error.toLowerCase().includes('query'));
    });

    it('POST /api/search harus mengembalikan 400 jika marketplace tidak dikenal', async () => {
        const res = await fetch(`${baseUrl}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketplace: 'unknown-store', query: 'ram ddr4' })
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.ok(data.error.toLowerCase().includes('tidak dikenal'));
    });

    it('POST /api/search harus memanggil client sesuai marketplace dan mengembalikan NormalizedCandidate wajib imageUrl', async () => {
        axios.post = async () => ({
            data: [{
                data: {
                    ace_search_product_v4: {
                        data: {
                            products: [{
                                id: '12345',
                                name: 'Corsair Vengeance LPX 8GB DDR4',
                                url: 'https://www.tokopedia.com/toko/corsair-8gb',
                                imageUrl: 'https://images.tokopedia.net/img/corsair.jpg',
                                priceInt: 450000,
                                ratingAverage: '4.9',
                                shop: { name: 'Toko Komputer Resmi' }
                            }]
                        }
                    }
                }
            }]
        });

        const res = await fetch(`${baseUrl}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketplace: 'tokopedia', query: 'corsair 8gb' })
        });
        assert.strictEqual(res.status, 200);

        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.marketplace, 'tokopedia');
        assert.strictEqual(data.candidates.length, 1);

        const item = data.candidates[0];
        assert.strictEqual(item.source, 'tokopedia');
        assert.strictEqual(item.provenance, 'in-house-backend-api');
        assert.strictEqual(item.title, 'Corsair Vengeance LPX 8GB DDR4');
        assert.strictEqual(item.price, 450000);
        assert.strictEqual(item.imageUrl, 'https://images.tokopedia.net/img/corsair.jpg');
        assert.strictEqual(item.url, 'https://www.tokopedia.com/toko/corsair-8gb');
    });

    it('InHouseBackendProvider harus mendeteksi backend offline dan melempar pesan NFR-23 tanpa crash', async () => {
        const provider = new InHouseBackendProvider({
            baseUrl: 'http://127.0.0.1:59999',
            fetchFn: async () => {
                throw new TypeError('fetch failed: ECONNREFUSED');
            }
        });

        assert.strictEqual(provider.getPriority(), 2);
        assert.strictEqual(provider.getProvenance(), 'in-house-backend-api');
        assert.strictEqual(await provider.isAvailable(), false);

        await assert.rejects(
            () => provider.search('kasur springbed'),
            (err) => err.code === 'BACKEND_OFFLINE' && err.message === BACKEND_OFFLINE_MESSAGE
        );
    });
});
