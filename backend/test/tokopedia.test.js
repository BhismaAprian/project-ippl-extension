/**
 * backend/test/tokopedia.test.js (Task T4.21)
 *
 * Unit test Tokopedia GraphQL Client dengan mock axios.post (tanpa internet).
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const {
    TOKOPEDIA_GQL_URL,
    searchTokopedia,
    parseTokopediaResponse
} = require('../src/providers/tokopedia-client.js');

describe('Tokopedia GraphQL Client Test Suite (T4.21)', () => {
    const originalPost = axios.post;

    afterEach(() => {
        axios.post = originalPost;
    });

    it('searchTokopedia harus mengirim POST ke gql.tokopedia.com dengan header User-Agent browser dan query GraphQL', async () => {
        let capturedUrl = '';
        let capturedPayload = null;
        let capturedConfig = null;

        axios.post = async (url, data, config) => {
            capturedUrl = url;
            capturedPayload = data;
            capturedConfig = config;
            return {
                data: [{
                    data: {
                        ace_search_product_v4: {
                            data: {
                                products: [
                                    {
                                        id: '98765',
                                        name: 'Kasur Springbed Central Deluxe 160x200',
                                        url: 'https://www.tokopedia.com/central/kasur-160x200',
                                        imageUrl: 'https://images.tokopedia.net/img/kasur.jpg',
                                        price: 'Rp 2.450.000',
                                        priceInt: 2450000,
                                        ratingAverage: '4.8',
                                        shop: { name: 'Central Official' }
                                    },
                                    {
                                        id: '99999',
                                        name: 'Produk Tanpa Gambar',
                                        url: 'https://www.tokopedia.com/central/no-img',
                                        imageUrl: '',
                                        priceInt: 500000
                                    }
                                ]
                            }
                        }
                    }
                }]
            };
        };

        const results = await searchTokopedia('kasur springbed');

        assert.strictEqual(capturedUrl, TOKOPEDIA_GQL_URL);
        assert.ok(Array.isArray(capturedPayload) && capturedPayload[0].operationName === 'SearchProductQueryV4');
        assert.ok(capturedPayload[0].variables.params.includes('kasur%20springbed'));
        assert.ok(capturedConfig.headers['User-Agent'].includes('Mozilla/5.0'));

        // Hanya item dengan imageUrl valid yang lolos
        assert.strictEqual(results.length, 1);
        assert.deepStrictEqual(
            {
                source: results[0].source,
                provenance: results[0].provenance,
                title: results[0].title,
                price: results[0].price,
                rating: results[0].rating,
                shopName: results[0].shopName,
                url: results[0].url,
                imageUrl: results[0].imageUrl
            },
            {
                source: 'tokopedia',
                provenance: 'in-house-backend-api',
                title: 'Kasur Springbed Central Deluxe 160x200',
                price: 2450000,
                rating: 4.8,
                shopName: 'Central Official',
                url: 'https://www.tokopedia.com/central/kasur-160x200',
                imageUrl: 'https://images.tokopedia.net/img/kasur.jpg'
            }
        );
    });

    it('parseTokopediaResponse harus mengembalikan array kosong jika struktur JSON tidak lengkap', () => {
        assert.deepStrictEqual(parseTokopediaResponse(null), []);
        assert.deepStrictEqual(parseTokopediaResponse({}), []);
    });
});
