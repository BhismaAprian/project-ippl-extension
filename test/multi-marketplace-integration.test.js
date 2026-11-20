/**
 * test/multi-marketplace-integration.test.js
 * 
 * Pengujian integrasi multi-marketplace (CR-001):
 * - Registrasi 4 provider native (Shopee, Tokopedia, Lazada, Blibli) dan Exa Fallback.
 * - Eksekusi pencarian serentak / berurutan pada ProviderRegistry.
 * - Normalisasi seluruh output menjadi NormalizedCandidate (Unified Schema).
 * - Verifikasi ketahanan graceful fallback saat provider tertentu BLOCKED.
 */

const assert = require('assert');
const { ProviderRegistry } = require('../extension/shared/provider-registry.js');
const { ShopeeNativeProvider } = require('../extension/shared/providers/shopee-native-provider.js');
const { TokopediaNativeProvider } = require('../extension/shared/providers/tokopedia-native-provider.js');
const { LazadaNativeProvider } = require('../extension/shared/providers/lazada-native-provider.js');
const { BlibliNativeProvider } = require('../extension/shared/providers/blibli-native-provider.js');
const { ExaProvider } = require('../extension/shared/providers/exa-provider.js');
const { normalizeCandidate } = require('../extension/shared/candidate-normalizer.js');

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
    console.log('=== TEST SUITE: MULTI-MARKETPLACE INTEGRATION (CR-001) ===');

    // 1. Registrasi 4 Provider Native + Exa Fallback
    it('ProviderRegistry harus berhasil memuat dan mengurutkan 4 native provider (P3) dan Exa (P5)', () => {
        const registry = new ProviderRegistry();
        registry.registerProvider(new ShopeeNativeProvider());
        registry.registerProvider(new TokopediaNativeProvider());
        registry.registerProvider(new LazadaNativeProvider());
        registry.registerProvider(new BlibliNativeProvider());
        registry.registerProvider(new ExaProvider({ apiKey: 'test-key' }));

        const sorted = registry.getProvidersByPriority();
        assert.strictEqual(sorted.length, 5);

        // Keempat native provider harus berada di prioritas 3
        const nativeProviders = sorted.filter(p => p.getPriority() === 3);
        assert.strictEqual(nativeProviders.length, 4);
        assert.strictEqual(sorted[4].getPriority(), 5); // Exa di prioritas 5
    });

    // 2. Eksekusi Pencarian Multi-Platform & Normalisasi Seragam
    await itAsync('Pencarian lintas 4 provider harus menghasilkan NormalizedCandidate seragam', async () => {
        const mockResults = {
            shopee: [{ title: 'Asus Vivobook Shopee', price: 'Rp 8.499.000', url: 'https://shopee.co.id/item-i.1.2' }],
            tokopedia: [{ title: 'Asus Vivobook Tokopedia', price: '8450000', url: 'https://www.tokopedia.com/toko/item-1' }],
            lazada: [{ title: 'Asus Vivobook Lazada', price: 'Rp 8.500.000', url: 'https://www.lazada.co.id/products/item-i1-s2.html' }],
            blibli: [{ title: 'Asus Vivobook Blibli', price: 'Rp 8.400.000', url: 'https://www.blibli.com/p/item/ps--123' }]
        };

        const registry = new ProviderRegistry();
        registry.registerProvider(new ShopeeNativeProvider(null, { protocolInstance: { search: async () => mockResults.shopee } }));
        registry.registerProvider(new TokopediaNativeProvider(null, { protocolInstance: { search: async () => mockResults.tokopedia } }));
        registry.registerProvider(new LazadaNativeProvider(null, { protocolInstance: { search: async () => mockResults.lazada } }));
        registry.registerProvider(new BlibliNativeProvider(null, { protocolInstance: { search: async () => mockResults.blibli } }));

        const available = await registry.getAvailableProviders();
        assert.strictEqual(available.length, 4);

        const allCandidates = [];
        for (const prov of available) {
            const rawItems = await prov.search('asus vivobook');
            for (const item of rawItems) {
                const norm = normalizeCandidate(item, prov.getName().replace('-native', ''), prov.getProvenance());
                if (norm) allCandidates.push(norm);
            }
        }

        assert.strictEqual(allCandidates.length, 4);
        const sources = allCandidates.map(c => c.source);
        assert.ok(sources.includes('shopee'));
        assert.ok(sources.includes('tokopedia'));
        assert.ok(sources.includes('lazada'));
        assert.ok(sources.includes('blibli'));

        for (const c of allCandidates) {
            assert.strictEqual(typeof c.price, 'number');
            assert.strictEqual(c.provenance, 'native-assisted');
            assert.ok(c.observedAt !== null);
        }
    });

    // 3. Graceful Fallback saat Provider Tertentu Mengalami BLOCKED
    await itAsync('Sistem harus tetap mengumpulkan kandidat dari provider lain jika satu provider BLOCKED', async () => {
        const registry = new ProviderRegistry();
        // Tokopedia diblokir CAPTCHA
        const blockedTokped = {
            search: async () => {
                const err = new Error('CAPTCHA terdeteksi');
                err.status = 'BLOCKED';
                throw err;
            }
        };
        const okShopee = {
            search: async () => [{ title: 'Shopee Candidate', price: 'Rp 1.000.000', url: 'https://shopee.co.id/item-i.10.20' }]
        };

        registry.registerProvider(new TokopediaNativeProvider(null, { protocolInstance: blockedTokped }));
        registry.registerProvider(new ShopeeNativeProvider(null, { protocolInstance: okShopee }));

        const providers = registry.getProvidersByPriority();
        const collected = [];

        for (const prov of providers) {
            try {
                const items = await prov.search('query');
                collected.push(...items);
            } catch (err) {
                // Tangani kegagalan parsial tanpa menggagalkan flow utama (NFR-05)
                assert.strictEqual(err.status, 'BLOCKED');
            }
        }

        assert.strictEqual(collected.length, 1);
        assert.strictEqual(collected[0].title, 'Shopee Candidate');
    });

    // 4. Pencarian Stratified & Scoped Fallback per Marketplace (T4.14 / ADR-12)
    await itAsync('searchStratified harus membagi kuota kandidat dan memicu Scoped Fallback Exa pada marketplace terkendala', async () => {
        const registry = new ProviderRegistry();

        // Native Shopee: 4 kandidat
        const mockShopee = {
            search: async () => [
                { title: 'Shopee 1', price: 100000, url: 'https://shopee.co.id/item-1' },
                { title: 'Shopee 2', price: 100000, url: 'https://shopee.co.id/item-2' },
                { title: 'Shopee 3', price: 100000, url: 'https://shopee.co.id/item-3' },
                { title: 'Shopee 4', price: 100000, url: 'https://shopee.co.id/item-4' }
            ]
        };
        // Native Lazada: BLOCKED (0 kandidat)
        const mockLazada = {
            search: async () => {
                const err = new Error('CAPTCHA');
                err.status = 'BLOCKED';
                throw err;
            }
        };

        registry.registerProvider(new ShopeeNativeProvider(null, { protocolInstance: mockShopee }));
        registry.registerProvider(new LazadaNativeProvider(null, { protocolInstance: mockLazada }));

        // Mock Exa Provider untuk Scoped Fallback
        const scopedCalls = [];
        const mockExa = {
            getName: () => 'exa',
            getPriority: () => 5,
            isAvailable: async () => true,
            search: async (query, options) => {
                scopedCalls.push({ query, includeDomains: options.includeDomains });
                return [
                    { title: 'Lazada Scoped 1', price: 105000, url: 'https://www.lazada.co.id/products/item-10.html' },
                    { title: 'Lazada Scoped 2', price: 106000, url: 'https://www.lazada.co.id/products/item-11.html' }
                ];
            }
        };
        registry.registerProvider(mockExa);

        const results = await registry.searchStratified('laptop asus', {
            targetMarketplaces: ['shopee', 'lazada'],
            minCandidatesPerPlatform: 4
        });

        // Verifikasi hasil terkumpul dari shopee dan lazada
        assert.ok(results.length >= 6);
        const shopeeItems = results.filter(r => r.url.includes('shopee.co.id'));
        const lazadaItems = results.filter(r => r.url.includes('lazada.co.id'));

        assert.strictEqual(shopeeItems.length, 4, 'Shopee harus menyumbang 4 kandidat');
        assert.strictEqual(lazadaItems.length, 2, 'Lazada harus menyumbang 2 kandidat dari Scoped Fallback');

        // Pastikan Scoped Fallback dikunci ke domain lazada.co.id
        assert.strictEqual(scopedCalls.length, 1);
        assert.deepStrictEqual(scopedCalls[0].includeDomains, ['lazada.co.id']);
    });

    // 5. Deduplikasi Kanonikal URL Tracking Parameters (T4.14 / ADR-12)
    it('canonicalizeUrl harus membuang parameter tracking (?spm=, ?src=, ?extParam=) untuk mencegah duplikasi', () => {
        const { canonicalizeUrl } = require('../extension/shared/provider-registry.js');

        const lazadaTracked = 'https://www.lazada.co.id/products/item-1.html?spm=a2o4j.searchlist.list.1&click_id=xyz';
        const lazadaClean = 'https://www.lazada.co.id/products/item-1.html';
        assert.strictEqual(canonicalizeUrl(lazadaTracked), lazadaClean);

        const tokpedTracked = 'https://www.tokopedia.com/toko/produk-1?src=topads&extParam=whid%3D123&utm_source=google';
        const tokpedClean = 'https://www.tokopedia.com/toko/produk-1';
        assert.strictEqual(canonicalizeUrl(tokpedTracked), tokpedClean);
    });

    console.log(`\n========================================`);
    console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN BERHASIL.`);
    console.log(`========================================\n`);

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
