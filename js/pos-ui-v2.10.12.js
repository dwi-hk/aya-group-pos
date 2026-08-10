/*
 * AYA POS v2.10.12
 * FIX FINAL KASIR
 *
 * - TUNAI: kolom Uang Dibayar terlihat.
 * - QRIS / HUTANG / PERSONAL: seluruh kolom Uang Dibayar hilang.
 * - Efek "disabled" dari script lama dibatalkan.
 * - Tombol "Kosongkan Keranjang" versi lama dihapus bila masih tersisa.
 *
 * Tidak mengubah HPP, stok, transaksi, laporan, atau database.
 */

const CASH_METHOD = 'TUNAI';
let scheduled = false;

function removeOldClearCartButton() {
  document.querySelectorAll('#clearCartButton').forEach(button => button.remove());
}

function syncPaymentField() {
  const methodSelect = document.querySelector('#paymentMethod');
  const paidInput = document.querySelector('#paid');

  if (!methodSelect || !paidInput) return;

  const paidLabel = paidInput.closest('label');
  if (!paidLabel) return;

  const method = String(methodSelect.value || '').trim().toUpperCase();
  const isCash = method === CASH_METHOD;

  // Batalkan efek disabled dari patch lama.
  paidInput.disabled = false;
  paidInput.removeAttribute('disabled');
  paidInput.removeAttribute('aria-disabled');
  paidInput.removeAttribute('aria-hidden');

  if (isCash) {
    paidLabel.hidden = false;
    paidLabel.style.removeProperty('display');
    paidLabel.style.removeProperty('visibility');
    paidLabel.style.removeProperty('opacity');
    paidInput.placeholder = 'Masukkan uang yang diterima';
    return;
  }

  // Benar-benar hilang, bukan hanya dinonaktifkan.
  paidLabel.hidden = true;
  paidLabel.style.setProperty('display', 'none', 'important');

  if (paidInput.value !== '0') {
    paidInput.value = '0';
    paidInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function syncPOS() {
  removeOldClearCartButton();
  syncPaymentField();
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    syncPOS();
  });
}

document.addEventListener('change', event => {
  if (event.target?.id === 'paymentMethod') {
    syncPaymentField();
    removeOldClearCartButton();
  }
});

const observer = new MutationObserver(mutations => {
  if (mutations.some(m => m.type === 'childList')) {
    scheduleSync();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
} else {
  scheduleSync();
}
