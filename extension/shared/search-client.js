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
     * @param {string} candidateTitle - Judul kandidat produk alternatif
     * @param {object} aiData - Metadata pemahaman produk dari AI (category, core_keywords, banned_terms)
     * @param {object} rawProduct - Produk asli (title, price, dll)
     * @param {number|null} candidatePrice - Harga kandidat jika berhasil diekstrak
     * @returns {boolean}
     */
    isCategoryMatch(candidateTitle, aiData, rawProduct, candidatePrice = null) {
        if (!candidateTitle) return false;
        const origTitle = (rawProduct?.title || '').toLowerCase();
        const candTitle = candidateTitle.toLowerCase();
        const origPrice = rawProduct?.price || 0;
        const isMattress = origTitle.includes('springbed') || origTitle.includes('spring bed') || origTitle.includes('kasur') || origTitle.includes('matras');

        // 1. Ekstrak Daftar Kata Terlarang (Banned / Negative Terms)
        const bannedSet = new Set();

        // Ambil dari aiData jika tersedia
        if (aiData?.banned_terms && Array.isArray(aiData.banned_terms)) {
            const accessoryTerms = ['bantal', 'guling', 'cover', 'sprei', 'seprai', 'sarung', 'bed cover', 'bedcover'];
            aiData.banned_terms.forEach(term => {
                if (typeof term === 'string' && term.trim()) {
                    const cleanTerm = term.trim().toLowerCase();
                    // Jangan masukkan aksesoris kasur ke bannedSet jika produk aslinya adalah kasur
                    if (isMattress && accessoryTerms.includes(cleanTerm)) {
                        return;
                    }
                    bannedSet.add(cleanTerm);
                }
            });
        }

        // Kamus Aturan Negatif Bawaan (Defensive Rules):
        // Kasur / Springbed / Bedding
        // CATATAN: "bantal", "cover", "sprei", "sarung", "guling", "dipan" DIHAPUS dari daftar banned global
        // agar kasur dengan bonus bantal/cover quilting tidak dibuang secara keliru.
        if (isMattress) {
            const bedBanned = [
                'angin', 'tiup', 'air mattress', 'air bed', 'inflatable', 'pompa'
            ];
            bedBanned.forEach(b => bannedSet.add(b));
        }

        // Laptop / Notebook
        if (origTitle.includes('laptop') || origTitle.includes('notebook') || origTitle.includes('macbook')) {
            const laptopBanned = [
                'tas', 'sleeve', 'case', 'skin', 'stand', 'cooler', 'cooling pad',
                'holder', 'charger', 'adaptor', 'keyboard protector', 'stiker', 'meja lipat'
            ];
            laptopBanned.forEach(b => bannedSet.add(b));
        }

        // RAM / Memory
        if (origTitle.includes('ram') || origTitle.includes('sodimm') || origTitle.includes('dimm')) {
            const ramBanned = ['caddy', 'enclosure', 'baut', 'kabel data', 'bracket', 'obeng'];
            ramBanned.forEach(b => bannedSet.add(b));
            // Jika RAM Laptop / SODIMM, buang RAM PC LongDIMM
            if (origTitle.includes('laptop') || origTitle.includes('sodimm')) {
                if (candTitle.includes('longdimm') || (candTitle.includes('desktop') && !candTitle.includes('laptop'))) {
                    return false;
                }
            }
        }

        // Smartphone / HP
        if (origTitle.includes('hp') || origTitle.includes('smartphone') || origTitle.includes('iphone') || origTitle.includes('samsung galaxy')) {
            const phoneBanned = [
                'case', 'casing', 'silicone', 'tempered glass', 'antigores',
                'anti gores', 'charger', 'kabel data', 'holder', 'dus box', 'strap'
            ];
            phoneBanned.forEach(b => bannedSet.add(b));
        }

        // Mouse
        if (origTitle.includes('mouse') && !origTitle.includes('mousepad')) {
            bannedSet.add('mousepad');
            bannedSet.add('mouse pad');
        }

        // Keyboard
        if (origTitle.includes('keyboard')) {
            bannedSet.add('keycaps');
            bannedSet.add('keycap');
            bannedSet.add('switch puller');
        }

        // LAYER 1: Banned Words Rejection
        for (const banned of bannedSet) {
            const isWord = banned.includes(' ')
                ? candTitle.includes(banned)
                : new RegExp(`\\b${banned}\\b`, 'i').test(candTitle);

            if (isWord) {
                // Pengecualian: jika judul asli sendiri mengandung kata itu (misal produk aslinya memang "Sofa Bed")
                if (!origTitle.includes(banned)) {
                    console.log(`[Gatekeeper] Ditolak oleh Banned Term: "${banned}" pada "${candidateTitle}"`);
                    return false;
                }
            }
        }

        // LAYER 1.5: Smart Dominance & Accessory Guard (Khusus Kasur / Bedding)
        // Mencegah lolosnya aksesoris murni (seperti Bantal Guling, Bed Cover, Sprei Kasur),
        // TETAPI WAJIB MELOLOSKAN produk kasur yang menyertakan bonus/gratis bantal/sprei.
        if (isMattress) {
            const hasCoreMattress = /\b(springbed|spring bed|kasur|matras)\b/i.test(candTitle);
            const hasBonus = /\b(bonus|gratis|free|\+|plus|include|termasuk|dapat|hadiah|set|paket)\b/i.test(candTitle);

            // Cek apakah judul kandidat murni diawali atau difokuskan pada aksesoris
            const startsWithAccessory = /^(bantal|guling|bed\s*cover|bedcover|sprei|seprai)\b/i.test(candTitle);
            const isCoverSheetOnly = /\b(cover\s+kasur|sarung\s+kasur|sprei\s+kasur|seprai\s+kasur|pelindung\s+kasur)\b/i.test(candTitle);

            if (startsWithAccessory || isCoverSheetOnly) {
                // Jika judul diawali nama aksesoris atau bertuliskan "cover kasur" tanpa indikasi penjualan kasur utama + bonus:
                if (!hasCoreMattress || !hasBonus) {
                    console.log(`[Gatekeeper] Ditolak (didominasi aksesoris): "${candidateTitle}"`);
                    return false;
                }
            }
        }

        // LAYER 2: Core Keywords Check (Wajib Mengandung Kata Kunci Entitas Utama)
        const coreKeywords = [];
        if (aiData?.core_keywords && Array.isArray(aiData.core_keywords) && aiData.core_keywords.length > 0) {
            aiData.core_keywords.forEach(k => {
                if (typeof k === 'string' && k.trim()) coreKeywords.push(k.trim().toLowerCase());
            });
        }

        // Fallback core keywords jika AI tidak mengembalikan
        if (coreKeywords.length === 0) {
            if (origTitle.includes('springbed') || origTitle.includes('spring bed')) {
                coreKeywords.push('springbed', 'spring bed', 'kasur');
            } else if (origTitle.includes('ram')) {
                coreKeywords.push('ram', 'sodimm', 'memory');
            } else if (origTitle.includes('laptop')) {
                coreKeywords.push('laptop', 'notebook', 'macbook');
            } else if (origTitle.includes('mouse')) {
                coreKeywords.push('mouse');
            } else if (origTitle.includes('keyboard')) {
                coreKeywords.push('keyboard');
            } else if (rawProduct?.title) {
                // Ekstrak token esensial dari judul asli jika AI offline
                const fallbackTokens = rawProduct.title.toLowerCase()
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .split(/\s+/)
                    .filter(t => t.length >= 3 && !['promo', 'murah', 'diskon', 'terlaris', 'original', 'asli', 'garansi', 'resmi', 'jual', 'ready', 'bisa', 'cod', 'gratis', 'ongkir', 'dan', 'di', 'ke', 'dari', 'untuk'].includes(t));
                if (fallbackTokens.length > 0) {
                    coreKeywords.push(...fallbackTokens.slice(0, 3));
                }
            }
        }

        if (coreKeywords.length > 0) {
            const hasCoreMatch = coreKeywords.some(kw => {
                return kw.includes(' ')
                    ? candTitle.includes(kw)
                    : new RegExp(`\\b${kw}\\b`, 'i').test(candTitle);
            });

            if (!hasCoreMatch) {
                console.log(`[Gatekeeper] Ditolak (tidak mengandung Core Keyword "${coreKeywords.join(', ')}"): "${candidateTitle}"`);
                return false;
            }
        }

        // LAYER 3: Price Plausibility Check (Batas Bawah Anomali Harga Aksesoris)
        // Jika harga kandidat diketahui dan harga produk asli > Rp 50.000
        if (candidatePrice && candidatePrice > 0 && origPrice >= 50000) {
            // Jika harga kandidat < 20% dari harga asli, kemungkinan 99% adalah aksesoris/palsu
            if (candidatePrice < (origPrice * 0.20)) {
                console.log(`[Gatekeeper] Ditolak oleh Price Sanity Guard: Rp ${candidatePrice} vs Rp ${origPrice} (< 20%) pada "${candidateTitle}"`);
                return false;
            }
        }

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
