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
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProviderRegistry };
}
if (typeof window !== 'undefined') {
    window.ProviderRegistry = ProviderRegistry;
}
