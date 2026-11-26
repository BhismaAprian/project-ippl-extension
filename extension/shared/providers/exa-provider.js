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
     * Helper: Ekstraksi nominal harga IDR dari cuplikan teks snippet & highlights (CR-006: Multi-Pattern Price Parser)
     * @param {string} text 
     * @param {number} [referencePrice=0]
     * @returns {number|null}
     */
    extractPrice(text, referencePrice = 0) {
        if (!text || typeof text !== 'string') return null;

        const parsePriceFn = _normalizer?.parseCandidatePrice || ((val) => {
            const digits = String(val).replace(/[^\d]/g, '');
            const num = parseInt(digits, 10);
            return !isNaN(num) && num >= 1000 ? num : null;
        });

        const foundPrices = [];

        // 1. Pola Mata Uang Rupiah (mendukung NBSP \u00a0 dan spasi biasa)
        const rupiahMatches = text.matchAll(/(?:Rp\.?|IDR)[\s\u00a0]*(\d{1,3}(?:[.,]\d{3})+)/gi);
        for (const m of rupiahMatches) {
            if (m && m[1]) {
                const p = parsePriceFn(m[1]);
                if (p && p >= 100) {
                    const matchIdx = m.index;
                    const contextAfter = text.slice(matchIdx, matchIdx + 40).toLowerCase();
                    const contextBefore = text.slice(Math.max(0, matchIdx - 30), matchIdx).toLowerCase();
                    const isInstallment = /(?:\/|\bper\s+|\btiap\s+)(?:bln|bulan|month)\b/i.test(contextAfter)
                        || /\bcicilan\b/i.test(contextBefore);

                    foundPrices.push({
                        price: p,
                        isInstallment,
                        source: 'rupiah'
                    });
                }
            }
        }

        // 2. Pola JSON-LD / Metadata tersembunyi di teks Exa: /"price"\s*:\s*"?(\d{4,9})"?/i
        const jsonLdMatches = text.matchAll(/"(?:price|lowPrice)"\s*:\s*"?(\d{4,9})"?/gi);
        for (const m of jsonLdMatches) {
            if (m && m[1]) {
                const p = parseInt(m[1], 10);
                if (!isNaN(p) && p >= 100) {
                    foundPrices.push({
                        price: p,
                        isInstallment: false,
                        source: 'json-ld'
                    });
                }
            }
        }

        // 3. Pola Rupiah angka langsung tanpa pemisah ribuan
        const rawRupiahMatches = text.matchAll(/(?:Rp\.?|IDR)[\s\u00a0]*(\d{4,9})/gi);
        for (const m of rawRupiahMatches) {
            if (m && m[1]) {
                const p = parseInt(m[1], 10);
                if (!isNaN(p) && p >= 100) {
                    foundPrices.push({
                        price: p,
                        isInstallment: false,
                        source: 'rupiah-raw'
                    });
                }
            }
        }

        if (foundPrices.length === 0) return null;

        // Prioritaskan harga non-cicilan
        const nonInstallmentPrices = foundPrices.filter(fp => !fp.isInstallment);
        const candidates = nonInstallmentPrices.length > 0 ? nonInstallmentPrices : foundPrices;

        // Jika referencePrice tersedia, prioritaskan harga yang masuk akal (>= 30% referencePrice)
        if (referencePrice && referencePrice > 0) {
            const plausible = candidates.filter(c => c.price >= referencePrice * 0.30);
            if (plausible.length > 0) {
                return plausible[0].price;
            }
        }

        return candidates[0].price;
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

        // Sanitasi query: hilangkan karakter simbol liar dan operator boolean minus (-kata)
        query = query.replace(/(?:^|\s)-\w+/g, ' ').replace(/[^\w\s-]/gi, ' ').replace(/\s+/g, ' ').trim();

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

        // 3. Eksekusi Request ke Exa Search API (Partisi Per Marketplace - CR-006)
        const domainsToSearch = (Array.isArray(options.includeDomains) && options.includeDomains.length === 1)
            ? options.includeDomains
            : ['shopee.co.id', 'tokopedia.com', 'lazada.co.id', 'blibli.com'];

        const numResultsPerDomain = options.numResultsPerDomain || (domainsToSearch.length === 1 ? (options.numResults || 20) : 5);

        const fetchSingleDomain = async (domain) => {
            const response = await activeFetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'x-api-key': effectiveKey.trim(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    numResults: numResultsPerDomain,
                    type: 'auto',
                    includeDomains: [domain],
                    contents: {
                        text: { maxCharacters: 1200 },
                        highlights: { numSentences: 3 }
                    },
                    extras: { imageLinks: 1 }
                })
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('API Key Exa tidak valid. Periksa kembali di menu Settings.');
                }
                if (response.status === 429) {
                    throw new Error('Batas kuota Exa API tercapai (Rate Limit 429). Coba lagi nanti.');
                }
                throw new Error(`Exa API Error (${domain}): HTTP ${response.status} ${response.statusText}`);
            }

            let data;
            try {
                data = await response.json();
            } catch (jsonErr) {
                throw new Error('Format respon Exa API bukan JSON yang valid.');
            }

            return (data && Array.isArray(data.results)) ? data.results : [];
        };

        const rawResults = [];
        const seenUrls = new Set();

        if (domainsToSearch.length === 1) {
            const singleResults = await fetchSingleDomain(domainsToSearch[0]);
            for (const item of singleResults) {
                if (item && item.url && !seenUrls.has(item.url)) {
                    seenUrls.add(item.url);
                    rawResults.push(item);
                }
            }
        } else {
            const domainPromises = domainsToSearch.map(d => fetchSingleDomain(d));
            const settled = await Promise.allSettled(domainPromises);
            const allRejected = settled.every(s => s.status === 'rejected');
            if (allRejected && settled.length > 0) {
                throw settled[0].reason;
            }

            for (const s of settled) {
                if (s.status === 'fulfilled' && Array.isArray(s.value)) {
                    for (const item of s.value) {
                        if (item && item.url && !seenUrls.has(item.url)) {
                            seenUrls.add(item.url);
                            rawResults.push(item);
                        }
                    }
                } else if (s.status === 'rejected') {
                    console.warn('[ExaProvider] Partisi domain gagal:', s.reason?.message);
                }
            }
        }

        if (rawResults.length === 0) {
            return [];
        }

        // 4. Filter Kualitas Lapis 1: PDP URL Classifier (Membuang link etalase/non-produk)
        const classifyUrlFn = _pdpClassifier?.classifyUrl || ((u) => ({ isPdp: true, marketplace: 'unknown' }));
        const isProductUrlFn = _pdpClassifier?.isProductUrl || ((u) => true);
        const rawProduct = options.rawProduct || (typeof queryOrFingerprint === 'object' ? queryOrFingerprint : null);
        const origPrice = rawProduct?.price || 0;

        const pdpCandidates = [];
        for (const item of rawResults) {
            if (!item || !item.url) continue;

            const classification = classifyUrlFn(item.url);
            if (!classification.isPdp) {
                // Buang URL yang bukan halaman produk langsung
                continue;
            }

            const snippet = item.text || item.snippet || '';
            const highlightsStr = Array.isArray(item.highlights)
                ? item.highlights.join(' ')
                : (typeof item.highlights === 'string' ? item.highlights : '');
            const combinedText = `${snippet} ${highlightsStr}`.trim();

            let price = null;
            if (item.price !== undefined && item.price !== null) {
                const parsePriceFn = _normalizer?.parseCandidatePrice || ((val) => Number(val) || null);
                price = parsePriceFn(item.price);
            }
            if (!price) {
                price = this.extractPrice(combinedText, origPrice);
            }

            // Ekstraksi Gambar dari metadata hasil Exa (ADR-11 / CR-004B)
            let imageUrl = null;
            const candidateImg = item.image
                || (Array.isArray(item.extras?.imageLinks) && item.extras.imageLinks[0])
                || item.extras?.image
                || item.extras?.ogImage
                || item.ogImage
                || (item.extras?.openGraph && item.extras.openGraph['og:image'])
                || (item.openGraph && item.openGraph.image)
                || null;

            if (typeof candidateImg === 'string') {
                let cleanImg = candidateImg.trim();
                if (cleanImg.startsWith('//')) cleanImg = 'https:' + cleanImg;
                if (cleanImg.startsWith('http://')) cleanImg = 'https://' + cleanImg.slice(7);
                if (/^https:\/\//i.test(cleanImg)) {
                    imageUrl = cleanImg;
                }
            }

            // Ekstraksi fallback dari cuplikan teks/highlights jika mengandung tag <img> atau meta tag og:image (CR-005)
            if (!imageUrl && combinedText) {
                const imgTagMatch = combinedText.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i)
                    || combinedText.match(/<meta[^>]+property=["']og:image["'][^>]+content=["'](https?:\/\/[^"']+)["']/i);
                if (imgTagMatch && imgTagMatch[1]) {
                    imageUrl = imgTagMatch[1].trim();
                }
            }

            pdpCandidates.push({
                title: item.title || 'Tanpa Judul',
                url: item.url,
                snippet: snippet.length > 250 ? snippet.substring(0, 250) + '...' : snippet,
                marketplace: classification.marketplace,
                price: price,
                imageUrl: imageUrl,
                raw: item
            });
        }

        // 5. Filter Kualitas Lapis 2: Gatekeeper 3 Lapis
        const isCatMatchFn = _gatekeeper?.isCategoryMatch || (() => true);
        const aiData = options.aiData || null;

        const verifiedCandidates = pdpCandidates.filter(c => {
            return isCatMatchFn(c.title, aiData, rawProduct, c.price);
        });

        // Simpan Telemetry Audit untuk konsol & diagnosis (CR-006)
        const countByMarketplace = (items, getMarket) => {
            const counts = { shopee: 0, tokopedia: 0, lazada: 0, blibli: 0 };
            for (const it of items) {
                const m = (getMarket(it) || '').toLowerCase();
                for (const k of Object.keys(counts)) {
                    if (m.includes(k)) counts[k]++;
                }
            }
            return counts;
        };

        const classifyForAudit = (u) => {
            const low = (u || '').toLowerCase();
            if (low.includes('shopee')) return 'shopee';
            if (low.includes('tokopedia')) return 'tokopedia';
            if (low.includes('lazada')) return 'lazada';
            if (low.includes('blibli')) return 'blibli';
            return 'other';
        };

        this.lastSearchAudit = {
            query: query,
            tierQueries: [query],
            rawPerMarketplace: countByMarketplace(rawResults, it => classifyForAudit(it.url)),
            pdpFilterPassed: countByMarketplace(pdpCandidates, it => it.marketplace || classifyForAudit(it.url)),
            gatekeeperPassed: countByMarketplace(verifiedCandidates, it => it.marketplace || classifyForAudit(it.url))
        };

        return verifiedCandidates;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ExaProvider };
}
if (typeof window !== 'undefined') {
    window.ExaProvider = ExaProvider;
}
