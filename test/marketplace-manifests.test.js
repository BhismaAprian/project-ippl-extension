/**
 * test/marketplace-manifests.test.js
 * 
 * Pengujian unit untuk seluruh manifest pencarian marketplace (CR-001):
 * - Shopee (extension/manifest/marketplace-manifest/shopee.js)
 * - Tokopedia (extension/manifest/marketplace-manifest/tokopedia.js)
 * - Lazada (extension/manifest/marketplace-manifest/lazada.js)
 * - Blibli (extension/manifest/marketplace-manifest/blibli.js)
 * 
 * Memverifikasi:
 * 1. Keberadaan field wajib pada masing-masing manifest.
 * 2. Kesesuaian pdpPattern dengan URL PDP nyata masing-masing platform.
 * 3. Keberhasilan rejectPattern dalam menyaring tautan sampah / non-PDP.
 * 4. Kepatuhan ADR-03: Pola string pattern serializable (tidak rusak menjadi {} saat JSON.stringify).
 */

const assert = require('assert');
const shopeeManifest = require('../extension/manifest/marketplace-manifest/shopee.js');
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

console.log('=== TEST SUITE: MULTI-MARKETPLACE MANIFESTS (CR-001) ===');

// 1. SHOPEE MANIFEST
it('Shopee manifest harus valid dan serializable sebagai string pattern', () => {
    assert.strictEqual(shopeeManifest.id, 'shopee');
    assert.ok(shopeeManifest.searchUrlTemplate.includes('{q}'));
    assert.strictEqual(shopeeManifest.activationStrategy, 'brief-active');

    const validPdp = 'https://shopee.co.id/Laptop-Asus-Vivobook-i.123456.78910';
    const rejectUrl = 'https://shopee.co.id/find_similar_products?itemid=78910';
    assert.ok(shopeeManifest.pdpPattern.test(validPdp), 'pdpPattern Shopee harus mencocokkan PDP');
    assert.ok(shopeeManifest.rejectPattern.test(rejectUrl), 'rejectPattern Shopee harus menolak find_similar_products');

    const serialized = JSON.stringify(shopeeManifest);
    assert.ok(serialized.includes('-i\\\\.\\\\d+\\\\.\\\\d+'), 'pdpPattern harus serializable string pattern');
});

// 2. TOKOPEDIA MANIFEST
it('Tokopedia manifest harus valid dan mengenali URL PDP Tokopedia', () => {
    assert.strictEqual(tokopediaManifest.id, 'tokopedia');
    assert.strictEqual(tokopediaManifest.name, 'Tokopedia');
    assert.ok(tokopediaManifest.searchUrlTemplate.includes('{q}'));
    assert.ok(tokopediaManifest.cardSelector.includes('[data-testid="divSRPProductCard"]'));

    const validPdp = 'https://www.tokopedia.com/asus-official/asus-vivobook-14-a1404za-i3-1215u-8gb-512gb';
    const rejectDiscovery = 'https://www.tokopedia.com/discovery/promo-gajian';
    assert.ok(tokopediaManifest.pdpPattern.test(validPdp), 'pdpPattern Tokopedia harus mencocokkan PDP');
    assert.ok(tokopediaManifest.rejectPattern.test(rejectDiscovery), 'rejectPattern Tokopedia harus menolak discovery');

    const serialized = JSON.stringify(tokopediaManifest);
    assert.ok(!serialized.includes('{}'), 'Manifest Tokopedia tidak boleh menghasilkan {} akibat RegExp');
});

// 3. LAZADA MANIFEST
it('Lazada manifest harus valid dan mengenali URL PDP Lazada', () => {
    assert.strictEqual(lazadaManifest.id, 'lazada');
    assert.strictEqual(lazadaManifest.name, 'Lazada');
    assert.ok(lazadaManifest.searchUrlTemplate.includes('{q}'));
    assert.ok(lazadaManifest.cardSelector.includes('[data-qa-locator="product-item"]'));

    const validPdp1 = 'https://www.lazada.co.id/products/asus-vivobook-14-i12345678-s87654321.html';
    const validPdp2 = 'https://www.lazada.co.id/products/laptop-gaming-rog.html';
    const rejectHelp = 'https://www.lazada.co.id/helpcenter/returns';

    assert.ok(lazadaManifest.pdpPattern.test(validPdp1), 'pdpPattern Lazada harus mencocokkan format -i...-s...');
    assert.ok(lazadaManifest.pdpPattern.test(validPdp2), 'pdpPattern Lazada harus mencocokkan format /products/');
    assert.ok(lazadaManifest.rejectPattern.test(rejectHelp), 'rejectPattern Lazada harus menolak helpcenter');
});

// 4. BLIBLI MANIFEST
it('Blibli manifest harus valid dan mengenali URL PDP Blibli (/p/{slug}/{code})', () => {
    assert.strictEqual(blibliManifest.id, 'blibli');
    assert.strictEqual(blibliManifest.name, 'Blibli');
    assert.ok(blibliManifest.searchUrlTemplate.includes('{q}'));
    assert.ok(blibliManifest.cardSelector.includes('[data-testid="productCard"]'));

    const validPdp = 'https://www.blibli.com/p/asus-vivobook-14-core-i3-1215u/ps--ASF-12345-001';
    const rejectCart = 'https://www.blibli.com/cart';

    assert.ok(blibliManifest.pdpPattern.test(validPdp), 'pdpPattern Blibli harus mencocokkan /p/...');
    assert.ok(blibliManifest.rejectPattern.test(rejectCart), 'rejectPattern Blibli harus menolak cart');
});

// 5. HYDRATION & REJECT CONTRACT CHECK
it('Seluruh manifest harus memiliki kontrak hydrationCheck terstandarisasi', () => {
    const manifests = [shopeeManifest, tokopediaManifest, lazadaManifest, blibliManifest];
    for (const m of manifests) {
        assert.ok(m.hydrationCheck.minValidCards >= 5, `${m.id} minValidCards harus >= 5`);
        assert.ok(m.hydrationCheck.minTextLength >= 30, `${m.id} minTextLength harus >= 30`);
        assert.strictEqual(m.hydrationCheck.timeout, 15000, `${m.id} timeout harus 15000 ms`);
        assert.strictEqual(m.hydrationCheck.pollingInterval, 500, `${m.id} pollingInterval harus 500 ms`);
        assert.ok(Array.isArray(m.blockedSelectors), `${m.id} blockedSelectors harus array`);
        assert.ok(m.blockedSelectors.length > 0, `${m.id} blockedSelectors tidak boleh kosong`);
    }
});

console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
