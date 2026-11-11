/**
 * extension/sidepanel/sidepanel.js
 * 
 * Controller utama untuk Chrome Side Panel "Shopping Intelligence Companion":
 * - Render Hero Product (Judul, Harga, Seller, Badges)
 * - Section 1: Ultimate Deal Checker (BUY / CHECK / WAIT, 40-40-20 weighted score)
 * - Section 2: Deep Review Analysis (Interactive click-to-scroll ke ulasan asli di Shopee)
 * - Section 3: Warranty Intelligence (Audit Garansi Sistem vs Deskripsi)
 * - Section 4: Smart Alternatives (3 Rekomendasi serupa DOM + Timbangan Harga Exa/Groq)
 * - Cache lokal per tab URL & Manajemen Kunci API
 */

// === Elemen DOM Side Panel ===
const els = {
    version: document.getElementById('version'),
    reanalyzeBtn: document.getElementById('reanalyzeBtn'),
    loadingState: document.getElementById('loadingState'),
    loadingText: document.getElementById('loadingText'),
    errorState: document.getElementById('errorState'),
    originalProduct: document.getElementById('originalProduct'),

    // Deal Checker Section
    dealCheckerSection: document.getElementById('dealCheckerSection'),
    dealVerdictBadge: document.getElementById('dealVerdictBadge'),
    dealScoreNumber: document.getElementById('dealScoreNumber'),
    dealVerdictReason: document.getElementById('dealVerdictReason'),
    priceScoreVal: document.getElementById('priceScoreVal'),
    priceProgressBar: document.getElementById('priceProgressBar'),
    reviewScoreVal: document.getElementById('reviewScoreVal'),
    reviewProgressBar: document.getElementById('reviewProgressBar'),
    warrantyScoreVal: document.getElementById('warrantyScoreVal'),
    warrantyProgressBar: document.getElementById('warrantyProgressBar'),
    dealCheaperAlert: document.getElementById('dealCheaperAlert'),

    // Review Intelligence Section
    reviewSummarySection: document.getElementById('reviewSummarySection'),
    reviewConfidenceBadge: document.getElementById('reviewConfidenceBadge'),
    reviewLoadingIndicator: document.getElementById('reviewLoadingIndicator'),
    reviewEmptyMessage: document.getElementById('reviewEmptyMessage'),
    reviewFallbackContainer: document.getElementById('reviewFallbackContainer'),
    reviewFallbackMessage: document.getElementById('reviewFallbackMessage'),
    reviewFallbackList: document.getElementById('reviewFallbackList'),
    reviewRisksContainer: document.getElementById('reviewRisksContainer'),
    reviewRisksList: document.getElementById('reviewRisksList'),
    reviewProsConsGrid: document.getElementById('reviewProsConsGrid'),
    reviewProsList: document.getElementById('reviewProsList'),
    reviewConsList: document.getElementById('reviewConsList'),

    // Warranty Section
    warrantySection: document.getElementById('warrantySection'),
    warrantyStatusBadge: document.getElementById('warrantyStatusBadge'),
    warrantyDiscrepancyAlert: document.getElementById('warrantyDiscrepancyAlert'),
    warrantyDiscrepancyText: document.getElementById('warrantyDiscrepancyText'),
    warrantyAttrVal: document.getElementById('warrantyAttrVal'),
    warrantyDescVal: document.getElementById('warrantyDescVal'),
    warrantyTipsText: document.getElementById('warrantyTipsText'),

    // Smart Cross-Market Deals (Exa + Groq)
    crossMarketSection: document.getElementById('crossMarketSection'),
    crossMarketCountBadge: document.getElementById('crossMarketCountBadge'),
    crossMarketLoading: document.getElementById('crossMarketLoading'),
    crossMarketEmpty: document.getElementById('crossMarketEmpty'),
    crossMarketEmptyText: document.getElementById('crossMarketEmptyText'),
    bestValueSection: document.getElementById('bestValueSection'),
    cheapestSection: document.getElementById('cheapestSection'),
    otherResultsSection: document.getElementById('otherResultsSection'),

    // Native Similar Recommendations (Shopee "Kamu Mungkin Juga Suka")
    similarRecsSection: document.getElementById('similarRecsSection'),
    similarRecsLoading: document.getElementById('similarRecsLoading'),
    similarRecsEmpty: document.getElementById('similarRecsEmpty'),
    similarRecsList: document.getElementById('similarRecsList'),

    // Settings
    settingsSection: document.getElementById('settingsSection'),
    inputGroqKey: document.getElementById('inputGroqKey'),
    inputExaKey: document.getElementById('inputExaKey'),
    saveKeysBtn: document.getElementById('saveKeysBtn'),
    keyStatus: document.getElementById('keyStatus'),

    // Section 6: Native Alternatives
    nativeSearchBtn: document.getElementById('native-search-btn'),
    exaSearchBtn: document.getElementById('exa-search-btn'),
    searchProgress: document.getElementById('search-progress'),
    searchProgressText: document.getElementById('search-progress-text'),
    searchBlocked: document.getElementById('search-blocked'),
    manualOpenLink: document.getElementById('manual-open-link'),
    searchResults: document.getElementById('search-results')
};

// Versi Manifest
try {
    if (els.version) els.version.textContent = 'v' + chrome.runtime.getManifest().version;
} catch (e) { }

// State Mutex Flag & Cached Analysis Data
let isProcessing = false;
let currentActiveTabId = null;
let currentAnalysisData = null;

// === State Helpers ===
function show(el) {
    if (el) el.classList.remove('hidden');
}

function hide(el) {
    if (el) el.classList.add('hidden');
}

function setLoadingState(isLoading, message = 'Menganalisis...') {
    isProcessing = isLoading;

    if (els.reanalyzeBtn) {
        els.reanalyzeBtn.disabled = isLoading;
        els.reanalyzeBtn.classList.toggle('disabled', isLoading);
    }
    if (els.saveKeysBtn) {
        els.saveKeysBtn.disabled = isLoading;
    }

    if (isLoading) {
        show(els.loadingState);
        if (els.loadingText) els.loadingText.textContent = message;
        hide(els.errorState);
    } else {
        hide(els.loadingState);
    }
}

function renderError(message, isConnectionError = false) {
    hide(els.loadingState);
    show(els.errorState);
    if (!els.errorState) return;

    const errMsg = String(message || '');
    const isConn = isConnectionError ||
        errMsg.includes('Receiving end does not exist') ||
        errMsg.includes('Could not establish connection') ||
        errMsg.includes('refresh') ||
        errMsg.includes('F5');

    if (isConn) {
        els.errorState.innerHTML = `
            <div style="font-weight: 800; font-size: 0.95rem; margin-bottom: 6px;">⚠️ Halaman Belum Terhubung</div>
            <div style="margin-bottom: 12px; line-height: 1.4; font-size: 0.85rem; color: #475569;">
                Harap refresh (F5) halaman Shopee atau marketplace Anda, lalu coba lagi.
            </div>
            <button id="refreshTabBtn" class="btn btn-action" type="button" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px; cursor: pointer;">
                🔄 Refresh Halaman & Analisis
            </button>
        `;
        const btn = document.getElementById('refreshTabBtn');
        if (btn) {
            btn.addEventListener('click', async () => {
                if (currentActiveTabId) {
                    try {
                        await chrome.tabs.reload(currentActiveTabId);
                        setLoadingState(true, 'Memuat ulang halaman marketplace...');
                        setTimeout(() => {
                            onReanalyze();
                        }, 1800);
                    } catch (e) {
                        onReanalyze();
                    }
                } else {
                    onReanalyze();
                }
            });
        }
    } else {
        els.errorState.innerHTML = `
            <div style="font-weight: 800; font-size: 0.95rem; margin-bottom: 4px;">⚠️ Perhatian</div>
            <div>${message}</div>
        `;
    }
}

// === Content Script Injektor & Message Helper ===
const CONTENT_SCRIPTS_TO_INJECT = [
    'shared/constant.js',
    'adapters/base-adapter.js',
    'adapters/shopee-adapter.js',
    'adapters/tokopedia-adapter.js',
    'adapters/lazada-adapter.js',
    'shared/ai-client.js',
    'content/marketplace-detector.js'
];

/**
 * Fallback auto-inject jika Content Script belum berjalan di tab
 * (misal tab sudah dibuka sebelum ekstensi di-install/di-reload)
 */
async function ensureContentScriptInjected(tabId) {
    if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
        console.warn('[SI:AutoInject] chrome.scripting API tidak tersedia.');
        return false;
    }
    try {
        console.log(`[SI:AutoInject] Menyuntikkan content script ke tab ${tabId}...`);
        await chrome.scripting.executeScript({
            target: { tabId },
            files: CONTENT_SCRIPTS_TO_INJECT
        });
        // Jeda singkat agar listener onMessage aktif
        await new Promise(resolve => setTimeout(resolve, 200));
        console.log(`[SI:AutoInject] Injeksi content script sukses pada tab ${tabId}`);
        return true;
    } catch (e) {
        console.warn(`[SI:AutoInject] Injeksi content script gagal pada tab ${tabId}:`, e);
        return false;
    }
}

/**
 * Raw wrapper chrome.tabs.sendMessage dengan pengecekan chrome.runtime.lastError
 */
function sendRawMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        } catch (callErr) {
            reject(callErr);
        }
    });
}

/**
 * Resilient sendMessage:
 * Jika error "Receiving end does not exist" terjadi, coba Auto-Inject lalu retry sekali lagi.
 * Jika tetap gagal, lemparkan error yang ramah pengguna.
 */
async function sendMessage(tabId, message) {
    try {
        return await sendRawMessage(tabId, message);
    } catch (err) {
        const errMsg = err?.message || '';
        const isConnErr = errMsg.includes('Receiving end does not exist') ||
            errMsg.includes('Could not establish connection');

        if (isConnErr) {
            console.warn(`[SI:Message] Content script tidak terdeteksi di tab ${tabId} (${errMsg}). Mencoba Auto-Inject...`);
            const injected = await ensureContentScriptInjected(tabId);
            if (injected) {
                try {
                    console.log(`[SI:Message] Mencoba kembali kirim pesan ke tab ${tabId}...`);
                    return await sendRawMessage(tabId, message);
                } catch (retryErr) {
                    console.error('[SI:Message] Retry sendMessage setelah Auto-Inject tetap gagal:', retryErr);
                }
            }

            const friendlyError = new Error('Harap refresh (F5) halaman Shopee, lalu coba lagi.');
            friendlyError.isConnectionError = true;
            throw friendlyError;
        }

        throw err;
    }
}

function getActiveTab() {
    return chrome.tabs.query({ active: true, currentWindow: true })
        .then((tabs) => (tabs && tabs[0]) ? tabs[0] : null);
}

function cacheKeyFor(tab) {
    return 'cache_v2_' + (tab.url || ('tabId_' + tab.id));
}

// === Format helpers ===
function formatPrice(price, currency = 'IDR') {
    if (price === null || price === undefined || price === '') return '-';
    const value = Number(price);
    if (isNaN(value)) return '-';
    try {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: currency || 'IDR',
            maximumFractionDigits: 0
        }).format(value);
    } catch (e) {
        return `Rp ${value.toLocaleString('id-ID')}`;
    }
}

function getMarketplaceBadge(marketplace) {
    const m = (marketplace || '').toLowerCase();
    if (m.includes('tokopedia')) {
        return { cls: 'badge-tokopedia', label: '🟢 Tokopedia' };
    }
    if (m.includes('shopee')) {
        return { cls: 'badge-shopee', label: '🟠 Shopee' };
    }
    if (m.includes('lazada')) {
        return { cls: 'badge-lazada', label: '🔵 Lazada' };
    }
    if (m.includes('blibli')) {
        return { cls: 'badge-blibli', label: '🔷 Blibli' };
    }
    return { cls: 'badge-other', label: `🏪 ${marketplace || 'Marketplace'}` };
}

// === API Keys ===
async function loadKeys() {
    try {
        const { groqKey, exaKey } = await chrome.storage.local.get(['groqKey', 'exaKey']);
        if (els.inputGroqKey) els.inputGroqKey.value = groqKey || '';
        if (els.inputExaKey) els.inputExaKey.value = exaKey || '';
    } catch (e) {
        console.error('[Shopping Intelligence] gagal baca API keys:', e);
    }
}

async function saveKeys() {
    try {
        await chrome.storage.local.set({
            groqKey: els.inputGroqKey ? els.inputGroqKey.value.trim() : '',
            exaKey: els.inputExaKey ? els.inputExaKey.value.trim() : ''
        });
        if (els.keyStatus) {
            els.keyStatus.textContent = '✅ Keys Saved!';
            setTimeout(() => { if (els.keyStatus) els.keyStatus.textContent = ''; }, 3000);
        }
    } catch (e) {
        console.error('[Shopping Intelligence] gagal simpan API keys:', e);
        if (els.keyStatus) els.keyStatus.textContent = '❌ Gagal menyimpan keys.';
    }
}

// =========================================================================
// RENDERERS
// =========================================================================

/**
 * 1. Render Hero Card Produk Asli
 */
function renderOriginalProduct(product, marketplace = 'Shopee') {
    if (!els.originalProduct) return;
    els.originalProduct.innerHTML = '';

    const heroTag = document.createElement('div');
    heroTag.className = 'hero-tag font-heading';
    heroTag.innerHTML = `<span>🛒</span> Produk Asli di ${marketplace}`;
    els.originalProduct.appendChild(heroTag);

    const body = document.createElement('div');
    body.className = 'hero-body';

    if (product.imageUrl) {
        const img = document.createElement('img');
        img.className = 'hero-image';
        img.src = product.imageUrl;
        img.alt = product.title || 'Produk';
        img.onerror = () => img.remove();
        body.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'hero-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'hero-title';
    titleEl.textContent = product.title || '-';
    info.appendChild(titleEl);

    const priceEl = document.createElement('div');
    priceEl.className = 'hero-price';
    priceEl.textContent = formatPrice(product.price, product.currency);
    info.appendChild(priceEl);

    const metaParts = [];
    if (product.rating) metaParts.push(`⭐ ${product.rating}`);
    if (product.reviewCount) metaParts.push(`${product.reviewCount} ulasan`);
    if (product.soldCount) metaParts.push(`${product.soldCount} terjual`);
    if (product.seller?.name) metaParts.push(`🏬 ${product.seller.name}`);

    if (metaParts.length > 0) {
        const metaEl = document.createElement('div');
        metaEl.className = 'hero-meta';
        metaEl.textContent = metaParts.join(' · ');
        info.appendChild(metaEl);
    }

    // Badges toko (Shopee Mall)
    if (Array.isArray(product.badges) && product.badges.length > 0) {
        const badgesContainer = document.createElement('div');
        badgesContainer.style.marginTop = '4px';
        product.badges.forEach(b => {
            const badge = document.createElement('span');
            badge.className = 'status-badge red';
            badge.textContent = b;
            badgesContainer.appendChild(badge);
        });
        info.appendChild(badgesContainer);
    }

    body.appendChild(info);
    els.originalProduct.appendChild(body);
    show(els.originalProduct);
}

/**
 * 2. Render Ultimate Deal Checker (BUY / CHECK / WAIT)
 */
function renderDealChecker(deal) {
    if (!els.dealCheckerSection || !deal) return;

    const verdict = deal.verdict || 'CHECK';
    els.dealCheckerSection.className = `card card-deal verdict-${verdict.toLowerCase()}`;

    if (els.dealVerdictBadge) {
        els.dealVerdictBadge.className = `verdict-badge ${verdict.toLowerCase()}`;
        els.dealVerdictBadge.textContent = verdict;
    }

    if (els.dealScoreNumber) {
        els.dealScoreNumber.textContent = deal.dealScore || 75;
    }

    if (els.dealVerdictReason) {
        els.dealVerdictReason.textContent = deal.verdictReason || '-';
    }

    // Breakdown Bars
    if (els.priceScoreVal) els.priceScoreVal.textContent = `${deal.priceScore || 80}%`;
    if (els.priceProgressBar) els.priceProgressBar.style.width = `${deal.priceScore || 80}%`;

    if (els.reviewScoreVal) els.reviewScoreVal.textContent = `${deal.reviewScore || 80}%`;
    if (els.reviewProgressBar) els.reviewProgressBar.style.width = `${deal.reviewScore || 80}%`;

    if (els.warrantyScoreVal) els.warrantyScoreVal.textContent = `${deal.warrantyScore || 60}%`;
    if (els.warrantyProgressBar) els.warrantyProgressBar.style.width = `${deal.warrantyScore || 60}%`;

    // Cheaper Alert
    if (deal.cheaperRecommendation) {
        show(els.dealCheaperAlert);
        els.dealCheaperAlert.innerHTML = `
            <div>💡 <strong>Alternatif Lebih Hemat:</strong></div>
            <div style="margin-top: 2px;">
                <a href="${deal.cheaperRecommendation.url}" target="_blank" style="color: #065F46; text-decoration: underline;">
                    ${deal.cheaperRecommendation.title}
                </a> (${deal.cheaperRecommendation.savings || deal.cheaperRecommendation.rawPrice})
            </div>
        `;
    } else {
        hide(els.dealCheaperAlert);
    }

    show(els.dealCheckerSection);
}

/**
 * 3. Render Warranty Intelligence (Audit Garansi)
 */
function renderWarrantyInfo(audit) {
    if (!els.warrantySection || !audit) return;

    if (els.warrantyStatusBadge) {
        let badgeClass = 'green';
        if (audit.badgeType === 'STORE') badgeClass = 'yellow';
        if (audit.badgeType === 'WARNING') badgeClass = 'red';
        if (audit.badgeType === 'NONE') badgeClass = 'gray';

        els.warrantyStatusBadge.className = `status-badge ${badgeClass}`;
        els.warrantyStatusBadge.textContent = audit.title || 'Tanpa Garansi';
    }

    if (audit.hasDiscrepancy) {
        show(els.warrantyDiscrepancyAlert);
        if (els.warrantyDiscrepancyText) {
            els.warrantyDiscrepancyText.textContent = audit.warningMessage || 'Data garansi di sistem berbeda dengan teks deskripsi penjual.';
        }
    } else {
        hide(els.warrantyDiscrepancyAlert);
    }

    if (els.warrantyAttrVal) {
        const attr = audit.rawAttribute;
        els.warrantyAttrVal.textContent = (attr && attr.type) ? `${attr.type} (${attr.duration || '-'})` : 'Tidak Dicantumkan';
    }

    if (els.warrantyDescVal) {
        els.warrantyDescVal.textContent = audit.rawDescription || 'Tidak Tertera di Deskripsi';
    }

    if (els.warrantyTipsText && audit.claimTips) {
        els.warrantyTipsText.textContent = audit.claimTips;
    }

    show(els.warrantySection);
}

/**
 * 4. Render Deep Review Analysis (Interactive Click-to-Scroll & Resilient Raw Fallback)
 */
function renderReviewSummary(summary, tabId, rawReviews = []) {
    hide(els.reviewLoadingIndicator);

    const actualRaw = (summary && Array.isArray(summary.rawReviews) && summary.rawReviews.length > 0)
        ? summary.rawReviews
        : (Array.isArray(rawReviews) ? rawReviews : []);

    // 1. Cek jika benar-benar tidak ada ulasan dari DOM
    if (!summary || (summary.status === 'NO_REVIEWS' && actualRaw.length === 0) || (!summary.pros?.length && !summary.cons?.length && actualRaw.length === 0)) {
        show(els.reviewSummarySection);
        show(els.reviewEmptyMessage);
        hide(els.reviewRisksContainer);
        hide(els.reviewProsConsGrid);
        hide(els.reviewFallbackContainer);
        if (els.reviewConfidenceBadge) {
            els.reviewConfidenceBadge.className = 'status-badge gray';
            els.reviewConfidenceBadge.textContent = '0 Ulasan';
        }
        return;
    }

    // 2. Fallback Review UI: Jika AI gagal merangkum (status FALLBACK_RAW atau pros/cons kosong padahal ulasan mentah ada)
    const isAiFailed = summary.status === 'FALLBACK_RAW' || (!summary.pros?.length && !summary.cons?.length);
    if (isAiFailed && actualRaw.length > 0) {
        show(els.reviewSummarySection);
        hide(els.reviewLoadingIndicator);
        hide(els.reviewEmptyMessage);
        hide(els.reviewRisksContainer);
        hide(els.reviewProsConsGrid);

        if (els.reviewConfidenceBadge) {
            els.reviewConfidenceBadge.className = 'status-badge yellow';
            els.reviewConfidenceBadge.textContent = 'Ulasan Asli';
        }

        renderRawReviewsFallback(actualRaw, tabId);
        return;
    }

    // 3. Render Normal jika AI Berhasil
    show(els.reviewSummarySection);
    hide(els.reviewEmptyMessage);
    hide(els.reviewFallbackContainer);

    if (els.reviewConfidenceBadge) {
        const conf = summary.confidence || 'HIGH';
        if (conf === 'HIGH') {
            els.reviewConfidenceBadge.className = 'status-badge green';
            els.reviewConfidenceBadge.textContent = 'Akurasi Tinggi';
        } else if (conf === 'MEDIUM') {
            els.reviewConfidenceBadge.className = 'status-badge yellow';
            els.reviewConfidenceBadge.textContent = 'Akurasi Sedang';
        } else {
            els.reviewConfidenceBadge.className = 'status-badge gray';
            els.reviewConfidenceBadge.textContent = 'Sampel Terbatas';
        }
    }

    // Helper untuk membuat elemen ulasan interaktif yang bisa diklik
    const createClickableLi = (item) => {
        const li = document.createElement('li');
        li.textContent = item.text || String(item);
        li.title = 'Klik untuk otomatis scroll ke ulasan asli di Shopee';

        li.addEventListener('click', () => {
            if (!tabId) return;
            sendMessage(tabId, {
                action: 'SCROLL_TO_REVIEW',
                cmtId: item.ref_id,
                reviewIndex: item.index,
                textSnippet: (item.text || '').substring(0, 35)
            }).then((res) => {
                if (res && res.success) {
                    li.style.transform = 'scale(0.98)';
                    setTimeout(() => { li.style.transform = ''; }, 150);
                }
            }).catch(console.error);
        });

        return li;
    };

    // Buyer Risks
    const risks = summary.risks || [];
    const validRisks = risks.filter(r => {
        const txt = (r.text || String(r)).toLowerCase();
        return !txt.includes('tidak ditemukan resiko') && !txt.includes('tidak ada resiko') && !txt.includes('no risk');
    });

    if (validRisks.length > 0 && els.reviewRisksList && els.reviewRisksContainer) {
        els.reviewRisksList.innerHTML = '';
        validRisks.forEach(r => els.reviewRisksList.appendChild(createClickableLi(r)));
        show(els.reviewRisksContainer);
    } else {
        hide(els.reviewRisksContainer);
    }

    // Pros
    if (els.reviewProsList) {
        els.reviewProsList.innerHTML = '';
        (summary.pros || []).forEach(p => els.reviewProsList.appendChild(createClickableLi(p)));
    }

    // Cons
    if (els.reviewConsList) {
        els.reviewConsList.innerHTML = '';
        (summary.cons || []).forEach(c => els.reviewConsList.appendChild(createClickableLi(c)));
    }

    show(els.reviewProsConsGrid);
}

/**
 * Render Fallback Ulasan Mentah Pembeli saat AI Gagal Merangkum.
 * Menampilkan pesan "AI gagal merangkum, tetapi berikut adalah ulasan asli dari pembeli:"
 * dan minimal 3 ulasan mentah dari DOM Shopee dengan fitur interaktif click-to-scroll.
 */
function renderRawReviewsFallback(rawReviews, tabId) {
    if (!rawReviews || !Array.isArray(rawReviews) || rawReviews.length === 0) return;

    show(els.reviewSummarySection);
    hide(els.reviewLoadingIndicator);
    hide(els.reviewEmptyMessage);
    hide(els.reviewRisksContainer);
    hide(els.reviewProsConsGrid);

    // Ambil minimal 3 ulasan (atau seluruh ulasan jika ada 3 atau lebih, ambil hingga 6 item)
    const displayReviews = rawReviews.slice(0, Math.min(rawReviews.length, Math.max(3, 6)));

    let container = els.reviewFallbackContainer;
    if (!container) {
        container = document.createElement('div');
        container.id = 'reviewFallbackContainer';
        container.className = 'review-fallback-container';
        if (els.reviewSummarySection) {
            els.reviewSummarySection.appendChild(container);
        }
        els.reviewFallbackContainer = container;
    }

    container.innerHTML = `
        <div class="review-fallback-banner">
            <span class="fallback-icon">⚠️</span>
            <span id="reviewFallbackMessage" class="fallback-text">AI gagal merangkum, tetapi berikut adalah ulasan asli dari pembeli:</span>
        </div>
        <ul class="interactive-list fallback-list" id="reviewFallbackList"></ul>
    `;
    show(container);

    const listEl = container.querySelector('#reviewFallbackList');
    if (!listEl) return;

    displayReviews.forEach((item, idx) => {
        const text = typeof item === 'string' ? item : (item.text || '');
        const cmtId = typeof item === 'object' && item.cmtId ? item.cmtId : null;
        const author = typeof item === 'object' && item.author ? item.author : null;
        const rating = typeof item === 'object' && item.rating ? item.rating : 5;

        const li = document.createElement('li');
        li.title = 'Klik untuk otomatis scroll ke ulasan asli di Shopee';

        // Rating bintang visual
        const starsText = '⭐'.repeat(Math.min(5, Math.max(1, rating)));

        const iconSpan = document.createElement('span');
        iconSpan.style.flexShrink = '0';
        iconSpan.textContent = '💬';

        const contentSpan = document.createElement('span');
        if (author) {
            const authorStrong = document.createElement('strong');
            authorStrong.textContent = author;
            contentSpan.appendChild(authorStrong);
            contentSpan.appendChild(document.createTextNode(` (${starsText}): `));
        } else {
            contentSpan.appendChild(document.createTextNode(`(${starsText}): `));
        }
        contentSpan.appendChild(document.createTextNode(text));

        li.appendChild(iconSpan);
        li.appendChild(contentSpan);

        li.addEventListener('click', () => {
            if (!tabId) return;
            sendMessage(tabId, {
                action: 'SCROLL_TO_REVIEW',
                cmtId: cmtId,
                reviewIndex: typeof item === 'object' && item.index !== undefined ? item.index : idx,
                textSnippet: text.substring(0, 35)
            }).then((res) => {
                if (res && res.success) {
                    li.style.transform = 'scale(0.98)';
                    setTimeout(() => { li.style.transform = ''; }, 150);
                }
            }).catch(console.error);
        });

        listEl.appendChild(li);
    });
}

/**
 * 5. Render Smart Recommendations (Produk "Kamu Mungkin Juga Suka" di Shopee Native)
 * Menggunakan kartu Neo-Brutalist dengan thumbnail 64x64, badge Shopee Native, rating, dan CTA tactile
 */
function renderSimilarRecs(recs = []) {
    hide(els.similarRecsLoading);

    if (!els.similarRecsSection || !els.similarRecsList) return;
    if (!recs || recs.length === 0) {
        show(els.similarRecsSection);
        show(els.similarRecsEmpty);
        els.similarRecsList.innerHTML = '';
        return;
    }

    show(els.similarRecsSection);
    hide(els.similarRecsEmpty);
    els.similarRecsList.innerHTML = '';

    recs.slice(0, 4).forEach(rec => {
        const card = document.createElement('a');
        card.className = 'similar-card';
        card.href = rec.url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';

        if (rec.imageUrl) {
            const img = document.createElement('img');
            img.className = 'similar-thumb';
            img.src = rec.imageUrl;
            img.alt = rec.title || 'Produk';
            img.onerror = () => img.remove();
            card.appendChild(img);
        }

        const meta = document.createElement('div');
        meta.className = 'similar-meta';

        // Baris Atas: Badge Shopee Native + Rating Tag
        const tagRow = document.createElement('div');
        tagRow.className = 'similar-tag-row';

        const badge = document.createElement('span');
        badge.className = 'badge-marketplace badge-shopee';
        badge.textContent = '🟠 Shopee Native';
        tagRow.appendChild(badge);

        if (rec.rating) {
            const rating = document.createElement('span');
            rating.className = 'similar-rating-tag';
            rating.textContent = `⭐ ${rec.rating}`;
            tagRow.appendChild(rating);
        }

        meta.appendChild(tagRow);

        const title = document.createElement('div');
        title.className = 'similar-title';
        title.textContent = rec.title || '-';
        meta.appendChild(title);

        const bottom = document.createElement('div');
        bottom.className = 'similar-bottom';

        const price = document.createElement('div');
        price.className = 'similar-price';
        price.textContent = rec.rawPrice || (rec.price ? formatPrice(rec.price) : 'Cek Toko');
        bottom.appendChild(price);

        const actionBtn = document.createElement('span');
        actionBtn.className = 'similar-card-btn';
        actionBtn.innerHTML = 'Lihat ↗';
        bottom.appendChild(actionBtn);

        meta.appendChild(bottom);
        card.appendChild(meta);
        els.similarRecsList.appendChild(card);
    });
}

/**
 * 6. Render Cross-Market Deals (Best Value, Cheapest, Others)
 * Mendukung Playful Geometric Card & Fallback Deterministik saat AI Groq offline
 */
const specMap = {
    EXACT: { cls: 'green', text: 'Spec Cocok ✅' },
    UPGRADE: { cls: 'blue', text: 'Spec Lebih Tinggi ⬆️' },
    DOWNGRADE: { cls: 'red', text: 'Spec Lebih Rendah ⬇️' },
    DIFFERENT: { cls: 'yellow', text: 'Spec Beda ⚠️' },
    UNKNOWN: { cls: 'gray', text: 'Spec Belum Dicek ❓' }
};

function renderCrossMarketDeals(evaluation, searchResults = [], originalPrice = 0) {
    hide(els.crossMarketLoading);

    const totalCount = (searchResults && searchResults.length) || 0;
    if (els.crossMarketCountBadge) {
        els.crossMarketCountBadge.textContent = `${totalCount} Alternatif`;
    }

    if (totalCount === 0) {
        show(els.crossMarketSection);
        show(els.crossMarketEmpty);
        hide(els.bestValueSection);
        hide(els.cheapestSection);
        hide(els.otherResultsSection);
        return;
    }

    show(els.crossMarketSection);
    hide(els.crossMarketEmpty);

    // Helper untuk render 1 kartu deal highlight (Best Value / Cheapest)
    const renderDealCard = (container, dealType, kindBadge, candidate, reason, specStatus) => {
        if (!container || !candidate || !candidate.title) {
            hide(container);
            return;
        }

        const market = getMarketplaceBadge(
            candidate.marketplace || (candidate.url ? new window.SearchClient().getMarketplace(candidate.url) : 'Marketplace')
        );
        const priceNum = candidate.price || 0;
        const savingsText = (originalPrice > 0 && priceNum > 0 && priceNum < originalPrice)
            ? `Hemat Rp ${(originalPrice - priceNum).toLocaleString('id-ID')}`
            : null;

        const specInfo = specMap[specStatus || candidate.spec_status || candidate.specStatus] || null;

        container.innerHTML = `
            <div class="deal-card-header">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="status-badge ${dealType === 'best' ? 'green' : 'yellow'}">${kindBadge}</span>
                    <span class="badge-marketplace ${market.cls}">${market.label}</span>
                </div>
                ${specInfo ? `<span class="status-badge ${specInfo.cls}">${specInfo.text}</span>` : ''}
            </div>
            <div class="deal-card-title">${candidate.title}</div>
            <div class="deal-card-price-row">
                <span class="deal-card-price">${formatPrice(priceNum)}</span>
                ${savingsText ? `<span class="deal-card-savings">${savingsText}</span>` : ''}
            </div>
            ${reason ? `<div class="deal-card-reason">💡 ${reason}</div>` : ''}
            <a href="${candidate.url || '#'}" target="_blank" rel="noopener noreferrer" class="deal-card-link-btn">
                Buka di ${candidate.marketplace || 'Toko'} ↗
            </a>
        `;
        show(container);
    };

    // Kasus 1: Evaluasi AI Groq berhasil
    if (evaluation && (evaluation.best_value || evaluation.cheapest)) {
        const best = evaluation.best_value;
        const cheap = evaluation.cheapest;

        renderDealCard(els.bestValueSection, 'best', '🏆 Best Value', best, best?.reason, best?.spec_status);
        renderDealCard(els.cheapestSection, 'cheapest', '🏷️ Termurah', cheap, cheap?.reason, cheap?.spec_status);

        // Render Alternatif Lainnya (hingga 10 produk dengan Badge Spesifikasi)
        const others = evaluation.others || [];
        if (others.length > 0 && els.otherResultsSection) {
            const displayCount = Math.min(others.length, 10);
            els.otherResultsSection.innerHTML = `
                <div class="section-title-wrap" style="margin-bottom: 6px;">
                    <h3 class="section-title font-heading">📋 Alternatif Lainnya (${displayCount})</h3>
                </div>
                <div class="other-deals-list">
                    ${others.slice(0, 10).map(o => {
                        const m = getMarketplaceBadge(o.marketplace || (o.url ? new window.SearchClient().getMarketplace(o.url) : 'Marketplace'));
                        const sStatus = o.spec_status || o.specStatus || 'EXACT';
                        const sInfo = specMap[sStatus] || specMap.EXACT;
                        return `
                            <div class="other-deal-item">
                                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span class="badge-marketplace ${m.cls}">${m.label}</span>
                                        <span class="status-badge ${sInfo.cls}" style="font-size: 0.68rem; padding: 2px 6px;">${sInfo.text}</span>
                                    </div>
                                    <span style="font-family: 'Outfit', sans-serif; font-size: 0.95rem; font-weight: 800; color: var(--accent-violet);">
                                        ${formatPrice(o.price)}
                                    </span>
                                </div>
                                <div style="font-size: 0.78rem; font-weight: 700; line-height: 1.3; color: var(--fg-slate);">
                                    ${o.title}
                                </div>
                                ${o.reason ? `<div style="font-size: 0.74rem; color: #64748B;">${o.reason}</div>` : ''}
                                <a href="${o.url || '#'}" target="_blank" rel="noopener noreferrer" style="font-size: 0.75rem; color: #0284C7; font-weight: 700; text-decoration: underline; margin-top: 2px;">
                                    Kunjungi Toko ↗
                                </a>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
            show(els.otherResultsSection);
        } else {
            hide(els.otherResultsSection);
        }
    } else {
        // Kasus 2: RESILIENT FALLBACK (Groq offline atau format error)
        console.warn('[SI:CrossMarket] Evaluasi AI Groq null -> Menjalankan Fallback Deterministik dari Exa');
        const validPriceCandidates = [...searchResults].filter(c => c.price && c.price > 1000).sort((a, b) => a.price - b.price);
        const cheapestPick = validPriceCandidates[0] || searchResults[0];
        const bestPick = searchResults.find(c => c !== cheapestPick) || cheapestPick;

        renderDealCard(
            els.bestValueSection,
            'best',
            '🏆 Pilihan Teratas',
            bestPick,
            'Kandidat relevan teratas dari pencarian neural',
            'EXACT'
        );

        if (cheapestPick && cheapestPick !== bestPick) {
            renderDealCard(
                els.cheapestSection,
                'cheapest',
                '🏷️ Harga Termurah',
                cheapestPick,
                'Kandidat dengan nominal harga terendah di marketplace',
                'EXACT'
            );
        } else {
            hide(els.cheapestSection);
        }

        const remaining = searchResults.filter(c => c !== bestPick && c !== cheapestPick);
        if (remaining.length > 0 && els.otherResultsSection) {
            const displayCount = Math.min(remaining.length, 10);
            els.otherResultsSection.innerHTML = `
                <div class="section-title-wrap" style="margin-bottom: 6px;">
                    <h3 class="section-title font-heading">📋 Alternatif Lainnya (${displayCount})</h3>
                </div>
                <div class="other-deals-list">
                    ${remaining.slice(0, 10).map(o => {
                        const m = getMarketplaceBadge(o.marketplace || (o.url ? new window.SearchClient().getMarketplace(o.url) : 'Marketplace'));
                        const sStatus = o.spec_status || o.specStatus || 'EXACT';
                        const sInfo = specMap[sStatus] || specMap.EXACT;
                        return `
                            <div class="other-deal-item">
                                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span class="badge-marketplace ${m.cls}">${m.label}</span>
                                        <span class="status-badge ${sInfo.cls}" style="font-size: 0.68rem; padding: 2px 6px;">${sInfo.text}</span>
                                    </div>
                                    <span style="font-family: 'Outfit', sans-serif; font-size: 0.95rem; font-weight: 800; color: var(--accent-violet);">
                                        ${formatPrice(o.price)}
                                    </span>
                                </div>
                                <div style="font-size: 0.78rem; font-weight: 700; line-height: 1.3; color: var(--fg-slate);">
                                    ${o.title}
                                </div>
                                <a href="${o.url || '#'}" target="_blank" rel="noopener noreferrer" style="font-size: 0.75rem; color: #0284C7; font-weight: 700; text-decoration: underline; margin-top: 2px;">
                                    Kunjungi Toko ↗
                                </a>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
            show(els.otherResultsSection);
        } else {
            hide(els.otherResultsSection);
        }
    }
}

/**
 * Master Renderer: Menggambar seluruh data dari cache atau hasil analisis
 */
function renderAll(data, tabId) {
    if (!data) return;
    currentAnalysisData = data;
    const { marketplace, product, reviewSummary, evaluation, searchResults, ultimateDeal } = data;

    renderOriginalProduct(product, marketplace);

    if (product.warrantyAudit) {
        renderWarrantyInfo(product.warrantyAudit);
    }

    if (product.similarRecommendations) {
        renderSimilarRecs(product.similarRecommendations);
    }

    if (reviewSummary) {
        renderReviewSummary(reviewSummary, tabId, product?.reviews || reviewSummary?.rawReviews);
    }

    renderCrossMarketDeals(evaluation, searchResults || [], product.price || 0);

    if (ultimateDeal) {
        renderDealChecker(ultimateDeal);
    }
}

// =========================================================================
// PIPELINE ANALISIS UTAMA
// =========================================================================

async function analyze(tab) {
    if (!tab || !tab.id) {
        throw new Error('Tidak ada tab aktif.');
    }
    currentActiveTabId = tab.id;

    // 1. Deteksi Halaman
    console.log('[SI:Pipeline] Step 1: Deteksi halaman marketplace...');
    setLoadingState(true, 'Mendeteksi halaman produk...');
    let detection = null;
    try {
        detection = await sendMessage(tab.id, { action: 'DETECT_PAGE' });
    } catch (e) {
        console.error('[SI:Pipeline] DETECT_PAGE error:', e);
        throw e;
    }

    if (!detection || !detection.isProduct) {
        const reason = (detection && detection.reason) ? detection.reason : 'Buka halaman produk di Shopee, Tokopedia, atau Lazada.';
        throw new Error(reason);
    }

    const marketplace = detection.marketplace || 'Shopee';
    console.log(`[SI:Pipeline] Halaman produk terdeteksi di: ${marketplace}`);

    // 2. Ekstraksi Data Produk (Layer 1-3 God-Level Scraper)
    console.log('[SI:Pipeline] Step 2: Ekstraksi data produk...');
    setLoadingState(true, `Mengekstrak data produk dari ${marketplace}...`);
    let extraction = null;
    try {
        extraction = await sendMessage(tab.id, { action: 'EXTRACT_PRODUCT' });
    } catch (e) {
        console.error('[SI:Pipeline] EXTRACT_PRODUCT error:', e);
        throw e;
    }

    if (!extraction || !extraction.success || !extraction.product) {
        const errDetail = (extraction && extraction.error) ? extraction.error : `Gagal membaca informasi produk dari ${marketplace}.`;
        throw new Error(errDetail);
    }

    const product = extraction.product;
    console.log('[SI:Pipeline] Produk berhasil diekstrak:', {
        title: product.title,
        price: product.price,
        rating: product.rating,
        reviewsCount: product.reviewCount,
        hasInitialSimilar: (product.similarRecommendations || []).length
    });

    // Segera tampilkan Hero dan Warranty
    renderOriginalProduct(product, marketplace);
    if (product.warrantyAudit) renderWarrantyInfo(product.warrantyAudit);

    // =====================================================================
    // Branch A: Review Intelligence (Force Render & Wait + Groq AI)
    // =====================================================================
    show(els.reviewSummarySection);
    show(els.reviewLoadingIndicator);
    hide(els.reviewEmptyMessage);
    hide(els.reviewRisksContainer);
    hide(els.reviewProsConsGrid);

    const reviewPromise = (async () => {
        let reviews = [];
        try {
            console.log('[SI:Reviews] Memulai ekstraksi ulasan pembeli via Content Script...');
            let reviewRes = await sendMessage(tab.id, { action: 'EXTRACT_REVIEWS' });
            reviews = (reviewRes && Array.isArray(reviewRes.reviews)) ? reviewRes.reviews : [];
            console.log(`[SI:Reviews] Ekstraksi tahap 1: ditemukan ${reviews.length} ulasan.`);

            // Two-Stage Retry: Jika ulasan masih 0, tunggu 1.2 detik lalu ulangi sekali lagi
            // guna mengantisipasi delay IntersectionObserver dan dynamic render Shopee
            if (reviews.length === 0) {
                console.log('[SI:Reviews] Ulasan 0 di tahap 1, menunggu 1.2s untuk Two-Stage Retry...');
                await new Promise(resolve => setTimeout(resolve, 1200));
                reviewRes = await sendMessage(tab.id, { action: 'EXTRACT_REVIEWS' });
                reviews = (reviewRes && Array.isArray(reviewRes.reviews)) ? reviewRes.reviews : [];
                console.log(`[SI:Reviews] Ekstraksi tahap 2 (Retry): ditemukan ${reviews.length} ulasan.`);
            }

            if (reviews.length === 0) {
                const emptyData = {
                    status: 'NO_REVIEWS',
                    pros: [],
                    cons: [],
                    risks: [],
                    confidence: 'LOW',
                    message: 'Belum ada ulasan pembeli yang dapat dianalisis untuk produk ini.'
                };
                renderReviewSummary(emptyData, tab.id, []);
                return emptyData;
            }

            console.log(`[SI:Reviews] Mengirim ${reviews.length} ulasan ke Groq AI untuk dianalisis...`);
            let summary = null;
            try {
                const ai = new window.AIClient();
                summary = await ai.summarizeReviews(product.title, reviews);
                console.log('[SI:Reviews] Ringkasan ulasan Groq sukses:', summary);
            } catch (aiErr) {
                console.warn('[SI:Reviews] Groq summarizeReviews gagal:', aiErr);
                summary = null;
            }

            // Jika AI gagal mengembalikan hasil (null/error) atau pros & cons kosong padahal ulasan mentah ada
            if (!summary || summary.status !== 'SUCCESS' || (!summary.pros?.length && !summary.cons?.length)) {
                console.warn('[SI:Reviews] AI gagal menghasilkan ringkasan. Mengaktifkan fallback ulasan asli.');
                const fallbackData = {
                    status: 'FALLBACK_RAW',
                    rawReviews: reviews,
                    pros: [],
                    cons: [],
                    risks: [],
                    confidence: reviews.length >= 5 ? 'MEDIUM' : 'LOW',
                    fallbackMessage: 'AI gagal merangkum, tetapi berikut adalah ulasan asli dari pembeli:'
                };
                renderReviewSummary(fallbackData, tab.id, reviews);
                return fallbackData;
            }

            renderReviewSummary(summary, tab.id, reviews);
            return summary;
        } catch (err) {
            console.warn('[SI:Reviews] Review Intelligence error:', err);
            // Fallback juga jika terjadi exception tak terduga, selama ulasan mentah ada
            if (reviews && Array.isArray(reviews) && reviews.length > 0) {
                const fallbackData = {
                    status: 'FALLBACK_RAW',
                    rawReviews: reviews,
                    pros: [],
                    cons: [],
                    risks: [],
                    confidence: reviews.length >= 5 ? 'MEDIUM' : 'LOW',
                    fallbackMessage: 'AI gagal merangkum, tetapi berikut adalah ulasan asli dari pembeli:'
                };
                renderReviewSummary(fallbackData, tab.id, reviews);
                return fallbackData;
            }
            hide(els.reviewLoadingIndicator);
            show(els.reviewEmptyMessage);
            if (els.reviewEmptyMessage) {
                els.reviewEmptyMessage.textContent = `Analisis ulasan terkendala: ${err.message || 'Gagal memproses ulasan'}`;
            }
            return null;
        }
    })();

    // =====================================================================
    // Branch B: Native Recommendations ("Kamu Mungkin Juga Suka")
    // =====================================================================
    show(els.similarRecsSection);
    show(els.similarRecsLoading);
    hide(els.similarRecsEmpty);

    const nativeRecsPromise = (async () => {
        let recs = Array.isArray(product.similarRecommendations) && product.similarRecommendations.length > 0
            ? product.similarRecommendations
            : [];

        if (recs.length === 0) {
            console.log('[SI:Native] Rekomendasi di hero kosong, mencoba asinkron EXTRACT_SIMILAR_RECS...');
            try {
                const recRes = await sendMessage(tab.id, {
                    action: 'EXTRACT_SIMILAR_RECS',
                    product: { title: product.title, price: product.price }
                });
                if (recRes && Array.isArray(recRes.recommendations) && recRes.recommendations.length > 0) {
                    recs = recRes.recommendations;
                }
            } catch (e) {
                console.warn('[SI:Native] Async EXTRACT_SIMILAR_RECS error:', e);
            }
        }

        console.log(`[SI:Native] Rekomendasi native diperoleh: ${recs.length} item.`);
        renderSimilarRecs(recs);
        product.similarRecommendations = recs;
        return recs;
    })();

    // =====================================================================
    // Branch C: Cross-Market Deals (Exa Neural Search + Groq AI)
    // Dieksekusi langsung di Side Panel (Bebas dari CSP Halaman Marketplace)
    // =====================================================================
    show(els.crossMarketSection);
    show(els.crossMarketLoading);
    hide(els.crossMarketEmpty);

    const crossMarketPromise = (async () => {
        let aiData = null;
        try {
            console.log('[SI:AI] Menjalankan understandProduct langsung di Side Panel...');
            const ai = new window.AIClient();
            aiData = await ai.understandProduct(product);
            console.log('[SI:AI] understandProduct sukses:', aiData);
        } catch (e) {
            console.warn('[SI:AI] understandProduct gagal, menggunakan fallback title:', e);
        }

        let searchResults = [];
        try {
            console.log('[SI:Exa] Mencari alternatif produk melalui Exa API...');
            const searchClient = new window.SearchClient();
            searchResults = await searchClient.searchAlternatives(product, aiData);
            console.log(`[SI:Exa] Exa search selesai: ${searchResults.length} kandidat ditemukan.`);
        } catch (e) {
            console.error('[SI:Exa] Search alternatives error:', e);
            if (els.crossMarketEmptyText) {
                els.crossMarketEmptyText.textContent = `Pencarian Exa gagal: ${e.message}`;
            }
        }

        let evaluation = null;
        if (searchResults && searchResults.length > 0) {
            try {
                console.log('[SI:AI] Mengevaluasi kandidat deals dengan Groq AI (Strict Category Gatekeeper)...');
                const ai = new window.AIClient();
                evaluation = await ai.evaluateDeals(product, searchResults, aiData);
                console.log('[SI:AI] evaluateDeals sukses:', evaluation);
            } catch (e) {
                console.warn('[SI:AI] evaluateDeals gagal, masuk mode fallback deterministik:', e);
            }
        }

        renderCrossMarketDeals(evaluation, searchResults, product.price);
        return { aiData, searchResults, evaluation };
    })();

    // Eksekusi Semua Cabang Paralel
    console.log('[SI:Pipeline] Step 3: Menjalankan cabang analisis paralel...');
    const [reviewSettled, nativeSettled, crossMarketSettled] = await Promise.allSettled([
        reviewPromise,
        nativeRecsPromise,
        crossMarketPromise
    ]);

    const reviewSummary = reviewSettled.status === 'fulfilled' ? reviewSettled.value : null;
    const nativeRecs = nativeSettled.status === 'fulfilled' ? nativeSettled.value : [];
    const dealsResult = crossMarketSettled.status === 'fulfilled'
        ? crossMarketSettled.value
        : { aiData: null, searchResults: [], evaluation: null };
    const { aiData, searchResults, evaluation } = dealsResult;

    // =====================================================================
    // Branch D: Ultimate Deal Checker (BUY / CHECK / WAIT)
    // =====================================================================
    console.log('[SI:DealChecker] Menghitung Ultimate Deal Score...');
    setLoadingState(true, 'Menghitung Deal Score...');
    let ultimateDeal = null;
    try {
        const ai = new window.AIClient();
        const combinedRecs = [
            ...(nativeRecs || []),
            ...(searchResults || [])
        ];
        ultimateDeal = await ai.evaluateUltimateDeal(product, combinedRecs, reviewSummary, aiData);
        console.log('[SI:DealChecker] Ultimate Deal Score:', ultimateDeal.dealScore, ultimateDeal.verdict);
        renderDealChecker(ultimateDeal);
    } catch (e) {
        console.warn('[SI:DealChecker] evaluateUltimateDeal error:', e);
    }

    return {
        marketplace,
        product,
        reviewSummary,
        aiData,
        searchResults,
        evaluation,
        ultimateDeal
    };
}

async function analyzeAndCache(tab) {
    const cacheKey = cacheKeyFor(tab);
    try {
        const data = await analyze(tab);
        renderAll(data, tab.id);
        try {
            await chrome.storage.local.set({ [cacheKey]: data });
        } catch (e) { }
    } catch (err) {
        console.error('[Shopping Intelligence] analyze error:', err);
        renderError(err.message || 'Terjadi kesalahan saat menganalisis produk.', err.isConnectionError);
    } finally {
        setLoadingState(false);
    }
}

async function onReanalyze() {
    if (isProcessing) return;
    const tab = await getActiveTab();
    if (!tab) {
        renderError('Tidak ada tab aktif.');
        return;
    }
    const cacheKey = cacheKeyFor(tab);
    await chrome.storage.local.remove([cacheKey]);
    await analyzeAndCache(tab);
}

// === Lifecycle Init ===
async function init() {
    await loadKeys();

    if (els.reanalyzeBtn) {
        els.reanalyzeBtn.addEventListener('click', onReanalyze);
    }
    if (els.saveKeysBtn) {
        els.saveKeysBtn.addEventListener('click', saveKeys);
    }
    if (els.nativeSearchBtn) {
        els.nativeSearchBtn.addEventListener('click', onNativeSearchClick);
    }
    if (els.exaSearchBtn) {
        els.exaSearchBtn.addEventListener('click', onExaSearchClick);
    }

    const tab = await getActiveTab();
    if (!tab) {
        renderError('Tidak ada tab aktif.');
        return;
    }
    currentActiveTabId = tab.id;

    // Cek cache
    const cacheKey = cacheKeyFor(tab);
    const cached = await chrome.storage.local.get([cacheKey]);
    if (cached && cached[cacheKey]) {
        console.log('[Shopping Intelligence] Cache Hit:', cacheKey);
        renderAll(cached[cacheKey], tab.id);
        setLoadingState(false);
        return;
    }

    await analyzeAndCache(tab);
}

document.addEventListener('DOMContentLoaded', init);

// =========================================================================
// SECTION 6: NATIVE SEARCH PROTOCOL ORCHESTRATION (PHASE 3)
// =========================================================================

function renderNativeCandidates(candidates = []) {
    if (!els.searchResults) return;
    els.searchResults.innerHTML = '';

    if (!candidates || candidates.length === 0) {
        els.searchResults.innerHTML = `
            <div style="font-size: 0.8rem; color: #64748B; padding: 8px 0;">
                Tidak ada kandidat produk yang lolos validasi dari Shopee.
            </div>
        `;
        return;
    }

    candidates.forEach(cand => {
        const item = document.createElement('div');
        item.className = 'native-candidate-card';
        const formattedPrice = cand.price ? formatPrice(cand.price) : 'Harga tidak tersedia';
        const ratingBadge = cand.rating ? `⭐ ${cand.rating.toFixed(1)}` : '';
        const soldText = cand.sold ? `· ${cand.sold} terjual` : '';
        const locText = cand.location ? `📍 ${cand.location}` : '';

        item.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                <span class="badge-marketplace badge-shopee" style="font-size: 0.65rem;">🟠 Shopee Native</span>
                <span style="font-size: 0.7rem; color: #64748B; font-weight: 600;">${locText}</span>
            </div>
            <div style="font-size: 0.8rem; font-weight: 700; color: var(--fg-slate); line-height: 1.3;">
                ${cand.title}
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                <span style="font-family: 'Outfit', sans-serif; font-size: 0.95rem; font-weight: 800; color: #EE4D2D;">
                    ${formattedPrice}
                </span>
                <span style="font-size: 0.72rem; color: #475569; font-weight: 600;">
                    ${ratingBadge} ${soldText}
                </span>
            </div>
            <a href="${cand.url || '#'}" target="_blank" rel="noopener noreferrer" style="font-size: 0.74rem; color: #0284C7; font-weight: 700; text-decoration: underline; margin-top: 2px;">
                Buka di Shopee ↗
            </a>
        `;
        els.searchResults.appendChild(item);
    });
}

async function onNativeSearchClick() {
    if (!currentAnalysisData || !currentAnalysisData.product) {
        alert('Harap tunggu analisis produk selesai sebelum mencari alternatif.');
        return;
    }

    const product = currentAnalysisData.product;
    const aiData = currentAnalysisData.aiData || null;

    // 1. Cek Rate Limiting (Maks 1x per 2 menit per user per marketplace)
    const now = Date.now();
    const rateLimitKey = 'rate_limit_shopee_native';
    const lastSearch = (await chrome.storage.local.get([rateLimitKey]))?.[rateLimitKey] || 0;
    const elapsed = now - lastSearch;

    if (elapsed < 120000) {
        const remainingSec = Math.ceil((120000 - elapsed) / 1000);
        alert(`Harap tunggu ${remainingSec} detik lagi sebelum memicu pencarian native Shopee berikutnya.`);
        return;
    }

    // 2. Cek Cache 30 Menit: (fingerprint, marketplace)
    const brand = aiData?.brand || product.brand || 'unknown';
    const model = aiData?.model || product.model || '';
    const cacheKey = `native_cache_${brand}_${model}_shopee`.replace(/\s+/g, '_').toLowerCase();

    const cachedData = (await chrome.storage.local.get([cacheKey]))?.[cacheKey];
    if (cachedData && cachedData.candidates && (now - cachedData.timestamp < 1800000)) {
        console.log('[Shopping Intelligence] Native Search Cache Hit (<30 menit):', cacheKey);
        hide(els.searchBlocked);
        hide(els.searchProgress);
        renderNativeCandidates(cachedData.candidates);
        return;
    }

    // 3. Tampilkan UI Progress
    show(els.searchProgress);
    hide(els.searchBlocked);
    if (els.searchProgressText) {
        els.searchProgressText.textContent = 'Membuka pencarian Shopee sebentar. Jangan tutup tab ini...';
    }
    if (els.searchResults) {
        els.searchResults.innerHTML = '';
    }

    try {
        const manifest = window.shopeeManifest;
        const provider = new window.ShopeeNativeProvider(manifest);

        const candidates = await provider.search(product, {
            fingerprint: aiData,
            timeout: 15000
        });

        // Simpan Cache 30 menit & Perbarui Rate Limit
        await chrome.storage.local.set({
            [cacheKey]: { candidates: candidates, timestamp: now },
            [rateLimitKey]: now
        });

        hide(els.searchProgress);
        renderNativeCandidates(candidates);

    } catch (err) {
        hide(els.searchProgress);
        console.warn('[Shopping Intelligence] Native search error:', err);

        if (err.status === 'BLOCKED') {
            show(els.searchBlocked);
            if (els.manualOpenLink) {
                const queryText = (aiData?.search_query || product.title || '').trim();
                els.manualOpenLink.href = `https://shopee.co.id/search?keyword=${encodeURIComponent(queryText)}`;
            }
        } else if (err.status === 'CANCELLED_BY_USER') {
            if (els.searchResults) {
                els.searchResults.innerHTML = `
                    <div style="font-size: 0.8rem; color: #EA580C; background: #FFF7ED; border: 1.5px solid #FDBA74; border-radius: 8px; padding: 8px;">
                        ⚠️ Tab Shopee ditutup sebelum selesai membaca hasil. Tekan tombol lagi jika ingin mencari ulang.
                    </div>
                `;
            }
        } else if (err.status === 'TIMEOUT') {
            if (els.searchResults) {
                els.searchResults.innerHTML = `
                    <div style="font-size: 0.8rem; color: #64748B; background: #F8FAFC; border: 1.5px solid #CBD5E1; border-radius: 8px; padding: 8px;">
                        ⏱️ Halaman Shopee membutuhkan waktu hidrasi lebih lama dari biasanya. Coba cari ulang atau gunakan tombol Exa di bawah.
                    </div>
                `;
            }
        } else {
            if (els.searchResults) {
                els.searchResults.innerHTML = `
                    <div style="font-size: 0.8rem; color: #DC2626; background: #FEF2F2; border: 1.5px solid #FCA5A5; border-radius: 8px; padding: 8px;">
                        ❌ Terjadi kesalahan: ${err.message}
                    </div>
                `;
            }
        }
    }
}

async function onExaSearchClick() {
    if (!currentAnalysisData || !currentAnalysisData.product) {
        alert('Harap tunggu analisis produk selesai sebelum mencari alternatif.');
        return;
    }

    const product = currentAnalysisData.product;
    const aiData = currentAnalysisData.aiData || null;

    show(els.searchProgress);
    hide(els.searchBlocked);
    if (els.searchProgressText) {
        els.searchProgressText.textContent = 'Mencari alternatif melalui Exa Neural Search...';
    }

    try {
        const { exaKey } = await chrome.storage.local.get(['exaKey']);
        const exaProvider = new window.ExaProvider({ apiKey: exaKey });

        const rawResults = await exaProvider.search(product, {
            aiData: aiData,
            rawProduct: product
        });

        const normalized = rawResults.map(r => {
            return window.CandidateNormalizer.normalizeCandidate(r, r.marketplace, 'exa-fallback');
        }).filter(Boolean);

        hide(els.searchProgress);
        renderNativeCandidates(normalized);

    } catch (err) {
        hide(els.searchProgress);
        if (els.searchResults) {
            els.searchResults.innerHTML = `
                <div style="font-size: 0.8rem; color: #DC2626; background: #FEF2F2; border: 1.5px solid #FCA5A5; border-radius: 8px; padding: 8px;">
                    ❌ Pencarian Exa gagal: ${err.message}
                </div>
            `;
        }
    }
}

// Runtime Message Listener untuk Progress Updates
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'SEARCH_PROGRESS') {
            if (els.searchProgressText) {
                if (message.current && message.total) {
                    els.searchProgressText.textContent = `${message.message} (${message.current}/${message.total})`;
                } else {
                    els.searchProgressText.textContent = message.message;
                }
            }
        }
    });
}

// Auto-cancel on Sidepanel Unload / Close
window.addEventListener('pagehide', () => {
    try {
        chrome.runtime.sendMessage({ action: 'CANCEL_NATIVE_SEARCH', reason: 'sidepanel_closed' });
    } catch (e) { }
});
