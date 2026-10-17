/**
 * popup.js
 * 
 * Script ini berjalan di konteks popup (saat ikon extension diklik).
 * Tugasnya:
 * 1. Kirim pesan DETECT_PAGE ke content script di tab aktif
 * 2. Kalau halaman produk, kirim EXTRACT_PRODUCT
 * 3. Tampilkan hasil ekstraksi produk di UI
 * 4. Handle error kalau tab bukan halaman produk yang didukung
 */

// === Referensi elemen DOM ===
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const resultEl = document.getElementById('result');
const resultTitle = document.getElementById('resultTitle');
const resultDetail = document.getElementById('resultDetail');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('errorText');
const versionEl = document.getElementById('version');

const productEl = document.getElementById('product');
const productImage = document.getElementById('productImage');
const productTitleEl = document.getElementById('productTitle');
const productPriceEl = document.getElementById('productPrice');
const productBadgesEl = document.getElementById('productBadges');
const productRatingEl = document.getElementById('productRating');
const productReviewsEl = document.getElementById('productReviews');
const productSellerEl = document.getElementById('productSeller');
const productSpecsEl = document.getElementById('productSpecs');
const productSpecsGrid = document.getElementById('productSpecsGrid');

const aiDataSection = document.getElementById('aiDataSection');
const aiBrandEl = document.getElementById('aiBrand');
const aiCategoryEl = document.getElementById('aiCategory');
const aiModelEl = document.getElementById('aiModel');
const aiSpecsEl = document.getElementById('aiSpecs');

const groqKeyInput = document.getElementById('groqKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const settingsStatus = document.getElementById('settingsStatus');

const aiClient = new window.AIClient();

// Set versi dari manifest
versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

// === Fungsi UI Helper ===
function showStatus(text) {
    statusEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    statusText.textContent = text;
}

function showResult(title, detail) {
    statusEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    resultTitle.textContent = title;
    resultDetail.textContent = detail;
}

function showError(text) {
    statusEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorText.textContent = text;
}

function sendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

// === Settings: Groq API Key ===

function showSettingsStatus(text, ok = true) {
    settingsStatus.textContent = text;
    settingsStatus.classList.remove('hidden');
    settingsStatus.classList.toggle('error', !ok);
}

async function loadApiKey() {
    try {
        const key = await aiClient.getApiKey();
        if (key) groqKeyInput.value = key;
    } catch (e) {
        console.error('[Shopping Intelligence] Gagal memuat API key:', e);
    }
}

async function saveApiKey() {
    const key = groqKeyInput.value.trim();
    try {
        await aiClient.setApiKey(key);
        showSettingsStatus(key ? 'API Key tersimpan.' : 'API Key dikosongkan.', true);
    } catch (e) {
        console.error('[Shopping Intelligence] Gagal menyimpan API key:', e);
        showSettingsStatus('Gagal menyimpan API Key.', false);
    }
}

// === Format & Render Produk ===

function formatPrice(price, currency) {
    if (price === null || price === undefined || price === '') return '-';
    const value = Number(price);
    if (isNaN(value)) return '-';
    const code = currency || 'IDR';
    try {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: code,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value);
    } catch (e) {
        return `${code} ${value.toLocaleString('id-ID')}`;
    }
}

function setText(el, value) {
    el.textContent = (value === null || value === undefined || value === '') ? '-' : value;
}

function renderBadges(badges) {
    productBadgesEl.innerHTML = '';
    if (!Array.isArray(badges) || badges.length === 0) {
        productBadgesEl.classList.add('hidden');
        return;
    }
    productBadgesEl.classList.remove('hidden');
    badges.forEach((badge) => {
        const span = document.createElement('span');
        span.className = 'badge';
        span.textContent = badge;
        productBadgesEl.appendChild(span);
    });
}

function renderSpecs(specifications) {
    productSpecsGrid.innerHTML = '';
    const entries = specifications && typeof specifications === 'object'
        ? Object.entries(specifications)
        : [];

    if (entries.length === 0) {
        productSpecsEl.classList.add('hidden');
        return;
    }

    productSpecsEl.classList.remove('hidden');
    entries.forEach(([key, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = (value === null || value === undefined || value === '') ? '-' : value;
        productSpecsGrid.appendChild(dt);
        productSpecsGrid.appendChild(dd);
    });
}

function renderAiData(aiData) {
    aiDataSection.classList.remove('hidden');

    if (!aiData || typeof aiData !== 'object') {
        aiSpecsEl.textContent = 'AI analysis failed';
        aiBrandEl.textContent = '-';
        aiCategoryEl.textContent = '-';
        aiModelEl.textContent = '-';
        return;
    }

    setText(aiBrandEl, aiData.brand);
    setText(aiCategoryEl, aiData.category);
    setText(aiModelEl, aiData.model);

    aiSpecsEl.innerHTML = '';
    const specs = aiData.specifications;

    if (specs && typeof specs === 'object' && Object.keys(specs).length > 0) {
        const list = document.createElement('ul');
        list.style.margin = '0';
        list.style.paddingLeft = '16px';
        Object.entries(specs).forEach(([key, value]) => {
            const li = document.createElement('li');
            const val = (value === null || value === undefined || value === '') ? '-' : value;
            li.textContent = `${key}: ${val}`;
            list.appendChild(li);
        });
        aiSpecsEl.appendChild(list);
    } else {
        aiSpecsEl.textContent = 'AI analysis failed';
    }
}

function renderProduct(product) {
    productEl.classList.remove('hidden');

    if (product.imageUrl) {
        productImage.src = product.imageUrl;
        productImage.classList.remove('hidden');
        productImage.onerror = () => productImage.classList.add('hidden');
    } else {
        productImage.removeAttribute('src');
        productImage.classList.add('hidden');
    }

    setText(productTitleEl, product.title);
    productPriceEl.textContent = formatPrice(product.price, product.currency);

    renderBadges(product.badges);

    const rating = product.rating;
    productRatingEl.textContent = (rating === null || rating === undefined) ? '-' : `${rating} / 5`;

    const reviews = product.reviewCount;
    productReviewsEl.textContent = (reviews === null || reviews === undefined)
        ? '-'
        : Number(reviews).toLocaleString('id-ID');

    const sellerName = product.seller && product.seller.name;
    setText(productSellerEl, sellerName);

    renderSpecs(product.specifications);

    aiDataSection.classList.add('hidden');
    aiSpecsEl.innerHTML = '';
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

        let detection;
        try {
            detection = await sendMessage(tab.id, { action: 'DETECT_PAGE' });
        } catch (e) {
            showError('Marketplace ini belum didukung. Buka halaman produk di Shopee, Tokopedia, atau Lazada.');
            return;
        }

        if (!detection) {
            showError('Tidak ada respons dari halaman.');
            return;
        }

        if (!detection.isProduct) {
            showError(detection.reason || 'Halaman tidak dikenali.');
            return;
        }

        showResult(`Halaman produk ${detection.marketplace} terdeteksi`, detection.reason);
        productEl.classList.add('hidden');

        showStatus('Mengekstrak data produk...');

        let extraction;
        try {
            extraction = await sendMessage(tab.id, { action: 'EXTRACT_PRODUCT' });
        } catch (e) {
            showResult(`Halaman produk ${detection.marketplace} terdeteksi`, detection.reason);
            showError('Gagal mengekstrak data produk.');
            return;
        }

        showResult(`Halaman produk ${detection.marketplace} terdeteksi`, detection.reason);

        if (!extraction || !extraction.success || !extraction.product) {
            const reason = (extraction && extraction.error) || 'Data produk tidak ditemukan di halaman ini.';
            resultDetail.textContent = `${detection.reason} (${reason})`;
            return;
        }

        renderProduct(extraction.product);

        try {
            const response = await sendMessage(tab.id, {
                action: 'UNDERSTAND_PRODUCT',
                product: extraction.product
            });
            const aiData = response ? response.aiData : null;
            console.log("AI Result:", aiData);
            renderAiData(aiData);
        } catch (aiError) {
            console.error('[Shopping Intelligence] Analisis AI gagal:', aiError);
            renderAiData(null);
        }
    } catch (error) {
        console.error('[Shopping Intelligence] Error:', error);
        showError('Terjadi kesalahan tak terduga.');
    }
}

saveKeyBtn.addEventListener('click', saveApiKey);

loadApiKey();
init();
