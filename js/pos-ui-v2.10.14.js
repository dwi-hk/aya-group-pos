/*
 * AYA POS v2.10.14
 * FIX TAHAN -> LANJUTKAN
 *
 * Masalah v2.10.13:
 * MutationObserver menggambar ulang isi row transaksi tertahan berkali-kali.
 * Tombol Lanjutkan ikut terganti berulang sehingga klik menjadi tidak stabil.
 *
 * Perbaikan:
 * - Detail transaksi hanya dipasang SATU KALI per row.
 * - Tombol Lanjutkan ASLI dari pos.js TIDAK diganti.
 * - Handler asli pos.js tetap bekerja untuk mengembalikan cart.
 *
 * Tetap mempertahankan:
 * - Uang Dibayar hanya tampil untuk TUNAI.
 * - Tombol Kosongkan Keranjang.
 * - Detail item + qty + total transaksi tertahan.
 */

const CASH_METHOD = 'TUNAI';
let scheduled = false;

const $ = selector => document.querySelector(selector);

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function rupiahLocal(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function loadHeld() {
  try {
    const rows = JSON.parse(localStorage.getItem('aya.held') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function syncPaymentField() {
  const methodSelect = $('#paymentMethod');
  const paidInput = $('#paid');

  if (!methodSelect || !paidInput) return;

  const paidLabel = paidInput.closest('label');
  if (!paidLabel) return;

  const method = String(methodSelect.value || '').trim().toUpperCase();
  const isCash = method === CASH_METHOD;

  paidInput.disabled = false;
  paidInput.removeAttribute('disabled');
  paidInput.removeAttribute('aria-disabled');
  paidInput.removeAttribute('aria-hidden');

  if (isCash) {
    paidLabel.hidden = false;
    paidLabel.style.removeProperty('display');
    paidInput.placeholder = 'Masukkan uang yang diterima';
    return;
  }

  paidLabel.hidden = true;
  paidLabel.style.setProperty('display', 'none', 'important');

  if (paidInput.value !== '0') {
    paidInput.value = '0';
    paidInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function cartHasItems() {
  return Boolean($('#cartList [data-minus]'));
}

function syncClearCartButtonState() {
  const button = $('#clearCartButton');
  if (!button) return;
  button.disabled = !cartHasItems();
}

function clearCart() {
  const cartList = $('#cartList');
  if (!cartList || !cartHasItems()) return;

  const ok = confirm(
    'Kosongkan seluruh isi keranjang?\n\n'
    + 'Semua item pada transaksi yang sedang dibuat akan dihapus.'
  );
  if (!ok) return;

  let guard = 0;
  const MAX_CLICKS = 5000;

  while (guard < MAX_CLICKS) {
    const minus = cartList.querySelector('[data-minus]');
    if (!minus) break;
    minus.click();
    guard++;
  }

  const paid = $('#paid');
  if (paid) {
    paid.value = '0';
    paid.dispatchEvent(new Event('input', { bubbles: true }));
  }

  syncClearCartButtonState();
}

function ensureClearCartButton() {
  let button = $('#clearCartButton');
  const holdButton = $('#holdButton');

  if (!holdButton?.parentElement) return;

  if (!button) {
    button = document.createElement('button');
    button.id = 'clearCartButton';
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = '🧹 Kosongkan Keranjang';
    button.title = 'Hapus semua item dari keranjang transaksi';

    holdButton.parentElement.insertBefore(button, holdButton);
    button.addEventListener('click', clearCart);
  }

  syncClearCartButtonState();
}

function heldTotal(record) {
  return (record?.items || []).reduce(
    (total, item) =>
      total + (Number(item?.qty || 0) * Number(item?.price || 0)),
    0
  );
}

function enhanceHeldDialog() {
  const dialog = $('#appDialog');
  const body = $('#dialogBody');

  if (!dialog?.open || !body) return;

  const records = loadHeld();
  const byId = new Map(
    records.map(record => [String(record.id), record])
  );

  body.querySelectorAll('[data-resume]').forEach(button => {
    const id = String(button.dataset.resume || '');
    const record = byId.get(id);
    if (!record) return;

    const row = button.closest('.summary-row');
    if (!row) return;

    /*
     * PENGAMAN UTAMA v2.10.14:
     * Jangan pernah hias row yang sama lebih dari satu kali.
     * Tombol asli tidak diganti/dibuat ulang.
     */
    if (row.dataset.ayaHeldEnhanced === id) return;
    row.dataset.ayaHeldEnhanced = id;

    const items = Array.isArray(record.items) ? record.items : [];
    const originalLabel = row.querySelector('span');

    const time = record.at
      ? new Date(record.at).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-';

    // Ubah row menjadi kartu tanpa mengganti tombol asli.
    row.style.display = 'block';
    row.style.padding = '12px';
    row.style.marginBottom = '10px';
    row.style.border = '1px solid var(--line, #444)';
    row.style.borderRadius = '10px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '10px';
    header.style.marginBottom = '8px';

    const titleWrap = document.createElement('div');
    titleWrap.innerHTML = `
      <strong>Ditahan ${escapeText(time)}</strong>
      <div class="muted">${items.length} jenis barang</div>
    `;

    header.appendChild(titleWrap);

    /*
     * Pindahkan tombol Lanjutkan ASLI ke header.
     * Tidak clone, tidak innerHTML ulang, sehingga handler delegasi pos.js
     * tetap menerima klik tombol yang sama.
     */
    header.appendChild(button);

    if (originalLabel) {
      originalLabel.remove();
    }

    const detail = document.createElement('div');
    detail.style.paddingTop = '8px';
    detail.style.borderTop = '1px solid var(--line, #444)';

    detail.innerHTML = items.length
      ? items.map(item => `
          <div style="
            display:flex;
            justify-content:space-between;
            gap:12px;
            padding:3px 0;
          ">
            <span>
              <b>${Number(item.qty || 0)}×</b>
              ${escapeText(item.name || 'Item')}
            </span>
            <span>${rupiahLocal(
              Number(item.qty || 0) * Number(item.price || 0)
            )}</span>
          </div>
        `).join('')
      : '<div class="muted">Tidak ada rincian barang.</div>';

    const total = document.createElement('div');
    total.style.display = 'flex';
    total.style.justifyContent = 'space-between';
    total.style.gap = '10px';
    total.style.marginTop = '9px';
    total.style.paddingTop = '8px';
    total.style.borderTop = '1px solid var(--line, #444)';
    total.innerHTML = `
      <strong>Total</strong>
      <strong>${rupiahLocal(heldTotal(record))}</strong>
    `;

    row.prepend(header);
    row.appendChild(detail);
    row.appendChild(total);
  });
}

function syncPOSUI() {
  syncPaymentField();
  ensureClearCartButton();
  syncClearCartButtonState();
  enhanceHeldDialog();
}

function scheduleSync() {
  if (scheduled) return;

  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    syncPOSUI();
  });
}

document.addEventListener('change', event => {
  if (event.target?.id === 'paymentMethod') {
    syncPaymentField();
  }
});

document.addEventListener('click', event => {
  if (event.target?.closest('#heldButton')) {
    setTimeout(enhanceHeldDialog, 0);
    return;
  }

  if (event.target?.closest('#holdButton')) {
    setTimeout(() => {
      syncClearCartButtonState();
    }, 0);
    return;
  }

  /*
   * Jangan intercept tombol [data-resume].
   * Klik sengaja dibiarkan diterima oleh handler asli di pos.js.
   */
  if (event.target?.closest('[data-resume]')) {
    setTimeout(() => {
      syncClearCartButtonState();
    }, 0);
  }
});

const observer = new MutationObserver(mutations => {
  if (
    mutations.some(mutation => (
      mutation.type === 'childList'
      && (
        mutation.addedNodes.length
        || mutation.removedNodes.length
      )
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
