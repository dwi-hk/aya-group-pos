AYA POS v2.19.0 - NOMOR NOTA BERURUTAN

HASIL PERUBAHAN
1. Transaksi baru memakai nomor berurutan per cabang.
2. Contoh AYA Seblak dan Angkringan:
   ASA-000001
   ASA-000002
   ASA-000003
3. Nomor tidak direset setiap hari.
4. Nomor yang sudah dipesan tidak digunakan kembali.
5. Dua kasir yang menyimpan bersamaan tetap mendapat nomor berbeda.
6. Nota lama tidak diubah.

PENTING
Pembuatan nomor resmi membutuhkan koneksi internet agar Firebase dapat
mengunci angka berikutnya. Jika offline, transaksi belum dapat disimpan
sampai internet tersambung kembali.

CARA MEMASANG KE GITHUB
1. Extract file ZIP.
2. Upload dan Replace file berikut sesuai foldernya:
   - database.rules.json
   - sw.js
   - index.html
   - js/app.js
   - js/pos.js
   - js/store.js
   - js/reports.js
   - tests/invoice-sequence.cjs
   - tests/reports-order-time.mjs
   - tests/smoke-kasir-gaji-v2.11.3.cjs
3. Upload juga README-NOMOR-NOTA-BERURUT.txt ke folder utama.
4. Commit dengan pesan:
   Terapkan nomor nota berurutan v2.19.0

CARA MENERAPKAN KE POS ONLINE
Mengunggah ke GitHub belum otomatis mengubah Firebase Hosting.

Gunakan proses pembaruan POS Online yang biasa Anda gunakan. Pastikan file
database.rules.json ikut diterapkan bersama file aplikasi. Setelah versi baru
aktif, tutup semua tab POS, buka kembali, lalu tekan Ctrl+F5 satu kali.

CARA TES
1. Pastikan internet aktif dan login ke POS.
2. Simpan tiga transaksi uji.
3. Nomor harus naik satu angka tanpa nomor ganda.
4. Batalkan satu nota, lalu simpan transaksi baru.
5. Nomor nota yang dibatalkan tidak boleh digunakan kembali.
