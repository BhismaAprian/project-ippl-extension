/**
 * ai-client.js
 * 
 * Bertanggung jawab memanggil Groq API untuk:
 * 1. understandProduct: mengekstrak query pencarian bersih dan atribut produk
 * 2. evaluateDeals: mengevaluasi deal terbaik (Best Value & Cheapest)
 * 3. summarizeReviews: menganalisis ulasan pembeli (Pros, Cons, Risks) dengan click-to-scroll review anchor
 * 4. evaluateUltimateDeal: Deal Checker komprehensif (BUY / CHECK / WAIT) dengan formula 40% Harga, 40% Ulasan, 20% Garansi
 */

class AIClient {
    constructor() {
        this.endpoint = window.GROQ_API_ENDPOINT || 'https://api.groq.com/openai/v1/chat/completions';
        // Model utama: openai/gpt-oss-120b. Jika GROQ_MODEL sebelumnya 'llama-3.3-70b-versatile', otomatis ubah ke openai/gpt-oss-120b
        const configuredModel = window.GROQ_MODEL;
        this.model = (configuredModel && configuredModel !== 'llama-3.3-70b-versatile') ? configuredModel : 'openai/gpt-oss-120b';
        this.fallbackModel = 'llama-3.1-70b-versatile';
    }

    /**
     * Helper untuk memanggil Groq API dengan JSON schema/response format.
     * Menggunakan model openai/gpt-oss-120b di Groq yang mendukung response_format: { type: "json_object" }.
     * Jika terjadi error 404 (model tidak ditemukan), otomatis fallback ke llama-3.1-70b-versatile.
     */
    async requestJson(prompt, groqKey, preferredModel = null) {
        let modelToUse = preferredModel || this.model;
        if (modelToUse === 'llama-3.3-70b-versatile') {
            modelToUse = 'openai/gpt-oss-120b';
        }

        let response;
        try {
            response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model: modelToUse,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.1
                })
            });
        } catch (netErr) {
            if (!navigator.onLine || netErr?.message?.includes('Failed to fetch')) {
                throw new Error("Koneksi internet terputus. Pastikan WiFi atau paket data Anda aktif.");
            }
            throw netErr;
        }

        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch (e) { }

            // Resilient Fallback: jika model tidak ditemukan (404), fallback ke llama-3.1-70b-versatile
            if (response.status === 404 && modelToUse !== this.fallbackModel &&
                (errorBody.includes('does not exist') || errorBody.includes('model_not_found') || errorBody.includes('not found'))) {
                console.warn(`[AIClient] Model ${modelToUse} tidak ditemukan di Groq (404). Mencoba fallback ke ${this.fallbackModel}...`);
                return await this.requestJson(prompt, groqKey, this.fallbackModel);
            }

            if (response.status === 401 || response.status === 403) {
                throw new Error("Groq API Key tidak valid atau kedaluwarsa. Periksa kembali di menu Settings.");
            }
            if (response.status === 429) {
                throw new Error("Batas kuota Groq API tercapai (Rate Limit 429). Silakan tunggu beberapa saat.");
            }

            throw new Error(`Groq API error (${response.status}): ${errorBody || response.statusText}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("Respon Groq API kosong.");
        }

        try {
            return JSON.parse(content);
        } catch (e) {
            throw new Error("Gagal mem-parsing format JSON dari Groq: " + content.substring(0, 100));
        }
    }

    /**
     * Memahami produk asal dan menghasilkan query bersih serta atribut penting.
     */
    async understandProduct(product) {
        const { groqKey } = await chrome.storage.local.get(['groqKey']);
        if (!groqKey) {
            throw new Error("API Key Groq belum diisi. Silakan isi di menu Settings.");
        }

        const prompt = `You are an expert Indonesian e-commerce search specialist and strict product categorizer.
Analyze this product and extract a clean, concise search query along with strict categorization metadata for finding identical or near-identical alternatives on other marketplaces (Shopee, Tokopedia, Lazada).

Product:
- Title: "${product.title || ''}"
- Description: "${(product.description || '').substring(0, 300)}"

Instructions:
1. "clean_query": 3 to 6 words maximum. Must contain ONLY: brand + core product name + critical model/spec (e.g. "iPhone 13 128GB", "Logitech G102 Lightsync", "Novilla Kasur Springbed 90x200"). REMOVE ALL fluff like "PROMO", "MURAH", "ORIGINAL", "GARANSI RESMI", "TERLARIS", store names, location, etc.
2. "brand": Brand name if clear, else null.
3. "category": Main product category in Indonesian. MUST BE PRECISE and SPECIFIC (e.g. "Springbed", "RAM Laptop SODIMM", "Mouse Gaming", "Smartphone"). DO NOT use overly broad categories like "Furnitur", "Perabot Rumah", or "Aksesoris Elektronik".
4. "core_keywords": Array of 2 to 5 essential keywords that define the core product entity itself (e.g. for Springbed: ["springbed", "kasur", "pocket spring"]; for RAM Laptop: ["ram", "sodimm", "ddr4"]).
5. "banned_terms": Array of 4 to 10 negative keywords representing accessories, spare parts, or completely different product types that MUST NEVER be accepted as alternatives.
   - Example for "Springbed": ["angin", "tiup", "air mattress", "inflatable", "pompa"] (NOTE: DO NOT ban "bantal", "cover", or "sprei" as they are commonly included as bonuses/features in mattress listings)
   - Example for "Laptop": ["tas", "sleeve", "skin", "stand", "cooler", "charger", "casing"]
   - Example for "RAM": ["caddy", "enclosure", "longdimm", "desktop", "kabel", "baut"]
6. "core_specs": Array of key specs found (e.g. ["160x200", "pocket spring"] or ["128GB", "8GB RAM"]).

Return ONLY a valid JSON object matching this schema:
{
  "clean_query": "",
  "brand": "",
  "category": "",
  "core_keywords": [],
  "banned_terms": [],
  "core_specs": []
}`;

        const result = await this.requestJson(prompt, groqKey);
        if (result && typeof result === 'object') {
            const query = (result.clean_query || result.search_query || '').trim();
            result.clean_query = query;
            result.search_query = query;
            if (!Array.isArray(result.core_keywords)) {
                result.core_keywords = [];
            }
            if (!Array.isArray(result.banned_terms)) {
                result.banned_terms = [];
            } else {
                // Hapus istilah aksesoris/bonus kasur dari daftar banned terms agar tidak menolak produk kasur asli
                const accessoryWhitelist = ['bantal', 'guling', 'cover', 'sprei', 'seprai', 'sarung', 'bed cover'];
                result.banned_terms = result.banned_terms.filter(t => {
                    const termLower = String(t || '').trim().toLowerCase();
                    return termLower && !accessoryWhitelist.includes(termLower);
                });
            }
        }
        return result;
    }

    /**
     * Mengevaluasi kandidat produk alternatif dan memilih Best Value serta Cheapest Deal.
     * Menggunakan Strict Category Gatekeeper untuk mencegah pergantian tipe produk.
     */
    async evaluateDeals(originalProduct, candidates, aiData = null) {
        const { groqKey } = await chrome.storage.local.get(['groqKey']);
        if (!groqKey) {
            throw new Error("API Key Groq belum diisi. Silakan isi di menu Settings.");
        }

        const originalPrice = originalProduct.price || 0;
        const targetCategory = (aiData && aiData.category) ? aiData.category : 'Sama dengan produk asal';
        const candidatesText = candidates.map((c, idx) =>
            `[${idx}] Title: "${c.title}" | Price: Rp ${c.price || 'Unknown'} | URL: ${c.url} | Snippet: "${(c.snippet || '').substring(0, 150)}"`
        ).join('\n');

        const prompt = `You are a strict shopping auditor helping Indonesian buyers find legitimate alternative deals on Tokopedia/Shopee/Lazada.

Original Product:
- Title: "${originalProduct.title}"
- Price: Rp ${originalPrice}
- Target Strict Category: "${targetCategory}"

Alternative Candidates:
${candidatesText}

CRITICAL GATEKEEPER RULES:
1. STRICT CATEGORY ISOLATION:
   You MUST enforce the exact same product category.
   - A "Springbed" CANNOT be replaced by an "Air Mattress" ("Matras Angin"), "Topper", "Bed Cover", "Sprei", or "Bantal", even if 95% cheaper!
   - A "Laptop" CANNOT be replaced by a "Laptop Sleeve", "Cooling Pad", or "Charger".
   - A "RAM SODIMM Laptop" CANNOT be replaced by "RAM LongDIMM PC Desktop".
   - If a candidate belongs to a different category, accessory, or subcategory, IT MUST NOT be selected as "best_value" or "cheapest".
   - If NO candidate matches the exact product category, you MUST set best_value: null and cheapest: null.
2. "best_value": The alternative that offers the best balance of price, specifications, and brand credibility for the EXACT SAME PRODUCT CATEGORY.
   - PRICE GUARDRAIL: A candidate MUST NOT be selected as "best_value" if its price is more than 15% higher than original price (Rp ${originalPrice}), unless it represents a clear upgrade in primary specifications. Under NO circumstances choose a candidate > 50% more expensive.
   - Do NOT choose candidates with suspiciously low prices (e.g. < 20% of original price) as best_value because they are likely accessories or counterfeit.
3. "cheapest": The lowest-priced candidate that is a 100% genuine category match (NOT an accessory, replacement part, air mattress, cover, or case). If no legitimate match exists, set to null.
4. "spec_status": For best_value, cheapest, AND all items in "others", assign one of:
   - "EXACT": identical product type and specifications.
   - "UPGRADE": better specs (e.g., 256GB vs 128GB, higher density/frequency).
   - "DOWNGRADE": lower specs (e.g., 64GB vs 128GB, thinner foam).
   - "DIFFERENT": different model, variant, or minor specification divergence.
5. "others": Include up to 10 valid alternatives that match the category. For each, specify title, url, price, spec_status, and reason.

Return ONLY a valid JSON object matching this schema:
{
  "best_value": {
    "title": "",
    "url": "",
    "price": 0,
    "spec_status": "EXACT",
    "reason": ""
  },
  "cheapest": {
    "title": "",
    "url": "",
    "price": 0,
    "spec_status": "EXACT",
    "reason": ""
  },
  "others": [
    {
      "title": "",
      "url": "",
      "price": 0,
      "spec_status": "EXACT",
      "reason": ""
    }
  ]
}`;

        return await this.requestJson(prompt, groqKey);
    }

    /**
     * Helper: Buat prompt untuk ringkasan ulasan pembeli (Review Intelligence)
     * Mendukung pemetaan referensi ulasan (cmtId / reviewIndex) untuk fitur click-to-scroll
     */
    buildReviewSummaryPrompt(productTitle, reviews) {
        const reviewListText = reviews.map((r, idx) => {
            const text = typeof r === 'string' ? r : (r.text || '');
            const cmtId = typeof r === 'object' && r.cmtId ? r.cmtId : String(idx);
            return `[ID: ${cmtId} | No: ${idx + 1}]: "${text}"`;
        }).join('\n');

        const count = reviews.length;
        const confidenceInstruction = count <= 2
            ? 'CONFIDENCE RULE: There are only 1-2 reviews, so you MUST set "confidence": "LOW".'
            : (count >= 10 ? 'CONFIDENCE RULE: There are 10 or more reviews, set "confidence": "HIGH".' : 'CONFIDENCE RULE: There are 3-9 reviews, set "confidence": "MEDIUM".');

        return `You are an elite product quality analyst and consumer risk auditor for Indonesian e-commerce.
Analyze customer reviews for the following product:
Product: "${productTitle || '-'}"

Reviews Data:
${reviewListText}

TASK:
Identify true product qualities and operational red flags based ONLY on the provided reviews.
Categorize findings into:
1. "pros": 2 to 4 bullet points of genuine product strengths. For each point, provide "text" and "ref_id" (the ID of the review that best supports this point).
2. "cons": 2 to 4 bullet points of genuine drawbacks or weaknesses. For each point, provide "text" and "ref_id".
3. "risks": 1 to 3 critical RED FLAGS or warnings for buyers (e.g., high defect rate, suspected counterfeit/KW, easily broken parts, misleading photos, seller refused warranty). For each risk, provide "text" and "ref_id". If no major risk exists, set text to "Tidak ditemukan resiko fatal pada ulasan." and ref_id to null.
4. "confidence": "HIGH" (if >= 10 substantive reviews), "MEDIUM" (if 3-9 reviews), "LOW" (if 1-2 reviews or reviews are vague). ${confidenceInstruction}

RULES:
- Ignore logistics/courier praise (e.g. "kurir ramah", "pengiriman kilat") — focus 100% on the product and seller integrity.
- Be objective and concise in Indonesian.
- Return ONLY a valid JSON object matching this schema:
{
  "pros": [
    { "text": "Kualitas material kasur empuk dan adem", "ref_id": "0" }
  ],
  "cons": [
    { "text": "Baterai cepat panas saat pemakaian intensif", "ref_id": "3" }
  ],
  "risks": [
    { "text": "Pengemasan tipis tanpa bubble wrap rentan retak", "ref_id": "1" }
  ],
  "confidence": "HIGH"
}`;
    }

    /**
     * (Review Intelligence) Meringkas ulasan pembeli via Groq AI.
     * Mengembalikan objek pros, cons, risks, dan confidence dengan referensi ref_id untuk click-to-scroll.
     */
    async summarizeReviews(productTitle, reviews) {
        if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
            return {
                pros: [],
                cons: [],
                risks: [],
                confidence: "LOW",
                status: "NO_REVIEWS",
                message: "Belum ada ulasan pembeli yang dapat dianalisis untuk produk ini."
            };
        }

        const { groqKey } = await chrome.storage.local.get(['groqKey']);
        if (!groqKey) {
            throw new Error("API Key Groq belum diisi. Silakan isi di menu Settings.");
        }

        try {
            const prompt = this.buildReviewSummaryPrompt(productTitle, reviews);
            const result = await this.requestJson(prompt, groqKey);

            if (!result || typeof result !== 'object') {
                throw new Error("Gagal memproses ringkasan ulasan dari AI.");
            }

            // Normalisasi output pros/cons/risks agar seragam (baik string murni maupun objek { text, ref_id })
            const formatList = (arr) => {
                if (!Array.isArray(arr)) return [];
                return arr.map((item, idx) => {
                    if (typeof item === 'string') {
                        return { text: item, ref_id: null, index: idx };
                    }
                    if (item && typeof item === 'object') {
                        return {
                            text: item.text || String(item),
                            ref_id: item.ref_id ? String(item.ref_id) : null,
                            index: idx
                        };
                    }
                    return null;
                }).filter(Boolean);
            };

            return {
                pros: formatList(result.pros),
                cons: formatList(result.cons),
                risks: formatList(result.risks),
                confidence: result.confidence || (reviews.length >= 10 ? "HIGH" : (reviews.length >= 3 ? "MEDIUM" : "LOW")),
                status: "SUCCESS"
            };
        } catch (e) {
            console.error('[AIClient] summarizeReviews error:', e);
            throw e;
        }
    }

    /**
     * (Ultimate Deal Checker) Mengevaluasi kelayakan pembelian produk: BUY / CHECK / WAIT.
     * Menggabungkan bobot: Harga (40%), Kualitas Ulasan (40%), dan Garansi (20%).
     * @param {object} product - Data produk asli
     * @param {Array<object>} recommendations - Produk serupa / rekomendasi alternatif
     * @param {object} reviewSummary - Hasil ringkasan ulasan AI
     * @param {object} aiData - Metadata kategori dan banned terms dari understandProduct
     * @returns {Promise<object>}
     */
    async evaluateUltimateDeal(product, recommendations = [], reviewSummary = null, aiData = null) {
        const origPrice = product.price || 0;
        const warranty = product.warrantyAudit || {};
        const rating = product.rating || 0;
        const reviewCount = product.reviewCount || 0;

        // 1. Perhitungan Matematis Deterministik Dasar
        let priceScore = 80; // Standar wajar
        let reviewScore = Math.min(100, Math.round((rating / 5.0) * 70 + (reviewCount > 10 ? 30 : (reviewCount > 0 ? 15 : 0))));
        let warrantyScore = 20;

        if (warranty.badgeType === 'OFFICIAL') {
            warrantyScore = 100;
        } else if (warranty.badgeType === 'STORE') {
            warrantyScore = 65;
        } else if (warranty.badgeType === 'WARNING') {
            warrantyScore = 35;
        } else {
            warrantyScore = 15;
        }

        // Cek apakah ada rekomendasi yang jauh lebih murah (dengan Strict Category & Price Guard)
        const bannedTerms = (aiData?.banned_terms || []).map(t => String(t).toLowerCase());
        const validRecs = recommendations.filter(r => {
            if (!r || !r.price || r.price <= 1000) return false;
            
            // Filter anomali harga aksesoris: jika harga asli signifikan, buang produk < 20% harga asli
            if (origPrice >= 100000 && r.price < (origPrice * 0.20)) {
                return false;
            }

            // Filter kata kunci terlarang (anti matras angin, caddy, aksesoris)
            const titleLower = (r.title || '').toLowerCase();
            const origTitleLower = (product.title || '').toLowerCase();
            const isMattress = origTitleLower.includes('kasur') || origTitleLower.includes('springbed') || origTitleLower.includes('spring bed') || origTitleLower.includes('matras');
            const hasCoreMattress = /\b(springbed|spring bed|kasur|matras)\b/i.test(titleLower);
            const hasBonus = /\b(bonus|gratis|free|\+|plus|include|termasuk|dapat|hadiah|paket|set)\b/i.test(titleLower);

            const hasBanned = bannedTerms.some(term => {
                if (!term || term.length <= 2) return false;
                if (!titleLower.includes(term)) return false;
                // Jangan buang jika kasur asli dan kandidat kasur hanya menyertakan bonus/fitur bantal/cover/sprei
                if (isMattress && hasCoreMattress && hasBonus && ['bantal', 'guling', 'cover', 'sprei', 'seprai', 'sarung'].includes(term)) {
                    return false;
                }
                return true;
            });

            if (hasBanned) {
                return false;
            }

            return true;
        });

        let cheaperRec = null;
        if (validRecs.length > 0 && origPrice > 0) {
            const minRec = validRecs.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), validRecs[0]);
            if (minRec.price < origPrice) {
                const diffPct = Math.round(((origPrice - minRec.price) / origPrice) * 100);
                if (diffPct >= 10) {
                    cheaperRec = {
                        ...minRec,
                        savings: `Hemat Rp ${(origPrice - minRec.price).toLocaleString('id-ID')} (${diffPct}%)`
                    };
                    priceScore = Math.max(30, 80 - diffPct);
                }
            }
        }

        // Penalti jika ada risiko fatal pada ulasan
        const hasFatalRisk = reviewSummary?.risks?.some(r =>
            r.text && !r.text.toLowerCase().includes('tidak ditemukan resiko') && !r.text.toLowerCase().includes('tidak ada resiko')
        );
        if (hasFatalRisk) {
            reviewScore = Math.max(20, reviewScore - 25);
        }

        // Penalti diskrepansi garansi
        if (warranty.hasDiscrepancy) {
            warrantyScore = Math.max(20, warrantyScore - 30);
        }

        // Skor Gabungan: 40% Harga + 40% Ulasan + 20% Garansi
        const compositeScore = Math.min(100, Math.max(10, Math.round(
            (priceScore * 0.40) + (reviewScore * 0.40) + (warrantyScore * 0.20)
        )));

        let verdict = 'CHECK';
        let verdictReason = 'Harga dan reputasi produk cukup seimbang. Periksa kembali ulasan dan garansi sebelum checkout.';

        if (compositeScore >= 80 && !hasFatalRisk && !warranty.hasDiscrepancy) {
            verdict = 'BUY';
            verdictReason = 'Pilihan solid! Harga kompetitif, reputasi pembeli positif, dan garansi terjamin.';
        } else if (compositeScore < 60 || hasFatalRisk || (cheaperRec && origPrice > 0 && (origPrice - cheaperRec.price) / origPrice > 0.25)) {
            verdict = 'WAIT';
            if (hasFatalRisk) {
                verdictReason = 'Tahan dulu! Terdeteksi resiko keluhan pembeli pada ulasan produk.';
            } else if (cheaperRec) {
                verdictReason = `Tahan dulu! Ditemukan produk alternatif serupa yang lebih hemat (${cheaperRec.savings}).`;
            } else {
                verdictReason = 'Tahan dulu! Harga cenderung lebih tinggi dari standar atau garansi tidak jelas.';
            }
        }

        return {
            verdict,
            dealScore: compositeScore,
            priceScore,
            reviewScore,
            warrantyScore,
            verdictReason,
            cheaperRecommendation: cheaperRec,
            evaluatedAt: new Date().toISOString()
        };
    }
}

// Bind ke window object
window.AIClient = AIClient;
