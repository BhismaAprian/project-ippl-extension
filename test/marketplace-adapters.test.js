/**
 * test/marketplace-adapters.test.js
 * 
 * Pengujian Ekstraksi Adapter Marketplace berbasis Ground Truth Snapshot HTML:
 * 1. ShopeeAdapter vs contohproduk-shopee.html
 * 2. TokopediaAdapter vs contohproduk-tokped.html
 * 3. LazadaAdapter vs contohproduk-lazada.html
 * 4. BlibliAdapter vs ContohProduk-BliBli.html
 * 
 * Membuktikan bahwa seluruh adapter dapat mengekstrak Judul, Harga/Spesifikasi,
 * dan URL secara akurat dari file HTML offline asli.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

/**
 * Utility untuk merekonstruksi HTML bersih dari Chrome view-source table
 */
function cleanViewSource(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const urlMatch = raw.match(/saved from url=\(\d+\)(https?:\/\/[^\s>]+)/);
    const origUrl = urlMatch ? urlMatch[1] : null;

    const lineMatches = raw.match(/<td class=\"line-content\">(.*?)<\/td>/gs);
    if (!lineMatches) return { origUrl, content: raw };

    const lines = lineMatches.map(m => {
        const text = m.replace(/^<td class=\"line-content\">/, '').replace(/<\/td>$/, '');
        return text.replace(/<[^>]+>/g, '')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&amp;/g, '&')
                   .replace(/&quot;/g, '\"')
                   .replace(/&#39;/g, '\'');
    });

    return { origUrl, content: lines.join('\n') };
}

// -----------------------------------------------------------------------------
console.log('=== TEST SUITE: GROUND TRUTH SNAPSHOT CLASSIFICATION ===');
// -----------------------------------------------------------------------------

it('Semua file snapshot harus diklasifikasikan sebagai Product Detail Page (PDP)', () => {
    const files = [
        'contohproduk-shopee.html',
        'contohproduk-tokped.html',
        'contohproduk-lazada.html',
        'ContohProduk-BliBli.html'
    ];

    for (const f of files) {
        const fullPath = path.join(__dirname, '..', f);
        assert.ok(fs.existsSync(fullPath), `File snapshot ${f} harus ada`);
        const { origUrl } = cleanViewSource(fullPath);
        assert.ok(origUrl, `File ${f} harus memiliki saved from url penanda`);
        
        // Verifikasi bahwa URL adalah URL PDP tunggal
        const isPdpUrl = /-i\.\d+\.\d+/.test(origUrl) ||
                         /\/products\/.*-i\d+/i.test(origUrl) ||
                         /\/p\//.test(origUrl) ||
                         /tokopedia\.com\/[^\/]+\/[^\/?]+/.test(origUrl);
        assert.ok(isPdpUrl, `URL ${origUrl} harus merepresentasikan Product Detail Page (PDP)`);
    }
});

// -----------------------------------------------------------------------------
console.log('\n=== TEST SUITE: SHOPEE ADAPTER (contohproduk-shopee.html) ===');
// -----------------------------------------------------------------------------

it('ShopeeAdapter harus mengekstrak Judul, ItemId, ShopId, dan Atribut dari contohproduk-shopee.html', () => {
    const shopeeData = cleanViewSource(path.join(__dirname, '../contohproduk-shopee.html'));
    const mfeMatch = shopeeData.content.match(/<script[^>]+type=[\"\']text\/mfe-initial-data[\"\'][^>]*>(.*?)<\/script>/s);
    assert.ok(mfeMatch, 'Script mfe-initial-data harus ditemukan di contohproduk-shopee.html');

    const mfeText = mfeMatch[1];
    global.window = {
        location: new URL(shopeeData.origUrl)
    };
    global.document = {
        querySelector: (sel) => {
            if (sel === 'script[type="text/mfe-initial-data"]') return { textContent: mfeText };
            return null;
        },
        querySelectorAll: (sel) => {
            if (sel === 'script[type="text/mfe-initial-data"]') return [{ textContent: mfeText }];
            return [];
        }
    };

    const { ShopeeAdapter } = require('../extension/adapters/shopee-adapter.js');
    const adapter = new ShopeeAdapter();

    assert.strictEqual(adapter.matchesUrl(shopeeData.origUrl), true, 'matchesUrl harus true untuk Shopee');
    assert.strictEqual(adapter.hasProductMarkers(), true, 'hasProductMarkers harus true untuk Shopee');

    const product = adapter.extractProduct();
    assert.ok(product, 'extractProduct harus menghasilkan data produk');
    assert.ok(product.title.includes('Novilla kasur IceMint'), 'Judul produk harus cocok dengan Novilla kasur');
    assert.strictEqual(product.itemId, '24918260613', 'itemId harus diekstrak dari mfeState atau URL');
    assert.strictEqual(product.shopId, '1165288551', 'shopId harus diekstrak dari mfeState atau URL');
    assert.ok(product.url.includes('shopee.co.id'), 'URL produk harus Shopee');
});

// -----------------------------------------------------------------------------
console.log('\n=== TEST SUITE: TOKOPEDIA ADAPTER (contohproduk-tokped.html) ===');
// -----------------------------------------------------------------------------

it('TokopediaAdapter harus mengekstrak Judul dan Seller dari contohproduk-tokped.html', () => {
    const tokpedData = cleanViewSource(path.join(__dirname, '../contohproduk-tokped.html'));
    const pageTypeMatch = tokpedData.content.match(/window\.__PAGE_TYPE__\s*=\s*[\"\']([^\"\']+)[\"\']/);
    const pageType = pageTypeMatch ? pageTypeMatch[1] : null;

    global.window = {
        location: new URL(tokpedData.origUrl),
        __PAGE_TYPE__: pageType
    };
    global.document = {
        querySelector: () => null,
        querySelectorAll: () => []
    };

    const { TokopediaAdapter } = require('../extension/adapters/tokopedia-adapter.js');
    const adapter = new TokopediaAdapter();

    assert.strictEqual(adapter.matchesUrl(tokpedData.origUrl), true, 'matchesUrl harus true untuk Tokopedia');
    assert.strictEqual(adapter.hasProductMarkers(), true, 'hasProductMarkers harus mendeteksi __PAGE_TYPE__');

    const product = adapter.extractProduct();
    assert.ok(product, 'extractProduct harus menghasilkan data produk');
    assert.ok(product.title.includes('lemari plastik lipat'), 'Judul produk harus diekstrak dari slug URL');
    assert.strictEqual(product.seller, 'yiqii', 'Nama toko harus diekstrak dari path Tokopedia');
    assert.ok(product.url.includes('tokopedia.com'), 'URL produk harus Tokopedia');
});

// -----------------------------------------------------------------------------
console.log('\n=== TEST SUITE: LAZADA ADAPTER (contohproduk-lazada.html) ===');
// -----------------------------------------------------------------------------

it('LazadaAdapter harus mengekstrak Judul, Harga, Brand, dan Link dari contohproduk-lazada.html', () => {
    const lazadaData = cleanViewSource(path.join(__dirname, '../contohproduk-lazada.html'));
    const jsonLdMatch = lazadaData.content.match(/<script[^>]+type=[\"\']application\/ld\+json[\"\'][^>]*>(.*?)<\/script>/s);
    const jsonLdText = jsonLdMatch ? jsonLdMatch[1] : null;

    const appLinkMatch = lazadaData.content.match(/<meta\s+property=[\"\']al:ios:url[\"\']\s+content=[\"\'](.*?)[\"\']/i);
    const appLinkContent = appLinkMatch ? appLinkMatch[1] : null;

    global.window = {
        location: new URL(lazadaData.origUrl)
    };
    global.document = {
        querySelector: (sel) => {
            if (sel === 'meta[property="al:ios:url"]' || sel === 'meta[property="al:android:url"]') {
                return appLinkContent ? { getAttribute: () => appLinkContent } : null;
            }
            return null;
        },
        querySelectorAll: (sel) => {
            if (sel === 'script[type="application/ld+json"]') {
                return jsonLdText ? [{ textContent: jsonLdText }] : [];
            }
            return [];
        }
    };

    const { LazadaAdapter } = require('../extension/adapters/lazada-adapter.js');
    const adapter = new LazadaAdapter();

    assert.strictEqual(adapter.matchesUrl(lazadaData.origUrl), true, 'matchesUrl harus true untuk Lazada');
    assert.strictEqual(adapter.hasProductMarkers(), true, 'hasProductMarkers harus mendeteksi path /products/');

    const product = adapter.extractProduct();
    assert.ok(product, 'extractProduct harus menghasilkan data produk');
    assert.ok(product.title.includes('OPPO A6c'), 'Judul produk harus OPPO A6c');
    assert.strictEqual(product.price, 2799000, 'Harga harus diekstrak 2.799.000 dari AppLink / Offer');
    assert.strictEqual(product.brand, 'OPPO', 'Brand harus OPPO');
    assert.ok(product.url.includes('lazada.co.id'), 'URL produk harus Lazada');
});

// -----------------------------------------------------------------------------
console.log('\n=== TEST SUITE: BLIBLI ADAPTER (ContohProduk-BliBli.html) ===');
// -----------------------------------------------------------------------------

it('BlibliAdapter harus mengekstrak Judul, Harga, Brand, Seller, Rating, dan Link dari ContohProduk-BliBli.html', () => {
    const blibliData = cleanViewSource(path.join(__dirname, '../ContohProduk-BliBli.html'));
    const match = blibliData.content.match(/__PRODUCT_DETAIL_INITIAL_STATE__\s*=\s*(\{.*?\});/s);
    assert.ok(match, 'Script __PRODUCT_DETAIL_INITIAL_STATE__ harus ada di Blibli HTML');

    const parsedState = JSON.parse(match[1]);

    global.window = {
        location: new URL(blibliData.origUrl),
        __PRODUCT_DETAIL_INITIAL_STATE__: parsedState
    };
    global.document = {
        querySelector: () => null,
        querySelectorAll: () => []
    };

    const { BlibliAdapter } = require('../extension/adapters/blibli-adapter.js');
    const adapter = new BlibliAdapter();

    assert.strictEqual(adapter.matchesUrl(blibliData.origUrl), true, 'matchesUrl harus true untuk Blibli');
    assert.strictEqual(adapter.hasProductMarkers(), true, 'hasProductMarkers harus mendeteksi path /p/ atau state');

    const product = adapter.extractProduct();
    assert.ok(product, 'extractProduct harus menghasilkan data produk');
    assert.ok(product.title.includes('Seagate Harddisk Eksternal One Touch'), 'Judul harus Seagate Harddisk Eksternal');
    assert.strictEqual(product.price, 2799000, 'Harga promo offered harus 2.799.000');
    assert.strictEqual(product.originalPrice, 3899000, 'Harga original listed harus 3.899.000');
    assert.strictEqual(product.brand, 'Seagate', 'Brand harus Seagate');
    assert.strictEqual(product.seller, 'Seagate Flagship Store', 'Merchant seller harus Seagate Flagship Store');
    assert.strictEqual(product.rating, 5, 'Rating ulasan harus 5');
    assert.strictEqual(product.reviewCount, 38, 'Review count harus 38');
    assert.ok(product.url.includes('blibli.com'), 'URL produk harus Blibli');
});

// -----------------------------------------------------------------------------
console.log(`\n========================================`);
console.log(`HASIL: ${passedTests} / ${totalTests} PENGUJIAN ADAPTER BERHASIL.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
    process.exit(1);
}
