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
        if (!url) return false;
        try {
            return new URL(url).hostname.includes('tokopedia.com');
        } catch (e) {
            return false;
        }
    }

    /**
     * Cek penanda halaman produk di DOM Tokopedia
     * @returns {boolean}
     */
    hasProductMarkers() {
        try {
            const parsedUrl = new URL(window.location.href);
            const pathname = parsedUrl.pathname;
            const ignoredPaths = ['/discovery', '/cart', '/user', '/search', '/promo', '/help', '/order-list', '/p/'];
            if (ignoredPaths.some(path => pathname.startsWith(path))) {
                return false;
            }
            const segments = pathname.split('/').filter(Boolean);
            if (segments.length < 2) {
                return false;
            }
        } catch (e) {
            return false;
        }

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