const _gatekeeperModule = typeof require !== 'undefined' ? require('./gatekeeper.js') : null;
const _pdpClassifierModule = typeof require !== 'undefined'
    ? require('./pdp-url-classifier.js')
    : (typeof window !== 'undefined' ? window.PdpUrlClassifier : null);

class SearchClient {
    /**
     * Helper: Normalisasi teks spesifikasi dan unit ukuran
     */
    normalizeSpecText(text) {
        if (!text) return '';
        return text.toLowerCase()
            .replace(/(\d+)\s*(gb|tb|mb|ram|ghz|mhz|mah|watt|w|hz|core|inch|in)(\b|[^a-z0-9])/gi, '$1$2$3')
            .replace(/([a-z0-9]+)-([a-z0-9]+)/gi, '$1 $2')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Helper: Strict Category & Spec Gatekeeper
     * Memfilter kandidat produk agar tidak melenceng dari kategori asli (misal Springbed vs Matras Angin).
     * Menerapkan 3 Layer: Banned Terms, Core Keywords, dan Price Plausibility Guard.
     * Didelegasikan ke modul terpusat gatekeeper.js.
     * @param {string} candidateTitle - Judul kandidat produk alternatif
     * @param {object} aiData - Metadata pemahaman produk dari AI (category, core_keywords, banned_terms)
     * @param {object} rawProduct - Produk asli (title, price, dll)
     * @param {number|null} candidatePrice - Harga kandidat jika berhasil diekstrak
     * @returns {boolean}
     */
    isCategoryMatch(candidateTitle, aiData, rawProduct, candidatePrice = null) {
        if (_gatekeeperModule && typeof _gatekeeperModule.isCategoryMatch === 'function') {
            return _gatekeeperModule.isCategoryMatch(candidateTitle, aiData, rawProduct, candidatePrice);
        }
        if (typeof window !== 'undefined' && window.Gatekeeper && typeof window.Gatekeeper.isCategoryMatch === 'function') {
            return window.Gatekeeper.isCategoryMatch(candidateTitle, aiData, rawProduct, candidatePrice);
        }
        // Fallback jika gatekeeper.js belum terpasang
        return true;
    }

    /**
     * Helper legacy: kompatibel dengan pemanggil lama
     */
    matchesCategory(candidateTitle, originalTitle) {
        return this.isCategoryMatch(candidateTitle, null, { title: originalTitle });
    }

    /**
     * Helper: Ekstrak harga dari teks snippet secara akurat (CR-006: Multi-Pattern Price Parser)
     */
    extractPrice(text, referencePrice = 0) {
        if (!text || typeof text !== 'string') return null;

        const parsePriceFn = (typeof window !== 'undefined' && window.CandidateNormalizer?.parseCandidatePrice)
            || ((val) => {
                const digits = String(val).replace(/[^\d]/g, '');
                const num = parseInt(digits, 10);
                return !isNaN(num) && num >= 1000 ? num : null;
            });

        const foundPrices = [];

        // 1. Tangkap pola nominal Rupiah terstruktur (mendukung NBSP \u00a0 dan spasi)
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

        // 2. Tangkap pola JSON-LD / metadata tersembunyi di teks Exa: /"price"\s*:\s*"?(\d{4,9})"?/i
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

        // 3. Tangkap pola nominal Rupiah umum / raw digits
        const rawMatches = text.matchAll(/(?:Rp\.?|IDR)[\s\u00a0]*(\d{4,9})/gi);
        for (const m of rawMatches) {
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
     * Helper: Tentukan apakah link ini produk langsung (PDP) atau halaman sampah/etalase
     * Dilonggarkan agar tidak membuang link marketplace yang valid.
     */
    isDirectProduct(url, marketplace) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            const lowerUrl = url.toLowerCase();
            const pathname = parsed.pathname.toLowerCase();

            // 1. Buang hanya URL yang benar-benar pencarian, etalase, atau keranjang
            const obviousJunk = ['/find/', '/search', '?q=', '?keyword=', '/etalase', '/cart/'];
            if (obviousJunk.some(j => lowerUrl.includes(j))) {
                return false;
            }

            // 2. Tokopedia:
            if (lowerUrl.includes('tokopedia.com')) {
                const segments = pathname.split('/').filter(Boolean);
                // Toko / etalase biasanya hanya 1 segmen (misal tokopedia.com/tokoabc)
                if (segments.length < 2) return false;
                const blockedFirstSegments = ['discovery', 'cart', 'search', 'find', 'help', 'promo'];
                if (blockedFirstSegments.includes(segments[0])) return false;
                if (segments[1] === 'etalase') return false;
                return true;
            }

            // 3. Shopee:
            if (lowerUrl.includes('shopee.co.id')) {
                if (pathname.startsWith('/shop/') || pathname.startsWith('/buyer/')) return false;
                return true;
            }

            // 4. Lazada:
            if (lowerUrl.includes('lazada.co.id')) {
                if (pathname === '/' || pathname.startsWith('/tag/') || pathname.startsWith('/catalog/')) return false;
                return true;
            }

            // 5. Blibli / lainnya:
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Helper: Deteksi marketplace dari URL
     */
    getMarketplace(url) {
        if (!url) return 'Unknown';
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes('shopee')) return 'Shopee';
        if (lowerUrl.includes('tokopedia')) return 'Tokopedia';
        if (lowerUrl.includes('lazada')) return 'Lazada';
        if (lowerUrl.includes('blibli')) return 'Blibli';

        try {
            const host = new URL(url).hostname.replace(/^www\./i, '');
            return host || 'Unknown';
        } catch (e) {
            const cleaned = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
            return cleaned || 'Unknown';
        }
    }

    /**
     * Fungsi Utama: Mencari alternatif menggunakan Exa API
     */
    async searchAlternatives(rawProduct, aiData) {
        // Validasi koneksi internet pengguna
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            throw new Error("Koneksi internet terputus. Pastikan WiFi atau paket data Anda aktif.");
        }

        const { exaKey } = await chrome.storage.local.get(['exaKey']);
        if (!exaKey) {
            throw new Error("API Key Exa belum diisi. Silakan isi di menu Settings.");
        }

        // 1. Tentukan Query Pencarian (Defensive & Safe)
        let query = "";
        if (aiData && typeof aiData === 'object') {
            const rawAiQuery = aiData.clean_query || aiData.search_query;
            if (typeof rawAiQuery === 'string' && rawAiQuery.trim()) {
                query = rawAiQuery.trim();
                console.log("[EXA] Menggunakan AI Clean Query:", query);
            }
        }

        if (!query) {
            // Fallback: bersihkan judul produk asli
            const rawTitle = (rawProduct && typeof rawProduct.title === 'string') ? rawProduct.title : "";
            query = rawTitle
                .replace(/[^a-zA-Z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            console.log("[EXA] Fallback ke Raw Product Title:", query);
        }

        // Longgarkan query: hilangkan simbol aneh agar Exa tidak bingung
        query = query.replace(/[^\w\s]/gi, ' ').replace(/\s+/g, ' ').trim();

        if (!query || query.length < 2) {
            throw new Error("Judul produk atau query pencarian tidak valid untuk Exa API.");
        }

        console.log("[EXA] Mengirim Query:", query);

        // 2. Fetch ke Exa API dengan Partisi Per Marketplace (CR-006: 4 Panggilan Paralel Terpisah)
        const targetDomains = [
            'shopee.co.id',
            'tokopedia.com',
            'lazada.co.id',
            'blibli.com'
        ];

        const fetchDomain = async (domain) => {
            const res = await fetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'x-api-key': exaKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    type: 'auto',
                    numResults: 5,
                    includeDomains: [domain],
                    contents: {
                        text: { maxCharacters: 1200 },
                        highlights: { numSentences: 3 }
                    },
                    extras: { imageLinks: 1 }
                })
            });

            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    throw new Error("API Key Exa tidak valid. Periksa kembali di menu Settings.");
                }
                if (res.status === 429) {
                    throw new Error("Batas kuota Exa API tercapai (Rate Limit). Coba lagi nanti.");
                }
                throw new Error(`Exa API Error (${domain}): HTTP ${res.status}`);
            }

            return res.json();
        };

        let domainSettledResults;
        try {
            domainSettledResults = await Promise.allSettled(targetDomains.map(d => fetchDomain(d)));
        } catch (fetchError) {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                throw new Error("Koneksi internet terputus. Pastikan WiFi atau paket data Anda aktif.");
            }
            throw fetchError;
        }

        const rawResults = [];
        const seenUrls = new Set();

        for (const s of domainSettledResults) {
            if (s.status === 'fulfilled' && s.value && Array.isArray(s.value.results)) {
                for (const item of s.value.results) {
                    if (item && item.url && !seenUrls.has(item.url)) {
                        seenUrls.add(item.url);
                        rawResults.push(item);
                    }
                }
            } else if (s.status === 'rejected') {
                console.warn('[SearchClient] Partisi domain Exa gagal:', s.reason?.message);
            }
        }

        console.log("[EXA] Raw results terpartisi:", rawResults.length);

        if (rawResults.length === 0) {
            return [];
        }

        // 3. Parsing Hasil & Deduplikasi URL Kanonikal (ADR-12 / T4.14)
        const seenCanonUrls = new Set();
        const rawCandidates = [];
        const origPrice = rawProduct?.price || 0;

        for (const item of rawResults) {
            if (!item || !item.url) continue;
            const canonUrl = canonicalizeUrl(item.url);
            if (seenCanonUrls.has(canonUrl)) continue;
            seenCanonUrls.add(canonUrl);

            const marketplace = this.getMarketplace(item.url);
            const snippet = item.text || item.snippet || "";
            const highlightsStr = Array.isArray(item.highlights)
                ? item.highlights.join(' ')
                : (typeof item.highlights === 'string' ? item.highlights : '');
            const combinedText = `${snippet} ${highlightsStr}`.trim();

            let price = null;
            if (item.price !== undefined && item.price !== null) {
                const parsePriceFn = typeof window !== 'undefined' && window.CandidateNormalizer
                    ? window.CandidateNormalizer.parseCandidatePrice
                    : ((v) => Number(v) || null);
                price = parsePriceFn(item.price);
            }
            if (!price) {
                price = this.extractPrice(combinedText, origPrice);
            }

            const candidateImg = item.image
                || (Array.isArray(item.extras?.imageLinks) && item.extras.imageLinks[0])
                || item.extras?.image
                || item.extras?.ogImage
                || item.ogImage
                || (item.extras?.openGraph && item.extras.openGraph['og:image'])
                || (item.openGraph && item.openGraph.image)
                || null;
            let imageUrl = null;
            if (typeof candidateImg === 'string') {
                let cleanImg = candidateImg.trim();
                if (cleanImg.startsWith('//')) cleanImg = 'https:' + cleanImg;
                if (cleanImg.startsWith('http://')) cleanImg = 'https://' + cleanImg.slice(7);
                if (/^https:\/\//i.test(cleanImg)) {
                    imageUrl = cleanImg;
                }
            }

            // Fallback gambar dari cuplikan teks jika ada tag <img>
            if (!imageUrl && combinedText) {
                const imgTagMatch = combinedText.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i)
                    || combinedText.match(/<meta[^>]+property=["']og:image["'][^>]+content=["'](https?:\/\/[^"']+)["']/i);
                if (imgTagMatch && imgTagMatch[1]) {
                    imageUrl = imgTagMatch[1].trim();
                }
            }

            const isDirect = _pdpClassifierModule && typeof _pdpClassifierModule.isProductUrl === 'function'
                ? _pdpClassifierModule.isProductUrl(item.url)
                : this.isDirectProduct(item.url, marketplace);

            rawCandidates.push({
                title: item.title || "Tanpa Judul",
                url: item.url,
                canonicalUrl: canonUrl,
                snippet: snippet.length > 200 ? snippet.substring(0, 200) + "..." : snippet,
                marketplace: marketplace,
                imageUrl: imageUrl,
                isDirectProduct: isDirect,
                price: price
            });
        }

        // 4. Strict Filter: Direct Product (PDP) & Relevansi Kategori Multi-Layer
        const candidates = rawCandidates.filter(c => {
            if (!c.isDirectProduct) {
                console.log(`[EXA] Dibuang (bukan PDP langsung): ${c.url}`);
                return false;
            }
            if (!this.isCategoryMatch(c.title, aiData, rawProduct, c.price)) {
                console.log(`[EXA] Dibuang oleh Strict Gatekeeper: "${c.title}"`);
                return false;
            }
            return true;
        });

        console.log("[EXA] Filtered results:", candidates.length);
        return candidates;
    }
}

/**
 * Deduplikasi dan kanonikalisasi URL (mengabaikan parameter tracking ?spm=, ?src=, ?extParam=)
 * @param {string} url 
 * @returns {string}
 */
function canonicalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const u = new URL(url);
        const trackingParams = ['spm', 'src', 'extparam', 'track', 'wh_pid', 'scm', 'laz_token', 'click_id'];
        const toDelete = [];
        for (const [k] of u.searchParams.entries()) {
            const lowerK = k.toLowerCase();
            if (lowerK.startsWith('utm_') || trackingParams.includes(lowerK)) {
                toDelete.push(k);
            }
        }
        for (const k of toDelete) {
            u.searchParams.delete(k);
        }
        let pathname = u.pathname;
        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }
        const searchStr = u.searchParams.toString();
        return u.origin + pathname + (searchStr ? '?' + searchStr : '');
    } catch (e) {
        return url.split('?')[0].replace(/\/+$/, '');
    }
}

// UMD-Lite Pattern (ADR-02)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SearchClient, canonicalizeUrl };
}
if (typeof window !== 'undefined') {
    window.SearchClient = SearchClient;
    window.canonicalizeUrl = canonicalizeUrl;
}
