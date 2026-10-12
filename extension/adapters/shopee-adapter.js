/**
 * extension/adapters/shopee-adapter.js
 * 
 * Shopee Adapter menggunakan skema window global.
 * Mengombinasikan ekstraksi Schema.org JSON-LD, OpenGraph Meta, dan DOM Fallback.
 */

class ShopeeAdapter extends window.BaseAdapter {
    get marketplaceName() {
        return 'shopee';
    }

    /**
     * Cek apakah URL merupakan halaman produk Shopee
     * @param {string} url 
     * @returns {boolean}
     */
    matchesUrl(url) {
        if (!url || !url.includes('shopee.co.id')) return false;

        const patterns = window.URL_PATTERNS;
        if (!patterns || !patterns.shopee) {
            // Fallback pattern khas Shopee: -i.{shop_id}.{item_id}
            return /-i\.\d+\.\d+/.test(new URL(url).pathname);
        }

        return patterns.shopee.test(new URL(url).pathname);
    }

    /**
     * Cek penanda halaman produk di DOM Shopee
     * @returns {boolean}
     */
    hasProductMarkers() {
        // Cek meta tag og:type
        const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
        if (ogType && (ogType.includes('product') || ogType === 'og:product')) {
            return true;
        }

        const markers = window.PRODUCT_PAGE_MARKERS?.shopee || [
            '[data-testid="product-title"]',
            '.product-briefing',
            'div.page-product',
            'meta[property="og:type"][content="product"]'
        ];

        return markers.some(selector => document.querySelector(selector) !== null);
    }

    /**
     * Ekstraksi detail produk dari halaman Shopee
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
            url: window.location.href,
            shopId: null,
            itemId: null
        };

        // 1. Ekstraksi shopId dan itemId dari URL (-i.1165288551.24918260613)
        const urlMatch = window.location.pathname.match(/-i\.(\d+)\.(\d+)/) ||
            window.location.pathname.match(/\/product\/(\d+)\/(\d+)/);
        if (urlMatch) {
            productData.shopId = urlMatch[1];
            productData.itemId = urlMatch[2];
        }

        // 2. Ekstraksi dari JSON-LD (Schema.org) - Paling Akurat
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
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        // 3. Fallback ke Meta Tags (Berdasarkan OpenGraph View Source)
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

        // 4. Fallback ke Direct DOM Elements
        if (!productData.title) {
            const titleEl = document.querySelector('[data-testid="product-title"]') || document.querySelector('h1');
            if (titleEl) productData.title = titleEl.textContent.trim();
        }

        if (!productData.price) {
            const priceEl = document.querySelector('div._3n53c, div.pqL32, div.p9M_4');
            if (priceEl) {
                const cleanPrice = priceEl.textContent.replace(/[^0-9]/g, '');
                if (cleanPrice) productData.price = parseFloat(cleanPrice);
            }
        }

        return productData;
    }
}

// Bind ke window object
window.ShopeeAdapter = ShopeeAdapter;