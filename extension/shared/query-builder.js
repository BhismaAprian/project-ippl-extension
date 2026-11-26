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
 * Kamus sinonim dan normalisasi lokal Indonesia (ADR-12 / T4.13)
 */
const SYNONYM_DICTIONARY = [
    // Ukuran kasur / springbed
    { pattern: /\b(?:160\s*x\s*200|160x200)\b/i, variants: ['queen', 'no 2', 'nomor 2'] },
    { pattern: /\b(?:180\s*x\s*200|180x200)\b/i, variants: ['king', 'no 1', 'nomor 1'] },
    { pattern: /\b(?:120\s*x\s*200|120x200)\b/i, variants: ['super single', 'no 3', 'nomor 3'] },
    { pattern: /\b(?:200\s*x\s*200|200x200)\b/i, variants: ['super king', 'extra king'] },
    { pattern: /\bqueen\b/i, variants: ['160x200', 'no 2'] },
    { pattern: /\bking\b/i, variants: ['180x200', 'no 1'] },
    // Jenis kasur
    { pattern: /\bkasur\b/i, variants: ['springbed', 'matras'] },
    { pattern: /\bspringbed\b|\bspring\s+bed\b/i, variants: ['kasur', 'matras'] },
    // Komputer / RAM
    { pattern: /\bram\s+laptop\b/i, variants: ['ram sodimm', 'memory sodimm'] },
    { pattern: /\bram\s+sodimm\b/i, variants: ['ram laptop', 'memori sodimm'] },
    { pattern: /\blaptop\b/i, variants: ['notebook'] },
    { pattern: /\bnotebook\b/i, variants: ['laptop'] },
    // Smartphone
    { pattern: /\bsmartphone\b/i, variants: ['hp', 'ponsel'] },
    { pattern: /\bhp\b/i, variants: ['smartphone', 'handphone'] }
];

/**
 * Menghasilkan 2-3 kueri variasi semantik deterministik berbasis sinonim lokal dan penamaan marketplace
 * @param {object} productFingerprint 
 * @returns {Array<string>}
 */
function generateDeterministicVariants(productFingerprint) {
    const fp = (productFingerprint && typeof productFingerprint === 'object') ? productFingerprint : {};
    const brand = cleanText(fp.brand);
    const model = cleanText(fp.model);
    const category = cleanText(fp.category);
    const titleCleaned = cleanTitle(fp.title);
    const specs = extractSpecsList(fp.keySpecs);
    const mainSpecs = specs.slice(0, 2).join(' ');

    const baseAnchor = cleanText(`${brand} ${model || titleCleaned || category || 'produk'}`);
    const variantsSet = new Set();

    // 1. Coba substitusi aturan sinonim pada teks gabungan
    const textToMatch = `${baseAnchor} ${mainSpecs}`.toLowerCase();
    for (const rule of SYNONYM_DICTIONARY) {
        if (rule.pattern.test(textToMatch)) {
            for (const synonym of rule.variants) {
                const replaced = cleanText(textToMatch.replace(rule.pattern, synonym));
                if (replaced && replaced !== textToMatch) {
                    variantsSet.add(replaced);
                    if (variantsSet.size >= 3) break;
                }
            }
        }
        if (variantsSet.size >= 3) break;
    }

    // 2. Jika varian masih kurang dari 2, tambahkan variasi struktural umum
    if (variantsSet.size < 2) {
        if (brand && model) {
            if (category) variantsSet.add(cleanText(`${category} ${brand} ${model}`));
            if (mainSpecs) variantsSet.add(cleanText(`${brand} ${model} ${mainSpecs}`));
        } else if (titleCleaned) {
            variantsSet.add(cleanText(`${brand} ${titleCleaned}`));
            if (category) variantsSet.add(cleanText(`${category} ${titleCleaned}`));
        }
    }

    // 3. Fallback jika masih kosong
    if (variantsSet.size === 0) {
        variantsSet.add(baseAnchor || 'produk');
        if (mainSpecs) variantsSet.add(cleanText(`${baseAnchor} ${mainSpecs}`));
    }

    const result = Array.from(variantsSet).filter(v => v && v.length >= 2).slice(0, 3);
    return result;
}

/**
 * Membersihkan string teks dari simbol aneh dan spasi berlebih
 * @param {string} str 
 * @returns {string}
 */
function cleanText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/(?:^|\s)-\w+/g, ' ')
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
 * @param {object} [options={}] - { aiVariants?: Array<string> }
 * @returns {{ tier1: string, tier2: string, tier3: string, semanticVariants: Array<string>, negatives: Array<string> }}
 */
function buildQueries(productFingerprint, options = {}) {
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

    // Hasilkan variasi semantik (menggunakan AI variants jika ada, atau fallback deterministik) (ADR-12)
    const semanticVariants = (Array.isArray(options.aiVariants) && options.aiVariants.length >= 2)
        ? options.aiVariants.slice(0, 3)
        : generateDeterministicVariants(fp);

    // Ambil negative terms berdasarkan kategori
    const catKey = detectCategoryKey(category, `${brand} ${model} ${fp.title || ''}`);
    const negatives = catKey && NEGATIVE_TERMS_BY_CATEGORY[catKey]
        ? [...NEGATIVE_TERMS_BY_CATEGORY[catKey]]
        : [];

    return {
        tier1,
        tier2,
        tier3,
        semanticVariants,
        negatives
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildQueries,
        cleanText,
        cleanTitle,
        generateDeterministicVariants,
        SYNONYM_DICTIONARY,
        NEGATIVE_TERMS_BY_CATEGORY
    };
}
if (typeof window !== 'undefined') {
    window.QueryBuilder = {
        buildQueries,
        cleanText,
        cleanTitle,
        generateDeterministicVariants,
        SYNONYM_DICTIONARY,
        NEGATIVE_TERMS_BY_CATEGORY
    };
}
