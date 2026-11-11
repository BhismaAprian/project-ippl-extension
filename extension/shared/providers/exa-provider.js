/**
 * extension/shared/providers/exa-provider.js
 * 
 * Exa Neural Search Provider (Fallback Sekunder).
 * Mengimplementasikan BaseSearchProvider (Prioritas 5).
 * 
 * Alur:
 * 1. Query Builder (Tiered Query + Kamus Negatif) — Jaminan Anti-Query Kosong.
 * 2. Fetch ke Exa Neural Search API (/search endpoint).
 * 3. PDP URL Classifier — Membuang URL bukan produk langsung (etalase, /find/, /cart/).
 * 4. Strict Category & Spec Gatekeeper 3 Lapis.
 * 5. Mengembalikan daftar kandidat mentah tervalidasi.
 */

// Resolusi dependensi lingkungan ganda (Node.js CommonJS vs Browser Global Scope)
const BaseProviderClass = typeof require !== 'undefined'
    ? require('../base-search-provider.js').BaseSearchProvider
    : (typeof window !== 'undefined' ? window.BaseSearchProvider : class {});

const _queryBuilder = typeof require !== 'undefined'
    ? require('../query-builder.js')
    : (typeof window !== 'undefined' ? window.QueryBuilder : null);

const _pdpClassifier = typeof require !== 'undefined'
    ? require('../pdp-url-classifier.js')
    : (typeof window !== 'undefined' ? window.PdpUrlClassifier : null);

const _gatekeeper = typeof require !== 'undefined'
    ? require('../gatekeeper.js')
    : (typeof window !== 'undefined' ? window.Gatekeeper : null);

const _normalizer = typeof require !== 'undefined'
    ? require('../candidate-normalizer.js')
    : (typeof window !== 'undefined' ? window.CandidateNormalizer : null);

class ExaProvider extends BaseProviderClass {
    /**
     * @param {object} [config={}] - Konfigurasi provider { apiKey, fetchFn }
     */
    constructor(config = {}) {
        super();
        this.apiKey = config.apiKey || null;
        this.fetchFn = config.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    }

    /**
     * Setel API key Exa secara dinamis
     * @param {string} key 
     */
    setApiKey(key) {
        this.apiKey = key || null;
    }

    /**
     * @returns {string}
     */
    getName() {
        return 'exa';
    }

    /**
     * @returns {string}
     */
    getProvenance() {
        return 'exa-fallback';
    }

    /**
     * @returns {number} Prioritas 5 (Fallback sekunder)
     */
    getPriority() {
        return 5;
    }

    /**
     * Memeriksa kesiapan Exa Provider (ketersediaan API key)
     * @param {object} [options={}]
     * @returns {Promise<boolean>}
     */
    async isAvailable(options = {}) {
        const key = options.apiKey || this.apiKey;
        return Boolean(key && typeof key === 'string' && key.trim().length > 0);
    }

    /**
     * Helper: Ekstraksi nominal harga IDR dari cuplikan teks snippet
     * @param {string} text 
     * @returns {number|null}
     */
    extractPrice(text) {
        if (!text || typeof text !== 'string') return null;

        const parsePriceFn = _normalizer?.parseCandidatePrice || ((val) => {
            const digits = String(val).replace(/[^\d]/g, '');
            const num = parseInt(digits, 10);
            return !isNaN(num) && num >= 1000 ? num : null;
        });

        // Tangkap pola nominal Rupiah
        const matches = text.matchAll(/(?:Rp|IDR)\s*([\d\.,]+)/gi);
        for (const m of matches) {
            if (m && m[1]) {
                const parsed = parsePriceFn(m[1]);
                if (parsed && parsed >= 1000) {
                    return parsed;
                }
            }
        }

        return null;
    }

    /**
     * Menjalankan pencarian alternatif melalui Exa Neural Search API
     * 
     * @param {string|object} queryOrFingerprint - String query atau objek fingerprint { brand, model, category, keySpecs, title }
     * @param {object} [options={}] - Opsi pencarian (apiKey, numResults, rawProduct, aiData, tier)
     * @returns {Promise<Array<object>>} - Daftar kandidat produk mentah yang lolos filter PDP dan Gatekeeper
     */
    async search(queryOrFingerprint, options = {}) {
        // 1. Resolusi Query & Jaminan Anti-Query Kosong
        let query = '';

        if (typeof queryOrFingerprint === 'string') {
            query = queryOrFingerprint.trim();
        } else if (queryOrFingerprint && typeof queryOrFingerprint === 'object') {
            const fp = queryOrFingerprint;
            // Periksa apakah fingerprint memiliki konten bermakna
            const hasBrand = typeof fp.brand === 'string' && fp.brand.trim().length > 0;
            const hasModel = typeof fp.model === 'string' && fp.model.trim().length > 0;
            const hasTitle = typeof fp.title === 'string' && fp.title.replace(/[^\w]/g, '').trim().length > 0;
            const hasCategory = typeof fp.category === 'string' && fp.category.trim().length > 0;
            const hasSpecs = fp.keySpecs && (
                Array.isArray(fp.keySpecs) ? fp.keySpecs.length > 0 : Object.keys(fp.keySpecs).length > 0
            );

            if (!hasBrand && !hasModel && !hasTitle && !hasCategory && !hasSpecs) {
                // Objek fingerprint kosong atau hanya berisi karakter non-alfanumerik
                query = '';
            } else if (_queryBuilder && typeof _queryBuilder.buildQueries === 'function') {
                const queries = _queryBuilder.buildQueries(fp);
                const requestedTier = options.tier || 'tier1';
                query = (queries[requestedTier] || queries.tier1 || queries.tier2 || queries.tier3 || '').trim();
                // Jika hasil buildQueries hanya berupa dummy fallback 'produk', anggap kosong jika input aslinya tidak punya teks
                if (query.toLowerCase() === 'produk' && !hasTitle && !hasCategory) {
                    query = '';
                }
            } else {
                query = (fp.title || fp.model || fp.brand || '').trim();
            }
        }

        // Sanitasi query: hilangkan karakter simbol liar
        query = query.replace(/[^\w\s-]/gi, ' ').replace(/\s+/g, ' ').trim();

        // PEMERIKSAAN KERAS: Jangan pernah memanggil fetch jika query kosong/terlalu pendek
        if (!query || query.length < 2) {
            console.warn('[ExaProvider] Query pencarian kosong atau tidak valid (< 2 karakter). Pencarian dibatalkan.');
            return [];
        }

        // 2. Validasi Kunci API Exa
        const effectiveKey = options.apiKey || this.apiKey;
        if (!effectiveKey || typeof effectiveKey !== 'string' || !effectiveKey.trim()) {
            throw new Error('API Key Exa belum diisi. Silakan isi di menu Settings.');
        }

        const activeFetch = options.fetchFn || this.fetchFn || globalThis.fetch;
        if (typeof activeFetch !== 'function') {
            throw new Error('Fetch function tidak tersedia pada runtime ini.');
        }

        // 3. Eksekusi Request ke Exa Search API
        const numResults = options.numResults || 20;
        const includeDomains = options.includeDomains || [
            'shopee.co.id',
            'tokopedia.com',
            'lazada.co.id',
            'blibli.com'
        ];

        let response;
        try {
            response = await activeFetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'x-api-key': effectiveKey.trim(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    numResults: numResults,
                    type: 'auto',
                    includeDomains: includeDomains,
                    contents: {
                        text: { maxCharacters: 500 }
                    }
                })
            });
        } catch (netErr) {
            throw new Error(`Gagal terhubung ke layanan Exa: ${netErr.message || 'Network error'}`);
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error('API Key Exa tidak valid. Periksa kembali di menu Settings.');
            }
            if (response.status === 429) {
                throw new Error('Batas kuota Exa API tercapai (Rate Limit 429). Coba lagi nanti.');
            }
            throw new Error(`Exa API Error: HTTP ${response.status} ${response.statusText}`);
        }

        let data;
        try {
            data = await response.json();
        } catch (jsonErr) {
            throw new Error('Format respon Exa API bukan JSON yang valid.');
        }

        const rawResults = (data && Array.isArray(data.results)) ? data.results : [];
        if (rawResults.length === 0) {
            return [];
        }

        // 4. Filter Kualitas Lapis 1: PDP URL Classifier (Membuang link etalase/non-produk)
        const classifyUrlFn = _pdpClassifier?.classifyUrl || ((u) => ({ isPdp: true, marketplace: 'unknown' }));
        const isProductUrlFn = _pdpClassifier?.isProductUrl || ((u) => true);

        const pdpCandidates = [];
        for (const item of rawResults) {
            if (!item || !item.url) continue;

            const classification = classifyUrlFn(item.url);
            if (!classification.isPdp) {
                // Buang URL yang bukan halaman produk langsung
                continue;
            }

            const snippet = item.text || item.snippet || '';
            const price = this.extractPrice(snippet);

            pdpCandidates.push({
                title: item.title || 'Tanpa Judul',
                url: item.url,
                snippet: snippet.length > 250 ? snippet.substring(0, 250) + '...' : snippet,
                marketplace: classification.marketplace,
                price: price,
                raw: item
            });
        }

        // 5. Filter Kualitas Lapis 2: Gatekeeper 3 Lapis
        const isCatMatchFn = _gatekeeper?.isCategoryMatch || (() => true);
        const rawProduct = options.rawProduct || (typeof queryOrFingerprint === 'object' ? queryOrFingerprint : null);
        const aiData = options.aiData || null;

        const verifiedCandidates = pdpCandidates.filter(c => {
            return isCatMatchFn(c.title, aiData, rawProduct, c.price);
        });

        return verifiedCandidates;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ExaProvider };
}
if (typeof window !== 'undefined') {
    window.ExaProvider = ExaProvider;
}
