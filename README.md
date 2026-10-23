# 🧠 Shopping Intelligence

> **"Before you buy, understand the deal."**

**Shopping Intelligence** adalah Chrome Extension (Manifest V3) bertenaga AI yang menganalisis produk di Shopee secara *real-time*, mencari alternatif harga di marketplace lain, membandingkan spesifikasi, dan memberikan rekomendasi cerdas (Smart Deal Maker) langsung di dalam *popup* — tanpa perlu membuka tab baru.

Proyek ini dikembangkan sebagai pemenuhan Tugas Besar (UTS) mata kuliah IPPL.

---

## 🚀 Masalah yang Diselesaikan (The Problem)
Belanja online seringkali melelahkan. Pengguna mengalami *"Tab Fatigue"* karena harus membuka Shopee, Tokopedia, dan Lazada hanya untuk mengecek satu barang. Selain itu, judul produk yang berantakan seringkali menyembunyikan perbedaan spesifikasi (misal: RAM 8GB vs 16GB), sehingga pengguna sering tertipu harga murah dengan spesifikasi rendah.

## 💡 Solusi (The Solution)
Shopping Intelligence bertindak sebagai **AI Shopping Layer**. Dengan satu klik:
1. **AI membaca spesifikasi produk** dari halaman Shopee.
2. **AI mencari produk yang persis sama** di marketplace lain (Tokopedia, Lazada, Blibli).
3. **AI membandingkan** mana yang benar-benar "Best Value" (layak dibeli) dan mana yang sekadar "Cheapest" (murah tapi ada *trade-off*).

---

## ✨ Fitur Utama (Stage 1 MVP)

- **🛒 Shopee Product Extraction:** Mengambil data DOM (Judul, Harga, Rating, Seller, Spesifikasi) secara akurat menggunakan Adapter Pattern.
- **🧠 AI Product Understanding (Groq):** Menggunakan Groq API (Llama 3) untuk mengekstrak data mentah menjadi JSON terstruktur dan membuat *search query* yang presisi.
- **🔎 Neural Cross-Market Search (Exa):** Menggunakan Exa API (Neural Search) untuk mencari alternatif produk dengan filter domain (Shopee, Tokopedia, Lazada, Blibli).
- **⚖️ Smart Deal Maker:** Logika deterministik dan AI Reasoning yang mengategorikan hasil menjadi:
  - 🏆 **Best Value:** Spesifikasi cocok, brand terpercaya, harga masuk akal (dengan alasan dari AI).
  - 💰 **Cheapest Option:** Harga termurah mutlak (dengan *warning* jika toko kurang dikenal).
- **⚡ Caching System:** Menyimpan hasil analisis di `chrome.storage.local` berdasarkan URL tab, menghemat kuota API dan membuat loading instan saat popup dibuka kembali.
- **🎨 Playful Geometric UI:** Desain antarmuka modern, *tactile*, dan berani (terinspirasi Memphis Group 80-an) untuk pengalaman pengguna yang menyenangkan.

---

## 🛠️ Tech Stack & Architecture

| Lapisan | Teknologi | Peran |
| :--- | :--- | :--- |
| **Platform** | Chrome Extension (Manifest V3) | Runtime extension & permission model |
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 | Logika UI dan interaksi (tanpa framework) |
| **AI / LLM** | [Groq API](https://groq.com/) (`openai/gpt-oss-120b`) | Product Understanding & Deal Evaluation |
| **Search** | [Exa API](https://exa.ai/) (Neural Search) | Cross-market discovery |
| **Storage** | `chrome.storage.local` | Caching hasil analisis |

### Alur Data (Data Flow)
```text
[User Buka Shopee] 
       ↓
[Content Script: Extract DOM] (Adapter Pattern)
       ↓
[Popup: Kirim ke Groq AI] → (Spesifikasi & Search Query)
       ↓
[Popup: Query ke Exa API] → (Cari Tokped/Lazada/Blibli)
       ↓
[Popup: Groq Evaluasi] → (Tentukan Best Value vs Cheapest)
       ↓
[Render UI "Playful Geometric"]
```

---

## ⚙️ Cara Instalasi (Local Development)

1. **Clone Repository**
   ```bash
   git clone https://github.com/BhismaAprian/project-ippl-extension.git
   cd project-ippl-extension
   ```

2. **Dapatkan API Keys (Gratis)**
   - Dapatkan Groq API Key di [console.groq.com](https://console.groq.com/)
   - Dapatkan Exa API Key di [exa.ai](https://exa.ai/)

3. **Konfigurasi API Key**
   - Buka file `extension/shared/ai-client.js` dan masukkan Groq API Key Anda.
   - Buka file `extension/shared/search-client.js` dan masukkan Exa API Key Anda.
   *(Catatan: Saat ini API Key di-hardcode untuk keperluan demo UTS. Di masa depan, API Key akan disimpan secara aman via `chrome.storage`).*

4. **Load Extension ke Chrome**
   - Buka Chrome dan ketik `chrome://extensions/`
   - Aktifkan **Developer mode** (pojok kanan atas).
   - Klik **Load unpacked** dan pilih folder `extension/`.

5. **Mulai Gunakan**
   - Buka salah satu halaman produk di Shopee.
   - Klik ikon Shopping Intelligence di toolbar Chrome Anda!

---


