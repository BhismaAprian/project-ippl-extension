/**
 * service-worker.js
 * 
 * Script ini berjalan di background (Service Worker MV3).
 * 1. Mengatur perilaku Chrome Side Panel agar otomatis terbuka saat icon ekstensi diklik.
 * 2. Mengelola lifecycle tab pencarian native (Brief Active Window: buka active:true, hidrasi, ekstrak, tutup tab).
 * 3. Menjamin cleanup tab saat service worker restart/wake atau jika user menutup tab manual.
 */

// Konfigurasi Chrome Side Panel agar terbuka saat action icon diklik
if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .then(() => {
            console.log('[Shopping Intelligence] Side panel behavior configured: openPanelOnActionClick = true');
        })
        .catch((error) => {
            console.warn('[Shopping Intelligence] Error setting side panel behavior:', error);
        });
}

// Inisialisasi saat instalasi / pembaruan ekstensi
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled?.addListener) {
    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason === 'install') {
            console.log('[Shopping Intelligence] Extension installed. Version: 0.2.0');
            chrome.storage.local.set({
                installedAt: new Date().toISOString(),
                version: '0.2.0'
            });
        } else if (details.reason === 'update') {
            console.log('[Shopping Intelligence] Extension updated to version 0.2.0');
            chrome.storage.local.set({
                version: '0.2.0'
            });
        }
    });
}

// =========================================================================
// Cleanup on Service Worker Wake: Tutup tab pencarian sisa jika sesi crash
// =========================================================================
async function cleanupLeftoverTabs() {
    if (!chrome.storage?.session) return;
    try {
        const data = await chrome.storage.session.get(['activeNativeTabs']);
        const tabs = data?.activeNativeTabs || [];
        if (Array.isArray(tabs) && tabs.length > 0) {
            console.log('[Shopping Intelligence] Menutup tab pencarian sisa:', tabs);
            for (const tid of tabs) {
                try {
                    await chrome.tabs.remove(tid);
                } catch (e) { }
            }
            await chrome.storage.session.remove(['activeNativeTabs']);
        }
    } catch (err) {
        console.warn('[Shopping Intelligence] Error saat cleanup session tabs:', err);
    }
}
cleanupLeftoverTabs();

// Helper untuk menambah dan menghapus tabId dari session storage
async function registerActiveTab(tabId) {
    if (!chrome.storage?.session) return;
    try {
        const data = await chrome.storage.session.get(['activeNativeTabs']);
        const current = data?.activeNativeTabs || [];
        if (!current.includes(tabId)) {
            current.push(tabId);
            await chrome.storage.session.set({ activeNativeTabs: current });
        }
    } catch (e) { }
}

async function unregisterActiveTab(tabId) {
    if (!chrome.storage?.session) return;
    try {
        const data = await chrome.storage.session.get(['activeNativeTabs']);
        const current = (data?.activeNativeTabs || []).filter(id => id !== tabId);
        await chrome.storage.session.set({ activeNativeTabs: current });
    } catch (e) { }
}

async function isTabRegistered(tabId) {
    if (!chrome.storage?.session) return false;
    try {
        const data = await chrome.storage.session.get(['activeNativeTabs']);
        const current = data?.activeNativeTabs || [];
        return current.includes(tabId);
    } catch (e) {
        return false;
    }
}

// =========================================================================
// Listener Tab Removed: Deteksi jika user menutup tab pencarian secara manual
// =========================================================================
if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener(async (tabId) => {
        const isOurTab = await isTabRegistered(tabId);
        if (isOurTab) {
            console.log('[Shopping Intelligence] Tab pencarian ditutup manual oleh pengguna:', tabId);
            await unregisterActiveTab(tabId);

            // Beritahu Side Panel bahwa pencarian dibatalkan oleh pengguna
            try {
                chrome.runtime.sendMessage({
                    action: 'SEARCH_ERROR',
                    marketplace: 'shopee',
                    success: false,
                    status: 'CANCELLED_BY_USER',
                    error: 'Kamu menutup tab Shopee sebelum selesai membaca hasil.'
                });
            } catch (e) { }
        }
    });
}

// =========================================================================
// Fungsi Eksekusi Pencarian Native: Brief Active Window (active: true)
// =========================================================================
async function openAndExtractSearchTab(query, manifest) {
    const marketplace = manifest?.id || 'shopee';
    const searchUrl = (manifest?.searchUrlTemplate || 'https://shopee.co.id/search?keyword={q}')
        .replace('{q}', encodeURIComponent(query));

    let createdTab = null;
    let isCancelled = false;

    const notifyProgress = (status, message, current = null, total = null) => {
        try {
            chrome.runtime.sendMessage({
                action: 'SEARCH_PROGRESS',
                marketplace: marketplace,
                status: status,
                message: message,
                current: current,
                total: total
            });
        } catch (e) { }
    };

    try {
        notifyProgress('OPENING', 'Membuka tab pencarian Shopee...');

        // 1. Buka tab dengan active: true (Brief Active Window wajib untuk hidrasi)
        createdTab = await chrome.tabs.create({
            url: searchUrl,
            active: true
        });

        await registerActiveTab(createdTab.id);

        // 2. Tunggu tab selesai memuat dokumen awal (status: complete)
        await new Promise((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
                cleanupListener();
                resolve(); // Lanjutkan meskipun listener status timeout, parser akan menunggu hidrasi
            }, 6000);

            function onUpdated(tabId, changeInfo) {
                if (tabId === createdTab.id && changeInfo.status === 'complete') {
                    cleanupListener();
                    resolve();
                }
            }

            function cleanupListener() {
                clearTimeout(timeoutTimer);
                chrome.tabs.onUpdated.removeListener(onUpdated);
            }

            chrome.tabs.onUpdated.addListener(onUpdated);
        });

        // Pastikan tab masih eksis
        try {
            await chrome.tabs.get(createdTab.id);
        } catch (e) {
            isCancelled = true;
            return {
                status: 'CANCELLED_BY_USER',
                error: 'Tab ditutup manual oleh pengguna'
            };
        }

        notifyProgress('WAITING_DOM', 'Menunggu kartu produk selesai terhidrasi...');

        // 3. Pastikan content script native-search-parser terinjeksi
        try {
            await chrome.scripting.executeScript({
                target: { tabId: createdTab.id },
                files: ['content/native-search-parser.js']
            });
        } catch (scriptErr) {
            // Jika sudah terdaftar secara deklaratif pada manifest.json, ini aman dilewati
        }

        notifyProgress('EXTRACTING', 'Membaca kartu produk dari halaman...');

        // 4. Kirim pesan ekstraksi ke content script di tab
        const extractResult = await new Promise((resolve) => {
            chrome.tabs.sendMessage(createdTab.id, {
                action: 'EXTRACT_SEARCH_RESULTS',
                manifest: manifest
            }, (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.warn('[ServiceWorker] Gagal berkomunikasi dengan content script:', err.message);
                    return resolve({ status: 'TIMEOUT', reason: 'Content script tidak merespon' });
                }
                resolve(response || { status: 'ERROR', error: 'Tidak ada data diterima dari parser' });
            });
        });

        return extractResult;

    } catch (err) {
        console.error('[ServiceWorker] Error saat menjalankan pencarian native:', err);
        return {
            status: 'ERROR',
            error: err.message || 'Kesalahan internal service worker'
        };
    } finally {
        // 5. Cleanup Tab: SELALU tutup tab di finally block dalam kondisi apa pun
        if (createdTab && createdTab.id) {
            notifyProgress('CLOSING', 'Menutup tab pencarian...');
            await unregisterActiveTab(createdTab.id);
            try {
                await chrome.tabs.remove(createdTab.id);
                console.log('[Shopping Intelligence] Tab pencarian berhasil ditutup:', createdTab.id);
            } catch (e) { }
        }
    }
}

// =========================================================================
// Deep Enrichment & Smart Fallback (CR-002 / ADR-09)
// Mengambil harga & rating dari PDP untuk kandidat EXACT/EQUIVALENT yang kosong
// =========================================================================

/**
 * Ekstraksi detail produk PDP menggunakan tab tersembunyi (active: false)
 * Memanfaatkan Adapter PDP marketplace terkait (Shopee, Tokopedia, Lazada, Blibli)
 * @param {object} candidate - Objek kandidat produk
 * @returns {Promise<object|null>} Data hasil ekstraksi { price, rating, seller }
 */
async function enrichSingleCandidatePdp(candidate) {
    if (!candidate || !candidate.url) return null;

    let tab = null;
    try {
        // 1. Buka tab dengan active: false (tersembunyi di latar belakang)
        tab = await chrome.tabs.create({
            url: candidate.url,
            active: false
        });

        if (!tab || !tab.id) return null;
        await registerActiveTab(tab.id);

        // 2. Tunggu tab selesai memuat dokumen (status: complete) dengan batas timeout 6 detik
        if (tab.status !== 'complete') {
            await new Promise((resolve) => {
                const timeoutTimer = setTimeout(() => {
                    cleanupListener();
                    resolve(); // Lanjutkan meskipun timeout tercapai
                }, 6000);

                function onUpdated(tabId, changeInfo) {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        cleanupListener();
                        resolve();
                    }
                }

                function cleanupListener() {
                    clearTimeout(timeoutTimer);
                    if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated?.removeListener) {
                        chrome.tabs.onUpdated.removeListener(onUpdated);
                    }
                }

                if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated?.addListener) {
                    chrome.tabs.onUpdated.addListener(onUpdated);
                } else {
                    resolve();
                }
            });
        }

        // Pastikan tab masih eksis
        try {
            await chrome.tabs.get(tab.id);
        } catch (e) {
            return null;
        }

        // 3. Eksekusi script ekstraksi di tab PDP
        if (typeof chrome !== 'undefined' && chrome.scripting && typeof chrome.scripting.executeScript === 'function') {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    try {
                        const currentUrl = window.location.href;

                        // 3.1 Coba gunakan Adapter PDP yang sudah terdaftar di window tab
                        const adapters = [
                            typeof window.ShopeeAdapter === 'function' ? new window.ShopeeAdapter() : null,
                            typeof window.TokopediaAdapter === 'function' ? new window.TokopediaAdapter() : null,
                            typeof window.LazadaAdapter === 'function' ? new window.LazadaAdapter() : null,
                            typeof window.BlibliAdapter === 'function' ? new window.BlibliAdapter() : null
                        ].filter(Boolean);

                        const adapter = adapters.find(a => a.matchesUrl(currentUrl));
                        if (adapter && typeof adapter.extractProduct === 'function') {
                            const prod = adapter.extractProduct();
                            if (prod && (prod.price !== null || prod.rating !== null || prod.imageUrl)) {
                                return {
                                    price: prod.price || null,
                                    rating: prod.rating || null,
                                    seller: prod.seller || null,
                                    imageUrl: prod.imageUrl || null
                                };
                            }
                        }

                        // 3.2 Fallback: Schema.org JSON-LD
                        const jsonLds = document.querySelectorAll('script[type="application/ld+json"]');
                        for (const s of jsonLds) {
                            try {
                                const data = JSON.parse(s.textContent);
                                if (data['@type'] === 'Product' || data['@type'] === 'https://schema.org/Product') {
                                    const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
                                    let price = null;
                                    if (offer && offer.price) {
                                        const p = Math.round(parseFloat(offer.price));
                                        if (!isNaN(p) && p > 0) price = p;
                                    }
                                    let rating = null;
                                    if (data.aggregateRating && data.aggregateRating.ratingValue) {
                                        const r = parseFloat(data.aggregateRating.ratingValue);
                                        if (!isNaN(r)) rating = r;
                                    }
                                    let imageUrl = null;
                                    if (data.image) {
                                        const rawImg = Array.isArray(data.image) ? data.image[0] : (typeof data.image === 'object' ? data.image.url : data.image);
                                        if (typeof rawImg === 'string' && /^https?:\/\//i.test(rawImg)) imageUrl = rawImg;
                                    }
                                    if (price !== null || rating !== null || imageUrl !== null) {
                                        return { price, rating, seller: offer?.seller?.name || null, imageUrl };
                                    }
                                }
                            } catch (e) { }
                        }

                        // 3.3 Fallback: OpenGraph Meta
                        const ogPrice = document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content');
                        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
                        let p = null;
                        if (ogPrice) {
                            const parsed = Math.round(parseFloat(ogPrice));
                            if (!isNaN(parsed) && parsed > 0) p = parsed;
                        }
                        let img = null;
                        if (ogImage && /^https?:\/\//i.test(ogImage)) {
                            img = ogImage;
                        }
                        if (p !== null || img !== null) {
                            return { price: p, rating: null, seller: null, imageUrl: img };
                        }

                        return null;
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            });

            if (Array.isArray(results) && results.length > 0 && results[0].result) {
                return results[0].result;
            }
        }

        return null;
    } catch (err) {
        console.warn('[ServiceWorker:DeepEnrichment] Gagal mengekstrak data PDP:', candidate.url, err.message);
        return null;
    } finally {
        // JAMINAN MUTLAK: Selalu tutup tab di finally block dalam kondisi apa pun
        if (tab && tab.id) {
            await unregisterActiveTab(tab.id);
            try {
                await chrome.tabs.remove(tab.id);
                console.log('[ServiceWorker:DeepEnrichment] Tab enrichment berhasil ditutup:', tab.id);
            } catch (e) { }
        }
    }
}

/**
 * Melakukan Deep Enrichment untuk kandidat yang memiliki harga atau gambar kosong (ADR-09 & ADR-11)
 * Membuka tab tersembunyi (active: false) secara sekuensial (maksimal 3 kandidat)
 * @param {Array<object>} candidates 
 * @returns {Promise<Array<object>>}
 */
async function enrichMissingData(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return candidates || [];
    }

    // Filter kandidat: (price === null/0 || !imageUrl) DAN matchType adalah 'EXACT' atau 'EQUIVALENT'
    const eligibleIndices = [];
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const isDataMissing = c && (c.price === null || c.price === undefined || c.price === 0 || !c.imageUrl);
        const isMatchEligible = c && (c.matchType === 'EXACT' || c.matchType === 'EQUIVALENT');
        const hasUrl = c && typeof c.url === 'string' && c.url.trim().length > 0;

        if (isDataMissing && isMatchEligible && hasUrl) {
            eligibleIndices.push(i);
            if (eligibleIndices.length >= 3) {
                // Batasi maksimal 3 kandidat per pencarian
                break;
            }
        }
    }

    if (eligibleIndices.length === 0) {
        return candidates;
    }

    console.log(`[ServiceWorker:DeepEnrichment] Memulai enrichment untuk ${eligibleIndices.length} kandidat secara sekuensial.`);

    // Eksekusi SECARA SEKUENSIAL (for ... of, BUKAN paralel Promise.all)
    for (const idx of eligibleIndices) {
        const candidate = candidates[idx];
        try {
            const enrichedData = await enrichSingleCandidatePdp(candidate);
            if (enrichedData && typeof enrichedData === 'object') {
                if (enrichedData.price !== null && enrichedData.price !== undefined) {
                    candidate.price = enrichedData.price;
                    candidate.enriched = true;
                    candidate.enrichmentSource = 'deep-pdp-adapter';
                }
                if (enrichedData.rating !== null && enrichedData.rating !== undefined && candidate.rating === null) {
                    candidate.rating = enrichedData.rating;
                }
                if (enrichedData.seller && !candidate.shopName) {
                    candidate.shopName = enrichedData.seller;
                }
                if (enrichedData.imageUrl && !candidate.imageUrl) {
                    candidate.imageUrl = enrichedData.imageUrl;
                    candidate.enriched = true;
                    candidate.enrichmentSource = candidate.enrichmentSource || 'deep-pdp-adapter';
                }
            }
        } catch (err) {
            console.warn(`[ServiceWorker:DeepEnrichment] Error saat enrichment kandidat [${idx}]:`, err.message);
        }
    }

    return candidates;
}

// =========================================================================
// In-House Resilient Scraping Engine Client (CR-003 / ADR-10)
// Mengirim permintaan pencarian ke server backend mandiri (http://localhost:3000/api/search)
// =========================================================================
async function searchWithBackendEngine(query, marketplace) {
    const backendUrl = 'http://localhost:3000/api/search';
    try {
        if (typeof fetch === 'undefined') return null;

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 12000) : null;

        const res = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                keyword: query,
                marketplace: marketplace || 'shopee'
            }),
            signal: controller ? controller.signal : undefined
        });

        if (timeoutId) clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data && data.success && Array.isArray(data.candidates) && data.candidates.length > 0) {
                console.log(`[ServiceWorker] Backend Engine berhasil mengembalikan ${data.candidates.length} produk untuk ${marketplace}.`);
                return {
                    status: 'OK',
                    success: true,
                    marketplace: marketplace || 'shopee',
                    source: 'in-house-engine',
                    candidates: data.candidates
                };
            }
        }
    } catch (err) {
        console.info(`[ServiceWorker] In-House Backend Engine tidak aktif (${err.message}). Beralih ke fallback tab search.`);
    }
    return null;
}

// =========================================================================
// Listener Message: START_NATIVE_SEARCH, ENRICH_MISSING_DATA, & CANCEL
// =========================================================================
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'START_NATIVE_SEARCH') {
            const query = request.query;
            const manifest = request.manifest;
            const marketplace = manifest?.id || 'shopee';

            (async () => {
                // 1. Coba In-House Resilient Scraping Engine terlebih dahulu
                try {
                    const backendResult = await searchWithBackendEngine(query, marketplace);
                    if (backendResult && Array.isArray(backendResult.candidates) && backendResult.candidates.length > 0) {
                        sendResponse(backendResult);
                        return;
                    }
                } catch (e) {
                    console.warn('[ServiceWorker] Backend search attempt threw error, proceeding to tab search:', e.message);
                }

                // 2. Fallback ke Tab-Based Native Search jika backend offline / kosong
                try {
                    const result = await openAndExtractSearchTab(query, manifest);
                    if (result.status === 'OK') {
                        sendResponse({
                            status: 'OK',
                            success: true,
                            marketplace: marketplace,
                            candidates: result.candidates || []
                        });
                    } else {
                        sendResponse({
                            status: result.status,
                            success: false,
                            marketplace: marketplace,
                            error: result.reason || result.error || 'Pencarian gagal',
                            candidates: []
                        });
                    }
                } catch (err) {
                    sendResponse({
                        status: 'ERROR',
                        success: false,
                        marketplace: marketplace,
                        error: err.message
                    });
                }
            })();

            return true; // Asynchronous sendResponse
        }

        if (request.action === 'ENRICH_MISSING_DATA' || request.action === 'ENRICH_CANDIDATES') {
            enrichMissingData(request.candidates)
                .then(enriched => {
                    sendResponse({
                        status: 'OK',
                        success: true,
                        candidates: enriched
                    });
                })
                .catch(err => {
                    sendResponse({
                        status: 'ERROR',
                        success: false,
                        error: err.message,
                        candidates: request.candidates
                    });
                });

            return true;
        }

        if (request.action === 'CANCEL_NATIVE_SEARCH') {
            console.log('[Shopping Intelligence] CANCEL_NATIVE_SEARCH diterima.');
            cleanupLeftoverTabs().then(() => {
                sendResponse({ success: true, cancelled: true });
            });
            return true;
        }
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        enrichMissingData,
        enrichSingleCandidatePdp,
        openAndExtractSearchTab,
        cleanupLeftoverTabs,
        searchWithBackendEngine
    };
}

console.log('[Shopping Intelligence] Service worker started.');
