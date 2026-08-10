/*
 * AYA POS v2.10.11
 * Penyempurnaan UI Kasir:
 * 1) Uang Dibayar hanya terlihat saat metode TUNAI.
 * 2) QRIS / HUTANG / PERSONAL menyembunyikan seluruh kolom Uang Dibayar.
 * 3) Tombol "Kosongkan Keranjang" untuk membersihkan seluruh item dengan cepat.
 *
 * Patch ini tidak mengubah penyimpanan transaksi, HPP, stok, atau database.
 */

const CASH_METHOD = 'TUNAI';
let scheduled = false;

function paymentElements() {
  const method = document.querySelector('#paymentMethod');
  const paid = document.querySelector('#paid');

  return {
    method,
    paid,
    paidLabel: paid?.closest('label') || null
  };
}

function syncPaymentField() {
  const { method, paid, paidLabel } = paymentElements();

  if (!method || !paid || !paidLabel) return;

  const isCash =
    String(method.value || '').trim().toUpperCase() === CASH_METHOD;

  /*
   * TUNAI: tampil.
   * QRIS / HUTANG / PERSONAL: seluruh label + input hilang.
   */
  paidLabel.hidden = !isCash;

  if (isCash) {
    paid.disabled = false;
    paid.removeAttribute('aria-hidden');
    paid.placeholder = 'Masukkan uang yang diterima';
    return;
  }

  /*
   * Nilai dibersihkan agar perhitungan "Kembali" milik pos.js tetap Rp0.
   */
  paid.disabled = true;
  paid.setAttribute('aria-hidden', 'true');

  if (paid.value !== '0') {
    paid.value = '0';
    paid.dispatchEvent(new Event('input', {
      bubbles: true
    }));
  }
}

function cartHasItems() {
  return Boolean(
    document.querySelector('#cartList [data-minus]')
  );
}

function syncClearButtonState() {
  const button = document.querySelector('#clearCartButton');
  if (!button) return;

  button.disabled = !cartHasItems();
}

function clearCartUsingPOSControls() {
  const cartList = document.querySelector('#cartList');
  if (!cartList) return;

  /*
   * pos.js menyimpan cart di dalam modul.
   * Agar tidak mengubah logika transaksi, patch memakai tombol minus resmi
   * yang sudah disediakan POS sampai seluruh item habis.
   */
  let guard = 0;
  const MAX_CLICKS = 5000;

  while (guard < MAX_CLICKS) {
    const minus = cartList.querySelector('[data-minus]');
    if (!minus) break;

    minus.click();
    guard++;
  }

  if (guard >= MAX_CLICKS) {
    console.warn(
      'Kosongkan Keranjang dihentikan karena mencapai batas pengaman.'
    );
  }

  const paid = document.querySelector('#paid');
  if (paid) {
    paid.value = '0';
    paid.dispatchEvent(new Event('input', {
      bubbles: true
    }));
  }

  syncClearButtonState();
}

function ensureClearCartButton() {
  if (document.querySelector('#clearCartButton')) {
    syncClearButtonState();
    return;
  }

  const holdButton = document.querySelector('#holdButton');
  if (!holdButton?.parentElement) return;

  const button = document.createElement('button');
  button.id = 'clearCartButton';
  button.type = 'button';
  button.className = 'secondary-button';
  button.textContent = '🧹 Kosongkan Keranjang';
  button.title = 'Hapus seluruh item dari keranjang transaksi';

  holdButton.parentElement.insertBefore(
    button,
    holdButton
  );

  button.addEventListener('click', () => {
    if (!cartHasItems()) return;

    const approved = confirm(
      'Kosongkan seluruh isi keranjang?\n\n'
      + 'Semua item pada transaksi yang sedang dibuat akan dihapus.'
    );

    if (!approved) return;

    clearCartUsingPOSControls();
  });

  syncClearButtonState();
}

function syncPOSUI() {
  syncPaymentField();
  ensureClearCartButton();
  syncClearButtonState();
}

function scheduleSync() {
  if (scheduled) return;

  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    syncPOSUI();
  });
}

/*
 * Metode pembayaran berubah.
 */
document.addEventListener('change', event => {
  if (event.target?.id !== 'paymentMethod') return;

  syncPaymentField();
});

/*
 * POS dirender ulang saat pindah halaman, cart berubah,
 * atau transaksi selesai. Observer memasang ulang UI bila diperlukan.
 */
const observer = new MutationObserver(mutations => {
  if (
    mutations.some(mutation => (
      mutation.type === 'childList'
      && mutation.addedNodes.length
    ))
  ) {
    scheduleSync();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    scheduleSync,
    { once: true }
  );
} else {
  scheduleSync();
}
