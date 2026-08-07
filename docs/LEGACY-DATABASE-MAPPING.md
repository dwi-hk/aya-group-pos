# Pemetaan Database Lama ke AYA GROUP POS v2

## Ringkasan export

Export Firebase memuat 18 node tingkat atas. Adaptor tidak mengubah export tersebut saat membaca.

| Node lama | Jumlah | Tujuan di aplikasi |
|---|---:|---|
| `master_menu` | 86 | Basis nama menu, kategori, harga jual, satuan |
| `menu_tambahan` | 85 | Harga beli, isi kemasan, stok, supplier, menu tambahan |
| `master_barang` | 3 | Barang retail tambahan dan atribut cabang |
| `transaksi` | 576 | Penjualan, hutang, konsumsi/personal, dan modal masuk |
| `pengeluaran` | 196 | Operasional cabang |
| `cabang` | 4 | Data cabang; `CAB-02` dideduplikasi sebagai alias |
| `barang_titipan` | 5 | Titipan, retur, terjual, dan pembayaran |
| `pelanggan` + `master_pelanggan` | 2 | Direktori pelanggan |
| `supplier` + `suppliers` | 4 | Direktori supplier |
| `transfer` | 1 | Riwayat transfer stok |
| `modal_tambahan` | 2 | Modal masuk |
| `pembayaran` | 1 | Riwayat pembayaran lama |

## Prioritas penggabungan produk

Untuk ID produk yang sama, data digabung dengan urutan berikut:

1. `master_menu` sebagai data dasar.
2. `menu_tambahan` menimpa data dasar karena biasanya berisi harga beli dan stok yang lebih baru.
3. `master_barang` menambahkan barang retail dengan ID tersendiri.
4. `menu/{id}/stok` menimpa nilai stok bila tersedia.
5. `ayaGroupV2/products/{id}` menjadi overlay terakhir untuk perubahan dari aplikasi baru.
6. Stok cabang dibaca dari `stok_cabang` dan `ayaGroupV2/stockByBranch`.

Hasilnya adalah 132 ID produk/menu unik. Nama yang sama dengan ID berbeda tetap dipertahankan agar tidak ada data yang dihapus diam-diam.

## Normalisasi transaksi

- `TUNAI`, `QRIS`, dan `HUTANG` dipertahankan.
- `KONSUMSI` ditampilkan sebagai `PERSONAL`.
- 23 record `MODAL_MASUK` tidak dihitung sebagai omzet; record tersebut masuk laporan modal.
- 3 transaksi `HUTANG` dibuat menjadi catatan piutang pelanggan.
- Tanggal memakai `timestamp`, `iso`, `tanggalISO`, atau `waktu`, sesuai data yang tersedia.
- Transaksi lama diberi status `done`, sehingga tidak memenuhi antrian Kitchen Display.

## Cabang yang tidak tersedia

Sebanyak 541 dari 576 transaksi tidak memiliki `cabang` atau `branchId`. Karena menu historisnya berasal dari database warung, adaptor memasukkan data tersebut ke `aya-seblak-angkringan` dan menambahkan `branchInferred: true`.

Laporan menampilkan peringatan bila hasil periode mengandung transaksi dengan cabang hasil inferensi. Pemetaan ini dapat diganti kemudian bila tersedia sumber yang menunjukkan cabang sebenarnya.

## Perilaku tulis

- Penjualan baru: `ayaGroupV2/sales/{branchId}` dan cermin kompatibilitas `transaksi/{invoice}`.
- Stok baru: `ayaGroupV2/stockByBranch/{branchId}/{productId}` dan jalur stok lama bila ditemukan.
- Master produk: `ayaGroupV2/products/{productId}` dan update parsial ke sumber lama yang diketahui.
- Setting nota: `ayaGroupV2/settings/receipt`.
- Modul baru lain: namespace `ayaGroupV2`.

Tidak ada operasi penghapusan node lama. Tombol hapus pada master menggunakan status nonaktif di overlay V2.

## Harga beli dan HPP historis

Pada transaksi penjualan lama, tidak semua item menyimpan `hargaBeli`. Saat laporan dibuka, adaptor mencoba melengkapi HPP dari produk dengan ID yang sama pada master gabungan.

Hasil pemeriksaan export yang dilampirkan:

- 2.769 baris item penjualan setelah record modal dikeluarkan.
- 2.376 baris tidak mempunyai harga beli positif langsung pada transaksi.
- 1.169 baris berhasil dilengkapi dari master produk.
- 1.207 baris masih belum mempunyai harga beli positif dan akan ditampilkan sebagai peringatan HPP pada laporan.

Nilai transaksi asli tidak diubah. Agar laba historis lebih akurat, lengkapi harga beli pada master barang/menu yang masih bernilai nol.

## Validasi export

Jalankan pemeriksaan lokal tanpa mengunggah database ke layanan lain:

```bash
node tools/validate-export.mjs /lokasi/export-firebase.json
```

Contoh hasil pemeriksaan export yang dipakai untuk paket ini disimpan pada `docs/validation-result.json`.

## Referensi cabang lama yang tidak mempunyai master

Riwayat `transfer` memakai tujuan `CAB-01`, tetapi ID tersebut tidak ada pada node `cabang`. Aplikasi tidak menebak bahwa `CAB-01` adalah salah satu cabang aktif. Referensi tersebut ditampilkan sebagai **Cabang lama (CAB-01)** dalam keadaan nonaktif agar riwayat tetap terbaca tanpa mencampurkan data ke cabang yang salah.
