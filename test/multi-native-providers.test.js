/**
 * test/multi-native-providers.test.js
 * 
 * Pengujian unit untuk native search providers baru (CR-001):
 * - TokopediaNativeProvider (extension/shared/providers/tokopedia-native-provider.js)
 * - LazadaNativeProvider (extension/shared/providers/lazada-native-provider.js)
 * - BlibliNativeProvider (extension/shared/providers/blibli-native-provider.js)
 */

const assert = require('assert');
const { TokopediaNativeProvider } = require('../extension/shared/providers/tokopedia-native-provider.js');
const { LazadaNativeProvider } = require('../extension/shared/providers/lazada-native-provider.js');
const { BlibliNativeProvider } = require('../extension/shared/providers/blibli-native-provider.js');

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
    console.log('=== TEST SUITE: MULTI NATIVE PROVIDERS (CR-001) ===');

    // 1. TOKOPEDIA NATIVE PROVIDER
    it('TokopediaNativeProvider harus memenuhi kontrak BaseSearchProvider (Priority 3)', () => {
        const provider = new TokopediaNativeProvider();
        assert.strictEqual(provider.getName(), 'tokopedia-native');
        assert.strictEqual(provider.getProvenance(), 'native-assisted');
        assert.strictEqual(provider.getPriority(), 3);
    });

    await itAsync('TokopediaNativeProvider.isAvailable() harus return true dan mendelegasikan search', async () => {
        let protocolCalledWith = null;
        const mockProtocol = {
            search: async (q, opt) => {
                protocolCalledWith = q;
                return [{ title: 'Asus Vivobook', price: 5000000, source: 'tokopedia' }];
            }
        };

        const provider = new TokopediaNativeProvider(null, { protocolInstance: mockProtocol });
        const isAvail = await provider.isAvailable();
        assert.strictEqual(isAvail, true);

        const res = await provider.search('asus laptop');
        assert.strictEqual(protocolCalledWith, 'asus laptop');
        assert.strictEqual(res.length, 1);
        assert.strictEqual(res[0].source, 'tokopedia');
    });

    // 2. LAZADA NATIVE PROVIDER
    it('LazadaNativeProvider harus memenuhi kontrak BaseSearchProvider (Priority 3)', () => {
        const provider = new LazadaNativeProvider();
        assert.strictEqual(provider.getName(), 'lazada-native');
        assert.strictEqual(provider.getProvenance(), 'native-assisted');
        assert.strictEqual(provider.getPriority(), 3);
    });

    await itAsync('LazadaNativeProvider.isAvailable() harus return true dan mendelegasikan search', async () => {
        let protocolCalled = false;
        const mockProtocol = {
            search: async () => {
                protocolCalled = true;
                return [{ title: 'Lenovo Ideapad', price: 6000000, source: 'lazada' }];
            }
        };

        const provider = new LazadaNativeProvider(null, { protocolInstance: mockProtocol });
        assert.strictEqual(await provider.isAvailable(), true);
        const res = await provider.search('lenovo');
        assert.strictEqual(protocolCalled, true);
        assert.strictEqual(res[0].source, 'lazada');
    });

    // 3. BLIBLI NATIVE PROVIDER
    it('BlibliNativeProvider harus memenuhi kontrak BaseSearchProvider (Priority 3)', () => {
        const provider = new BlibliNativeProvider();
        assert.strictEqual(provider.getName(), 'blibli-native');
        assert.strictEqual(provider.getProvenance(), 'native-assisted');
        assert.strictEqual(provider.getPriority(), 3);
    });

    await itAsync('BlibliNativeProvider.isAvailable() harus return true dan mendelegasikan search', async () => {
        let protocolCalled = false;
        const mockProtocol = {
            search: async () => {
                protocolCalled = true;
                return [{ title: 'Acer Aspire', price: 5200000, source: 'blibli' }];
            }
        };

        const provider = new BlibliNativeProvider(null, { protocolInstance: mockProtocol });
        assert.strictEqual(await provider.isAvailable(), true);
        const res = await provider.search('acer');
        assert.strictEqual(protocolCalled, true);
        assert.strictEqual(res[0].source, 'blibli');
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
