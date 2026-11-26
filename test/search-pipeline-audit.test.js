/**
 * test/search-pipeline-audit.test.js
 * 
 * Unit test suite untuk CR-006:
 * 1. QueryBuilder clean queries (tanpa negative minus operators).
 * 2. URL Classification untuk 4 marketplace (Shopee, Tokopedia, Lazada, Blibli).
 * 3. Multi-Pattern Price Parser (Rupiah, NBSP, JSON-LD, Installment filtering).
 */

const assert = require('assert');
const { buildQueries } = require('../extension/shared/query-builder.js');
const { classifyUrl, isProductUrl } = require('../extension/shared/pdp-url-classifier.js');
const { SearchClient } = require('../extension/shared/search-client.js');
const { ExaProvider } = require('../extension/shared/providers/exa-provider.js');
const { parseCandidatePrice } = require('../extension/shared/candidate-normalizer.js');

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
        throw err;
    }
}

console.log('=== TEST SUITE: CR-006 SEARCH PIPELINE AUDIT ===');

it('QueryBuilder harus menghasilkan query natural tanpa operator minus (-)', () => {
    const prodKasur = {
        title: 'Kasur Springbed Novilla IceMint 90x200',
        brand: 'Novilla',
        model: 'IceMint',
        category: 'Kasur',
        keySpecs: ['90x200', 'Springbed']
    };
    const qKasur = buildQueries(prodKasur);
    assert.ok(qKasur.tier1, 'Tier 1 query harus ada');
    assert.strictEqual(qKasur.tier1.includes('-'), false, 'Tier 1 tidak boleh mengandung tanda minus');
    assert.ok(qKasur.tier1.includes('Novilla'), 'Harus menyertakan brand');
});

it('PdpUrlClassifier harus meloloskan URL produk valid dari 4 marketplace', () => {
    const validUrls = [
        'https://shopee.co.id/Nama-Produk-i.12345.67890',
        'https://shopee.co.id/product/12345/67890',
        'https://www.tokopedia.com/nama-toko/nama-produk',
        'https://www.lazada.co.id/products/nama-produk-i123456-s789012.html',
        'https://www.lazada.co.id/products/nama-produk-i123456.html',
        'https://www.blibli.com/p/nama-produk/ps--ABC-12345',
        'https://www.blibli.com/p/nama-produk/is--ABC-12345'
    ];

    for (const url of validUrls) {
        const c = classifyUrl(url);
        assert.strictEqual(c.isPdp, true, `URL harus valid PDP: ${url}`);
        assert.strictEqual(isProductUrl(url), true, `isProductUrl harus true: ${url}`);
    }
});

it('PdpUrlClassifier harus membuang URL non-produk (search, etalase, catalog)', () => {
    const junkUrls = [
        'https://shopee.co.id/search?keyword=kasur',
        'https://www.tokopedia.com/search?q=kasur',
        'https://www.tokopedia.com/official/etalase/kasur',
        'https://www.lazada.co.id/catalog/?q=kasur',
        'https://www.blibli.com/backend/search/products?searchTerm=kasur'
    ];

    for (const url of junkUrls) {
        const c = classifyUrl(url);
        assert.strictEqual(c.isPdp, false, `URL junk harus ditolak: ${url}`);
        assert.strictEqual(isProductUrl(url), false, `isProductUrl harus false: ${url}`);
    }
});

it('ExaProvider dan SearchClient harus mengekstrak harga dari format NBSP, JSON-LD, dan menyaring cicilan', () => {
    const exa = new ExaProvider();
    const sc = new SearchClient();

    // 1. NBSP format
    const nbspText = 'Kasur Springbed harga Rp\u00a02.350.000 diskon';
    assert.strictEqual(exa.extractPrice(nbspText), 2350000);
    assert.strictEqual(sc.extractPrice(nbspText), 2350000);

    // 2. JSON-LD embed
    const jsonLdText = 'Detail: {"@type":"Product","offers":{"price":"3499000"}}';
    assert.strictEqual(exa.extractPrice(jsonLdText), 3499000);
    assert.strictEqual(sc.extractPrice(jsonLdText), 3499000);

    // 3. Installment vs Cash: cicilan harus diabaikan, harga cash diambil
    const installmentText = 'Mulai Rp 150.000/bln. Harga tunai Rp 3.200.000 garansi';
    assert.strictEqual(exa.extractPrice(installmentText), 3200000);
    assert.strictEqual(sc.extractPrice(installmentText), 3200000);
});

console.log(`\nAll ${passedTests} CR-006 audit tests passed!`);
