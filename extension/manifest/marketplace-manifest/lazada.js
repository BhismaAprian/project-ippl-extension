/**
 * extension/manifest/marketplace-manifest/lazada.js
 * 
 * Deklarasi manifest pencarian Lazada.
 * Menggunakan string pattern (ADR-03), card selector data-qa-locator product-item, dan generic extraction.
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

const lazadaManifest = {
  id: 'lazada',
  name: 'Lazada',
  version: '1.0.0',

  searchUrlTemplate: 'https://www.lazada.co.id/catalog/?q={q}',

  pdpPattern: createStringPattern('-i\\d+-s\\d+|/products/'),
  rejectPattern: createStringPattern('/(?:helpcenter|shop|cart|catalog|tag)/'),

  cardSelector: '[data-qa-locator="product-item"]:has(a[href*="-i"]), [data-qa-locator="product-item"]:has(a[href*="/products/"])',
  cardSelectorFallback: '[data-qa-locator="product-item"], div._95X4G',

  fields: {
    link: { selector: 'a[href*="-i"], a[href*="/products/"]', attribute: 'href' },
    title: { selector: 'a[title], [class*="title"], [class*="_95X4G"]', attribute: 'title', fallbackSelector: 'a[href*="-i"]' },
    price: { regex: 'Rp\\s*([\\d.]+)', selector: '[class*="price"], [class*="ooOxS"]', group: 1, parse: 'rupiah' },
    priceOrig: { selector: '[class*="origin-price"], del', extractRegex: 'Rp\\s*([\\d.]+)' },
    discount: { regex: '(-\\d+)%', selector: '[class*="discount"]', group: 1 },
    rating: {
      selector: '[class*="rating"], [class*="mdm"]',
      fallbackRegex: '(\\d\\.\\d)'
    },
    sold: { regex: '(\\d+)\\s*(?:terjual|sold)', group: 1 },
    location: { selector: '[class*="location"], [class*="_1cESo"]' },
    shopName: { selector: '[class*="seller-name"], [class*="shop-name"]' }
  },

  hydrationCheck: {
    minValidCards: 5,
    minTextLength: 30,
    timeout: 15000,
    pollingInterval: 500
  },

  activationStrategy: 'brief-active',

  blockedSelectors: [
    '#nc_1_wrapper',
    '.punish-component',
    '[class*="baxia-dialog"]',
    '[class*="challenge"]',
    'form[action*="login"]'
  ],

  userMessages: {
    opening: 'Membuka pencarian Lazada sebentar...',
    warning: 'Jangan tutup tab ini.',
    blocked: 'Lazada meminta verifikasi keamanan (anti-bot). Gunakan Exa.',
    timeout: 'Batas waktu hidrasi Lazada habis. Coba lagi atau gunakan Exa.'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = lazadaManifest;
}
if (typeof window !== 'undefined') {
  window.lazadaManifest = lazadaManifest;
}
