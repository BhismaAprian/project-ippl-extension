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

        const safe = (fn, fallback = null) => {
            try {
                const value = fn();
                return value === undefined || value === null || value === '' ? fallback : value;
            } catch (e) {
                return fallback;
            }
        };

        const getMeta = (selector) => safe(() =>
            document.querySelector(selector)?.getAttribute('content')?.trim() || null
        );

        const toNumber = (value) => {
            if (value === undefined || value === null) return null;
            let text = String(value).trim();
            if (!text) return null;
            if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) {
                text = text.replace(/[.,]/g, '');
            } else if (/^\d+,\d+$/.test(text)) {
                text = text.replace(',', '.');
            }
            const parsed = parseFloat(text.replace(/[^\d.-]/g, ''));
            return isNaN(parsed) ? null : parsed;
        };

        const shopNameFromUrl = (href) => safe(() => {
            const path = new URL(href, window.location.origin).pathname;
            const segments = path.split('/').filter(Boolean);
            if (!segments.length) return null;
            let segment = decodeURIComponent(segments[segments.length - 1]);
            segment = segment.replace(/-i\.\d+\.\d+.*$/, '');
            segment = segment.replace(/[.-]\d+$/, '');
            segment = segment.replace(/[-_]+/g, ' ').trim();
            return segment || null;
        });

        let productData = {
            source: this.marketplaceName,
            url: window.location.href,
            title: null,
            price: null,
            currency: 'IDR',
            rating: null,
            reviewCount: null,
            seller: {
                name: null,
                rating: null
            },
            badges: [],
            description: null,
            imageUrl: null,
            shopId: null,
            itemId: null,
            observedAt: safe(() => new Date().toISOString())
        };

        // 1. Ekstraksi shopId dan itemId dari URL (-i.1165288551.24918260613)
        safe(() => {
            const urlMatch = window.location.pathname.match(/-i\.(\d+)\.(\d+)/) ||
                window.location.pathname.match(/\/product\/(\d+)\/(\d+)/);
            if (urlMatch) {
                productData.shopId = urlMatch[1];
                productData.itemId = urlMatch[2];
            }
        });

        // 2. Ekstraksi dari JSON-LD (Schema.org) - Paling Akurat
        let jsonLdDescription = null;
        const jsonLdScripts = safe(() => document.querySelectorAll('script[type="application/ld+json"]'), []) || [];
        for (const script of jsonLdScripts) {
            safe(() => {
                const data = JSON.parse(script.textContent);
                const isProduct = data?.['@type'] === 'Product' || data?.['@type'] === 'https://schema.org/Product';
                if (!isProduct) return;

                if (data.name) productData.title = data.name;
                if (data.image) productData.imageUrl = Array.isArray(data.image) ? data.image[0] : data.image;
                if (data.description) jsonLdDescription = String(data.description).trim() || null;

                if (data.offers) {
                    const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
                    const parsedPrice = offer?.price ? parseFloat(offer.price) :
                        offer?.lowPrice ? parseFloat(offer.lowPrice) : null;
                    if (parsedPrice !== null && !isNaN(parsedPrice)) {
                        productData.price = parsedPrice;
                    }
                    if (offer?.priceCurrency) productData.currency = offer.priceCurrency;

                    const jsonLdSellerName = offer?.seller?.name ?? data.seller?.name;
                    if (jsonLdSellerName && !productData.seller.name) {
                        productData.seller.name = String(jsonLdSellerName).trim() || null;
                    }
                }

                if (data.aggregateRating) {
                    const rating = toNumber(data.aggregateRating.ratingValue);
                    if (rating !== null) productData.rating = rating;

                    const reviewCount = toNumber(data.aggregateRating.reviewCount);
                    if (reviewCount !== null) productData.reviewCount = Math.round(reviewCount);
                }
            });
        }

        // 3. Fallback ke Meta Tags (Berdasarkan OpenGraph View Source)
        if (!productData.title) {
            productData.title = safe(() => {
                const ogTitle = getMeta('meta[property="og:title"]');
                return ogTitle ? ogTitle.split('|')[0].trim() : null;
            });
        }

        if (!productData.imageUrl) {
            productData.imageUrl = getMeta('meta[property="og:image"]');
        }

        if (productData.price === null) {
            productData.price = safe(() => toNumber(getMeta('meta[property="product:price:amount"]')));
        }

        productData.description = getMeta('meta[property="og:description"]') ?? jsonLdDescription;

        // 4. Ekstraksi seller
        if (!productData.seller.name) {
            productData.seller.name = safe(() => {
                const seeAlso = getMeta('meta[property="og:see_also"]');
                const fromSeeAlso = seeAlso ? shopNameFromUrl(seeAlso) : null;
                if (fromSeeAlso) return fromSeeAlso;

                const canonical = document.querySelector('link[rel="canonical"]')?.href;
                const isProductUrl = canonical && /-i\.\d+\.\d+/.test(canonical);
                if (canonical && !isProductUrl) {
                    const fromCanonical = shopNameFromUrl(canonical);
                    if (fromCanonical) return fromCanonical;
                }

                const shopLink = document.querySelector('a[href*="/shop/"]');
                if (shopLink) {
                    const text = shopLink.textContent?.trim();
                    if (text) return text;
                    return shopNameFromUrl(shopLink.getAttribute('href'));
                }

                return null;
            });
        }

        productData.seller.rating = safe(() => {
            const el = document.querySelector('[class*="shop-rating"], [data-testid*="shop-rating"]');
            return toNumber(el?.textContent);
        });

        // 5. Ekstraksi badges (Shopee Mall)
        productData.badges = safe(() => {
            const badges = [];
            const ogDescription = getMeta('meta[property="og:description"]') || '';
            const mallEl = Array.from(document.querySelectorAll('[data-testid*="mall" i], [class*="mall" i]'))
                .find(el => {
                    const hitTestid = /mall/i.test(el.getAttribute('data-testid') || '');
                    const hitClass = Array.from(el.classList).some(
                        cls => /mall/i.test(cls) && !/small/i.test(cls)
                    );
                    return hitTestid || hitClass;
                });
            if (/\bmall/i.test(ogDescription) || mallEl) badges.push('Shopee Mall');
            return badges;
        }, []);

        // 6. Fallback ke Direct DOM Elements
        if (!productData.title) {
            productData.title = safe(() => {
                const titleEl = document.querySelector('[data-testid="product-title"]') || document.querySelector('h1');
                return titleEl?.textContent?.trim() || null;
            });
        }

        if (productData.price === null) {
            productData.price = safe(() => {
                const priceEl = document.querySelector('div._3n53c, div.pqL32, div.p9M_4');
                const cleanPrice = priceEl?.textContent?.replace(/[^0-9]/g, '');
                return cleanPrice ? toNumber(cleanPrice) : null;
            });
        }

        return productData;
    }
}

// Bind ke window object
window.ShopeeAdapter = ShopeeAdapter;