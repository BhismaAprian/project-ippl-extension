/**
 * extension/adapters/tokopedia-adapter.js
 * 
 * Tokopedia Adapter menggunakan skema window global.
 * Mengombinasikan window.__PAGE_TYPE__, Schema.org JSON-LD, Meta OG, dan DOM Fallback.
 */

class TokopediaAdapter extends window.BaseAdapter {
    get marketplaceName() {
        return 'tokopedia';
    }

    /**
     * Cek apakah URL merupakan halaman produk Tokopedia
     * @param {string} url 
     * @returns {boolean}
     */
    matchesUrl(url) {
        if (!url || !url.includes('tokopedia.com')) return false;

        try {
            const parsedUrl = new URL(url);
            const pathname = parsedUrl.pathname;

            // Pastikan bukan halaman statis/sistem Tokopedia yang sering muncul di path awal
            const ignoredPaths = ['/discovery', '/cart', '/user', '/search', '/promo', '/help', '/order-list'];
            if (ignoredPaths.some(path => pathname.startsWith(path))) {
                return false;
            }

            // Gunakan window.URL_PATTERNS jika ada
            const patterns = window.URL_PATTERNS;
            if (patterns && patterns.tokopedia) {
                return patterns.tokopedia.test(pathname);
            }

            // Fallback Pattern khas PDP Tokopedia: /{seller_username}/{product_slug}
            return /\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+/.test(pathname);
        } catch (e) {
            return false;
        }
    }

    /**
     * Cek penanda halaman produk di DOM Tokopedia
     * @returns {boolean}
     */
    hasProductMarkers() {
        // 1. Cek Variabel Global Tokopedia (sangat presisi berdasarkan View Page Source)
        if (window.__PAGE_TYPE__ && window.__PAGE_TYPE__.includes('productdetailpage')) {
            return true;
        }

        // 2. Cek OpenGraph Meta Tag
        const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
        if (ogType && (ogType.includes('product') || ogType === 'og:product')) {
            return true;
        }

        // 3. Fallback Selector DOM Khas Tokopedia
        const markers = window.PRODUCT_PAGE_MARKERS?.tokopedia || [
            '[data-testid="pdpProductName"]',
            '[data-testid="lblPDPDetailProductName"]',
            '[data-testid="pdpMainImage"]',
            '.product-summary',
            'meta[property="og:type"][content="product"]'
        ];

        return markers.some(selector => document.querySelector(selector) !== null);
    }

    /**
     * Ekstraksi detail produk dari halaman Tokopedia
     * @returns {object|null}
     */
    extractProduct() {
        if (!this.hasProductMarkers()) return null;

        let productData = {
            marketplace: this.marketplaceName,
            title: null,
            price: null,
            currency: 'IDR',
            rating: null,
            seller: null,
            imageUrl: null,
            url: window.location.href
        };

        // --- A. Ekstraksi dari JSON-LD (Schema.org) ---
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'Product' || data['@type'] === 'https://schema.org/Product') {
                    productData.title = data.name || productData.title;
                    productData.imageUrl = Array.isArray(data.image) ? data.image[0] : data.image;

                    if (data.offers) {
                        const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
                        productData.price = parseFloat(offer.price || offer.lowPrice);
                        productData.currency = offer.priceCurrency || 'IDR';
                    }

                    if (data.aggregateRating) {
                        productData.rating = parseFloat(data.aggregateRating.ratingValue);
                    }

                    if (data.offers && data.offers.seller) {
                        productData.seller = data.offers.seller.name;
                    }
                }
            } catch (e) {
                // Abaikan jika parse JSON-LD gagal
            }
        }

        // --- B. Fallback ke Meta Tags (OpenGraph) ---
        if (!productData.title) {
            const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
            if (ogTitle) productData.title = ogTitle.split('|')[0].trim();
        }

        if (!productData.imageUrl) {
            productData.imageUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        }

        if (!productData.price) {
            const priceMeta = document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content');
            if (priceMeta) productData.price = parseFloat(priceMeta);
        }

        // --- C. Fallback ke Direct DOM Selectors ---
        if (!productData.title) {
            const titleEl = document.querySelector('[data-testid="pdpProductName"]') ||
                document.querySelector('[data-testid="lblPDPDetailProductName"]') ||
                document.querySelector('h1');
            if (titleEl) productData.title = titleEl.textContent.trim();
        }

        if (!productData.price) {
            const priceEl = document.querySelector('[data-testid="pdpMainPrice"]') ||
                document.querySelector('[data-testid="lblPDPSubTotalMain"]');
            if (priceEl) {
                const cleanPrice = priceEl.textContent.replace(/[^0-9]/g, '');
                if (cleanPrice) productData.price = parseFloat(cleanPrice);
            }
        }

        if (!productData.seller) {
            const sellerEl = document.querySelector('[data-testid="llbPDPFooterShopName"]') ||
                document.querySelector('a[href*="/shop/"]');
            if (sellerEl) productData.seller = sellerEl.textContent.trim();
        }

        return productData;
    }
}

// Pendaftaran ke scope global window
window.TokopediaAdapter = TokopediaAdapter;