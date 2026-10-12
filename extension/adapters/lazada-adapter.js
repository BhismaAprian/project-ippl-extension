class LazadaAdapter extends window.BaseAdapter {
    get marketplaceName() {
        return 'lazada';
    }

    matchesUrl(url) {
        try {
            const parsedUrl = new URL(url);
            if (!parsedUrl.hostname.includes('lazada.co.id')) return false;

            // Memeriksa pola path /products/ atau adanya parameter itemId / pdp-i
            const pathname = parsedUrl.pathname;
            const isProductPath = /\/products\/.*-i\d+/i.test(pathname) || pathname.startsWith('/products/');

            if (isProductPath) return true;

            // Fallback ke pattern bawaan jika ada
            return window.URL_PATTERNS?.lazada ? window.URL_PATTERNS.lazada.test(pathname) : false;
        } catch (e) {
            return false;
        }
    }

    hasProductMarkers() {
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
}

window.LazadaAdapter = LazadaAdapter;