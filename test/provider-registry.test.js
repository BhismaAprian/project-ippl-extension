/**
 * test/provider-registry.test.js
 * 
 * Pengujian unit untuk:
 * - extension/shared/base-search-provider.js
 * - extension/shared/provider-registry.js
 * 
 * Cakupan:
 * 1. BaseSearchProvider melempar error pada method abstract yang belum diimplementasikan.
 * 2. ProviderRegistry.registerProvider menambah provider dan memvalidasi kontrak interface.
 * 3. ProviderRegistry.getProvidersByPriority mengurutkan provider berdasarkan getPriority() (1 s/d 5).
 * 4. ProviderRegistry.getAvailableProviders memfilter hanya provider yang isAvailable() === true.
 * 5. ProviderRegistry.clear mengosongkan registry.
 */

const assert = require('assert');
const { BaseSearchProvider } = require('../extension/shared/base-search-provider.js');
const { ProviderRegistry } = require('../extension/shared/provider-registry.js');

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
    console.log('=== TEST SUITE: BASE PROVIDER & PROVIDER REGISTRY ===');

    // 1. BaseSearchProvider Contract Check
    it('BaseSearchProvider harus melempar error pada semua abstract method yang belum diimplementasikan', async () => {
        const base = new BaseSearchProvider();
        assert.throws(() => base.getName(), /getName\(\) must be implemented/);
        assert.throws(() => base.getProvenance(), /getProvenance\(\) must be implemented/);
        assert.throws(() => base.getPriority(), /getPriority\(\) must be implemented/);
        await assert.rejects(async () => await base.isAvailable(), /isAvailable\(\) must be implemented/);
        await assert.rejects(async () => await base.search('query'), /search\(\) must be implemented/);
    });

    // 2. Mock Provider Builder Helper
    class MockProvider extends BaseSearchProvider {
        constructor(name, priority, isAvailableVal = true) {
            super();
            this._name = name;
            this._priority = priority;
            this._isAvailableVal = isAvailableVal;
        }
        getName() { return this._name; }
        getProvenance() { return 'native-assisted'; }
        getPriority() { return this._priority; }
        async isAvailable() { return this._isAvailableVal; }
        async search(q) { return []; }
    }

    const registry = new ProviderRegistry();

    // 3. registerProvider & getProvider
    it('registerProvider harus mendaftarkan provider dan dapat diambil via getProvider', () => {
        registry.clear();
        const mockShopee = new MockProvider('shopee', 3);
        registry.registerProvider(mockShopee);

        const retrieved = registry.getProvider('shopee');
        assert.strictEqual(retrieved, mockShopee);
        assert.strictEqual(registry.getProvider('SHOPEE'), mockShopee, 'getProvider harus case-insensitive');
    });

    it('registerProvider harus menolak objek yang tidak mengimplementasikan interface BaseSearchProvider', () => {
        assert.throws(() => registry.registerProvider(null), /must implement getName/);
        assert.throws(() => registry.registerProvider({}), /must implement getName/);
        assert.throws(() => registry.registerProvider({ getName: () => 'test' }), /must implement getPriority/);
    });

    // 4. getProvidersByPriority (1 s/d 5)
    it('getProvidersByPriority harus mengurutkan provider secara ascending (1 tertinggi, 5 terendah)', () => {
        registry.clear();
        const pExa = new MockProvider('exa', 5);
        const pNativeShopee = new MockProvider('shopee', 3);
        const pOfficialApi = new MockProvider('official', 1);
        const pScraperApi = new MockProvider('scraper-api', 2);

        // Daftarkan secara acak
        registry.registerProvider(pExa);
        registry.registerProvider(pOfficialApi);
        registry.registerProvider(pNativeShopee);
        registry.registerProvider(pScraperApi);

        const sorted = registry.getProvidersByPriority();
        assert.strictEqual(sorted.length, 4);
        assert.strictEqual(sorted[0].getName(), 'official');    // Priority 1
        assert.strictEqual(sorted[1].getName(), 'scraper-api'); // Priority 2
        assert.strictEqual(sorted[2].getName(), 'shopee');      // Priority 3
        assert.strictEqual(sorted[3].getName(), 'exa');         // Priority 5
    });

    // 5. getAvailableProviders
    await itAsync('getAvailableProviders harus memfilter hanya provider yang isAvailable() === true', async () => {
        registry.clear();
        const pReady = new MockProvider('shopee', 3, true);
        const pBlocked = new MockProvider('tokopedia', 3, false);
        const pExa = new MockProvider('exa', 5, true);

        registry.registerProvider(pReady);
        registry.registerProvider(pBlocked);
        registry.registerProvider(pExa);

        const available = await registry.getAvailableProviders();
        assert.strictEqual(available.length, 2);
        assert.strictEqual(available[0].getName(), 'shopee');
        assert.strictEqual(available[1].getName(), 'exa');
    });

    // 6. clear()
    it('clear() harus mengosongkan seluruh provider terdaftar', () => {
        registry.clear();
        assert.strictEqual(registry.getProvidersByPriority().length, 0);
        assert.strictEqual(registry.getProvider('shopee'), undefined);
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
