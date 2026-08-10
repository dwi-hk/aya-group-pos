/*
 * AYA POS v2.10.10
 * Kolom "Uang Dibayar" hanya aktif untuk metode TUNAI.
 *
 * QRIS, HUTANG, PERSONAL:
 * - input Uang Dibayar dinonaktifkan
 * - nilai input disetel 0
 * - ringkasan Kembali menjadi 0
 *
 * Tidak mengubah logika penyimpanan transaksi.
 * pos.js sudah menyimpan paid=total dan change=0 untuk pembayaran non-tunai.
 */

const CASH_METHOD = 'TUNAI';

let syncScheduled = false;

function syncPaidField() {
  const methodSelect = document.querySelector('#paymentMethod');
  const paidInput = document.querySelector('#paid');

  if (!methodSelect || !paidInput) return;

  const method = String(methodSelect.value || '').trim().toUpperCase();
  const isCash = method === CASH_METHOD;

  paidInput.disabled = !isCash;
  paidInput.setAttribute('aria-disabled', String(!isCash));

  if (isCash) {
    paidInput.placeholder = 'Masukkan uang yang diterima';
    paidInput.title = 'Aktif untuk pembayaran tunai';
    paidInput.style.opacity = '';
    paidInput.style.cursor = '';
    return;
  }

  paidInput.placeholder = `Tidak digunakan untuk ${method}`;
  paidInput.title = `Uang Dibayar tidak diperlukan untuk pembayaran ${method}`;
  paidInput.style.opacity = '0.55';
  paidInput.style.cursor = 'not-allowed';

  if (paidInput.value !== '0') {
    paidInput.value = '0';

    /*
     * Memicu handler renderSummary milik pos.js,
     * sehingga tampilan "Kembali" langsung menjadi Rp0.
     */
    paidInput.dispatchEvent(new Event('input', {
      bubbles: true
    }));
  }
}

function scheduleSync() {
  if (syncScheduled) return;

  syncScheduled = true;

  requestAnimationFrame(() => {
    syncScheduled = false;
    syncPaidField();
  });
}

/*
 * POS dirender dinamis saat pindah tab.
 * MutationObserver memastikan aturan diterapkan setiap kali Tab Kasir dibuka.
 */
const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    if (mutation.type !== 'childList' || !mutation.addedNodes.length) {
      continue;
    }

    scheduleSync();
    break;
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

/*
 * Saat kasir mengganti metode pembayaran.
 */
document.addEventListener('change', event => {
  if (event.target?.id !== 'paymentMethod') return;

  syncPaidField();
});

/*
 * Jalankan juga untuk POS yang sudah telanjur tampil.
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleSync, {
    once: true
  });
} else {
  scheduleSync();
}
