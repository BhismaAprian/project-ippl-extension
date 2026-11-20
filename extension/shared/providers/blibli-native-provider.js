/**
 * extension/shared/providers/blibli-native-provider.js
 * 
 * Blibli Native Search Provider (Prioritas 3, Provenance: 'native-assisted').
 * Mengimplementasikan BaseSearchProvider dan mendelegasikan eksekusi pencarian
 * ke NativeSearchProtocol berbasis Blibli Manifest.
 */

const BaseProviderClass = typeof require !== 'undefined'
    ? require('../base-search-provider.js').BaseSearchProvider
    : (typeof window !== 'undefined' ? window.BaseSearchProvider : class {});

const _protocolClass = typeof require !== 'undefined'
    ? require('../native-search-protocol.js').NativeSearchProtocol
    : (typeof window !== 'undefined' ? window.NativeSearchProtocol : null);

const _defaultBlibliManifest = typeof require !== 'undefined'
    ? require('../../manifest/marketplace-manifest/blibli.js')
    : (typeof window !== 'undefined' ? window.blibliManifest : null);

class BlibliNativeProvider extends BaseProviderClass {
    /**
     * @param {object} [manifest=null] - Manifest Blibli opsional
     * @param {object} [options={}] - Opsi injeksi (misal: protocolInstance, messageSender)
     */
    constructor(manifest = null, options = {}) {
        super();
        this.manifest = manifest || _defaultBlibliManifest;
        this.options = options;
        this.protocolInstance = options.protocolInstance || null;
    }

    /**
     * @returns {string}
     */
    getName() {
        return 'blibli-native';
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
     * Menjalankan pencarian native Blibli
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
    module.exports = { BlibliNativeProvider };
}
if (typeof window !== 'undefined') {
    window.BlibliNativeProvider = BlibliNativeProvider;
}
