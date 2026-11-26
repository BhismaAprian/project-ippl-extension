/**
 * backend/src/providers/blibli-client.js (Task T4.23)
 *
 * Blibli Internal Search JSON Client.
 * Mengirim HTTP GET ke https://www.blibli.com/backend/search/products?searchTerm={keyword}
 * dan mem-parsing respons JSON menjadi NormalizedCandidate[].
 */

const axios = require('axios');
const { getBrowserHeaders, buildNormalizedCandidate } = require('./base-client.js');

const BLIBLI_SEARCH_BASE_URL = 'https://www.blibli.com/backend/search/products';

/**
 * Parses Blibli internal search JSON response into NormalizedCandidate array.
 * @param {object} responseData
 * @returns {Array<object>}
 */
function parseBlibliResponse(responseData) {
    const products = responseData?.data?.products;
    if (!Array.isArray(products)) return [];

    const candidates = [];
    for (const prod of products) {
        if (!prod || typeof prod !== 'object') continue;
        const primaryImage = Array.isArray(prod.images) ? prod.images[0] : (prod.image || null);
        const rawPrice = prod.price?.minPrice
            || prod.price?.offerPriceDisplay
            || prod.price?.priceDisplay
            || prod.price;

        const candidate = buildNormalizedCandidate({
            source: 'blibli',
            baseOrigin: 'https://www.blibli.com',
            url: prod.url,
            title: prod.name,
            price: rawPrice,
            rating: prod.review?.rating ?? prod.rating ?? null,
            shopName: prod.merchantName || prod.officialStoreName || null,
            itemId: prod.id || prod.sku || null,
            imageUrl: primaryImage,
            raw: prod
        });
        if (candidate) {
            candidates.push(candidate);
        }
    }
    return candidates;
}

/**
 * Searches Blibli products via public backend search JSON endpoint.
 * @param {string} query
 * @param {object} [options={}]
 * @returns {Promise<Array<object>>}
 */
async function searchBlibli(query, options = {}) {
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery) return [];

    const url = `${BLIBLI_SEARCH_BASE_URL}?searchTerm=${encodeURIComponent(cleanQuery)}`;

    const response = await axios.get(url, {
        timeout: options.timeoutMs || 10000,
        headers: getBrowserHeaders({
            'Referer': `https://www.blibli.com/cari/${encodeURIComponent(cleanQuery)}`
        })
    });

    return parseBlibliResponse(response?.data);
}

module.exports = {
    BLIBLI_SEARCH_BASE_URL,
    parseBlibliResponse,
    searchBlibli
};
