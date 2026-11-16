# Shopping Intelligence — Chrome Extension

> **Panduan Singkat Proyek & Dokumentasi Pengembang**  
> Untuk spesifikasi teknis lengkap, silakan merujuk ke dokumen induk: **[SPEC.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/SPEC.md)**.

---

## 1. Apa Itu Shopping Intelligence?

**Shopping Intelligence** adalah ekstensi peramban Google Chrome berbasis **Manifest V3** yang berfungsi sebagai asisten evaluasi belanja daring secara langsung di sisi pengguna. Ekstensi ini aktif mendampingi pengguna saat menavigasi marketplace e-commerce utama di Indonesia (Shopee, Tokopedia, Lazada, dan Blibli) melalui antarmuka persisten **Chrome Side Panel**.

Sistem menganalisis data internal produk, mengaudit ulasan pembeli, memverifikasi konsistensi klaim garansi, dan menemukan penawaran alternatif lintas platform e-commerce secara deterministik, menghasilkan skor kelayakan terpadu (**Deal Score**) dengan rekomendasi tindakan: **BUY**, **CHECK**, atau **WAIT**.

---

## 2. Struktur Spesifikasi Proyek (Spec-Driven Development)

Pengembangan proyek ini dikendalikan oleh dokumen spesifikasi master di direktori utama:

- **[SPEC.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/SPEC.md):** Spesifikasi sistem lengkap (14 seksi master: FR-01 s/d FR-27, NFR-01 s/d NFR-22, ADR-01 s/d ADR-08, dan Data Contracts).
- **[ARCHITECTURE.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/ARCHITECTURE.md):** Arsitektur teknis mendalam, diagram alur IPC, siklus hidup tab *Brief Active Window*, dan *Provider Registry*.
- **[TASKS.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/TASKS.md):** Rincian pekerjaan per fase (Phase 1–3 DONE, Phase 4–5 TODO) beserta perintah pembuktian otomatis (*Proof Command*).
- **[AGENTS.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/AGENTS.md):** Aturan operasional, hierarki otoritas (SPEC > ARCHITECTURE > TASKS), dan protokol sesi pengembangan.

---

## 3. Cara Instalasi (Development Mode)

Ekstensi ini dibangun menggunakan Vanilla JavaScript tanpa proses kompilasi bundler tambahan (*zero-build step*):

1. Buka peramban Google Chrome (versi 110 atau lebih baru).
2. Arahkan peramban ke halaman pengelolaan ekstensi: `chrome://extensions/`.
3. Aktifkan opsi **Developer mode** pada sudut kanan atas peramban.
4. Klik tombol **Load unpacked** pada sudut kiri atas.
5. Pilih folder direktori **`extension`** dari repositori ini (`/path/to/project-ippl-extension/extension`).
6. Ekstensi **Shopping Intelligence** siap digunakan pada toolbar browser.

---

## 4. Cara Menjalankan Pengujian Otomatis

Pengujian dijalankan langsung menggunakan test runner bawaan Node.js tanpa memerlukan dependensi npm tambahan:

```bash
# Menjalankan seluruh test suite verifikasi Phase 1-3 (22/22 Tests PASS)
node test/verify-fixes.test.js

# Menjalankan seluruh suite pengujian unit modular
node --test test/*.test.js

# Menjalankan pengujian komponen spesifik
node --test test/candidate-normalizer.test.js
node --test test/native-search-protocol.test.js
node --test test/provider-registry.test.js
node --test test/pdp-classifier.test.js
node --test test/shopee-manifest.test.js
node --test test/query-builder.test.js
node --test test/exa-provider.test.js
node --test test/exa-integration.test.js
```

---

## 5. Cara Berkontribusi

1. Baca dan pahami aturan pada **[AGENTS.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/AGENTS.md)** sebelum melakukan modifikasi kode.
2. Seluruh perubahan wajib mengacu pada ID pekerjaan di **[TASKS.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/TASKS.md)**.
3. Perubahan terhadap spesifikasi **[SPEC.md](file:///home/bhisma/Documents/GitHub/project-ippl-extension/SPEC.md)** wajib melalui prosedur *Change Request* di `docs/changes/`.
4. Pastikan seluruh pengujian pada `node test/verify-fixes.test.js` dan `node --test test/*.test.js` berstatus **PASS** sebelum mengajukan *Pull Request*.
