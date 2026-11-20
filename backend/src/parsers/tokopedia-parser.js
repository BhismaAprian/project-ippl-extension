/**
 * backend/src/parsers/tokopedia-parser.js
 * 
 * Parser HTML Tokopedia menggunakan Cheerio:
 * - Mengekstrak kartu produk dari selektor DOM [data-testid="divSRPProductCard"]
 * - Fallback ekstraksi JSON-LD Schema.org
 */

const cheerio = require('cheerio');

function parsePrice(text) {
    if (!text) return null;
    const clean = text.replace(/[^\d]/g, '');
    if (!clean) return null;
    const p = parseInt(clean, 10);
    return !isNaN(p) && p > 0 ? p : null;
}

function parseTokopedia(html) {
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const candidates = [];
    const seenUrls = new Set();

    // 1. Ekstraksi dari Kartu DOM ([data-testid="divSRPProductCard"])
    $('[data-testid="divSRPProductCard"], [data-testid="master-product-card"]').each((_, el) => {
        const card = $(el);
        const linkEl = card.find('a[href]').first();
        if (!linkEl.length) return;

        let href = linkEl.attr('href') || '';
        if (!href) return;
        if (!href.startsWith('http')) {
            href = 'https://www.tokopedia.com' + (href.startsWith('/') ? href : '/' + href);
        }

        // Filter tautan PDP Tokopedia
        if (href.includes('/promo/') || href.includes('/discovery/')) return;

        try {
            const parsed = new URL(href);
            href = parsed.origin + parsed.pathname;
        } catch (e) { }

        if (seenUrls.has(href)) return;

        // Ekstraksi Judul
        let title = card.find('[data-testid="spnSRPProdName"]').text().trim();
        if (!title) {
            title = card.find('img[alt]').first().attr('alt') || '';
        }
        if (!title) {
            title = card.find('[class*="css-20fe3w"], [class*="ProdName"], [class*="prodName"], [class*="title"], h3, h2').first().text().trim();
        }
        if (!title) {
            const rawText = card.find('a').text().split('\n').map(l => l.trim()).filter(Boolean);
            title = rawText[0] || '';
        }

        // Ekstraksi Harga
        let priceText = card.find('[data-testid="spnSRPProdPrice"], [class*="price"], [class*="Price"], [class*="css-o5uqvq"]').first().text();
        if (!priceText) {
            const m = card.text().match(/Rp\s*[\d.]+/);
            if (m) priceText = m[0];
        }
        const price = parsePrice(priceText);

        // Ekstraksi Toko / Lokasi
        const shopName = card.find('[data-testid="spnSRPProdShopLoc"], [data-testid="spnSRPProdShop"], [data-testid="spnSRPProdShopName"], [class*="css-1rn0irl"], [class*="shop"]').first().text().trim() || null;

        // Ekstraksi Rating
        let rating = null;
        const ratingText = card.find('[data-testid="spnSRPProdRating"], .bi-star + span, [class*="css-tjp7fc"], [class*="rating"]').first().text().trim();
        if (ratingText) {
            const rVal = parseFloat(ratingText.replace(',', '.'));
            if (!isNaN(rVal) && rVal <= 5) rating = rVal;
        }

        const imgUrl = card.find('img').first().attr('src') || null;

        if (title && href) {
            seenUrls.add(href);
            candidates.push({
                source: 'tokopedia',
                marketplace: 'tokopedia',
                provenance: 'backend-scraper',
                url: href,
                title: title,
                price: price,
                rating: rating,
                seller: shopName,
                shopName: shopName,
                imageUrl: imgUrl,
                observedAt: new Date().toISOString()
            });
        }
    });

    // 2. Fallback: Ekstraksi dari JSON-LD
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
                        if (pUrl && !pUrl.startsWith('http')) pUrl = 'https://www.tokopedia.com' + pUrl;
                        if (!pUrl || seenUrls.has(pUrl)) continue;

                        const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
                        const price = offer?.price ? parsePrice(String(offer.price)) : null;
                        const sellerName = offer?.seller?.name || null;

                        seenUrls.add(pUrl);
                        candidates.push({
                            source: 'tokopedia',
                            marketplace: 'tokopedia',
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

    return candidates;
}

module.exports = {
    parseTokopedia
};
