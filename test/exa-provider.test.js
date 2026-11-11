/**
 * test/exa-provider.test.js
 * 
 * Pengujian unit untuk extension/shared/providers/exa-provider.js:
 * 1. isAvailable() bernilai false jika API key tidak ada, true jika ada.
 * 2. Query kosong atau whitespace tidak pernah memicu panggilan fetch (Anti-Query Kosong).
 * 3. URL non-PDP (/find/, /search/, /cart/, /etalase/) disaring dan dibuang.
 * 4. URL PDP valid lolos filter.
 * 5. Gatekeeper 3 Lapis bekerja (banned terms, dominance guard, price plausibility).
 * 6. Penanganan error HTTP Exa (401, 429, Network error).
 */

const assert = require('assert');
const { ExaProvider } = require('../extension/shared/providers/exa-provider.js');

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

async function runTests() {
    console.log('=== TEST SUITE: EXA PROVIDER UNIT TESTS ===');

    // 1. Contract & Availability Check
    it('ExaProvider harus mengembalikan metadata kontrak yang tepat (name: exa, provenance: exa-fallback, priority: 5)', () => {
        const provider = new ExaProvider();
        assert.strictEqual(provider.getName(), 'exa');
        assert.strictEqual(provider.getProvenance(), 'exa-fallback');
        assert.strictEqual(provider.getPriority(), 5);
    });

    await itAsync('isAvailable() harus return false jika API key belum diisi, dan true jika ada', async () => {
        const provider = new ExaProvider();
        assert.strictEqual(await provider.isAvailable(), false);
        assert.strictEqual(await provider.isAvailable({ apiKey: '' }), false);

        provider.setApiKey('test_exa_key_123');
        assert.strictEqual(await provider.isAvailable(), true);
    });

    // 2. Anti-Query Kosong: fetch TIDAK boleh dipanggil
    await itAsync('Query kosong atau rusak TIDAK BOLEH memicu pemanggilan fetch', async () => {
        let fetchCalled = false;
        const mockFetch = async () => {
            fetchCalled = true;
            return { ok: true, json: async () => ({ results: [] }) };
        };

        const provider = new ExaProvider({ apiKey: 'valid_key', fetchFn: mockFetch });

        // Uji berbagai varian query kosong / whitespace / simbol
        const emptyInputs = ['', '   ', '!', '  !@#  ', { title: '' }, null, undefined];

        for (const input of emptyInputs) {
            fetchCalled = false;
            const res = await provider.search(input);
            assert.strictEqual(fetchCalled, false, `Fetch tidak boleh dipanggil untuk input: ${JSON.stringify(input)}`);
            assert.deepStrictEqual(res, []);
        }
    });

    // 3. Penyaringan Non-PDP URL vs PDP URL
    await itAsync('Hasil dengan URL non-PDP harus dibuang, hanya URL PDP valid yang diloloskan', async () => {
        const mockResults = [
            {
                title: 'RAM Laptop DDR4 8GB 3200MHz SODIMM',
                url: 'https://shopee.co.id/search?keyword=ram%20laptop', // Non-PDP: pencarian
                text: 'Harga Rp 320.000'
            },
            {
                title: 'RAM Laptop DDR4 8GB 3200MHz SODIMM Samsung',
                url: 'https://shopee.co.id/product-title-i.12345.67890', // PDP valid
                text: 'Harga Rp 330.000'
            },
            {
                title: 'Etalase RAM Komputer Lengkap',
                url: 'https://www.tokopedia.com/official/etalase/ram', // Non-PDP: etalase
                text: 'Harga Rp 350.000'
            },
            {
                title: 'RAM Laptop DDR4 8GB 3200MHz Hynix',
                url: 'https://www.tokopedia.com/toko-komputer/ram-laptop-ddr4-8gb-3200mhz', // PDP valid
                text: 'Harga Rp 315.000'
            }
        ];

        const mockFetch = async () => {
            return {
                ok: true,
                json: async () => ({ results: mockResults })
            };
        };

        const provider = new ExaProvider({ apiKey: 'key_123', fetchFn: mockFetch });
        const res = await provider.search('RAM Laptop DDR4 8GB', {
            rawProduct: { title: 'RAM Laptop DDR4 8GB 3200MHz', price: 350000 }
        });

        // Hanya 2 PDP yang boleh lolos
        assert.strictEqual(res.length, 2, 'Hanya 2 hasil PDP yang harus lolos');
        assert.strictEqual(res[0].url, 'https://shopee.co.id/product-title-i.12345.67890');
        assert.strictEqual(res[1].url, 'https://www.tokopedia.com/toko-komputer/ram-laptop-ddr4-8gb-3200mhz');
    });

    // 4. Integrasi Gatekeeper 3 Lapis
    await itAsync('Gatekeeper 3 Lapis harus membuang aksesoris murni (Bantal Guling saat produk Kasur)', async () => {
        const mockResults = [
            {
                title: 'Kasur Springbed Central Deluxe 160x200 + Bonus Bantal',
                url: 'https://www.tokopedia.com/toko/kasur-springbed-central-160x200',
                text: 'Harga Rp 3.200.000'
            },
            {
                title: 'Bantal Guling Hotel Silicon Premium Empuk',
                url: 'https://www.tokopedia.com/toko/bantal-guling-hotel-silicon',
                text: 'Harga Rp 85.000' // Aksesoris murni (< 20% harga asli)
            },
            {
                title: 'Bestway Matras Angin Tiup Single',
                url: 'https://www.tokopedia.com/toko/matras-angin-tiup-single',
                text: 'Harga Rp 250.000' // Banned term: angin/tiup
            }
        ];

        const mockFetch = async () => ({
            ok: true,
            json: async () => ({ results: mockResults })
        });

        const provider = new ExaProvider({ apiKey: 'key_123', fetchFn: mockFetch });
        const rawProduct = { title: 'Kasur Springbed Comforta 160x200', price: 3500000 };

        const res = await provider.search('Kasur Springbed 160x200', { rawProduct });
        assert.strictEqual(res.length, 1, 'Hanya kasur springbed yang boleh lolos gatekeeper');
        assert.strictEqual(res[0].title, 'Kasur Springbed Central Deluxe 160x200 + Bonus Bantal');
    });

    // 5. Penanganan Error HTTP Exa
    await itAsync('ExaProvider harus melempar error deskriptif jika HTTP 401 atau 429', async () => {
        const mockFetch401 = async () => ({
            ok: false,
            status: 401,
            statusText: 'Unauthorized'
        });

        const provider401 = new ExaProvider({ apiKey: 'bad_key', fetchFn: mockFetch401 });
        await assert.rejects(
            async () => await provider401.search('Laptop Asus'),
            /API Key Exa tidak valid/
        );

        const mockFetch429 = async () => ({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests'
        });

        const provider429 = new ExaProvider({ apiKey: 'valid_key', fetchFn: mockFetch429 });
        await assert.rejects(
            async () => await provider429.search('Laptop Asus'),
            /Batas kuota Exa API tercapai/
        );
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
