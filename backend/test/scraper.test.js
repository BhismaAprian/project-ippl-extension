/**
 * backend/test/scraper.test.js
 * 
 * Unit & Integration Test Suite untuk In-House Resilient Scraping Engine:
 * 1. Parser ekstraksi HTML statis (Shopee, Tokopedia, Lazada, Blibli)
 * 2. Dispatcher parser (parsers/index.js)
 * 3. HTTP Client rotasi User-Agent
 * 4. Antrean pembatasan konkurensi (queue.js)
 * 5. REST API Server endpoint (/api/health & /api/search)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { parseShopee } = require('../src/parsers/shopee-parser.js');
const { parseTokopedia } = require('../src/parsers/tokopedia-parser.js');
const { parseLazada } = require('../src/parsers/lazada-parser.js');
const { parseBlibli } = require('../src/parsers/blibli-parser.js');
const { getParser } = require('../src/parsers/index.js');
const { getNextUserAgent, getRandomUserAgent } = require('../src/http-client.js');
const { runWithLimit } = require('../src/queue.js');
const { app } = require('../src/server.js');
const config = require('../src/config.js');

describe('In-House Resilient Scraping Engine Test Suite', () => {

    describe('1. Shopee Parser (shopee-parser.js)', () => {
        it('harus mengekstrak produk dari struktur DOM [data-sqe="item"]', () => {
            const html = `
                <div data-sqe="item">
                    <a href="/Samsung-Galaxy-A54-5G-i.12345.67890">
                        <div class="line-clamp-2">Samsung Galaxy A54 5G 8/256GB Black</div>
                        <div>Rp5.999.000</div>
                        <div aria-label="rating 4.8">4.8</div>
                        <div>Official Store Jakarta</div>
                    </a>
                </div>
            `;

            const results = parseShopee(html);
            assert.ok(Array.isArray(results), 'Hasil harus berupa array');
            assert.strictEqual(results.length, 1, 'Harus mengekstrak tepat 1 produk');

            const item = results[0];
            assert.ok(item.title.includes('Samsung Galaxy A54'), 'Judul harus mengandung Samsung Galaxy A54');
            assert.strictEqual(item.price, 5999000, 'Harga harus terkonversi menjadi angka 5999000');
            assert.strictEqual(item.rating, 4.8, 'Rating harus 4.8');
            assert.ok(item.url.includes('shopee.co.id'), 'URL harus lengkap dengan domain Shopee');
            assert.strictEqual(item.marketplace, 'shopee');
        });

        it('harus mengekstrak produk dari skrip JSON-LD Shopee', () => {
            const html = `
                <html>
                <head>
                    <script type="application/ld+json">
                    {
                        "@context": "https://schema.org",
                        "@type": "ItemList",
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": 1,
                                "item": {
                                    "@type": "Product",
                                    "name": "Sony WH-1000XM5 Wireless Headphones",
                                    "offers": {
                                        "@type": "Offer",
                                        "price": "5499000"
                                    },
                                    "aggregateRating": {
                                        "@type": "AggregateRating",
                                        "ratingValue": "4.9"
                                    },
                                    "url": "https://shopee.co.id/Sony-WH-1000XM5-i.111.222"
                                }
                            }
                        ]
                    }
                    </script>
                </head>
                <body><div>No visible items</div></body>
                </html>
            `;

            const results = parseShopee(html);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].title, 'Sony WH-1000XM5 Wireless Headphones');
            assert.strictEqual(results[0].price, 5499000);
            assert.strictEqual(results[0].rating, 4.9);
        });

        it('harus mengembalikan array kosong jika HTML tidak valid atau tidak memiliki produk', () => {
            const results = parseShopee('<html><body>Kosong</body></html>');
            assert.deepStrictEqual(results, []);
        });
    });

    describe('2. Tokopedia Parser (tokopedia-parser.js)', () => {
        it('harus mengekstrak produk dari struktur DOM [data-testid="divSRPProductCard"]', () => {
            const html = `
                <div data-testid="divSRPProductCard">
                    <a href="https://www.tokopedia.com/tokosamsung/samsung-galaxy-s24-ultra">
                        <span class="css-20fe3w">Samsung Galaxy S24 Ultra 12/512GB Gray</span>
                        <div class="css-o5uqvq">Rp 21.999.000</div>
                        <span class="css-tjp7fc">4.9</span>
                        <span class="css-1rn0irl">Official Samsung Store</span>
                    </a>
                </div>
            `;

            const results = parseTokopedia(html);
            assert.strictEqual(results.length, 1);
            const item = results[0];
            assert.ok(item.title.includes('Galaxy S24 Ultra'));
            assert.strictEqual(item.price, 21999000);
            assert.strictEqual(item.rating, 4.9);
            assert.strictEqual(item.seller, 'Official Samsung Store');
            assert.strictEqual(item.marketplace, 'tokopedia');
        });

        it('harus mengekstrak produk Tokopedia dari JSON-LD schema', () => {
            const html = `
                <script type="application/ld+json">
                {
                    "@context": "https://schema.org",
                    "@type": "ItemList",
                    "itemListElement": [
                        {
                            "@type": "Product",
                            "name": "Logitech MX Master 3S",
                            "offers": { "price": "1650000" },
                            "url": "https://www.tokopedia.com/logitech/mx-master-3s"
                        }
                    ]
                }
                </script>
            `;

            const results = parseTokopedia(html);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].title, 'Logitech MX Master 3S');
            assert.strictEqual(results[0].price, 1650000);
        });
    });

    describe('3. Lazada Parser (lazada-parser.js)', () => {
        it('harus mengekstrak produk dari struktur DOM [data-qa-locator="product-item"]', () => {
            const html = `
                <div data-qa-locator="product-item">
                    <a href="//www.lazada.co.id/products/asus-rog-zephyrus-g14.html">
                        <div>ASUS ROG Zephyrus G14 OLED AMD Ryzen 9</div>
                        <div>Rp 34.500.000</div>
                        <div>ASUS Flagship Store</div>
                    </a>
                </div>
            `;

            const results = parseLazada(html);
            assert.strictEqual(results.length, 1);
            const item = results[0];
            assert.ok(item.title.includes('ASUS ROG Zephyrus'));
            assert.strictEqual(item.price, 34500000);
            assert.ok(item.url.startsWith('https://www.lazada.co.id'));
            assert.strictEqual(item.marketplace, 'lazada');
        });
    });

    describe('4. Blibli Parser (blibli-parser.js)', () => {
        it('harus mengekstrak produk dari struktur DOM [data-testid="productCard"]', () => {
            const html = `
                <div data-testid="productCard">
                    <a href="/p/apple-macbook-air-m3-13-inch/ps--APS-12345">
                        <div class="product-title">Apple MacBook Air M3 13 Inch 8/256GB Midnight</div>
                        <div class="product-price">Rp 17.499.000</div>
                        <div class="product-seller">iBox Official Store</div>
                    </a>
                </div>
            `;

            const results = parseBlibli(html);
            assert.strictEqual(results.length, 1);
            const item = results[0];
            assert.ok(item.title.includes('MacBook Air M3'));
            assert.strictEqual(item.price, 17499000);
            assert.strictEqual(item.seller, 'iBox Official Store');
            assert.ok(item.url.includes('blibli.com'));
            assert.strictEqual(item.marketplace, 'blibli');
        });
    });

    describe('5. Parser Dispatcher (parsers/index.js)', () => {
        it('harus mengembalikan fungsi parser yang tepat berdasarkan nama marketplace', () => {
            assert.strictEqual(getParser('shopee'), parseShopee);
            assert.strictEqual(getParser('tokopedia'), parseTokopedia);
            assert.strictEqual(getParser('lazada'), parseLazada);
            assert.strictEqual(getParser('blibli'), parseBlibli);
            assert.strictEqual(getParser('SHOPEE'), parseShopee);
            assert.strictEqual(getParser('unknown'), parseShopee);
        });
    });

    describe('6. HTTP Client & User-Agent Rotation (http-client.js)', () => {
        it('harus mengembalikan string User-Agent yang valid dan berputar', () => {
            const ua1 = getNextUserAgent();
            const ua2 = getNextUserAgent();
            assert.ok(typeof ua1 === 'string' && ua1.includes('Mozilla/5.0'));
            assert.ok(typeof ua2 === 'string' && ua2.includes('Mozilla/5.0'));
        });

        it('harus mengembalikan User-Agent acak dari pool yang ditentukan', () => {
            const randomUa = getRandomUserAgent();
            assert.ok(config.userAgents.includes(randomUa));
        });
    });

    describe('7. Concurrency Queue (queue.js)', () => {
        it('harus mengeksekusi tugas dalam batasan queue per domain', async () => {
            let executed = false;
            const res = await runWithLimit('shopee', async () => {
                executed = true;
                return 'QUEUE_SUCCESS';
            });
            assert.strictEqual(executed, true);
            assert.strictEqual(res, 'QUEUE_SUCCESS');
        });
    });

    describe('8. API Server Endpoints (/api/health & /api/search)', () => {
        let testServer = null;
        let testPort = 0;

        before(async () => {
            await new Promise((resolve) => {
                testServer = app.listen(0, '127.0.0.1', () => {
                    testPort = testServer.address().port;
                    resolve();
                });
            });
        });

        after(async () => {
            if (testServer) {
                await new Promise((resolve) => testServer.close(resolve));
            }
        });

        it('GET /api/health harus mengembalikan status OK dan uptime', async () => {
            const res = await fetch(`http://127.0.0.1:${testPort}/api/health`);
            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.status, 'OK');
            assert.ok(typeof data.uptime === 'number');
            assert.ok(data.service.includes('Scraping Engine'));
        });

        it('POST /api/search harus menolak permintaan tanpa keyword (400 Bad Request)', async () => {
            const res = await fetch(`http://127.0.0.1:${testPort}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: '' })
            });

            assert.strictEqual(res.status, 400);
            const data = await res.json();
            assert.strictEqual(data.success, false);
            assert.ok(data.error.includes('wajib'));
        });

        it('POST /api/search harus mengembalikan struktur respons JSON yang lengkap', async () => {
            const res = await fetch(`http://127.0.0.1:${testPort}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keyword: 'keyboard mechanical',
                    marketplace: 'shopee',
                    useBrowserFallback: false // Hindari live network di test
                })
            });

            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.keyword, 'keyboard mechanical');
            assert.strictEqual(data.marketplace, 'shopee');
            assert.ok(Array.isArray(data.candidates));
            assert.ok(typeof data.tookMs === 'number');
        });
    });
});
