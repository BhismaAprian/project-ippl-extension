class SearchClient {
    /**
     * Helper: Ekstrak harga dari teks snippet
     */
    extractPrice(text) {
        if (!text) return null;
        const match = text.match(/(?:Rp|IDR)\s*([\d\.,]+)/i);
        if (match && match[1]) {
            const cleanNumber = match[1].replace(/[.,]/g, '');
            return cleanNumber ? parseInt(cleanNumber, 10) : null;
        }
        return null;
    }

    /**
     * Helper: Tentukan apakah link ini produk langsung atau halaman pencarian
     */
    isDirectProduct(url, marketplace) {
        if (!url) return false;
        const lowerUrl = url.toLowerCase();

        // Buang link pencarian / find
        if (lowerUrl.includes('/find/') || lowerUrl.includes('/search') || lowerUrl.includes('?q=')) {
            return false;
        }

        // Cek pola khas tiap marketplace
        if (marketplace === 'Tokopedia') {
            return lowerUrl.includes('tokopedia.com/') && !lowerUrl.includes('/find/');
        }
        if (marketplace === 'Shopee') {
            return lowerUrl.includes('shopee.co.id/') && lowerUrl.includes('-i.');
        }
        if (marketplace === 'Lazada') {
            return lowerUrl.includes('lazada.co.id/') && lowerUrl.includes('-i');
        }
        return true;
    }

    /**
     * Helper: Deteksi marketplace dari URL
     */
    getMarketplace(url) {
        if (!url) return 'Unknown';
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes('shopee')) return 'Shopee';
        if (lowerUrl.includes('tokopedia')) return 'Tokopedia';
        if (lowerUrl.includes('lazada')) return 'Lazada';
        if (lowerUrl.includes('blibli')) return 'Blibli';

        // Fallback: ekstrak nama domain dari URL (mis. "geheugen.nl", "els.id")
        try {
            const host = new URL(url).hostname.replace(/^www\./i, '');
            return host || 'Unknown';
        } catch (e) {
            const cleaned = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
            return cleaned || 'Unknown';
        }
    }

    /**
     * Fungsi Utama: Mencari alternatif menggunakan Exa API
     */
    async searchAlternatives(rawProduct, aiData) {
        const { exaKey } = await chrome.storage.local.get(['exaKey']);
        if (!exaKey) {
            throw new Error("API Key Exa belum diisi.");
        }

        try {
            // 1. TENTUKAN QUERY (ANTI-GAGAL)
            let query = "";
            if (aiData && aiData.search_query && aiData.search_query.trim() !== "") {
                query = aiData.search_query.trim();
            } else {
                // Fallback: bersihkan judul mentah Shopee
                query = rawProduct.title
                    .replace(/[^a-zA-Z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            console.log("[EXA] Mengirim Query:", query);

            // 2. FETCH KE EXA API
            const response = await fetch('https://api.exa.ai/search', {
                method: 'POST',
                headers: {
                    'x-api-key': exaKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    numResults: 10,
                    type: "auto",
                    includeDomains: ["shopee.co.id", "tokopedia.com", "lazada.co.id", "blibli.com"],
                    contents: {
                        text: { maxCharacters: 500 }
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Exa API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log("[EXA] Raw data dari API:", JSON.stringify(data));
            console.log("[EXA] Raw Response:", data);

            if (!data.results || !Array.isArray(data.results)) {
                console.warn("[EXA] Format response tidak valid atau kosong.");
                return [];
            }

            // 3. PARSING HASIL
            const candidates = data.results.map(item => {
                const marketplace = this.getMarketplace(item.url);
                const snippet = item.text || item.snippet || "";
                return {
                    title: item.title || "Tanpa Judul",
                    url: item.url,
                    snippet: snippet.length > 200 ? snippet.substring(0, 200) + "..." : snippet,
                    marketplace: marketplace,
                    isDirectProduct: this.isDirectProduct(item.url, marketplace),
                    price: this.extractPrice(snippet)
                };
            });

            // 4. BUANG LINK YANG BUKAN PRODUK LANGSUNG ATAU TANPA HARGA (Opsional tapi disarankan)
            // Jika Anda ingin tetap menampilkan semua, comment baris filter di bawah ini.
            const filteredCandidates = candidates.filter(c => c.isDirectProduct || c.price !== null);

            console.log(`[EXA] Ditemukan ${candidates.length} hasil, ${filteredCandidates.length} setelah difilter.`);
            return filteredCandidates;

        } catch (error) {
            console.error("[EXA] Fatal Error:", error);
            return [];
        }
    }
}

window.SearchClient = SearchClient;
