/**
 * backend/src/parsers/blibli-parser.js
 * 
 * Parser HTML Blibli menggunakan Cheerio:
 * - Mengekstrak kartu produk dari selektor DOM [data-testid="productCard"]
 * - Fallback ekstraksi JSON-LD Schema.org & window.__PRODUCT_DETAIL_INITIAL_STATE__
 */

const cheerio = require('cheerio');

function extractImageFromCheerio($, el) {
    const rejectPatterns = [/data:image/i, /blank/i, /placeholder/i, /1x1/i];
    const attrs = ['src', 'data-src', 'data-lazy-src', 'srcset'];
    let result = null;
    const imgs = el.find('img');
    imgs.each((_, imgEl) => {
        if (result) return;
        const $img = $(imgEl);
        for (const attr of attrs) {
            let val = $img.attr(attr);
            if (!val || typeof val !== 'string') continue;
            val = val.trim();
            if (!val) continue;

            if (attr === 'srcset' || val.includes(' ') || val.includes(',')) {
                const firstPart = val.split(',')[0].trim().split(/\s+/)[0].trim();
                if (firstPart) val = firstPart;
            }

            if (val.startsWith('//')) {
                val = 'https:' + val;
            }

            const isRejected = rejectPatterns.some(rx => rx.test(val));
            if (isRejected) continue;

            if (/^https?:\/\//i.test(val)) {
                result = val;
                break;
            }
        }
    });
    return result;
}

function parsePrice(text) {
    if (!text) return null;
    const clean = text.replace(/[^\d]/g, '');
    if (!clean) return null;
    const p = parseInt(clean, 10);
    return !isNaN(p) && p > 0 ? p : null;
}

function parseBlibli(html) {
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const candidates = [];
    const seenUrls = new Set();

    // 1. Ekstraksi dari Kartu DOM ([data-testid="productCard"])
    $('[data-testid="productCard"], .product-card, div[class*="product-item"]').each((_, el) => {
        const card = $(el);
        const linkEl = card.find('a[href]').first();
        if (!linkEl.length) return;

        let href = linkEl.attr('href') || '';
        if (!href) return;
        if (!href.startsWith('http')) {
            href = 'https://www.blibli.com' + (href.startsWith('/') ? href : '/' + href);
        }

        if (!href.includes('/p/')) return;

        try {
            const parsed = new URL(href);
            href = parsed.origin + parsed.pathname;
        } catch (e) { }

        if (seenUrls.has(href)) return;

        let title = card.find('[data-testid="productTitle"], [class*="product__title"], .product-title').text().trim();
        if (!title) {
            title = card.find('img[alt]').first().attr('alt') || '';
        }
        if (!title) {
            title = card.find('h3, h2, a').first().text().trim();
        }

        const priceText = card.find('[data-testid="productPrice"], [class*="price"]').text();
        const price = parsePrice(priceText);

        // Ekstraksi Gambar (ADR-11)
        const imgUrl = extractImageFromCheerio($, card);

        const shopName = card.find('[data-testid="merchantName"], [class*="merchant"], [class*="seller"], .product-seller').text().trim() || null;

        let rating = null;
        const ratingText = card.find('[class*="rating"]').text();
        const rMatch = ratingText.match(/(\d(?:\.\d)?)/);
        if (rMatch) {
            const rVal = parseFloat(rMatch[1]);
            if (!isNaN(rVal) && rVal <= 5) rating = rVal;
        }

        if (title && href) {
            seenUrls.add(href);
            candidates.push({
                source: 'blibli',
                marketplace: 'blibli',
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
                        if (pUrl && !pUrl.startsWith('http')) pUrl = 'https://www.blibli.com' + pUrl;
                        if (!pUrl || seenUrls.has(pUrl)) continue;

                        const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
                        const price = offer?.price ? parsePrice(String(offer.price)) : null;
                        const sellerName = offer?.seller?.name || null;

                        seenUrls.add(pUrl);
                        candidates.push({
                            source: 'blibli',
                            marketplace: 'blibli',
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

    // 3. Fallback: Ekstraksi dari state script (__PRODUCT_DETAIL_INITIAL_STATE__)
    if (candidates.length === 0) {
        $('script').each((_, el) => {
            const text = $(el).contents().text() || '';
            if (text.includes('__PRODUCT_DETAIL_INITIAL_STATE__')) {
                try {
                    const m = text.match(/__PRODUCT_DETAIL_INITIAL_STATE__\s*=\s*(\{.*?\});/s);
                    if (m && m[1]) {
                        const state = JSON.parse(m[1]);
                        const summary = state['productDetail.product/summary'];
                        if (summary && summary.name) {
                            const pUrl = summary.url || '';
                            const price = summary.price?.offered || summary.price?.listed || null;
                            candidates.push({
                                source: 'blibli',
                                provenance: 'backend-scraper',
                                url: pUrl,
                                title: String(summary.name).trim(),
                                price: typeof price === 'number' ? price : parsePrice(String(price)),
                                rating: summary.review?.decimalRating || summary.review?.rating || null,
                                shopName: summary.merchant?.name || null,
                                imageUrl: summary.images?.[0]?.full || null,
                                observedAt: new Date().toISOString()
                            });
                        }
                    }
                } catch (e) { }
            }
        });
    }

    return candidates;
}

module.exports = {
    parseBlibli
};
