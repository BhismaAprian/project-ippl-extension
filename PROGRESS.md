# 🚀 Shopping Intelligence Companion — Project Progress & Architecture Report

> **Visi:** *"Sebelum checkout, cek dulu — hemat duit, nggak nyesel."*  
> Mentransformasi pengalaman belanja daring dari sekadar tebak-tebakan harga menjadi keputusan pembelian yang cerdas, terverifikasi, dan bebas penyesalan dengan asisten AI terintegrasi di Chrome Side Panel.

---

## 1. Project Overview

**Shopping Intelligence** adalah ekstensi peramban modern berbasis **Google Chrome Manifest V3** yang berperan sebagai *Ultimate AI Shopping Companion*. Ekstensi ini berjalan secara *real-time* mendampingi pengguna saat menjelajahi marketplace terkemuka di Indonesia (Shopee, Tokopedia, Lazada, dan Blibli).

Berbeda dari ekstensi pembanding harga tradisional yang kaku atau hanya mengandalkan pencarian teks mentah di Google, Shopping Intelligence memadukan:
1. **God-Level DOM Scraping:** Mengekstrak data terstruktur langsung dari state JSON internal Shopee (MFE State) dan Semantic DOM Traversal.
2. **Neural Cross-Market Discovery:** Menemukan alternatif produk yang identik atau setara di berbagai marketplace menggunakan Exa API.
3. **Cognitive AI Intelligence:** Menganalisis sentimen ribuan ulasan pembeli, mengevaluasi rasio *price-to-value*, dan mengaudit integritas garansi menggunakan Groq Llama 3.3 70B.
4. **Ergonomic Workspace:** Tampilan permanen di bilah sisi (*Chrome Side Panel*) sehingga pengguna dapat membaca ringkasan AI dan membandingkan alternatif tanpa perlu bolak-balik menutup popup atau membuka puluhan tab baru.

---

## 2. Tumpukan Teknologi Terbaru (Tech Stack)

| Komponen | Teknologi | Peran & Keunggulan |
| :--- | :--- | :--- |
| **Platform Runtime** | **Chrome Extension Manifest V3** | Menggunakan arsitektur modern (*service worker*, *side panel API*, permission model ketat). |
| **Antarmuka Pengguna** | **Chrome Side Panel (HTML5 & CSS3)** | Layar penuh vertikal yang tetap terbuka di sisi kanan browser sepanjang sesi belanja pengguna. |
| **Design System** | **Playful Geometric (Neo-Brutalism)** | Estetika modern taktil dengan *hard shadow* 4px, border 2px, tipografi ekspresif (Outfit + Plus Jakarta Sans), dan badge marketplace berwarna cerah. |
| **Ekstraksi Data** | **God-Level Scraper (Shopee)** | *Cascade Merge Pattern* 3 Lapis: JSON State MFE (`<script type="text/mfe-initial-data">`) $\rightarrow$ Schema.org JSON-LD $\rightarrow$ Direct DOM Heuristics. |
| **Mesin Rekomendasi Native** | **Semantic Text-Based Traversal** | Pelacakan rekomendasi toko lokal Shopee ("Kamu Mungkin Juga Suka") berbasis teks semantik tanpa ketergantungan class CSS acak Webpack. |
| **Pencarian Neural** | **Exa API (Neural Search Endpoint)** | Pencarian semantik berorientasi produk dengan pemfilteran domain otomatis (`shopee.co.id`, `tokopedia.com`, `lazada.co.id`, `blibli.com`). |
| **Kecerdasan Buatan (LLM)** | **Groq API (`openai/gpt-oss-120b` / `llama-3.1-70b-versatile`)** | Ekstraksi query bersih (*clean query*), evaluasi deal (*Best Value & Cheapest*), peringkas ulasan pembeli (*Review Intelligence*), dan penilaian kelayakan (*Ultimate Deal Score*). |
| **Penyimpanan Lokal** | **`chrome.storage.local`** | *Write-through caching* hasil analisis per-URL tab guna menghemat kuota API dan menyajikan hasil instan (*zero-latency cache hit*). |

---

## 3. Daftar Fitur yang Telah Diselesaikan (Versi Terbaru)

### 3.1 Migrasi Total ke Chrome Side Panel
- Menggantikan antarmuka Popup 600px yang mudah tertutup menjadi **Chrome Side Panel** (*full-height*, fleksibel, dan persisten).
- Pengguna dapat leluasa melakukan *scrolling* ulasan dan mengeklik tautan alternatif sembari tetap melihat produk asli di tab utama.
- Terintegrasi dengan `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` sehingga bilah samping terbuka otomatis saat ikon ekstensi diklik.

### 3.2 God-Level Scraper (Shopee Adapter)
- **Layer 1 (MFE Initial State):** Mem-parsing skrip `<script type="text/mfe-initial-data">` Shopee untuk mengambil data mentah spesifikasi teknis (`product_attributes`), identitas toko mendalam (`shop_detailed`), dan harga asli.
- **Normalisasi Micro-Unit:** Menangani skala harga 100.000 Shopee (misalnya nilai `849900000000` otomatis dikonversi menjadi integer murni IDR `8.499.000`).
- **Semantic Text-Based Traversal:** Menggantikan selector CSS acak (`.NtG0vm`, `.L6zW27`) dengan pencarian berbasis teks judul `"Kamu Mungkin Juga Suka"` / `"Produk Serupa"` dan menelusuri kontainer induk untuk mengekstrak tautan `a[href*="-i."]`.
- **Async Force-Scroll:** Jika rekomendasi belum dimuat oleh React Shopee saat inisialisasi awal, sistem memicu scroll ke bagian bawah halaman secara asinkron untuk memaksa hidrasi DOM.

### 3.3 Interactive Deep Review Intelligence
- **Ringkasan Analisis AI:** Mengklasifikasikan ulasan pembeli menjadi tiga dimensi kritis:
  - **Kelebihan (Pros):** Nilai plus autentik dari produk.
  - **Kekurangan (Cons):** Kelemahan atau kompromi penggunaan.
  - **Perhatian & Resiko Pembeli (Risks/Red Flags):** Indikasi barang tiruan/KW, kerusakan saat pengiriman, cacat pabrik, atau penolakan garansi oleh penjual.
- **Interactive Click-to-Scroll:** Setiap butir ulasan AI dilengkapi pemetaan `ref_id` / `cmtId`. Saat pengguna mengeklik salah satu butir keluhan/kelebihan di Side Panel:
  1. Halaman Shopee otomatis meluncur (*smooth/instant scroll*) ke komentar asli pembeli di DOM.
  2. Elemen komentar target disorot dengan animasi glow kuning (`.si-review-highlight`).

### 3.4 Warranty Intelligence (Audit Garansi Sistem vs Deskripsi)
- Mengaudit kejujuran klaim garansi dengan membandingkan data atribut resmi Shopee (`Jenis Garansi`, `Masa Garansi`) terhadap teks deskripsi produk penjual.
- Mendeteksi diskrepansi fatal: Contohnya jika penjual menulis *"Garansi Resmi 1 Tahun"* di deskripsi teks, namun di sistem Shopee tercatat *"Tidak Ada Garansi"* / *"Garansi Toko 7 Hari"*.
- Menampilkan peringatan visual kuning/merah disertai tips mitigasi klaim garansi untuk pembeli.

### 3.5 Cross-Market Discovery & Smart Recommendations
- **Dual-Engine Recommendations:**
  - **Native Shopee ("Kamu Mungkin Juga Suka"):** 3 produk alternatif langsung dari toko Shopee dengan 0 network/API cost.
  - **Exa Cross-Market Neural Deals:** Penemuan produk serupa di Tokopedia, Lazada, dan Blibli.
- **Playful Geometric Badges:** Pembedaan visual kartu yang tajam menggunakan badge warna resmi:
  - 🟢 **Tokopedia** (`#00AA5B`)
  - 🟠 **Shopee Native** (`#EE4D2D`)
  - 🔵 **Lazada** (`#0F146D`)
  - 🔷 **Blibli** (`#0086CA`)
- **Deal Categorization:** Pemisahan kartu menjadi **Best Value** (keseimbangan spesifikasi dan reputasi toko) serta **Cheapest Option** (opsi harga terendah dengan kalkulasi nominal hemat).

### 3.6 Ultimate Deal Checker (BUY / CHECK / WAIT)
- Formula deterministik dan kognitif dengan bobot:
  $$\text{Deal Score} = (40\% \times \text{Skor Harga}) + (40\% \times \text{Skor Ulasan}) + (20\% \times \text{Skor Garansi})$$
- Menghasilkan keputusan tegas pembelian:
  - **BUY (Skor $\ge 80$):** Produk solid, harga kompetitif, ulasan positif, garansi jelas.
  - **CHECK (Skor $60 - 79$):** Cukup layak, namun perlu memeriksa ulasan atau konfirmasi garansi via chat.
  - **WAIT (Skor $< 60$):** Terdeteksi resiko keluhan fatal, diskrepansi garansi, atau ada alternatif lain yang jauh lebih hemat ($>25\%$).

---

## 4. Perbaikan Bug Kritis (Critical Bug Fixes)

Selama pengujian intensif pasca-migrasi, 3 kegagalan fatal berhasil dianalisis dan diselesaikan secara tuntas:

### 1. Masalah CSP Halaman Shopee yang Memblokir Groq API
- **Gejala:** Pemanggilan `UNDERSTAND_PRODUCT` dan `EVALUATE_DEALS` gagal secara misterius di tab Shopee.
- **Akar Masalah:** Logika AI sebelumnya dijalankan di dalam Content Script (`marketplace-detector.js`). Script yang berjalan di konteks tab marketplace terikat oleh *Content Security Policy* (CSP) domain Shopee yang melarang koneksi jaringan luar ke `https://api.groq.com`. Selain itu, `https://api.groq.com/*` belum terdaftar di `host_permissions`.
- **Solusi:**
  - Menambahkan `"https://api.groq.com/*"` ke dalam `host_permissions` di `manifest.json`.
  - Memindahkan seluruh pemanggilan AI (`understandProduct`, `summarizeReviews`, `evaluateDeals`, `evaluateUltimateDeal`) agar dijalankan **langsung di Side Panel (`sidepanel.js`)**, yang merupakan lingkungan istimewa ekstensi Chrome tanpa hambatan CSP halaman web.

### 2. Masalah Deep Review Kosong (Lazy-Load DOM Shopee)
- **Gejala:** Ulasan produk Shopee sering kosong di Side Panel padahal di halaman Shopee ada ulasan.
- **Akar Masalah:** Shopee me-render komentar pembeli menggunakan React secara *lazy-load* saat bagian ulasan masuk ke viewport. Jeda waktu scroll sebelumnya hanya 600ms, sehingga saat query DOM dijalankan, elemen ulasan belum selesai dimount oleh React.
- **Solusi:**
  - Menerapkan protokol **Force Render & Active Polling Wait**: Script men-scroll layar secara instan ke jangkar rating dan melakukan polling interval 200ms hingga maksimal 2.5 detik sampai elemen komentar pembeli (`[data-cmtid]`, `.shopee-product-comment-list`) terdeteksi di DOM.
  - Menambahkan selector fallback dinamis (`.meQyXP`, `.YNedDV`) dan node cleaning cadangan agar tidak bergantung pada nama class acak.

### 3. Masalah Alternatif Exa & Native Scraper Hilang
- **Gejala:** Kartu alternatif lintas marketplace dan native Shopee tidak muncul sama sekali di UI Side Panel.
- **Akar Masalah:** 
  1. *Property Mismatch*: `ai-client.js` mengembalikan properti `clean_query`, sementara `search-client.js` memeriksa `search_query`. Akibatnya Exa jatuh ke fallback query mentah.
  2. *Silent UI Drop*: Jika evaluasi AI bernilai null, `sidepanel.js` langsung menyembunyikan semua section (`hide()`), meninggalkan antarmuka kosong tanpa fallback dan tanpa pesan error.
  3. *Obfuscated CSS Classes*: Section "Kamu Mungkin Juga Suka" bergantung pada class acak `.NtG0vm` dan diekstrak secara sinkron saat scroll masih di posisi paling atas (Y = 0).
- **Solusi:**
  - Harmonisasi kontrak schema query pada `ai-client.js` dan `search-client.js`.
  - Menerapkan **Deterministic Fallback Engine** di `sidepanel.js`: jika evaluasi AI Groq gagal atau kuota habis, kartu Exa tetap dirender dari kandidat harga terendah, sehingga antarmuka tidak pernah *blank*.
  - Menulis ulang scraper rekomendasi native menggunakan Semantic Text-Based Traversal dan menambahkan `extractSimilarRecommendationsAsync()`.

### 4. Masalah Salah Section Scraping ("Produk Serupa" vs "Kamu Mungkin Juga Suka")
- **Gejala:** Scraper mengambil produk rekomendasi dari seksi carousel atas *"Produk Serupa"*, bukan dari seksi rekomendasi utama *"Kamu Mungkin Juga Suka"*.
- **Akar Masalah:** Di DOM Shopee, judul "Produk Serupa" berada di urutan atas (posisi teks ~576.703) sedangkan "Kamu Mungkin Juga Suka" berada di bawah (~721.338). Pengecekan teks sebelumnya menyertakan `text === 'produk serupa'`, sehingga `Array.prototype.find()` yang berjalan top-to-bottom selalu memilih section yang salah.
- **Solusi:**
  - Menghapus kata kunci `produk serupa` dari pencarian judul.
  - Mewajibkan pencocokan ketat (*strict match*) `text === 'kamu mungkin juga suka'` serta memfilter kata `serupa`, `ulasan`, atau `terkait`.
  - Menggunakan `Node.compareDocumentPosition` (`Node.DOCUMENT_POSITION_FOLLOWING`) untuk memastikan seluruh tautan produk yang diambil secara fisik berada **setelah** judul target.

### 5. Masalah Deep Review Kosong (Elemen Tersembunyi di Bawah Lipatan Layar)
- **Gejala:** Halaman Shopee memiliki 440 ulasan, tetapi Side Panel menampilkan 0 ulasan.
- **Akar Masalah:** `scrollIntoView({ block: 'center' })` ke kontainer `.product-ratings` hanya menempatkan kotak overview rating (~300px) di layar, sedangkan daftar ulasan sebenarnya (`.shopee-product-comment-list`) tetap berada di bawah lipatan layar (*below viewport*). `IntersectionObserver` React Shopee tidak terpicu, dan event scroll window tidak terkirim.
- **Solusi:**
  - Menerapkan **Progressive Deep Scroll**: Menggeser layar ke anchor lalu menambahkan offset 350px ke bawah (`block: 'start'` + `window.scrollBy({ top: 350 })`) agar elemen komentar masuk tepat di tengah viewport aktif.
  - Memicu native event `scroll` dan `resize` ke `window` dan `document`.
  - Active polling loop hingga 3.5 detik dengan dorongan scroll berkala (*nudge*) setiap 800ms jika ulasan belum muncul.
  - Menerapkan **Two-Stage Retry** pada `sidepanel.js` (jeda 1.2 detik sebelum mencoba ulang `EXTRACT_REVIEWS` jika pengambilan pertama menghasilkan 0 item).

### 6. Crash Exa API (`Cannot read properties of null (reading 'trim')`)
- **Gejala:** Console Side Panel menampilkan uncaught error `TypeError: Cannot read properties of null (reading 'trim')` saat pencarian Exa dijalankan.
- **Akar Masalah:** Pada `search-client.js`, ekspresi `(aiData && (aiData.clean_query || ...)).trim()` mengembalikan `(null).trim()` ketika `aiData` bernilai `null` (misalnya saat Groq AI offline/gagal).
- **Solusi:**
  - Menerapkan *defensive type checking* (`typeof aiData === 'object'` dan `typeof rawAiQuery === 'string'`).
  - Menjamin fallback ke `(rawProduct && typeof rawProduct.title === 'string') ? rawProduct.title : ""`.
  - Memvalidasi panjang query minimum sebelum memanggil endpoint Exa API.

---

## 5. Struktur Berkas Utama Proyek

```text
project-ippl-extension/
├── PROGRESS.md                        # Dokumentasi progres dan arsitektur komprehensif
├── ARCHITECTURE.md                    # Dokumen arsitektur teknis Stage 1 & Stage 2
├── testing-sprint1.md                 # Laporan pengujian fondasi Sprint 1
├── extension/
│   ├── manifest.json                  # Konfigurasi MV3, Side Panel, & host_permissions
│   ├── background/
│   │   └── service-worker.js          # Pengatur event ekstensi & auto-open Side Panel
│   ├── sidepanel/
│   │   ├── sidepanel.html             # Struktur UI Playful Geometric Side Panel
│   │   ├── sidepanel.css              # Sistem desain Neo-Brutalism, badges, & tactile cards
│   │   └── sidepanel.js               # Orkestrator utama, logging, AI runner, & UI renderers
│   ├── content/
│   │   └── marketplace-detector.js    # Jembatan pesan Side Panel <-> DOM Adapter
│   ├── adapters/
│   │   ├── base-adapter.js            # Kontrak abstrak adapter marketplace
│   │   ├── shopee-adapter.js          # God-Level Scraper (MFE State, Reviews, Rekomendasi)
│   │   ├── tokopedia-adapter.js       # Adapter deteksi Tokopedia
│   │   └── lazada-adapter.js          # Adapter deteksi Lazada
│   ├── shared/
│   │   ├── constant.js                # URL patterns & konstanta marketplace
│   │   ├── ai-client.js               # Integrasi Groq Llama 3.3 70B (JSON schema mode)
│   │   └── search-client.js           # Integrasi Exa API Neural Search & filtering
│   └── popup/                         # Antarmuka legacy popup (fallback)
│       ├── popup.html
│       ├── popup.css
│       └── popup.js
└── shopee/
    └── Jual RAM LAPTOP DDR4 8GB...html # Snapshot halaman Shopee asli untuk pengujian offline
```

---

## 6. Status Kesiapan & Roadmap Mendatang

- [x] **Sprint 1 (Fondasi):** MV3 Setup, Adapter Pattern, Marketplace Detection.
- [x] **Sprint 2 (Ekstraksi & AI Search):** Cascade Merge Scraper, Groq AI Prompting, Exa Neural Search.
- [x] **Sprint 3 (Side Panel Migration & Polish):** Chrome Side Panel, Interactive Click-to-Scroll, Semantic Rekomendasi, Audit Garansi, Resilient Fallback UI.
- [ ] **Next Steps (Stage 3 & Beyond):**
  - Paritas `extractProduct()` penuh untuk Tokopedia dan Lazada.
  - Penyimpanan riwayat pelacakan harga (*Price History Graph*).
  - Personalisasi preferensi belanja pengguna.
