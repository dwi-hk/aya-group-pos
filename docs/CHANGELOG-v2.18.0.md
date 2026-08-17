# AYA GROUP POS v2.18.0 — Alur Kasir Interaktif 2 Langkah

## Konsep baru
Kasir sekarang dipisahkan menjadi dua langkah agar tampilan tidak tumpang tindih.

### Langkah 1 — Pilih Barang / Menu
**Versi Tablet**
- Fokus pada Cari / Pilih Menu.
- Tombol **Cari Menu** dibuat lebih jelas.
- Nama menu diperbesar.
- Kategori, kode/barcode, stok, harga, Kelola Menu, Tambah Menu, Import, Edit Harga, Hapus Item tetap tersedia.
- Keranjang transaksi berada di sebelah kanan.
- Tombol utama tahap pertama: **AMBIL**, **TAHAN**, dan **LANJUT PEMBAYARAN**.

**Versi Barcode**
- Daftar seluruh barang tidak ditampilkan sebelum scan.
- Fokus utama pada kolom / scanner barcode.
- Setelah barcode terbaca, nama barang langsung muncul dan masuk ke keranjang.
- Tombol utama tahap pertama: **AMBIL**, **TAHAN**, dan **LANJUT PEMBAYARAN**.

### Langkah 2 — Pop-up Konfirmasi & Pembayaran
Setelah menekan **LANJUT PEMBAYARAN**, muncul pop-up khusus berisi:
- Ringkasan barang/menu yang dibeli.
- Data pelanggan/pemesan.
- Jenis pesanan.
- Delivery dan ongkir yang sudah ada.
- Kemasan/styrofoam.
- Catatan pesanan.
- Diskon.
- Total dan kembalian.
- Metode pembayaran: TUNAI, QRIS, PERSONAL, HUTANG.
- Uang diterima dan shortcut nominal tunai.

Tombol akhir dibuat terpisah:
- **TAHAN**
- **SIMPAN**
- **CETAK**
- **KOSONGKAN**

**CETAK** aktif setelah transaksi berhasil disimpan untuk mencegah salah cetak transaksi yang belum tersimpan.

## Keamanan perubahan
- Struktur Firebase/database tidak diubah.
- `js/store.js` tidak diubah.
- `js/firebase-config.js` tidak diubah.
- `database.rules.json` tidak diubah.
- `firebase.json` tidak diubah.
- Struktur transaksi, stok, hutang, delivery, pembayaran, dan audit tetap menggunakan fungsi sebelumnya.
