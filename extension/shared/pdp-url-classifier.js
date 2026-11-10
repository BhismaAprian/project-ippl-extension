/**
 * extension/shared/pdp-url-classifier.js
 * 
 * Klasifikasi deterministik URL Product Detail Page (PDP) vs halaman sampah
 * (pencarian, etalase, toko 1-segmen, kategori, cart).
 * Murni URL parsing tanpa dependensi scraping DOM atau jaringan.
 */

const TOKOPEDIA_BLOCKED_FIRST_SEGMENTS = new Set([
    'discovery', 'cart', 'search', 'find', 'help', 'promo', 'hot', 'p',
    'pulsa', 'keuangan', 'mitra', 'user', 'events', 'play', 'login',
    'register', 'bantuan', 'reksadana', 'tokopedia-seru'
]);

/**
 * Normalisasi hostname: menghapus subdomain 'www.' dan mengabaikan huruf kapital.
 * Menjamin kesetaraan domain, misal: www.lazada.co.id == lazada.co.id.
 * @param {string} hostname 
 * @returns {string}
 */
function normalizeHostname(hostname) {
    if (!hostname) return '';
    const lower = hostname.toLowerCase();
    return lower.startsWith('www.') ? lower.slice(4) : lower;
}

/**
 * Mengidentifikasi marketplace berdasarkan hostname URL
 * @param {string} hostname 
 * @returns {'shopee' | 'tokopedia' | 'lazada' | 'blibli' | 'unknown'}
 */
function detectMarketplaceFromHost(hostname) {
    const host = normalizeHostname(hostname);
    if (host.includes('shopee.co.id')) return 'shopee';
    if (host.includes('tokopedia.com')) return 'tokopedia';
    if (host.includes('lazada.co.id')) return 'lazada';
    if (host.includes('blibli.com')) return 'blibli';
    return 'unknown';
}

/**
 * Mengklasifikasikan apakah suatu URL adalah PDP valid beserta alasannya.
 * 
 * @param {string} url - URL yang akan diklasifikasikan
 * @returns {{ isPdp: boolean, marketplace: string, reason: string }}
 */
function classifyUrl(url) {
    if (!url || typeof url !== 'string' || !url.trim()) {
        return { isPdp: false, marketplace: 'unknown', reason: 'URL kosong atau tidak valid' };
    }

    let parsed;
    try {
        parsed = new URL(url.trim());
    } catch (e) {
        return { isPdp: false, marketplace: 'unknown', reason: 'Format URL tidak valid (malformed)' };
    }

    const marketplace = detectMarketplaceFromHost(parsed.hostname);
    const pathname = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();

    // 1. Filter Sampah Global (Pencarian, Etalase, Keranjang, Tag, Katalog)
    const hasSearchQuery = parsed.searchParams.has('q')
        || parsed.searchParams.has('keyword')
        || parsed.searchParams.has('searchterm')
        || parsed.searchParams.has('key');

    if (hasSearchQuery) {
        return { isPdp: false, marketplace, reason: 'URL mengandung parameter pencarian (?q=/?keyword=)' };
    }

    const junkPathSegments = ['/find/', '/find', '/search/', '/search', '/etalase/', '/etalase', '/cart/', '/cart', '/catalog/', '/catalog', '/tag/', '/tag'];
    for (const junk of junkPathSegments) {
        if (pathname === junk || pathname.startsWith(junk + '/') || pathname.includes(junk)) {
            return { isPdp: false, marketplace, reason: `URL mengarah ke halaman non-PDP (${junk})` };
        }
    }

    // 2. Aturan Spesifik Marketplace
    switch (marketplace) {
        case 'shopee': {
            // Shopee PDP resmi wajib mengandung pola -i.{shopId}.{itemId} atau /product/{shopId}/{itemId}
            const hasShopeePdpPattern = /-i\.\d+\.\d+/i.test(pathname) || /\/product\/\d+\/\d+/i.test(pathname);
            if (!hasShopeePdpPattern) {
                return { isPdp: false, marketplace, reason: 'Bukan pola PDP Shopee (-i.{shop}.{item})' };
            }

            // Larang halaman profil toko atau halaman akun
            if (pathname.startsWith('/shop/') || pathname.startsWith('/buyer/') || pathname.startsWith('/user/')) {
                return { isPdp: false, marketplace, reason: 'URL profil toko atau pembeli Shopee' };
            }

            return { isPdp: true, marketplace, reason: 'PDP Shopee valid' };
        }

        case 'tokopedia': {
            const segments = pathname.split('/').filter(Boolean);

            // Tokopedia PDP membutuhkan minimal 2 segmen: /{toko}/{slug-produk}
            if (segments.length < 2) {
                return { isPdp: false, marketplace, reason: 'URL profil toko Tokopedia (hanya 1 segmen)' };
            }

            const firstSegment = segments[0];
            if (TOKOPEDIA_BLOCKED_FIRST_SEGMENTS.has(firstSegment)) {
                return { isPdp: false, marketplace, reason: `Segmen pertama '${firstSegment}' adalah halaman sistem/kategori Tokopedia` };
            }

            if (segments[1] === 'etalase') {
                return { isPdp: false, marketplace, reason: 'URL etalase toko Tokopedia' };
            }

            return { isPdp: true, marketplace, reason: 'PDP Tokopedia valid' };
        }

        case 'lazada': {
            // Lazada PDP resmi mengandung pola -i{itemId}-s{skuId} atau berada di dalam /products/
            const hasLazadaPdpPattern = /-i\d+-s\d+/i.test(pathname) || pathname.startsWith('/products/');
            if (!hasLazadaPdpPattern) {
                return { isPdp: false, marketplace, reason: 'Bukan pola PDP Lazada (-i...-s...)' };
            }

            if (pathname.startsWith('/shop/') || pathname.startsWith('/helpcenter/')) {
                return { isPdp: false, marketplace, reason: 'URL profil toko atau pusat bantuan Lazada' };
            }

            return { isPdp: true, marketplace, reason: 'PDP Lazada valid' };
        }

        case 'blibli': {
            // Blibli PDP resmi selalu menggunakan jalur /p/{slug}/{code}
            const segments = pathname.split('/').filter(Boolean);
            const isBlibliPdp = segments[0] === 'p' && segments.length >= 2;
            if (!isBlibliPdp) {
                return { isPdp: false, marketplace, reason: 'Bukan pola PDP Blibli (/p/{slug}/{code})' };
            }

            return { isPdp: true, marketplace, reason: 'PDP Blibli valid' };
        }

        default:
            return { isPdp: false, marketplace: 'unknown', reason: 'Marketplace tidak dikenali' };
    }
}

/**
 * Helper ringkas untuk memastikan URL adalah produk PDP
 * @param {string} url 
 * @param {string} [expectedMarketplace] - Opsi filter nama marketplace spesifik
 * @returns {boolean}
 */
function isProductUrl(url, expectedMarketplace) {
    const classification = classifyUrl(url);
    if (!classification.isPdp) {
        return false;
    }

    if (expectedMarketplace) {
        return classification.marketplace.toLowerCase() === expectedMarketplace.trim().toLowerCase();
    }

    return true;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        classifyUrl,
        isProductUrl,
        normalizeHostname,
        detectMarketplaceFromHost
    };
}
if (typeof window !== 'undefined') {
    window.PdpUrlClassifier = {
        classifyUrl,
        isProductUrl,
        normalizeHostname,
        detectMarketplaceFromHost
    };
}
