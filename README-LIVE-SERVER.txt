AYA GROUP POS v2.17.3 — DUAL KASIR
===================================

CARA MENJALANKAN DI LIVE SERVER
1. Ekstrak ZIP ini ke satu folder.
2. Buka folder tersebut di VS Code.
3. Pastikan file index.html terlihat di ROOT folder.
4. Klik kanan index.html → Open with Live Server.
5. Login seperti biasa.
6. Masuk menu Kasir.
7. Pilih:
   - Versi Tablet = tampilan kasir lama.
   - Versi Barcode = tampilan minimarket/barcode.

CATATAN
- Jangan membuka index.html dari dalam file ZIP.
- Jika browser masih menampilkan versi lama, tekan Ctrl+Shift+R.
- Bila masih tersimpan cache PWA lama:
  DevTools → Application → Service Workers → Unregister → reload.

TOMBOL KASIR
AMBIL | TAHAN | SIMPAN | CETAK | KOSONGKAN

SIMPAN tidak otomatis mencetak.
CETAK mencetak transaksi terakhir yang sudah berhasil disimpan.

Database/Firebase tidak diubah oleh perubahan tampilan ini.


FIX v2.17.3
===========
Masalah layar kosong setelah memilih Versi Barcode sudah diperbaiki.
Setelah extract:
1. Buka folder ini di VS Code.
2. Klik kanan index.html → Open with Live Server.
3. Tekan Ctrl + Shift + R.
4. Masuk Kasir → pilih Versi Barcode.


RAPIKAN v2.17.3
===============
Mode Kasir Barcode sudah dirapikan:
- tulisan diperbesar
- nama barang tidak mudah terpotong
- tombol lebih jelas
- panel scanner dan nota lebih enak dilihat


============================================================
AYA GROUP POS v2.18.0 — ALUR KASIR INTERAKTIF
============================================================
Kasir sekarang memakai 2 langkah:
1. Cari/Pilih Menu atau Scan Barcode.
2. Klik LANJUT PEMBAYARAN untuk membuka konfirmasi pembayaran.

Versi Tablet:
- Menu lebih besar dan jelas.
- Stok, harga, kategori, pencarian, edit, tambah, import tetap tersedia.

Versi Barcode:
- Barang/menu tidak ditampilkan sebelum scan.
- Nama barang muncul setelah barcode terbaca.

Pop-up Pembayaran:
- TAHAN
- SIMPAN
- CETAK
- KOSONGKAN

Database/Firebase tidak diubah.
