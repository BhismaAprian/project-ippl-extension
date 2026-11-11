/**
 * extension/shared/providers/shopee-native-provider.js
 * 
 * Shopee Native Search Provider (Prioritas 3, Provenance: 'native-assisted').
 * Mengimplementasikan BaseSearchProvider dan mendelegasikan eksekusi pencarian
 * ke NativeSearchProtocol berbasis Shopee Manifest.
 */

const BaseProviderClass = typeof require !== 'undefined'
    ? require('../base-search-provider.js').BaseSearchProvider
    : (typeof window !== 'undefined' ? window.BaseSearchProvider : class {});

const _protocolClass = typeof require !== 'undefined'
    ? require('../native-search-protocol.js').NativeSearchProtocol
    : (typeof window !== 'undefined' ? window.NativeSearchProtocol : null);

const _defaultShopeeManifest = typeof require !== 'undefined'
    ? require('../../manifest/marketplace-manifest/shopee.js')
    : (typeof window !== 'undefined' ? window.shopeeManifest : null);

class ShopeeNativeProvider extends BaseProviderClass {
    /**
     * @param {object} [manifest=null] - Manifest Shopee opsional
     * @param {object} [options={}] - Opsi injeksi (misal: protocolInstance, messageSender)
     */
    constructor(manifest = null, options = {}) {
        super();
        this.manifest = manifest || _defaultShopeeManifest;
        this.options = options;
        this.protocolInstance = options.protocolInstance || null;
    }

    /**
     * @returns {string}
     */
    getName() {
        return 'shopee-native';
    }

    /**
     * @returns {string}
     */
    getProvenance() {
        return 'native-assisted';
    }

    /**
     * @returns {number} Prioritas 3 (Pencarian native marketplace)
     */
    getPriority() {
        return 3;
    }

    /**
     * Ketersediaan mode native visible-tab selalu aktif pada peramban Chrome
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        return true;
    }

    /**
     * Menjalankan pencarian native Shopee
     * @param {string|object} queryOrFingerprint 
     * @param {object} [options={}] 
     * @returns {Promise<Array<object>>}
     */
    async search(queryOrFingerprint, options = {}) {
        const protocol = this.protocolInstance || new _protocolClass(this.manifest, {
            ...this.options,
            ...options
        });

        return protocol.search(queryOrFingerprint, options);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShopeeNativeProvider };
}
if (typeof window !== 'undefined') {
    window.ShopeeNativeProvider = ShopeeNativeProvider;
}
