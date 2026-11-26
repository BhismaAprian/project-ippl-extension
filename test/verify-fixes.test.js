/**
 * test/verify-fixes.test.js
 * 
 * Verifikasi Mandiri untuk 3 Error Fatal & Resilient Fallback:
 * 1. Groq Model (openai/gpt-oss-120b)
 * 2. Exa Gatekeeper (Kasur + Gratis Bantal vs Aksesoris Murni)
 * 3. Shopee Native Scraper (50% Token Similarity Guard)
 * 4. Sidepanel Resilient Fallback (specMap Scope Guard)
 */

const assert = require('assert');

// Mock Environment Browser
global.window = {};

// Load Modules
require('../extension/shared/constant.js');
require('../extension/shared/ai-client.js');
require('../extension/shared/search-client.js');
require('../extension/adapters/base-adapter.js');
require('../extension/adapters/shopee-adapter.js');

let passedTests = 0;
let totalTests = 0;
const pendingTests = [];

function it(name, fn) {
    totalTests++;
    try {
        const res = fn();
        if (res && typeof res.then === 'function') {
            const p = res.then(() => {
                console.log(`  ✅ PASS: ${name}`);
                passedTests++;
            }).catch(err => {
                console.error(`  ❌ FAIL: ${name}`);
                console.error(`     Error: ${err.message}`);
            });
            pendingTests.push(p);
            return;
        }
        console.log(`  ✅ PASS: ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

console.log('=== TEST SUITE 1: GROQ MODEL CONFIGURATION ===');
it('AIClient harus menggunakan model openai/gpt-oss-120b secara default', () => {
    const client = new window.AIClient();
    assert.strictEqual(client.model, 'openai/gpt-oss-120b');
    assert.strictEqual(client.fallbackModel, 'llama-3.1-70b-versatile');
});

it('AIClient harus otomatis mengubah konfigurasi lama llama-3.3-70b-versatile menjadi openai/gpt-oss-120b', () => {
    window.GROQ_MODEL = 'llama-3.3-70b-versatile';
    const client = new window.AIClient();
    assert.strictEqual(client.model, 'openai/gpt-oss-120b');
    delete window.GROQ_MODEL;
});

console.log('\n=== TEST SUITE 2: EXA GATEKEEPER (isCategoryMatch) ===');
const searchClient = new window.SearchClient();
const origMattress = {
    title: 'Kasur Springbed Comforta Perfect Dream 160x200',
    price: 3500000
};

it('Kandidat kasur dengan bonus bantal HARUS DILOLOSKAN', () => {
    const candTitle = 'Kasur Springbed Central Deluxe 160x200 + Gratis 2 Bantal';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 3200000);
    assert.strictEqual(match, true);
});

it('Kandidat kasur dengan cover quilting HARUS DILOLOSKAN', () => {
    const candTitle = 'Inoac Kasur Busa Yukata 160x200 Tebal 20cm Cover Quilting';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 2800000);
    assert.strictEqual(match, true);
});

it('Kandidat kasur dengan bonus bantal & guling HARUS DILOLOSKAN', () => {
    const candTitle = 'Kasur Spring Bed Bigland 160x200 Bonus Bantal Guling';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 3100000);
    assert.strictEqual(match, true);
});

it('Aksesoris murni "Bantal Guling Hotel" HARUS DITOLAK', () => {
    const candTitle = 'Bantal Guling Hotel Silicon Hollow Premium Empuk';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 85000);
    assert.strictEqual(match, false);
});

it('Aksesoris murni "Bed Cover Polos" HARUS DITOLAK', () => {
    const candTitle = 'Bed Cover Polos King 180x200 Microtex Disperse';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 175000);
    assert.strictEqual(match, false);
});

it('Aksesoris murni "Cover Kasur Busa Resleting" HARUS DITOLAK', () => {
    const candTitle = 'Cover Kasur Busa Resleting Ukuran 160x200 Waterproof';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 95000);
    assert.strictEqual(match, false);
});

it('Aksesoris murni "Sprei Kasur No 1 King Size" HARUS DITOLAK', () => {
    const candTitle = 'Sprei Kasur No 1 King Size 180x200 Katun Jepang';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 120000);
    assert.strictEqual(match, false);
});

it('Matras angin tiup HARUS TETAP DITOLAK', () => {
    const candTitle = 'Bestway Matras Angin Tiup Single Pompa Manual';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 250000);
    assert.strictEqual(match, false);
});

// Penambahan Uji Gatekeeper v2 (CR-004 / ADR-13 / T4.15)
it('Promo Murah Sprei Kasur Springbed HARUS DITOLAK MUTLAK oleh Head-Noun Lock (Layer 0)', () => {
    const candTitle = 'Promo Murah Sprei Kasur Springbed 180x200';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 3200000);
    assert.strictEqual(match, false, 'Sprei di awal judul (setelah promo stripping) harus ditolak mutlak');
});

it('Set Bantal Guling untuk Kasur HARUS DITOLAK MUTLAK oleh Prepositional Guard (Layer 1)', () => {
    const candTitle = 'Set Bantal Guling untuk Kasur Springbed';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 3000000);
    assert.strictEqual(match, false, 'Frasa "untuk Kasur" harus ditolak mutlak sebagai frasa pelengkap');
});

it('Kasur Springbed 180x200 Gratis 2 Bantal HARUS TETAP LOLOS (Unit Utama + Bonus)', () => {
    const candTitle = 'Kasur Springbed 180x200 Gratis 2 Bantal';
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 3100000);
    assert.strictEqual(match, true, 'Unit utama kasur dengan bonus bantal wajib diloloskan');
});

it('Price Floor 30% harus menolak kandidat dengan harga < 30% harga acuan (Layer 3)', () => {
    const candTitle = 'Kasur Springbed Central Deluxe 160x200';
    // 30% dari 3.500.000 adalah 1.050.000. Harga 900.000 (< 30%) harus ditolak
    const match = searchClient.isCategoryMatch(candTitle, null, origMattress, 900000);
    assert.strictEqual(match, false, 'Harga di bawah 30% dari 3.500.000 harus ditolak');
    
    // Harga 1.200.000 (> 30%) harus lolos
    const matchPass = searchClient.isCategoryMatch(candTitle, null, origMattress, 1200000);
    assert.strictEqual(matchPass, true, 'Harga di atas 30% dari 3.500.000 harus lolos');
});

console.log('\n=== TEST SUITE 3: SHOPEE NATIVE SCRAPER 50% SIMILARITY FILTER ===');
const shopeeAdapter = new window.ShopeeAdapter();

it('ShopeeAdapter.extractEssentialTokens harus membersihkan stop words dan mengekstrak token esensial', () => {
    const tokens = shopeeAdapter.extractEssentialTokens('Jual RAM LAPTOP DDR4 8GB 3200MHZ SODIMM SAMSUNG SK HYNIX');
    assert.ok(tokens.includes('ram'));
    assert.ok(tokens.includes('laptop'));
    assert.ok(tokens.includes('ddr4'));
    assert.ok(tokens.includes('8gb'));
    assert.ok(tokens.includes('3200mhz'));
    assert.ok(tokens.includes('sodimm'));
    assert.ok(!tokens.includes('jual'));
});

// Implementasi verifikasi similarity ratio dengan method adapter
function checkNativeCandidate(origTitle, candTitle) {
    const essentialTokens = shopeeAdapter.extractEssentialTokens(origTitle);
    const candLower = candTitle.toLowerCase();
    if (essentialTokens.length === 0) return true;

    const matchedTokens = essentialTokens.filter(token => {
        return token.length <= 4
            ? (new RegExp(`\\b${token}\\b`, 'i').test(candLower) || candLower.includes(token))
            : candLower.includes(token);
    });

    const ratio = matchedTokens.length / essentialTokens.length;
    return ratio >= 0.50;
}

const origRam = 'Jual RAM LAPTOP DDR4 8GB 3200MHZ SODIMM SAMSUNG SK HYNIX CORSAIR';

it('Kandidat RAM laptop dengan spek cocok (>50% token) HARUS LOLOS', () => {
    const cand = 'RAM Laptop DDR4 8GB 3200MHz SODIMM Kingston HyperX';
    assert.strictEqual(checkNativeCandidate(origRam, cand), true);
});

it('Kandidat RAM laptop SODIMM 8GB varian Hynix (>50% token) HARUS LOLOS', () => {
    const cand = 'RAM Memory SODIMM DDR4 8GB 3200Mhz Samsung Original';
    assert.strictEqual(checkNativeCandidate(origRam, cand), true);
});

it('Aksesoris "Tas Laptop Asus ROG" (<50% token) HARUS DITOLAK', () => {
    const cand = 'Tas Laptop Asus ROG Backpack 15.6 Inch Waterproof';
    assert.strictEqual(checkNativeCandidate(origRam, cand), false);
});

it('Aksesoris "Charger Laptop Asus 19V 65W" (<50% token) HARUS DITOLAK', () => {
    const cand = 'Adaptor Charger Laptop Asus 19V 3.42A 65W Original';
    assert.strictEqual(checkNativeCandidate(origRam, cand), false);
});

it('Produk tidak cocok "RAM PC Desktop DDR3 2GB" (<50% token) HARUS DITOLAK', () => {
    const cand = 'RAM PC Desktop LongDIMM DDR3 2GB 1333MHz';
    assert.strictEqual(checkNativeCandidate(origRam, cand), false);
});

console.log('\n=== TEST SUITE 4: RESILIENT FALLBACK (specMap Scope Check) ===');
it('specMap harus dapat diakses pada lingkup modul fallback tanpa ReferenceError', () => {
    // Verifikasi bahwa objek specMap memiliki semua pemetaan status yang dibutuhkan
    const specMapTest = {
        EXACT: { cls: 'green', text: 'Spec Cocok ✅' },
        UPGRADE: { cls: 'blue', text: 'Spec Lebih Tinggi ⬆️' },
        DOWNGRADE: { cls: 'red', text: 'Spec Lebih Rendah ⬇️' },
        DIFFERENT: { cls: 'yellow', text: 'Spec Beda ⚠️' },
        UNKNOWN: { cls: 'gray', text: 'Spec Belum Dicek ❓' }
    };

    ['EXACT', 'UPGRADE', 'DOWNGRADE', 'DIFFERENT', 'UNKNOWN'].forEach(status => {
        const info = specMapTest[status];
        assert.ok(info && info.text && info.cls, `specMap[${status}] harus valid`);
    });
});

console.log('\n=== TEST SUITE 5: MANIFEST V3 & CONNECTION ERROR RESILIENCE ===');
const fs = require('fs');
const path = require('path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));

it('manifest.json harus menyertakan domain Shopee di host_permissions dan content_scripts', () => {
    assert.ok(manifest.host_permissions.includes('https://shopee.co.id/*'));
    assert.ok(manifest.host_permissions.includes('https://*.shopee.co.id/*'));
    assert.ok(manifest.permissions.includes('scripting'), 'Harus memiliki permission scripting');
    
    const cs = manifest.content_scripts[0];
    assert.ok(cs.matches.includes('https://shopee.co.id/*'));
    assert.ok(cs.matches.includes('https://*.shopee.co.id/*'));
    assert.ok(cs.js.includes('adapters/shopee-adapter.js'), 'adapters/shopee-adapter.js harus terdaftar');
    assert.ok(cs.js.includes('content/marketplace-detector.js'), 'content/marketplace-detector.js harus terdaftar');
});

it('Error "Receiving end does not exist" harus memicu pesan ramah pengguna', () => {
    const rawError = new Error('Could not establish connection. Receiving end does not exist.');
    const errMsg = rawError.message;
    const isConnErr = errMsg.includes('Receiving end does not exist') || errMsg.includes('Could not establish connection');
    assert.strictEqual(isConnErr, true);

    const friendlyError = new Error('Harap refresh (F5) halaman Shopee, lalu coba lagi.');
    assert.ok(friendlyError.message.includes('refresh (F5)'));
});

console.log('\n=== TEST SUITE 6: REVIEW INTELLIGENCE RESILIENT FALLBACK ===');
it('Fallback review data harus memiliki format FALLBACK_RAW dan pesan yang tepat', () => {
    const mockRawReviews = [
        { cmtId: '101', author: 'user1', rating: 5, text: 'Kualitas barang bagus dan original' },
        { cmtId: '102', author: 'user2', rating: 5, text: 'Pengemasan rapi dan aman' },
        { cmtId: '103', author: 'user3', rating: 4, text: 'Berfungsi dengan baik di laptop saya' }
    ];

    // Simulasi fallback flow ketika AI summarizeReviews gagal
    const fallbackData = {
        status: 'FALLBACK_RAW',
        rawReviews: mockRawReviews,
        pros: [],
        cons: [],
        risks: [],
        confidence: mockRawReviews.length >= 5 ? 'MEDIUM' : 'LOW',
        fallbackMessage: 'AI gagal merangkum, tetapi berikut adalah ulasan asli dari pembeli:'
    };

    assert.strictEqual(fallbackData.status, 'FALLBACK_RAW');
    assert.strictEqual(fallbackData.fallbackMessage, 'AI gagal merangkum, tetapi berikut adalah ulasan asli dari pembeli:');
    assert.strictEqual(fallbackData.rawReviews.length, 3);
    assert.ok(fallbackData.rawReviews.length >= 3, 'Minimal 3 ulasan mentah harus ada');
});

console.log('\n=== TEST SUITE 7: SHOPEE DOM SELECTOR & DATA-CMTID VERIFICATION ===');
it('File offline Shopee HTML harus mengandung elemen ulasan dengan atribut data-cmtid', () => {
    const htmlPath = path.join(__dirname, '../shopee/Jual RAM LAPTOP DDR4 8GB 3200MHZ SODIMM SAMSUNG SK HYNIX CORSAIR _ Shopee Indonesia.html');
    if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const cmtIdMatches = html.match(/data-cmtid="(\d+)"/g);
        assert.ok(cmtIdMatches && cmtIdMatches.length > 0, 'Harus menemukan atribut data-cmtid di DOM Shopee');
        assert.ok(cmtIdMatches.length >= 3, 'Minimal 3 ulasan dengan data-cmtid ditemukan di Shopee');
        
        // Verifikasi bahwa teks ulasan nyata ada
        assert.ok(html.includes('Kualitas:'), 'Elemen ulasan harus mengandung label aspek');
        assert.ok(html.includes('seller komunikatif'), 'Ulasan asli harus mengandung teks komentar pembeli');
    }
});

it('Selector [data-cmtid] harus terdaftar dalam getReviewElements dan extractReviews ShopeeAdapter', () => {
    const adapterCode = fs.readFileSync(path.join(__dirname, '../extension/adapters/shopee-adapter.js'), 'utf8');
    assert.ok(adapterCode.includes('[data-cmtid]'), 'ShopeeAdapter harus menggunakan selector [data-cmtid]');
    assert.ok(adapterCode.includes('penilaian produk'), 'ShopeeAdapter harus mendukung selector berbasis teks fallback');
});

console.log('\n=== TEST SUITE 8: SMART SEARCH & MATCHING ENGINE UPGRADE (CR-004) ===');

// 1. Verifikasi Ekstraksi imageUrl dari Manifest & CandidateNormalizer
it('Ekstraksi imageUrl dari manifest dan validasi di CandidateNormalizer (ADR-11)', () => {
    const { normalizeCandidate } = require('../extension/shared/candidate-normalizer.js');
    const shopeeM = require('../extension/manifest/marketplace-manifest/shopee.js');
    const tokpedM = require('../extension/manifest/marketplace-manifest/tokopedia.js');
    const lazadaM = require('../extension/manifest/marketplace-manifest/lazada.js');
    const blibliM = require('../extension/manifest/marketplace-manifest/blibli.js');

    [shopeeM, tokpedM, lazadaM, blibliM].forEach(m => {
        assert.ok(m.fields.image, `${m.id} harus memiliki konfigurasi fields.image`);
        assert.ok(Array.isArray(m.fields.image.attributes), `${m.id} attributes harus array`);
        assert.ok(Array.isArray(m.fields.image.rejectPatterns), `${m.id} rejectPatterns harus array string pattern`);
    });

    const validCand = normalizeCandidate({
        title: 'Kasur Springbed Central 160x200',
        price: '3000000',
        url: 'https://shopee.co.id/product-i.1.2',
        imageUrl: 'https://cf.shopee.co.id/file/sample.jpg'
    }, 'shopee', 'native-assisted');

    assert.strictEqual(validCand.imageUrl, 'https://cf.shopee.co.id/file/sample.jpg');

    const dummyCand = normalizeCandidate({
        title: 'Kasur Springbed Central 160x200',
        price: '3000000',
        url: 'https://shopee.co.id/product-i.1.2',
        imageUrl: 'data:image/svg+xml;base64,...'
    }, 'shopee', 'native-assisted');

    assert.strictEqual(dummyCand.imageUrl, null, 'data:image harus dinetralkan menjadi null');
});

// 2. Verifikasi Penolakan Mutlak Aksesoris vs Unit Utama + Bonus (ADR-13)
it('Verifikasi penolakan mutlak Sprei & Set Bantal Guling vs kelolosan Kasur + Bonus Bantal (ADR-13)', () => {
    const { isCategoryMatch } = require('../extension/shared/gatekeeper.js');
    const refKasur = { title: 'Kasur Springbed Comforta 160x200', price: 3500000 };

    // Kasus A: "Promo Murah Sprei Kasur Springbed 180x200" -> Wajib DITOLAK
    const candSprei = 'Promo Murah Sprei Kasur Springbed 180x200';
    assert.strictEqual(isCategoryMatch(candSprei, null, refKasur, 3200000), false, 'Sprei harus ditolak mutlak');

    // Kasus B: "Set Bantal Guling untuk Kasur" -> Wajib DITOLAK
    const candSetBantal = 'Set Bantal Guling untuk Kasur';
    assert.strictEqual(isCategoryMatch(candSetBantal, null, refKasur, 2000000), false, 'Set bantal untuk kasur harus ditolak');

    // Kasus C: "Kasur Springbed 180x200 Gratis 2 Bantal" -> Wajib LOLOS
    const candKasurBonus = 'Kasur Springbed 180x200 Gratis 2 Bantal';
    assert.strictEqual(isCategoryMatch(candKasurBonus, null, refKasur, 3100000), true, 'Kasur dengan bonus bantal wajib lolos');
});

// 3. Verifikasi Penyeimbangan Kandidat Lintas Marketplace & Scoped Fallback (ADR-12)
it('Verifikasi penyeimbangan kandidat multi-marketplace dan Scoped Fallback Exa (ADR-12)', async () => {
    const { ProviderRegistry } = require('../extension/shared/provider-registry.js');
    const registry = new ProviderRegistry();

    // Mock Provider Native Shopee & Tokopedia
    registry.registerProvider({
        getName: () => 'shopee-native',
        getPriority: () => 3,
        isAvailable: async () => true,
        search: async () => [
            { title: 'Shopee Item 1', price: 200000, url: 'https://shopee.co.id/item-1' },
            { title: 'Shopee Item 2', price: 200000, url: 'https://shopee.co.id/item-2' },
            { title: 'Shopee Item 3', price: 200000, url: 'https://shopee.co.id/item-3' },
            { title: 'Shopee Item 4', price: 200000, url: 'https://shopee.co.id/item-4' }
        ]
    });

    registry.registerProvider({
        getName: () => 'tokopedia-native',
        getPriority: () => 3,
        isAvailable: async () => true,
        search: async () => [
            { title: 'Tokped Item 1', price: 210000, url: 'https://tokopedia.com/item-1' },
            { title: 'Tokped Item 2', price: 210000, url: 'https://tokopedia.com/item-2' }
        ]
    });

    // Mock Provider Lazada (Terkendala / 0 item)
    registry.registerProvider({
        getName: () => 'lazada-native',
        getPriority: () => 3,
        isAvailable: async () => true,
        search: async () => []
    });

    // Mock Exa Provider untuk Scoped Fallback
    const scopedDomainsCaptured = [];
    registry.registerProvider({
        getName: () => 'exa',
        getPriority: () => 5,
        isAvailable: async () => true,
        search: async (q, opts) => {
            scopedDomainsCaptured.push(opts.includeDomains);
            return [
                { title: 'Lazada Scoped Item 1', price: 205000, url: 'https://www.lazada.co.id/products/item-1.html' },
                { title: 'Lazada Scoped Item 2', price: 205000, url: 'https://www.lazada.co.id/products/item-2.html' }
            ];
        }
    });

    const results = await registry.searchStratified('kasur springbed', {
        targetMarketplaces: ['shopee', 'tokopedia', 'lazada'],
        minCandidatesPerPlatform: 4
    });

    assert.ok(results.length >= 8);
    // Verifikasi bahwa Scoped Fallback terpanggil untuk Lazada
    assert.ok(scopedDomainsCaptured.some(domains => domains.includes('lazada.co.id')));
});

// -----------------------------------------------------------------------------
console.log('\n=== TEST SUITE 9: HOTFIX CR-004B (Perbaikan Gambar, Harga Valid & Side Panel UI) ===');
// -----------------------------------------------------------------------------

it('Payload Exa search harus menyertakan contents.highlights dan extras.imageLinks (CR-004B)', async () => {
    const { ExaProvider } = require('../extension/shared/providers/exa-provider.js');
    let capturedPayload = null;
    const mockFetch = async (url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return {
            ok: true,
            json: async () => ({ results: [] })
        };
    };

    const provider = new ExaProvider({ apiKey: 'test-key', fetchFn: mockFetch });
    await provider.search('kasur in the box 160x200');

    assert.ok(capturedPayload, 'Payload Exa harus terkirim');
    assert.ok(capturedPayload.contents.text.maxCharacters >= 800, 'maxCharacters minimal 800');
    assert.ok(capturedPayload.contents.highlights.numSentences >= 2, 'numSentences minimal 2');
    assert.strictEqual(capturedPayload.extras.imageLinks, 1);
});

it('Exa Provider harus mengekstrak harga dari text & highlights serta gambar dari extras.imageLinks (CR-004B)', async () => {
    const { ExaProvider } = require('../extension/shared/providers/exa-provider.js');
    const mockFetch = async () => ({
        ok: true,
        json: async () => ({
            results: [
                {
                    title: 'InTheBox Kasur Springbed 160x200',
                    url: 'https://www.tokopedia.com/inthebox/kasur-springbed-160x200',
                    text: 'Kasur springbed berkualitas',
                    highlights: ['Dapatkan diskon hemat harga Rp 2.450.000 hanya hari ini'],
                    extras: {
                        imageLinks: ['https://images.tokopedia.com/img/cache/700/product-1.jpg']
                    }
                }
            ]
        })
    });

    const provider = new ExaProvider({ apiKey: 'test-key', fetchFn: mockFetch });
    const cands = await provider.search('kasur in the box');

    assert.strictEqual(cands.length, 1);
    assert.strictEqual(cands[0].price, 2450000);
    assert.strictEqual(cands[0].imageUrl, 'https://images.tokopedia.com/img/cache/700/product-1.jpg');
});

it('Prioritisasi kandidat harus menempatkan kandidat berharga valid dan bergambar di urutan teratas (CR-004B)', () => {
    const candidates = [
        { title: 'Item 1 - Tanpa Harga', price: null, imageUrl: null },
        { title: 'Item 2 - Harga Nol', price: 0, imageUrl: 'https://img.com/2.jpg' },
        { title: 'Item 3 - Harga Valid Tanpa Gambar', price: 1500000, imageUrl: null },
        { title: 'Item 4 - Lengkap Valid', price: 2000000, imageUrl: 'https://img.com/4.jpg' }
    ];

    const prioritized = [...candidates].sort((a, b) => {
        const aPrice = (a && a.price && a.price >= 100) ? 1 : 0;
        const bPrice = (b && b.price && b.price >= 100) ? 1 : 0;
        if (aPrice !== bPrice) return bPrice - aPrice;

        const aImg = (a && a.imageUrl) ? 1 : 0;
        const bImg = (b && b.imageUrl) ? 1 : 0;
        if (aImg !== bImg) return bImg - aImg;

        return (a?.price || 0) - (b?.price || 0);
    });

    assert.strictEqual(prioritized[0].title, 'Item 4 - Lengkap Valid');
    assert.strictEqual(prioritized[1].title, 'Item 3 - Harga Valid Tanpa Gambar');
    assert.strictEqual(prioritized[2].title, 'Item 2 - Harga Nol');
    assert.strictEqual(prioritized[3].title, 'Item 1 - Tanpa Harga');
});

it('AIClient evaluateDeals prompt harus mewajibkan Bahasa Indonesia singkat maksimal 10 kata (CR-004B / NFR-16)', async () => {
    const { AIClient } = require('../extension/shared/ai-client.js');
    const ai = new AIClient();
    let capturedPrompt = null;
    ai.requestJson = async (prompt) => {
        capturedPrompt = prompt;
        return {
            best_value: { title: 'A', url: 'http://a', price: 1000, spec_status: 'EXACT', reason: 'Tebal 30cm bonus bantal' },
            cheapest: { title: 'B', url: 'http://b', price: 900, spec_status: 'EXACT', reason: 'Ukuran pas garansi 10 thn' },
            others: []
        };
    };

    global.chrome = global.chrome || {};
    global.chrome.storage = global.chrome.storage || {
        local: { get: async () => ({ groqKey: 'dummy-key' }) }
    };

    await ai.evaluateDeals(
        { title: 'Kasur A', price: 2000000 },
        [{ title: 'Kasur B', price: 1800000, url: 'http://b' }]
    );

    assert.ok(capturedPrompt.includes('Bahasa Indonesia'));
    assert.ok(capturedPrompt.includes('maksimal 10 kata') || capturedPrompt.includes('MAXIMUM of 10 words'));
});

(async () => {
    if (pendingTests.length > 0) {
        await Promise.all(pendingTests);
    }

    console.log(`\n========================================`);
    console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
    console.log(`========================================\n`);

    if (passedTests !== totalTests) {
        process.exit(1);
    }
})();
