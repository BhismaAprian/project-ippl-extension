/**
 * extension/manifest/marketplace-manifest/shopee.js
 * 
 * Deklarasi manifest pencarian Shopee berdasarkan temuan empiris di Chrome.
 * Menggunakan Tailwind CSS structure, aria-label, regex innerText, dan hybrid extraction.
 */

const shopeeManifest = {
  id: 'shopee',
  name: 'Shopee',
  version: '1.0.0',

  searchUrlTemplate: 'https://shopee.co.id/search?keyword={q}',

  pdpPattern: /-i\.\d+\.\d+/,
  rejectPattern: /\/find_similar_products/,

  cardSelector: '[data-sqe="item"]:has(a[href*="-i."])',
  cardSelectorFallback: '[data-sqe="item"]', // tanpa :has, difilter manual

  fields: {
    link: { selector: 'a[href*="-i."]', attribute: 'href' },
    title: { fromAriaLabel: /^Product card:\s*/, fallbackSelector: '[class*="line-clamp"]' },
    price: { regex: /Rp\s*([\d.]+)/, group: 1, parse: 'rupiah' },
    priceOrig: { selector: '[class*="line-through"]', extractRegex: /Rp\s*([\d.]+)/ },
    discount: { regex: /(-\d+)%/, group: 1 },
    rating: {
      afterSelector: 'img[alt="rating-star"]',
      fallbackRegex: /\n(\d\.\d)\n/
    },
    sold: { regex: /(\d+)\s*terjual/, group: 1 },
    location: { selector: '[class*="text-shopee-black54"]' },
    shopName: null // SELALU null untuk Shopee search
  },

  hydrationCheck: {
    minValidCards: 5,
    minTextLength: 50,
    timeout: 15000,
    pollingInterval: 500
  },

  activationStrategy: 'brief-active', // WAJIB, bukan 'no-discard'

  blockedSelectors: [
    '.shopee-captcha',
    '.geetest_holder',
    '[class*="verify-wrap"]',
    '[class*="login-container"]',
    '[class*="modal-login"]',
    'form[action*="login"]'
  ],

  userMessages: {
    opening: 'Membuka pencarian Shopee sebentar...',
    warning: 'Jangan tutup tab ini.',
    blocked: 'Shopee meminta verifikasi. Buka manual atau gunakan Exa.',
    timeout: 'Pencarian terlalu lama. Coba lagi atau gunakan Exa.'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = shopeeManifest;
}
if (typeof window !== 'undefined') {
  window.shopeeManifest = shopeeManifest;
}
