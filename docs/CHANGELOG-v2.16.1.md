# AYA GROUP POS v2.16.1 — Rongta RPP02N

- Preset khusus Rongta RPP02N 58 mm.
- Direct print memprioritaskan Bluetooth Classic SPP/RFCOMM melalui Web Serial.
- Filter SPP UUID 0x1101 saat memilih printer (fallback tanpa filter untuk browser lama).
- ESC/POS tetap digunakan; lebar nota 32 karakter untuk kertas 58 mm.
- Auto cutter dimatikan untuk RPP02N.
- Pengiriman data dibagi 256 byte + jeda singkat untuk mengurangi nota terpotong.
- Reconnect otomatis satu kali bila RFCOMM sempat putus/tidur.
- Tombol Terapkan Preset RPP02N ditambahkan pada Pengaturan.
- Cache service worker dinaikkan ke `aya-pos-v2.16.1-rpp02n-direct-printer`.
