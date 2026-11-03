/**
 * extension/adapters/shopee-adapter.js
 * 
 * Shopee Adapter menggunakan arsitektur "God-Level Scraper" berlapis:
 * - Layer 1: JSON State MFE (<script type="text/mfe-initial-data">) - Data spesifikasi, atribut, dan identitas toko
 * - Layer 2: Schema.org JSON-LD (<script type="application/ld+json">) - Fallback data semantik (harga, seller, rating)
 * - Layer 3: Direct DOM & OpenGraph Heuristic Fallback - Penyelamat hidrasi dinamis & varian harga aktif
 * - Normalisasi ketat: Konversi Micro-unit 100.000 Shopee & parsing mata uang Indonesia ke integer murni
 * - Review Intelligence Interaktif: Ekstraksi ulasan dengan native data-cmtid & data-si-review-idx untuk click-to-scroll
 * - Warranty Intelligence: Audit garansi otomatis (mencocokkan atribut sistem vs teks deskripsi)
 * - Smart Recommendations: Ekstraksi 3 produk serupa teratas langsung dari DOM (0 network calls)
 */

if (!window.ShopeeAdapter) {
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

    // =========================================================================
    // NORMALISASI DATA (Data Cleaning & Type Casting)
    // =========================================================================

    /**
     * Normalisasi harga menjadi Pure Integer (IDR)
     * Menangani Micro-units Shopee (skala 100.000), format ribuan titik/koma, dan rentang varian
     * @param {number|string|null} val 
     * @returns {number|null}
     */
    normalizePrice(val) {
        if (val === null || val === undefined) return null;

        // Kasus 1: Micro-units dari Shopee JSON State (misal: 849900000000 -> 8499000)
        if (typeof val === 'number') {
            if (val > 100000000) {
                val = Math.round(val / 100000);
            }
            return Number.isFinite(val) && val > 0 ? Math.round(val) : null;
        }

        let str = String(val).trim();
        if (!str) return null;

        // Jika berupa rentang varian ("Rp 50.000 - Rp 150.000"), ambil harga minimum
        if (str.includes('-')) {
            str = str.split('-')[0].trim();
        }

        // Buang prefix mata uang dan spasi
        str = str.replace(/^(?:Rp|IDR)\s*/i, '').trim();

        // Hapus desimal koma/titik (misal: ",00" atau ".00")
        str = str.replace(/[,\.]\d{2}$/, '');

        // Hapus titik pemisah ribuan
        str = str.replace(/\./g, '');

        // Bersihkan karakter non-digit dan parse integer murni
        const cleaned = str.replace(/[^\d]/g, '');
        const parsed = parseInt(cleaned, 10);

        return (!isNaN(parsed) && parsed > 0) ? parsed : null;
    }

    /**
     * Normalisasi rating menjadi Float (0.0 - 5.0) dengan 1 desimal presisi
     * Produk baru atau tanpa rating dikembalikan sebagai null
     * @param {number|string|null} val 
     * @returns {number|null}
     */
    normalizeRating(val) {
        if (val === null || val === undefined) return null;

        if (typeof val === 'number') {
            if (val <= 0 || isNaN(val)) return null;
            return parseFloat(Math.min(5, Math.max(0, val)).toFixed(1));
        }

        let str = String(val).trim().replace(',', '.');
        const parsed = parseFloat(str);
        if (isNaN(parsed) || parsed <= 0) return null;

        return parseFloat(Math.min(5, Math.max(0, parsed)).toFixed(1));
    }

    /**
     * Normalisasi jumlah ulasan / terjual ke integer murni
     * Mendukung format seperti "1,2RB", "1.5k", "770 Terjual"
     * @param {number|string|null} val 
     * @returns {number|null}
     */
    normalizeReviewCount(val) {
        if (val === null || val === undefined) return null;

        if (typeof val === 'number') {
            return Number.isFinite(val) && val >= 0 ? Math.round(val) : null;
        }

        let str = String(val).trim().toLowerCase();
        if (!str) return null;

        str = str.replace(/ulasan|penilaian|terjual/gi, '').trim();

        if (str.includes('rb') || str.includes('k')) {
            const num = parseFloat(str.replace(/rb|k/g, '').replace(',', '.').trim());
            return !isNaN(num) ? Math.round(num * 1000) : null;
        }

        if (str.includes('jt') || str.includes('m')) {
            const num = parseFloat(str.replace(/jt|m/g, '').replace(',', '.').trim());
            return !isNaN(num) ? Math.round(num * 1000000) : null;
        }

        const parsed = parseInt(str.replace(/[^\d]/g, ''), 10);
        return (!isNaN(parsed) && parsed >= 0) ? parsed : null;
    }

    /**
     * Helper untuk mengambil nama toko dari URL
     * @param {string} href 
     * @returns {string|null}
     */
    extractShopNameFromUrl(href) {
        if (!href) return null;
        try {
            const path = new URL(href, window.location.origin).pathname;
            const segments = path.split('/').filter(Boolean);
            if (!segments.length) return null;
            let segment = decodeURIComponent(segments[segments.length - 1]);
            segment = segment.replace(/-i\.\d+\.\d+.*$/, '');
            segment = segment.replace(/[.-]\d+$/, '');
            segment = segment.replace(/[-_]+/g, ' ').trim();
            return segment || null;
        } catch (e) {
            return null;
        }
    }

    // =========================================================================
    // LAYER 1: MFE JSON STATE (<script type="text/mfe-initial-data">)
    // =========================================================================

    extractFromMfeState() {
        try {
            const scripts = document.querySelectorAll('script[type="text/mfe-initial-data"]');
            for (const script of scripts) {
                const text = script.textContent?.trim();
                if (!text || (!text.includes('DOMAIN_PDP') && !text.includes('PDP_BFF_DATA') && !text.includes('initialState'))) {
                    continue;
                }

                let root = null;
                try {
                    root = JSON.parse(text);
                } catch (e) {
                    continue;
                }

                if (!root) continue;

                // Path Shopee modern MFE PDP
                const pdpBff = root.initialState?.DOMAIN_PDP?.data?.PDP_BFF_DATA;
                let pdpData = null;
                if (pdpBff) {
                    const currentKey = pdpBff.currentKey;
                    pdpData = (currentKey && pdpBff.cachedMap?.[currentKey]) ||
                        Object.values(pdpBff.cachedMap || {})[0] ||
                        null;
                }

                // Fallback struktur alternatif Shopee MFE
                const itemNode = pdpData?.item || root.initialState?.item?.items?.[0] || root.initialState?.item || null;
                if (!itemNode && !pdpData) continue;

                const reviewNode = pdpData?.product_review || itemNode?.item_rating || null;
                const shopDetailed = pdpData?.shop_detailed || pdpData?.shop_info || null;

                // Judul Produk
                const title = itemNode?.title || itemNode?.name || null;

                // Harga (micro-units atau direct)
                const rawPrice = itemNode?.price ??
                    itemNode?.price_min ??
                    pdpData?.product_price?.price ??
                    pdpData?.product_price?.price_min ??
                    itemNode?.models?.[0]?.price ??
                    null;
                const price = this.normalizePrice(rawPrice);

                // Rating & Review
                const rating = this.normalizeRating(reviewNode?.rating_star);
                const reviewCount = this.normalizeReviewCount(reviewNode?.total_rating_count ?? reviewNode?.rating_count);
                const soldCount = reviewNode?.historical_sold_display || reviewNode?.sold_count_display || null;

                // Seller / Nama Toko
                let sellerName = shopDetailed?.name || null;
                if (!sellerName && Array.isArray(itemNode?.shop_vouchers) && itemNode.shop_vouchers.length > 0) {
                    sellerName = itemNode.shop_vouchers[0]?.shop_name || null;
                }
                if (!sellerName && Array.isArray(pdpData?.shop_vouchers) && pdpData.shop_vouchers.length > 0) {
                    sellerName = pdpData.shop_vouchers[0]?.shop_name || null;
                }
                const sellerRating = this.normalizeRating(shopDetailed?.rating_star);

                // Image URL
                let imageUrl = null;
                if (itemNode?.image) {
                    imageUrl = `https://down-id.img.susercontent.com/file/${itemNode.image}`;
                } else if (Array.isArray(pdpData?.product_images) && pdpData.product_images.length > 0) {
                    imageUrl = `https://down-id.img.susercontent.com/file/${pdpData.product_images[0]}`;
                }

                // Spesifikasi Teknis / Attributes
                const rawAttrs = itemNode?.attributes || pdpData?.product_attributes || [];
                const specifications = Array.isArray(rawAttrs)
                    ? rawAttrs.map(attr => ({
                        name: attr?.name ? String(attr.name).trim() : '',
                        value: attr?.value ? String(attr.value).trim() : ''
                    })).filter(attr => attr.name && attr.value)
                    : [];

                // Badges (Shopee Mall / Star)
                const badges = [];
                if (itemNode?.show_official_shop_label || shopDetailed?.is_official_shop) {
                    badges.push('Shopee Mall');
                }

                // ShopId & ItemId
                const shopId = pdpBff?.currentShopIdItemId?.shopId || itemNode?.shop_id || null;
                const itemId = pdpBff?.currentShopIdItemId?.itemId || itemNode?.item_id || null;

                return {
                    title,
                    price,
                    currency: itemNode?.currency || 'IDR',
                    rating,
                    reviewCount,
                    soldCount,
                    seller: {
                        name: sellerName,
                        rating: sellerRating
                    },
                    badges,
                    description: itemNode?.description || null,
                    imageUrl,
                    specifications,
                    shopId: shopId ? String(shopId) : null,
                    itemId: itemId ? String(itemId) : null
                };
            }
        } catch (e) {
            console.warn('[ShopeeAdapter] extractFromMfeState error:', e);
        }
        return null;
    }

    // =========================================================================
    // LAYER 2: SCHEMA.ORG JSON-LD (<script type="application/ld+json">)
    // =========================================================================

    extractFromJsonLd() {
        try {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                const text = script.textContent?.trim();
                if (!text) continue;

                let data = null;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    continue;
                }

                const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
                const product = items.find(item =>
                    item?.['@type'] === 'Product' ||
                    item?.['@type'] === 'https://schema.org/Product'
                );

                if (!product) continue;

                const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
                const rawPrice = offer?.price ?? offer?.lowPrice ?? null;
                const price = this.normalizePrice(rawPrice);

                const sellerName = offer?.seller?.name || product.seller?.name || null;
                const rating = this.normalizeRating(product.aggregateRating?.ratingValue);
                const reviewCount = this.normalizeReviewCount(product.aggregateRating?.reviewCount);

                let imageUrl = null;
                if (Array.isArray(product.image) && product.image.length > 0) {
                    imageUrl = product.image[0];
                } else if (typeof product.image === 'string') {
                    imageUrl = product.image;
                }

                return {
                    title: product.name ? String(product.name).trim() : null,
                    price,
                    currency: offer?.priceCurrency || 'IDR',
                    rating,
                    reviewCount,
                    seller: {
                        name: sellerName ? String(sellerName).trim() : null,
                        rating: null
                    },
                    description: product.description ? String(product.description).trim() : null,
                    imageUrl
                };
            }
        } catch (e) {
            console.warn('[ShopeeAdapter] extractFromJsonLd error:', e);
        }
        return null;
    }

    // =========================================================================
    // LAYER 3: DIRECT DOM & OPENGRAPH HEURISTIC FALLBACK
    // =========================================================================

    extractFromDom() {
        const safe = (fn, fallback = null) => {
            try {
                const val = fn();
                return val === undefined || val === null || val === '' ? fallback : val;
            } catch (e) {
                return fallback;
            }
        };

        const getMeta = (selector) => safe(() =>
            document.querySelector(selector)?.getAttribute('content')?.trim() || null
        );

        // 1. Judul Produk
        let title = safe(() => {
            const el = document.querySelector('[data-testid="product-title"], h1, .auau1S, .WBVL_7, .qa-title, ._44qnta');
            return el?.textContent?.trim() || null;
        });
        if (!title) {
            const ogTitle = getMeta('meta[property="og:title"]');
            if (ogTitle) {
                title = ogTitle.split('|')[0].replace(/^jual\s+/i, '').trim();
            }
        }

        // 2. Harga Produk
        let price = null;
        const priceSelectors = [
            'div.pyzxvq',
            'div.pw3J3G',
            'div.nt0EaI',
            'div.pqL32',
            'div._3n53c',
            'div.G27ShP',
            'div.p9M_4',
            'div.IZIdvd',
            '[data-testid="product-price"]',
            '.product-briefing .price'
        ];
        for (const sel of priceSelectors) {
            const el = document.querySelector(sel);
            if (el?.textContent) {
                const parsed = this.normalizePrice(el.textContent);
                if (parsed !== null) {
                    price = parsed;
                    break;
                }
            }
        }
        if (price === null) {
            // Heuristik: cari elemen teks di area briefing yang diawali Rp
            const candidate = Array.from(document.querySelectorAll('.product-briefing div, [class*="briefing"] div, section[aria-live="polite"] div'))
                .find(el => /^Rp\s*[0-9\.]+/i.test(el.textContent?.trim() || ''));
            if (candidate) {
                price = this.normalizePrice(candidate.textContent);
            }
        }
        if (price === null) {
            price = this.normalizePrice(getMeta('meta[property="product:price:amount"]'));
        }

        // 3. Seller (Nama & Rating)
        const sellerName = safe(() => {
            const shopLink = document.querySelector('a[href*="/shop/"], a.fO3m8T, .seller-info__name, [data-testid*="seller"]');
            if (shopLink) {
                const text = shopLink.textContent?.trim();
                if (text && text.length > 1 && text.length < 50) return text;
                const href = shopLink.getAttribute('href');
                if (href) return this.extractShopNameFromUrl(href);
            }

            const seeAlso = getMeta('meta[property="og:see_also"]');
            if (seeAlso) {
                const fromSeeAlso = this.extractShopNameFromUrl(seeAlso);
                if (fromSeeAlso) return fromSeeAlso;
            }

            const canonical = document.querySelector('link[rel="canonical"]')?.href;
            if (canonical && !/-i\.\d+\.\d+/.test(canonical)) {
                return this.extractShopNameFromUrl(canonical);
            }

            return null;
        });

        const sellerRating = safe(() => {
            const el = document.querySelector('[class*="shop-rating"], [data-testid*="shop-rating"]');
            return this.normalizeRating(el?.textContent);
        });

        // 4. Rating & Review Count
        const rating = safe(() => {
            const el = document.querySelector('.product-rating-overview__rating-score, div.y6gK3T, div.f5-5K3, [class*="rating-score"]');
            return this.normalizeRating(el?.textContent);
        });

        const reviewCount = safe(() => {
            const el = document.querySelector('.product-rating-overview__filters, [class*="rating-count"]');
            return this.normalizeReviewCount(el?.textContent);
        });

        // 5. Image & Description
        const imageUrl = getMeta('meta[property="og:image"]') || document.querySelector('.product-briefing img')?.src || null;
        const description = getMeta('meta[property="og:description"]');

        // 6. Badges (Shopee Mall)
        const badges = [];
        const isMall = document.querySelector('[data-testid*="mall" i], [class*="mall" i]') ||
            /\bmall/i.test(getMeta('meta[property="og:description"]') || '');
        if (isMall) {
            badges.push('Shopee Mall');
        }

        return {
            title,
            price,
            currency: 'IDR',
            rating,
            reviewCount,
            seller: {
                name: sellerName,
                rating: sellerRating
            },
            badges,
            description,
            imageUrl
        };
    }

    // =========================================================================
    // WARRANTY INTELLIGENCE (Audit Garansi Sistem vs Deskripsi)
    // =========================================================================

    /**
     * Mengaudit garansi produk dengan membandingkan data spesifikasi resmi vs teks deskripsi
     * @param {Array<{name: string, value: string}>} specifications 
     * @param {string|null} description 
     * @returns {object}
     */
    auditWarranty(specifications = [], description = '') {
        let attrType = null;
        let attrDuration = null;

        if (Array.isArray(specifications)) {
            specifications.forEach(s => {
                const n = (s.name || '').toLowerCase();
                const v = (s.value || '').trim();
                if (n.includes('jenis garansi')) attrType = v;
                if (n.includes('masa garansi')) attrDuration = v;
            });
        }

        const descText = String(description || '');
        const descMatch = descText.match(/(?:garansi\s*(?:resmi|distributor|produsen|toko|seller)?\s*[:\-]?\s*(\d+\s*(?:bulan|tahun|thn|bln|hari|minggu)))/i);
        const descWarranty = descMatch ? descMatch[0].trim() : (descText.toLowerCase().includes('garansi resmi') ? 'Garansi Resmi' : null);

        let hasDiscrepancy = false;
        let warningMessage = null;

        if (descWarranty && attrType) {
            const isAttrNoWarranty = /tidak|none|no/i.test(attrType) || /hari|minggu/i.test(attrDuration || '');
            const isDescSubstantial = /bulan|tahun|resmi/i.test(descWarranty);
            if (isAttrNoWarranty && isDescSubstantial) {
                hasDiscrepancy = true;
                warningMessage = `Penjual mencantumkan "${descWarranty}" di deskripsi, namun sistem Shopee mencatat "${attrType}${attrDuration ? ` (${attrDuration})` : ''}".`;
            }
        }

        let badgeType = 'NONE';
        let title = 'Tanpa Garansi Resmi';

        const combinedText = `${attrType || ''} ${attrDuration || ''} ${descWarranty || ''}`.toLowerCase();
        if (/produsen|distributor|resmi/i.test(combinedText)) {
            badgeType = 'OFFICIAL';
            title = `Garansi Resmi ${attrDuration || descWarranty || ''}`.trim();
        } else if (/toko|seller/i.test(combinedText) || attrDuration || descWarranty) {
            badgeType = 'STORE';
            title = `Garansi Toko ${attrDuration || descWarranty || ''}`.trim();
        }

        if (hasDiscrepancy) {
            badgeType = 'WARNING';
        }

        return {
            badgeType,
            title,
            duration: attrDuration || descWarranty || 'Tidak tertera',
            rawAttribute: { type: attrType, duration: attrDuration },
            rawDescription: descWarranty,
            hasDiscrepancy,
            warningMessage,
            claimTips: hasDiscrepancy
                ? 'Waspada: konfirmasi ketentuan garansi ke penjual via chat sebelum memesan.'
                : 'Simpan invoice pembelian, kartu garansi, dan video unboxing utuh untuk klaim.'
        };
    }

    // =========================================================================
    // SMART RECOMMENDATIONS ("Kamu Mungkin Juga Suka" Strict Traversal)
    // =========================================================================

    /**
     * Helper: Ekstrak kata kunci esensial dari judul produk untuk filtering relevansi
     * @param {string} title 
     * @returns {Array<string>}
     */
    extractEssentialTokens(title) {
        if (!title) return [];
        const clean = title.toLowerCase()
            .replace(/jual\s+/gi, '')
            .replace(/\|\s*shopee.*$/gi, '')
            .replace(/[^\w\s]/g, ' ');

        const stopWords = new Set([
            'promo', 'murah', 'diskon', 'terlaris', 'original', 'asli', 'garansi', 'resmi',
            'ready', 'stock', 'bisa', 'cod', 'gratis', 'ongkir', 'voucher', 'cashback',
            'official', 'store', 'shop', 'seller', 'grosir', 'termurah', 'bayar', 'ditempat',
            'jakarta', 'surabaya', 'bandung', 'new', 'baru', 'terbaik', 'berkualitas',
            'indonesia', 'shopee', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'yang', 'ini', 'itu'
        ]);

        return clean.split(/\s+/)
            .map(t => t.trim())
            .filter(t => t.length >= 3 && !stopWords.has(t));
    }

    /**
     * Ekstrak rekomendasi produk serupa ("Kamu Mungkin Juga Suka")
     * Menggunakan Strict Gatekeeper: membuang produk acak/iklan yang tidak relevan dengan produk asli.
     * @param {string|null} originalTitle
     * @param {number|null} originalPrice
     * @returns {Array<object>}
     */
    extractSimilarRecommendations(originalTitle = null, originalPrice = null) {
        const recommendations = [];
        const seenUrls = new Set();
        try {
            // 1. Cari elemen judul rekomendasi dengan strict semantic text search
            const allElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span'));

            // Prioritas 1: Header yang persis "kamu mungkin juga suka"
            let targetHeader = allElements.find(el => {
                const text = el.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
                // Strict match: hanya "kamu mungkin juga suka", buang jika mengandung "serupa" / "terkait" / "ulasan"
                if (text.includes('serupa') || text.includes('ulasan') || text.includes('terkait')) return false;
                return (text === 'kamu mungkin juga suka' || text === 'kamu mungkin suka') && el.children.length <= 2;
            });

            // Fallback header: jika tidak persis sama, cari yang berawalan "kamu mungkin" tanpa kata "serupa"
            if (!targetHeader) {
                targetHeader = allElements.find(el => {
                    const text = el.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
                    if (text.includes('serupa') || text.includes('ulasan') || text.includes('terkait')) return false;
                    return text.includes('kamu mungkin juga suka') && el.children.length <= 2;
                });
            }

            let candidateLinks = [];

            if (targetHeader) {
                // Traversal naik ke parent untuk mencari kontainer produk yang berada di bawah targetHeader
                let curr = targetHeader.parentElement;
                for (let level = 0; level < 6 && curr; level++) {
                    const links = Array.from(curr.querySelectorAll('a[href*="-i."], a[href*="/product/"]'));
                    // Filter: Hanya ambil link yang secara posisi DOM terletak SETELAH targetHeader
                    const followingLinks = links.filter(l => {
                        const pos = targetHeader.compareDocumentPosition(l);
                        return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                    });

                    if (followingLinks.length >= 1) {
                        candidateLinks = followingLinks;
                        break;
                    }
                    curr = curr.parentElement;
                }
            }

            // Fallback: Jika tidak ketemu via header, cari link produk di paruh bawah halaman
            if (!candidateLinks.length) {
                const allLinks = Array.from(document.querySelectorAll('a[href*="-i."], a[href*="/product/"]'));
                candidateLinks = allLinks.filter(l => {
                    // Pastikan link berada di bagian bawah dokumen (> 55% scroll height)
                    const rect = l.getBoundingClientRect();
                    const docTop = rect.top + window.scrollY;
                    return docTop > (document.body.scrollHeight * 0.55);
                });
            }

            // Ambil judul produk asli sebagai pembanding gatekeeper
            let curTitle = (originalTitle || '').trim();
            if (!curTitle) {
                const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
                const h1Title = document.querySelector('[data-testid="product-title"], h1')?.textContent;
                curTitle = (ogTitle || h1Title || document.title || '').trim();
            }
            const curTitleLower = curTitle.toLowerCase();
            const essentialTokens = this.extractEssentialTokens(curTitle);

            for (const link of candidateLinks) {
                if (recommendations.length >= 4) break;
                const href = link.href || link.getAttribute('href') || '';
                if (!href || href === window.location.href) continue;

                // Pastikan format URL produk Shopee
                if (!href.includes('-i.') && !href.includes('/product/')) continue;

                // Cegah duplikasi URL
                const cleanUrl = href.split('?')[0];
                if (seenUrls.has(cleanUrl)) continue;
                seenUrls.add(cleanUrl);

                // Cari kartu pembungkus (div role group atau parent terdekat)
                const card = link.closest('div[role="group"]') || link.closest('div[class*="row"] > div') || link.parentElement;

                // 3. Ekstrak Judul
                let title = null;
                // Cek dari aria-label kartu (misal: "Product card: Ram/Memory sodim 8GB...")
                const ariaLabel = card?.getAttribute('aria-label') || link.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.includes(':')) {
                    title = ariaLabel.split(':').slice(1).join(':').trim();
                } else if (ariaLabel && !ariaLabel.toLowerCase().startsWith('product card')) {
                    title = ariaLabel.trim();
                }

                // Cek dari img alt
                if (!title) {
                    const img = (card || link).querySelector('img[alt]');
                    const alt = img?.getAttribute('alt')?.trim();
                    if (alt && !alt.toLowerCase().includes('overlay') && !alt.toLowerCase().includes('star')) {
                        title = alt;
                    }
                }

                // Cek dari teks di dalam elemen
                if (!title) {
                    const textEl = (card || link).querySelector('[class*="line-clamp"], [class*="whitespace-normal"], div > span');
                    if (textEl && textEl.textContent.trim().length > 8) {
                        title = textEl.textContent.trim();
                    }
                }

                // Fallback: decode dari slug URL
                if (!title && href) {
                    const slugMatch = href.match(/shopee\.co\.id\/([^\/\?]+)-i\./);
                    if (slugMatch) {
                        title = decodeURIComponent(slugMatch[1]).replace(/-/g, ' ');
                    }
                }

                if (!title) continue;
                const candTitleLower = title.toLowerCase();

                // 3.5 STRICT RELEVANCE GATEKEEPER
                // A. Negative Term Rejection & Dominance Guard
                if (curTitleLower.includes('springbed') || curTitleLower.includes('spring bed') || curTitleLower.includes('kasur') || curTitleLower.includes('matras')) {
                    const bedBanned = ['angin', 'tiup', 'air mattress', 'air bed', 'inflatable', 'pompa'];
                    if (bedBanned.some(b => candTitleLower.includes(b))) {
                        console.log(`[ShopeeAdapter] Rekomendasi native dilewati (banned term): "${title}"`);
                        continue;
                    }

                    // Dominance Guard: Tolak hanya jika judul didominasi oleh aksesoris (bukan kasur utama)
                    const hasCoreMattress = /\b(springbed|spring bed|kasur|matras)\b/i.test(candTitleLower);
                    const hasBonus = /\b(bonus|gratis|free|\+|plus|include|termasuk|dapat|hadiah|set|paket)\b/i.test(candTitleLower);
                    const startsWithAccessory = /^(bantal|guling|bed\s*cover|bedcover|sprei|seprai)\b/i.test(candTitleLower);
                    const isCoverSheetOnly = /\b(cover\s+kasur|sarung\s+kasur|sprei\s+kasur|seprai\s+kasur|pelindung\s+kasur)\b/i.test(candTitleLower);

                    if ((startsWithAccessory || isCoverSheetOnly) && (!hasCoreMattress || !hasBonus)) {
                        console.log(`[ShopeeAdapter] Rekomendasi native dilewati (didominasi aksesoris): "${title}"`);
                        continue;
                    }
                }
                if (curTitleLower.includes('ram') || curTitleLower.includes('sodimm')) {
                    const ramBanned = ['caddy', 'enclosure', 'baut', 'kabel', 'baju', 'kaos', 'sepatu', 'tas'];
                    if (ramBanned.some(b => candTitleLower.includes(b))) {
                        console.log(`[ShopeeAdapter] Rekomendasi native dilewati (banned term RAM): "${title}"`);
                        continue;
                    }
                    if ((curTitleLower.includes('laptop') || curTitleLower.includes('sodimm')) &&
                        (candTitleLower.includes('longdimm') || (candTitleLower.includes('desktop') && !candTitleLower.includes('laptop')))) {
                        console.log(`[ShopeeAdapter] Rekomendasi native dilewati (RAM PC vs Laptop): "${title}"`);
                        continue;
                    }
                }

                // B. Token Similarity Check (Wajib setidaknya 50% kata kunci esensial cocok)
                if (essentialTokens.length > 0) {
                    const matchedTokens = essentialTokens.filter(token => {
                        return token.length <= 4
                            ? (new RegExp(`\\b${token}\\b`, 'i').test(candTitleLower) || candTitleLower.includes(token))
                            : candTitleLower.includes(token);
                    });
                    const similarityRatio = matchedTokens.length / essentialTokens.length;

                    if (similarityRatio < 0.50) {
                        console.log(`[ShopeeAdapter] Rekomendasi native dilewati (kemiripan kata kunci ${Math.round(similarityRatio * 100)}% < 50% [${matchedTokens.length}/${essentialTokens.length}]): "${title}"`);
                        continue;
                    }
                }

                // 4. Ekstrak Harga
                let price = null;
                let rawPrice = null;
                const cardText = (card || link).textContent || '';
                const pMatch = cardText.match(/Rp\s*([0-9\.]+)/i);
                if (pMatch) {
                    rawPrice = pMatch[0];
                    price = this.normalizePrice(pMatch[1]);
                } else {
                    const priceSpan = (card || link).querySelector('span[class*="text-base"], [class*="price"]');
                    if (priceSpan?.textContent) {
                        rawPrice = priceSpan.textContent.trim();
                        price = this.normalizePrice(rawPrice);
                    }
                }

                // C. Price Sanity Check (Batas Bawah Anomali Harga Aksesoris)
                const curPrice = originalPrice || this.normalizePrice(document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content'));
                if (price && curPrice && curPrice >= 50000) {
                    if (price < (curPrice * 0.25)) {
                        console.log(`[ShopeeAdapter] Rekomendasi native dilewati (harga anomali < 25%): Rp ${price} vs Rp ${curPrice}`);
                        continue;
                    }
                }

                // 5. Ekstrak Gambar
                let imageUrl = null;
                const img = (card || link).querySelector('img[src*="susercontent.com"], img[src*="down-id"], img[src*="shopee"]');
                if (img) {
                    imageUrl = img.src || img.getAttribute('src');
                }

                // 6. Ekstrak Rating
                let rating = null;
                const rMatch = cardText.match(/\b([45]\.[0-9])\b/);
                if (rMatch) {
                    rating = parseFloat(rMatch[1]);
                }

                recommendations.push({
                    id: `rec-shopee-${recommendations.length}`,
                    title,
                    price,
                    rawPrice: price ? `Rp ${price.toLocaleString('id-ID')}` : (rawPrice || 'Cek Harga'),
                    rating,
                    url: href,
                    imageUrl,
                    marketplace: 'Shopee'
                });
            }
        } catch (e) {
            console.warn('[ShopeeAdapter] extractSimilarRecommendations error:', e);
        }
        return recommendations;
    }

    /**
     * Versi asinkron: Jika saat pertama dieksekusi rekomendasi belum ada di DOM (karena di bawah layar),
     * picu scroll ke area "Kamu Mungkin Juga Suka" dan tunggu hingga React me-render grid kartu.
     * @param {string|null} origTitle
     * @param {number|null} origPrice
     * @returns {Promise<Array<object>>}
     */
    async extractSimilarRecommendationsAsync(origTitle = null, origPrice = null) {
        let recs = this.extractSimilarRecommendations(origTitle, origPrice);
        if (recs && recs.length >= 2) return recs;

        console.log('[ShopeeAdapter] Rekomendasi native belum ada di DOM, scroll ke seksi "Kamu Mungkin Juga Suka"...');
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, div, span'));
        const headerEl = allHeadings.find(el => {
            const text = el.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
            if (text.includes('serupa') || text.includes('ulasan') || text.includes('terkait')) return false;
            return text.includes('kamu mungkin juga suka');
        });

        if (headerEl) {
            try {
                headerEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            } catch (e) {
                window.scrollTo({ top: document.body.scrollHeight * 0.75, behavior: 'instant' });
            }
        } else {
            window.scrollTo({ top: document.body.scrollHeight * 0.75, behavior: 'instant' });
        }

        // Dispatch window scroll event to notify lazy loaders
        try {
            window.dispatchEvent(new Event('scroll', { bubbles: true }));
        } catch (e) { }

        // Active Polling Loop hingga 3.0 detik
        const startTime = Date.now();
        while (Date.now() - startTime < 3000) {
            await new Promise(resolve => setTimeout(resolve, 300));
            recs = this.extractSimilarRecommendations(origTitle, origPrice);
            if (recs && recs.length >= 1) {
                console.log(`[ShopeeAdapter] Rekomendasi "Kamu Mungkin Juga Suka" terdeteksi setelah ${Date.now() - startTime}ms (${recs.length} items).`);
                return recs;
            }
        }

        return this.extractSimilarRecommendations(origTitle, origPrice);
    }

    // =========================================================================
    // CASCADING MERGE EXTRACTION (Master Method)
    // =========================================================================

    /**
     * Ekstraksi detail produk dari halaman Shopee menggunakan Cascade Merge Pattern:
     * Layer 1: JSON State (MFE <script type="text/mfe-initial-data">) - Spesifikasi & metadata mendalam
     * Layer 2: JSON-LD (Schema.org <script type="application/ld+json">) - Data semantik terstruktur
     * Layer 3: Direct DOM & OpenGraph Fallback - Penyelamat hidrasi dinamis & anti-scraping
     * @returns {object|null}
     */
    extractProduct() {
        if (!this.hasProductMarkers()) return null;

        // Ekstraksi shopId dan itemId dari URL (-i.1165288551.24918260613)
        let urlShopId = null;
        let urlItemId = null;
        try {
            const urlMatch = window.location.pathname.match(/-i\.(\d+)\.(\d+)/) ||
                window.location.pathname.match(/\/product\/(\d+)\/(\d+)/);
            if (urlMatch) {
                urlShopId = urlMatch[1];
                urlItemId = urlMatch[2];
            }
        } catch (e) {
            // Ignore url parsing error
        }

        // Ekstraksi dari masing-masing lapisan
        const l1 = this.extractFromMfeState() || {};
        const l2 = this.extractFromJsonLd() || {};
        const l3 = this.extractFromDom() || {};

        // Cascade Merge: L1 -> L2 -> L3
        const title = l1.title || l2.title || l3.title || null;
        const price = l1.price ?? l2.price ?? l3.price ?? null;
        const currency = l1.currency || l2.currency || l3.currency || 'IDR';
        const rating = l1.rating ?? l2.rating ?? l3.rating ?? null;
        const reviewCount = l1.reviewCount ?? l2.reviewCount ?? l3.reviewCount ?? null;

        const sellerName = l1.seller?.name || l2.seller?.name || l3.seller?.name || null;
        const sellerRating = l1.seller?.rating ?? l2.seller?.rating ?? l3.seller?.rating ?? null;

        const imageUrl = l1.imageUrl || l2.imageUrl || l3.imageUrl || null;
        const description = l1.description || l2.description || l3.description || null;
        const specifications = Array.isArray(l1.specifications) ? l1.specifications : [];

        // Gabungkan badges unik
        const badgesSet = new Set([...(l1.badges || []), ...(l2.badges || []), ...(l3.badges || [])]);
        const badges = Array.from(badgesSet);

        const shopId = l1.shopId || urlShopId;
        const itemId = l1.itemId || urlItemId;

        // Audit Garansi
        const warrantyAudit = this.auditWarranty(specifications, description);

        // Ekstraksi 3 Rekomendasi Teratas (dengan Strict Gatekeeper)
        const similarRecommendations = this.extractSimilarRecommendations(title, price);

        const productData = {
            source: this.marketplaceName,
            url: window.location.href,
            title,
            price,
            currency,
            rating,
            reviewCount,
            soldCount: l1.soldCount || null,
            seller: {
                name: sellerName,
                rating: sellerRating
            },
            badges,
            description,
            specifications,
            warrantyAudit,
            similarRecommendations,
            imageUrl,
            shopId,
            itemId,
            observedAt: new Date().toISOString()
        };

        console.log('[ShopeeAdapter] Extracted product via Cascade Merge:', {
            title: productData.title,
            price: productData.price,
            seller: productData.seller.name,
            rating: productData.rating,
            specsCount: productData.specifications.length,
            warranty: productData.warrantyAudit?.title,
            similarCount: productData.similarRecommendations?.length,
            hasL1: Object.keys(l1).length > 0,
            hasL2: Object.keys(l2).length > 0,
            hasL3: Object.keys(l3).length > 0
        });

        // Validasi minimal judul produk harus terdeteksi
        if (!productData.title) {
            return null;
        }

        return productData;
    }

    // =========================================================================
    // REVIEW INTELLIGENCE (Interaktif dengan data-cmtid & data-si-review-idx)
    // =========================================================================

    /**
     * Helper: Memicu pemuatan ulasan jika belum di-render oleh React Shopee
     * Menggunakan protokol "Progressive Deep Scroll & Active Polling Wait" (hingga 3.5 detik)
     */
    async ensureReviewsLoaded() {
        const getReviewElements = () => {
            let els = document.querySelectorAll(
                '[data-cmtid], div[data-cmtid], .shopee-product-comment-list > div, [data-testid="product-comment-item"], div.shopee-product-rating, .shopee-product-rating__main'
            );
            if (!els || els.length === 0) {
                els = document.querySelectorAll('div.product-rating-overview ~ div, [class*="product-comment"], [class*="product-rating"]');
            }
            if (!els || els.length === 0) {
                // Selector berbasis teks jika Shopee mengganti class
                const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span'));
                const ratingHeading = headings.find(h => /^(penilaian produk|ulasan pembeli|product ratings|product reviews)$/i.test(h.textContent?.trim() || ''));
                if (ratingHeading) {
                    const parent = ratingHeading.closest('section, div[class*="rating"], div[class*="comment"]') || ratingHeading.parentElement?.parentElement;
                    if (parent) {
                        els = parent.querySelectorAll('[data-cmtid], div > div');
                    }
                }
            }
            return els || [];
        };

        let existing = getReviewElements();
        const hasRealComments = Array.from(existing).some(el => el.getAttribute('data-cmtid') || el.classList.contains('shopee-product-rating') || el.children.length > 0);
        if (hasRealComments && existing.length >= 2) {
            console.log(`[ShopeeAdapter] Ulasan sudah ada di DOM (${existing.length} items).`);
            return true;
        }

        console.log('[ShopeeAdapter] Komentar belum ada di DOM, memicu Progressive Deep Scroll ke ulasan...');

        // 1. Cari jangkar rating di halaman
        let anchor = document.querySelector(
            '.product-ratings, #product-rating-overview, [class*="product-rating"], div.page-product__rating'
        );

        if (!anchor) {
            const allElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, div'));
            anchor = allElements.find(h => /penilaian produk|ulasan pembeli|product ratings/i.test(h.textContent?.trim() || ''));
        }

        const dispatchScrollEvents = () => {
            try {
                window.dispatchEvent(new Event('scroll', { bubbles: true }));
                window.dispatchEvent(new Event('resize', { bubbles: true }));
                document.dispatchEvent(new Event('scroll', { bubbles: true }));
            } catch (e) { }
        };

        if (anchor) {
            try {
                // Progressive Deep Scroll: Scroll ke anchor, lalu lewati overview rating (~350px ke bawah)
                // agar elemen .shopee-product-comment-list berada tepat di dalam viewport aktif
                anchor.scrollIntoView({ behavior: 'instant', block: 'start' });
                window.scrollBy({ top: 350, behavior: 'instant' });
            } catch (e) {
                const targetY = (anchor.getBoundingClientRect().top + window.scrollY) + 350;
                window.scrollTo({ top: targetY, behavior: 'instant' });
            }
        } else {
            // Scroll ke area 50% produk
            window.scrollTo({ top: document.body.scrollHeight * 0.50, behavior: 'instant' });
        }

        dispatchScrollEvents();

        // 2. Active Polling Loop: periksa setiap 200ms hingga maksimal 3.5 detik
        const startTime = Date.now();
        const maxWaitMs = 3500;
        const pollIntervalMs = 200;
        let nudgeCount = 0;

        while (Date.now() - startTime < maxWaitMs) {
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

            // Progressive nudge setiap 800ms jika komentar belum muncul
            const elapsed = Date.now() - startTime;
            if (elapsed > (nudgeCount + 1) * 800 && nudgeCount < 3) {
                nudgeCount++;
                try {
                    window.scrollBy({ top: 150, behavior: 'instant' });
                    dispatchScrollEvents();
                } catch (e) { }
            }

            existing = getReviewElements();
            if (existing && existing.length >= 1) {
                console.log(`[ShopeeAdapter] Ulasan berhasil ter-render setelah ${elapsed}ms (${existing.length} items).`);
                return true;
            }
        }

        console.log(`[ShopeeAdapter] Selesai polling ulasan. Jumlah item akhir: ${existing ? existing.length : 0}`);
        return true;
    }

    /**
     * (Review Intelligence) Ekstrak ulasan pembeli dengan metadata cmtId & anchor link
     * @returns {Promise<Array<object>>}
     */
    async extractReviews() {
        await this.ensureReviewsLoaded();

        const rawReviews = [];
        const seen = new Set();

        // 1. Kumpulkan elemen komentar dengan selector [data-cmtid] utama & fallback class
        let items = document.querySelectorAll(
            '[data-cmtid], div[data-cmtid], .shopee-product-comment-list > div, div.shopee-product-rating, [data-testid="product-comment-item"]'
        );

        if (!items || items.length === 0) {
            items = document.querySelectorAll('div.product-rating-overview ~ div, [class*="product-comment"], [class*="product-rating"]');
        }

        // 2. Selector berbasis teks jika Shopee mengganti class secara menyeluruh
        if (!items || items.length === 0) {
            const allElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span'));
            const heading = allElements.find(el => /^(penilaian produk|ulasan pembeli|product ratings|product reviews)$/i.test(el.textContent?.trim() || ''));
            if (heading) {
                const section = heading.closest('section') || heading.parentElement?.parentElement;
                if (section) {
                    const candidateItems = section.querySelectorAll('[data-cmtid], div > div');
                    const filtered = Array.from(candidateItems).filter(el => {
                        const txt = el.textContent || '';
                        return el.getAttribute('data-cmtid') || (/\d{4}-\d{2}-\d{2}/.test(txt) && txt.length >= 20 && txt.length <= 1500);
                    });
                    if (filtered.length > 0) {
                        items = filtered;
                    }
                }
            }
        }

        if (items && items.length > 0) {
            items.forEach((item, index) => {
                // Tangkap data-cmtid asli jika tersedia (langsung atau dari parent terdekat)
                const cmtId = item.getAttribute('data-cmtid') || item.closest('[data-cmtid]')?.getAttribute('data-cmtid') || null;

                // Sematkan backup index anchor pada elemen DOM asli
                item.setAttribute('data-si-review-idx', String(index));

                // Ekstrak nama penulis
                const author = item.querySelector(
                    '.InK5kS, .shopee-product-rating__author-name, a[href*="/shop/buyer/"], a[href*="/buyer/"], [class*="author"]'
                )?.textContent?.trim() || null;

                // Ekstrak rating bintang
                const stars = item.querySelectorAll('.icon-rating-solid, svg[class*="icon-rating"], svg[class*="YBGCRA"]').length || 5;

                // Ekstrak isi ulasan
                let text = '';

                // Selector langsung untuk teks konten
                const textEl = item.querySelector(
                    'div.shopee-product-rating__content, div.meQyXP, div.YNedDV, div.Rk3V3e, div._28I_B3, [data-testid="comment-text"]'
                );

                if (textEl && textEl.textContent.trim().length >= 8) {
                    text = textEl.textContent.trim();
                } else {
                    // Fallback: clone node dan buang avatar, link buyer, svgs, dates, dan media
                    try {
                        const clone = item.cloneNode(true);
                        clone.querySelectorAll(
                            'a[href*="/buyer/"], svg, [class*="avatar"], .rating-media-list, img, [class*="media"]'
                        ).forEach(el => el.remove());
                        let raw = clone.textContent.replace(/\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}/g, '').trim();
                        if (raw.length >= 10 && raw.length <= 800) {
                            text = raw;
                        }
                    } catch (e) { }

                    if (!text) {
                        const candidateDivs = item.querySelectorAll('div, span, p');
                        for (const div of candidateDivs) {
                            const content = div.textContent?.trim() || '';
                            if (content.length >= 15 && content.length <= 600 && !/\d{4}-\d{2}-\d{2}/.test(content) && !/^(balas|komentar|variasi|beli)/i.test(content)) {
                                text = content;
                                break;
                            }
                        }
                    }
                }

                // Sanitasi Teks
                text = text
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                // Filter ulasan kosong atau terlalu pendek
                if (!text || text.length < 5) return;

                // Filter boilerplate murni jika ulasan sudah cukup banyak, tetapi jangan hilangkan jika ulasan masih sedikit (< 3)
                if (/^(pengiriman cepat|kurir ramah|barang sampai dengan selamat|makasih seller|mantap|mantap gan|sip|oke|bagus|barang belum dicoba semoga awet)([\s.,!]*)$/i.test(text)) {
                    if (rawReviews.length >= 3) {
                        return;
                    }
                }

                // Truncate teks agar hemat token Groq (maks 250 karakter)
                if (text.length > 250) {
                    text = text.substring(0, 250) + '...';
                }

                if (!seen.has(text)) {
                    seen.add(text);
                    rawReviews.push({
                        id: cmtId ? `shopee-cmt-${cmtId}` : `shopee-idx-${index}`,
                        cmtId,
                        index,
                        author,
                        rating: stars,
                        text
                    });
                }
            });
        }

        console.log(`[ShopeeAdapter] Ekstraksi ulasan selesai: ${rawReviews.length} ulasan valid.`);
        // Batasi maksimal 25 ulasan teratas
        return rawReviews.slice(0, 25);
    }
}

// Bind ke window object
window.ShopeeAdapter = ShopeeAdapter;
}
