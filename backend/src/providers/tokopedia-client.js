/**
 * backend/src/providers/tokopedia-client.js (Task T4.21)
 *
 * Tokopedia GraphQL Search Client.
 * Mengirim HTTP POST ke https://gql.tokopedia.com/graphql menggunakan query GraphQL statis
 * tanpa dekripsi signature privat dan tanpa bypass CAPTCHA (ADR-08 & ADR-14).
 */

const axios = require('axios');
const { getBrowserHeaders, buildNormalizedCandidate } = require('./base-client.js');

const TOKOPEDIA_GQL_URL = 'https://gql.tokopedia.com/graphql';

const SEARCH_PRODUCT_QUERY = `query SearchProductQueryV4($params: String!) {
  ace_search_product_v4(params: $params) {
    header {
      totalData
      responseCode
    }
    data {
      products {
        id
        name
        url
        imageUrl
        price
        priceInt
        ratingAverage
        shop {
          name
          city
        }
      }
    }
  }
}`;

/**
 * Parses Tokopedia GraphQL JSON response into NormalizedCandidate array.
 * @param {object|Array} responseData
 * @returns {Array<object>}
 */
function parseTokopediaResponse(responseData) {
    const payload = Array.isArray(responseData) ? responseData[0] : responseData;
    const products = payload?.data?.ace_search_product_v4?.data?.products;
    if (!Array.isArray(products)) return [];

    const candidates = [];
    for (const p of products) {
        if (!p || typeof p !== 'object') continue;
        const candidate = buildNormalizedCandidate({
            source: 'tokopedia',
            baseOrigin: 'https://www.tokopedia.com',
            url: p.url,
            title: p.name,
            price: p.priceInt || p.price,
            rating: p.ratingAverage,
            shopName: p.shop?.name || null,
            itemId: p.id,
            imageUrl: p.imageUrl,
            raw: p
        });
        if (candidate) {
            candidates.push(candidate);
        }
    }
    return candidates;
}

/**
 * Searches Tokopedia products via public GraphQL endpoint.
 * @param {string} query
 * @param {object} [options={}]
 * @returns {Promise<Array<object>>}
 */
async function searchTokopedia(query, options = {}) {
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery) return [];

    const rows = options.rows || 12;
    const params = `device=desktop&navsource=&ob=23&page=1&q=${encodeURIComponent(cleanQuery)}&related=true&rows=${rows}&safe_search=false&scheme=https&shipping=&source=search&st=product&start=0&topads_bucket=true`;

    const payload = [{
        operationName: 'SearchProductQueryV4',
        variables: { params },
        query: SEARCH_PRODUCT_QUERY
    }];

    const response = await axios.post(TOKOPEDIA_GQL_URL, payload, {
        timeout: options.timeoutMs || 10000,
        headers: getBrowserHeaders({
            'Content-Type': 'application/json',
            'Origin': 'https://www.tokopedia.com',
            'Referer': `https://www.tokopedia.com/search?q=${encodeURIComponent(cleanQuery)}`
        })
    });

    return parseTokopediaResponse(response?.data);
}

module.exports = {
    TOKOPEDIA_GQL_URL,
    SEARCH_PRODUCT_QUERY,
    parseTokopediaResponse,
    searchTokopedia
};
