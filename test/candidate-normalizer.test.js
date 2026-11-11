/**
 * test/candidate-normalizer.test.js
 * 
 * Pengujian unit untuk extension/shared/candidate-normalizer.js:
 * 1. Field wajib lengkap menghasilkan objek NormalizedCandidate yang valid.
 * 2. Parsing harga beragam format (Rupiah, jt, m, micro-unit Shopee).
 * 3. Pembuangan kandidat jika harga gagal di-parse (return null).
 * 4. Format observedAt ISO 8601 string.
 * 5. Sanitasi rating (rentang 0-5).
 */

const assert = require('assert');
const {
    normalizeCandidate,
    parseCandidatePrice,
    parseCandidateRating
} = require('../extension/shared/candidate-normalizer.js');

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

console.log('=== TEST SUITE: CANDIDATE NORMALIZER ===');

// 1. Validasi Field Wajib Lengkap
it('Data lengkap harus menghasilkan objek NormalizedCandidate dengan semua field terisi', () => {
    const raw = {
        title: 'RAM LAPTOP DDR4 8GB 3200MHZ SODIMM SAMSUNG',
        price: 'Rp 325.000',
        url: 'https://shopee.co.id/product-i.123.456',
        rating: 4.9,
        shopName: 'Enterkomputer Official',
        itemId: '456'
    };

    const res = normalizeCandidate(raw, 'shopee', 'native-assisted');
    assert.ok(res !== null, 'Kandidat valid tidak boleh null');
    assert.strictEqual(res.source, 'shopee');
    assert.strictEqual(res.provenance, 'native-assisted');
    assert.strictEqual(res.title, raw.title);
    assert.strictEqual(res.price, 325000);
    assert.strictEqual(res.rating, 4.9);
    assert.strictEqual(res.shopName, 'Enterkomputer Official');
    assert.strictEqual(res.itemId, '456');
    assert.strictEqual(res.matchType, 'UNKNOWN');
    assert.strictEqual(res.raw, raw);
});

// 2. Format observedAt ISO 8601
it('observedAt harus berupa ISO 8601 timestamp string yang valid', () => {
    const raw = {
        title: 'Produk Uji',
        price: 150000,
        url: 'https://tokopedia.com/toko/produk'
    };
    const res = normalizeCandidate(raw, 'tokopedia', 'native-assisted');
    assert.ok(typeof res.observedAt === 'string');
    const parsedDate = new Date(res.observedAt);
    assert.ok(!isNaN(parsedDate.getTime()), 'Timestamp harus dapat diparse oleh Date');
    assert.strictEqual(res.observedAt, parsedDate.toISOString());
});

// 3. Parsing Harga: Format Rupiah Standar
it('parseCandidatePrice harus menangani format Rupiah standar ("Rp 8.499.000", "8,499,000", "Rp8.500.000,-")', () => {
    assert.strictEqual(parseCandidatePrice('Rp 8.499.000'), 8499000);
    assert.strictEqual(parseCandidatePrice('Rp8.499.000,-'), 8499000);
    assert.strictEqual(parseCandidatePrice('IDR 8.499.000,00'), 8499000);
    assert.strictEqual(parseCandidatePrice('8,499,000'), 8499000);
    assert.strictEqual(parseCandidatePrice(8499000), 8499000);
});

// 4. Parsing Harga: Singkatan "jt" / "juta" dan "m" / "miliar"
it('parseCandidatePrice harus menangani format singkatan "jt" dan "m"', () => {
    assert.strictEqual(parseCandidatePrice('1.5 jt'), 1500000);
    assert.strictEqual(parseCandidatePrice('2,2 juta'), 2200000);
    assert.strictEqual(parseCandidatePrice('Rp 1.5jt'), 1500000);
    assert.strictEqual(parseCandidatePrice('1.2 m'), 1200000000);
    assert.strictEqual(parseCandidatePrice('2,5 miliar'), 2500000000);
});

// 5. Parsing Harga: Micro-unit Shopee (> 100.000.000)
it('parseCandidatePrice harus menangani micro-unit Shopee (dibagi 100.000)', () => {
    // Rp 8.499.000 disimpan sebagai 849900000000
    assert.strictEqual(parseCandidatePrice(849900000000), 8499000);
    assert.strictEqual(parseCandidatePrice('849900000000'), 8499000);
});

// 6. Pembuangan Kandidat jika Harga Gagal Parse
it('normalizeCandidate harus me-return null jika harga tidak valid atau gagal parse', () => {
    const invalidPrices = [
        null,
        undefined,
        '',
        'Hubungi Kami',
        'Gratis Ongkir',
        0,
        -5000,
        'Rp 0',
        'Rp 50' // Terlalu murah (< Rp 100)
    ];

    invalidPrices.forEach(p => {
        const raw = {
            title: 'Produk Tanpa Harga',
            price: p,
            url: 'https://shopee.co.id/item-i.1.2'
        };
        const res = normalizeCandidate(raw, 'shopee', 'native-assisted');
        assert.strictEqual(res, null, `Kandidat dengan harga ${p} harus dibuang (return null)`);
    });
});

// 7. Pembuangan Kandidat jika Data Kritis Hilang (URL / Title / Source)
it('normalizeCandidate harus me-return null jika URL atau Title hilang', () => {
    assert.strictEqual(normalizeCandidate({ price: 100000 }, 'shopee', 'native-assisted'), null);
    assert.strictEqual(normalizeCandidate({ title: 'Ada Judul', price: 100000 }, 'shopee', 'native-assisted'), null);
    assert.strictEqual(normalizeCandidate(null, 'shopee', 'native-assisted'), null);
});

// 8. Sanitasi Rating
it('parseCandidateRating harus menormalkan string atau angka ke rentang 0-5', () => {
    assert.strictEqual(parseCandidateRating('4.8'), 4.8);
    assert.strictEqual(parseCandidateRating('4,7'), 4.7);
    assert.strictEqual(parseCandidateRating(5), 5);
    assert.strictEqual(parseCandidateRating(6), 5);
    assert.strictEqual(parseCandidateRating(-1), null);
    assert.strictEqual(parseCandidateRating(null), null);
});

console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
