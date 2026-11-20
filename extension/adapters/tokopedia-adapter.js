/**
 * extension/adapters/tokopedia-adapter.js
 * 
 * Tokopedia Adapter menggunakan arsitektur bertingkat:
 * - Layer 1: Schema.org JSON-LD (<script type="application/ld+json">)
 * - Layer 2: OpenGraph Meta Tags (og:title, og:image, product:price:amount)
 * - Layer 3: Direct DOM Selectors ([data-testid="pdpProductName"], [data-testid="pdpMainPrice"], dll.)
 * - Layer 4: Unhydrated SPA Fallback (window.__PAGE_TYPE__, URL path slug)
 * 
 * Sesuai Ground Truth: contohproduk-tokped.html
 */

const BaseClass = (typeof window !== 'undefined' && window.BaseAdapter)
    ? window.BaseAdapter
    : (typeof require !== 'undefined' ? require('./base-adapter.js').BaseAdapter : class {});

class TokopediaAdapter extends BaseClass {
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
            const href = (typeof window !== 'undefined' && window.location) ? window.location.href : '';
            if (href) {
                const parsedUrl = new URL(href);
                const pathname = parsedUrl.pathname;
                const ignoredPaths = ['/discovery', '/cart', '/user', '/search', '/promo', '/help', '/order-list', '/p/'];
                if (ignoredPaths.some(path => pathname.startsWith(path))) {
                    return false;
                }
                const segments = pathname.split('/').filter(Boolean);
                if (segments.length < 2) {
                    return false;
                }
            }
        } catch (e) {
            return false;
        }

        // 1. Cek Variabel Global Tokopedia (sangat presisi berdasarkan View Page Source)
        if (typeof window !== 'undefined' && window.__PAGE_TYPE__ && window.__PAGE_TYPE__.includes('productdetailpage')) {
            return true;
        }

        if (typeof document === 'undefined') return false;

        // 2. Cek OpenGraph Meta Tag
        const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
        if (ogType && (ogType.includes('product') || ogType === 'og:product')) {
            return true;
        }

        // 3. Fallback Selector DOM Khas Tokopedia
        const markers = (typeof window !== 'undefined' && window.PRODUCT_PAGE_MARKERS?.tokopedia) || [
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
            source: this.marketplaceName,
            title: null,
            price: null,
            currency: 'IDR',
            rating: null,
            seller: null,
            imageUrl: null,
            url: (typeof window !== 'undefined' && window.location) ? window.location.href : ''
        };

        if (typeof document !== 'undefined') {
            // Helper untuk mencari objek tipe Product pada JSON-LD
            const findProduct = (node) => {
                if (!node) return null;
                if (Array.isArray(node)) {
                    for (const item of node) {
                        const found = findProduct(item);
                        if (found) return found;
                    }
                    return null;
                }
                if (node['@graph'] && Array.isArray(node['@graph'])) {
                    return findProduct(node['@graph']);
                }
                const t = node['@type'];
                if (t === 'Product' || t === 'https://schema.org/Product' || (Array.isArray(t) && t.includes('Product'))) {
                    return node;
                }
                return null;
            };

            // --- A. Ekstraksi dari JSON-LD (Schema.org) ---
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                try {
                    const parsed = JSON.parse(script.textContent);
                    const data = findProduct(parsed);
                    if (data) {
                        productData.title = data.name || productData.title;

                        if (data.image) {
                            const rawImg = Array.isArray(data.image)
                                ? data.image[0]
                                : (typeof data.image === 'object' ? data.image.url : data.image);
                            if (typeof rawImg === 'string' && rawImg.trim()) {
                                let cImg = rawImg.trim();
                                if (cImg.startsWith('//')) cImg = 'https:' + cImg;
                                if (/^https?:\/\//i.test(cImg)) productData.imageUrl = cImg;
                            }
                        }

                        if (data.offers) {
                            const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
                            const pRaw = offer.price || offer.lowPrice;
                            if (pRaw !== undefined && pRaw !== null) {
                                const parsedP = parseFloat(pRaw);
                                if (!isNaN(parsedP) && parsedP > 0) productData.price = parsedP;
                            }
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
                const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
                    || document.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content')
                    || document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
                if (ogImg && typeof ogImg === 'string' && ogImg.trim()) {
                    let cImg = ogImg.trim();
                    if (cImg.startsWith('//')) cImg = 'https:' + cImg;
                    if (/^https?:\/\//i.test(cImg)) productData.imageUrl = cImg;
                }
            }

            if (!productData.price) {
                const priceMeta = document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content')
                    || document.querySelector('meta[property="og:price:amount"]')?.getAttribute('content');
                if (priceMeta) {
                    const parsedP = parseFloat(priceMeta);
                    if (!isNaN(parsedP) && parsedP > 0) productData.price = parsedP;
                }
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
        }

        // --- D. Fallback ke URL Path Slug jika DOM belum terhidrasi ---
        if (!productData.title && typeof window !== 'undefined' && window.location?.pathname) {
            try {
                const segments = window.location.pathname.split('/').filter(Boolean);
                if (segments.length >= 2) {
                    const slug = segments[1].replace(/-\d+(-\d+)?$/, '');
                    if (slug) {
                        productData.title = slug.replace(/-/g, ' ').trim();
                    }
                    if (!productData.seller && segments[0]) {
                        productData.seller = segments[0];
                    }
                }
            } catch (e) { }
        }

        return productData.title ? productData : null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TokopediaAdapter };
}
if (typeof window !== 'undefined') {
    window.TokopediaAdapter = TokopediaAdapter;
}
