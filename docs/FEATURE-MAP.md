# Peta Fitur

## Tersedia dalam paket

- Tema gelap oranye, sidebar auto-hide, responsive tablet/Android.
- Multi-cabang dan pemilih cabang manual.
- Master barang: barcode, kategori, harga beli besar/satuan, harga ecer/grosir/reseller, stok minimum, komposisi, label.
- Kasir: pilih menu, cari/scan, transaksi tertahan, ongkir, dine-in/takeaway/delivery, styrofoam, diskon, Tunai/QRIS/Hutang/Personal, validasi pembayaran, nota 58 mm.
- Kulakan dari master barang dan penambahan stok.
- Transfer stok dengan status pending, approved, received.
- Pelanggan, supplier, titipan, inventaris, karyawan, absensi, gaji, kasbon, operasional.
- Laporan omzet, pembayaran, HPP, operasional, laba/rugi, barang terlaris, transaksi per nota, grafik.
- Kitchen Display dan antrian.
- Firebase Auth Email/Password, profil role, pembuatan user oleh owner.
- Audit log, fallback node database lama, PWA, antrean offline, backup/restore manual.
- Scanner kamera dan percobaan printer Web Bluetooth dengan fallback print browser.

## Membutuhkan konfigurasi/pengujian produksi

- Pemetaan persis database lama setelah file JSON database lama tersedia.
- Security Rules produksi dan pengujian Emulator.
- UUID printer thermal yang sesuai merek/model.
- Cloud Functions untuk backup otomatis terjadwal, notifikasi server, custom claims, dan penghapusan akun Authentication.
- Uji konflik offline saat banyak perangkat mengubah stok bersamaan.
- Import/export saat ini memakai CSV yang dapat dibuka Excel; format XLSX native dapat ditambahkan kemudian.


## Pembaruan v2.4

- [x] Isolasi event tombol Edit Master Barang dan Edit Cabang.
- [x] Harga beli satuan besar dan isi per satuan besar pada Pembelian/Kulakan.
- [x] HPP satuan kecil dihitung otomatis.
- [x] Stok pembelian dikonversi otomatis ke satuan kecil.
- [x] Harga jual, HPP, isi, dan harga beli besar disinkronkan ke Master Barang.
