/**
 * test/generic-native-parser.test.js
 * 
 * Pengujian unit untuk Generic Native Search Parser (extension/content/native-search-parser.js):
 * 1. Ekstraksi kartu Tokopedia via tokopediaManifest
 * 2. Ekstraksi kartu Lazada via lazadaManifest
 * 3. Ekstraksi kartu Blibli via blibliManifest
 * 4. Deteksi tantangan keamanan lintas platform
 * 5. Penyaringan link non-PDP secara generik
 */

const assert = require('assert');
const {
    toRegExp,
    checkBlocked,
    getValidCards,
    extractCard
} = require('../extension/content/native-search-parser.js');

const tokopediaManifest = require('../extension/manifest/marketplace-manifest/tokopedia.js');
const lazadaManifest = require('../extension/manifest/marketplace-manifest/lazada.js');
const blibliManifest = require('../extension/manifest/marketplace-manifest/blibli.js');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ PASS: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

// Lightweight Mock DOM
class MockElement {
    constructor(tagName, attrs = {}, text = '') {
        this.tagName = tagName.toUpperCase();
        this.attributes = attrs;
        this.innerText = text;
        this.children = [];
    }
    getAttribute(name) {
        return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }
    appendChild(child) {
        this.children.push(child);
        return child;
    }
    querySelector(selector) {
        return this._findChild(el => {
            if (selector.startsWith('a[')) {
                return el.tagName === 'A';
            }
            if (selector.includes('data-testid="spnSRPProdName"') && el.attributes['data-testid'] === 'spnSRPProdName') return true;
            if (selector.includes('data-testid="spnSRPProdPrice"') && el.attributes['data-testid'] === 'spnSRPProdPrice') return true;
            if (selector.includes('data-testid="spnSRPProdShopName"') && el.attributes['data-testid'] === 'spnSRPProdShopName') return true;
            if (selector.includes('data-testid="productTitle"') && el.attributes['data-testid'] === 'productTitle') return true;
            if (selector.includes('data-testid="productPrice"') && el.attributes['data-testid'] === 'productPrice') return true;
            if (selector.includes('data-testid="productSeller"') && el.attributes['data-testid'] === 'productSeller') return true;
            if (selector.includes('title') && el.attributes.title) return true;
            if (selector.includes('seller-name') && (el.attributes.class || '').includes('seller-name')) return true;
            return false;
        });
    }
    _findChild(predicate) {
        for (const c of this.children) {
            if (predicate(c)) return c;
            const nested = c._findChild(predicate);
            if (nested) return nested;
        }
        return null;
    }
}

class MockDocument {
    constructor() {
        this.elements = [];
        this.blockedSelectors = new Set();
    }
    addCard(card) { this.elements.push(card); }
    setBlocked(sel) { this.blockedSelectors.add(sel); }
    querySelector(selector) {
        for (const b of this.blockedSelectors) {
            if (selector.includes(b)) return new MockElement('div', { class: b });
        }
        return null;
    }
    querySelectorAll(selector) {
        return this.elements;
    }
}

console.log('=== TEST SUITE: GENERIC NATIVE SEARCH PARSER (CR-001) ===');

// 1. TOKOPEDIA CARD EXTRACTION
it('extractCard harus mengekstrak data kartu Tokopedia secara presisi', () => {
    const card = new MockElement('div', { 'data-testid': 'divSRPProductCard' }, 'Asus Vivobook Go 14 E410MA\nRp 4.599.000\nJakarta\nAsus Official Store');
    const link = new MockElement('a', { href: '/asus-official/asus-vivobook-go-14-e410ma' });
    const title = new MockElement('span', { 'data-testid': 'spnSRPProdName' }, 'Asus Vivobook Go 14 E410MA');
    const price = new MockElement('div', { 'data-testid': 'spnSRPProdPrice' }, 'Rp 4.599.000');
    const shop = new MockElement('span', { 'data-testid': 'spnSRPProdShopName' }, 'Asus Official Store');

    card.appendChild(link);
    card.appendChild(title);
    card.appendChild(price);
    card.appendChild(shop);

    const extracted = extractCard(card, tokopediaManifest);
    assert.ok(extracted !== null, 'Ekstraksi Tokopedia tidak boleh null');
    assert.strictEqual(extracted.source, 'tokopedia');
    assert.strictEqual(extracted.price, 4599000);
    assert.strictEqual(extracted.title, 'Asus Vivobook Go 14 E410MA');
    assert.strictEqual(extracted.shopName, 'Asus Official Store');
    assert.ok(extracted.url.includes('tokopedia.com/asus-official/asus-vivobook-go-14-e410ma'));
});

// 2. LAZADA CARD EXTRACTION
it('extractCard harus mengekstrak data kartu Lazada secara presisi', () => {
    const card = new MockElement('div', { 'data-qa-locator': 'product-item' }, 'Laptop Lenovo Ideapad Slim 3\nRp 6.250.000\nLenovo Flagship Store');
    const link = new MockElement('a', { href: '/products/laptop-lenovo-ideapad-slim-3-i12345-s67890.html' });
    const titleLink = new MockElement('a', { title: 'Laptop Lenovo Ideapad Slim 3' });
    const shop = new MockElement('span', { class: 'seller-name' }, 'Lenovo Flagship Store');

    card.appendChild(link);
    card.appendChild(titleLink);
    card.appendChild(shop);

    const extracted = extractCard(card, lazadaManifest);
    assert.ok(extracted !== null, 'Ekstraksi Lazada tidak boleh null');
    assert.strictEqual(extracted.source, 'lazada');
    assert.strictEqual(extracted.price, 6250000);
    assert.strictEqual(extracted.title, 'Laptop Lenovo Ideapad Slim 3');
    assert.strictEqual(extracted.shopName, 'Lenovo Flagship Store');
    assert.ok(extracted.url.includes('lazada.co.id/products/laptop-lenovo-ideapad-slim-3'));
});

// 3. BLIBLI CARD EXTRACTION
it('extractCard harus mengekstrak data kartu Blibli secara presisi', () => {
    const card = new MockElement('div', { 'data-testid': 'productCard' }, 'Acer Aspire 3 A314 Ryzen 3\nRp 5.199.000\nAcer Store');
    const link = new MockElement('a', { href: '/p/acer-aspire-3-a314-ryzen-3/ps--ACS-100-01' });
    const title = new MockElement('div', { 'data-testid': 'productTitle' }, 'Acer Aspire 3 A314 Ryzen 3');
    const price = new MockElement('div', { 'data-testid': 'productPrice' }, 'Rp 5.199.000');
    const shop = new MockElement('span', { 'data-testid': 'productSeller' }, 'Acer Store');

    card.appendChild(link);
    card.appendChild(title);
    card.appendChild(price);
    card.appendChild(shop);

    const extracted = extractCard(card, blibliManifest);
    assert.ok(extracted !== null, 'Ekstraksi Blibli tidak boleh null');
    assert.strictEqual(extracted.source, 'blibli');
    assert.strictEqual(extracted.price, 5199000);
    assert.strictEqual(extracted.title, 'Acer Aspire 3 A314 Ryzen 3');
    assert.strictEqual(extracted.shopName, 'Acer Store');
    assert.ok(extracted.url.includes('blibli.com/p/acer-aspire-3-a314-ryzen-3/ps--ACS-100-01'));
});

// 4. NON-PDP REJECTION
it('extractCard harus menolak link yang masuk ke rejectPattern', () => {
    const cardReject = new MockElement('div', { 'data-testid': 'divSRPProductCard' }, 'Promo Gajian Tokopedia\nRp 10.000');
    const linkReject = new MockElement('a', { href: '/discovery/promo-gajian' });
    cardReject.appendChild(linkReject);

    const extracted = extractCard(cardReject, tokopediaManifest);
    assert.strictEqual(extracted, null, 'Link rejectPattern harus ditolak');
});

// 5. BLOCKED CHALLENGE DETECTION
it('checkBlocked harus mengenali selector verifikasi untuk Tokopedia, Lazada, dan Blibli', () => {
    const docTokped = new MockDocument();
    docTokped.setBlocked('[data-testid="challenge-container"]');
    assert.strictEqual(checkBlocked(docTokped, tokopediaManifest), true);

    const docLazada = new MockDocument();
    docLazada.setBlocked('#nc_1_wrapper');
    assert.strictEqual(checkBlocked(docLazada, lazadaManifest), true);

    const docBlibli = new MockDocument();
    docBlibli.setBlocked('.blibli-captcha');
    assert.strictEqual(checkBlocked(docBlibli, blibliManifest), true);
});

console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
