/*
 * AYA POS v2.10.13
 *
 * 1. TUNAI       -> kolom Uang Dibayar tampil.
 * 2. QRIS/HUTANG/PERSONAL -> kolom Uang Dibayar hilang total.
 * 3. Tombol "Kosongkan Keranjang" aktif saat ada item.
 * 4. Dialog transaksi Tertahan menampilkan rincian barang + qty + total.
 *
 * Tidak mengubah database, stok, HPP, atau logika simpan transaksi.
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

  // Batalkan sisa efek disabled dari versi lama.
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

  // Non-tunai: hilang total, bukan sekadar nonaktif.
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

  /*
   * Gunakan kontrol minus bawaan POS supaya cart internal milik pos.js
   * tetap sinkron. Setiap klik merender ulang cart secara langsung.
   */
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

    // Letakkan tepat sebelum tombol Tahan.
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

  if (
    !dialog?.open
    || !body
    || !body.querySelector('[data-resume]')
  ) return;

  const byId = new Map(
    loadHeld().map(record => [String(record.id), record])
  );

  body.querySelectorAll('[data-resume]').forEach(button => {
    const id = String(button.dataset.resume || '');
    const record = byId.get(id);
    if (!record) return;

    const row = button.closest('.summary-row');
    if (!row) return;

    const items = Array.isArray(record.items) ? record.items : [];
    const time = record.at
      ? new Date(record.at).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-';

    const itemLines = items.length
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

    row.style.display = 'block';
    row.style.padding = '12px';
    row.style.marginBottom = '10px';
    row.style.border = '1px solid var(--line, #444)';
    row.style.borderRadius = '10px';

    row.innerHTML = `
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
        margin-bottom:8px;
      ">
        <div>
          <strong>Ditahan ${escapeText(time)}</strong>
          <div class="muted">
            ${items.length} jenis barang
          </div>
        </div>
        <button
          class="secondary-button"
          data-resume="${escapeText(id)}"
        >Lanjutkan</button>
      </div>

      <div style="
        padding-top:8px;
        border-top:1px solid var(--line, #444);
      ">
        ${itemLines}
      </div>

      <div style="
        display:flex;
        justify-content:space-between;
        gap:10px;
        margin-top:9px;
        padding-top:8px;
        border-top:1px solid var(--line, #444);
      ">
        <strong>Total</strong>
        <strong>${rupiahLocal(heldTotal(record))}</strong>
      </div>
    `;
  });
}

function syncPOSUI() {
  syncPaymentField();
  ensureClearCartButton();
  syncClearCartButtonState();

  // Bila dialog Tahan sedang terbuka, rapikan rinciannya.
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

/*
 * Perubahan metode pembayaran.
 */
document.addEventListener('change', event => {
  if (event.target?.id === 'paymentMethod') {
    syncPaymentField();
  }
});

/*
 * Saat tombol Tertahan diklik, pos.js membuka dialog lebih dahulu.
 * Setelah event selesai, kita memperkaya tampilannya dengan rincian barang.
 */
document.addEventListener('click', event => {
  if (event.target?.closest('#heldButton')) {
    setTimeout(enhanceHeldDialog, 0);
    return;
  }

  if (event.target?.closest('#holdButton')) {
    // Setelah cart dipindah ke transaksi tertahan.
    setTimeout(() => {
      syncClearCartButtonState();

      const heldButton = $('#heldButton');
      if (heldButton) {
        const count = loadHeld().length;
        heldButton.textContent = `Tertahan (${count})`;
      }
    }, 0);
  }
});

/*
 * Pantau render ulang Kasir/cart/dialog.
 */
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
