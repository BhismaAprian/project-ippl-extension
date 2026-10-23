/**
 * extension/shared/ai-client.js
 *
 * Klien Groq API (anti-crash: semua error ditangkap, return null).
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
     * Helper fetch ke Groq + parse JSON, anti-crash.
     * @param {string} prompt
     * @param {string} groqKey
     * @returns {Promise<object|null>}
     */
    async requestJson(prompt, groqKey) {
        try {
            const response = await fetch(this.endpoint, {
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

            if (!response.ok) {
                let detail = '';
                try {
                    detail = await response.text();
                } catch (e) {
                    detail = '';
                }
                throw new Error(`Groq API error ${response.status}${detail ? ': ' + detail : ''}`);
            }

            const data = await response.json();
            const content = data && data.choices && data.choices[0]
                && data.choices[0].message && data.choices[0].message.content;
            if (!content) throw new Error('Respons AI kosong.');

            return JSON.parse(content);
        } catch (error) {
            console.error('[Shopping Intelligence] AIClient error:', error);
            return null;
        }
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
     * Pahami produk via Groq. Return null kalau gagal.
     * @param {object} rawProduct
     * @returns {Promise<object|null>}
     */
    async understandProduct(rawProduct) {
        const { groqKey } = await chrome.storage.local.get(['groqKey']);
        if (!groqKey) {
            throw new Error("API Key Groq belum diisi.");
        }

        try {
            return await this.requestJson(this.buildPrompt(rawProduct), groqKey);
        } catch (error) {
            console.error('[Shopping Intelligence] understandProduct error:', error);
            return null;
        }
    }

    /**
     * Deal Maker: Best Value + Cheapest Option.
     * Return null kalau gagal (jangan throw).
     * @param {object} originalProduct
     * @param {Array} candidates
     * @returns {Promise<{best_value:object,cheapest_option:object,others:Array}|null>}
     */
    async evaluateDeals(originalProduct, candidates) {
        const { groqKey } = await chrome.storage.local.get(['groqKey']);
        if (!groqKey) {
            throw new Error("API Key Groq belum diisi.");
        }

        try {
            const originalTitle = (originalProduct && originalProduct.title) || '-';
            const safeCandidates = Array.isArray(candidates) ? candidates : [];

            const prompt = `You are an expert shopping consultant. Analyze these alternatives for ${originalTitle}. Data: ${JSON.stringify(safeCandidates)}. Categorize them into: 1. 'best_value': Find the BEST OVERALL deal. Prioritize EXACT spec match, trusted brand (like ASUS, Apple, Samsung); a slightly higher price is okay if the value is high. Explain why in 1 short Indonesian sentence (e.g., 'Ini lebih bagus karena brand ternama dan spek persis'). 2. 'cheapest_option': Find the ABSOLUTE CHEAPEST option. Even if spec is slightly lower or brand is less known, explain the trade-off in 1 short Indonesian sentence (e.g., 'Ini brand agak kurang tapi masih worthit dengan harga segini'). 3. 'others': Remaining candidates. IMPORTANT: If a candidate has isDirectProduct: false, add a warning in its reason ('Hati-hati: Ini hanya halaman pencarian, bukan produk langsung'). IMPORTANT: If you extract a price, return it as an integer (e.g., 1700000), NOT a string. If the price is weird (like 1), try to find the real price in the text or set it to null. IMPORTANT: Return ONLY valid JSON matching this exact schema: { "best_value": { "title": "", "url": "", "price": 0, "reason": "" }, "cheapest_option": { "title": "", "url": "", "price": 0, "reason": "" }, "others": [ { "title": "", "url": "", "price": 0, "reason": "" } ] }.`;

            return await this.requestJson(prompt, groqKey);
        } catch (error) {
            console.error('[Shopping Intelligence] evaluateDeals error:', error);
            return null;
        }
    }
}

// Bind ke window object
window.AIClient = AIClient;
