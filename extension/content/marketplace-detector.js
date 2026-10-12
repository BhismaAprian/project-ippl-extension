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
    }
    return true;
});