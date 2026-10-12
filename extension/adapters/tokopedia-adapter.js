import { BaseAdapter } from './base-adapter.js';
import { URL_PATTERNS } from '../shared/constants.js';

export class TokopediaAdapter extends BaseAdapter {
  get marketplaceName() {
    return 'tokopedia';
  }

  matchesUrl(url) {
    if (!url.includes('tokopedia.com')) return false;
    return URL_PATTERNS.tokopedia.test(new URL(url).pathname);
  }

  hasProductMarkers() {
    const markers = [
      '[data-testid="pdpProductName"]',
      '.product-summary',
      'meta[property="og:type"][content="product"]'
    ];
    return markers.some(selector => document.querySelector(selector) !== null);
  }
}