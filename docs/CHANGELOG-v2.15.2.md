# AYA GROUP POS v2.15.2

- Ditambahkan katalog barcode internal AYA sebanyak **129 item** berdasarkan PDF `BARCODE_AYA_2_HALAMAN_A4_URUT_KATEGORI_FIX.pdf`.
- Semua kode EAN-13 diverifikasi checksum: **129/129 valid**.
- Tidak ada barcode duplikat dan tidak ada ID produk duplikat.
- Pencocokan barcode mengutamakan **ID produk** agar barcode tidak tertukar dengan barang lain.
- Fallback berdasarkan nama hanya dipakai jika nama katalog unik setelah normalisasi. Nama duplikat seperti **Kita** dan **Es Teh** tidak pernah dicocokkan otomatis berdasarkan nama.
- Katalog barcode diterapkan saat data produk dibaca, sehingga Tab Penjualan/Kasir dapat mencari dan menambahkan item dari barcode tanpa mengubah perhitungan, harga, stok, laporan, ongkir, atau fitur lain.
- Cache Service Worker dinaikkan ke `aya-pos-v2.15.2-barcode-catalog`.
