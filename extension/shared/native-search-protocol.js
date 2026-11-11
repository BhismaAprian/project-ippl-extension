/**
 * extension/shared/native-search-protocol.js
 * 
 * Generic Native Search Protocol.
 * Berjalan di Side Panel context dan mengorkestrasi pencarian native terbimbing
 * ke Service Worker (Brief Active Window tab lifecycle).
 * 
 * Karakteristik:
 * - HANYA mendukung mode tab (tidak ada mode fetch tersembunyi).
 * - Menjamin validasi query (anti query kosong).
 * - Berkomunikasi dengan Service Worker via runtime message START_NATIVE_SEARCH.
 * - Mengembalikan kandidat ternormalisasi (Unified Candidate Schema).
 */

const _normalizer = typeof require !== 'undefined'
    ? require('./candidate-normalizer.js')
    : (typeof window !== 'undefined' ? window.CandidateNormalizer : null);

class NativeSearchProtocol {
    /**
     * @param {object} manifest - Manifest deklaratif marketplace
     * @param {object} [options={}] - Opsi dependensi injeksi (misal: messageSender untuk testing)
     */
    constructor(manifest, options = {}) {
        if (!manifest || !manifest.id) {
            throw new Error('NativeSearchProtocol membutuhkan manifest yang valid dengan field id');
        }
        this.manifest = manifest;
        this.messageSender = options.messageSender || (
            typeof chrome !== 'undefined' && chrome.runtime?.sendMessage
                ? chrome.runtime.sendMessage.bind(chrome.runtime)
                : null
        );
    }

    /**
     * Menjalankan pencarian native terbimbing
     * @param {string|object} queryOrFingerprint - String pencarian atau objek fingerprint
     * @param {object} [options={}] - Opsi pencarian (fingerprint, timeout, onProgress)
     * @returns {Promise<Array<object>>} - Daftar NormalizedCandidate
     */
    async search(queryOrFingerprint, options = {}) {
        // 1. Ekstraksi dan Validasi Query (Anti-Query Kosong)
        let query = '';
        if (typeof queryOrFingerprint === 'string') {
            query = queryOrFingerprint.trim();
        } else if (queryOrFingerprint && typeof queryOrFingerprint === 'object') {
            query = (queryOrFingerprint.title || queryOrFingerprint.model || queryOrFingerprint.brand || '').trim();
        }

        query = query.replace(/[^\w\s-]/gi, ' ').replace(/\s+/g, ' ').trim();

        if (!query || query.length < 2) {
            console.warn(`[NativeSearchProtocol:${this.manifest.id}] Query kosong atau terlalu pendek (< 2 karakter).`);
            return [];
        }

        // 2. Validasi Ketersediaan Message Sender
        if (typeof this.messageSender !== 'function') {
            throw new Error('Chrome runtime messaging tidak tersedia untuk NativeSearchProtocol');
        }

        // 3. Kirim Pesan ke Service Worker
        const payload = {
            action: 'START_NATIVE_SEARCH',
            query: query,
            manifestId: this.manifest.id,
            manifest: this.manifest,
            fingerprint: options.fingerprint || (typeof queryOrFingerprint === 'object' ? queryOrFingerprint : null),
            options: {
                timeout: options.timeout || this.manifest.hydrationCheck?.timeout || 15000
            }
        };

        const response = await new Promise((resolve, reject) => {
            try {
                this.messageSender(payload, (resp) => {
                    const lastErr = typeof chrome !== 'undefined' && chrome.runtime?.lastError;
                    if (lastErr) {
                        return reject(new Error(lastErr.message || 'Gagal berkomunikasi dengan Service Worker'));
                    }
                    resolve(resp);
                });
            } catch (err) {
                reject(err);
            }
        });

        if (!response) {
            throw new Error('Tidak ada respon diterima dari Service Worker untuk pencarian native');
        }

        // 4. Evaluasi Respon Status
        if (response.status === 'BLOCKED') {
            const err = new Error(response.error || response.reason || 'Pencarian native dicegat verifikasi keamanan (CAPTCHA)');
            err.status = 'BLOCKED';
            err.marketplace = this.manifest.id;
            throw err;
        }

        if (response.status === 'CANCELLED_BY_USER') {
            const err = new Error('Pencarian dibatalkan karena tab ditutup oleh pengguna');
            err.status = 'CANCELLED_BY_USER';
            err.marketplace = this.manifest.id;
            throw err;
        }

        if (response.status === 'TIMEOUT') {
            const err = new Error(response.error || response.reason || 'Batas waktu hidrasi halaman pencarian habis');
            err.status = 'TIMEOUT';
            err.marketplace = this.manifest.id;
            throw err;
        }

        if (response.status === 'ERROR' || response.success === false) {
            const err = new Error(response.error || 'Terjadi kesalahan pada pencarian native');
            err.status = response.status || 'ERROR';
            err.marketplace = this.manifest.id;
            throw err;
        }

        const rawCandidates = Array.isArray(response.candidates) ? response.candidates : [];

        // 5. Normalisasi Kandidat via CandidateNormalizer
        const normalizeFn = _normalizer?.normalizeCandidate || ((r, src, prov) => ({
            ...r,
            source: src,
            provenance: prov,
            observedAt: new Date().toISOString()
        }));

        const normalizedResults = [];
        for (const raw of rawCandidates) {
            const norm = normalizeFn(raw, this.manifest.id, 'native-assisted');
            if (norm && norm.price !== null) {
                normalizedResults.push(norm);
            }
        }

        return normalizedResults;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NativeSearchProtocol };
}
if (typeof window !== 'undefined') {
    window.NativeSearchProtocol = NativeSearchProtocol;
}
