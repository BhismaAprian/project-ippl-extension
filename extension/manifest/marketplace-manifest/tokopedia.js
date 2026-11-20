/**
 * extension/manifest/marketplace-manifest/tokopedia.js
 * 
 * Deklarasi manifest pencarian Tokopedia.
 * Menggunakan string pattern (ADR-03), card selector divSRPProductCard, dan generic extraction.
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

const tokopediaManifest = {
  id: 'tokopedia',
  name: 'Tokopedia',
  version: '1.0.0',

  searchUrlTemplate: 'https://www.tokopedia.com/search?st=product&q={q}',

  pdpPattern: createStringPattern('tokopedia\\.com\\/[^\\/]+\\/[^\\/]+|\\/[a-z0-9-]+\\/[a-z0-9-]+-[a-z0-9]+'),
  rejectPattern: createStringPattern('/(?:discovery|promo|hot|p|pulsa|keuangan|etalase|cart|search|find|help)/'),

  cardSelector: '[data-testid="divSRPProductCard"]:has(a[href*="tokopedia.com"])',
  cardSelectorFallback: '[data-testid="divSRPProductCard"], [data-testid="master-product-card"], div.pcv3__container',

  fields: {
    link: { selector: 'a[href]', attribute: 'href' },
    title: { selector: '[data-testid="spnSRPProdName"], [class*="css-20kt3b"]', fallbackSelector: 'span[class*="css-"]' },
    price: { regex: 'Rp\\s*([\\d.]+)', selector: '[data-testid="spnSRPProdPrice"]', group: 1, parse: 'rupiah' },
    priceOrig: { selector: '[data-testid="spnSRPProdPriceSlash"]', extractRegex: 'Rp\\s*([\\d.]+)' },
    discount: { regex: '(-\\d+)%', selector: '[data-testid="spnSRPProdDisc"]', group: 1 },
    rating: {
      selector: '[data-testid="spnSRPProdRating"], [class*="rating"]',
      fallbackRegex: '(\\d\\.\\d)'
    },
    sold: { regex: '(\\d+)\\s*(?:terjual|rb terjual)', selector: '[data-testid="spnSRPProdSold"]', group: 1 },
    location: { selector: '[data-testid="spnSRPProdShopLoc"], [class*="shop-location"]' },
    shopName: { selector: '[data-testid="spnSRPProdShopName"], [class*="shop-name"]' },
    image: {
      selector: 'img[data-testid="imgSRPProdMain"], img',
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
    '[data-testid="challenge-container"]',
    '.unify-captcha',
    '[class*="challenge"]',
    '[class*="login-box"]',
    'form[action*="login"]'
  ],

  userMessages: {
    opening: 'Membuka pencarian Tokopedia sebentar...',
    warning: 'Jangan tutup tab ini.',
    blocked: 'Tokopedia meminta verifikasi keamanan. Buka manual atau gunakan Exa.',
    timeout: 'Batas waktu hidrasi Tokopedia habis. Coba lagi atau gunakan Exa.'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = tokopediaManifest;
}
if (typeof window !== 'undefined') {
  window.tokopediaManifest = tokopediaManifest;
}
