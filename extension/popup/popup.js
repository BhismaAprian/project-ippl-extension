/**
 * popup.js
 * 
 * Script ini berjalan di konteks popup (saat ikon extension diklik).
 * Tugasnya:
 * 1. Kirim pesan DETECT_PAGE ke content script di tab aktif
 * 2. Tampilkan hasil deteksi di UI
 * 3. Handle error kalau tab bukan halaman Shopee
 */

// === Referensi elemen DOM ===
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const resultEl = document.getElementById('result');
const resultDetail = document.getElementById('resultDetail');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('errorText');
const versionEl = document.getElementById('version');

// Set versi dari manifest
versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

// === Fungsi UI Helper ===
function showStatus(text) {
    statusEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    statusText.textContent = text;
}

function showResult(detail) {
    statusEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    resultDetail.textContent = detail;
}

function showError(text) {
    statusEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorText.textContent = text;
}

// === Fungsi Utama ===

async function init() {
    showStatus('Memeriksa halaman...');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            showError('Tidak dapat mengakses tab aktif.');
            return;
        }

        chrome.tabs.sendMessage(tab.id, { action: 'DETECT_PAGE' }, (response) => {
            if (chrome.runtime.lastError) {
                showError('Marketplace ini belum didukung. Buka halaman produk di Shopee, Tokopedia, atau Lazada.');
                return;
            }

            if (!response) {
                showError('Tidak ada respons dari halaman.');
                return;
            }

            if (response.isProduct) {
                showResult(`Marketplace: ${response.marketplace}`, response.reason);
            } else {
                showError(response.reason || 'Halaman tidak dikenali.');
            }
        });
    } catch (error) {
        console.error('[Shopping Intelligence] Error:', error);
        showError('Terjadi kesalahan tak terduga.');
    }
}

// Update showResult untuk terima 2 argumen
function showResult(marketplace, detail) {
    statusEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    document.getElementById('resultTitle').textContent = `Halaman produk ${marketplace} terdeteksi`;
    resultDetail.textContent = detail;
}

init();