/**
 * test/shopee-manifest.test.js
 * 
 * Pengujian unit untuk extension/manifest/marketplace-manifest/shopee.js:
 * 1. Validasi keberadaan field wajib pada manifest.
 * 2. Validasi pola pdpPattern dengan URL produk Shopee nyata.
 * 3. Validasi rejectPattern menolak /find_similar_products.
 * 4. Validasi hydrationCheck (minValidCards === 5, timeout 15000).
 */

const assert = require('assert');
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

console.log('=== TEST SUITE: SHOPEE MANIFEST ===');

it('Manifest Shopee harus memiliki seluruh field wajib', () => {
    assert.strictEqual(shopeeManifest.id, 'shopee');
    assert.strictEqual(shopeeManifest.name, 'Shopee');
    assert.ok(shopeeManifest.searchUrlTemplate.includes('{q}'));
    assert.ok(shopeeManifest.cardSelector.includes('[data-sqe="item"]'));
    assert.strictEqual(shopeeManifest.activationStrategy, 'brief-active');
    assert.ok(Array.isArray(shopeeManifest.blockedSelectors));
    assert.ok(shopeeManifest.blockedSelectors.includes('.shopee-captcha'));
    assert.strictEqual(shopeeManifest.fields.shopName, null, 'shopName wajib null pada Shopee search');
});

it('pdpPattern harus cocok dengan URL PDP Shopee nyata', () => {
    const validUrl = 'https://shopee.co.id/Asus-Vivobook-Go-15-E1504FA-i.1567570337.40912086858';
    assert.ok(shopeeManifest.pdpPattern.test(validUrl), 'Pola PDP harus mendeteksi -i.{shop}.{item}');
});

it('rejectPattern harus mendeteksi dan menolak link find_similar_products', () => {
    const similarUrl = 'https://shopee.co.id/find_similar_products?itemid=40912086858';
    assert.ok(shopeeManifest.rejectPattern.test(similarUrl), 'rejectPattern harus mendeteksi find_similar_products');
});

it('hydrationCheck harus memiliki minValidCards = 5 dan timeout 15000', () => {
    assert.strictEqual(shopeeManifest.hydrationCheck.minValidCards, 5);
    assert.strictEqual(shopeeManifest.hydrationCheck.minTextLength, 50);
    assert.strictEqual(shopeeManifest.hydrationCheck.timeout, 15000);
    assert.strictEqual(shopeeManifest.hydrationCheck.pollingInterval, 500);
});

console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
