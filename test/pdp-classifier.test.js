/**
 * test/pdp-classifier.test.js
 * 
 * Pengujian unit untuk extension/shared/pdp-url-classifier.js:
 * 1. Reject URL pencarian, etalase, keranjang, katalog, dan query string.
 * 2. Reject URL profil toko 1-segmen.
 * 3. Accept format PDP resmi Shopee, Tokopedia, Lazada, Blibli.
 * 4. Verifikasi ekuivalensi domain (lazada.co.id == www.lazada.co.id).
 * 5. Struktur output classifyUrl (isPdp, marketplace, reason).
 */

const assert = require('assert');
const { classifyUrl, isProductUrl } = require('../extension/shared/pdp-url-classifier.js');

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

console.log('=== TEST SUITE: PDP URL CLASSIFIER ===');

// 1. Penolakan URL Pencarian & Parameter Query Sampah
it('Harus menolak URL yang mengandung query parameter pencarian (?q=, ?keyword=, ?searchTerm=)', () => {
    const searchUrls = [
        'https://shopee.co.id/search?keyword=laptop%20asus',
        'https://www.tokopedia.com/search?st=product&q=ram%20ddr4',
        'https://www.lazada.co.id/catalog/?q=mouse%20logitech',
        'https://www.blibli.com/backend/search/products?searchTerm=kasur'
    ];

    searchUrls.forEach(url => {
        const res = classifyUrl(url);
        assert.strictEqual(res.isPdp, false, `URL harus ditolak: ${url}`);
        assert.strictEqual(isProductUrl(url), false);
    });
});

it('Harus menolak URL dengan path /find/, /etalase/, /cart/, /catalog/, /tag/', () => {
    const junkUrls = [
        'https://www.tokopedia.com/find/laptop-gaming',
        'https://www.tokopedia.com/officialstore/etalase/all',
        'https://www.tokopedia.com/cart',
        'https://www.lazada.co.id/tag/hp-samsung',
        'https://www.lazada.co.id/catalog/all-products'
    ];

    junkUrls.forEach(url => {
        const res = classifyUrl(url);
        assert.strictEqual(res.isPdp, false, `URL junk harus ditolak: ${url}`);
    });
});

// 2. Penolakan URL Profil Toko 1-Segmen
it('Harus menolak URL profil toko 1-segmen di Tokopedia dan Shopee', () => {
    const shopUrls = [
        'https://www.tokopedia.com/asus-official',
        'https://shopee.co.id/shop/12345678',
        'https://shopee.co.id/samsung.official.store'
    ];

    shopUrls.forEach(url => {
        const res = classifyUrl(url);
        assert.strictEqual(res.isPdp, false, `URL profil toko harus ditolak: ${url}`);
    });
});

// 3. Penerimaan Format PDP Resmi Shopee
it('Harus meloloskan format PDP resmi Shopee (-i.{shop}.{item} dan /product/)', () => {
    const shopeeUrls = [
        'https://shopee.co.id/RAM-LAPTOP-DDR4-8GB-3200MHZ-SODIMM-i.28392101.482910291',
        'https://shopee.co.id/product/28392101/482910291'
    ];

    shopeeUrls.forEach(url => {
        const res = classifyUrl(url);
        assert.strictEqual(res.isPdp, true);
        assert.strictEqual(res.marketplace, 'shopee');
        assert.strictEqual(isProductUrl(url, 'shopee'), true);
    });
});

// 4. Penerimaan Format PDP Resmi Tokopedia
it('Harus meloloskan format PDP resmi Tokopedia (/{toko}/{slug-produk})', () => {
    const tokpedUrl = 'https://www.tokopedia.com/enterkomputer/ram-laptop-sodimm-ddr4-8gb-3200mhz-samsung';
    const res = classifyUrl(tokpedUrl);
    assert.strictEqual(res.isPdp, true);
    assert.strictEqual(res.marketplace, 'tokopedia');
    assert.strictEqual(isProductUrl(tokpedUrl, 'tokopedia'), true);
});

it('Harus menolak URL Tokopedia dengan segmen pertama reserved (discovery, promo, help)', () => {
    const reservedUrls = [
        'https://www.tokopedia.com/discovery/gadget-terbaru',
        'https://www.tokopedia.com/promo/diskon-gajian',
        'https://www.tokopedia.com/help/article-123'
    ];

    reservedUrls.forEach(url => {
        const res = classifyUrl(url);
        assert.strictEqual(res.isPdp, false);
    });
});

// 5. Penerimaan Format PDP Resmi Lazada & Blibli
it('Harus meloloskan format PDP resmi Lazada (-i...-s... dan /products/)', () => {
    const lazadaUrl = 'https://www.lazada.co.id/products/laptop-asus-vivobook-14-i12345678-s87654321.html';
    const res = classifyUrl(lazadaUrl);
    assert.strictEqual(res.isPdp, true);
    assert.strictEqual(res.marketplace, 'lazada');
    assert.strictEqual(isProductUrl(lazadaUrl, 'lazada'), true);
});

it('Harus meloloskan format PDP resmi Blibli (/p/{slug}/{code})', () => {
    const blibliUrl = 'https://www.blibli.com/p/asus-vivobook-14-a1404za-i3-1215u-8gb-512gb/ps--ASU-60021-00045';
    const res = classifyUrl(blibliUrl);
    assert.strictEqual(res.isPdp, true);
    assert.strictEqual(res.marketplace, 'blibli');
    assert.strictEqual(isProductUrl(blibliUrl, 'blibli'), true);
});

// 6. Ekuivalensi Domain (lazada.co.id == www.lazada.co.id)
it('Harus mengenali lazada.co.id dan www.lazada.co.id secara ekuivalen', () => {
    const urlWithoutWww = 'https://lazada.co.id/products/laptop-asus-vivobook-14-i12345-s67890.html';
    const urlWithWww = 'https://www.lazada.co.id/products/laptop-asus-vivobook-14-i12345-s67890.html';

    const res1 = classifyUrl(urlWithoutWww);
    const res2 = classifyUrl(urlWithWww);

    assert.strictEqual(res1.isPdp, true);
    assert.strictEqual(res2.isPdp, true);
    assert.strictEqual(res1.marketplace, 'lazada');
    assert.strictEqual(res2.marketplace, 'lazada');
});

console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
