/**
 * extension/adapters/lazada-adapter.js
 * 
 * Lazada Adapter menggunakan arsitektur bertingkat (Cascade Merge Pattern):
 * - Layer 1: Schema.org JSON-LD (<script type="application/ld+json"> dengan @type Product)
 * - Layer 2: OpenGraph Meta Tags (og:title, og:image, og:url, og:description)
 * - Layer 3: Direct DOM Fallback (h1, .pdp-product-price, .pdp-mod-product-badge-title)
 * 
 * Sesuai Ground Truth: contohproduk-lazada.html
 */

const BaseClass = (typeof window !== 'undefined' && window.BaseAdapter)
    ? window.BaseAdapter
    : (typeof require !== 'undefined' ? require('./base-adapter.js').BaseAdapter : class {});

class LazadaAdapter extends BaseClass {
    get marketplaceName() {
        return 'lazada';
    }

    matchesUrl(url) {
        if (!url) return false;
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.hostname.includes('lazada.co.id');
        } catch (e) {
            return false;
        }
    }

    hasProductMarkers() {
        try {
            const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
            if (/\/products\/.*-i\d+/i.test(pathname) || pathname.startsWith('/products/')) {
                return true;
            }
            if (typeof window !== 'undefined') {
                const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
                if (ogType === 'product') return true;
            }
        } catch (e) { }

        if (typeof document === 'undefined') return false;

        const markers = [
            'meta[property="og:type"][content="product"]',
            'script[type="application/ld+json"]',
            '.pdp-mod-product-badge-title',
            '.pdp-product-title',
            '#pdp-block-title',
            'h1.pdp-mod-product-badge-title',
            'h1'
        ];

        return markers.some(selector => document.querySelector(selector) !== null);
    }

    /**
     * Ekstraksi detail produk dari halaman Lazada berdasarkan Schema.org JSON-LD & DOM
     * @returns {object|null}
     */
    extractProduct() {
        if (!this.hasProductMarkers()) return null;

        let productData = {
            marketplace: this.marketplaceName,
            source: this.marketplaceName,
            title: null,
            price: null,
            currency: 'IDR',
            rating: null,
            reviewCount: 0,
            seller: null,
            brand: null,
            imageUrl: null,
            description: '',
            url: (typeof window !== 'undefined' ? window.location.href : ''),
            observedAt: new Date().toISOString()
        };

        // --- Layer 1: Schema.org JSON-LD (@type: Product) ---
        if (typeof document !== 'undefined') {
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                try {
                    const text = script.textContent?.trim();
                    if (!text) continue;
                    const data = JSON.parse(text);
                    if (data['@type'] === 'Product' || data['@type'] === 'https://schema.org/Product') {
                        if (data.name) productData.title = String(data.name).trim();
                        if (data.description) productData.description = String(data.description).trim();
                        if (data.image) {
                            productData.imageUrl = Array.isArray(data.image) ? data.image[0] : data.image;
                        }
                        if (data.brand) {
                            productData.brand = typeof data.brand === 'object' ? (data.brand.name || null) : String(data.brand);
                        }
                        if (data.offers) {
                            const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
                            if (offer.price !== undefined && offer.price !== null) {
                                const parsedP = parseFloat(offer.price);
                                if (!isNaN(parsedP) && parsedP > 0) productData.price = Math.round(parsedP);
                            }
                            if (offer.priceCurrency) productData.currency = offer.priceCurrency;
                            if (offer.url) productData.url = offer.url;
                            if (offer.seller?.name) productData.seller = offer.seller.name;
                        }
                        if (data.aggregateRating) {
                            const rVal = parseFloat(data.aggregateRating.ratingValue);
                            if (!isNaN(rVal)) productData.rating = rVal;
                            const rCount = parseInt(data.aggregateRating.reviewCount, 10);
                            if (!isNaN(rCount)) productData.reviewCount = rCount;
                        }
                    }
                } catch (e) { }
            }

            // --- Layer 2: OpenGraph Meta Tags Fallback ---
            if (!productData.title) {
                const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
                if (ogTitle) productData.title = ogTitle.replace(/\s*\|\s*Lazada.*$/i, '').trim();
            }

            if (!productData.imageUrl) {
                productData.imageUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || null;
            }

            if (!productData.description) {
                productData.description = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
            }

            if (!productData.url || productData.url === 'about:blank') {
                const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
                if (ogUrl) productData.url = ogUrl;
            }

            // Fallback harga dari AppLink Meta Tag (misal: lazada://id/d?...price:2799000...)
            if (productData.price === null) {
                const appLinkMeta = document.querySelector('meta[property="al:ios:url"]') ||
                    document.querySelector('meta[property="al:android:url"]');
                if (appLinkMeta) {
                    const content = appLinkMeta.getAttribute('content') || '';
                    try {
                        const decoded = decodeURIComponent(decodeURIComponent(content));
                        const priceMatch = decoded.match(/price[:=](\d+)/i);
                        if (priceMatch && priceMatch[1]) {
                            const parsed = parseInt(priceMatch[1], 10);
                            if (parsed > 0) productData.price = parsed;
                        }
                    } catch (e) { }
                }
            }

            // --- Layer 3: Direct DOM Fallback ---
            if (!productData.title) {
                const titleEl = document.querySelector('h1.pdp-mod-product-badge-title') || document.querySelector('h1');
                if (titleEl) productData.title = titleEl.textContent.trim();
            }

            if (productData.price === null) {
                const priceEl = document.querySelector('.pdp-price') ||
                    document.querySelector('.pdp-product-price') ||
                    document.querySelector('[class*="pdp-price"]');
                if (priceEl) {
                    const cleanDigits = priceEl.textContent.replace(/[^0-9]/g, '');
                    if (cleanDigits) productData.price = parseInt(cleanDigits, 10);
                }
            }
        }

        return productData.title ? productData : null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LazadaAdapter };
}
if (typeof window !== 'undefined') {
    window.LazadaAdapter = LazadaAdapter;
}
