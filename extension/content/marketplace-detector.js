/**
 * marketplace-detector.js
 * 
 * Core detection logic. TIDAK peduli marketplace apa yang sedang dibuka.
 * Tugasnya:
 * 1. Pilih adapter yang cocok dengan URL saat ini
 * 2. Verifikasi apakah DOM punya elemen penanda produk
 * 3. Kembalikan hasil ke popup
 */


import { ShopeeAdapter } from '../adapters/shopee-adapter.js';
import { TokopediaAdapter } from '../adapters/tokopedia-adapter.js';
import { LazadaAdapter } from '../adapters/lazada-adapter.js';


const ADAPTERS = [
    new ShopeeAdapter(),
    new TokopediaAdapter(),
    new LazadaAdapter()
];

console.log('[Shopping Intelligence] Content Script Loaded....')


/**
 * Deteksi marketplace dari URL saat ini, lalu verifikasi halaman produk.
 * @returns {object} hasil deteksi
 */

function detectCurrentPage(){
    const currentUrl = window.location.href;

    const adapter = ADAPTERS.find(a => a.matchesUrl(currentUrl));

    if(!adapter) {
        return {
            isProduct: false,
            marketplace: null,
            reason: 'Marketplace ini belum didukung.'
        };
    }
    // Cek DOM punya elemen penanda produk

    const hasMarkers = adapter.hasProductMarkers();

    if(!hasMarkers){
        return{
            isProduct: false,
            marketplace: adapter.marketplaceName,
            reason: `Halaman ${adapter.marketplaceName} Terdeteksi, tapi bukan halaman produk.`
        };
    }

    return {
        isProduct: true,
        marketplace: adapter.marketplaceName,
        reason: `Halaman Produk ${adapter.marketplaceName} Terdeteksi`,
        url: currentUrl
    };
}


chrome.runtime.onMessage.addListener((request,sender,sendResponse) => {
    if(request.action == 'DETECT_PAGE'){
        const result = detectCurrentPage();
        console.log('[Shopping Intelligence] Detection', result)
    }
})