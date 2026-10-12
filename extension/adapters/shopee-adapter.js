import { BaseAdapter } from "./base-adapter"
import { URL_PATTERNS } from "../shared/constant"

export class ShopeeAdapter extends BaseAdapter {
    get marketplaceName(){
        return 'shopee';
    }

    matchesUrl(url) {
        // mencocokan domain shopee
        if (!url.includes('shopee.co.id')) return false;
        // cek pola produk path
        return URL_PATTERNS.shopee.test(new URL(url).pathname);
    }


    hasproductMakers(){
        // Elemen penanda halaman produk Shopee

        const markers = [
            '[data-testid="product-title"]',
            '.product-briefing',
            'meta[property="og:type"][content="product"]' 
        ]
        return markers.some(selector => document.querySelector(selector) !== null);
    }
}
