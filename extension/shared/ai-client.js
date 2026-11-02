/**
 * extension/shared/ai-client.js
 *
 * Klien Groq API dengan error handling komprehensif & prompt guardrail.
 * Skema window global (bukan ES module).
 *
 * API Key dibaca dari chrome.storage.local (key: groqKey).
 */

class AIClient {
    constructor() {
        this.endpoint = 'https://api.groq.com/openai/v1/chat/completions';
        this.model = 'openai/gpt-oss-120b';
    }

    /**
     * Helper fetch ke Groq + parse JSON.
     * @param {string} prompt
     * @param {string} groqKey
     * @returns {Promise<object|null>}
     */
    async requestJson(prompt, groqKey) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            throw new Error("Koneksi internet terputus. Pastikan WiFi atau paket data Anda aktif.");
        }

        let response;
        try {
            response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + groqKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    temperature: 0.2
                })
            });
        } catch (fetchErr) {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                throw new Error("Koneksi internet terputus. Pastikan WiFi atau paket data Anda aktif.");
            }
            if (fetchErr && (fetchErr.message?.includes('Failed to fetch') || fetchErr.name === 'TypeError')) {
                throw new Error("Gagal terhubung ke layanan AI (Groq). Periksa koneksi internet Anda.");
            }
            throw fetchErr;
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error("API Key Groq tidak valid. Silakan periksa di menu Settings.");
            }
            if (response.status === 429) {
                throw new Error("Batas kuota Groq API tercapai (Rate Limit). Coba beberapa saat lagi.");
            }
            let detail = '';
            try {
                detail = await response.text();
            } catch (e) {
                detail = '';
            }
            throw new Error(`Groq API error (HTTP ${response.status})${detail ? ': ' + detail : ''}`);
        }

        const data = await response.json();
        const content = data && data.choices && data.choices[0]
            && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('Respons AI kosong.');

        return JSON.parse(content);
    }

    /**
     * Prompt untuk memahami produk.
     * @param {object} rawProduct
     * @returns {string}
     */
    buildPrompt(rawProduct) {
        const title = (rawProduct && rawProduct.title) || '-';
        const description = (rawProduct && rawProduct.description) || '-';
        return `You are a shopping assistant. Extract product details. Return ONLY a JSON object with keys: brand, model, specifications (key-value pairs), and search_query (a highly specific string for Google Search combining brand, model, and critical specs like RAM/Storage. Example: 'ASUS X1404ZA i3 8GB 512GB'). Product Title: ${title}. Description: ${description}.`;
    }

    /**
     * Pahami produk via Groq.
     * @param {object} rawProduct
     * @returns {Promise<object|null>}
     */
    async understandProduct(rawProduct) {
        const { groqKey } = await chrome.storage.local.get(['groqKey']);
        if (!groqKey) {
            throw new Error("API Key Groq belum diisi. Silakan isi di menu Settings.");
        }

        return await this.requestJson(this.buildPrompt(rawProduct), groqKey);
    }

    /**
     * Deal Maker: Best Value + Cheapest Option.
     * Menggunakan guardrail harga ketat dan normalisasi spesifikasi.
     * @param {object} originalProduct
     * @param {Array} candidates
     * @returns {Promise<{best_value:object,cheapest_option:object,others:Array}|null>}
     */
    async evaluateDeals(originalProduct, candidates) {
        const { groqKey } = await chrome.storage.local.get(['groqKey']);
        if (!groqKey) {
            throw new Error("API Key Groq belum diisi. Silakan isi di menu Settings.");
        }

        const originalTitle = (originalProduct && originalProduct.title) || '-';
        const originalPrice = (originalProduct && originalProduct.price) ? Number(originalProduct.price) : null;
        const safeCandidates = Array.isArray(candidates) ? candidates : [];

        const priceRule = originalPrice
            ? `Original Product Price: Rp ${originalPrice.toLocaleString('id-ID')} (${originalPrice}).
STRICT PRICE GUARDRAILS FOR 'best_value':
1. MAXIMUM PRICE CAP: A candidate CANNOT be selected as 'best_value' if its price is more than 15% above the original product price (price > ${Math.round(originalPrice * 1.15)}), UNLESS it provides an undeniable, major specification upgrade (e.g. double RAM, larger storage, superior processor) that justifies the extra price.
2. HARD PRICE CEILING: NEVER select a candidate that is over 50% more expensive (> ${Math.round(originalPrice * 1.5)}) as 'best_value' under ANY circumstance, even if it is a famous brand (Apple, Asus, Samsung, Logitech, etc.). If the original product is a budget item (e.g. Rp 50.000), recommending a Rp 500.000 premium item as best_value is STRICTLY FORBIDDEN.
3. If no candidate offers a better or equal value deal within the price limit, pick the candidate with the closest price and exact matching specifications.`
            : `STRICT RULES FOR 'best_value': Prioritize exact specification match and reasonable value.`;

        const prompt = `You are an expert shopping consultant.
Analyze these alternatives for original product: "${originalTitle}".
${priceRule}

Candidate alternatives:
${JSON.stringify(safeCandidates)}

TASK: Categorize candidates into:
1. 'best_value': Find the BEST OVERALL deal obeying the strict price rules above.
   Explain why in 1 short Indonesian sentence (e.g., 'Spek persis sama dan harga lebih hemat').
2. 'cheapest_option': Find the ABSOLUTE CHEAPEST relevant option that belongs to the same product category.
   Explain the trade-off in 1 short Indonesian sentence (e.g., 'Paling murah tapi spek standar').
3. 'others': Remaining candidates.

SPEC MATCHING INSTRUCTIONS:
- Normalize whitespace and symbols when comparing specifications (e.g., '8GB' == '8 GB', '512GB' == '512 GB', 'i5-12400' == 'i5 12400').
- For each product, evaluate 'spec_status':
  - 'EXACT': Same core specs / capacity / model tier.
  - 'UPGRADE': Verifiably superior specs (e.g. 16GB vs 8GB, 1TB vs 512GB).
  - 'DOWNGRADE': Inferior specs.
  - 'UNKNOWN': Specs cannot be verified from the snippet.

PRICE INSTRUCTIONS:
- Return price as integer (e.g. 1700000), NOT a string.
- If the price is weird (like 1 or 0), try to find the real price in the text or set it to null.

IMPORTANT: Return ONLY valid JSON matching this exact schema:
{
  "best_value": {
    "title": "",
    "url": "",
    "price": 0,
    "spec_status": "EXACT",
    "reason": ""
  },
  "cheapest_option": {
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
     * @param {string} productTitle
     * @param {Array<string>} reviews
     * @returns {string}
     */
    buildReviewSummaryPrompt(productTitle, reviews) {
        const reviewListText = reviews.map((r, idx) => `[Ulasan ${idx + 1}]: "${r}"`).join('\n');
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
1. "pros": 2 to 4 bullet points of genuine product strengths (build quality, performance, accurate description). Write in clear, concise Indonesian.
2. "cons": 2 to 4 bullet points of drawbacks or minor weaknesses (e.g., fan noise, battery life, tricky setup, plastic feel). Write in clear, concise Indonesian.
3. "risks": 1 to 3 critical RED FLAGS or warnings for buyers (e.g., high defect rate, suspected counterfeit/KW, easily broken parts, misleading photos, seller refused warranty). If no major risk exists, state "Tidak ditemukan resiko fatal pada ulasan."
4. "confidence": "HIGH" (if >= 10 substantive reviews), "MEDIUM" (if 3-9 reviews), "LOW" (if 1-2 reviews or reviews are vague). ${confidenceInstruction}

RULES:
- Ignore logistics/courier praise (e.g. "kurir ramah", "pengiriman kilat") — focus 100% on the product and seller integrity.
- Be objective and concise (1 short sentence per point).
- Return ONLY a valid JSON object matching this schema:
{
  "pros": ["Keunggulan 1", "Keunggulan 2"],
  "cons": ["Kekurangan 1", "Kekurangan 2"],
  "risks": ["Resiko atau Red Flag 1"],
  "confidence": "HIGH"
}`;
    }

    /**
     * (Review Intelligence) Meringkas ulasan pembeli via Groq AI.
     * Mengembalikan objek pros, cons, risks, dan confidence.
     * @param {string} productTitle
     * @param {Array<string>} reviews
     * @returns {Promise<{pros:Array, cons:Array, risks:Array, confidence:string, status?:string}|null>}
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

            return {
                pros: Array.isArray(result.pros) ? result.pros : [],
                cons: Array.isArray(result.cons) ? result.cons : [],
                risks: Array.isArray(result.risks) ? result.risks : [],
                confidence: result.confidence || (reviews.length >= 10 ? "HIGH" : (reviews.length >= 3 ? "MEDIUM" : "LOW")),
                status: "SUCCESS"
            };
        } catch (error) {
            console.error('[Shopping Intelligence] summarizeReviews error:', error);
            throw error;
        }
    }
}

// Bind ke window object
window.AIClient = AIClient;
