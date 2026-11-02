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
        if (!url) return false;
        try {
            return new URL(url).hostname.includes('shopee.co.id');
        } catch (e) {
            return false;
        }
    }

    /**
     * Cek penanda halaman produk di DOM Shopee
     * @returns {boolean}
     */
    hasProductMarkers() {
        try {
            const pathname = window.location.pathname;
            const isProductUrl = /-i\.\d+\.\d+/.test(pathname) || /\/product\/\d+\/\d+/.test(pathname);
            if (!isProductUrl) return false;
        } catch (e) {
            return false;
        }

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

    /**
     * Helper: Memicu pemuatan ulasan jika belum di-render oleh React Shopee
     */
    async ensureReviewsLoaded() {
        const existing = document.querySelectorAll(
            '.shopee-product-rating, [data-testid="product-comment-item"], .shopee-product-comment-list > div'
        );
        if (existing && existing.length >= 3) return true;

        // Cari jangkar rating di halaman
        const anchor = document.querySelector(
            '.product-ratings, #product-rating-overview, [class*="product-rating"], div.page-product__rating'
        );
        if (anchor) {
            try {
                anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Beri jeda 600ms agar React me-render komentar
                await new Promise(resolve => setTimeout(resolve, 600));
            } catch (e) {
                // Ignore scroll error
            }
        }
        return true;
    }

    /**
     * (Review Intelligence) Ekstrak daftar ulasan teks pembeli dari DOM Shopee
     * @returns {Promise<Array<string>>}
     */
    async extractReviews() {
        await this.ensureReviewsLoaded();

        const rawReviews = [];
        const seen = new Set();

        // 1. Selector Utama (Shopee PDP Standard)
        let items = document.querySelectorAll('div.shopee-product-rating');

        // 2. Fallback Selector 1 (Semantic Data-Testid / Alternate Class)
        if (!items || items.length === 0) {
            items = document.querySelectorAll('[data-testid="product-comment-item"], div.product-rating-overview ~ div');
        }

        // 3. Fallback Selector 2 (Struktur Generik List)
        if (!items || items.length === 0) {
            items = document.querySelectorAll('div.shopee-product-comment-list > div');
        }

        if (items && items.length > 0) {
            items.forEach(item => {
                let textEl = item.querySelector(
                    'div.shopee-product-rating__content, div._28I_B3, [data-testid="comment-text"], div.Rk3V3e'
                );

                let text = '';
                if (textEl) {
                    text = textEl.textContent || '';
                } else {
                    // Fallback DOM traversal: cari div teks yang bukan meta/author
                    const candidateDivs = item.querySelectorAll('div');
                    for (const div of candidateDivs) {
                        const content = div.textContent?.trim() || '';
                        // Ambil div yang punya panjang wajar dan bukan penanda tanggal/username
                        if (content.length >= 15 && content.length <= 600 && !/\d{4}-\d{2}-\d{2}/.test(content)) {
                            text = content;
                            break;
                        }
                    }
                }

                // Sanitasi Teks
                text = text
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                // Filter ulasan kosong atau terlalu pendek
                if (!text || text.length < 10) return;

                // Filter boilerplate murni yang tidak informatif
                if (/^(pengiriman cepat|kurir ramah|barang sampai dengan selamat|makasih seller|mantap|mantap gan|sip|oke|bagus|barang belum dicoba semoga awet)([\s.,!]*)$/i.test(text)) {
                    return;
                }

                // Truncate teks agar hemat token Groq (maks 180 karakter)
                if (text.length > 180) {
                    text = text.substring(0, 180) + '...';
                }

                if (!seen.has(text)) {
                    seen.add(text);
                    rawReviews.push(text);
                }
            });
        }

        // Batasi maksimal 25 ulasan teratas
        return rawReviews.slice(0, 25);
    }
}

// Bind ke window object
window.ShopeeAdapter = ShopeeAdapter;