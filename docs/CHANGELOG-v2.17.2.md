# AYA GROUP POS v2.17.2 — Fix Tampilan Barcode Kosong

Penyebab v2.17.1: `.pos-pro-layout` pada Versi Barcode memakai `height: 0`.
Pada kombinasi ukuran layar/zoom tertentu, panel scanner dan nota ikut collapse.

Perbaikan:
- `height: 0` dihapus dari layout Barcode.
- Tinggi area Kasir Barcode dibuat eksplisit berdasarkan viewport.
- Panel Scanner dan Nota di-stretch oleh grid/flex.
- Fallback layar pendek ditambahkan.
- Versi Tablet tetap.
- Database/Firebase, stok, pembayaran, delivery, dan laporan tidak diubah.
