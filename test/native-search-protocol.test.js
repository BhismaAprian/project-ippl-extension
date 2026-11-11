/**
 * test/native-search-protocol.test.js
 * 
 * Pengujian unit untuk:
 * - extension/shared/native-search-protocol.js
 * - extension/content/native-search-parser.js (ekstraksi hybrid DOM)
 * 
 * Kasus yang Diuji:
 * a. Query kosong -> tidak memanggil service worker.
 * b. Kartu skeleton (0 link PDP) -> timeout / 0 valid cards.
 * c. Kartu terhidrasi (memiliki link PDP dan innerText > 50) -> sukses diekstrak.
 * d. Kartu terhidrasi parsial -> hanya kartu valid yang diekstrak.
 * e. Blocked selector muncul -> status BLOCKED.
 * f. Tab ditutup user -> status CANCELLED_BY_USER.
 */

const assert = require('assert');
const { NativeSearchProtocol } = require('../extension/shared/native-search-protocol.js');
const {
    checkBlocked,
    getValidCards,
    extractShopeeCard,
    waitForHydrationAndExtract
} = require('../extension/content/native-search-parser.js');
const shopeeManifest = require('../extension/manifest/marketplace-manifest/shopee.js');

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

async function itAsync(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ PASS: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

// === Lightweight DOM Mock untuk Pengujian Headless Node.js ===
class MockElement {
    constructor(tagName, attrs = {}, text = '') {
        this.tagName = tagName.toUpperCase();
        this.attributes = attrs;
        this.innerText = text;
        this.children = [];
        this.nextElementSibling = null;
    }
    getAttribute(name) {
        return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }
    appendChild(child) {
        if (this.children.length > 0) {
            this.children[this.children.length - 1].nextElementSibling = child;
        }
        this.children.push(child);
        return child;
    }
    querySelector(selector) {
        if (selector === 'a[href*="-i."]') {
            return this._findChild(el => el.tagName === 'A' && (el.attributes.href || '').includes('-i.'));
        }
        if (selector === 'img[alt="rating-star"]') {
            return this._findChild(el => el.tagName === 'IMG' && el.attributes.alt === 'rating-star');
        }
        if (selector.includes('text-shopee-black54')) {
            return this._findChild(el => (el.attributes.class || '').includes('text-shopee-black54'));
        }
        if (selector.includes('line-through')) {
            return this._findChild(el => (el.attributes.class || '').includes('line-through'));
        }
        if (selector.includes('line-clamp')) {
            return this._findChild(el => (el.attributes.class || '').includes('line-clamp'));
        }
        return null;
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
        this.blockedClasses = new Set();
    }
    setBlocked(className) {
        this.blockedClasses.add(className);
    }
    addCard(card) {
        this.elements.push(card);
    }
    querySelector(selector) {
        for (const cls of this.blockedClasses) {
            if (selector.includes(cls) || selector === cls) {
                return new MockElement('div', { class: cls });
            }
        }
        return null;
    }
    querySelectorAll(selector) {
        if (selector.includes('[data-sqe="item"]')) {
            return this.elements;
        }
        return [];
    }
}

async function runTests() {
    console.log('=== TEST SUITE: NATIVE SEARCH PROTOCOL & PARSER ===');

    // 1. Validasi Query Kosong
    await itAsync('Query kosong tidak boleh memicu pengiriman pesan ke Service Worker', async () => {
        let senderCalled = false;
        const mockSender = (payload, cb) => {
            senderCalled = true;
            cb({ status: 'OK', candidates: [] });
        };

        const protocol = new NativeSearchProtocol(shopeeManifest, { messageSender: mockSender });
        const res = await protocol.search('   ');

        assert.strictEqual(senderCalled, false, 'Message sender tidak boleh dipanggil untuk query kosong');
        assert.deepStrictEqual(res, []);
    });

    // 2. Mock Tab Lifecycle Messages pada NativeSearchProtocol
    await itAsync('NativeSearchProtocol harus memproses hasil OK dan menormalisasi kandidat', async () => {
        const mockSender = (payload, cb) => {
            assert.strictEqual(payload.action, 'START_NATIVE_SEARCH');
            assert.strictEqual(payload.manifestId, 'shopee');
            cb({
                status: 'OK',
                candidates: [{
                    title: 'Asus Vivobook Go 15',
                    url: 'https://shopee.co.id/Asus-Vivobook-Go-15-i.123.456',
                    price: 8749000,
                    rating: 5.0,
                    source: 'shopee',
                    shopName: null
                }]
            });
        };

        const protocol = new NativeSearchProtocol(shopeeManifest, { messageSender: mockSender });
        const candidates = await protocol.search('Asus Vivobook');

        assert.strictEqual(candidates.length, 1);
        assert.strictEqual(candidates[0].provenance, 'native-assisted');
        assert.strictEqual(candidates[0].shopName, null);
        assert.strictEqual(candidates[0].price, 8749000);
    });

    await itAsync('NativeSearchProtocol harus melempar error dengan status BLOCKED saat CAPTCHA terdeteksi', async () => {
        const mockSender = (payload, cb) => {
            cb({
                status: 'BLOCKED',
                error: 'Verifikasi keamanan terdeteksi di Shopee'
            });
        };

        const protocol = new NativeSearchProtocol(shopeeManifest, { messageSender: mockSender });
        await assert.rejects(async () => {
            await protocol.search('Asus Vivobook');
        }, (err) => {
            return err.status === 'BLOCKED' && err.message.includes('Verifikasi keamanan');
        });
    });

    await itAsync('NativeSearchProtocol harus melempar error CANCELLED_BY_USER saat tab ditutup user', async () => {
        const mockSender = (payload, cb) => {
            cb({
                status: 'CANCELLED_BY_USER',
                error: 'Tab ditutup manual oleh pengguna'
            });
        };

        const protocol = new NativeSearchProtocol(shopeeManifest, { messageSender: mockSender });
        await assert.rejects(async () => {
            await protocol.search('Asus Vivobook');
        }, (err) => {
            return err.status === 'CANCELLED_BY_USER';
        });
    });

    // 3. Parser: Pengujian Skeleton vs Kartu Terhidrasi
    it('getValidCards harus membuang kartu skeleton (tanpa link dan text pendek)', () => {
        const doc = new MockDocument();

        // Buat 3 kartu skeleton (seperti temuan Eksperimen 1)
        for (let i = 0; i < 3; i++) {
            const skeleton = new MockElement('div', { 'data-sqe': 'item', class: 'bg-shopee-grey skeleton' }, '');
            doc.addCard(skeleton);
        }

        // Buat 2 kartu terhidrasi dengan data riil (seperti temuan Eksperimen 3)
        for (let i = 0; i < 2; i++) {
            const valid = new MockElement('div', {
                'data-sqe': 'item',
                'aria-label': 'Product card: Asus Vivobook Go 15 E1504FA New Gen'
            }, 'Asus Vivobook Go 15 E1504FA Amd Ryzen 5 40 New Gen RAM 8GB DDR5 1TB SSD 15.6 FHD\nRp\n8.749.000\n5.0\n2 terjual\nBogor');
            const link = new MockElement('a', { href: `/Asus-Vivobook-Go-15-i.1234.${100 + i}` });
            valid.appendChild(link);
            doc.addCard(valid);
        }

        const validCards = getValidCards(doc, shopeeManifest);
        assert.strictEqual(validCards.length, 2, 'Hanya 2 kartu yang valid; 3 skeleton harus dibuang');
    });

    it('extractShopeeCard harus mengekstrak field dengan hybrid strategy dan shopName wajib null', () => {
        const card = new MockElement('div', {
            'data-sqe': 'item',
            'aria-label': 'Product card: Asus Vivobook Go 15 E1504FA'
        }, 'Asus Vivobook Go 15 E1504FA Amd Ryzen 5 40 New Gen RAM 8GB DDR5 1TB SSD 15.6 FHD IPS Windows 11 Home\nRp\n8.749.000\nRp\n8.799.000\n-1%\n5.0\n2 terjual\nBogor\nProduk Serupa');

        const link = new MockElement('a', { href: '/Asus-Vivobook-Go-15-E1504FA-i.1567570337.40912086858' });
        const star = new MockElement('img', { alt: 'rating-star' });
        const ratingText = new MockElement('span', {}, '5.0');
        const loc = new MockElement('span', { class: 'text-shopee-black54' }, 'Bogor');

        card.appendChild(link);
        card.appendChild(star);
        card.appendChild(ratingText);
        card.appendChild(loc);

        const extracted = extractShopeeCard(card, shopeeManifest);
        assert.ok(extracted !== null);
        assert.strictEqual(extracted.title, 'Asus Vivobook Go 15 E1504FA');
        assert.strictEqual(extracted.price, 8749000);
        assert.strictEqual(extracted.rating, 5.0);
        assert.strictEqual(extracted.sold, 2);
        assert.strictEqual(extracted.location, 'Bogor');
        assert.strictEqual(extracted.shopName, null, 'shopName wajib null');
        assert.ok(extracted.url.includes('-i.1567570337.40912086858'));
    });

    it('checkBlocked harus mengidentifikasi selector CAPTCHA / login wall', () => {
        const cleanDoc = new MockDocument();
        assert.strictEqual(checkBlocked(cleanDoc, shopeeManifest), false);

        const blockedDoc = new MockDocument();
        blockedDoc.setBlocked('.shopee-captcha');
        assert.strictEqual(checkBlocked(blockedDoc, shopeeManifest), true);
    });

    // 4. Parser: Penanganan manifest.rejectPattern (String vs RegExp vs Deserialized Object)
    it('parser harus menangani manifest.rejectPattern berupa string maupun RegExp tanpa error', () => {
        // Kasus 1: manifest.rejectPattern berupa string
        const docString = new MockDocument();
        const validCard1 = new MockElement('div', {
            'data-sqe': 'item',
            'aria-label': 'Product card: Asus Vivobook Go 15'
        }, 'Asus Vivobook Go 15 E1504FA Amd Ryzen 5 40 New Gen RAM 8GB DDR5 1TB SSD 15.6 FHD\nRp\n8.749.000\n5.0\n2 terjual\nBogor');
        const validLink1 = new MockElement('a', { href: '/Asus-Vivobook-Go-15-i.1234.101' });
        validCard1.appendChild(validLink1);

        const rejectCard1 = new MockElement('div', {
            'data-sqe': 'item',
            'aria-label': 'Product card: Produk Serupa'
        }, 'Deskripsi Produk Serupa Shopee Rekomendasi Tambahan Panjang Teks Lebih Dari 50 Karakter\nRp\n200.000\n4.5\n1 terjual\nJakarta');
        const rejectLink1 = new MockElement('a', { href: '/find_similar_products?itemid=101' });
        rejectCard1.appendChild(rejectLink1);

        docString.addCard(validCard1);
        docString.addCard(rejectCard1);

        const manifestWithString = {
            ...shopeeManifest,
            rejectPattern: '/find_similar_products/',
            pdpPattern: '-i\\.\\d+\\.\\d+'
        };

        const validCardsString = getValidCards(docString, manifestWithString);
        assert.strictEqual(validCardsString.length, 1, 'getValidCards harus meloloskan 1 kartu valid saat rejectPattern string');
        const extractedString = extractShopeeCard(validCard1, manifestWithString);
        assert.ok(extractedString !== null, 'extractShopeeCard harus berhasil mengekstrak kartu valid saat rejectPattern string');
        assert.strictEqual(extractedString.price, 8749000);
        const rejectedExtractString = extractShopeeCard(rejectCard1, manifestWithString);
        assert.strictEqual(rejectedExtractString, null, 'extractShopeeCard harus menolak link reject saat rejectPattern string');

        // Kasus 2: manifest.rejectPattern berupa RegExp
        const docRegExp = new MockDocument();
        const validCard2 = new MockElement('div', {
            'data-sqe': 'item',
            'aria-label': 'Product card: Asus Vivobook Go 15'
        }, 'Asus Vivobook Go 15 E1504FA Amd Ryzen 5 40 New Gen RAM 8GB DDR5 1TB SSD 15.6 FHD\nRp\n8.749.000\n5.0\n2 terjual\nBogor');
        const validLink2 = new MockElement('a', { href: '/Asus-Vivobook-Go-15-i.1234.102' });
        validCard2.appendChild(validLink2);

        const rejectCard2 = new MockElement('div', {
            'data-sqe': 'item',
            'aria-label': 'Product card: Produk Serupa'
        }, 'Deskripsi Produk Serupa Shopee Rekomendasi Tambahan Panjang Teks Lebih Dari 50 Karakter\nRp\n200.000\n4.5\n1 terjual\nJakarta');
        const rejectLink2 = new MockElement('a', { href: '/find_similar_products?itemid=102' });
        rejectCard2.appendChild(rejectLink2);

        docRegExp.addCard(validCard2);
        docRegExp.addCard(rejectCard2);

        const manifestWithRegExp = {
            ...shopeeManifest,
            rejectPattern: /\/find_similar_products/,
            pdpPattern: /-i\.\d+\.\d+/
        };

        const validCardsRegExp = getValidCards(docRegExp, manifestWithRegExp);
        assert.strictEqual(validCardsRegExp.length, 1, 'getValidCards harus meloloskan 1 kartu valid saat rejectPattern RegExp');
        const extractedRegExp = extractShopeeCard(validCard2, manifestWithRegExp);
        assert.ok(extractedRegExp !== null, 'extractShopeeCard harus berhasil mengekstrak kartu valid saat rejectPattern RegExp');
        assert.strictEqual(extractedRegExp.price, 8749000);
        const rejectedExtractRegExp = extractShopeeCard(rejectCard2, manifestWithRegExp);
        assert.strictEqual(rejectedExtractRegExp, null, 'extractShopeeCard harus menolak link reject saat rejectPattern RegExp');

        // Kasus 3 (Defensif): manifest.rejectPattern berupa {} (efek serialisasi chrome.runtime.sendMessage)
        const manifestWithEmptyObject = {
            ...shopeeManifest,
            rejectPattern: {},
            pdpPattern: {}
        };
        const validCardsEmpty = getValidCards(docRegExp, manifestWithEmptyObject);
        assert.ok(validCardsEmpty.length >= 1, 'getValidCards tidak boleh melempar TypeError saat rejectPattern berupa {}');
        const extractedEmpty = extractShopeeCard(validCard2, manifestWithEmptyObject);
        assert.ok(extractedEmpty !== null, 'extractShopeeCard tidak boleh melempar TypeError saat rejectPattern berupa {}');
    });

    console.log(`\n========================================`);
    console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
    console.log(`========================================\n`);

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
