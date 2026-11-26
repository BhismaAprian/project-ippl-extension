/**
 * backend/test/blibli.test.js (Task T4.23)
 *
 * Unit test Blibli Internal API Client dengan mock axios.get (tanpa internet).
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const {
    searchBlibli,
    parseBlibliResponse
} = require('../src/providers/blibli-client.js');

describe('Blibli Internal API Client Test Suite (T4.23)', () => {
    const originalGet = axios.get;

    afterEach(() => {
        axios.get = originalGet;
    });

    it('searchBlibli harus mengirim GET ke backend/search/products dengan User-Agent dan mem-parsing data.products', async () => {
        let capturedUrl = '';
        let capturedConfig = null;

        axios.get = async (url, config) => {
            capturedUrl = url;
            capturedConfig = config;
            return {
                data: {
                    code: 200,
                    status: 'OK',
                    data: {
                        products: [
                            {
                                id: 'BLI-7788',
                                name: 'Kingston Fury Beast DDR4 8GB 3200MHz',
                                url: '/p/kingston-fury-beast-8gb/ps--BLI-7788',
                                images: ['https://www.static-src.com/wcsstore/kingston.jpg'],
                                price: {
                                    minPrice: 389000,
                                    offerPriceDisplay: 'Rp389.000'
                                },
                                review: { rating: 4.7 },
                                merchantName: 'Kingston Official Store'
                            },
                            {
                                id: 'BLI-9999',
                                name: 'Produk Placeholder',
                                url: '/p/placeholder/ps--9999',
                                images: ['https://www.static-src.com/placeholder.png'],
                                price: { minPrice: 100000 }
                            }
                        ]
                    }
                }
            };
        };

        const results = await searchBlibli('kingston 8gb ddr4');

        assert.strictEqual(capturedUrl, 'https://www.blibli.com/backend/search/products?searchTerm=kingston%208gb%20ddr4');
        assert.ok(capturedConfig.headers['User-Agent'].includes('Mozilla/5.0'));

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].source, 'blibli');
        assert.strictEqual(results[0].provenance, 'in-house-backend-api');
        assert.strictEqual(results[0].title, 'Kingston Fury Beast DDR4 8GB 3200MHz');
        assert.strictEqual(results[0].price, 389000);
        assert.strictEqual(results[0].rating, 4.7);
        assert.strictEqual(results[0].shopName, 'Kingston Official Store');
        assert.strictEqual(results[0].url, 'https://www.blibli.com/p/kingston-fury-beast-8gb/ps--BLI-7788');
        assert.strictEqual(results[0].imageUrl, 'https://www.static-src.com/wcsstore/kingston.jpg');
    });

    it('parseBlibliResponse harus menangani respons kosong tanpa error', () => {
        assert.deepStrictEqual(parseBlibliResponse(null), []);
        assert.deepStrictEqual(parseBlibliResponse({ data: {} }), []);
    });
});
