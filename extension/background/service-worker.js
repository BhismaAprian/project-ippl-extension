/**
 * service-worker.js
 * 
 * Script ini berjalan di background (Service Worker MV3).
 * Mengatur perilaku Chrome Side Panel agar otomatis terbuka saat icon ekstensi diklik.
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

console.log('[Shopping Intelligence] Service worker started.');
