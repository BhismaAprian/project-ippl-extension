/**
 * extension/manifest/marketplace-manifest/blibli.js
 * 
 * Deklarasi manifest pencarian Blibli.
 * Menggunakan string pattern (ADR-03), card selector data-testid productCard, dan generic extraction.
 */

function createStringPattern(patternStr) {
  const s = new String(patternStr);
  s.test = function (target) {
    try {
      let cleaned = String(patternStr);
      if (cleaned.startsWith('/') && /\/[gimsuy]*$/.test(cleaned)) {
        cleaned = cleaned.replace(/^\//, '').replace(/\/[gimsuy]*$/, '');
      }
      return new RegExp(cleaned).test(target);
    } catch (e) {
      return false;
    }
  };
  return s;
}

const blibliManifest = {
  id: 'blibli',
  name: 'Blibli',
  version: '1.0.0',

  searchUrlTemplate: 'https://www.blibli.com/cari/{q}',

  pdpPattern: createStringPattern('\\/p\\/[a-z0-9-]+\\/[a-z0-9-]+'),
  rejectPattern: createStringPattern('/(?:jual|promosi|cart|backend|search)/'),

  cardSelector: '[data-testid="productCard"]:has(a[href*="/p/"])',
  cardSelectorFallback: '[data-testid="productCard"], div.product-card',

  fields: {
    link: { selector: 'a[href*="/p/"]', attribute: 'href' },
    title: { selector: '[data-testid="productTitle"], [class*="product__title"]', fallbackSelector: 'a[title]' },
    price: { regex: 'Rp\\s*([\\d.]+)', selector: '[data-testid="productPrice"], [class*="product__price"]', group: 1, parse: 'rupiah' },
    priceOrig: { selector: '[data-testid="productPriceOld"], del', extractRegex: 'Rp\\s*([\\d.]+)' },
    discount: { regex: '(-\\d+)%', selector: '[data-testid="productDiscount"]', group: 1 },
    rating: {
      selector: '[data-testid="productRating"], [class*="product__rating"]',
      fallbackRegex: '(\\d\\.\\d)'
    },
    sold: { regex: '(\\d+)\\s*(?:terjual|sold)', group: 1 },
    location: { selector: '[data-testid="productLocation"], [class*="product__location"]' },
    shopName: { selector: '[data-testid="productSeller"], [class*="product__seller"]' },
    image: {
      selector: 'img[data-testid="productImage"], img',
      attributes: ['src', 'data-src', 'data-lazy-src', 'srcset'],
      rejectPatterns: ['data:image', 'blank', 'placeholder', '1x1']
    }
  },

  hydrationCheck: {
    minValidCards: 5,
    minTextLength: 30,
    timeout: 15000,
    pollingInterval: 500
  },

  activationStrategy: 'brief-active',

  blockedSelectors: [
    '.blibli-captcha',
    '[class*="sec-container"]',
    '[class*="modal-login"]',
    'form[action*="login"]'
  ],

  userMessages: {
    opening: 'Membuka pencarian Blibli sebentar...',
    warning: 'Jangan tutup tab ini.',
    blocked: 'Blibli meminta verifikasi keamanan. Gunakan Exa.',
    timeout: 'Batas waktu hidrasi Blibli habis. Coba lagi atau gunakan Exa.'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = blibliManifest;
}
if (typeof window !== 'undefined') {
  window.blibliManifest = blibliManifest;
}
