/**
 * popup.js
 *
 * Alur dengan cache:
 * 1. Ambil tab aktif -> cacheKey = 'cache_' + tab.url
 * 2. Kalau cache ada -> render langsung (tanpa panggil API)
 * 3. Kalau tidak -> jalankan analisis (DETECT/EXTRACT/UNDERSTAND/SEARCH) -> simpan cache
 * 4. Tombol "Analisis Ulang" -> hapus cache -> jalankan ulang
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
const reanalyzeBtn = document.getElementById('reanalyzeBtn');

const sourceBadge = document.getElementById('sourceBadge');
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

const searchResultsEl = document.getElementById('searchResults');
const recommendationBox = document.getElementById('recommendationBox');

const groqKeyInput = document.getElementById('groqKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const settingsStatus = document.getElementById('settingsStatus');

const aiClient = new window.AIClient();

versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

// === UI helpers ===
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

function getActiveTab() {
    return chrome.tabs.query({ active: true, currentWindow: true })
        .then((tabs) => (tabs && tabs[0]) ? tabs[0] : null);
}

function cacheKeyFor(tab) {
    const idPart = tab.url || ('tabId_' + tab.id);
    return 'cache_' + idPart;
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

// === Format helpers ===
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

function capitalize(text) {
    if (!text) return '-';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// === Render: Original Product ===
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

function renderProduct(product, marketplace) {
    if (!product) return;

    sourceBadge.textContent = capitalize(marketplace);

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
}

// === Render: AI Understanding ===
function renderAiData(aiData) {
    aiDataSection.classList.remove('hidden');

    if (!aiData || typeof aiData !== 'object') {
        aiBrandEl.textContent = '-';
        aiCategoryEl.textContent = '-';
        aiModelEl.textContent = '-';
        aiSpecsEl.textContent = 'AI analysis failed';
        return;
    }

    setText(aiBrandEl, aiData.brand);
    setText(aiCategoryEl, aiData.category);
    setText(aiModelEl, aiData.model);

    aiSpecsEl.innerHTML = '';
    const specs = aiData.specifications;

    if (specs && typeof specs === 'object' && Object.keys(specs).length > 0) {
        const list = document.createElement('ul');
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

// === Render: Smart Alternatives ===
function marketClass(marketplace) {
    switch (marketplace) {
        case 'Tokopedia': return 'market-tokopedia';
        case 'Lazada': return 'market-lazada';
        case 'Blibli': return 'market-blibli';
        default: return 'market-other';
    }
}

function isCheaper(price, originalPrice) {
    return price !== null && price !== undefined
        && originalPrice !== null && originalPrice !== undefined
        && price < originalPrice;
}

function buildSearchCard(item, originalPrice) {
    const cheaper = isCheaper(item.price, originalPrice);
    const mismatch = item.isSpecMatch === false;

    const card = document.createElement('div');
    card.className = 'search-card';
    if (mismatch) card.classList.add('badge-mismatch');
    else if (cheaper) card.classList.add('badge-cheaper');

    const head = document.createElement('div');
    head.className = 'search-head';

    const market = document.createElement('span');
    market.className = `market-badge ${marketClass(item.marketplace)}`;
    market.textContent = item.marketplace || 'Other';
    head.appendChild(market);

    let statusBadge = null;
    if (mismatch) {
        statusBadge = { cls: 'red', text: 'Spec Berbeda' };
    } else if (cheaper) {
        statusBadge = { cls: 'green', text: 'Lebih Murah' };
    } else {
        statusBadge = { cls: 'gray', text: 'Spec Cocok' };
    }

    const badge = document.createElement('span');
    badge.className = `status-badge ${statusBadge.cls}`;
    badge.textContent = statusBadge.text;
    head.appendChild(badge);

    card.appendChild(head);

    const title = document.createElement('div');
    title.className = 'search-title';
    title.textContent = item.title || '-';
    card.appendChild(title);

    const snippet = document.createElement('div');
    snippet.className = 'search-snippet';
    snippet.textContent = item.snippet || '';
    card.appendChild(snippet);

    const price = document.createElement('div');
    if (item.price !== null && item.price !== undefined) {
        price.className = 'search-price';
        price.textContent = formatPrice(item.price, 'IDR');
    } else {
        price.className = 'search-price missing';
        price.textContent = 'Harga tidak terdeteksi di Google snippet';
    }
    card.appendChild(price);

    const link = document.createElement('a');
    link.className = 'search-link';
    link.href = item.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `Buka di ${item.marketplace || 'Marketplace'}`;
    card.appendChild(link);

    return card;
}

function renderSearchResults(items, originalPrice) {
    searchResultsEl.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
        const em = document.createElement('em');
        em.className = 'muted';
        em.textContent = 'Tidak ada alternatif ditemukan';
        searchResultsEl.appendChild(em);
        return;
    }

    items.forEach((item) => {
        searchResultsEl.appendChild(buildSearchCard(item, originalPrice));
    });
}

// === Render: AI Recommendation ===
function renderRecommendation(items, originalPrice) {
    recommendationBox.className = 'reco-box reco-info';

    if (!Array.isArray(items) || items.length === 0) {
        recommendationBox.textContent = 'Tidak ada alternatif untuk dibandingkan.';
        return;
    }

    const cheaperMatch = items.find((i) => i.isSpecMatch && isCheaper(i.price, originalPrice));
    const cheaperMismatch = items.find((i) => i.isSpecMatch === false && isCheaper(i.price, originalPrice));

    if (cheaperMatch) {
        recommendationBox.className = 'reco-box reco-good';
        recommendationBox.textContent = `🔥 Ada alternatif lebih murah dengan spec cocok di ${cheaperMatch.marketplace} (${formatPrice(cheaperMatch.price, 'IDR')}).`;
    } else if (cheaperMismatch) {
        recommendationBox.className = 'reco-box reco-warning';
        recommendationBox.textContent = '⚠️ Ada alternatif lebih murah, tapi spesifikasinya berbeda — periksa dengan teliti.';
    } else {
        recommendationBox.textContent = 'Tidak ada alternatif yang lebih murah dengan spec cocok.';
    }
}

// === Render all (dari data lengkap / cache) ===
function renderAll(data) {
    showResult(`Halaman produk ${data.marketplace} terdeteksi`, data.reason || '');
    renderProduct(data.product, data.marketplace);
    renderAiData(data.aiData);
    const originalPrice = data.product ? data.product.price : null;
    renderSearchResults(data.searchResults, originalPrice);
    renderRecommendation(data.searchResults, originalPrice);
}

// === Analisis (panggil API) ===
async function runAnalysis(tab) {
    const detection = await sendMessage(tab.id, { action: 'DETECT_PAGE' });

    if (!detection) throw new Error('Tidak ada respons dari halaman.');
    if (!detection.isProduct) throw new Error(detection.reason || 'Halaman tidak dikenali.');

    showResult(`Halaman produk ${detection.marketplace} terdeteksi`, detection.reason);
    showStatus('Mengekstrak data produk...');

    const extraction = await sendMessage(tab.id, { action: 'EXTRACT_PRODUCT' });
    if (!extraction || !extraction.success || !extraction.product) {
        throw new Error((extraction && extraction.error) || 'Data produk tidak ditemukan di halaman ini.');
    }

    showResult(`Halaman produk ${detection.marketplace} terdeteksi`, detection.reason);
    renderProduct(extraction.product, detection.marketplace);
    showStatus('Menganalisis produk dengan AI...');

    let aiData = null;
    try {
        const response = await sendMessage(tab.id, {
            action: 'UNDERSTAND_PRODUCT',
            product: extraction.product
        });
        aiData = response ? response.aiData : null;
    } catch (aiError) {
        console.error('[Shopping Intelligence] Analisis AI gagal:', aiError);
    }
    console.log("AI Result:", aiData);
    renderAiData(aiData);

    showStatus('Mencari alternatif...');

    let searchResults = [];
    try {
        const searchResponse = await sendMessage(tab.id, {
            action: 'SEARCH_ALTERNATIVES',
            aiData: aiData,
            product: extraction.product
        });
        searchResults = searchResponse ? searchResponse.alternatives : [];
    } catch (searchError) {
        console.error('[Shopping Intelligence] Pencarian alternatif gagal:', searchError);
    }

    const originalPrice = extraction.product ? extraction.product.price : null;
    renderSearchResults(searchResults, originalPrice);
    renderRecommendation(searchResults, originalPrice);

    return {
        marketplace: detection.marketplace,
        reason: detection.reason,
        product: extraction.product,
        aiData: aiData,
        searchResults: searchResults
    };
}

// === Cache + init ===
async function analyzeAndCache(tab) {
    const cacheKey = cacheKeyFor(tab);
    try {
        const data = await runAnalysis(tab);
        if (data) {
            await chrome.storage.local.set({ [cacheKey]: data });
        }
    } catch (error) {
        console.error('[Shopping Intelligence] Error:', error);
        showError(error.message || 'Terjadi kesalahan tak terduga.');
    }
}

async function init() {
    showStatus('Memeriksa halaman...');

    try {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
            showError('Tidak dapat mengakses tab aktif.');
            return;
        }

        const cacheKey = cacheKeyFor(tab);
        const cached = await chrome.storage.local.get([cacheKey]);

        if (cached && cached[cacheKey]) {
            renderAll(cached[cacheKey]);
            return;
        }

        await analyzeAndCache(tab);
    } catch (error) {
        console.error('[Shopping Intelligence] Error:', error);
        showError('Terjadi kesalahan tak terduga.');
    }
}

async function onReanalyze() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
        showError('Tidak dapat mengakses tab aktif.');
        return;
    }

    reanalyzeBtn.disabled = true;
    const cacheKey = cacheKeyFor(tab);
    try {
        await chrome.storage.local.remove(cacheKey);
    } catch (e) {
        console.error('[Shopping Intelligence] Gagal menghapus cache:', e);
    }

    showStatus('Menganalisis ulang...');
    await analyzeAndCache(tab);
    reanalyzeBtn.disabled = false;
}

saveKeyBtn.addEventListener('click', saveApiKey);
reanalyzeBtn.addEventListener('click', onReanalyze);

loadApiKey();
init();
