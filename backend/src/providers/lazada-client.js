/**
 * backend/src/providers/lazada-client.js (Task T4.22)
 *
 * Lazada Catalog Ajax JSON Client.
 * Mengirim HTTP GET ke https://www.lazada.co.id/catalog/?ajax=true&q={keyword}
 * dan mem-parsing array mods.listItems menjadi NormalizedCandidate[].
 */

const axios = require('axios');
const { getBrowserHeaders, buildNormalizedCandidate } = require('./base-client.js');

const LAZADA_SEARCH_BASE_URL = 'https://www.lazada.co.id/catalog/';

/**
 * Parses Lazada Ajax JSON response (`mods.listItems`) into NormalizedCandidate array.
 * @param {object} responseData
 * @returns {Array<object>}
 */
function parseLazadaResponse(responseData) {
    const items = responseData?.mods?.listItems;
    if (!Array.isArray(items)) return [];

    const candidates = [];
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const rawUrl = item.itemUrl || item.productUrl || '';
        const candidate = buildNormalizedCandidate({
            source: 'lazada',
            baseOrigin: 'https://www.lazada.co.id',
            url: rawUrl,
            title: item.name,
            price: item.price || item.priceShow,
            rating: item.ratingScore,
            shopName: item.sellerName || null,
            itemId: item.itemId || item.nid || null,
            imageUrl: item.image,
            raw: item
        });
        if (candidate) {
            candidates.push(candidate);
        }
    }
    return candidates;
}

/**
 * Searches Lazada products via catalog ajax JSON endpoint.
 * @param {string} query
 * @param {object} [options={}]
 * @returns {Promise<Array<object>>}
 */
async function searchLazada(query, options = {}) {
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery) return [];

    const url = `${LAZADA_SEARCH_BASE_URL}?ajax=true&q=${encodeURIComponent(cleanQuery)}`;

    const response = await axios.get(url, {
        timeout: options.timeoutMs || 10000,
        headers: getBrowserHeaders({
            'Referer': `https://www.lazada.co.id/catalog/?q=${encodeURIComponent(cleanQuery)}`,
            'X-Requested-With': 'XMLHttpRequest'
        })
    });

    return parseLazadaResponse(response?.data);
}

module.exports = {
    LAZADA_SEARCH_BASE_URL,
    parseLazadaResponse,
    searchLazada
};
