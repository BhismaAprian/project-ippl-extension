/**
 * extension/shared/query-builder.js
 * 
 * Membangun query pencarian bertingkat (Tier 1, Tier 2, Tier 3) dan istilah negatif per kategori.
 * Dijamin TIDAK PERNAH mengembalikan query kosong, bahkan untuk input minimal/rusak.
 */

const STOP_WORDS_MARKETING = new Set([
    'promo', 'murah', 'diskon', 'terlaris', 'original', 'asli', 'garansi', 'resmi',
    'jual', 'ready', 'bisa', 'cod', 'gratis', 'ongkir', 'voucher', 'cashback',
    'flash', 'sale', 'new', 'terbaru', 'best', 'seller', 'dan', 'di', 'ke', 'dari',
    'untuk', 'dengan', 'tanpa', 'termurah', 'ori', 'terpercaya', 'berkualitas'
]);

const NEGATIVE_TERMS_BY_CATEGORY = {
    laptop: [
        '-tas', '-sleeve', '-case', '-skin', '-stand', '-cooler',
        '-charger', '-adaptor', '-keyboard protector', '-stiker'
    ],
    ram: [
        '-caddy', '-enclosure', '-baut', '-bracket', '-obeng'
    ],
    kasur: [
        '-angin', '-tiup', '-pompa', '-cover', '-sprei', '-seprai', '-sarung', '-pelindung'
    ],
    smartphone: [
        '-case', '-casing', '-silicone', '-tempered glass', '-antigores',
        '-charger', '-kabel data', '-dus box', '-strap'
    ]
};

/**
 * Membersihkan string teks dari simbol aneh dan spasi berlebih
 * @param {string} str 
 * @returns {string}
 */
function cleanText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/[^\w\s-]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Membersihkan judul produk mentah dari kata-kata marketing sampah
 * @param {string} rawTitle 
 * @returns {string}
 */
function cleanTitle(rawTitle) {
    if (!rawTitle || typeof rawTitle !== 'string') return '';
    const words = rawTitle.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !STOP_WORDS_MARKETING.has(w));
    return cleanText(words.slice(0, 7).join(' '));
}

/**
 * Mengurai keySpecs dari berbagai kemungkinan format (object, array, string)
 * @param {object|Array|string} keySpecsInput 
 * @returns {Array<string>}
 */
function extractSpecsList(keySpecsInput) {
    if (!keySpecsInput) return [];

    if (Array.isArray(keySpecsInput)) {
        return keySpecsInput
            .filter(Boolean)
            .map(s => cleanText(String(s)))
            .filter(Boolean);
    }

    if (typeof keySpecsInput === 'object') {
        return Object.values(keySpecsInput)
            .filter(Boolean)
            .map(s => cleanText(String(s)))
            .filter(Boolean);
    }

    if (typeof keySpecsInput === 'string') {
        return cleanText(keySpecsInput).split(/\s+/).filter(Boolean);
    }

    return [];
}

/**
 * Mengidentifikasi kategori normalisasi untuk negative terms
 * @param {string} category 
 * @param {string} textContext 
 * @returns {string|null}
 */
function detectCategoryKey(category, textContext = '') {
    const combined = `${category || ''} ${textContext || ''}`.toLowerCase();
    if (combined.includes('laptop') || combined.includes('notebook') || combined.includes('macbook')) {
        return 'laptop';
    }
    if (combined.includes('ram') || combined.includes('memory') || combined.includes('sodimm') || combined.includes('longdimm')) {
        return 'ram';
    }
    if (combined.includes('kasur') || combined.includes('springbed') || combined.includes('spring bed') || combined.includes('matras') || combined.includes('bedding')) {
        return 'kasur';
    }
    if (combined.includes('smartphone') || combined.includes('hp') || combined.includes('ponsel') || combined.includes('iphone') || combined.includes('galaxy')) {
        return 'smartphone';
    }
    return null;
}

/**
 * Membangun query pencarian bertingkat dan daftar kata negatif
 * 
 * @param {object} productFingerprint - { brand, model, category, keySpecs, title }
 * @returns {{ tier1: string, tier2: string, tier3: string, negatives: Array<string> }}
 */
function buildQueries(productFingerprint) {
    const fp = (productFingerprint && typeof productFingerprint === 'object') ? productFingerprint : {};

    const brand = cleanText(fp.brand);
    const model = cleanText(fp.model);
    const category = cleanText(fp.category);
    const titleCleaned = cleanTitle(fp.title);
    const specs = extractSpecsList(fp.keySpecs);

    const allSpecsStr = specs.join(' ');
    const mainSpecsStr = specs.slice(0, 2).join(' ');

    let tier1 = '';
    let tier2 = '';
    let tier3 = '';

    // Kasus 1: Brand & Model tersedia (Ideal)
    if (brand && model) {
        tier1 = cleanText(`${brand} ${model} ${allSpecsStr}`);
        tier2 = cleanText(`${brand} ${model} ${mainSpecsStr}`);
        tier3 = cleanText(`${brand} ${category || ''} ${mainSpecsStr}`);
    } else if (brand) {
        // Kasus 2: Model kosong, hanya Brand
        const fallbackAnchor = titleCleaned || category || 'produk';
        tier1 = cleanText(`${brand} ${fallbackAnchor} ${allSpecsStr}`);
        tier2 = cleanText(`${brand} ${fallbackAnchor}`);
        tier3 = cleanText(`${brand} ${category || 'produk'}`);
    } else {
        // Kasus 3: Brand & Model kosong (Fallback Judul / Kategori)
        const baseQuery = titleCleaned || category || 'produk';
        tier1 = cleanText(`${baseQuery} ${allSpecsStr}`);
        tier2 = cleanText(`${baseQuery} ${mainSpecsStr}`);
        tier3 = cleanText(baseQuery);
    }

    // Jaminan Absolut: Query tidak pernah kosong
    const ultimateFallback = titleCleaned || category || 'produk';
    if (!tier1) tier1 = ultimateFallback;
    if (!tier2) tier2 = tier1;
    if (!tier3) tier3 = tier2;

    // Ambil negative terms berdasarkan kategori
    const catKey = detectCategoryKey(category, `${brand} ${model} ${fp.title || ''}`);
    const negatives = catKey && NEGATIVE_TERMS_BY_CATEGORY[catKey]
        ? [...NEGATIVE_TERMS_BY_CATEGORY[catKey]]
        : [];

    return {
        tier1,
        tier2,
        tier3,
        negatives
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildQueries,
        cleanText,
        cleanTitle,
        NEGATIVE_TERMS_BY_CATEGORY
    };
}
if (typeof window !== 'undefined') {
    window.QueryBuilder = {
        buildQueries,
        cleanText,
        cleanTitle,
        NEGATIVE_TERMS_BY_CATEGORY
    };
}
