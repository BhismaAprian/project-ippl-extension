/**
 * test/exa-integration.test.js
 * 
 * Pengujian integrasi end-to-end untuk Exa Provider:
 * ExaProvider + PdpUrlClassifier + Gatekeeper 3 Lapis + CandidateNormalizer.
 * 
 * Target Acceptance Criteria:
 * - Minimal 80% hasil yang lolos dari filter adalah URL PDP valid.
 * - Seluruh kandidat ternormalisasi memiliki provenance: 'exa-fallback' dan field lengkap.
 */

const assert = require('assert');
const { ExaProvider } = require('../extension/shared/providers/exa-provider.js');
const { normalizeCandidate } = require('../extension/shared/candidate-normalizer.js');

let passedTests = 0;
let totalTests = 0;

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

async function runTests() {
    console.log('=== TEST SUITE: EXA INTEGRATION & 80% PDP PASS RATE ===');

    // Mock 10 Hasil dari Exa: 8 produk PDP valid, 2 URL sampah (1 etalase, 1 search)
    const mockTenResults = [
        // 1. Shopee PDP
        {
            title: 'ASUS Vivobook 14 A1404ZA i3-1215U 8GB 512GB SSD',
            url: 'https://shopee.co.id/ASUS-Vivobook-14-A1404ZA-i.10291.88291',
            text: 'Laptop ASUS Vivobook 14 garansi resmi harga Rp 6.499.000'
        },
        // 2. Tokopedia PDP
        {
            title: 'ASUS Vivobook 14 A1404ZA Intel Core i3 8GB 512GB',
            url: 'https://www.tokopedia.com/asus-official/asus-vivobook-14-a1404za-i3-8gb',
            text: 'Jual Laptop ASUS Vivobook 14 Rp 6.350.000 diskon promo'
        },
        // 3. Lazada PDP
        {
            title: 'Laptop ASUS Vivobook 14 A1404ZA FHD i3 8GB 512GB',
            url: 'https://www.lazada.co.id/products/laptop-asus-vivobook-14-a1404za-i12345-s67890.html',
            text: 'Harga Rp 6.299.000 cicilan 0%'
        },
        // 4. Blibli PDP
        {
            title: 'ASUS Vivobook 14 A1404ZA Core i3 1215U 8GB 512GB Blue',
            url: 'https://www.blibli.com/p/asus-vivobook-14-a1404za/ps--ASU-12345-001',
            text: 'Harga Rp 6.450.000 gratis ongkir'
        },
        // 5. Tokopedia PDP
        {
            title: 'ASUS Vivobook 14 A1404ZA Intel i3 12th Gen 8GB 512GB',
            url: 'https://www.tokopedia.com/enterkomputer/asus-vivobook-14-a1404za-i3-8gb',
            text: 'Rp 6.399.000 ready stock'
        },
        // 6. Shopee PDP
        {
            title: 'Laptop ASUS Vivobook Go 14 A1404ZA i3 8GB 512GB',
            url: 'https://shopee.co.id/Laptop-ASUS-Vivobook-Go-14-i.44556.77889',
            text: 'Rp 6.199.000 garansi resmi'
        },
        // 7. Lazada PDP (tanpa www)
        {
            title: 'ASUS Vivobook 14 A1404ZA Silver i3 8GB 512GB',
            url: 'https://lazada.co.id/products/asus-vivobook-14-silver-i99887-s11223.html',
            text: 'Harga Rp 6.400.000'
        },
        // 8. Blibli PDP
        {
            title: 'ASUS Vivobook 14 Laptop A1404ZA i3 8GB 512GB SSD W11',
            url: 'https://www.blibli.com/p/asus-vivobook-14-laptop-w11/ps--TOK-55443-009',
            text: 'Harga promo Rp 6.300.000'
        },
        // 9. NON-PDP (Tokopedia Etalase) -> Wajib dibuang
        {
            title: 'Etalase Laptop ASUS Vivobook Series',
            url: 'https://www.tokopedia.com/asus-store/etalase/vivobook',
            text: 'Koleksi laptop vivobook harga mulai Rp 5.000.000'
        },
        // 10. NON-PDP (Shopee Search Link) -> Wajib dibuang
        {
            title: 'Cari Produk Laptop ASUS Vivobook 14',
            url: 'https://shopee.co.id/search?keyword=asus%20vivobook%2014',
            text: 'Daftar harga laptop asus termurah Rp 6.000.000'
        }
    ];

    await itAsync('ExaProvider harus meloloskan minimal 80% (8 dari 10) hasil sebagai PDP valid', async () => {
        const mockFetch = async () => ({
            ok: true,
            json: async () => ({ results: mockTenResults })
        });

        const provider = new ExaProvider({ apiKey: 'key_123', fetchFn: mockFetch });
        const rawProduct = {
            title: 'ASUS Vivobook 14 A1404ZA i3 8GB 512GB',
            price: 6500000
        };

        const rawCandidates = await provider.search({
            brand: 'ASUS',
            model: 'Vivobook 14',
            category: 'laptop',
            keySpecs: { cpu: 'i3', ram: '8GB', storage: '512GB' }
        }, { rawProduct });

        // Verifikasi persentase kelolosan PDP: 8 dari 10 = 80%
        assert.strictEqual(rawCandidates.length, 8, 'Tepat 8 dari 10 hasil harus lolos filter PDP dan Gatekeeper');
        const passRate = (rawCandidates.length / mockTenResults.length) * 100;
        assert.ok(passRate >= 80, `Pass rate harus >= 80% (aktual: ${passRate}%)`);

        // Verifikasi normalisasi menyeluruh
        const normalizedList = rawCandidates.map(c => {
            return normalizeCandidate(c, c.marketplace, provider.getProvenance());
        }).filter(Boolean);

        assert.strictEqual(normalizedList.length, 8, 'Seluruh 8 kandidat harus sukses dinormalisasi');

        normalizedList.forEach(cand => {
            assert.strictEqual(cand.provenance, 'exa-fallback', 'Provenance harus exa-fallback');
            assert.ok(cand.price && cand.price > 1000000, 'Harga harus terisi dengan benar');
            assert.ok(cand.url.startsWith('https://'), 'URL harus valid HTTPS');
            assert.ok(cand.observedAt, 'observedAt harus ada');
        });
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
