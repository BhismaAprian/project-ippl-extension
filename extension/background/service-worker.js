/**
 * service-worker.js
 * 
 * Script ini berjalan di background (Service Worker MV3).
 * 1. Mengatur perilaku Chrome Side Panel agar otomatis terbuka saat icon ekstensi diklik.
 * 2. Mengelola lifecycle tab pencarian native (Brief Active Window: buka active:true, hidrasi, ekstrak, tutup tab).
 * 3. Menjamin cleanup tab saat service worker restart/wake atau jika user menutup tab manual.
 */

// Konfigurasi Chrome Side Panel agar terbuka saat action icon diklik
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
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
// Listener Message: START_NATIVE_SEARCH & CANCEL_NATIVE_SEARCH
// =========================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_NATIVE_SEARCH') {
        const query = request.query;
        const manifest = request.manifest;
        const marketplace = manifest?.id || 'shopee';

        openAndExtractSearchTab(query, manifest)
            .then(result => {
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
            })
            .catch(err => {
                sendResponse({
                    status: 'ERROR',
                    success: false,
                    marketplace: marketplace,
                    error: err.message
                });
            });

        return true; // Asynchronous sendResponse
    }

    if (request.action === 'CANCEL_NATIVE_SEARCH') {
        console.log('[Shopping Intelligence] CANCEL_NATIVE_SEARCH diterima.');
        cleanupLeftoverTabs().then(() => {
            sendResponse({ success: true, cancelled: true });
        });
        return true;
    }
});

console.log('[Shopping Intelligence] Service worker started.');
