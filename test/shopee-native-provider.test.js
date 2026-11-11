/**
 * test/shopee-native-provider.test.js
 * 
 * Pengujian unit untuk extension/shared/providers/shopee-native-provider.js:
 * 1. Kontrak provider terpenuhi (name, provenance, priority, isAvailable).
 * 2. Delegasi search() ke NativeSearchProtocol.
 */

const assert = require('assert');
const { ShopeeNativeProvider } = require('../extension/shared/providers/shopee-native-provider.js');
const shopeeManifest = require('../extension/manifest/marketplace-manifest/shopee.js');

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
    console.log('=== TEST SUITE: SHOPEE NATIVE PROVIDER ===');

    it('Kontrak ShopeeNativeProvider harus terpenuhi (name: shopee-native, provenance: native-assisted, priority: 3)', () => {
        const provider = new ShopeeNativeProvider(shopeeManifest);
        assert.strictEqual(provider.getName(), 'shopee-native');
        assert.strictEqual(provider.getProvenance(), 'native-assisted');
        assert.strictEqual(provider.getPriority(), 3);
    });

    await itAsync('isAvailable() harus mengembalikan true', async () => {
        const provider = new ShopeeNativeProvider(shopeeManifest);
        assert.strictEqual(await provider.isAvailable(), true);
    });

    await itAsync('search() harus mendelegasikan pemanggilan ke NativeSearchProtocol', async () => {
        let protocolCalled = false;
        let queryPassed = null;

        const mockProtocol = {
            search: async (q, opts) => {
                protocolCalled = true;
                queryPassed = q;
                return [{
                    title: 'Laptop Asus Test',
                    price: 8000000,
                    source: 'shopee',
                    provenance: 'native-assisted'
                }];
            }
        };

        const provider = new ShopeeNativeProvider(shopeeManifest, { protocolInstance: mockProtocol });
        const results = await provider.search('Asus Vivobook');

        assert.strictEqual(protocolCalled, true, 'Protocol harus dipanggil');
        assert.strictEqual(queryPassed, 'Asus Vivobook');
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].title, 'Laptop Asus Test');
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
