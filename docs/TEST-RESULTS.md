# Hasil Pemeriksaan Paket

Tanggal pemeriksaan: 7 Agustus 2026.

## Lulus

- Pemeriksaan sintaks seluruh `js/*.js`, `sw.js`, dan `tools/*.mjs` menggunakan `node --check`.
- Pemeriksaan semua file JSON menggunakan parser JSON.
- Pemeriksaan referensi import dan aset lokal: seluruh file yang dirujuk tersedia.
- Pemeriksaan named import antar-modul lokal: nama yang diimpor tersedia pada modul tujuan.
- Validasi export Firebase menggunakan `tools/validate-export.mjs`.
- Penggabungan data menghasilkan 132 ID produk unik, 553 penjualan, 196 pengeluaran, 3 hutang pelanggan, dan 25 catatan modal.
- ZIP diuji setelah paket dibuat menggunakan `unzip -t`.

## Belum dapat diuji dari lingkungan pembuatan

- Login langsung ke project Firebase produksi dan operasi tulis terhadap data nyata.
- Security Rules pada project produksi.
- Tampilan browser lengkap yang memuat CDN Firebase, karena lingkungan pemeriksaan tidak memiliki resolusi DNS eksternal.
- Printer Bluetooth/USB, scanner kamera, dan layout cetak pada perangkat fisik.
- Sinkronisasi offline simultan dari beberapa perangkat.

Gunakan database uji atau backup terlebih dahulu sebelum mengaktifkan aplikasi pada transaksi harian.

## Pemeriksaan versi 2.4

- Seluruh file JavaScript lulus `node --check`.
- Seluruh file JSON berhasil diparse.
- Seluruh import JavaScript lokal mengarah ke file yang tersedia.
- Seluruh aset yang dicache oleh Service Worker tersedia.
- Tombol Master Barang memakai `data-product-edit`, sedangkan tombol cabang memakai `data-branch-edit`; event halaman sebelumnya dibersihkan saat navigasi.
- Rumus pembelian: `qtySmall = qtyLarge × packSize`, `cost = cartonCost ÷ packSize`, dan `total = qtyLarge × cartonCost`.
- Penyimpanan pembelian memperbarui stok satuan kecil serta menyinkronkan `cartonCost`, `packSize`, `cost`, `price`, dan `largeUnit` ke Master Barang dan jalur legacy yang diketahui.
