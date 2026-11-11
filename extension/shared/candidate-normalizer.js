/**
 * extension/shared/candidate-normalizer.js
 * 
 * Menyeragamkan kandidat produk dari berbagai sumber (Native Search, Exa Fallback, dsb.)
 * ke dalam satu struktur seragam (Unified Candidate Schema).
 * Kandidat yang tidak valid atau gagal diekstrak harganya akan otomatis dibuang (return null).
 */

/**
 * Helper: Sanitasi dan parsing harga produk ke integer IDR murni.
 * Mendukung format angka langsung, rupiah teks, singkatan "jt"/"m", dan micro-unit Shopee.
 * @param {number|string} priceInput 
 * @returns {number|null} Nilai integer harga atau null jika gagal/tidak valid
 */
function parseCandidatePrice(priceInput) {
    if (priceInput === null || priceInput === undefined || priceInput === '') {
        return null;
    }

    // Kasus 1: Input berupa angka langsung
    if (typeof priceInput === 'number') {
        if (isNaN(priceInput) || priceInput <= 0) return null;
        // Penanganan micro-unit (misal Shopee menyimpan Rp 8.499.000 sebagai 849900000000)
        if (priceInput > 100000000) {
            priceInput = Math.round(priceInput / 100000);
        }
        return priceInput >= 100 ? Math.round(priceInput) : null;
    }

    if (typeof priceInput !== 'string') {
        return null;
    }

    let clean = priceInput.trim().toLowerCase();
    if (!clean) return null;

    // Kasus 2: Format singkatan "jt" atau "juta" (misal: "1.5 jt", "2,5 juta", "Rp 1.5jt")
    const jtMatch = clean.match(/(?:rp|idr)?\s*(\d+(?:[.,]\d+)?)\s*(?:jt|juta)\b/i);
    if (jtMatch && jtMatch[1]) {
        const floatVal = parseFloat(jtMatch[1].replace(',', '.'));
        if (!isNaN(floatVal) && floatVal > 0) {
            return Math.round(floatVal * 1000000);
        }
    }

    // Kasus 3: Format singkatan "m" atau "miliar" (misal: "1.2 m", "1,5 miliar")
    const mMatch = clean.match(/(?:rp|idr)?\s*(\d+(?:[.,]\d+)?)\s*(?:m|miliar)\b/i);
    if (mMatch && mMatch[1]) {
        const floatVal = parseFloat(mMatch[1].replace(',', '.'));
        if (!isNaN(floatVal) && floatVal > 0) {
            return Math.round(floatVal * 1000000000);
        }
    }

    // Kasus 4: Format standar mata uang (misal: "Rp 8.499.000", "Rp8.499.000,-", "8,499,000")
    // Bersihkan prefix mata uang dan suffix sen/garis
    clean = clean.replace(/^(?:rp|idr)\s*/i, '');
    clean = clean.replace(/([.,]00|,-)\s*$/i, '');

    // Ambil deretan angka beserta titik/koma pemisah
    const numberMatches = clean.match(/[\d.,]+/g);
    if (!numberMatches || numberMatches.length === 0) {
        return null;
    }

    // Gabungkan jika ada spasi di antara digit
    const rawNumberStr = numberMatches.join('');
    // Hapus seluruh pemisah ribuan titik dan koma
    const digitsOnly = rawNumberStr.replace(/[.,]/g, '');

    const num = parseInt(digitsOnly, 10);
    if (isNaN(num) || num <= 0) {
        return null;
    }

    // Penanganan micro-unit
    let finalPrice = num;
    if (finalPrice > 100000000) {
        finalPrice = Math.round(finalPrice / 100000);
    }

    // Saring nilai nominal tidak masuk akal (harga < Rp 100)
    if (finalPrice < 100) {
        return null;
    }

    return finalPrice;
}

/**
 * Helper: Sanitasi dan parsing rating produk (rentang 0 - 5)
 * @param {number|string} ratingInput 
 * @returns {number|null}
 */
function parseCandidateRating(ratingInput) {
    if (ratingInput === null || ratingInput === undefined || ratingInput === '') {
        return null;
    }
    const val = typeof ratingInput === 'number' ? ratingInput : parseFloat(String(ratingInput).replace(',', '.'));
    if (isNaN(val) || val <= 0) return null;
    return Math.min(5, Math.max(0, Math.round(val * 10) / 10));
}

/**
 * Normalisasi objek kandidat ke dalam Unified Candidate Schema.
 * Menjamin integritas field wajib. Jika price gagal di-parse, return null (kandidat dibuang).
 * 
 * @param {object} raw - Data mentah produk dari scraper/search result
 * @param {string} source - Marketplace sumber ('shopee' | 'tokopedia' | 'lazada' | 'blibli')
 * @param {string} provenance - Asal pencarian ('native-assisted' | 'exa-fallback' | 'official-api' | 'indonesia-scraper-api')
 * @returns {object|null} NormalizedCandidate atau null jika data tidak valid
 */
function normalizeCandidate(raw, source, provenance) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    if (!source || typeof source !== 'string' || !source.trim()) {
        return null;
    }

    if (!provenance || typeof provenance !== 'string' || !provenance.trim()) {
        return null;
    }

    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!url) {
        return null;
    }

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) {
        return null;
    }

    // Parsing dan validasi harga (wajib valid, jika gagal kandidat dibuang)
    const price = parseCandidatePrice(raw.price);
    if (price === null) {
        return null;
    }

    const rating = parseCandidateRating(raw.rating);
    const shopName = (typeof raw.shopName === 'string' && raw.shopName.trim())
        || (typeof raw.shop_name === 'string' && raw.shop_name.trim())
        || (typeof raw.seller === 'string' && raw.seller.trim())
        || null;

    const itemId = (raw.itemId && String(raw.itemId).trim())
        || (raw.item_id && String(raw.item_id).trim())
        || (raw.id && String(raw.id).trim())
        || null;

    const imageUrl = (typeof raw.imageUrl === 'string' && raw.imageUrl.trim())
        || (typeof raw.image_url === 'string' && raw.image_url.trim())
        || (typeof raw.image === 'string' && raw.image.trim())
        || null;

    const observedAt = (typeof raw.observedAt === 'string' && raw.observedAt.trim())
        || new Date().toISOString();

    const matchScore = typeof raw.matchScore === 'number' && !isNaN(raw.matchScore)
        ? Math.min(100, Math.max(0, Math.round(raw.matchScore)))
        : 0;

    const matchType = (typeof raw.matchType === 'string' && raw.matchType.trim())
        || 'UNKNOWN';

    return {
        source: source.trim().toLowerCase(),
        provenance: provenance.trim(),
        url: url,
        title: title,
        price: price,
        rating: rating,
        shopName: shopName,
        itemId: itemId,
        imageUrl: imageUrl,
        observedAt: observedAt,
        matchScore: matchScore,
        matchType: matchType,
        raw: raw
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeCandidate,
        parseCandidatePrice,
        parseCandidateRating
    };
}
if (typeof window !== 'undefined') {
    window.CandidateNormalizer = {
        normalizeCandidate,
        parseCandidatePrice,
        parseCandidateRating
    };
}
