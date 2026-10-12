/**
 * Konstanta yang dipakai bersama di seluruh extension.
 * Kalau nanti ada perubahan (misal tambah marketplace baru),
 * ubah disini aja.
 */

export const APP_NAME = 'Shopping Intelligence';
export const APP_VERSION = '0.1.0';

export const MESSAGES = {
    NOT_PRODUCT_PAGE: 'Halaman ini bukan halaman produk MARKETPLACE',
    UNSUPPORTED_MARKETPLACE: 'Marketplace ini belum didukung.',
    DETECTING: 'Memeriksa Halaman',
    READY: 'Siap Menganalisis Produk!',
    ERROR: 'Terjadi Kesalahan, Coba Lagi.'
};

// Sementara baru 3 Marketplace yang didukung extension ini
export const SUPPORTED_MARKETPLACES = [
  'shopee',
  'tokopedia',
  'lazada'
];


// Pola URL yang menandakan halaman produk (generic, tiap adapter punya detail sendiri)
export const URL_PATTERNS = {
  shopee: /-i\.\d+\.\d+/,
  tokopedia: /\/[a-z0-9-]+\/[a-z0-9-]+-[a-z0-9]+/,
  lazada: /\/products\/[a-z0-9-]+-i\d+-s\d+/
};
