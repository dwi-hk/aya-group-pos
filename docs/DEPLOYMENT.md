# Deployment Ringkas

1. Backup database lama dari Firebase Console.
2. Aktifkan Authentication Email/Password.
3. Tinjau `database.rules.json`; jangan langsung deploy bila rules produksi sudah ada.
4. Jalankan lokal dengan `python -m http.server 8080`.
5. Uji kasir, stok, laporan, dan printer pada data uji.
6. Deploy hosting: `firebase deploy --only hosting`.
7. Setelah Rules Playground/Emulator lulus, deploy rules: `firebase deploy --only database`.
8. Buat profil UID owner pada `ayaGroupV2/users/{uid}`.
9. Uji di Samsung A7 Lite menggunakan Chrome dan koneksi HTTPS.
