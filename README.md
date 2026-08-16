# AYA GROUP – MULTY PAYMENT

**Versi 2.4 — Perbaikan Master Barang & Pembelian Satuan Besar**

Aplikasi web POS multi-cabang untuk **DAPUR AYA / AYA TOKO SEMBAKO** dan **AYA SEBLAK DAN ANGKRINGAN**. Dibuat dengan HTML, CSS, JavaScript modular, Firebase Authentication, dan Firebase Realtime Database.


## Perbaikan versi 2.4

- Tombol **Edit** pada Master Barang tidak lagi terkena event lama dari halaman Data Cabang. Setiap perpindahan modul sekarang membersihkan handler halaman sebelumnya, dan tombol barang/cabang memakai atribut aksi yang berbeda.
- Form Master Barang menghitung **Harga Beli Satuan Kecil** otomatis dari Harga Beli Satuan Besar dibagi Isi per Satuan Besar.
- Tab Pembelian/Kulakan sekarang memuat Jumlah Satuan Besar, Nama Satuan Besar, Harga Beli Satuan Besar, Isi per Satuan Besar, HPP Satuan Kecil, Satuan Kecil, dan Harga Jual.
- Saat pembelian disimpan, stok bertambah berdasarkan `jumlah satuan besar × isi`, sedangkan total pembelian dihitung dari `jumlah satuan besar × harga beli satuan besar`.
- HPP, harga beli besar, isi kemasan, nama satuan besar, dan harga jual otomatis disinkronkan kembali ke Master Barang serta node lama yang terkait.

## Sinkronisasi database lama

Paket ini sudah dicocokkan dengan export Firebase asli `kasir-aya-group-e6fb4-default-rtdb`.

Node lama yang dibaca langsung antara lain:

- `master_menu`, `menu_tambahan`, `master_barang`, `menu`, dan `stok_cabang`
- `transaksi`, `pengeluaran`, `modal_tambahan`, dan `pembayaran`
- `cabang`, `pelanggan`, `master_pelanggan`, `supplier`, `suppliers`
- `barang_titipan`, `transfer`, dan `pengaturan`

Data dari modul baru tetap disimpan pada namespace **`ayaGroupV2`**. Untuk kompatibilitas dengan aplikasi lama, transaksi penjualan baru juga dicerminkan ke `transaksi/{nomorNota}`, master barang diperbarui secara parsial pada sumber lama yang diketahui, dan stok cabang lama ikut diperbarui bila jalurnya tersedia.

Tidak ada migrasi massal atau penghapusan otomatis terhadap node lama. Tombol hapus master/cabang memakai status nonaktif pada overlay V2. Restore manual hanya mengganti `ayaGroupV2`, bukan seluruh database.

Rincian lengkap ada di `docs/LEGACY-DATABASE-MAPPING.md`.

## Temuan dari export yang perlu diketahui

- 132 ID produk/menu unik setelah `master_menu`, `menu_tambahan`, `master_barang`, `menu`, dan stok cabang digabungkan.
- 576 record pada `transaksi`; 23 di antaranya adalah `MODAL_MASUK`, sehingga 553 record dibaca sebagai penjualan.
- Metode lama `KONSUMSI` ditampilkan sebagai `PERSONAL`.
- 541 transaksi lama tidak memiliki kolom cabang. Adaptor menempatkannya sementara pada `aya-seblak-angkringan` dan memberi tanda `branchInferred` agar laporan menampilkan peringatan.
- Harga beli item lama dilengkapi dari master produk saat tersedia. Item yang tetap tidak mempunyai harga beli ditandai pada laporan HPP/laba.

## Menjalankan di komputer

Karena aplikasi memakai JavaScript Module, jangan membuka `index.html` langsung dengan klik dua kali. Dari folder proyek jalankan:

```bash
python -m http.server 8080
```

Lalu buka `http://localhost:8080`.

## Deploy Firebase Hosting

1. Instal Node.js dan Firebase CLI.
2. Login dan deploy Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase use kasir-aya-group-e6fb4
firebase deploy --only hosting
```

Untuk menerapkan rules contoh:

```bash
firebase deploy --only database
```

**Periksa rules lama terlebih dahulu.** Jangan menimpa rules produksi tanpa pengujian di Emulator atau Rules Playground.

## Login pertama

Saat pertama dibuka, aplikasi selalu menampilkan halaman **Akun & Login**. Mode demo lokal sudah dihapus. Sesi autentikasi hanya disimpan selama halaman aktif, sehingga aplikasi meminta login kembali setelah halaman dibuka ulang.

Untuk produksi:

1. Aktifkan Firebase Authentication → Email/Password.
2. Buat akun owner di Firebase Console.
3. Tambahkan profil owner pada Realtime Database:

```json
{
  "ayaGroupV2": {
    "users": {
      "UID_OWNER_DARI_AUTH": {
        "name": "Owner AYA GROUP",
        "email": "email-owner@example.com",
        "role": "owner",
        "active": true
      }
    }
  }
}
```

4. Login dari menu **Management User**, kemudian buat profil kasir/supervisor.


## Laporan Kas & Rekonsiliasi

Menu **Kas & Rekonsiliasi** memisahkan metode pembayaran dengan aturan berikut:

- **TUNAI** menambah kas fisik di laci.
- **QRIS**, **HUTANG**, dan **PERSONAL** dilaporkan terpisah dan tidak menambah kas laci.
- Kulakan dan operasional baru memiliki pilihan metode pembayaran. Hanya yang berstatus **TUNAI** mengurangi kas laci.
- Pembayaran hutang pelanggan secara tunai menambah kas; pembayaran supplier atau kasbon secara tunai mengurangi kas.
- Owner/supervisor dapat memasukkan kas fisik sebenarnya. Sistem menghitung selisih dan mewajibkan keterangan jika hasilnya lebih atau kurang.
- Riwayat rekonsiliasi disimpan pada `ayaGroupV2/cashClosings/{branchId}`.
- Modal awal laci dibaca dari `pengaturan/modal_laci` dan dapat diperbarui melalui menu Setting tanpa menghapus nilai lama.

Data lama yang tidak memiliki metode pembayaran pada pengeluaran dianggap **TUNAI**, karena export lama tidak menyediakan informasi metode. Periksa kembali bila sebagian pengeluaran lama sebenarnya dibayar melalui QRIS atau hutang.

## Printer thermal 58 mm - Rongta RPP02N

- Cetak standar memakai dialog cetak browser dan layout 58 mm.
- Web Bluetooth hanya bekerja pada HTTPS dan browser/perangkat yang mendukung.
- Preset AYA memakai Rongta RPP02N melalui Bluetooth Classic SPP/RFCOMM + ESC/POS. Web Bluetooth BLE bukan jalur utama untuk RPP02N.
- Bila printer tidak menyediakan layanan GATT yang dapat ditulis browser, gunakan dialog cetak Android/PC atau driver resmi printer.

## Scanner

Scanner kamera menggunakan `BarcodeDetector`. Bila fitur tidak tersedia di browser, barcode masih dapat diketik atau dipindai dengan scanner yang bertindak sebagai keyboard. Kamera memerlukan HTTPS atau localhost.

## PWA dan offline

Service worker menyimpan file aplikasi agar antarmuka dapat dibuka kembali. Penulisan yang gagal masuk antrean lokal dan dicoba ketika koneksi kembali. Konflik stok tetap perlu diuji saat banyak perangkat bekerja bersamaan.

## Backup

Versi ini menyediakan backup dan restore JSON manual khusus `ayaGroupV2`. Backup otomatis yang tetap berjalan ketika perangkat mati memerlukan layanan backend, misalnya Cloud Functions/Cloud Scheduler atau backup terkelola Google Cloud.

## Struktur utama

- `index.html` — kerangka aplikasi
- `css/styles.css` — tema gelap oranye dan responsive tablet
- `js/firebase-config.js` — konfigurasi Firebase
- `js/legacy-adapter.js` — normalisasi struktur export lama
- `js/store.js` — penggabungan data lama/V2 dan antrean offline
- `js/pos.js` — kasir
- `js/master.js` — barang, pelanggan, supplier, titipan, inventaris
- `js/branch.js` — cabang dan transfer stok
- `js/transaction.js` — kulakan, operasional, hutang/kasbon
- `js/backoffice.js` — karyawan, absensi, kalkulator, dokumen
- `js/reports.js` — laporan penjualan, laba/rugi, dan grafik
- `js/cash.js` — laporan kas, uang riil di laci, kas fisik sebenarnya, dan selisih
- `js/kitchen.js` — Kitchen Display
- `js/users.js` — login dan user
- `js/print.js`, `scanner.js`, `bluetooth.js`, `pwa.js` — perangkat dan PWA
- `tools/validate-export.mjs` — pemeriksaan struktur export Firebase tanpa mengunggah data

## Pemeriksaan sebelum produksi

1. Backup database lama.
2. Uji Security Rules dengan akun Owner, Supervisor, dan Kasir.
3. Uji transaksi tunai, QRIS, hutang, personal, kulakan, operasional, pembayaran hutang, dan rekonsiliasi kas pada database uji.
4. Verifikasi 541 transaksi tanpa cabang dan ubah pemetaan bila ada bukti cabang lain.
5. Lengkapi harga beli produk yang masih nol agar laporan laba lebih akurat.
6. Uji printer Bluetooth/USB dan scanner pada perangkat nyata.
7. Pembuatan profil user tersedia, tetapi penghapusan akun Firebase Authentication memerlukan Firebase Console atau Admin SDK.
8. Backup otomatis, notifikasi server, dan custom claims memerlukan backend/Cloud Functions.
