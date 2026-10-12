/**
 * BaseAdapter — interface standar untuk semua adapter marketplace.
 * 
 * Setiap adapter marketplace (Shopee, Tokopedia, Lazada) WAJIB extends class ini
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
        throw new Error('matchesUrl Mst be implemented by subclass');
    }


    /**
   * Cek apakah DOM halaman ini punya elemen penanda halaman produk.
   * @returns {boolean}
   */

    hasproductMakers() {
        throw new Error('hasproductMakers must be implemented by subclass');
    }


    /**
   * (Placeholder minggu 2) Ekstrak data produk dari DOM.
   * @returns {object|null}
   */
    extractProduct() {
        throw new Error('extractProduct not yet implemented for week 1');
    }
}
window.BaseAdapter = BaseAdapter;