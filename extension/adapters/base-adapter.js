/**
 * extension/adapters/base-adapter.js
 * 
 * BaseAdapter — interface standar untuk semua adapter marketplace.
 * Setiap adapter marketplace (Shopee, Tokopedia, Lazada, Blibli) WAJIB extends class ini
 * dan implement method-method di bawah.
 * 
 * Tujuan: core logic tidak perlu tahu detail marketplace spesifik.
 */

class BaseAdapter {
    /**
     * Nama marketplace (lowercase, harus match dengan key di SUPPORTED_MARKETPLACES).
     * @returns {string}
     */
    get marketplaceName() {
        throw new Error('marketplaceName must be implemented by subclass');
    }

    /**
     * Cek apakah URL saat ini cocok dengan marketplace ini.
     * @param {string} url - URL lengkap halaman
     * @returns {boolean}
     */
    matchesUrl(url) {
        throw new Error('matchesUrl must be implemented by subclass');
    }

    /**
     * Cek apakah DOM halaman ini punya elemen penanda halaman produk.
     * @returns {boolean}
     */
    hasProductMarkers() {
        throw new Error('hasProductMarkers must be implemented by subclass');
    }

    /**
     * Kompatibilitas alias untuk typo historis
     */
    hasproductMakers() {
        return this.hasProductMarkers();
    }

    /**
     * Ekstrak data produk dari halaman.
     * @returns {object|null}
     */
    extractProduct() {
        throw new Error('extractProduct must be implemented by subclass');
    }

    /**
     * (Review Intelligence) Ekstrak daftar ulasan teks pembeli dari DOM.
     * @returns {Promise<Array<string>>}
     */
    async extractReviews() {
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BaseAdapter };
}
if (typeof window !== 'undefined') {
    window.BaseAdapter = BaseAdapter;
}
