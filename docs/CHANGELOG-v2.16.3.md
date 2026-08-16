# AYA GROUP POS v2.16.3 — Hierarki Tab & Sub Tab

## Perubahan navigasi
- Sidebar diubah menjadi model **Tab Utama -> Sub Tab** (accordion).
- Klik Tab Utama hanya membuka/menutup daftar Sub Tab; tidak mengubah data atau fitur.
- Tab yang sedang aktif otomatis membuka kelompok induknya.
- Hanya satu kelompok utama dibuka pada satu waktu agar sidebar lebih rapi.
- Kelompok terakhir disimpan di localStorage.

## Susunan menu
1. **Transaksi**
   - Kasir
   - Penjualan
   - Pembelian / Kulakan
   - Transfer Stok
2. **Barang & Stok**
   - Master Barang & Stok
   - Inventaris
   - Barang Titipan
3. **Pelanggan & Supplier**
   - Data Pelanggan
   - Data Supplier
   - Hutang & Kasbon
4. **Karyawan**
   - Data Karyawan
   - Gaji & Kasbon
   - SOP & Perjanjian
5. **Keuangan & Laporan**
   - Operasional
   - Kas & Rekonsiliasi
   - Laporan Lengkap
6. **Operasional**
   - Dashboard Owner
   - Kitchen Display
   - Kalkulator
7. **Administrasi**
   - Data Cabang
   - Setting
   - Akun & Login

## Penjualan
Sub Tab **Penjualan** membuka halaman laporan penjualan langsung pada daftar nota penjualan. Halaman **Laporan Lengkap** tetap dipertahankan di kelompok Keuangan & Laporan.

## Kompatibilitas
- Route lama tetap dipertahankan.
- Hak akses owner/supervisor/cashier tetap mengikuti konfigurasi sebelumnya.
- Kasir Mart, barcode, ongkir manual, printer RPP02N, laporan, payroll, Firebase, dan fitur lain tidak diubah.
- Cache PWA dinaikkan ke `aya-pos-v2.16.3-hierarchical-tabs`.
