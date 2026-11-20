/**
 * backend/src/parsers/lazada-parser.js
 * 
 * Parser HTML Lazada menggunakan Cheerio:
 * - Mengekstrak kartu produk dari selektor DOM [data-qa-locator="product-item"]
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

function parseLazada(html) {
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const candidates = [];
    const seenUrls = new Set();

    // 1. Ekstraksi dari Kartu DOM ([data-qa-locator="product-item"])
    $('[data-qa-locator="product-item"], div[data-item-id]').each((_, el) => {
        const card = $(el);
        const linkEl = card.find('a[href]').first();
        if (!linkEl.length) return;

        let href = linkEl.attr('href') || '';
        if (!href) return;
        if (href.startsWith('//')) {
            href = 'https:' + href;
        } else if (!href.startsWith('http')) {
            href = 'https://www.lazada.co.id' + (href.startsWith('/') ? href : '/' + href);
        }

        if (!href.includes('/products/')) return;

        try {
            const parsed = new URL(href);
            href = parsed.origin + parsed.pathname;
        } catch (e) { }

        if (seenUrls.has(href)) return;

        // Ekstraksi Judul
        let title = linkEl.attr('title') ||
            card.find('img[alt]').first().attr('alt') ||
            card.find('[class*="title"], [class*="name"]').text().trim();

        if (!title) {
            title = card.find('h3, h2, a').first().text().trim();
        }

        // Ekstraksi Harga
        let priceText = card.find('[class*="price"]').text();
        if (!priceText) {
            const m = card.text().match(/Rp\s*[\d.]+/);
            if (m) priceText = m[0];
        }
        const price = parsePrice(priceText);

        const imgUrl = card.find('img').first().attr('src') || null;

        let rating = null;
        const ratingText = card.find('[class*="rating"]').text();
        const rMatch = ratingText.match(/(\d(?:\.\d)?)/);
        if (rMatch) {
            const rVal = parseFloat(rMatch[1]);
            if (!isNaN(rVal) && rVal <= 5) rating = rVal;
        }

        const shopName = card.find('[class*="seller"], [class*="shop"], [class*="store"]').text().trim() || null;

        if (title && href) {
            seenUrls.add(href);
            candidates.push({
                source: 'lazada',
                marketplace: 'lazada',
                provenance: 'backend-scraper',
                url: href,
                title: title.trim(),
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
                        if (pUrl && pUrl.startsWith('//')) pUrl = 'https:' + pUrl;
                        if (pUrl && !pUrl.startsWith('http')) pUrl = 'https://www.lazada.co.id' + pUrl;
                        if (!pUrl || seenUrls.has(pUrl)) continue;

                        const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
                        const price = offer?.price ? parsePrice(String(offer.price)) : null;
                        const sellerName = offer?.seller?.name || null;

                        seenUrls.add(pUrl);
                        candidates.push({
                            source: 'lazada',
                            marketplace: 'lazada',
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
    parseLazada
};
