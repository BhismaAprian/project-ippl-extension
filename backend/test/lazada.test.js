/**
 * backend/test/lazada.test.js (Task T4.22)
 *
 * Unit test Lazada Ajax JSON Client dengan mock axios.get (tanpa internet).
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const {
    searchLazada,
    parseLazadaResponse
} = require('../src/providers/lazada-client.js');

describe('Lazada Ajax Client Test Suite (T4.22)', () => {
    const originalGet = axios.get;

    afterEach(() => {
        axios.get = originalGet;
    });

    it('searchLazada harus mengirim GET ke lazada.co.id/catalog/?ajax=true dengan User-Agent dan mem-parsing mods.listItems', async () => {
        let capturedUrl = '';
        let capturedConfig = null;

        axios.get = async (url, config) => {
            capturedUrl = url;
            capturedConfig = config;
            return {
                data: {
                    mods: {
                        listItems: [
                            {
                                itemId: 'lz-101',
                                name: 'ASUS Vivobook 14 A1404ZA i3 8GB 512GB',
                                price: '6299000',
                                priceShow: 'Rp6.299.000',
                                image: '//id-live-01.slatic.net/p/vivobook.jpg',
                                itemUrl: '//www.lazada.co.id/products/asus-vivobook-i101-s202.html',
                                ratingScore: '4.9',
                                sellerName: 'ASUS Official Store'
                            },
                            {
                                itemId: 'lz-102',
                                name: 'Item Tanpa Harga',
                                image: 'https://id-live-01.slatic.net/p/invalid.jpg',
                                itemUrl: '//www.lazada.co.id/products/invalid.html',
                                price: ''
                            }
                        ]
                    }
                }
            };
        };

        const results = await searchLazada('asus vivobook 14');

        assert.strictEqual(capturedUrl, 'https://www.lazada.co.id/catalog/?ajax=true&q=asus%20vivobook%2014');
        assert.ok(capturedConfig.headers['User-Agent'].includes('Mozilla/5.0'));

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].source, 'lazada');
        assert.strictEqual(results[0].provenance, 'in-house-backend-api');
        assert.strictEqual(results[0].title, 'ASUS Vivobook 14 A1404ZA i3 8GB 512GB');
        assert.strictEqual(results[0].price, 6299000);
        assert.strictEqual(results[0].rating, 4.9);
        assert.strictEqual(results[0].shopName, 'ASUS Official Store');
        assert.strictEqual(results[0].url, 'https://www.lazada.co.id/products/asus-vivobook-i101-s202.html');
        assert.strictEqual(results[0].imageUrl, 'https://id-live-01.slatic.net/p/vivobook.jpg');
    });

    it('parseLazadaResponse harus menangani respons tanpa mods.listItems secara aman', () => {
        assert.deepStrictEqual(parseLazadaResponse(null), []);
        assert.deepStrictEqual(parseLazadaResponse({ mods: {} }), []);
    });
});
