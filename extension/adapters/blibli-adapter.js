/**
 * extension/adapters/blibli-adapter.js
 * 
 * Blibli Adapter menggunakan arsitektur bertingkat (Cascade Merge Pattern):
 * - Layer 1: Window State State Hydration (__PRODUCT_DETAIL_INITIAL_STATE__)
 *            Menyimpan data lengkap: nama produk, harga offered/listed, brand, merchant, ulasan.
 * - Layer 2: OpenGraph Meta Tags (og:title, og:image, og:url, og:description)
 * - Layer 3: Direct DOM Fallback (data-testid, .pdp__info, #product-info, h1)
 * 
 * Sesuai Ground Truth: ContohProduk-BliBli.html
 */

const BaseClass = (typeof window !== 'undefined' && window.BaseAdapter)
    ? window.BaseAdapter
    : (typeof require !== 'undefined' ? require('./base-adapter.js').BaseAdapter : class {});

class BlibliAdapter extends BaseClass {
    get marketplaceName() {
        return 'blibli';
    }

    /**
     * Cek apakah URL merupakan halaman Blibli
     * @param {string} url 
     * @returns {boolean}
     */
    matchesUrl(url) {
        if (!url) return false;
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.hostname.includes('blibli.com');
        } catch (e) {
            return false;
        }
    }

    /**
     * Cek penanda halaman produk di DOM Blibli
     * @returns {boolean}
     */
    hasProductMarkers() {
        try {
            const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
            if (pathname.includes('/p/')) {
                return true;
            }
            if (typeof window !== 'undefined' && window.__PRODUCT_DETAIL_INITIAL_STATE__) {
                return true;
            }
        } catch (e) { }

        if (typeof document === 'undefined') return false;

        const markers = [
            '#product-info',
            '[data-testid="productInfo"]',
            '[data-testid="productTitle"]',
            '[data-testid="bagRetailContextualDisplayPrice"]',
            '.pdp__info',
            '.pdp__info__product-info',
            'meta[property="og:type"][content="product"]'
        ];

        return markers.some(selector => document.querySelector(selector) !== null);
    }

    /**
     * Ekstraksi detail produk dari halaman Blibli
     * @returns {object|null}
     */
    extractProduct() {
        if (!this.hasProductMarkers()) return null;

        let productData = {
            marketplace: this.marketplaceName,
            source: this.marketplaceName,
            title: null,
            price: null,
            originalPrice: null,
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

        // --- Layer 1: window.__PRODUCT_DETAIL_INITIAL_STATE__ ---
        let summary = null;
        if (typeof window !== 'undefined' && window.__PRODUCT_DETAIL_INITIAL_STATE__) {
            summary = window.__PRODUCT_DETAIL_INITIAL_STATE__['productDetail.product/summary'];
        }

        // Jika di lingkungan DOM offline / snapshot, cari dari script tag
        if (!summary && typeof document !== 'undefined') {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const text = script.textContent || '';
                if (text.includes('__PRODUCT_DETAIL_INITIAL_STATE__')) {
                    try {
                        const match = text.match(/__PRODUCT_DETAIL_INITIAL_STATE__\s*=\s*(\{.*?\});/s);
                        if (match && match[1]) {
                            const parsed = JSON.parse(match[1]);
                            summary = parsed['productDetail.product/summary'] || null;
                            if (summary) break;
                        }
                    } catch (e) { }
                }
            }
        }

        if (summary) {
            if (summary.name) productData.title = String(summary.name).trim();
            if (summary.url) productData.url = summary.url;
            if (summary.brand?.name) productData.brand = summary.brand.name;
            if (summary.merchant?.name) productData.seller = summary.merchant.name;
            if (summary.uniqueSellingPoint) productData.description = String(summary.uniqueSellingPoint).trim();

            if (summary.price) {
                const offered = summary.price.offered;
                const listed = summary.price.listed;
                if (typeof offered === 'number' && offered > 0) {
                    productData.price = offered;
                } else if (typeof listed === 'number' && listed > 0) {
                    productData.price = listed;
                }
                if (typeof listed === 'number' && listed > 0) {
                    productData.originalPrice = listed;
                }
            }

            if (summary.review) {
                const rVal = summary.review.decimalRating || summary.review.rating;
                if (typeof rVal === 'number' && !isNaN(rVal)) {
                    productData.rating = rVal;
                }
                if (typeof summary.review.count === 'number') {
                    productData.reviewCount = summary.review.count;
                }
            }

            if (Array.isArray(summary.images) && summary.images.length > 0) {
                productData.imageUrl = summary.images[0].full || summary.images[0].thumbnail || null;
            }
        }

        // --- Layer 2: OpenGraph & Schema.org JSON-LD Fallback ---
        if (typeof document !== 'undefined') {
            if (!productData.title) {
                const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
                if (ogTitle) {
                    productData.title = ogTitle.replace(/\s*\|\s*Blibli.*$/i, '').trim();
                }
            }

            if (!productData.imageUrl) {
                const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
                    || document.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content')
                    || document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
                if (ogImg && typeof ogImg === 'string' && ogImg.trim()) {
                    let cImg = ogImg.trim();
                    if (cImg.startsWith('//')) cImg = 'https:' + cImg;
                    if (/^https?:\/\//i.test(cImg)) productData.imageUrl = cImg;
                }
            }

            if (!productData.description) {
                productData.description = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
            }

            if (!productData.url || productData.url === 'about:blank') {
                const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
                if (ogUrl) productData.url = ogUrl;
            }

            // Schema.org fallback (offers.price / offers.lowPrice & image) (CR-006)
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                try {
                    const text = script.textContent?.trim();
                    if (!text) continue;
                    const data = JSON.parse(text);
                    if (data['@type'] === 'Product' || data['@type'] === 'https://schema.org/Product') {
                        if (!productData.title && data.name) productData.title = String(data.name).trim();
                        if (productData.price === null && data.offers) {
                            const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
                            const pRaw = offer?.price !== undefined ? offer.price : offer?.lowPrice;
                            if (pRaw !== undefined && pRaw !== null) {
                                const parsed = Math.round(parseFloat(pRaw));
                                if (!isNaN(parsed) && parsed > 0) productData.price = parsed;
                            }
                        }
                        if (!productData.imageUrl && data.image) {
                            const rawImg = Array.isArray(data.image)
                                ? data.image[0]
                                : (typeof data.image === 'object' ? data.image.url : data.image);
                            if (typeof rawImg === 'string' && rawImg.trim()) {
                                let cImg = rawImg.trim();
                                if (cImg.startsWith('//')) cImg = 'https:' + cImg;
                                if (/^https?:\/\//i.test(cImg)) productData.imageUrl = cImg;
                            }
                        }
                    }
                } catch (e) { }
            }

            // OpenGraph price fallback
            if (productData.price === null) {
                const priceMeta = document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content')
                    || document.querySelector('meta[property="og:price:amount"]')?.getAttribute('content');
                if (priceMeta) {
                    const parsedP = Math.round(parseFloat(priceMeta));
                    if (!isNaN(parsedP) && parsedP > 0) productData.price = parsedP;
                }
            }

            // --- Layer 3: Direct DOM Fallback ---
            if (!productData.title) {
                const titleEl = document.querySelector('[data-testid="productTitle"]') ||
                    document.querySelector('.product__title') ||
                    document.querySelector('h1');
                if (titleEl) productData.title = titleEl.textContent.trim();
            }

            if (productData.price === null) {
                const priceEl = document.querySelector('[data-testid="bagRetailContextualDisplayPrice"]') ||
                    document.querySelector('.pdp-price') ||
                    document.querySelector('[class*="price"]');
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
    module.exports = { BlibliAdapter };
}
if (typeof window !== 'undefined') {
    window.BlibliAdapter = BlibliAdapter;
}
