/**
 * extension/shared/provider-registry.js
 * 
 * Registry modular untuk mendaftarkan dan mengorkestrasi seluruh search provider.
 * Menyediakan pengurutan berbasis prioritas dan pengecekan ketersediaan provider.
 */

class ProviderRegistry {
    constructor() {
        this.providers = new Map();
    }

    /**
     * Mendaftarkan provider baru ke dalam registry
     * @param {object} provider - Objek yang mengimplementasikan BaseSearchProvider
     */
    registerProvider(provider) {
        if (!provider || typeof provider.getName !== 'function') {
            throw new Error('Provider must implement getName()');
        }

        const name = provider.getName();
        if (!name || typeof name !== 'string' || !name.trim()) {
            throw new Error('Provider getName() must return a non-empty string');
        }

        if (typeof provider.getPriority !== 'function') {
            throw new Error('Provider must implement getPriority()');
        }

        if (typeof provider.isAvailable !== 'function') {
            throw new Error('Provider must implement isAvailable()');
        }

        if (typeof provider.search !== 'function') {
            throw new Error('Provider must implement search()');
        }

        this.providers.set(name.trim().toLowerCase(), provider);
    }

    /**
     * Mengambil instance provider berdasarkan nama
     * @param {string} name 
     * @returns {object|undefined}
     */
    getProvider(name) {
        if (!name || typeof name !== 'string') return undefined;
        return this.providers.get(name.trim().toLowerCase());
    }

    /**
     * Mengambil seluruh provider terdaftar, terurut ascending berdasarkan prioritas (1 s/d 5)
     * @returns {Array<object>}
     */
    getProvidersByPriority() {
        return Array.from(this.providers.values()).sort((a, b) => {
            const pA = Number(a.getPriority()) || 999;
            const pB = Number(b.getPriority()) || 999;
            return pA - pB;
        });
    }

    /**
     * Mengambil provider yang saat ini siap digunakan (isAvailable === true),
     * tetap terurut ascending berdasarkan prioritas.
     * @returns {Promise<Array<object>>}
     */
    async getAvailableProviders() {
        const sorted = this.getProvidersByPriority();
        const available = [];

        for (const provider of sorted) {
            try {
                const isReady = await Promise.resolve(provider.isAvailable());
                if (isReady === true) {
                    available.push(provider);
                }
            } catch (err) {
                // Provider melempar error saat availability check, abaikan provider ini
            }
        }

        return available;
    }

    /**
     * Mengosongkan seluruh provider terdaftar (berguna untuk testing/reset)
     */
    clear() {
        this.providers.clear();
    }

    /**
     * Menjalankan pencarian bertingkat terstratifikasi per marketplace (ADR-12 / T4.14)
     * Kuota: Minimal 4 kandidat mentah per marketplace.
     * Fallback Scoped: Memanggil ExaProvider dengan includeDomains spesifik jika provider mandiri
     * mengembalikan status BLOCKED, TIMEOUT, atau menghasilkan kurang dari 2 kandidat.
     * 
     * @param {string|object} queryOrFp - Kueri atau fingerprint produk
     * @param {object} [options={}] - Opsi pencarian { exaProvider, targetMarketplaces, minCandidatesPerPlatform }
     * @returns {Promise<Array<object>>} Kandidat terstratifikasi dan terdeduplikasi kanonikal
     */
    async searchStratified(queryOrFp, options = {}) {
        const targetMarketplaces = options.targetMarketplaces || ['shopee', 'tokopedia', 'lazada', 'blibli'];
        const minCandidates = options.minCandidatesPerPlatform || 4;
        const domainMap = {
            shopee: ['shopee.co.id'],
            tokopedia: ['tokopedia.com'],
            lazada: ['lazada.co.id'],
            blibli: ['blibli.com']
        };

        const exa = options.exaProvider || this.getProvider('exa');
        const resultsByMarketplace = {};
        for (const m of targetMarketplaces) {
            resultsByMarketplace[m] = [];
        }

        // 1. Jalankan pencarian mandiri (prioritas 2 / 3) per marketplace
        for (const m of targetMarketplaces) {
            const nativeProv = this.getProvider(`${m}-native`) || this.getProvider(m);
            if (nativeProv) {
                try {
                    const isAvail = await Promise.resolve(nativeProv.isAvailable(options));
                    if (isAvail) {
                        const items = await nativeProv.search(queryOrFp, options);
                        if (Array.isArray(items)) {
                            resultsByMarketplace[m].push(...items);
                        }
                    }
                } catch (err) {
                    console.info(`[ProviderRegistry] Provider ${m} terkendala (${err.status || err.message}). Menyiapkan Scoped Fallback.`);
                }
            }

            // 2. Evaluasi kuota kandidat: jika < 2 atau provider gagal, jalankan Scoped Fallback Exa
            if (resultsByMarketplace[m].length < 2 && exa) {
                try {
                    const exaAvail = await Promise.resolve(exa.isAvailable(options));
                    if (exaAvail) {
                        const scopedDomains = domainMap[m] || [`${m}.co.id`, `${m}.com`];
                        const exaOptions = {
                            ...options,
                            includeDomains: scopedDomains,
                            numResults: Math.max(10, minCandidates * 2)
                        };
                        const fallbackItems = await exa.search(queryOrFp, exaOptions);
                        if (Array.isArray(fallbackItems)) {
                            for (const fbItem of fallbackItems) {
                                fbItem.provenance = 'exa-scoped-fallback';
                                fbItem.marketplace = m;
                            }
                            resultsByMarketplace[m].push(...fallbackItems);
                        }
                    }
                } catch (exaErr) {
                    console.warn(`[ProviderRegistry] Scoped Fallback Exa untuk ${m} gagal:`, exaErr.message);
                }
            }
        }

        // 3. Alokasi kuota berimbang per marketplace (minimal 4 kandidat per platform) & Deduplikasi Kanonikal
        const seenUrls = new Set();
        const mergedCandidates = [];

        // Ronde 1: Ambil hingga minCandidates (minimal 4) per marketplace
        for (const m of targetMarketplaces) {
            const list = resultsByMarketplace[m] || [];
            const quota = list.slice(0, Math.max(minCandidates, 4));
            for (const item of quota) {
                const canonUrl = canonicalizeUrl(item.url);
                if (canonUrl && !seenUrls.has(canonUrl)) {
                    seenUrls.add(canonUrl);
                    item.canonicalUrl = canonUrl;
                    mergedCandidates.push(item);
                }
            }
        }

        // Ronde 2: Tambahkan sisa kandidat jika ada
        for (const m of targetMarketplaces) {
            const list = resultsByMarketplace[m] || [];
            if (list.length > minCandidates) {
                for (const item of list.slice(minCandidates)) {
                    const canonUrl = canonicalizeUrl(item.url);
                    if (canonUrl && !seenUrls.has(canonUrl)) {
                        seenUrls.add(canonUrl);
                        item.canonicalUrl = canonUrl;
                        mergedCandidates.push(item);
                    }
                }
            }
        }

        return mergedCandidates;
    }
}

/**
 * Deduplikasi dan kanonikalisasi URL (mengabaikan parameter tracking) (ADR-12 / T4.14)
 * @param {string} url 
 * @returns {string}
 */
function canonicalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const u = new URL(url);
        const trackingParams = ['spm', 'src', 'extparam', 'track', 'wh_pid', 'scm', 'laz_token', 'click_id'];
        const toDelete = [];
        for (const [k] of u.searchParams.entries()) {
            const lowerK = k.toLowerCase();
            if (lowerK.startsWith('utm_') || trackingParams.includes(lowerK)) {
                toDelete.push(k);
            }
        }
        for (const k of toDelete) {
            u.searchParams.delete(k);
        }
        let pathname = u.pathname;
        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }
        const searchStr = u.searchParams.toString();
        return u.origin + pathname + (searchStr ? '?' + searchStr : '');
    } catch (e) {
        return url.split('?')[0].replace(/\/+$/, '');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProviderRegistry, canonicalizeUrl };
}
if (typeof window !== 'undefined') {
    window.ProviderRegistry = ProviderRegistry;
    window.canonicalizeUrl = canonicalizeUrl;
}
