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
            sendResponse({ success: true, product, error: null });
        } catch (e) {
            sendResponse({ success: false, product: null, error: e.message });
        }
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

    return true;
});
