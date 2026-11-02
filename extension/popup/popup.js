/**
 * popup.js
 *
 * Anti-crash popup flow:
 * 1. Tampilkan loading, sembunyikan section lain
 * 2. Cek cache chrome.storage.local -> kalau ada, render langsung
 * 3. Kalau tidak: EXTRACT_PRODUCT -> UNDERSTAND_PRODUCT -> SEARCH_ALTERNATIVES -> EVALUATE_DEALS
 * 4. Selalu bungkus try-catch; gagal -> tampilkan errorState (tidak pernah blank)
 */

// === Elemen DOM ===
const els = {
    version: document.getElementById('version'),
    reanalyzeBtn: document.getElementById('reanalyzeBtn'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    originalProduct: document.getElementById('originalProduct'),
    reviewSummarySection: document.getElementById('reviewSummarySection'),
    reviewConfidenceBadge: document.getElementById('reviewConfidenceBadge'),
    reviewLoadingIndicator: document.getElementById('reviewLoadingIndicator'),
    reviewEmptyMessage: document.getElementById('reviewEmptyMessage'),
    reviewRisksContainer: document.getElementById('reviewRisksContainer'),
    reviewRisksList: document.getElementById('reviewRisksList'),
    reviewProsConsGrid: document.getElementById('reviewProsConsGrid'),
    reviewProsList: document.getElementById('reviewProsList'),
    reviewConsList: document.getElementById('reviewConsList'),
    bestValueSection: document.getElementById('bestValueSection'),
    cheapestSection: document.getElementById('cheapestSection'),
    otherResultsSection: document.getElementById('otherResultsSection'),
    inputGroqKey: document.getElementById('inputGroqKey'),
    inputExaKey: document.getElementById('inputExaKey'),
    saveKeysBtn: document.getElementById('saveKeysBtn'),
    keyStatus: document.getElementById('keyStatus')
};

try {
    els.version.textContent = 'v' + chrome.runtime.getManifest().version;
} catch (e) {
    console.error('[Shopping Intelligence] gagal baca versi:', e);
}

// === UI helpers ===
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

function hideResultSections() {
    hide(els.originalProduct);
    hide(els.reviewSummarySection);
    hide(els.bestValueSection);
    hide(els.cheapestSection);
    hide(els.otherResultsSection);
    hide(els.errorState);
}

let isProcessing = false;

function showLoading(text) {
    els.loadingState.textContent = text || 'Menganalisis...';
    show(els.loadingState);
}

function hideLoading() {
    hide(els.loadingState);
}

function setLoadingState(isLoading, message) {
    isProcessing = isLoading;
    if (els.reanalyzeBtn) {
        els.reanalyzeBtn.disabled = isLoading;
        if (isLoading) {
            els.reanalyzeBtn.classList.add('btn-disabled');
        } else {
            els.reanalyzeBtn.classList.remove('btn-disabled');
        }
    }
    if (els.saveKeysBtn) {
        els.saveKeysBtn.disabled = isLoading;
    }

    if (isLoading) {
        showLoading(message || 'Menganalisis...');
    } else {
        hideLoading();
    }
}

function showError(message) {
    console.log('[Shopping Intelligence] ERROR:', message);
    setLoadingState(false);
    hideResultSections();
    els.errorState.textContent = message;
    show(els.errorState);
}

function isSupportedMarketplaceUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return host.includes('shopee.co.id') || host.includes('tokopedia.com') || host.includes('lazada.co.id');
    } catch (e) {
        return false;
    }
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
    return 'cache_' + (tab.url || ('tabId_' + tab.id));
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
        if (els.keyStatus) els.keyStatus.textContent = '✅ Keys Saved!';
    } catch (e) {
        console.error('[Shopping Intelligence] gagal simpan API keys:', e);
        if (els.keyStatus) els.keyStatus.textContent = '❌ Gagal menyimpan keys.';
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

function isCheaper(price, originalPrice) {
    if (price === null || price === undefined || originalPrice === null || originalPrice === undefined) {
        return false;
    }
    const candPrice = Number(price);
    const origPrice = Number(originalPrice);
    if (isNaN(candPrice) || isNaN(origPrice)) return false;
    // Hanya anggap lebih murah jika harga masuk akal (> Rp 1.000) dan benar-benar di bawah harga asli
    return candPrice >= 1000 && candPrice < origPrice;
}

function marketClass(mark) {
    switch (mark) {
        case 'Shopee': return 'market-shopee';
        case 'Tokopedia': return 'market-tokopedia';
        case 'Lazada': return 'market-lazada';
        case 'Blibli': return 'market-blibli';
        default: return 'market-other';
    }
}

// === Builders ===
function buildResultCard(candidate, reason, kind, originalPrice) {
    const card = document.createElement('div');
    card.className = 'result-card ' + (kind || 'other');

    const head = document.createElement('div');
    head.className = 'rc-head';

    const market = document.createElement('span');
    market.className = 'badge-marketplace ' + marketClass(candidate.marketplace);
    market.textContent = candidate.marketplace || 'Other';
    head.appendChild(market);

    const statusMap = {
        EXACT: { cls: 'green', label: 'Spec Cocok ✅' },
        UPGRADE: { cls: 'yellow', label: 'Spec Lebih Tinggi ⬆️' },
        DOWNGRADE: { cls: 'red', label: 'Spec Lebih Rendah ⬇️' },
        UNKNOWN: { cls: 'gray', label: 'Spec Tidak Jelas ❓' }
    };
    const status = statusMap[candidate.specStatus] || { cls: 'gray', label: candidate.specStatus || 'Spec ?' };
    const statusBadge = document.createElement('span');
    statusBadge.className = 'status-badge ' + status.cls;
    statusBadge.textContent = status.label;
    head.appendChild(statusBadge);

    if (isCheaper(candidate.price, originalPrice)) {
        const cheaper = document.createElement('span');
        cheaper.className = 'status-badge green';
        cheaper.textContent = 'Lebih Murah';
        head.appendChild(cheaper);
    }

    if (candidate.isDirectProduct === false) {
        const warn = document.createElement('span');
        warn.className = 'status-badge yellow';
        warn.textContent = '⚠️ Link Pencarian';
        head.appendChild(warn);
    }

    card.appendChild(head);

    const title = document.createElement('div');
    title.className = 'rc-title';
    title.textContent = candidate.title || '-';
    card.appendChild(title);

    if (candidate.snippet) {
        const snippet = document.createElement('div');
        snippet.className = 'rc-snippet';
        snippet.textContent = candidate.snippet;
        card.appendChild(snippet);
    }

    const price = document.createElement('div');
    if (candidate.price !== null && candidate.price !== undefined) {
        price.className = 'price';
        price.textContent = formatPrice(candidate.price, 'IDR');
    } else {
        price.className = 'price missing';
        price.textContent = 'Harga tidak terdeteksi';
    }
    card.appendChild(price);

    if (reason) {
        const reasonEl = document.createElement('div');
        reasonEl.className = 'reason-text';
        reasonEl.textContent = reason;
        card.appendChild(reasonEl);
    }

    const link = document.createElement('a');
    link.className = 'rc-link';
    link.href = candidate.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `Buka di ${candidate.marketplace || 'Marketplace'}`;
    card.appendChild(link);

    return card;
}

function renderOriginalProduct(product, marketplace) {
    els.originalProduct.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = `🛒 Produk Asli (${marketplace || 'Shopee'})`;
    els.originalProduct.appendChild(title);

    const head = document.createElement('div');
    head.className = 'op-head';

    if (product.imageUrl) {
        const img = document.createElement('img');
        img.className = 'op-image';
        img.alt = 'Produk';
        img.src = product.imageUrl;
        img.onerror = () => img.remove();
        head.appendChild(img);
    }

    const info = document.createElement('div');

    const name = document.createElement('div');
    name.className = 'op-title';
    name.textContent = product.title || '-';
    info.appendChild(name);

    const price = document.createElement('div');
    price.className = 'op-price price';
    price.textContent = formatPrice(product.price, product.currency);
    info.appendChild(price);

    const metaParts = [];
    if (product.rating !== null && product.rating !== undefined) metaParts.push(`⭐ ${product.rating}`);
    if (product.reviewCount !== null && product.reviewCount !== undefined) metaParts.push(`${product.reviewCount} ulasan`);
    if (product.seller && product.seller.name) metaParts.push(product.seller.name);
    if (metaParts.length) {
        const meta = document.createElement('div');
        meta.className = 'op-meta';
        meta.textContent = metaParts.join(' · ');
        info.appendChild(meta);
    }

    head.appendChild(info);
    els.originalProduct.appendChild(head);

    show(els.originalProduct);
}

function renderReviewSummary(reviewData) {
    if (!reviewData) {
        hide(els.reviewSummarySection);
        return;
    }

    hide(els.reviewLoadingIndicator);
    show(els.reviewSummarySection);

    if (reviewData.status === 'NO_REVIEWS' || (!reviewData.pros?.length && !reviewData.cons?.length && !reviewData.risks?.length)) {
        show(els.reviewEmptyMessage);
        hide(els.reviewRisksContainer);
        hide(els.reviewProsConsGrid);
        if (els.reviewConfidenceBadge) {
            els.reviewConfidenceBadge.className = 'status-badge gray';
            els.reviewConfidenceBadge.textContent = 'Tanpa Ulasan';
        }
        return;
    }

    hide(els.reviewEmptyMessage);

    // Confidence Badge
    if (els.reviewConfidenceBadge) {
        const conf = (reviewData.confidence || 'LOW').toUpperCase();
        if (conf === 'HIGH') {
            els.reviewConfidenceBadge.className = 'status-badge green';
            els.reviewConfidenceBadge.textContent = 'Akurasi Tinggi ✅';
        } else if (conf === 'MEDIUM') {
            els.reviewConfidenceBadge.className = 'status-badge yellow';
            els.reviewConfidenceBadge.textContent = 'Akurasi Cukup ⚠️';
        } else {
            els.reviewConfidenceBadge.className = 'status-badge gray';
            els.reviewConfidenceBadge.textContent = 'Sampel Terbatas ❓';
        }
    }

    // Risks / Red Flags
    const risks = Array.isArray(reviewData.risks) ? reviewData.risks : [];
    const cleanRisks = risks.filter(r => r && !r.toLowerCase().includes('tidak ditemukan resiko'));

    if (cleanRisks.length > 0) {
        els.reviewRisksList.innerHTML = '';
        cleanRisks.forEach(risk => {
            const li = document.createElement('li');
            li.textContent = risk;
            els.reviewRisksList.appendChild(li);
        });
        show(els.reviewRisksContainer);
    } else {
        hide(els.reviewRisksContainer);
    }

    // Pros
    els.reviewProsList.innerHTML = '';
    const pros = Array.isArray(reviewData.pros) ? reviewData.pros : [];
    if (pros.length > 0) {
        pros.forEach(pro => {
            const li = document.createElement('li');
            li.textContent = pro;
            els.reviewProsList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = 'Tidak ada poin kelebihan spesifik.';
        els.reviewProsList.appendChild(li);
    }

    // Cons
    els.reviewConsList.innerHTML = '';
    const cons = Array.isArray(reviewData.cons) ? reviewData.cons : [];
    if (cons.length > 0) {
        cons.forEach(con => {
            const li = document.createElement('li');
            li.textContent = con;
            els.reviewConsList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = 'Tidak ada poin kekurangan spesifik.';
        els.reviewConsList.appendChild(li);
    }

    show(els.reviewProsConsGrid);
}

function renderHighlight(sectionEl, titleText, candidate, reason, kind, originalPrice) {
    sectionEl.innerHTML = '';
    sectionEl.classList.add('card');
    if (kind === 'best') sectionEl.classList.add('card-best');
    if (kind === 'cheapest') sectionEl.classList.add('card-cheap');

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = titleText;
    sectionEl.appendChild(title);

    if (!candidate) {
        const em = document.createElement('em');
        em.className = 'muted';
        em.textContent = 'Tidak ada kandidat.';
        sectionEl.appendChild(em);
    } else {
        sectionEl.appendChild(buildResultCard(candidate, reason, kind, originalPrice));
    }

    show(sectionEl);
}

function renderAll(data) {
    console.log('[Shopping Intelligence] renderAll', data);
    hideLoading();
    hide(els.errorState);

    const product = data.product;
    const marketplace = data.marketplace || (product && product.source) || 'Shopee';
    const originalPrice = product ? product.price : null;
    const candidates = Array.isArray(data.searchResults) ? data.searchResults : [];
    const evaluation = data.evaluation || null;

    renderOriginalProduct(product, marketplace);
    renderReviewSummary(data.reviewSummary);

    if (candidates.length === 0) {
        showError('Tidak ada alternatif produk yang cocok ditemukan.');
        return;
    }

    const hasEvaluation = evaluation && (evaluation.best_value || evaluation.cheapest_option);

    if (hasEvaluation) {
        const bestEntry = evaluation.best_value || {};
        const cheapestEntry = evaluation.cheapest_option || {};

        const bestCandidate = candidates.find((c) => c.url === bestEntry.url) || candidates[0];
        const cheapestCandidate = candidates.find((c) => c.url === cheapestEntry.url)
            || candidates.reduce((min, c) => {
                if (c.price === null || c.price === undefined) return min;
                if (!min || c.price < min.price) return c;
                return min;
            }, null)
            || candidates[0];

        // Sinkronisasi status spesifikasi dan harga dari AI
        if (bestCandidate) {
            bestCandidate.specStatus = bestEntry.spec_status || bestCandidate.specStatus || 'EXACT';
            if (bestEntry.price && (!bestCandidate.price || bestCandidate.price < 1000)) {
                bestCandidate.price = bestEntry.price;
            }
        }
        if (cheapestCandidate) {
            cheapestCandidate.specStatus = cheapestEntry.spec_status || cheapestCandidate.specStatus || 'UNKNOWN';
            if (cheapestEntry.price && (!cheapestCandidate.price || cheapestCandidate.price < 1000)) {
                cheapestCandidate.price = cheapestEntry.price;
            }
        }

        renderHighlight(els.bestValueSection, '🏆 Best Value', bestCandidate, bestEntry.reason, 'best', originalPrice);
        renderHighlight(els.cheapestSection, '💰 Cheapest Option', cheapestCandidate, cheapestEntry.reason, 'cheapest', originalPrice);

        const usedUrls = new Set([bestCandidate.url, cheapestCandidate.url]);
        const otherResults = candidates.filter((c) => !usedUrls.has(c.url));
        const otherReasons = Array.isArray(evaluation.others) ? evaluation.others : [];

        console.log("[UI] Rendering alternatives:", otherResults.length);

        els.otherResultsSection.innerHTML = '';
        els.otherResultsSection.classList.add('card');
        if (otherResults.length > 0) {
            const title = document.createElement('h2');
            title.className = 'section-title';
            title.textContent = `📋 Menampilkan ${otherResults.length} Alternatif Lainnya`;
            els.otherResultsSection.appendChild(title);

            otherResults.forEach((candidate) => {
                const match = otherReasons.find((o) => o && o.url === candidate.url);
                if (match) {
                    if (match.spec_status) candidate.specStatus = match.spec_status;
                    if (match.price && (!candidate.price || candidate.price < 1000)) {
                        candidate.price = match.price;
                    }
                }
                els.otherResultsSection.appendChild(
                    buildResultCard(candidate, match ? match.reason : null, 'other', originalPrice)
                );
            });
            show(els.otherResultsSection);
        } else {
            hide(els.otherResultsSection);
        }
    } else {
        // === AI FALLBACK ===
        console.warn('[Shopping Intelligence] evaluateDeals null -> fallback ke hasil mentah');
        els.bestValueSection.innerHTML = '';

        const title = document.createElement('h2');
        title.className = 'section-title';
        title.textContent = '🏆 Rekomendasi';
        els.bestValueSection.appendChild(title);

        const notice = document.createElement('div');
        notice.className = 'notice';
        notice.textContent = 'Rekomendasi AI tidak tersedia, ini hasil teratas dari Google';
        els.bestValueSection.appendChild(notice);

        const topPicks = candidates.slice(0, 2);
        topPicks.forEach((candidate) => {
            els.bestValueSection.appendChild(buildResultCard(candidate, null, 'best', originalPrice));
        });
        show(els.bestValueSection);
        hide(els.cheapestSection);

        const otherResults = candidates.slice(2);
        console.log("[UI] Rendering alternatives:", otherResults.length);

        els.otherResultsSection.innerHTML = '';
        els.otherResultsSection.classList.add('card');
        if (otherResults.length > 0) {
            const otitle = document.createElement('h2');
            otitle.className = 'section-title';
            otitle.textContent = `📋 Menampilkan ${otherResults.length} Alternatif Lainnya`;
            els.otherResultsSection.appendChild(otitle);
            otherResults.forEach((candidate) => {
                els.otherResultsSection.appendChild(buildResultCard(candidate, null, 'other', originalPrice));
            });
            show(els.otherResultsSection);
        } else {
            hide(els.otherResultsSection);
        }
    }
}

// === Analisis (API) ===
async function analyze(tab) {
    // 1. Cek koneksi internet
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Koneksi internet terputus. Pastikan WiFi atau paket data Anda aktif.');
    }

    // 2. Validasi URL tab aktif sebelum mengirim pesan ke content script
    const url = (tab && tab.url) || '';
    if (!url || url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('chrome-extension://')) {
        throw new Error('Ekstensi tidak dapat berjalan di halaman internal browser.');
    }

    if (!isSupportedMarketplaceUrl(url)) {
        throw new Error('Marketplace ini belum didukung. Buka halaman produk di Shopee, Tokopedia, atau Lazada.');
    }

    console.log('[Shopping Intelligence] DETECT_PAGE');
    let detection = null;
    try {
        detection = await sendMessage(tab.id, { action: 'DETECT_PAGE' });
    } catch (e) {
        if (e && e.message && e.message.includes('Receiving end does not exist')) {
            throw new Error('Gagal berkomunikasi dengan halaman. Silakan refresh tab belanja Anda.');
        }
        throw e;
    }

    const marketplace = (detection && detection.marketplace) || 'Marketplace';

    if (detection && detection.isProduct === false) {
        throw new Error(detection.reason || `Halaman ini bukan halaman produk ${marketplace}.`);
    }

    console.log('[Shopping Intelligence] EXTRACT_PRODUCT');
    let extraction = null;
    try {
        extraction = await sendMessage(tab.id, { action: 'EXTRACT_PRODUCT' });
    } catch (e) {
        console.error('[Shopping Intelligence] EXTRACT_PRODUCT error:', e);
        throw new Error(e && e.message ? e.message : `Gagal membaca halaman ${marketplace}.`);
    }

    if (!extraction || !extraction.success || !extraction.product) {
        const errDetail = (extraction && extraction.error) ? extraction.error : `Gagal membaca informasi produk dari ${marketplace}.`;
        throw new Error(errDetail);
    }
    const product = extraction.product;
    console.log('[Shopping Intelligence] product:', product);

    // Render produk asli segera
    renderOriginalProduct(product, marketplace);

    // Tampilkan skeleton/loading Review Intelligence
    show(els.reviewSummarySection);
    show(els.reviewLoadingIndicator);
    hide(els.reviewEmptyMessage);
    hide(els.reviewRisksContainer);
    hide(els.reviewProsConsGrid);
    if (els.reviewConfidenceBadge) {
        els.reviewConfidenceBadge.className = 'status-badge gray';
        els.reviewConfidenceBadge.textContent = 'Menganalisis...';
    }

    // Branch A: Review Intelligence (Paralel & Non-blocking)
    const reviewPromise = (async () => {
        try {
            console.log('[Shopping Intelligence] EXTRACT_REVIEWS');
            const reviewRes = await sendMessage(tab.id, { action: 'EXTRACT_REVIEWS' });
            const reviews = (reviewRes && Array.isArray(reviewRes.reviews)) ? reviewRes.reviews : [];
            console.log('[Shopping Intelligence] reviews extracted:', reviews.length);

            if (reviews.length === 0) {
                const emptyData = {
                    status: 'NO_REVIEWS',
                    pros: [],
                    cons: [],
                    risks: [],
                    confidence: 'LOW',
                    message: 'Belum ada ulasan pembeli yang dapat dianalisis untuk produk ini.'
                };
                renderReviewSummary(emptyData);
                return emptyData;
            }

            const ai = new window.AIClient();
            const summary = await ai.summarizeReviews(product.title, reviews);
            renderReviewSummary(summary);
            return summary;
        } catch (err) {
            console.error('[Shopping Intelligence] Review Intelligence error:', err);
            hide(els.reviewLoadingIndicator);
            show(els.reviewEmptyMessage);
            els.reviewEmptyMessage.textContent = 'Ulasan belum tersedia atau gagal dianalisis.';
            return null;
        }
    })();

    // Branch B: Timbangan Harga (Deal Engine)
    const dealsPromise = (async () => {
        console.log('[Shopping Intelligence] UNDERSTAND_PRODUCT');
        let aiData = null;
        try {
            const r = await sendMessage(tab.id, { action: 'UNDERSTAND_PRODUCT', product });
            if (r && r.success === false && /API Key/i.test(r.error || '')) {
                throw new Error(r.error);
            }
            aiData = r ? r.aiData : null;
        } catch (e) {
            console.error('[Shopping Intelligence] UNDERSTAND_PRODUCT error:', e);
            if (/API Key|Koneksi|internet/i.test(e && e.message)) throw e;
        }
        console.log('[Shopping Intelligence] aiData:', aiData);

        console.log('[Shopping Intelligence] SEARCH_ALTERNATIVES');
        let searchResults = [];
        try {
            const searchClient = new window.SearchClient();
            searchResults = await searchClient.searchAlternatives(product, aiData);
        } catch (e) {
            console.error('[Shopping Intelligence] SEARCH_ALTERNATIVES error:', e);
            throw e;
        }
        console.log("[Shopping Intelligence] searchResults:", searchResults.length);
        if (searchResults.length === 0) {
            throw new Error('Tidak ada alternatif produk yang cocok ditemukan.');
        }

        console.log('[Shopping Intelligence] EVALUATE_DEALS');
        let evaluation = null;
        try {
            const r = await sendMessage(tab.id, {
                action: 'EVALUATE_DEALS',
                product,
                candidates: searchResults
            });
            if (r && r.success === false && /API Key/i.test(r.error || '')) {
                throw new Error(r.error);
            }
            evaluation = r ? r.evaluation : null;
        } catch (e) {
            console.error('[Shopping Intelligence] EVALUATE_DEALS error:', e);
            if (/API Key|Koneksi|internet/i.test(e && e.message)) throw e;
        }
        console.log('[Shopping Intelligence] evaluation:', evaluation);

        return { aiData, searchResults, evaluation };
    })();

    const [reviewSettled, dealsSettled] = await Promise.allSettled([reviewPromise, dealsPromise]);

    if (dealsSettled.status === 'rejected') {
        throw dealsSettled.reason;
    }

    const reviewSummary = reviewSettled.status === 'fulfilled' ? reviewSettled.value : null;
    const { aiData, searchResults, evaluation } = dealsSettled.value;

    return { marketplace, product, reviewSummary, aiData, searchResults, evaluation };
}

// === Cache + init ===
async function analyzeAndCache(tab) {
    const cacheKey = cacheKeyFor(tab);
    try {
        const data = await analyze(tab);
        renderAll(data);
        try {
            await chrome.storage.local.set({ [cacheKey]: data });
        } catch (e) {
            console.error('[Shopping Intelligence] gagal simpan cache:', e);
        }
    } catch (error) {
        console.error('[Shopping Intelligence] analyzeAndCache error:', error);
        showError(error && error.message ? error.message : 'Terjadi kesalahan tak terduga.');
    }
}

async function init() {
    if (isProcessing) return;
    setLoadingState(true, 'Menganalisis halaman...');
    hideResultSections();

    try {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
            showError('Tidak dapat mengakses tab aktif.');
            return;
        }

        const cacheKey = cacheKeyFor(tab);
        let cached = null;
        try {
            cached = await chrome.storage.local.get([cacheKey]);
        } catch (e) {
            console.error('[Shopping Intelligence] gagal baca cache:', e);
        }

        if (cached && cached[cacheKey]) {
            console.log('[Shopping Intelligence] cache hit');
            renderAll(cached[cacheKey]);
            return;
        }

        await analyzeAndCache(tab);
    } catch (error) {
        console.error('[Shopping Intelligence] init error:', error);
        showError(error && error.message ? error.message : 'Terjadi kesalahan tak terduga.');
    } finally {
        setLoadingState(false);
    }
}

async function onReanalyze() {
    if (isProcessing) return;
    setLoadingState(true, 'Menganalisis ulang...');
    hideResultSections();

    try {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
            showError('Tidak dapat mengakses tab aktif.');
            return;
        }
        const cacheKey = cacheKeyFor(tab);
        try {
            await chrome.storage.local.remove(cacheKey);
        } catch (e) {
            console.error('[Shopping Intelligence] gagal hapus cache:', e);
        }
        await analyzeAndCache(tab);
    } catch (error) {
        console.error('[Shopping Intelligence] onReanalyze error:', error);
        showError(error && error.message ? error.message : 'Terjadi kesalahan tak terduga.');
    } finally {
        setLoadingState(false);
    }
}

els.reanalyzeBtn.addEventListener('click', onReanalyze);
if (els.saveKeysBtn) els.saveKeysBtn.addEventListener('click', saveKeys);

loadKeys();
init();
