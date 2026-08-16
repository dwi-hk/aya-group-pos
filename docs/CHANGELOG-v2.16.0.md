# AYA GROUP POS v2.16.0 — Direct Thermal Printer

## Perubahan
- Menambahkan direct ESC/POS printing dari browser ke printer thermal.
- Desktop utama: Web Serial untuk printer Bluetooth Classic RFCOMM/SPP atau serial/USB.
- Fallback: Web Bluetooth untuk printer BLE yang memiliki characteristic tulis.
- Menambahkan pilihan mode Auto, Bluetooth Classic/Serial, Bluetooth BLE, dan Cetak Browser.
- Menambahkan pilihan lebar kertas 58 mm / 80 mm, baud rate, dan auto cut.
- Menambahkan tombol Hubungkan / Pilih Printer, Tes Cetak, dan Putuskan di Pengaturan.
- Tab Kasir menunggu hasil direct print setelah transaksi tersimpan, tanpa membuka dialog print jika mode direct aktif.
- Cetak ulang nota di laporan juga mengikuti pengaturan printer yang sama.
- Cache service worker dinaikkan ke `aya-pos-v2.16.0-direct-thermal-printer`.

## Catatan penggunaan desktop
1. Pasangkan printer Bluetooth dari Windows terlebih dahulu.
2. Buka aplikasi AYA POS melalui HTTPS dengan Chrome atau Microsoft Edge desktop.
3. Buka Pengaturan > Printer Thermal Langsung.
4. Mode: Auto atau Bluetooth Classic / Serial.
5. Klik Hubungkan / Pilih Printer dan pilih port printer.
6. Klik Tes Cetak.
7. Setelah izin diberikan, transaksi berikutnya dapat langsung mengirim nota ESC/POS ke printer tanpa aplikasi pencetak pihak ketiga.

## Batasan platform browser
Web Serial membutuhkan browser yang mendukung API tersebut dan secure context (HTTPS). Firefox tidak menyediakan jalur Web Serial yang diperlukan untuk direct Bluetooth Classic printing.
