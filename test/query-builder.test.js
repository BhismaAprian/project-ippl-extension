/**
 * test/query-builder.test.js
 * 
 * Pengujian unit untuk extension/shared/query-builder.js:
 * 1. Jaminan query tidak pernah kosong (fingerprint kosong, null, karakter aneh).
 * 2. Pembentukan Tier 1, Tier 2, Tier 3 dari fingerprint lengkap.
 * 3. Pembentukan Tier 3 saat model kosong.
 * 4. Istilah negatif (negative terms) per kategori (laptop, ram, kasur, smartphone).
 * 5. Format keySpecs (object, array, string).
 */

const assert = require('assert');
const { buildQueries, NEGATIVE_TERMS_BY_CATEGORY } = require('../extension/shared/query-builder.js');

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

console.log('=== TEST SUITE: QUERY BUILDER ===');

// 1. Jaminan Anti-Query Kosong
it('Fingerprint null harus mengembalikan query non-kosong fallback ("produk")', () => {
    const res = buildQueries(null);
    assert.ok(res.tier1 && res.tier1.length > 0, 'tier1 tidak boleh kosong');
    assert.ok(res.tier2 && res.tier2.length > 0, 'tier2 tidak boleh kosong');
    assert.ok(res.tier3 && res.tier3.length > 0, 'tier3 tidak boleh kosong');
    assert.strictEqual(res.tier1, 'produk');
});

it('Fingerprint objek kosong {} harus mengembalikan query non-kosong fallback ("produk")', () => {
    const res = buildQueries({});
    assert.ok(res.tier1 && res.tier1.length > 0);
    assert.strictEqual(res.tier1, 'produk');
});

it('Fingerprint dengan simbol aneh saja harus tetap mengembalikan query non-kosong', () => {
    const res = buildQueries({ title: '!!!@@@###$$$%%%^^^&&&***' });
    assert.ok(res.tier1 && res.tier1.length > 0);
    assert.strictEqual(res.tier1, 'produk');
});

// 2. Pembentukan Tier Lengkap
it('Fingerprint lengkap laptop harus menghasilkan Tier 1, 2, dan 3 yang presisi', () => {
    const fp = {
        brand: 'ASUS',
        model: 'Vivobook 14',
        category: 'laptop',
        keySpecs: {
            cpu: 'i3-1215U',
            ram: '8GB',
            storage: '512GB'
        }
    };
    const res = buildQueries(fp);
    assert.ok(res.tier1.includes('ASUS Vivobook 14'), 'Tier 1 harus mengandung brand dan model');
    assert.ok(res.tier1.includes('i3-1215U') && res.tier1.includes('8GB') && res.tier1.includes('512GB'), 'Tier 1 harus mengandung semua spek');
    assert.ok(res.tier2.includes('ASUS Vivobook 14'), 'Tier 2 harus mengandung brand dan model');
    assert.ok(res.tier3.includes('ASUS laptop'), 'Tier 3 harus mengandung brand dan kategori');
});

// 3. Model Kosong (Fallback)
it('Model kosong harus menggunakan brand + title/kategori pada Tier 3', () => {
    const fp = {
        brand: 'Samsung',
        category: 'ram',
        title: 'Jual RAM SODIMM DDR4 8GB 3200MHz Garansi Resmi',
        keySpecs: ['DDR4', '8GB', '3200MHz']
    };
    const res = buildQueries(fp);
    assert.ok(res.tier3.includes('Samsung ram'), 'Tier 3 harus menggabungkan brand dan kategori');
    assert.ok(!res.tier1.includes('jual'), 'Stop word "jual" harus dibersihkan dari query');
    assert.ok(!res.tier1.includes('garansi'), 'Stop word "garansi" harus dibersihkan');
});

// 4. Negative Terms per Kategori
it('Kategori laptop harus menyertakan negative terms aksesoris (-tas, -charger, dll.)', () => {
    const res = buildQueries({ category: 'laptop', brand: 'Lenovo', model: 'IdeaPad' });
    assert.ok(Array.isArray(res.negatives), 'negatives harus berupa array');
    assert.ok(res.negatives.includes('-tas'));
    assert.ok(res.negatives.includes('-charger'));
    assert.ok(res.negatives.includes('-sleeve'));
});

it('Kategori RAM harus menyertakan negative terms (-caddy, -enclosure, dll.)', () => {
    const res = buildQueries({ category: 'ram', brand: 'Corsair', model: 'Vengeance' });
    assert.ok(res.negatives.includes('-caddy'));
    assert.ok(res.negatives.includes('-enclosure'));
    assert.ok(res.negatives.includes('-baut'));
});

it('Kategori kasur/springbed harus menyertakan negative terms (-angin, -tiup, -cover, dll.)', () => {
    const res = buildQueries({ category: 'kasur', brand: 'Comforta', model: 'Perfect Dream' });
    assert.ok(res.negatives.includes('-angin'));
    assert.ok(res.negatives.includes('-tiup'));
    assert.ok(res.negatives.includes('-cover'));
    assert.ok(res.negatives.includes('-sprei'));
});

it('Kategori smartphone harus menyertakan negative terms (-case, -tempered glass, dll.)', () => {
    const res = buildQueries({ category: 'smartphone', brand: 'Xiaomi', model: 'Redmi Note 13' });
    assert.ok(res.negatives.includes('-case'));
    assert.ok(res.negatives.includes('-tempered glass'));
    assert.ok(res.negatives.includes('-casing'));
});

// 5. Dukungan Berbagai Format keySpecs
it('keySpecs dalam bentuk Array harus diuraikan dengan benar', () => {
    const res = buildQueries({ brand: 'Logitech', model: 'MX Master 3S', keySpecs: ['Wireless', 'Bluetooth'] });
    assert.ok(res.tier1.includes('Wireless Bluetooth'));
});

it('keySpecs dalam bentuk String harus diuraikan dengan benar', () => {
    const res = buildQueries({ brand: 'Sony', model: 'WH-1000XM5', keySpecs: 'ANC Wireless' });
    assert.ok(res.tier1.includes('ANC Wireless'));
});

console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
