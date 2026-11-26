/**
 * extension/content/native-search-parser.js
 * 
 * Content script pasif pada halaman pencarian marketplace (Shopee, Tokopedia, Lazada, Blibli).
 * Dijalankan dengan strategi Brief Active Window (ADR-04) dan dikendalikan oleh manifest deklaratif (ADR-06).
 * 
 * Karakteristik Ekstraksi Generik:
 * - Menggunakan string pattern yang dikonversi defensif via toRegExp() (ADR-03).
 * - Deteksi Hidrasi: Memastikan kartu memiliki link PDP terverifikasi dan memenuhi batas minTextLength.
 * - Anti-Iklan / Skeleton: Membuang kartu tanpa link PDP valid dan kartu promosi non-PDP.
 * - Hybrid Extraction: Atribut aria-label/title, regex harga/rating/terjual, dan selector modular.
 */

/**
 * Mengonversi nilai ke RegExp jika memungkinkan, atau return null jika tidak valid
 * @param {RegExp|string|any} value 
 * @returns {RegExp|null}
 */
function toRegExp(value) {
    if (value instanceof RegExp) return value;
    if (typeof value === 'string' || value instanceof String) {
        let cleaned = String(value).trim();
        if (cleaned.startsWith('/') && /\/[gimsuy]*$/.test(cleaned)) {
            cleaned = cleaned.replace(/^\//, '').replace(/\/[gimsuy]*$/, '');
        }
        try {
            return new RegExp(cleaned);
        } catch (e) {
            console.warn('[SI] invalid regex pattern:', value);
            return null;
        }
    }
    return null;
}

/**
 * Memeriksa apakah halaman dicegat oleh challenge CAPTCHA atau login wall
 * @param {Document} doc 
 * @param {object} manifest 
 * @returns {boolean}
 */
function checkBlocked(doc, manifest) {
    const selectors = manifest?.blockedSelectors || [
        '.shopee-captcha',
        '.geetest_holder',
        '[class*="verify-wrap"]',
        '[class*="login-container"]',
        '[class*="modal-login"]',
        'form[action*="login"]',
        '[data-testid="challenge-container"]',
        '#nc_1_wrapper'
    ];

    for (const sel of selectors) {
        if (doc.querySelector && doc.querySelector(sel)) {
            return true;
        }
    }
    return false;
}

/**
 * Mengambil daftar kartu produk yang valid (telah terhidrasi dan bukan iklan/skeleton)
 * @param {Document} doc 
 * @param {object} manifest 
 * @returns {Array<Element>}
 */
function getValidCards(doc, manifest) {
    if (!doc || !manifest) return [];

    const minTextLength = manifest.hydrationCheck?.minTextLength || 30;
    const rejectRe = toRegExp(manifest.rejectPattern);
    const pdpRe = toRegExp(manifest.pdpPattern);

    // Cari kartu dengan selektor utama atau fallback
    const primarySelector = manifest.cardSelector || '[data-sqe="item"]';
    let rawCards = [];

    try {
        rawCards = Array.from(doc.querySelectorAll(primarySelector));
    } catch (e) {
        // Fallback jika selector :has() belum didukung lingkungan uji
        if (manifest.cardSelectorFallback) {
            try {
                rawCards = Array.from(doc.querySelectorAll(manifest.cardSelectorFallback));
            } catch (err) {
                rawCards = [];
            }
        }
    }

    if (rawCards.length === 0 && manifest.cardSelectorFallback) {
        try {
            rawCards = Array.from(doc.querySelectorAll(manifest.cardSelectorFallback));
        } catch (err) { }
    }

    const linkSelector = manifest.fields?.link?.selector || 'a[href]';

    return rawCards.filter(card => {
        const linkEl = card.querySelector(linkSelector);
        if (!linkEl) return false;

        const href = linkEl.getAttribute('href') || linkEl.href || '';
        if (!href) return false;

        if (rejectRe && rejectRe.test(href)) return false;
        if (pdpRe && !pdpRe.test(href)) return false;

        const text = (card.innerText || card.textContent || '').trim();
        if (text.length < minTextLength) return false;

        return true;
    });
}

/**
 * Helper: Menghasilkan base origin URL berdasarkan id marketplace
 * @param {string} marketplaceId 
 * @returns {string}
 */
function getMarketplaceOrigin(marketplaceId) {
    switch (marketplaceId) {
        case 'tokopedia': return 'https://www.tokopedia.com';
        case 'lazada': return 'https://www.lazada.co.id';
        case 'blibli': return 'https://www.blibli.com';
        case 'shopee':
        default: return 'https://shopee.co.id';
    }
}

/**
 * Mengekstrak field dari satu elemen kartu produk secara generik berdasarkan manifest
 * @param {Element} card 
 * @param {object} manifest 
 * @returns {object|null}
 */
function extractCard(card, manifest) {
    if (!card || !manifest) return null;

    const linkSelector = manifest.fields?.link?.selector || 'a[href]';
    const linkEl = card.querySelector(linkSelector);
    if (!linkEl) return null;

    let rawHref = linkEl.getAttribute('href') || linkEl.href || '';
    if (!rawHref) return null;

    const rejectRe = toRegExp(manifest.rejectPattern);
    const pdpRe = toRegExp(manifest.pdpPattern);

    // Tolak URL bukan PDP
    if (rejectRe && rejectRe.test(rawHref)) {
        return null;
    }
    if (pdpRe && !pdpRe.test(rawHref)) {
        return null;
    }

    // Bangun URL absolut
    let finalUrl = rawHref;
    if (finalUrl.startsWith('/')) {
        finalUrl = getMarketplaceOrigin(manifest.id) + finalUrl;
    }
    try {
        const parsed = new URL(finalUrl);
        // Bersihkan parameter tracking berlebih
        finalUrl = parsed.origin + parsed.pathname;
    } catch (e) { }

    const innerText = card.innerText || card.textContent || '';

    // 1. Ekstraksi Judul (Aria-label -> Selector -> Fallback Text)
    let title = '';
    const titleConfig = manifest.fields?.title || {};
    if (titleConfig.fromAriaLabel) {
        const ariaLabel = card.getAttribute('aria-label');
        const ariaRe = toRegExp(titleConfig.fromAriaLabel);
        if (ariaLabel && ariaRe && ariaRe.test(ariaLabel)) {
            title = ariaLabel.replace(ariaRe, '').trim();
        } else if (ariaLabel) {
            title = ariaLabel.trim();
        }
    }

    if (!title && titleConfig.selector) {
        const titleEl = card.querySelector(titleConfig.selector);
        if (titleEl) {
            if (titleConfig.attribute) {
                title = (titleEl.getAttribute(titleConfig.attribute) || '').trim();
            }
            if (!title) {
                title = (titleEl.innerText || titleEl.textContent || '').trim();
            }
        }
    }

    if (!title && titleConfig.fallbackSelector) {
        const fbEl = card.querySelector(titleConfig.fallbackSelector);
        if (fbEl) {
            title = (fbEl.innerText || fbEl.textContent || '').trim();
        }
    }

    if (!title) {
        const lines = innerText.split('\n').map(l => l.trim()).filter(Boolean);
        title = lines[0] || '';
    }

    // 2. Ekstraksi Harga
    let price = null;
    const priceConfig = manifest.fields?.price || {};
    const priceSourceText = priceConfig.selector
        ? ((card.querySelector(priceConfig.selector)?.innerText || innerText))
        : innerText;

    const priceRegex = toRegExp(priceConfig.regex || 'Rp\\s*([\\d.]+)');
    const priceMatch = priceSourceText.match(priceRegex);
    if (priceMatch && priceMatch[priceConfig.group || 1]) {
        const cleanDigits = priceMatch[priceConfig.group || 1].replace(/\D/g, '');
        const pNum = parseInt(cleanDigits, 10);
        if (!isNaN(pNum) && pNum > 0) {
            price = pNum;
        }
    }

    // Penanganan micro-unit Shopee
    if (price && manifest.id === 'shopee' && price > 100000000) {
        price = Math.round(price / 100000);
    }

    // Smart Fallback (CR-002 / ADR-09): Jika harga di kartu tidak ditemukan, cari dari <script type="application/ld+json"> di document
    if (price === null && typeof document !== 'undefined') {
        try {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scripts) {
                const text = script.textContent?.trim() || '';
                if (!text) continue;
                if (!text.includes(finalUrl) && (!title || !text.includes(title))) continue;
                try {
                    const parsedData = JSON.parse(text);
                    const items = Array.isArray(parsedData)
                        ? parsedData
                        : (parsedData.itemListElement || [parsedData]);

                    for (const item of items) {
                        const prod = item.item || item;
                        if (!prod) continue;
                        const itemUrl = prod.url || '';
                        const itemName = prod.name || '';
                        if (itemUrl === finalUrl || (title && itemName && itemName.includes(title))) {
                            const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
                            if (offer && offer.price) {
                                const pVal = Math.round(parseFloat(offer.price));
                                if (!isNaN(pVal) && pVal > 0) {
                                    price = pVal;
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) { }
                if (price !== null) break;
            }
        } catch (e) { }
    }

    // 3. Ekstraksi Rating
    let rating = null;
    const ratingConfig = manifest.fields?.rating || {};
    if (ratingConfig.selector) {
        const ratingEl = card.querySelector(ratingConfig.selector);
        if (ratingEl) {
            const rText = ratingEl.innerText || ratingEl.textContent || '';
            const rRe = toRegExp(ratingConfig.fallbackRegex || '(\\d\\.\\d)');
            const rMatch = rText.match(rRe);
            if (rMatch && rMatch[1]) {
                const rVal = parseFloat(rMatch[1].replace(',', '.'));
                if (!isNaN(rVal)) rating = rVal;
            }
        }
    }

    if (rating === null && ratingConfig.afterSelector) {
        const starEl = card.querySelector(ratingConfig.afterSelector);
        if (starEl && starEl.nextElementSibling) {
            const nextText = starEl.nextElementSibling.innerText || '';
            const rVal = parseFloat(nextText.replace(',', '.'));
            if (!isNaN(rVal) && rVal >= 0 && rVal <= 5) rating = rVal;
        }
    }

    if (rating === null && ratingConfig.fallbackRegex) {
        const rMatch = innerText.match(toRegExp(ratingConfig.fallbackRegex));
        if (rMatch && rMatch[1]) {
            const rVal = parseFloat(rMatch[1].replace(',', '.'));
            if (!isNaN(rVal) && rVal >= 0 && rVal <= 5) rating = rVal;
        }
    }

    // 4. Ekstraksi Terjual (Sold)
    let sold = null;
    const soldConfig = manifest.fields?.sold;
    if (soldConfig) {
        const soldRegex = toRegExp(soldConfig.regex || '(\\d+)\\s*terjual');
        const soldMatch = innerText.match(soldRegex);
        if (soldMatch && soldMatch[soldConfig.group || 1]) {
            const sNum = parseInt(soldMatch[soldConfig.group || 1], 10);
            if (!isNaN(sNum)) sold = sNum;
        }
    }

    // 5. Ekstraksi Lokasi Toko
    let location = null;
    const locConfig = manifest.fields?.location;
    if (locConfig?.selector) {
        const locEl = card.querySelector(locConfig.selector);
        if (locEl) {
            location = (locEl.innerText || locEl.textContent || '').trim();
        }
    }

    // 6. Ekstraksi Nama Toko (shopName)
    let shopName = null;
    const shopConfig = manifest.fields?.shopName;
    if (shopConfig && shopConfig.selector) {
        const shopEl = card.querySelector(shopConfig.selector);
        if (shopEl) {
            shopName = (shopEl.innerText || shopEl.textContent || '').trim();
        }
    }

    // 7. Ekstraksi Gambar (imageUrl) (ADR-11)
    let imageUrl = null;
    const imageConfig = manifest.fields?.image;
    if (imageConfig?.selector) {
        let imgElements = [];
        if (typeof card.querySelectorAll === 'function') {
            try {
                imgElements = Array.from(card.querySelectorAll(imageConfig.selector));
            } catch (e) {
                imgElements = [];
            }
        }
        if (imgElements.length === 0 && typeof card.querySelector === 'function') {
            try {
                const singleImg = card.querySelector(imageConfig.selector);
                if (singleImg) imgElements = [singleImg];
            } catch (e) { }
        }

        const attributes = imageConfig.attributes || ['src', 'data-src', 'data-lazy-src', 'srcset'];
        const rejectPatterns = (imageConfig.rejectPatterns || ['data:image', 'blank', 'placeholder', '1x1'])
            .map(p => toRegExp(p))
            .filter(Boolean);

        for (const imgEl of imgElements) {
            for (const attr of attributes) {
                let val = imgEl.getAttribute(attr);
                if (!val || typeof val !== 'string') continue;
                val = val.trim();
                if (!val) continue;

                if (attr === 'srcset' || val.includes(' ') || val.includes(',')) {
                    const firstPart = val.split(',')[0].trim().split(/\s+/)[0].trim();
                    if (firstPart) val = firstPart;
                }

                if (val.startsWith('//')) {
                    val = 'https:' + val;
                }

                const isRejected = rejectPatterns.some(rx => rx.test(val));
                if (isRejected) continue;

                if (/^https?:\/\//i.test(val)) {
                    imageUrl = val;
                    break;
                }
            }
            if (imageUrl) break;
        }
    }

    // 8. Fallback: Ekstraksi gambar generik dari tag <img> di dalam kartu jika selector manifest tidak menemukan hasil (CR-005)
    if (!imageUrl && card) {
        let fallbackImgEls = [];
        if (typeof card.querySelectorAll === 'function') {
            try {
                fallbackImgEls = Array.from(card.querySelectorAll('img'));
            } catch (e) {
                fallbackImgEls = [];
            }
        }
        const fallbackAttrs = ['src', 'data-src', 'data-lazy-src', 'srcset', 'data-orig-src'];
        const rejectPatterns = ['data:image', 'blank', 'placeholder', '1x1'].map(p => toRegExp(p)).filter(Boolean);

        for (const imgEl of fallbackImgEls) {
            for (const attr of fallbackAttrs) {
                let val = imgEl.getAttribute ? imgEl.getAttribute(attr) : null;
                if (!val || typeof val !== 'string') continue;
                val = val.trim();
                if (!val) continue;

                if (attr === 'srcset' || val.includes(' ') || val.includes(',')) {
                    const firstPart = val.split(',')[0].trim().split(/\s+/)[0].trim();
                    if (firstPart) val = firstPart;
                }

                if (val.startsWith('//')) {
                    val = 'https:' + val;
                }

                const isRejected = rejectPatterns.some(rx => rx.test(val));
                if (isRejected) continue;

                if (/^https?:\/\//i.test(val)) {
                    imageUrl = val;
                    break;
                }
            }
            if (imageUrl) break;
        }
    }

    return {
        title: title,
        price: price,
        url: finalUrl,
        imageUrl: imageUrl,
        rating: rating,
        sold: sold,
        location: location,
        shopName: shopName,
        source: manifest.id,
        provenance: 'native-assisted',
        raw: {
            innerTextSnippet: innerText.slice(0, 150)
        }
    };
}

// Alias untuk kompatibilitas ke belakang dengan test suite lama
const extractShopeeCard = extractCard;

/**
 * Menunggu hidrasi DOM selesai melalui polling 500ms dan mengekstrak kandidat
 * @param {Document} doc 
 * @param {object} manifest 
 * @param {Function} [onProgress] 
 * @returns {Promise<{ status: string, candidates?: Array<object>, reason?: string, count?: number }>}
 */
async function waitForHydrationAndExtract(doc, manifest, onProgress = null) {
    const minValidCards = manifest?.hydrationCheck?.minValidCards || 5;
    const timeoutMs = manifest?.hydrationCheck?.timeout || 15000;
    const pollingInterval = manifest?.hydrationCheck?.pollingInterval || 500;

    const startTime = Date.now();

    return new Promise((resolve) => {
        const intervalId = setInterval(() => {
            const elapsed = Date.now() - startTime;

            // 1. Cek Checkpoint Keamanan / CAPTCHA
            if (checkBlocked(doc, manifest)) {
                clearInterval(intervalId);
                return resolve({
                    status: 'BLOCKED',
                    reason: `Verifikasi keamanan / CAPTCHA terdeteksi di halaman ${manifest?.name || 'marketplace'}`
                });
            }

            // 2. Hitung Kartu Valid (bukan skeleton, ada link PDP)
            const validCards = getValidCards(doc, manifest);
            const count = validCards.length;

            if (typeof onProgress === 'function') {
                onProgress(count, minValidCards);
            }

            // 3. Syarat Selesai: Minimal kartu valid terhidrasi terpenuhi
            if (count >= minValidCards) {
                clearInterval(intervalId);

                const extracted = [];
                for (const card of validCards) {
                    const parsed = extractCard(card, manifest);
                    if (parsed && parsed.price !== null) {
                        extracted.push(parsed);
                    }
                }

                return resolve({
                    status: 'OK',
                    candidates: extracted,
                    count: extracted.length
                });
            }

            // 4. Syarat Timeout: Waktu habis (15 detik)
            if (elapsed >= timeoutMs) {
                clearInterval(intervalId);

                if (count > 0) {
                    const extracted = validCards
                        .map(c => extractCard(c, manifest))
                        .filter(p => p && p.price !== null);

                    return resolve({
                        status: 'OK',
                        candidates: extracted,
                        count: extracted.length
                    });
                }

                return resolve({
                    status: 'TIMEOUT',
                    reason: `Batas waktu hidrasi ${manifest?.name || 'marketplace'} habis (${timeoutMs / 1000}s) dengan kartu valid ${count}`
                });
            }
        }, pollingInterval);
    });
}

// Inisialisasi Chrome Runtime Listener jika berjalan di dalam browser tab
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'EXTRACT_SEARCH_RESULTS') {
            const manifest = request.manifest || (typeof window !== 'undefined' ? window.shopeeManifest : null);

            // Cek langsung jika langsung terblokir
            if (checkBlocked(document, manifest)) {
                sendResponse({ status: 'BLOCKED', reason: 'Tantangan keamanan terdeteksi' });
                return true;
            }

            waitForHydrationAndExtract(document, manifest, (current, total) => {
                try {
                    chrome.runtime.sendMessage({
                        action: 'SEARCH_PAGE_READY',
                        marketplace: manifest?.id || 'marketplace',
                        ready: true,
                        validCards: current
                    });
                } catch (e) { }
            }).then(result => {
                sendResponse(result);
            }).catch(err => {
                sendResponse({ status: 'ERROR', error: err.message });
            });

            return true; // Asynchronous sendResponse
        }
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        toRegExp,
        checkBlocked,
        getValidCards,
        extractCard,
        extractShopeeCard,
        waitForHydrationAndExtract
    };
}
if (typeof window !== 'undefined') {
    window.NativeSearchParser = {
        toRegExp,
        checkBlocked,
        getValidCards,
        extractCard,
        extractShopeeCard,
        waitForHydrationAndExtract
    };
}
