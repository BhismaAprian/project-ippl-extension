(() => {
    if (window.__SI_MARKETPLACE_DETECTOR_LOADED__) {
        console.log('[Shopping Intelligence] marketplace-detector sudah aktif di halaman ini.');
        return;
    }
    window.__SI_MARKETPLACE_DETECTOR_LOADED__ = true;

    // Cukup inisialisasi dari window object
    const ADAPTERS = [
        new window.ShopeeAdapter(),
        new window.TokopediaAdapter(),
        new window.LazadaAdapter()
    ];

function detectCurrentPage() {
    const currentUrl = window.location.href;

    const adapter = ADAPTERS.find(a => a.matchesUrl(currentUrl));

    if (!adapter) {
        return {
            isProduct: false,
            marketplace: null,
            reason: 'Marketplace ini belum didukung.'
        };
    }

    const hasMarkers = adapter.hasProductMarkers();

    if (!hasMarkers) {
        return {
            isProduct: false,
            marketplace: adapter.marketplaceName,
            reason: `Halaman ${adapter.marketplaceName} terdeteksi, tapi bukan halaman produk.`
        };
    }

    return {
        isProduct: true,
        marketplace: adapter.marketplaceName,
        reason: `Halaman produk ${adapter.marketplaceName} terdeteksi.`,
        url: currentUrl
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'DETECT_PAGE') {
        const result = detectCurrentPage();
        sendResponse(result);
        return true;
    }

    if (request.action === 'EXTRACT_PRODUCT') {
        const currentUrl = window.location.href;
        const adapter = ADAPTERS.find(a => a.matchesUrl(currentUrl));

        if (!adapter) {
            sendResponse({ success: false, product: null, error: 'Adapter tidak ditemukan' });
            return true;
        }

        if (typeof adapter.extractProduct !== 'function') {
            sendResponse({
                success: false,
                product: null,
                error: `Ekstraksi produk belum didukung untuk ${adapter.marketplaceName}`
            });
            return true;
        }

        try {
            const product = adapter.extractProduct();
            if (!product) {
                sendResponse({
                    success: false,
                    product: null,
                    error: `Gagal membaca informasi produk dari ${adapter.marketplaceName}.`
                });
                return true;
            }
            sendResponse({ success: true, product, error: null });
        } catch (e) {
            sendResponse({ success: false, product: null, error: e.message });
        }
        return true;
    }

    if (request.action === 'EXTRACT_REVIEWS') {
        const currentUrl = window.location.href;
        const adapter = ADAPTERS.find(a => a.matchesUrl(currentUrl));

        if (!adapter || typeof adapter.extractReviews !== 'function') {
            sendResponse({ success: true, reviews: [] });
            return true;
        }

        adapter.extractReviews()
            .then(reviews => {
                sendResponse({ success: true, reviews: reviews || [] });
            })
            .catch(e => {
                console.error('[Shopping Intelligence] EXTRACT_REVIEWS error:', e);
                sendResponse({ success: false, reviews: [], error: e.message });
            });
        return true;
    }

    if (request.action === 'UNDERSTAND_PRODUCT') {
        const ai = new window.AIClient();
        ai.understandProduct(request.product)
            .then((aiData) => {
                sendResponse({ success: true, aiData: aiData });
            })
            .catch((e) => {
                sendResponse({ success: false, aiData: null, error: e.message });
            });
        return true;
    }

    if (request.action === 'EVALUATE_DEALS') {
        const ai = new window.AIClient();
        ai.evaluateDeals(request.product, request.candidates)
            .then((evaluation) => {
                sendResponse({ success: true, evaluation: evaluation });
            })
            .catch((e) => {
                sendResponse({ success: false, evaluation: null, error: e.message });
            });
        return true;
    }

    if (request.action === 'EXTRACT_SIMILAR_RECS') {
        const currentUrl = window.location.href;
        const adapter = ADAPTERS.find(a => a.matchesUrl(currentUrl));
        if (adapter) {
            const reqTitle = request.product?.title || null;
            const reqPrice = request.product?.price || null;
            const getRecsPromise = typeof adapter.extractSimilarRecommendationsAsync === 'function'
                ? adapter.extractSimilarRecommendationsAsync(reqTitle, reqPrice)
                : Promise.resolve(typeof adapter.extractSimilarRecommendations === 'function' ? adapter.extractSimilarRecommendations(reqTitle, reqPrice) : []);

            getRecsPromise
                .then(recs => {
                    sendResponse({ success: true, recommendations: recs || [] });
                })
                .catch(e => {
                    console.error('[Shopping Intelligence] EXTRACT_SIMILAR_RECS error:', e);
                    sendResponse({ success: false, recommendations: [], error: e.message });
                });
        } else {
            sendResponse({ success: true, recommendations: [] });
        }
        return true;
    }

    if (request.action === 'SCROLL_TO_REVIEW') {
        injectHighlightStyle();

        let target = null;
        if (request.cmtId) {
            target = document.querySelector(`[data-cmtid="${request.cmtId}"]`);
        }
        if (!target && request.reviewIndex !== undefined && request.reviewIndex !== null) {
            target = document.querySelector(`[data-si-review-idx="${request.reviewIndex}"]`);
        }
        if (!target && request.textSnippet) {
            const candidates = document.querySelectorAll('.shopee-product-comment-list > div, div[data-cmtid], div.shopee-product-rating');
            for (const c of candidates) {
                if (c.textContent && c.textContent.includes(request.textSnippet)) {
                    target = c;
                    break;
                }
            }
        }

        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.remove('si-review-highlight');
            // Re-trigger animation
            void target.offsetWidth;
            target.classList.add('si-review-highlight');
            setTimeout(() => {
                target.classList.remove('si-review-highlight');
            }, 3500);
            sendResponse({ success: true });
        } else {
            // Scroll ke area ulasan jika target spesifik belum tampak
            const ratingArea = document.querySelector('.product-ratings, #product-rating-overview, [class*="product-rating"]');
            if (ratingArea) {
                ratingArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            sendResponse({ success: false, reason: 'Target ulasan tidak ditemukan di DOM saat ini' });
        }
        return true;
    }

    return true;
});

function injectHighlightStyle() {
    if (document.getElementById('si-highlight-style')) return;
    const style = document.createElement('style');
    style.id = 'si-highlight-style';
    style.textContent = `
        .si-review-highlight {
            outline: 4px solid #FBBF24 !important;
            box-shadow: 0 0 24px rgba(251, 191, 36, 0.85) !important;
            border-radius: 8px !important;
            background-color: rgba(254, 240, 138, 0.25) !important;
            transition: all 0.3s ease !important;
        }
    `;
    document.head?.appendChild(style);
}
})();
