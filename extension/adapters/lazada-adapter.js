class LazadaAdapter extends window.BaseAdapter {
    get marketplaceName() {
        return 'lazada';
    }

    matchesUrl(url) {
        if (!url) return false;
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.hostname.includes('lazada.co.id');
        } catch (e) {
            return false;
        }
    }

    hasProductMarkers() {
        try {
            const pathname = window.location.pathname;
            const isProductPath = /\/products\/.*-i\d+/i.test(pathname) || pathname.startsWith('/products/');
            if (!isProductPath) return false;
        } catch (e) {
            return false;
        }

        const markers = [
            'meta[property="og:type"][content="product"]',
            'script[type="application/ld+json"]',
            '.pdp-mod-product-badge-title',
            '.pdp-product-title',
            '#pdp-block-title'
        ];

        // 1. Cek elemen DOM selector
        const hasElement = markers.some(selector => document.querySelector(selector) !== null);
        if (hasElement) return true;

        // 2. Cek variabel global pdt_category / pdpTrackingData bawaan Lazada
        if (window.pdpTrackingData || (window.dataLayer && window.dataLayer.some(item => item.pagetype === 'pdp'))) {
            return true;
        }

        return false;
    }

    extractProduct() {
        throw new Error('Fitur ekstraksi detail produk Lazada sedang dalam tahap pengembangan.');
    }
}

window.LazadaAdapter = LazadaAdapter;
