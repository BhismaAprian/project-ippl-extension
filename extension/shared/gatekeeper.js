/**
 * extension/shared/gatekeeper.js
 * 
 * Strict Category & Spec Gatekeeper 3 Lapis.
 * Memfilter kandidat produk agar tidak melenceng dari kategori asli
 * (misal Springbed vs Matras Angin, atau RAM vs Caddy).
 * 
 * Lapisan:
 * 1. Banned Terms Filter (Negative terms per kategori)
 * 1.5 Smart Dominance & Accessory Guard (Pencegahan aksesoris murni vs bonus)
 * 2. Core Keywords Check (Wajib mengandung entitas utama produk)
 * 3. Price Plausibility Guard (Batas bawah 20% dari harga asli)
 */

/**
 * Memeriksa kesesuaian kategori kandidat produk terhadap produk referensi
 * @param {string} candidateTitle - Judul kandidat produk alternatif
 * @param {object} [aiData] - Metadata pemahaman produk dari AI (category, core_keywords, banned_terms)
 * @param {object} [rawProduct] - Produk asli (title, price, dll)
 * @param {number|null} [candidatePrice=null] - Harga kandidat jika berhasil diekstrak
 * @returns {boolean} True jika lolos gatekeeper, False jika ditolak
 */
function isCategoryMatch(candidateTitle, aiData = null, rawProduct = null, candidatePrice = null) {
    if (!candidateTitle || typeof candidateTitle !== 'string') return false;

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
            return false;
        }
    }

    // LAYER 3: Price Plausibility Check (Batas Bawah Anomali Harga Aksesoris)
    // Jika harga kandidat diketahui dan harga produk asli >= Rp 50.000
    if (candidatePrice && candidatePrice > 0 && origPrice >= 50000) {
        // Jika harga kandidat < 20% dari harga asli, kemungkinan 99% adalah aksesoris/palsu
        if (candidatePrice < (origPrice * 0.20)) {
            return false;
        }
    }

    return true;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isCategoryMatch };
}
if (typeof window !== 'undefined') {
    window.Gatekeeper = { isCategoryMatch };
}
