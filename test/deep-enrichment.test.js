/**
 * test/deep-enrichment.test.js
 * 
 * Pengujian Unit untuk Deep Enrichment & Smart Fallback (CR-002 / ADR-09):
 * 1. Filter Kandidat: price: null && matchType in ['EXACT', 'EQUIVALENT']
 * 2. Limitasi Sekuensial: Maksimal 3 kandidat, dieksekusi satu per satu (anti tab storm)
 * 3. Properti Tab: Tab dibuka dengan active: false (tersembunyi)
 * 4. Pembaruan Data: Harga & rating terisi dari hasil ekstraksi PDP
 * 5. Jaminan Cleanup: Tab selalu ditutup pada blok finally saat sukses maupun error
 * 6. IPC Listener: Menangani pesan ENRICH_MISSING_DATA
 * 7. Smart Fallback Parser: Ekstraksi harga dari JSON-LD di halaman pencarian
 */

const assert = require('assert');

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

// -----------------------------------------------------------------------------
// Mock Chrome Environment
// -----------------------------------------------------------------------------
function createMockChrome(options = {}) {
    let nextTabId = 100;
    const openTabs = new Map();
    let maxSimultaneousTabs = 0;
    const tabCreationLog = [];
    const removedTabs = [];
    const sessionStorage = new Map();
    let messageListener = null;

    const mockChrome = {
        tabs: {
            create: async (createProps) => {
                const tabId = nextTabId++;
                const tab = { id: tabId, ...createProps, status: 'complete' };
                openTabs.set(tabId, tab);
                tabCreationLog.push({ id: tabId, ...createProps });
                if (openTabs.size > maxSimultaneousTabs) {
                    maxSimultaneousTabs = openTabs.size;
                }
                return tab;
            },
            get: async (tabId) => {
                if (!openTabs.has(tabId)) {
                    throw new Error(`Tab ${tabId} tidak ditemukan`);
                }
                return openTabs.get(tabId);
            },
            remove: async (tabId) => {
                if (openTabs.has(tabId)) {
                    openTabs.delete(tabId);
                    removedTabs.push(tabId);
                }
            },
            onUpdated: {
                addListener: (fn) => { },
                removeListener: (fn) => { }
            },
            onRemoved: {
                addListener: (fn) => { }
            }
        },
        scripting: {
            executeScript: async ({ target, func }) => {
                if (options.shouldThrowInScript) {
                    throw new Error('Script execution failed unexpectedly');
                }
                if (options.customScriptResult) {
                    return [{ result: options.customScriptResult }];
                }
                // Default mock result from PDP extraction
                return [{
                    result: {
                        price: 2799000,
                        rating: 4.9,
                        seller: 'Official Store Flagship'
                    }
                }];
            }
        },
        storage: {
            session: {
                get: async (keys) => {
                    const result = {};
                    for (const k of keys) {
                        result[k] = sessionStorage.get(k);
                    }
                    return result;
                },
                set: async (obj) => {
                    for (const [k, v] of Object.entries(obj)) {
                        sessionStorage.set(k, v);
                    }
                },
                remove: async (keys) => {
                    for (const k of keys) {
                        sessionStorage.delete(k);
                    }
                }
            },
            local: {
                set: async () => { },
                get: async () => ({})
            }
        },
        runtime: {
            onMessage: {
                addListener: (fn) => {
                    messageListener = fn;
                }
            },
            onInstalled: {
                addListener: () => { }
            },
            sendMessage: () => { }
        },
        sidePanel: {
            setPanelBehavior: async () => { }
        }
    };

    return {
        mockChrome,
        getOpenTabs: () => openTabs,
        getMaxSimultaneousTabs: () => maxSimultaneousTabs,
        getTabCreationLog: () => tabCreationLog,
        getRemovedTabs: () => removedTabs,
        getMessageListener: () => messageListener
    };
}

// -----------------------------------------------------------------------------
console.log('=== TEST SUITE 1: FILTER KANDIDAT & BATASAN MAKSIMAL 3 ===');
// -----------------------------------------------------------------------------

async function runTests() {
    await itAsync('enrichMissingData hanya memfilter kandidat dengan price: null atau !imageUrl dan matchType: EXACT / EQUIVALENT', async () => {
        const { mockChrome, getTabCreationLog } = createMockChrome();
        global.chrome = mockChrome;

        const { enrichMissingData } = require('../extension/background/service-worker.js');

        const candidates = [
            { id: 1, title: 'Produk A', price: null, imageUrl: 'https://shopee.co.id/img1.jpg', matchType: 'EXACT', url: 'https://shopee.co.id/item-1' },
            { id: 2, title: 'Produk B', price: 150000, imageUrl: 'https://shopee.co.id/img2.jpg', matchType: 'EXACT', url: 'https://shopee.co.id/item-2' }, // Sudah ada harga & gambar -> skip
            { id: 3, title: 'Produk C', price: null, imageUrl: 'https://shopee.co.id/img3.jpg', matchType: 'ACCESSORY', url: 'https://shopee.co.id/item-3' }, // Bukan EXACT/EQUIVALENT -> skip
            { id: 4, title: 'Produk D', price: null, imageUrl: 'https://tokopedia.com/img4.jpg', matchType: 'EQUIVALENT', url: 'https://tokopedia.com/item-4' }, // Lolos
            { id: 5, title: 'Produk E', price: null, imageUrl: 'https://lazada.co.id/img5.jpg', matchType: 'PARTIAL', url: 'https://lazada.co.id/item-5' }, // Bukan EXACT/EQUIVALENT -> skip
        ];

        const enriched = await enrichMissingData(candidates);

        // Hanya Produk A dan Produk D yang harus di-enrich
        const tabLog = getTabCreationLog();
        assert.strictEqual(tabLog.length, 2, 'Hanya 2 kandidat relevan yang dibuka tab-nya');
        assert.strictEqual(tabLog[0].url, 'https://shopee.co.id/item-1');
        assert.strictEqual(tabLog[1].url, 'https://tokopedia.com/item-4');

        assert.strictEqual(enriched[0].price, 2799000, 'Produk A harus memiliki harga terisi');
        assert.strictEqual(enriched[0].enriched, true, 'Produk A harus berstatus enriched');
        assert.strictEqual(enriched[1].price, 150000, 'Produk B harus mempertahankan harga aslinya');
        assert.strictEqual(enriched[2].price, null, 'Produk C (aksesoris) tidak boleh di-enrich');
        assert.strictEqual(enriched[3].price, 2799000, 'Produk D harus memiliki harga terisi');
    });

    await itAsync('enrichMissingData memicu enrichment jika imageUrl kosong meskipun price sudah terisi (ADR-11)', async () => {
        const { mockChrome, getTabCreationLog } = createMockChrome({
            customScriptResult: { price: 150000, rating: 4.8, seller: 'Toko B', imageUrl: 'https://shopee.co.id/enriched.jpg' }
        });
        global.chrome = mockChrome;

        const { enrichMissingData } = require('../extension/background/service-worker.js');

        const candidates = [
            { id: 1, title: 'Produk Tanpa Gambar', price: 150000, imageUrl: null, matchType: 'EXACT', url: 'https://shopee.co.id/item-no-img' },
            { id: 2, title: 'Produk Lengkap', price: 200000, imageUrl: 'https://shopee.co.id/complete.jpg', matchType: 'EXACT', url: 'https://shopee.co.id/item-complete' }
        ];

        const enriched = await enrichMissingData(candidates);
        const tabLog = getTabCreationLog();
        assert.strictEqual(tabLog.length, 1, 'Hanya kandidat tanpa imageUrl yang dibuka');
        assert.strictEqual(enriched[0].imageUrl, 'https://shopee.co.id/enriched.jpg');
        assert.strictEqual(enriched[0].enriched, true);
    });

    await itAsync('enrichMissingData membatasi maksimal 3 kandidat per pemanggilan pencarian', async () => {
        const { mockChrome, getTabCreationLog } = createMockChrome();
        global.chrome = mockChrome;

        const { enrichMissingData } = require('../extension/background/service-worker.js');

        // 5 kandidat eligible
        const candidates = [
            { id: 1, title: 'Produk 1', price: null, matchType: 'EXACT', url: 'https://blibli.com/p/item-1' },
            { id: 2, title: 'Produk 2', price: null, matchType: 'EQUIVALENT', url: 'https://blibli.com/p/item-2' },
            { id: 3, title: 'Produk 3', price: null, matchType: 'EXACT', url: 'https://blibli.com/p/item-3' },
            { id: 4, title: 'Produk 4', price: null, matchType: 'EQUIVALENT', url: 'https://blibli.com/p/item-4' },
            { id: 5, title: 'Produk 5', price: null, matchType: 'EXACT', url: 'https://blibli.com/p/item-5' }
        ];

        const enriched = await enrichMissingData(candidates);

        const tabLog = getTabCreationLog();
        assert.strictEqual(tabLog.length, 3, 'Maksimal 3 tab yang boleh dibuat');
        assert.strictEqual(enriched[0].price, 2799000);
        assert.strictEqual(enriched[1].price, 2799000);
        assert.strictEqual(enriched[2].price, 2799000);
        assert.strictEqual(enriched[3].price, null, 'Kandidat ke-4 tidak boleh dibuka tab-nya');
        assert.strictEqual(enriched[4].price, null, 'Kandidat ke-5 tidak boleh dibuka tab-nya');
    });

    console.log('\n=== TEST SUITE 2: SEKUENSIAL, ACTIVE: FALSE, DAN CLEANUP FINALLY ===');

    await itAsync('enrichMissingData membuka tab dengan active: false dan dieksekusi secara sekuensial', async () => {
        const { mockChrome, getTabCreationLog, getMaxSimultaneousTabs } = createMockChrome();
        global.chrome = mockChrome;

        const { enrichMissingData } = require('../extension/background/service-worker.js');

        const candidates = [
            { id: 1, title: 'Produk 1', price: null, matchType: 'EXACT', url: 'https://lazada.co.id/item-1' },
            { id: 2, title: 'Produk 2', price: null, matchType: 'EXACT', url: 'https://lazada.co.id/item-2' },
            { id: 3, title: 'Produk 3', price: null, matchType: 'EXACT', url: 'https://lazada.co.id/item-3' }
        ];

        await enrichMissingData(candidates);

        const tabLog = getTabCreationLog();
        assert.strictEqual(tabLog.length, 3);
        // Pastikan seluruh tab dibuat dengan active: false
        for (const t of tabLog) {
            assert.strictEqual(t.active, false, 'Tab enrichment wajib active: false');
        }

        // Pastikan maksimal tab aktif secara bersamaan adalah 1 (sekuensial murni)
        assert.strictEqual(getMaxSimultaneousTabs(), 1, 'Tab enrichment wajib dibuka satu per satu (sekuensial)');
    });

    await itAsync('Tab enrichment WAJIB ditutup pada blok finally saat terjadi error script injection', async () => {
        const { mockChrome, getOpenTabs, getRemovedTabs } = createMockChrome({ shouldThrowInScript: true });
        global.chrome = mockChrome;

        const { enrichMissingData } = require('../extension/background/service-worker.js');

        const candidates = [
            { id: 1, title: 'Produk Error', price: null, matchType: 'EXACT', url: 'https://shopee.co.id/error-item' }
        ];

        // Harus tidak melempar uncaught error yang mematikan worker
        const enriched = await enrichMissingData(candidates);

        assert.strictEqual(enriched[0].price, null, 'Harga tetap null jika script error');
        // Pastikan tab tetap ditutup meskipun ada error
        assert.strictEqual(getOpenTabs().size, 0, 'Tidak boleh ada tab tertinggal (orphan tab)');
        assert.strictEqual(getRemovedTabs().length, 1, 'chrome.tabs.remove harus dipanggil');
    });

    console.log('\n=== TEST SUITE 3: IPC MESSAGE HANDLER ===');

    await itAsync('Listener chrome.runtime.onMessage menangani aksi ENRICH_MISSING_DATA', async () => {
        const { mockChrome, getMessageListener } = createMockChrome();
        global.chrome = mockChrome;

        // Re-require agar listener terdaftar di mockChrome
        delete require.cache[require.resolve('../extension/background/service-worker.js')];
        require('../extension/background/service-worker.js');

        const listener = getMessageListener();
        assert.ok(typeof listener === 'function', 'Listener onMessage harus terdaftar');

        const candidates = [
            { id: 1, title: 'Produk IPC', price: null, matchType: 'EXACT', url: 'https://tokopedia.com/item-ipc' }
        ];

        const response = await new Promise((resolve) => {
            listener({ action: 'ENRICH_MISSING_DATA', candidates }, null, resolve);
        });

        assert.strictEqual(response.status, 'OK');
        assert.strictEqual(response.success, true);
        assert.strictEqual(response.candidates[0].price, 2799000);
        assert.strictEqual(response.candidates[0].enriched, true);
    });

    console.log('\n=== TEST SUITE 4: SMART FALLBACK DI NATIVE SEARCH PARSER ===');

    it('extractCard mengambil harga dari script application/ld+json jika harga di elemen kartu kosong', () => {
        const { extractCard } = require('../extension/content/native-search-parser.js');

        const manifest = {
            id: 'tokopedia',
            cardSelector: '.card-item',
            pdpPattern: 'tokopedia\\.com\\/',
            fields: {
                link: { selector: 'a.prod-link' },
                title: { selector: '.prod-title' },
                price: { selector: '.non-existent-price-class' } // Selektor salah / tidak ada harga di DOM kartu
            }
        };

        const mockCard = {
            querySelector: (sel) => {
                if (sel === 'a.prod-link') {
                    return { getAttribute: () => 'https://www.tokopedia.com/shop/product-123' };
                }
                if (sel === '.prod-title') {
                    return { innerText: 'Smartphone Flagship 8GB 256GB' };
                }
                return null;
            },
            innerText: 'Smartphone Flagship 8GB 256GB\nDeskripsi produk',
            getAttribute: () => null
        };

        // Mock document yang memiliki script application/ld+json berisi ItemList
        global.document = {
            querySelectorAll: (sel) => {
                if (sel === 'script[type="application/ld+json"]') {
                    return [{
                        textContent: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "ItemList",
                            "itemListElement": [
                                {
                                    "@type": "Product",
                                    "name": "Smartphone Flagship 8GB 256GB",
                                    "url": "https://www.tokopedia.com/shop/product-123",
                                    "offers": {
                                        "@type": "Offer",
                                        "price": "4999000",
                                        "priceCurrency": "IDR"
                                    }
                                }
                            ]
                        })
                    }];
                }
                return [];
            }
        };

        const extracted = extractCard(mockCard, manifest);

        assert.ok(extracted, 'Kartu harus berhasil diekstrak');
        assert.strictEqual(extracted.title, 'Smartphone Flagship 8GB 256GB');
        assert.strictEqual(extracted.price, 4999000, 'Harga harus berhasil diekstrak dari JSON-LD smart fallback');
        assert.strictEqual(extracted.url, 'https://www.tokopedia.com/shop/product-123');
    });

    console.log(`\n========================================`);
    console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN DEEP ENRICHMENT BERHASIL.`);
    console.log(`========================================\n`);

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runTests();
