/**
 * backend/src/parsers/shopee-parser.js
 * 
 * Parser HTML Shopee menggunakan Cheerio:
 * - Mengekstrak kartu produk dari selektor DOM [data-sqe="item"]
 * - Fallback ekstraksi JSON-LD (application/ld+json)
 * - Fallback state MFE JSON (text/mfe-initial-data)
 * - Normalisasi micro-unit harga Shopee (100.000)
 */

const cheerio = require('cheerio');

/**
 * Membersihkan dan mengubah teks harga ke integer Rupiah
 * @param {string} text 
 * @returns {number|null}
 */
function parsePrice(text) {
    if (!text) return null;
    const clean = text.replace(/[^\d]/g, '');
    if (!clean) return null;
    let p = parseInt(clean, 10);
    if (isNaN(p) || p <= 0) return null;
    // Normalisasi micro-unit Shopee
    if (p > 100000000) {
        p = Math.round(p / 100000);
    }
    return p;
}

/**
 * Ekstraksi kandidat produk dari HTML halaman pencarian Shopee
 * @param {string} html - Raw HTML dokumen
 * @returns {Array<object>} Daftar kandidat produk ternormalisasi
 */
function parseShopee(html) {
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const candidates = [];
    const seenUrls = new Set();

    // 1. Ekstraksi dari Kartu DOM ([data-sqe="item"])
    $('[data-sqe="item"], .shopee-search-item-result__item').each((_, el) => {
        const card = $(el);
        const linkEl = card.find('a[href]').first();
        if (!linkEl.length) return;

        let href = linkEl.attr('href') || '';
        if (!href) return;
        if (!href.startsWith('http')) {
            href = 'https://shopee.co.id' + (href.startsWith('/') ? href : '/' + href);
        }

        // Filter tautan PDP Shopee valid
        if (!/-i\.\d+\.\d+/.test(href) && !/\/product\/\d+\/\d+/.test(href)) {
            return;
        }

        // Hapus query tracking URL
        try {
            const parsed = new URL(href);
            href = parsed.origin + parsed.pathname;
        } catch (e) { }

        if (seenUrls.has(href)) return;

        // Ekstraksi Judul
        let title = card.find('img[alt]').first().attr('alt') ||
            card.attr('aria-label') ||
            card.find('.line-clamp-2, [class*="name"], [class*="title"]').text().trim();

        if (!title) {
            const rawText = card.text().split('\n').map(l => l.trim()).filter(Boolean);
            title = rawText[0] || '';
        }

        // Ekstraksi Harga
        let priceText = card.find('[class*="price"], [class*="G27YGl"], span:contains("Rp")').first().text();
        if (!priceText) {
            const allText = card.text();
            const rpMatch = allText.match(/Rp\s*[\d.]+/);
            if (rpMatch) priceText = rpMatch[0];
        }
        const price = parsePrice(priceText);

        // Ekstraksi Gambar
        const imgUrl = card.find('img').first().attr('src') || card.find('img').first().attr('data-src') || null;

        // Ekstraksi Rating
        let rating = null;
        const ratingText = card.find('[class*="rating"], [class*="star"], [aria-label*="rating"], [aria-label*="bintang"]').text() ||
            card.find('[aria-label*="rating"], [aria-label*="bintang"]').attr('aria-label') || '';
        const rMatch = ratingText.match(/(\d(?:\.\d)?)/);
        if (rMatch) {
            const rVal = parseFloat(rMatch[1]);
            if (!isNaN(rVal) && rVal <= 5) rating = rVal;
        }

        // Ekstraksi Lokasi / Toko
        const shopLoc = card.find('[class*="location"], [class*="shop"], [class*="seller"]').text().trim() || null;

        if (title && href) {
            seenUrls.add(href);
            candidates.push({
                source: 'shopee',
                marketplace: 'shopee',
                provenance: 'backend-scraper',
                url: href,
                title: title.trim(),
                price: price,
                rating: rating,
                seller: shopLoc,
                shopName: shopLoc,
                imageUrl: imgUrl,
                observedAt: new Date().toISOString()
            });
        }
    });

    // 2. Fallback: Ekstraksi dari JSON-LD (<script type="application/ld+json">)
    if (candidates.length === 0) {
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const text = $(el).contents().text().trim();
                if (!text) return;
                const data = JSON.parse(text);
                const items = Array.isArray(data) ? data : (data.itemListElement || [data]);
                for (const item of items) {
                    const prod = item.item || item;
                    if (prod && (prod['@type'] === 'Product' || prod.name)) {
                        let pUrl = prod.url || '';
                        if (pUrl && !pUrl.startsWith('http')) pUrl = 'https://shopee.co.id' + pUrl;
                        if (!pUrl || seenUrls.has(pUrl)) continue;

                        const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
                        const price = offer?.price ? parsePrice(String(offer.price)) : null;

                        seenUrls.add(pUrl);
                        const sellerName = offer?.seller?.name || null;
                        candidates.push({
                            source: 'shopee',
                            marketplace: 'shopee',
                            provenance: 'backend-scraper',
                            url: pUrl,
                            title: String(prod.name).trim(),
                            price: price,
                            rating: prod.aggregateRating?.ratingValue ? parseFloat(prod.aggregateRating.ratingValue) : null,
                            seller: sellerName,
                            shopName: sellerName,
                            imageUrl: Array.isArray(prod.image) ? prod.image[0] : prod.image || null,
                            observedAt: new Date().toISOString()
                        });
                    }
                }
            } catch (e) { }
        });
    }

    // 3. Fallback: Ekstraksi dari MFE JSON (<script type="text/mfe-initial-data">)
    if (candidates.length === 0) {
        $('script[type="text/mfe-initial-data"]').each((_, el) => {
            try {
                const text = $(el).contents().text().trim();
                if (!text || !text.includes('initialState')) return;
                const root = JSON.parse(text);
                const itemsObj = root.initialState?.item?.items || root.initialState?.search?.items || {};
                const list = Array.isArray(itemsObj) ? itemsObj : Object.values(itemsObj);

                for (const item of list) {
                    if (!item || (!item.name && !item.title)) continue;
                    const shopId = item.shopid || item.shop_id || '';
                    const itemId = item.itemid || item.item_id || '';
                    const url = `https://shopee.co.id/product/${shopId}/${itemId}`;
                    if (seenUrls.has(url)) continue;

                    const price = parsePrice(String(item.price || item.price_min || ''));
                    seenUrls.add(url);
                    candidates.push({
                        source: 'shopee',
                        provenance: 'backend-scraper',
                        url: url,
                        title: String(item.name || item.title).trim(),
                        price: price,
                        rating: item.item_rating?.rating_star ? parseFloat(item.item_rating.rating_star) : null,
                        shopName: item.shop_location || null,
                        imageUrl: item.image ? `https://down-id.img.susercontent.com/file/${item.image}` : null,
                        observedAt: new Date().toISOString()
                    });
                }
            } catch (e) { }
        });
    }

    return candidates;
}

module.exports = {
    parseShopee
};
