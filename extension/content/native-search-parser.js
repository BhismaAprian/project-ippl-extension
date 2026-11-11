/**
 * extension/content/native-search-parser.js
 * 
 * Content script pasif pada halaman pencarian Shopee (https://shopee.co.id/search*).
 * Dijalankan dengan strategi Brief Active Window.
 * 
 * Karakteristik Ekstraksi (Berdasarkan Temuan Empiris):
 * - Tailwind CSS: Tidak ada class harga/rating khusus.
 * - Deteksi Hidrasi: Memastikan kartu memiliki link PDP a[href*="-i."] DAN innerText.length > 50.
 * - Anti-Iklan: Hanya memproses kartu dengan link PDP valid, membuang 45+ kartu iklan/banner.
 * - Hybrid Extraction: aria-label untuk judul, regex untuk harga/rating/terjual, selector untuk link & lokasi.
 * - shopName: SELALU null (Shopee tidak menampilkan nama toko pada kartu pencarian).
 */

/**
 * Mengonversi nilai ke RegExp jika memungkinkan, atau return null jika tidak valid
 * @param {RegExp|string|any} value 
 * @returns {RegExp|null}
 */
function toRegExp(value) {
    if (value instanceof RegExp) return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/^\/|\/[gimsuy]*$/g, '');
        try { return new RegExp(cleaned); }
        catch (e) { console.warn('[SI] invalid regex:', value); return null; }
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
        'form[action*="login"]'
    ];

    for (const sel of selectors) {
        if (doc.querySelector(sel)) {
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
    const minTextLength = manifest?.hydrationCheck?.minTextLength || 50;
    const rejectRe = toRegExp(manifest?.rejectPattern);
    const pdpRe = toRegExp(manifest?.pdpPattern);

    // Cari kartu dengan selektor utama atau fallback
    const rawCards = Array.from(doc.querySelectorAll('[data-sqe="item"]'));

    return rawCards.filter(card => {
        const linkEl = card.querySelector('a[href*="-i."]');
        if (!linkEl) return false;

        const href = linkEl.getAttribute('href') || linkEl.href || '';
        if (rejectRe && rejectRe.test(href)) return false;
        if (pdpRe && !pdpRe.test(href)) return false;

        const text = (card.innerText || '').trim();
        if (text.length <= minTextLength) return false;

        return true;
    });
}

/**
 * Mengekstrak field dari satu elemen kartu produk secara hybrid
 * @param {Element} card 
 * @param {object} manifest 
 * @returns {object|null}
 */
function extractShopeeCard(card, manifest) {
    if (!card) return null;

    const linkEl = card.querySelector('a[href*="-i."]');
    if (!linkEl) return null;

    let rawHref = linkEl.getAttribute('href') || linkEl.href || '';
    if (!rawHref) return null;

    const rejectRe = toRegExp(manifest?.rejectPattern);
    const pdpRe = toRegExp(manifest?.pdpPattern);

    // Tolak URL bukan PDP (misal: find_similar_products)
    if (rejectRe && rejectRe.test(rawHref)) {
        return null;
    }
    if (pdpRe && !pdpRe.test(rawHref)) {
        return null;
    }

    // Bangun URL absolut
    let finalUrl = rawHref;
    if (finalUrl.startsWith('/')) {
        finalUrl = 'https://shopee.co.id' + finalUrl;
    }
    // Bersihkan parameter query tracking berlebih dari URL
    try {
        const parsed = new URL(finalUrl);
        finalUrl = parsed.origin + parsed.pathname;
    } catch (e) { }

    const innerText = card.innerText || '';

    // 1. Ekstraksi Judul: aria-label wrapper utama ATAU fallback baris pertama teks
    let title = '';
    const ariaLabel = card.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.startsWith('Product card:')) {
        title = ariaLabel.replace(/^Product card:\s*/, '').trim();
    }
    if (!title) {
        const titleEl = card.querySelector('[class*="line-clamp-2"]');
        title = titleEl ? titleEl.innerText.trim() : innerText.split('\n')[0].trim();
    }

    // 2. Ekstraksi Harga: regex /Rp\s*([\d.]+)/ dari innerText
    let price = null;
    const priceMatch = innerText.match(/Rp\s*([\d.]+)/);
    if (priceMatch && priceMatch[1]) {
        const cleanDigits = priceMatch[1].replace(/\D/g, '');
        const pNum = parseInt(cleanDigits, 10);
        if (!isNaN(pNum) && pNum > 0) {
            price = pNum;
        }
    }
    if (price === null) {
        const truncatePriceEl = card.querySelector('[class*="truncate text-base/5"]');
        if (truncatePriceEl) {
            const pNum = parseInt(truncatePriceEl.innerText.replace(/\D/g, ''), 10);
            if (!isNaN(pNum) && pNum > 0) price = pNum;
        }
    }

    // 3. Ekstraksi Rating: angka setelah icon bintang atau regex /(\d+\.\d+)/
    let rating = null;
    const starImg = card.querySelector('img[alt="rating-star"]');
    if (starImg && starImg.nextElementSibling) {
        const rVal = parseFloat(starImg.nextElementSibling.innerText.trim());
        if (!isNaN(rVal) && rVal >= 1 && rVal <= 5) rating = rVal;
    }
    if (rating === null) {
        const ratingMatch = innerText.match(/\n(\d\.\d)\n/);
        if (ratingMatch && ratingMatch[1]) {
            const rVal = parseFloat(ratingMatch[1]);
            if (!isNaN(rVal) && rVal >= 1 && rVal <= 5) rating = rVal;
        }
    }

    // 4. Ekstraksi Terjual
    let sold = null;
    const soldMatch = innerText.match(/(\d+)\s*terjual/);
    if (soldMatch && soldMatch[1]) {
        sold = parseInt(soldMatch[1], 10);
    }

    // 5. Ekstraksi Lokasi
    const locEl = card.querySelector('[class*="text-shopee-black54"]');
    const location = locEl ? locEl.innerText.trim() : null;

    // 6. Shop Name: SELALU null (Shopee tidak menampilkan nama toko di kartu pencarian)
    const shopName = null;

    return {
        title: title || 'Produk Shopee',
        url: finalUrl,
        price: price,
        rating: rating,
        sold: sold,
        location: location,
        shopName: shopName,
        source: 'shopee',
        provenance: 'native-assisted',
        raw: {
            innerTextSnippet: innerText.slice(0, 150)
        }
    };
}

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
                    reason: 'Verifikasi keamanan / CAPTCHA terdeteksi di halaman Shopee'
                });
            }

            // 2. Hitung Kartu Valid (bukan skeleton, ada link PDP)
            const validCards = getValidCards(doc, manifest);
            const count = validCards.length;

            if (typeof onProgress === 'function') {
                onProgress(count, minValidCards);
            }

            // 3. Syarat Selesai: Minimal 5 kartu valid terhidrasi
            if (count >= minValidCards) {
                clearInterval(intervalId);

                const extracted = [];
                for (const card of validCards) {
                    const parsed = extractShopeeCard(card, manifest);
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

                // Coba ekstraksi seadanya jika ada kartu valid
                if (count > 0) {
                    const extracted = validCards
                        .map(c => extractShopeeCard(c, manifest))
                        .filter(p => p && p.price !== null);

                    return resolve({
                        status: 'OK',
                        candidates: extracted,
                        count: extracted.length
                    });
                }

                return resolve({
                    status: 'TIMEOUT',
                    reason: `Batas waktu hidrasi Shopee habis (${timeoutMs / 1000}s) dengan kartu valid ${count}`
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
                        marketplace: 'shopee',
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
        extractShopeeCard,
        waitForHydrationAndExtract
    };
}
if (typeof window !== 'undefined') {
    window.NativeSearchParser = {
        toRegExp,
        checkBlocked,
        getValidCards,
        extractShopeeCard,
        waitForHydrationAndExtract
    };
}
