/**
 * extension/shared/gatekeeper.js
 * 
 * Gatekeeper v2 & Multi-Layer Hard Negative Filtering (ADR-13).
 * Memfilter kandidat produk secara deterministik agar tidak melenceng dari jenis fisik produk asli.
 * 
 * Lapisan:
 * 0. Promo Stripping & Head-Noun Lock (Membersihkan promo & mengunci 3 token pertama)
 * 1. Prepositional Guard (Menolak frasa pelengkap seperti "untuk kasur", "buat laptop")
 * 1.5 Smart Dominance & Banned Terms Filter
 * 2. Core Keywords Check (Wajib mengandung entitas utama produk)
 * 3. Price Plausibility Guard (Price floor 30% untuk produk >= Rp 100.000)
 * 4. Batch LLM Adjudication untuk Zona Abu-Abu (skor kemiripan 0.40 - 0.69)
 */

const ACCESSORY_HEAD_NOUNS = new Set([
    'sprei', 'seprei', 'bedcover', 'bed cover', 'bantal', 'guling', 'sarung', 'cover',
    'pelindung', 'tas', 'sleeve', 'case', 'casing', 'charger', 'adaptor', 'kabel',
    'bracket', 'caddy', 'stand', 'cooler', 'cooling pad', 'stiker', 'skin',
    'tempered glass', 'antigores', 'anti gores', 'keycaps', 'keycap', 'mousepad', 'mouse pad'
]);

const STOP_WORDS_PROMO = new Set([
    'promo', 'diskon', 'murah', 'cod', 'terlaris', 'gratis', 'ongkir', 'terbaru',
    'ready', 'stock', 'bisa', 'termurah', 'original', 'ori', 'garansi', 'resmi',
    'sale', 'seller', 'terpercaya', 'cashback', 'voucher', 'dan', 'di', 'ke', 'dari'
]);

/**
 * Membersihkan awalan promosi dan kurung/tag pada judul produk (ADR-13 / Layer 0)
 * @param {string} title 
 * @returns {string}
 */
function stripPromoPrefix(title) {
    if (!title || typeof title !== 'string') return '';
    let cleaned = title.trim();
    let prev = '';
    while (cleaned !== prev) {
        prev = cleaned;
        cleaned = cleaned
            .replace(/^\[[^\]]*\]\s*/i, '')
            .replace(/^\([^\)]*\)\s*/i, '')
            .replace(/^\{[^\}]*\}\s*/i, '')
            .replace(/^(?:promo|diskon|murah|cod|terlaris|gratis\s+ongkir(?:\s+ekstra)?|terbaru|flash\s+sale|ready(?:\s+stock)?|bisa\s+cod|termurah|original|ori|garansi(?:\s+resmi)?|resmi|cuci\s+gudang|sale|best\s+seller|terpercaya|cashback|voucher)\b[\s:!\-_/]*/gi, '')
            .trim();
    }
    return cleaned;
}

/**
 * Menghitung koefisien kemiripan token Jaccard antara dua judul
 * @param {string} titleA 
 * @param {string} titleB 
 * @returns {number} 0.0 s/d 1.0
 */
function computeTokenSimilarity(titleA, titleB) {
    if (!titleA || !titleB) return 0;
    const tokensA = new Set(titleA.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !STOP_WORDS_PROMO.has(t)));
    const tokensB = new Set(titleB.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !STOP_WORDS_PROMO.has(t)));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensB) {
        if (tokensA.has(t)) intersection++;
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    return union > 0 ? intersection / union : 0;
}

/**
 * Memeriksa kesesuaian kategori kandidat produk terhadap produk referensi (Gatekeeper v2)
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
    const category = (aiData?.category || '').trim().toLowerCase();
    const isKasurCategory = category === 'kasur' || category.includes('kasur') || isMattress;

    // =========================================================================
    // LAYER 0A: Strict Kasur Category Accessory Guard (CR-005)
    // Jika aiData.category adalah "Kasur" (atau produk acuan kasur/springbed),
    // tolak mutlak kandidat yang memuat "Sprei", "Bantal", "Guling", "Bed Cover"
    // kecuali terdapat kata penanda "Bonus/Gratis".
    // =========================================================================
    if (isKasurCategory) {
        const KASUR_ACCESSORY_REGEX = /\b(sprei|seprei|seprai|bantal|guling|bed\s*cover|bedcover)\b/i;
        if (KASUR_ACCESSORY_REGEX.test(candTitle)) {
            const origHasAccessory = KASUR_ACCESSORY_REGEX.test(origTitle);
            if (!origHasAccessory) {
                const hasBonus = /\b(bonus|gratis|free|\+|plus|include|termasuk|dapat|hadiah)\b/i.test(candTitle);
                if (!hasBonus) {
                    return false;
                }
            }
        }
    }

    // =========================================================================
    // LAYER 0: Promo Stripping & Head-Noun Lock (ADR-13)
    // =========================================================================
    const strippedTitle = stripPromoPrefix(candidateTitle);
    const headTokens = strippedTitle.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
    const bigram01 = headTokens.length >= 2 ? `${headTokens[0]} ${headTokens[1]}` : '';
    const bigram12 = headTokens.length >= 3 ? `${headTokens[1]} ${headTokens[2]}` : '';

    const isAccessoryInHead = headTokens.some(t => ACCESSORY_HEAD_NOUNS.has(t))
        || ACCESSORY_HEAD_NOUNS.has(bigram01)
        || ACCESSORY_HEAD_NOUNS.has(bigram12);

    if (isAccessoryInHead) {
        // Periksa apakah produk referensi aslinya memang aksesoris tersebut
        const origHasSameAccessory = Array.from(ACCESSORY_HEAD_NOUNS).some(acc => {
            return (headTokens.includes(acc) || bigram01 === acc || bigram12 === acc) && origTitle.includes(acc);
        });

        if (!origHasSameAccessory) {
            // Tolak mutlak karena fokus awal produk (head-noun) adalah aksesoris
            return false;
        }
    }

    // =========================================================================
    // LAYER 1 & 1.5: Prepositional Guard & Banned Terms (ADR-13)
    // =========================================================================
    const PREPOSITIONAL_GUARD_REGEX = /\b(untuk|buat|khusus|pelindung|pengganti|sarung|cover|aksesoris)\s+(kasur|springbed|spring\s+bed|laptop|macbook|hp|smartphone|ram)\b/i;
    if (PREPOSITIONAL_GUARD_REGEX.test(candTitle)) {
        if (!PREPOSITIONAL_GUARD_REGEX.test(origTitle)) {
            const hasBonus = /\b(bonus|gratis|free|\+|plus|include|termasuk|dapat|hadiah)\b/i.test(candTitle);
            const isPureAccessoryPhrase = /^(set\s+|paket\s+|aneka\s+)?(bantal|guling|sprei|seprai|cover|sarung|tas|charger|casing)\b/i.test(strippedTitle);
            if (isPureAccessoryPhrase || !hasBonus) {
                return false;
            }
        }
    }

    // Ekstrak Daftar Kata Terlarang (Banned / Negative Terms)
    const bannedSet = new Set();
    if (aiData?.banned_terms && Array.isArray(aiData.banned_terms)) {
        const accessoryTerms = ['bantal', 'guling', 'cover', 'sprei', 'seprai', 'sarung', 'bed cover', 'bedcover'];
        aiData.banned_terms.forEach(term => {
            if (typeof term === 'string' && term.trim()) {
                const cleanTerm = term.trim().toLowerCase();
                if (isMattress && accessoryTerms.includes(cleanTerm)) {
                    return;
                }
                bannedSet.add(cleanTerm);
            }
        });
    }

    // Kamus Aturan Negatif Bawaan
    if (isMattress) {
        const bedBanned = ['angin', 'tiup', 'air mattress', 'air bed', 'inflatable', 'pompa'];
        bedBanned.forEach(b => bannedSet.add(b));
    }

    if (origTitle.includes('laptop') || origTitle.includes('notebook') || origTitle.includes('macbook')) {
        const laptopBanned = [
            'tas', 'sleeve', 'case', 'skin', 'stand', 'cooler', 'cooling pad',
            'holder', 'charger', 'adaptor', 'keyboard protector', 'stiker', 'meja lipat'
        ];
        laptopBanned.forEach(b => bannedSet.add(b));
    }

    if (origTitle.includes('ram') || origTitle.includes('sodimm') || origTitle.includes('dimm')) {
        const ramBanned = ['caddy', 'enclosure', 'baut', 'kabel data', 'bracket', 'obeng'];
        ramBanned.forEach(b => bannedSet.add(b));
        if (origTitle.includes('laptop') || origTitle.includes('sodimm')) {
            if (candTitle.includes('longdimm') || (candTitle.includes('desktop') && !candTitle.includes('laptop'))) {
                return false;
            }
        }
    }

    if (origTitle.includes('hp') || origTitle.includes('smartphone') || origTitle.includes('iphone') || origTitle.includes('samsung galaxy')) {
        const phoneBanned = [
            'case', 'casing', 'silicone', 'tempered glass', 'antigores',
            'anti gores', 'charger', 'kabel data', 'holder', 'dus box', 'strap'
        ];
        phoneBanned.forEach(b => bannedSet.add(b));
    }

    if (origTitle.includes('mouse') && !origTitle.includes('mousepad')) {
        bannedSet.add('mousepad');
        bannedSet.add('mouse pad');
    }

    if (origTitle.includes('keyboard')) {
        bannedSet.add('keycaps');
        bannedSet.add('keycap');
        bannedSet.add('switch puller');
    }

    for (const banned of bannedSet) {
        const isWord = banned.includes(' ')
            ? candTitle.includes(banned)
            : new RegExp(`\\b${banned}\\b`, 'i').test(candTitle);

        if (isWord) {
            if (!origTitle.includes(banned)) {
                return false;
            }
        }
    }

    // Smart Dominance & Accessory Guard Khusus Kasur
    if (isMattress) {
        const hasCoreMattress = /\b(springbed|spring bed|kasur|matras)\b/i.test(candTitle);
        const hasBonus = /\b(bonus|gratis|free|\+|plus|include|termasuk|dapat|hadiah|set|paket)\b/i.test(candTitle);
        const startsWithAccessory = /^(bantal|guling|bed\s*cover|bedcover|sprei|seprai)\b/i.test(strippedTitle);
        const isCoverSheetOnly = /\b(cover\s+kasur|sarung\s+kasur|sprei\s+kasur|seprai\s+kasur|pelindung\s+kasur)\b/i.test(candTitle);

        if (startsWithAccessory || isCoverSheetOnly) {
            if (!hasCoreMattress || !hasBonus) {
                return false;
            }
        }
    }

    // =========================================================================
    // LAYER 2: Core Keywords Check (Entitas Utama Produk)
    // =========================================================================
    const coreKeywords = [];
    if (aiData?.core_keywords && Array.isArray(aiData.core_keywords) && aiData.core_keywords.length > 0) {
        aiData.core_keywords.forEach(k => {
            if (typeof k === 'string' && k.trim()) coreKeywords.push(k.trim().toLowerCase());
        });
    }

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
            const fallbackTokens = rawProduct.title.toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(t => t.length >= 3 && !STOP_WORDS_PROMO.has(t));
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

    // =========================================================================
    // LAYER 3: Price Plausibility Guard (Price Floor 30% - ADR-13)
    // =========================================================================
    if (candidatePrice && candidatePrice > 0 && origPrice > 0) {
        // Batas bawah kewajaran: 30% untuk harga produk acuan >= Rp 100.000, 20% untuk < Rp 100.000
        const minRatio = origPrice >= 100000 ? 0.30 : 0.20;
        if (candidatePrice < (origPrice * minRatio)) {
            return false;
        }
    }

    return true;
}

/**
 * Melakukan verifikasi batch LLM untuk kandidat di zona abu-abu (skor kemiripan 0.40 - 0.69) (Layer 4 / ADR-13)
 * @param {Array<object>} candidates 
 * @param {object} referenceProduct 
 * @param {object} [aiClient] 
 * @returns {Promise<Array<object>>}
 */
async function adjudicateCandidatesBatch(candidates, referenceProduct, aiClient = null) {
    if (!Array.isArray(candidates) || candidates.length === 0) return candidates || [];
    if (!referenceProduct || !aiClient || typeof aiClient.requestJson !== 'function') {
        return candidates;
    }

    const origTitle = referenceProduct.title || '';
    const greyZoneItems = [];

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const sim = computeTokenSimilarity(origTitle, c.title);
        c.tokenSimilarity = sim;
        if (sim >= 0.40 && sim <= 0.69) {
            greyZoneItems.push({ id: i, title: c.title });
        }
    }

    if (greyZoneItems.length === 0) {
        return candidates;
    }

    let groqKey = null;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
            const stored = await chrome.storage.local.get(['groqKey']);
            groqKey = stored?.groqKey || null;
        } catch (e) { }
    }

    if (!groqKey) {
        return candidates;
    }

    const prompt = `Anda adalah Strict Physical-Product Verification Gatekeeper.
Produk Referensi:
Judul: "${origTitle}"
Kategori: "${referenceProduct.category || ''}"

Daftar kandidat produk dalam zona verifikasi:
${JSON.stringify(greyZoneItems, null, 2)}

Tugas: Evaluasi apakah masing-masing kandidat adalah JENIS FISIK PRODUK YANG SAMA dengan produk referensi (misalnya sama-sama unit kasur/springbed, sama-sama unit laptop, sama-sama unit RAM).
TOLAK (isSamePhysicalType: false) jika kandidat hanyalah aksesoris, suku cadang, pelindung, sarung, atau kategori fisik yang berbeda.
Kembalikan HANYA format JSON valid berikut:
{
  "adjudications": [
    { "id": 0, "isSamePhysicalType": true, "reason": "..." }
  ]
}`;

    try {
        const res = await aiClient.requestJson(prompt, groqKey);
        if (res && Array.isArray(res.adjudications)) {
            const rejectedIds = new Set();
            for (const adj of res.adjudications) {
                if (adj.isSamePhysicalType === false) {
                    rejectedIds.add(adj.id);
                }
            }
            if (rejectedIds.size > 0) {
                return candidates.filter((_, idx) => !rejectedIds.has(idx));
            }
        }
    } catch (err) {
        console.warn('[Gatekeeper:adjudicateCandidatesBatch] LLM adjudication gagal, abaikan filter abu-abu:', err.message);
    }

    return candidates;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isCategoryMatch,
        stripPromoPrefix,
        computeTokenSimilarity,
        adjudicateCandidatesBatch,
        ACCESSORY_HEAD_NOUNS
    };
}
if (typeof window !== 'undefined') {
    window.Gatekeeper = {
        isCategoryMatch,
        stripPromoPrefix,
        computeTokenSimilarity,
        adjudicateCandidatesBatch,
        ACCESSORY_HEAD_NOUNS
    };
}
