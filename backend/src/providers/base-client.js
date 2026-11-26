/**
 * backend/src/providers/base-client.js
 *
 * Shared utilities for In-House Multi-Marketplace API clients (CR-007 / ADR-14):
 * - Standard desktop browser User-Agent headers
 * - Price, rating, URL, and imageUrl normalization
 * - Unified NormalizedCandidate builder
 */

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

let uaCounter = 0;

/**
 * Returns standard desktop browser headers to avoid generic bot blocking.
 * @param {object} [extraHeaders={}]
 * @returns {Record<string, string>}
 */
function getBrowserHeaders(extraHeaders = {}) {
    const ua = USER_AGENTS[uaCounter % USER_AGENTS.length];
    uaCounter += 1;
    return {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        ...extraHeaders
    };
}

/**
 * Parses numeric or Rupiah-formatted price strings into integer IDR (>= 100).
 * @param {number|string|null|undefined} priceInput
 * @returns {number|null}
 */
function parsePrice(priceInput) {
    if (priceInput === null || priceInput === undefined || priceInput === '') {
        return null;
    }
    if (typeof priceInput === 'number') {
        if (isNaN(priceInput) || priceInput <= 0) return null;
        return priceInput >= 100 ? Math.round(priceInput) : null;
    }
    if (typeof priceInput !== 'string') return null;

    const clean = priceInput
        .trim()
        .toLowerCase()
        .replace(/\u00a0/g, ' ')
        .replace(/^(?:rp|idr)\s*/i, '')
        .replace(/([.,]00|,-)\s*$/i, '');

    // Handle Indonesian decimal-comma or dot separators, ignoring range suffix
    const firstPart = clean.split(/[-–]/)[0].trim();
    const digitsOnly = firstPart.replace(/[^\d]/g, '');
    if (!digitsOnly) return null;

    const num = parseInt(digitsOnly, 10);
    return !isNaN(num) && num >= 100 ? num : null;
}

/**
 * Normalizes rating values into range [0, 5] or null.
 * @param {number|string|null|undefined} ratingInput
 * @returns {number|null}
 */
function parseRating(ratingInput) {
    if (ratingInput === null || ratingInput === undefined || ratingInput === '') {
        return null;
    }
    const val = typeof ratingInput === 'number'
        ? ratingInput
        : parseFloat(String(ratingInput).replace(',', '.'));
    if (isNaN(val) || val <= 0) return null;
    return Math.min(5, Math.max(0, Math.round(val * 10) / 10));
}

/**
 * Resolves protocol-relative or path-relative marketplace URLs.
 * @param {string} rawUrl
 * @param {string} baseOrigin
 * @returns {string|null}
 */
function normalizeUrl(rawUrl, baseOrigin) {
    if (typeof rawUrl !== 'string') return null;
    let clean = rawUrl.trim();
    if (!clean) return null;

    if (clean.startsWith('//')) {
        clean = 'https:' + clean;
    } else if (clean.startsWith('/') && baseOrigin) {
        clean = baseOrigin.replace(/\/+$/, '') + clean;
    }

    return /^https?:\/\//i.test(clean) ? clean : null;
}

/**
 * Normalizes and enforces valid http/https image URLs (SPEC Section 7 / ADR-14).
 * @param {string} rawImg
 * @returns {string|null}
 */
function normalizeImageUrl(rawImg) {
    if (typeof rawImg !== 'string') return null;
    let clean = rawImg.trim();
    if (!clean) return null;

    if (clean.startsWith('//')) {
        clean = 'https:' + clean;
    }
    if (!/^https?:\/\//i.test(clean)) return null;

    const lower = clean.toLowerCase();
    if (lower.includes('placeholder') || lower.includes('1x1')) return null;

    return clean;
}

/**
 * Builds a NormalizedCandidate conforming to SPEC.md Section 7.
 * Rejects entries missing mandatory title, url, valid price, or valid imageUrl.
 * @param {object} params
 * @returns {object|null}
 */
function buildNormalizedCandidate({
    source,
    url,
    title,
    price,
    rating = null,
    shopName = null,
    itemId = null,
    imageUrl,
    baseOrigin = '',
    raw = null
}) {
    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    const cleanUrl = normalizeUrl(url, baseOrigin);
    const cleanPrice = parsePrice(price);
    const cleanImageUrl = normalizeImageUrl(imageUrl);

    if (!cleanTitle || !cleanUrl || cleanPrice === null || !cleanImageUrl) {
        return null;
    }

    return {
        source,
        marketplace: source,
        provenance: 'in-house-backend-api',
        url: cleanUrl,
        title: cleanTitle,
        price: cleanPrice,
        rating: parseRating(rating),
        shopName: (typeof shopName === 'string' && shopName.trim()) ? shopName.trim() : null,
        itemId: itemId !== null && itemId !== undefined ? String(itemId).trim() : null,
        imageUrl: cleanImageUrl,
        observedAt: new Date().toISOString(),
        matchScore: 0,
        matchType: 'UNKNOWN',
        raw
    };
}

module.exports = {
    getBrowserHeaders,
    parsePrice,
    parseRating,
    normalizeUrl,
    normalizeImageUrl,
    buildNormalizedCandidate
};
