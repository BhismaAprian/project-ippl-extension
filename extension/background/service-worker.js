/**
 * service-worker.js
 * 
 * Script ini berjalan di background (tidak ada UI).
 * Tugasnya untuk MVP:
 * - Log saat extension pertama di-install
 * - Menyediakan tempat untuk logika background di masa depan
 * 
 * Service worker di Manifest V3 bisa "tidur" saat tidak dipakai,
 * dan "bangun" saat ada event. Jadi jangan simpan state di sini.
 * Gunakan chrome.storage untuk state.
 */

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Shopping Intelligence] Extension installed. Version: 0.1.0');

        // Simpan tanggal install ke storage
        chrome.storage.local.set({
            installedAt: new Date().toISOString(),
            version: '0.1.0'
        });
    } else if (details.reason === 'update') {
        console.log('[Shopping Intelligence] Extension updated.');
    }
});

console.log('[Shopping Intelligence] Service worker started.');