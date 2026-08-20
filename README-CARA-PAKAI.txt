AYA POS - FINAL FIX POPUP SIMPAN + CETAK

KENAPA SEBELUMNYA MASIH TETAP?
GitHub dan Firebase Hosting adalah dua tempat berbeda.
File js/pos.js di GitHub sudah berubah, tetapi aplikasi online baru berubah
setelah file yang sama di-deploy ke Firebase Hosting.

Paket ini juga mengganti nama cache Service Worker supaya PWA/browser
tidak terus menggunakan asset lama.

FILE YANG BERUBAH:
1. js/pos.js
   - Popup menutup otomatis hanya setelah SIMPAN berhasil lalu CETAK berhasil.
2. sw.js
   - Versi cache dinaikkan untuk memaksa browser/PWA mengambil file terbaru.

CARA PAKAI:
A. Di GitHub:
   - Replace js/pos.js
   - Replace sw.js
   - Commit changes

B. Di komputer:
   - Pastikan folder project lokal juga berisi dua file terbaru di atas.
   - Taruh DEPLOY-FIREBASE.bat di folder utama project.
   - Double-click DEPLOY-FIREBASE.bat.
   - Jika diminta login, jalankan: firebase login
   - Setelah deploy berhasil, tutup semua tab AYA POS lalu buka kembali.
   - Tekan Ctrl+F5 sekali.

HASIL:
SIMPAN berhasil -> CETAK berhasil -> popup menutup otomatis sekitar 0,5 detik.
Jika SIMPAN atau CETAK gagal, popup tetap terbuka.
