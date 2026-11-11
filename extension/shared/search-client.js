const _gatekeeperModule = typeof require !== 'undefined' ? require('./gatekeeper.js') : null;

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
     * Helper: Ekstrak harga dari teks snippet secara akurat
     */
    extractPrice(text) {
        if (!text) return null;
        const matches = text.matchAll(/(?:Rp|IDR)\s*([\d\.,]+)/gi);
        const validPrices = [];

        for (const match of matches) {
            if (match && match[1]) {
                const cleanNumber = match[1].replace(/[.,]/g, '');
                const num = parseInt(cleanNumber, 10);
                // Hanya terima harga masuk akal (> 1.000 IDR) untuk menyaring potongan diskon kecil/token palsu
                if (!isNaN(num) && num >= 1000) {
                    validPrices.push(num);
                }
            }
        }

        if (validPrices.length === 0) return null;
        return validPrices[0];
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

        // 2. Fetch ke Exa API dengan error handling komprehensif
        let response;
        try {
            response = await fetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'x-api-key': exaKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    numResults: 30,
                    type: "auto",
                    includeDomains: ["shopee.co.id", "tokopedia.com", "lazada.co.id", "blibli.com"],
                    contents: {
                        text: { maxCharacters: 500 }
                    }
                })
            });
        } catch (fetchError) {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                throw new Error("Koneksi internet terputus. Pastikan WiFi atau paket data Anda aktif.");
            }
            if (fetchError && (fetchError.message?.includes('Failed to fetch') || fetchError.name === 'TypeError')) {
                throw new Error("Gagal terhubung ke layanan Exa. Periksa koneksi internet Anda.");
            }
            throw fetchError;
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error("API Key Exa tidak valid. Periksa kembali di menu Settings.");
            }
            if (response.status === 429) {
                throw new Error("Batas kuota Exa API tercapai (Rate Limit). Coba lagi nanti.");
            }
            throw new Error(`Exa API Error: HTTP ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log("[EXA] Raw results:", (data.results && data.results.length) || 0);

        if (!data.results || !Array.isArray(data.results)) {
            console.warn("[EXA] Format response tidak valid atau kosong.");
            return [];
        }

        // 3. Parsing Hasil (Kandidat tetap disimpan meski harga belum terdeteksi)
        const rawCandidates = data.results.map(item => {
            const marketplace = this.getMarketplace(item.url);
            const snippet = item.text || item.snippet || "";
            return {
                title: item.title || "Tanpa Judul",
                url: item.url,
                snippet: snippet.length > 200 ? snippet.substring(0, 200) + "..." : snippet,
                marketplace: marketplace,
                isDirectProduct: this.isDirectProduct(item.url, marketplace),
                price: this.extractPrice(snippet)
            };
        });

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

window.SearchClient = SearchClient;
