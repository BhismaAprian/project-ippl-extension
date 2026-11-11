/**
 * extension/shared/base-search-provider.js
 * 
 * Kontrak interface dasar untuk seluruh search provider (Native & Fallback).
 * Setiap provider turunan wajib mengimplementasikan method-method di bawah.
 */

class BaseSearchProvider {
    /**
     * Mengembalikan identitas unik provider
     * @returns {string} Contoh: 'shopee', 'tokopedia', 'lazada', 'blibli', 'exa'
     */
    getName() {
        throw new Error('BaseSearchProvider.getName() must be implemented by subclass');
    }

    /**
     * Mengembalikan provenance/asal data kandidat
     * @returns {string} Contoh: 'native-assisted' | 'exa-fallback' | 'official-api' | 'indonesia-scraper-api'
     */
    getProvenance() {
        throw new Error('BaseSearchProvider.getProvenance() must be implemented by subclass');
    }

    /**
     * Mengembalikan tingkat prioritas provider (1: tertinggi, 5: terendah)
     * @returns {number}
     */
    getPriority() {
        throw new Error('BaseSearchProvider.getPriority() must be implemented by subclass');
    }

    /**
     * Memeriksa apakah provider siap dan dapat digunakan
     * @returns {Promise<boolean>|boolean}
     */
    async isAvailable() {
        throw new Error('BaseSearchProvider.isAvailable() must be implemented by subclass');
    }

    /**
     * Menjalankan pencarian kandidat produk
     * @param {string|object} query - String kata kunci atau objek fingerprint produk
     * @param {object} [options={}] - Opsi tambahan
     * @returns {Promise<Array<object>>} - Daftar kandidat ternormalisasi
     */
    async search(query, options = {}) {
        throw new Error('BaseSearchProvider.search() must be implemented by subclass');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BaseSearchProvider };
}
if (typeof window !== 'undefined') {
    window.BaseSearchProvider = BaseSearchProvider;
}
