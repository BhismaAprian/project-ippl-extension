/**
 * extension/shared/providers/in-house-backend-provider.js (CR-007 / ADR-14 / NFR-23)
 *
 * Prioritas 2 Search Provider ('in-house-backend-api').
 * Mengirim permintaan pencarian lintas marketplace (Tokopedia, Lazada, Blibli)
 * ke server backend lokal (http://localhost:3000/api/search) dalam format UMD-Lite (ADR-02).
 */

const _BaseBackendProviderClass = typeof require !== 'undefined'
    ? require('../base-search-provider.js').BaseSearchProvider
    : (typeof window !== 'undefined' ? window.BaseSearchProvider : class {});

const _BackendNormalizer = typeof require !== 'undefined'
    ? require('../candidate-normalizer.js')
    : (typeof window !== 'undefined' ? window.CandidateNormalizer : null);

const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const BACKEND_OFFLINE_MESSAGE = 'Backend Engine belum berjalan. Jalankan npm start di folder backend.';

class InHouseBackendProvider extends _BaseBackendProviderClass {
    /**
     * @param {object} [options={}] - { baseUrl, fetchFn, timeoutMs }
     */
    constructor(options = {}) {
        super();
        this.baseUrl = (options.baseUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
        this.fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
        this.timeoutMs = options.timeoutMs || 10000;
    }

    getName() {
        return 'in-house-backend-api';
    }

    getProvenance() {
        return 'in-house-backend-api';
    }

    getPriority() {
        return 2;
    }

    /**
     * Memeriksa apakah backend lokal (localhost:3000) sedang berjalan (NFR-23).
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        if (typeof this.fetchFn !== 'function') return false;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
        try {
            const res = await this.fetchFn(`${this.baseUrl}/api/health`, {
                method: 'GET',
                signal: controller ? controller.signal : undefined
            });
            return Boolean(res && res.ok);
        } catch (err) {
            return false;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * Mengekstrak string query bersih dari string atau objek fingerprint/product.
     * @param {string|object} queryOrFingerprint
     * @returns {string}
     */
    extractQuery(queryOrFingerprint) {
        if (typeof queryOrFingerprint === 'string') {
            return queryOrFingerprint.trim();
        }
        if (queryOrFingerprint && typeof queryOrFingerprint === 'object') {
            return String(
                queryOrFingerprint.searchQueries?.tier1
                || queryOrFingerprint.clean_query
                || queryOrFingerprint.search_query
                || queryOrFingerprint.title
                || ''
            ).trim();
        }
        return '';
    }

    /**
     * Mencari kandidat produk melalui endpoint POST /api/search backend lokal.
     * @param {string|object} queryOrFingerprint
     * @param {object} [options={}] - { marketplace: 'tokopedia'|'lazada'|'blibli'|'all' }
     * @returns {Promise<Array<object>>}
     */
    async search(queryOrFingerprint, options = {}) {
        if (typeof this.fetchFn !== 'function') {
            const err = new Error(BACKEND_OFFLINE_MESSAGE);
            err.code = 'BACKEND_OFFLINE';
            throw err;
        }

        const query = this.extractQuery(queryOrFingerprint);
        if (!query) return [];

        const marketplace = (options.marketplace || 'all').toLowerCase().trim();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

        let res;
        try {
            res = await this.fetchFn(`${this.baseUrl}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ marketplace, query }),
                signal: controller ? controller.signal : undefined
            });
        } catch (networkErr) {
            const err = new Error(BACKEND_OFFLINE_MESSAGE);
            err.code = 'BACKEND_OFFLINE';
            err.cause = networkErr;
            throw err;
        } finally {
            if (timer) clearTimeout(timer);
        }

        if (!res || !res.ok) {
            const status = res ? res.status : 0;
            const err = new Error(
                status >= 500 || status === 0
                    ? BACKEND_OFFLINE_MESSAGE
                    : `Backend API mengembalikan HTTP ${status}`
            );
            if (status >= 500 || status === 0) err.code = 'BACKEND_OFFLINE';
            throw err;
        }

        const payload = await res.json();
        const rawList = Array.isArray(payload?.candidates) ? payload.candidates : [];

        return rawList.map(item => {
            const source = (item.source || item.marketplace || marketplace || 'tokopedia').toLowerCase();
            if (_BackendNormalizer && typeof _BackendNormalizer.normalizeCandidate === 'function') {
                const norm = _BackendNormalizer.normalizeCandidate(item, source, 'in-house-backend-api');
                if (norm) {
                    norm.marketplace = source;
                    return norm;
                }
            }
            return {
                source,
                marketplace: source,
                provenance: 'in-house-backend-api',
                url: item.url,
                title: item.title,
                price: item.price,
                rating: item.rating ?? null,
                shopName: item.shopName ?? null,
                itemId: item.itemId ?? null,
                imageUrl: item.imageUrl ?? null,
                observedAt: item.observedAt || new Date().toISOString(),
                matchScore: item.matchScore ?? 0,
                matchType: item.matchType || 'UNKNOWN',
                raw: item.raw || item
            };
        }).filter(c => c && c.url && c.title && c.imageUrl);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { InHouseBackendProvider, BACKEND_OFFLINE_MESSAGE, DEFAULT_BACKEND_URL };
}
if (typeof window !== 'undefined') {
    window.InHouseBackendProvider = InHouseBackendProvider;
    window.BACKEND_OFFLINE_MESSAGE = BACKEND_OFFLINE_MESSAGE;
}
