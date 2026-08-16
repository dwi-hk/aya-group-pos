# AYA GROUP POS v2.15.1

- Sidebar desktop: saat menu pilihan disembunyikan, kolom sidebar menjadi 0 px dan halaman aktif memakai lebar layar penuh. Tombol ☰ kecil muncul untuk membuka kembali menu.
- Mobile/tablet kecil: tombol ☰ di luar sidebar muncul saat sidebar tertutup sehingga menu mudah dibuka kembali.
- Kasir / Penjualan: ditambah input **Ongkir Manual (> 5 km)**. Input hanya tampil setelah Delivery + Share Location + pilihan **Lebih dari 5 km**.
- Tarif delivery 0–5 km, minimum belanja, validasi transaksi, dan perhitungan lama tidak diubah. Nilai ongkir manual tetap masuk ke field `shipping` lama agar laporan dan penyimpanan transaksi tetap kompatibel.
