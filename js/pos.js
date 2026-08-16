import { pushData, atomicStock, mirrorLegacySale, stockForBranch } from './store.js';
import { getCachedProducts, productBelongsToBranch } from './product-cache.js';
import { rupiah, number, escapeHTML, uid, sum } from './utils.js';
import { printReceipt } from './print.js';
import { audit } from './audit.js';
import { startScanner, stopScanner, scannerSupported } from './scanner.js';

const PAGE_SIZE = 300;
const SEARCH_DELAY = 180;
const CASH_METHOD = 'TUNAI';
const PAYMENT_METHODS = [
  { value: 'TUNAI', icon: '💵' },
  { value: 'QRIS', icon: '▦' },
  { value: 'PERSONAL', icon: '👤' },
  { value: 'HUTANG', icon: '🟠' }
];
const DELIVERY_RATES = [
  { id: '0-1', distance: '0–1 km', fee: 3000, minimum: 10000 },
  { id: '1-2', distance: '>1–2 km', fee: 5000, minimum: 15000 },
  { id: '2-3', distance: '>2–3 km', fee: 7000, minimum: 20000 },
  { id: '3-4', distance: '>3–4 km', fee: 9000, minimum: 25000 },
  { id: '4-5', distance: '>4–5 km', fee: 11000, minimum: 30000 },
  { id: 'over-5', distance: 'Lebih dari 5 km', fee: 0, minimum: 0, adminConfirmation: true }
];
const DELIVERY_RATE_BY_ID = new Map(DELIVERY_RATES.map(rate => [rate.id, rate]));

let cart = [];
let held = JSON.parse(localStorage.getItem('aya.held') || '[]');
let products = [];
let saleSaving = false;

const saveHeld = () => localStorage.setItem('aya.held', JSON.stringify(held));

function effectivePrice(product, level) {
  return number(
    level === 'grosir'
      ? product.wholesalePrice
      : level === 'reseller'
        ? product.resellerPrice
        : product.price
  );
}

function debounce(callback, delay = SEARCH_DELAY) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function invoiceNumber(branch, timestamp = Date.now()) {
  const date = new Date(timestamp);
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('');
  const timePart = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
    String(date.getMilliseconds()).padStart(3, '0')
  ].join('');

  return `${branch.code || 'AYA'}-${datePart}-${timePart}`;
}

function formatDeviceDate(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

export async function renderPOS(ctx) {
  products = await getCachedProducts();
  cart = [];

  const available = products
    .filter(product => (
      product.active !== false
      && productBelongsToBranch(product, ctx.branch.id)
    ))
    .map(product => ({
      ...product,
      stock: stockForBranch(product, ctx.branch.id),
      _search: `${product.name || ''} ${product.barcode || ''} ${product.code || ''}`
        .toLowerCase()
    }));

  const productById = new Map(available.map(product => [String(product.id), product]));
  const productByBarcode = new Map(
    available
      .filter(product => product.barcode)
      .map(product => [String(product.barcode).trim().toLowerCase(), product])
  );
  const productByQuickCode = new Map();

  available.forEach(product => {
    [product.code, product.barcode, product.id].forEach(value => {
      const key = String(value || '').trim().toLowerCase();
      if (key) productByQuickCode.set(key, product);
    });
  });

  const categories = [
    'Semua',
    ...new Set(available.map(product => product.category || 'Lainnya'))
  ].sort((a, b) => (
    a === 'Semua' ? -1 : b === 'Semua' ? 1 : String(a).localeCompare(String(b), 'id')
  ));

  let currentPage = 1;
  let selectedCartId = '';
  let draftCreatedAt = Date.now();
  let draftInvoice = invoiceNumber(ctx.branch, draftCreatedAt);

  ctx.host.innerHTML = `
    <div class="aya-pos-view aya-pos-pro">
      <header class="pos-pro-page-head">
        <div>
          <span class="pos-pro-eyebrow">KASIR CABANG AKTIF</span>
          <h2>Kasir AYA Seblak &amp; Angkringan</h2>
          <p>POS makanan dan minuman · transaksi cepat · nota berjalan</p>
        </div>
        <div class="pos-pro-page-meta">
          <span class="pos-pro-branch">${escapeHTML(ctx.branch.name)}</span>
          <span>${escapeHTML(ctx.user.name || 'Owner')} · Online</span>
          <time id="posDeviceClock">${formatDeviceDate()}</time>
        </div>
      </header>

      <div class="pos-pro-layout">
        <section class="pos-pro-panel pos-pro-catalog" aria-label="Katalog menu">
          <header class="pos-pro-section-head">
            <div>
              <span class="pos-pro-eyebrow">KATALOG MENU CABANG</span>
              <h3>🍲 Daftar Menu AYA</h3>
            </div>
            <div class="pos-pro-head-actions">
              <button id="newTransaction" type="button" class="pos-pro-button pos-pro-button-accent">🧾 Transaksi Baru</button>
              <button id="openMasterButton" type="button" class="pos-pro-button">✏️ Kelola Menu</button>
            </div>
          </header>

          <div class="pos-pro-code-box">
            <label for="quickCode">KODE / BARCODE MENU</label>
            <div>
              <input id="quickCode" autocomplete="off" placeholder="Ketik kode menu, lalu tekan Enter">
              <button id="scanButton" type="button" class="pos-pro-scan-button">📷 Scan Kamera <kbd>F8</kbd></button>
            </div>
            <div id="lastScanResult" class="pos-pro-scan-result" data-state="ready" aria-live="polite">
              <span>SIAP SCAN</span>
              <strong>Scan barcode atau masukkan kode menu</strong>
              <small>Item yang terbaca akan tampil jelas di sini dan langsung masuk ke nota.</small>
            </div>
          </div>

          <div class="pos-pro-filter-row">
            <label class="pos-pro-search"><span>🔍</span><input id="productSearch" autocomplete="off" placeholder="Cari nama menu, kode, atau barcode…"></label>
            <select id="categoryFilter" aria-label="Kategori menu">
              ${categories.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('')}
            </select>
            <select id="priceLevel" aria-label="Tingkat harga">
              <option value="ecer">Harga Ecer</option>
              <option value="grosir">Harga Grosir</option>
              <option value="reseller">Harga Reseller</option>
            </select>
            <button id="addMenuButton" type="button" class="pos-pro-button">＋ Tambah Menu</button>
            <button id="importMenuButton" type="button" class="pos-pro-button">⇩ Import</button>
          </div>

          <nav id="categoryButtons" class="pos-pro-categories" aria-label="Pilih kategori">
            ${categories.map((category, index) => `<button type="button" data-category="${escapeHTML(category)}" class="${index === 0 ? 'is-active' : ''}">${escapeHTML(category)}</button>`).join('')}
          </nav>

          <div id="productGrid" class="pos-pro-product-grid"></div>

          <footer class="pos-pro-pagination">
            <small id="productCount"></small>
            <div>
              <button id="previousProductPage" type="button" class="pos-pro-button">← Sebelumnya</button>
              <span id="productPageLabel">1 / 1</span>
              <button id="nextProductPage" type="button" class="pos-pro-button">Berikutnya →</button>
            </div>
          </footer>
        </section>

        <aside class="pos-pro-panel pos-pro-receipt" aria-label="Nota berjalan">
          <header class="pos-pro-receipt-head">
            <div class="pos-pro-receipt-identity"><span>NOTA BERJALAN</span><strong id="draftInvoice">${escapeHTML(draftInvoice)}</strong></div>
            <div class="pos-pro-mart-total" aria-live="polite">
              <span>TOTAL BELANJA</span>
              <strong id="martTotalDisplay">Rp 0</strong>
              <small id="martItemCount">0 item</small>
            </div>
            <b>${escapeHTML(ctx.branch.code || ctx.branch.name)}</b>
          </header>
          <div class="pos-pro-operator">
            <span>👤 ${escapeHTML(ctx.user.name || 'Owner')}</span>
            <time id="draftClock">${formatDeviceDate(draftCreatedAt)}</time>
          </div>

          <section class="pos-pro-customer">
            <div class="pos-pro-customer-title">👥 DATA PELANGGAN / PEMESAN</div>
            <div class="pos-pro-customer-grid">
              <label>Nama Pelanggan<input id="customerName" autocomplete="name" placeholder="Nama pelanggan / nama personal"></label>
              <label>Nomor WhatsApp<input id="customerPhone" inputmode="tel" autocomplete="tel" placeholder="08xxxxxxxxxx"></label>
              <label class="full">Alamat<textarea id="customerAddress" rows="2" placeholder="Diisi untuk pesanan delivery"></textarea></label>
            </div>
          </section>

          <div class="pos-pro-cart-heading"><span>MENU PESANAN</span><span>JUMLAH &amp; AKSI</span></div>
          <div id="cartList" class="pos-pro-cart-list"></div>

          <div class="pos-pro-order-grid">
            <label>Jenis Pesanan
              <select id="orderType"><option>Makan di tempat</option><option>Dibungkus</option><option>Delivery</option></select>
            </label>
            <label id="shippingField" hidden>Ongkos Kirim
              <input id="shipping" inputmode="numeric" value="0" readonly>
              <small>Terisi otomatis; jarak di atas 5 km diisi setelah konfirmasi admin.</small>
            </label>
            <label id="manualShippingField" class="full pos-pro-manual-shipping" hidden>Ongkir Manual (&gt; 5 km)
              <input id="manualShipping" type="number" inputmode="numeric" min="0" step="1000" value="0" placeholder="Masukkan ongkir manual">
              <small>Khusus jarak lebih dari 5 km. Tarif 0–5 km tetap mengikuti ongkir otomatis yang sudah ada di sistem.</small>
            </label>
            <section id="deliveryOptions" class="pos-pro-delivery-options full" hidden>
              <div class="pos-pro-delivery-head">
                <div><span>🛵 TARIF DELIVERY</span><small>Ongkir dihitung setelah Share Location diterima.</small></div>
                <strong id="deliveryRatePreview">Tunggu Share Location</strong>
              </div>
              <label class="pos-pro-share-location">
                <input id="shareLocationReceived" type="checkbox">
                <span>Share Location pelanggan sudah diterima</span>
              </label>
              <span class="pos-pro-distance-title">Klik Jarak Warung ke Pelanggan</span>
              <select id="deliveryDistanceBand" hidden aria-hidden="true" tabindex="-1">
                <option value="">Belum dipilih</option>
                ${DELIVERY_RATES.map(rate => `<option value="${rate.id}">${rate.distance}</option>`).join('')}
              </select>
              <div id="deliveryDistanceButtons" class="pos-pro-distance-buttons">
                ${DELIVERY_RATES.map(rate => `
                  <button type="button" data-delivery-band="${rate.id}" disabled>
                    <span>${rate.distance}</span>
                    <b>${rate.adminConfirmation ? 'Konfirmasi Admin' : rupiah(rate.fee)}</b>
                    <small>${rate.adminConfirmation ? 'Ongkir diisi manual' : `Min. belanja ${rupiah(rate.minimum)}`}</small>
                  </button>`).join('')}
              </div>
              <div id="deliveryMinimumStatus" class="pos-pro-delivery-minimum" data-state="waiting">
                Share Location diperlukan sebelum ongkir dihitung.
              </div>
              <div class="pos-pro-delivery-rate-list" aria-label="Daftar tarif dan minimum belanja">
                ${DELIVERY_RATES.map(rate => `
                  <div><span>${rate.distance}</span><b>${rate.adminConfirmation ? 'Konfirmasi admin' : `${rupiah(rate.fee)} · Min. ${rupiah(rate.minimum)}`}</b></div>`).join('')}
              </div>
            </section>
            <label>Biaya Kemasan / Styrofoam<input id="styrofoamQty" type="number" min="0" value="0"><small>Rp1.000 per buah</small></label>
            <label class="full">Catatan Pesanan<textarea id="orderNotes" rows="2" placeholder="Contoh: tidak pedas, tanpa bawang, pisahkan kuah"></textarea></label>
          </div>

          <div class="pos-pro-item-actions">
            <button id="editSelectedPrice" type="button" class="pos-pro-button">✏️ Edit Harga Item</button>
            <button id="focusDiscount" type="button" class="pos-pro-button">🏷️ Diskon</button>
            <button id="deleteSelectedItem" type="button" class="pos-pro-button pos-pro-danger">🗑️ Hapus Item</button>
          </div>
          <label class="pos-pro-discount">Diskon Nota<input id="discount" inputmode="numeric" value="0"></label>
          <div id="cartSummary" class="pos-pro-summary"></div>

          <section class="pos-pro-payment">
            <span class="pos-pro-payment-title">METODE PEMBAYARAN</span>
            <select id="paymentMethod" aria-label="Metode pembayaran">
              ${PAYMENT_METHODS.map(method => `<option value="${method.value}">${method.value}</option>`).join('')}
            </select>
            <div class="pos-pro-payment-buttons">
              ${PAYMENT_METHODS.map((method, index) => `<button type="button" data-payment-method="${method.value}" class="${index === 0 ? 'is-active' : ''}"><span>${method.icon}</span><b>${method.value}</b></button>`).join('')}
            </div>
          </section>

          <label id="paidField" class="pos-pro-paid-field">Uang Diterima
            <div class="pos-pro-paid-input"><input id="paid" inputmode="numeric" value="0"><strong id="paidAmountDisplay">Rp 0</strong></div>
            <div class="pos-pro-cash-shortcuts">
              <button type="button" data-cash-action="exact">Uang Pas</button>
              <button type="button" data-cash-add="5000">+5K</button><button type="button" data-cash-add="10000">+10K</button>
              <button type="button" data-cash-add="20000">+20K</button><button type="button" data-cash-add="50000">+50K</button>
              <button type="button" data-cash-add="100000">+100K</button><button type="button" data-cash-action="reset">Reset</button>
            </div>
          </label>

          <footer class="pos-pro-footer-actions">
            <button id="heldButton" type="button" class="pos-pro-button">📥 AMBIL (${held.filter(item => item.branchId === ctx.branch.id).length})</button>
            <button id="holdButton" type="button" class="pos-pro-button pos-pro-hold">TAHAN</button>
            <button id="saveSale" type="button" class="pos-pro-button pos-pro-save">Simpan &amp; Cetak</button>
          </footer>
        </aside>
      </div>
    </div>`;

  const $ = selector => ctx.host.querySelector(selector);

  const filteredProducts = () => {
    const query = $('#productSearch').value.trim().toLowerCase();
    const category = $('#categoryFilter').value;

    return available.filter(product => (
      (category === 'Semua' || product.category === category)
      && (!query || product._search.includes(query))
    ));
  };

  const syncCategoryButtons = () => {
    const selected = $('#categoryFilter').value;
    ctx.host.querySelectorAll('[data-category]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.category === selected);
    });
  };

  const renderProducts = () => {
    const rows = filteredProducts();
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const level = $('#priceLevel').value;

    $('#productGrid').innerHTML = pageRows.length
      ? pageRows.map(product => `
          <button type="button" class="pos-pro-product-card" data-product="${escapeHTML(product.id)}">
            <span class="pos-pro-product-category">${escapeHTML(product.category || 'Lainnya')}</span>
            <strong>${escapeHTML(product.name)}</strong>
            <small>${escapeHTML(product.code || product.barcode || product.id)} · Stok ${number(product.stock)}</small>
            <b>${rupiah(effectivePrice(product, level))}</b>
          </button>`).join('')
      : `<div class="pos-pro-products-empty"><span>🍽️</span><strong>Menu tidak ditemukan</strong><p>Tambahkan menu baru atau ubah kata pencarian dan kategori.</p><button id="emptyAddMenuButton" type="button" class="pos-pro-button pos-pro-button-accent">＋ Tambah Menu</button></div>`;

    const firstNumber = rows.length ? start + 1 : 0;
    const lastNumber = Math.min(start + PAGE_SIZE, rows.length);
    $('#productCount').textContent =
      `Menampilkan ${firstNumber.toLocaleString('id-ID')}–${lastNumber.toLocaleString('id-ID')} dari ${rows.length.toLocaleString('id-ID')} menu`;

    $('#productPageLabel').textContent = `${currentPage} / ${totalPages}`;
    $('#previousProductPage').disabled = currentPage <= 1;
    $('#nextProductPage').disabled = currentPage >= totalPages;
    syncCategoryButtons();
  };

  const totals = () => {
    const subtotal = sum(cart, item => item.qty * item.price);
    const shipping = number($('#shipping').value);
    const styrofoamQty = number($('#styrofoamQty').value);
    const discount = number($('#discount').value);

    return {
      subtotal,
      shipping,
      styrofoamQty,
      styrofoamTotal: styrofoamQty * 1000,
      discount,
      total: Math.max(0, subtotal + shipping + styrofoamQty * 1000 - discount)
    };
  };

  const renderSummary = () => {
    const values = totals();
    const paid = number($('#paid').value);

    $('#cartSummary').innerHTML = `
      <div><span>Subtotal</span><b>${rupiah(values.subtotal)}</b></div>
      <div><span>Ongkir</span><b>${rupiah(values.shipping)}</b></div>
      <div><span>Kemasan</span><b>${rupiah(values.styrofoamTotal)}</b></div>
      <div><span>Diskon</span><b class="pos-pro-negative">-${rupiah(values.discount)}</b></div>
      <div class="pos-pro-total"><span>TOTAL</span><b>${rupiah(values.total)}</b></div>
      <div class="pos-pro-change"><span>Kembalian</span><b>${rupiah(Math.max(0, paid - values.total))}</b></div>`;
    $('#paidAmountDisplay').textContent = rupiah(paid);

    const martTotalDisplay = $('#martTotalDisplay');
    const martItemCount = $('#martItemCount');
    if (martTotalDisplay) martTotalDisplay.textContent = rupiah(values.total);
    if (martItemCount) {
      const itemCount = sum(cart, item => number(item.qty));
      martItemCount.textContent = `${itemCount.toLocaleString('id-ID')} item`;
    }

    const minimumStatus = $('#deliveryMinimumStatus');
    if (minimumStatus) {
      const isDelivery = $('#orderType').value === 'Delivery';
      const locationReceived = $('#shareLocationReceived').checked;
      const rate = DELIVERY_RATE_BY_ID.get($('#deliveryDistanceBand').value);

      if (!isDelivery || !locationReceived) {
        minimumStatus.dataset.state = 'waiting';
        minimumStatus.textContent = 'Share Location diperlukan sebelum ongkir dihitung.';
      } else if (!rate) {
        minimumStatus.dataset.state = 'waiting';
        minimumStatus.textContent = 'Pilih jarak untuk melihat minimum belanja.';
      } else if (rate.adminConfirmation) {
        minimumStatus.dataset.state = 'waiting';
        minimumStatus.textContent = 'Jarak lebih dari 5 km: isi ongkir manual sesuai konfirmasi admin.';
      } else if (values.subtotal >= rate.minimum) {
        minimumStatus.dataset.state = 'success';
        minimumStatus.textContent = `✓ Minimum belanja ${rupiah(rate.minimum)} sudah terpenuhi.`;
      } else {
        minimumStatus.dataset.state = 'error';
        minimumStatus.textContent = `Kurang ${rupiah(rate.minimum - values.subtotal)} untuk minimum belanja ${rupiah(rate.minimum)}.`;
      }
    }
  };

  const renderCart = () => {
    if (selectedCartId && !cart.some(item => String(item.id) === selectedCartId)) {
      selectedCartId = '';
    }

    $('#cartList').innerHTML = cart.length
      ? cart.map(item => `
          <div class="pos-pro-cart-row ${selectedCartId === String(item.id) ? 'is-selected' : ''}" data-cart-item="${escapeHTML(item.id)}">
            <div class="pos-pro-cart-copy">
              <strong>${escapeHTML(item.name)}</strong>
              <small>${rupiah(item.price)} / ${escapeHTML(item.unit || 'item')} · Total <b>${rupiah(item.qty * item.price)}</b></small>
            </div>
            <div class="pos-pro-qty-controls">
              <button type="button" data-minus="${escapeHTML(item.id)}">−</button>
              <b>${item.qty}</b>
              <button type="button" data-plus="${escapeHTML(item.id)}">＋</button>
            </div>
          </div>`).join('')
      : '<div class="pos-pro-cart-empty"><strong>Belum ada menu dipilih</strong><span>Pilih menu dari katalog di sebelah kiri.</span></div>';

    renderSummary();
  };

  const syncDeliveryUI = () => {
    const isDelivery = $('#orderType').value === 'Delivery';
    const locationReceived = $('#shareLocationReceived').checked;
    const bandId = $('#deliveryDistanceBand').value;
    const rate = DELIVERY_RATE_BY_ID.get(bandId);
    const manualRate = Boolean(isDelivery && locationReceived && rate?.adminConfirmation);

    $('#shippingField').hidden = !isDelivery || manualRate;
    $('#manualShippingField').hidden = !manualRate;
    $('#deliveryOptions').hidden = !isDelivery;
    $('#deliveryDistanceBand').disabled = !isDelivery || !locationReceived;

    if (!isDelivery) {
      $('#shipping').value = '0';
      $('#manualShipping').value = '0';
      $('#shipping').readOnly = true;
      $('#shareLocationReceived').checked = false;
      $('#deliveryDistanceBand').value = '';
      $('#deliveryRatePreview').textContent = 'Khusus Delivery';
    } else if (!locationReceived) {
      $('#shipping').value = '0';
      $('#manualShipping').value = '0';
      $('#shipping').readOnly = true;
      $('#deliveryDistanceBand').value = '';
      $('#deliveryRatePreview').textContent = 'Tunggu Share Location';
    } else if (rate) {
      $('#shipping').readOnly = !rate.adminConfirmation;
      if (rate.adminConfirmation) {
        if (document.activeElement !== $('#manualShipping')) {
          $('#manualShipping').value = String(number($('#shipping').value));
        }
        $('#deliveryRatePreview').textContent = `>5 km · Ongkir Manual · ${rupiah(number($('#shipping').value))}`;
      } else {
        $('#manualShipping').value = '0';
        $('#deliveryRatePreview').textContent = `${rate.distance} · ${rupiah(rate.fee)} · Min. ${rupiah(rate.minimum)}`;
      }
    } else {
      $('#shipping').value = '0';
      $('#manualShipping').value = '0';
      $('#shipping').readOnly = true;
      $('#deliveryRatePreview').textContent = 'Pilih jarak';
    }

    const selectedBand = $('#deliveryDistanceBand').value;
    ctx.host.querySelectorAll('[data-delivery-band]').forEach(button => {
      button.disabled = !isDelivery || !locationReceived;
      button.classList.toggle('is-active', button.dataset.deliveryBand === selectedBand);
    });

    renderSummary();
  };

  const applyDeliveryRate = () => {
    const bandId = $('#deliveryDistanceBand').value;
    const rate = DELIVERY_RATE_BY_ID.get(bandId);

    if (rate) {
      $('#shipping').value = String(rate.fee || 0);
      if (!rate.adminConfirmation) $('#manualShipping').value = '0';
    }
    syncDeliveryUI();

    if (rate?.adminConfirmation) {
      $('#manualShipping').focus();
      $('#manualShipping').select();
    }
  };

  const syncPaymentUI = () => {
    const method = String($('#paymentMethod').value || CASH_METHOD).toUpperCase();
    const isCash = method === CASH_METHOD;

    ctx.host.querySelectorAll('[data-payment-method]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.paymentMethod === method);
    });

    $('#paidField').hidden = !isCash;
    if (!isCash && $('#paid').value !== '0') $('#paid').value = '0';
    renderSummary();
  };

  const updateDraftIdentity = () => {
    $('#draftInvoice').textContent = draftInvoice;
    $('#draftClock').textContent = formatDeviceDate(draftCreatedAt);
  };

  const draftSnapshot = () => ({
    draftInvoice,
    draftCreatedAt,
    orderType: $('#orderType').value,
    paymentMethod: $('#paymentMethod').value,
    customerName: $('#customerName').value.trim(),
    customerPhone: $('#customerPhone').value.trim(),
    customerAddress: $('#customerAddress').value.trim(),
    shareLocationReceived: $('#shareLocationReceived').checked,
    deliveryDistanceBand: $('#deliveryDistanceBand').value,
    orderNotes: $('#orderNotes').value.trim(),
    shipping: number($('#shipping').value),
    styrofoamQty: number($('#styrofoamQty').value),
    discount: number($('#discount').value),
    paid: number($('#paid').value)
  });

  const setDraftField = (id, value) => {
    const field = $(`#${id}`);
    if (!field) return;
    field.value = value ?? '';
  };

  const restoreDraft = record => {
    if (record.draftCreatedAt || record.at) {
      draftCreatedAt = number(record.draftCreatedAt || record.at);
      draftInvoice = record.draftInvoice || invoiceNumber(ctx.branch, draftCreatedAt);
    }

    setDraftField('orderType', record.orderType || 'Makan di tempat');
    setDraftField('paymentMethod', record.paymentMethod || CASH_METHOD);
    setDraftField('customerName', record.customerName || '');
    setDraftField('customerPhone', record.customerPhone || '');
    setDraftField('customerAddress', record.customerAddress || '');
    const legacyDeliveryDraft = (
      record.orderType === 'Delivery'
      && number(record.shipping) > 0
      && typeof record.shareLocationReceived !== 'boolean'
    );
    $('#shareLocationReceived').checked = legacyDeliveryDraft || Boolean(record.shareLocationReceived);
    setDraftField(
      'deliveryDistanceBand',
      record.deliveryDistanceBand || (legacyDeliveryDraft ? 'over-5' : '')
    );
    setDraftField('orderNotes', record.orderNotes || record.notes || '');
    setDraftField('shipping', number(record.shipping));
    setDraftField('styrofoamQty', number(record.styrofoamQty));
    setDraftField('discount', number(record.discount));
    setDraftField(
      'paid',
      String(record.paymentMethod || CASH_METHOD).toUpperCase() === CASH_METHOD
        ? number(record.paid)
        : 0
    );

    updateDraftIdentity();
    syncDeliveryUI();
    $('#paymentMethod').dispatchEvent(new Event('change', { bubbles: true }));
    renderCart();
  };

  const resetDraft = () => {
    draftCreatedAt = Date.now();
    draftInvoice = invoiceNumber(ctx.branch, draftCreatedAt);
    selectedCartId = '';
    restoreDraft({
      orderType: 'Makan di tempat', paymentMethod: CASH_METHOD,
      customerName: '', customerPhone: '', customerAddress: '',
      shareLocationReceived: false, deliveryDistanceBand: '',
      orderNotes: '',
      shipping: 0, styrofoamQty: 0, discount: 0, paid: 0
    });
  };

  function showScanResult(product, code = '', state = 'success') {
    const host = $('#lastScanResult');
    if (!host) return;

    if (product) {
      host.dataset.state = state;
      host.innerHTML = `
        <span>✓ BARCODE TERBACA</span>
        <strong>${escapeHTML(product.name)}</strong>
        <small>${escapeHTML(String(code || product.barcode || product.code || product.id))} · ${rupiah(effectivePrice(product, $('#priceLevel').value))}</small>`;
      return;
    }

    host.dataset.state = 'error';
    host.innerHTML = `
      <span>BARCODE TIDAK DITEMUKAN</span>
      <strong>${escapeHTML(String(code || '-'))}</strong>
      <small>Periksa barcode atau daftarkan kode tersebut di Master Barang &amp; Stok.</small>`;
  }

  function addProduct(id) {
    const product = productById.get(String(id));
    if (!product) return;

    const level = $('#priceLevel').value;
    const existing = cart.find(item => String(item.id) === String(product.id));

    if (existing) existing.qty++;
    else {
      cart.push({
        id: product.id,
        name: product.name,
        qty: 1,
        price: effectivePrice(product, level),
        cost: number(product.cost),
        unit: product.unit,
        category: product.category
      });
    }

    selectedCartId = String(product.id);
    renderCart();

    window.requestAnimationFrame(() => {
      const selectedRow = [...ctx.host.querySelectorAll('#cartList [data-cart-item]')]
        .find(row => String(row.dataset.cartItem) === String(product.id));
      selectedRow?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }

  renderProducts();
  renderCart();
  syncPaymentUI();
  syncDeliveryUI();
  window.requestAnimationFrame(() => $('#quickCode')?.focus());

  const openMaster = () => {
    if (typeof ctx.navigate === 'function') ctx.navigate('master');
    else ctx.notify('Buka tab Master Barang & Stok untuk mengelola menu.');
  };

  $('#productGrid').onclick = event => {
    const button = event.target.closest('[data-product]');
    if (button) addProduct(button.dataset.product);
    if (event.target.closest('#emptyAddMenuButton')) openMaster();
  };

  $('#quickCode').onkeydown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const code = event.currentTarget.value.trim().toLowerCase();
    if (!code) return;

    const product = productByQuickCode.get(code);
    if (product) {
      addProduct(product.id);
      showScanResult(product, code);
      event.currentTarget.value = '';
      event.currentTarget.focus();
      return;
    }

    showScanResult(null, code, 'error');
    $('#productSearch').value = code;
    currentPage = 1;
    renderProducts();
    ctx.notify('Kode menu atau barcode belum terdaftar', 'error');
  };

  $('#productSearch').oninput = debounce(() => {
    currentPage = 1;
    renderProducts();
  });

  $('#categoryFilter').onchange = () => {
    currentPage = 1;
    renderProducts();
  };

  $('#categoryButtons').onclick = event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    $('#categoryFilter').value = button.dataset.category;
    $('#categoryFilter').dispatchEvent(new Event('change', { bubbles: true }));
  };

  $('#priceLevel').onchange = renderProducts;

  $('#previousProductPage').onclick = () => {
    currentPage--;
    renderProducts();
    $('#productGrid').scrollIntoView?.({ block: 'start' });
  };

  $('#nextProductPage').onclick = () => {
    currentPage++;
    renderProducts();
    $('#productGrid').scrollIntoView?.({ block: 'start' });
  };

  $('#cartList').onclick = event => {
    const row = event.target.closest('[data-cart-item]');
    const plus = event.target.closest('[data-plus]');
    const minus = event.target.closest('[data-minus]');

    if (row) selectedCartId = String(row.dataset.cartItem);

    if (plus) {
      const item = cart.find(entry => String(entry.id) === String(plus.dataset.plus));
      if (item) item.qty++;
    }

    if (minus) {
      const item = cart.find(entry => String(entry.id) === String(minus.dataset.minus));
      if (item) {
        item.qty--;
        if (item.qty <= 0) cart = cart.filter(entry => entry !== item);
      }
    }

    renderCart();
  };

  ['shipping', 'styrofoamQty', 'discount', 'paid'].forEach(id => {
    $(`#${id}`).oninput = renderSummary;
  });

  $('#orderType').onchange = syncDeliveryUI;
  $('#shareLocationReceived').onchange = syncDeliveryUI;
  $('#deliveryDistanceBand').onchange = applyDeliveryRate;
  $('#deliveryDistanceButtons').onclick = event => {
    const button = event.target.closest('[data-delivery-band]');
    if (!button || button.disabled) return;
    $('#deliveryDistanceBand').value = button.dataset.deliveryBand;
    applyDeliveryRate();
  };
  $('#shipping').oninput = () => {
    renderSummary();
    if ($('#deliveryDistanceBand').value === 'over-5') syncDeliveryUI();
  };
  $('#manualShipping').oninput = () => {
    if ($('#deliveryDistanceBand').value !== 'over-5') return;
    $('#shipping').value = String(Math.max(0, number($('#manualShipping').value)));
    renderSummary();
    $('#deliveryRatePreview').textContent = `>5 km · Ongkir Manual · ${rupiah(number($('#shipping').value))}`;
  };

  $('#paymentMethod').onchange = syncPaymentUI;

  $('.pos-pro-payment-buttons').onclick = event => {
    const button = event.target.closest('[data-payment-method]');
    if (!button) return;
    $('#paymentMethod').value = button.dataset.paymentMethod;
    $('#paymentMethod').dispatchEvent(new Event('change', { bubbles: true }));
  };

  $('.pos-pro-cash-shortcuts').onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.cashAction === 'exact') $('#paid').value = totals().total;
    if (button.dataset.cashAction === 'reset') $('#paid').value = 0;
    if (button.dataset.cashAdd) $('#paid').value = number($('#paid').value) + number(button.dataset.cashAdd);
    $('#paid').dispatchEvent(new Event('input', { bubbles: true }));
  };

  $('#editSelectedPrice').onclick = () => {
    const item = cart.find(entry => String(entry.id) === selectedCartId);
    if (!item) return ctx.notify('Pilih item pada nota yang akan diubah.', 'error');
    const input = window.prompt(`Harga khusus untuk ${item.name}`, String(item.price));
    if (input === null) return;
    const price = number(input);
    if (price <= 0) return ctx.notify('Harga item harus lebih dari nol.', 'error');
    item.price = price;
    renderCart();
    ctx.notify('Harga item pada nota diperbarui.');
  };

  $('#deleteSelectedItem').onclick = () => {
    const item = cart.find(entry => String(entry.id) === selectedCartId);
    if (!item) return ctx.notify('Pilih item pada nota yang akan dihapus.', 'error');
    cart = cart.filter(entry => entry !== item);
    selectedCartId = '';
    renderCart();
  };

  $('#focusDiscount').onclick = () => {
    $('#discount').focus();
    $('#discount').select();
  };

  $('#newTransaction').onclick = () => {
    if (cart.length && !window.confirm('Mulai transaksi baru? Keranjang saat ini akan dikosongkan.')) return;
    cart = [];
    resetDraft();
    renderCart();
  };

  ['openMasterButton', 'addMenuButton', 'importMenuButton'].forEach(id => {
    $(`#${id}`).onclick = openMaster;
  });

  $('#holdButton').onclick = () => {
    if (!cart.length) return ctx.notify('Keranjang masih kosong', 'error');

    held.push({
      id: uid('hold'),
      branchId: ctx.branch.id,
      branchName: ctx.branch.name,
      items: cart.map(item => ({ ...item })),
      ...draftSnapshot(),
      at: Date.now()
    });

    saveHeld();
    cart = [];
    resetDraft();
    ctx.notify('Transaksi ditahan dan dapat diambil kembali.');
    renderCart();
    $('#heldButton').textContent =
      `📥 AMBIL (${held.filter(item => item.branchId === ctx.branch.id).length})`;
  };

  $('#heldButton').onclick = () => showHeld(ctx, renderCart, restoreDraft);

  $('#saveSale').onclick = async () => {
    if (saleSaving) {
      ctx.notify('Transaksi sedang disimpan. Mohon tunggu.', 'error');
      return;
    }

    if (!cart.length) return ctx.notify('Tambahkan menu terlebih dahulu', 'error');

    let values = totals();
    const method = $('#paymentMethod').value;
    const paid = number($('#paid').value);
    const customerName = $('#customerName').value.trim();
    const customerPhone = $('#customerPhone').value.trim();
    const orderType = $('#orderType').value;
    const deliveryDistanceBand = $('#deliveryDistanceBand').value;
    const deliveryRate = DELIVERY_RATE_BY_ID.get(deliveryDistanceBand);

    if (orderType === 'Delivery') {
      if (!$('#shareLocationReceived').checked) {
        return ctx.notify('Share Location pelanggan harus diterima sebelum menghitung ongkir.', 'error');
      }
      if (!deliveryRate) {
        return ctx.notify('Pilih jarak delivery untuk menentukan ongkir dan minimum belanja.', 'error');
      }
      if (!deliveryRate.adminConfirmation && values.shipping !== deliveryRate.fee) {
        $('#shipping').value = String(deliveryRate.fee);
        values = totals();
        renderSummary();
      }
      if (deliveryRate.minimum && values.subtotal < deliveryRate.minimum) {
        return ctx.notify(
          `Minimum belanja untuk jarak ${deliveryRate.distance} adalah ${rupiah(deliveryRate.minimum)}. Belanja saat ini ${rupiah(values.subtotal)}.`,
          'error'
        );
      }
      if (deliveryRate.adminConfirmation && values.shipping <= 0) {
        return ctx.notify('Jarak lebih dari 5 km harus dikonfirmasi admin dan ongkir diisi manual.', 'error');
      }
    }

    if (!values.total) return ctx.notify('Total transaksi tidak valid', 'error');
    if (method === CASH_METHOD && paid < values.total) {
      return ctx.notify('Nominal uang belum cukup. Transaksi tidak dapat disimpan.', 'error');
    }
    if (method === 'PERSONAL' && !customerName) {
      return ctx.notify('Nama personal wajib diisi untuk pembayaran PERSONAL.', 'error');
    }
    if (method === 'HUTANG' && (!customerName || !customerPhone)) {
      return ctx.notify('Nama dan nomor WhatsApp wajib untuk transaksi HUTANG.', 'error');
    }

    const saveButton = $('#saveSale');
    const originalButtonText = saveButton.textContent;
    const createdAt = Date.now();
    const invoice = draftInvoice || invoiceNumber(ctx.branch, createdAt);
    const soldItems = cart.map(item => ({ ...item }));

    const sale = {
      invoice,
      clientTransactionId: invoice,
      branchId: ctx.branch.id,
      branchName: ctx.branch.name,
      cashierId: ctx.user.uid || 'local',
      cashierName: ctx.user.name || 'Owner',
      items: soldItems,
      ...values,
      paymentMethod: method,
      orderType,
      shareLocationReceived: orderType === 'Delivery' && $('#shareLocationReceived').checked,
      deliveryDistanceBand: orderType === 'Delivery' ? deliveryDistanceBand : '',
      deliveryDistanceLabel: orderType === 'Delivery' ? (deliveryRate?.distance || '') : '',
      deliveryMinimumPurchase: orderType === 'Delivery' ? number(deliveryRate?.minimum) : 0,
      deliveryAdminConfirmed: orderType === 'Delivery' && Boolean(deliveryRate?.adminConfirmation),
      customerName,
      customerPhone,
      customerAddress: $('#customerAddress').value.trim(),
      orderNotes: $('#orderNotes').value.trim(),
      notes: $('#orderNotes').value.trim(),
      paid: method === CASH_METHOD ? paid : values.total,
      change: method === CASH_METHOD ? Math.max(0, paid - values.total) : 0,
      status: 'queued',
      createdAt
    };

    saleSaving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Menyimpan…';

    let result;
    let mainSaleSaved = false;
    const warnings = [];

    try {
      /*
       * Penyimpanan utama dilakukan satu kali.
       * Setelah berhasil, kegagalan proses tambahan tidak boleh membuat
       * pengguna menekan Simpan lagi dan menggandakan transaksi.
       */
      result = await pushData(`sales/${ctx.branch.id}`, sale);
      mainSaleSaved = true;

      try {
        await mirrorLegacySale(sale);
      } catch (error) {
        console.warn('Salinan transaksi lama gagal:', error);
        warnings.push('salinan database lama');
      }

      for (const item of soldItems) {
        try {
          await atomicStock(item.id, -item.qty, ctx.branch.id);

          const visibleProduct = productById.get(String(item.id));
          if (visibleProduct) {
            visibleProduct.stock = Math.max(
              0,
              number(visibleProduct.stock) - item.qty
            );
          }
        } catch (error) {
          console.error('Pembaruan stok gagal:', item.id, error);
          warnings.push(`stok ${item.name}`);
        }
      }

      if (method === 'HUTANG') {
        try {
          await pushData('debts', {
            type: 'customer',
            customerName: sale.customerName,
            customerPhone: sale.customerPhone,
            invoice,
            amount: values.total,
            remaining: values.total,
            status: 'open',
            dueDate: '',
            branchId: ctx.branch.id
          });
        } catch (error) {
          console.error('Pencatatan hutang gagal:', error);
          warnings.push('catatan hutang');
        }
      }

      try {
        await audit('CREATE', 'POS', {
          invoice,
          total: values.total,
          source: result.source
        });
      } catch (error) {
        console.warn('Audit POS gagal:', error);
        warnings.push('audit');
      }

      ctx.notify(
        result.queued
          ? 'Tersimpan lokal; akan sinkron saat online'
          : 'Transaksi tersimpan'
      );

      if (warnings.length) {
        ctx.notify(
          `Transaksi utama sudah tersimpan. Ada proses tambahan yang perlu diperiksa: ${[...new Set(warnings)].join(', ')}. Jangan simpan ulang transaksi ini.`,
          'error'
        );
      }

      try {
        printReceipt(sale);
      } catch (error) {
        ctx.notify(
          `${error.message || 'Nota gagal dicetak.'} Transaksi sudah tersimpan; jangan simpan ulang.`,
          'error'
        );
      }

      cart = [];
      resetDraft();
      renderCart();
      renderProducts();
    } catch (error) {
      console.error('Penyimpanan transaksi gagal:', error);

      ctx.notify(
        mainSaleSaved
          ? 'Transaksi sudah tersimpan, tetapi proses lanjutan bermasalah. Jangan simpan ulang.'
          : (error.message || 'Transaksi gagal disimpan.'),
        'error'
      );

      if (mainSaleSaved) {
        cart = [];
        resetDraft();
        renderCart();
        renderProducts();
      }
    } finally {
      saleSaving = false;

      if (saveButton?.isConnected) {
        saveButton.disabled = false;
        saveButton.textContent = originalButtonText;
      }
    }
  };

  $('#scanButton').onclick = () => openScanner(ctx, code => {
    const product = productByBarcode.get(String(code).trim().toLowerCase());

    if (product) {
      addProduct(product.id);
      showScanResult(product, code);
      return;
    }

    showScanResult(null, code, 'error');
    $('#productSearch').value = code;
    currentPage = 1;
    renderProducts();
    ctx.notify('Barcode belum terdaftar', 'error');
  });

  const shortcutController = new window.AbortController();
  document.addEventListener('keydown', event => {
    if (event.key !== 'F8' || !$('#scanButton')) return;
    event.preventDefault();
    $('#scanButton').click();
  }, { signal: shortcutController.signal });

  const deviceClockTimer = window.setInterval(() => {
    const clock = $('#posDeviceClock');
    if (!ctx.host.isConnected || !clock) {
      window.clearInterval(deviceClockTimer);
      shortcutController.abort();
      return;
    }
    clock.textContent = formatDeviceDate();
  }, 1000);
}

function showHeld(ctx, renderCart, restoreDraft) {
  const rows = held.filter(item => item.branchId === ctx.branch.id);

  const body = rows.length
    ? rows.map(item => `
        <div class="summary-row">
          <span>${new Date(item.at).toLocaleTimeString('id-ID')} · ${item.items.length} item</span>
          <button class="secondary-button" data-resume="${item.id}">AMBIL</button>
        </div>`).join('')
    : '<p class="muted">Tidak ada transaksi tertahan pada cabang ini.</p>';

  ctx.dialog('AMBIL TRANSAKSI TERTAHAN', body, '');

  document.querySelector('#dialogBody').onclick = event => {
    const button = event.target.closest('[data-resume]');
    if (!button) return;

    const selected = held.find(item => item.id === button.dataset.resume);
    if (!selected) return;

    cart = (selected.items || []).map(item => ({ ...item }));
    held = held.filter(item => item !== selected);
    saveHeld();
    document.querySelector('#appDialog').close();
    restoreDraft(selected);
    renderCart();

    const heldButton = document.querySelector('#heldButton');
    if (heldButton) {
      heldButton.textContent =
        `📥 AMBIL (${held.filter(item => item.branchId === ctx.branch.id).length})`;
    }

    ctx.notify('Transaksi tertahan berhasil diambil dan dapat dilanjutkan.');
  };
}

function openScanner(ctx, onCode) {
  const supported = scannerSupported();

  ctx.dialog(
    'Scanner Barcode',
    `<video id="scannerVideo" style="width:100%;border-radius:12px;background:#000" playsinline></video>
     <p class="muted">${supported
       ? 'Arahkan kamera ke barcode.'
       : 'Browser tidak mendukung BarcodeDetector. Gunakan kolom pencarian barcode manual.'}</p>
     <div class="toolbar-group">
       <button id="rearCam" class="secondary-button">Kamera Belakang</button>
       <button id="frontCam" class="secondary-button">Kamera Depan</button>
     </div>`,
    ''
  );

  if (!supported) return;

  const video = document.querySelector('#scannerVideo');
  const run = mode => startScanner(
    video,
    code => {
      onCode(code);
      document.querySelector('#appDialog').close();
    },
    { facingMode: mode }
  ).catch(error => ctx.notify(error.message, 'error'));

  document.querySelector('#rearCam').onclick = () => run('environment');
  document.querySelector('#frontCam').onclick = () => run('user');
  run('environment');

  document.querySelector('#appDialog').addEventListener('close', stopScanner, { once: true });
}
