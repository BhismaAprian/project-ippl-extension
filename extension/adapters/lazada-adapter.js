import { BaseAdapter } from './base-adapter.js';
import { URL_PATTERNS } from '../shared/constants.js';

export class LazadaAdapter extends BaseAdapter {
  get marketplaceName() {
    return 'lazada';
  }

  matchesUrl(url) {
    if (!url.includes('lazada.co.id')) return false;
    return URL_PATTERNS.lazada.test(new URL(url).pathname);
  }

  hasProductMarkers() {
    const markers = [
      '.pdp-mod-product-badge-title',
      '.pdp-product-title',
      'meta[property="og:type"][content="product"]'
    ];
    return markers.some(selector => document.querySelector(selector) !== null);
  }
}