/**
 * test/gatekeeper.test.js
 * 
 * Pengujian unit untuk extension/shared/gatekeeper.js & Side Panel Grouping (CR-005):
 * 1. Memastikan kandidat "Sprei Kasur" DITOLAK saat aiData.category adalah "Kasur".
 * 2. Memastikan kandidat aksesoris "Bantal", "Guling", "Bed Cover" DITOLAK saat kategori "Kasur" tanpa kata bonus/gratis.
 * 3. Memastikan kandidat kasur dengan "Gratis/Bonus" Bantal & Guling TETAP LOLOS.
 * 4. Memastikan unit kasur asli (springbed, busa) TETAP LOLOS.
 * 5. Memastikan groupCandidatesBySource mengelompokkan kandidat per marketplace secara tepat.
 */

const assert = require('assert');
const { isCategoryMatch } = require('../extension/shared/gatekeeper.js');
const { groupCandidatesBySource } = require('../extension/sidepanel/sidepanel.js');

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

console.log('=== TEST SUITE: STRICT GATEKEEPER & MARKETPLACE GROUPING (CR-005) ===');

const kasurAiData = { category: 'Kasur' };
const refKasur = { title: 'Kasur Springbed Comforta 160x200', price: 3500000 };

// 1. Penolakan Mutlak Sprei Kasur pada Kategori Kasur
it('Kandidat "Sprei Kasur" HARUS DITOLAK saat aiData.category adalah "Kasur"', () => {
    const candTitle = 'Sprei Kasur No 1 King Size 180x200 Katun Jepang';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 150000);
    assert.strictEqual(match, false, 'Sprei Kasur wajib ditolak saat mencari kasur');
});

it('Kandidat "Sprei Kasur Busa Resleting" HARUS DITOLAK saat aiData.category adalah "Kasur"', () => {
    const candTitle = 'Sprei Kasur Busa Resleting All Size';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 85000);
    assert.strictEqual(match, false, 'Sprei Kasur Busa wajib ditolak');
});

// 2. Penolakan Bantal, Guling, Bed Cover Tanpa Bonus
it('Kandidat murni "Bantal Hotel" HARUS DITOLAK saat kategori "Kasur"', () => {
    const candTitle = 'Bantal Hotel Silicon Hollow Empuk Nyaman';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 65000);
    assert.strictEqual(match, false, 'Bantal hotel murni wajib ditolak');
});

it('Kandidat murni "Guling Microfiber" HARUS DITOLAK saat kategori "Kasur"', () => {
    const candTitle = 'Guling Tidur Microfiber Premium Grade A';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 75000);
    assert.strictEqual(match, false, 'Guling tidur murni wajib ditolak');
});

it('Kandidat murni "Bed Cover Motif" HARUS DITOLAK saat kategori "Kasur"', () => {
    const candTitle = 'Bed Cover Polos King 180x200 Microtex Tebal';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 220000);
    assert.strictEqual(match, false, 'Bed cover polos murni wajib ditolak');
});

// 3. Kelolosan Kasur Asli dengan Bonus/Gratis Bantal & Guling
it('Kandidat kasur dengan bonus bantal HARUS TETAP LOLOS saat kategori "Kasur"', () => {
    const candTitle = 'Kasur Springbed Central Deluxe 160x200 + Gratis 2 Bantal';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 3200000);
    assert.strictEqual(match, true, 'Kasur dengan bonus bantal wajib lolos');
});

it('Kandidat kasur dengan bonus bantal & guling HARUS TETAP LOLOS saat kategori "Kasur"', () => {
    const candTitle = 'Kasur Spring Bed Bigland 160x200 Bonus Bantal Guling';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 3100000);
    assert.strictEqual(match, true, 'Kasur dengan bonus bantal guling wajib lolos');
});

it('Kandidat kasur springbed murni HARUS TETAP LOLOS saat kategori "Kasur"', () => {
    const candTitle = 'Comforta Perfect Choice Kasur Springbed 160x200';
    const match = isCategoryMatch(candTitle, kasurAiData, refKasur, 3600000);
    assert.strictEqual(match, true, 'Kasur springbed murni wajib lolos');
});

// 4. Pengujian groupCandidatesBySource (Marketplace-Sectioned UI)
it('groupCandidatesBySource harus memisahkan produk berdasarkan marketplace dan tab exa', () => {
    const mockCandidates = [
        { title: 'Item Shopee 1', source: 'shopee', provenance: 'native-assisted', price: 100000 },
        { title: 'Item Tokopedia 1', source: 'tokopedia', provenance: 'native-assisted', price: 120000 },
        { title: 'Item Tokopedia 2', source: 'tokopedia', provenance: 'native-assisted', price: 130000 },
        { title: 'Item Lazada 1', source: 'lazada', provenance: 'native-assisted', price: 110000 },
        { title: 'Item Blibli 1', source: 'blibli', provenance: 'native-assisted', price: 115000 },
        { title: 'Item Exa 1', source: 'lazada', provenance: 'exa-fallback', price: 105000 },
        { title: 'Item Exa 2', source: 'exa', provenance: 'exa-fallback', price: 125000 }
    ];

    const grouped = groupCandidatesBySource(mockCandidates);

    assert.strictEqual(grouped.all.length, 7, 'Tab Semua harus memuat semua kandidat');
    assert.strictEqual(grouped.shopee.length, 1, 'Tab Shopee harus memuat 1 item');
    assert.strictEqual(grouped.tokopedia.length, 2, 'Tab Tokopedia harus memuat 2 item');
    assert.strictEqual(grouped.lazada.length, 2, 'Tab Lazada harus memuat item Lazada (native & exa-lazada)');
    assert.strictEqual(grouped.blibli.length, 1, 'Tab Blibli harus memuat 1 item');
    assert.strictEqual(grouped.exa.length, 2, 'Tab Exa harus memuat 2 item (provenance exa-fallback dan source exa)');
});

it('Saat tab Lazada dipilih, hanya kandidat ber-source lazada yang ada di grup lazada', () => {
    const mockCandidates = [
        { title: 'Lazada Kasur', source: 'lazada', price: 2000000 },
        { title: 'Tokped Kasur', source: 'tokopedia', price: 2100000 },
        { title: 'Shopee Kasur', source: 'shopee', price: 2050000 }
    ];

    const grouped = groupCandidatesBySource(mockCandidates);
    assert.strictEqual(grouped.lazada.length, 1);
    assert.strictEqual(grouped.lazada[0].title, 'Lazada Kasur');
    assert.strictEqual(grouped.lazada[0].source, 'lazada');
});

console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
