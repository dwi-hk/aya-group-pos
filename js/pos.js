import { pushData, atomicStock, mirrorLegacySale, stockForBranch } from './store.js';
import { getCachedProducts, productBelongsToBranch } from './product-cache.js';
import { rupiah, number, escapeHTML, uid, sum } from './utils.js';
import { printReceipt } from './print.js';
import { audit } from './audit.js';
import { startScanner, stopScanner, scannerSupported } from './scanner.js';

const PAGE_SIZE = 60;
const SEARCH_DELAY = 180;

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
      .map(product => [String(product.barcode), product])
  );

  const categories = [
    'Semua',
    ...new Set(available.map(product => product.category || 'Lainnya'))
  ].sort((a, b) => (
    a === 'Semua' ? -1 : b === 'Semua' ? 1 : String(a).localeCompare(String(b), 'id')
  ));

  let currentPage = 1;

  ctx.host.innerHTML = `
    <div class="product-layout">
      <section class="card">
        <div class="toolbar">
          <div class="toolbar-group">
            <input id="productSearch" placeholder="Cari nama / barcode…" style="min-width:230px">
            <select id="categoryFilter">
              ${categories.map(category => `<option>${escapeHTML(category)}</option>`).join('')}
            </select>
            <select id="priceLevel">
              <option value="ecer">Harga Ecer</option>
              <option value="grosir">Harga Grosir</option>
              <option value="reseller">Harga Reseller</option>
            </select>
          </div>
          <div class="toolbar-group">
            <button id="scanButton" class="secondary-button">📷 Scan</button>
            <button id="heldButton" class="secondary-button">Tertahan (${held.length})</button>
          </div>
        </div>

        <div id="productGrid" class="product-grid"></div>

        <div class="toolbar" style="margin-top:12px">
          <small id="productCount" class="muted"></small>
          <div class="toolbar-group">
            <button id="previousProductPage" class="secondary-button">← Sebelumnya</button>
            <span id="productPageLabel" class="badge">1 / 1</span>
            <button id="nextProductPage" class="secondary-button">Berikutnya →</button>
          </div>
        </div>
      </section>

      <aside class="card cart">
        <div class="toolbar">
          <h2>Transaksi Kasir</h2>
          <span class="badge">${escapeHTML(ctx.branch.name)}</span>
        </div>

        <div id="cartList" class="cart-list"></div>

        <div class="form-grid" style="margin-top:12px">
          <label>Jenis Pesanan
            <select id="orderType">
              <option>Makan di tempat</option>
              <option>Dibungkus</option>
              <option>Delivery</option>
            </select>
          </label>
          <label>Metode Pembayaran
            <select id="paymentMethod">
              <option>TUNAI</option>
              <option>QRIS</option>
              <option>HUTANG</option>
              <option>PERSONAL</option>
            </select>
          </label>
          <label>Nama Pelanggan<input id="customerName" placeholder="Opsional"></label>
          <label>Ongkos Kirim<input id="shipping" inputmode="numeric" value="0"></label>
          <label>Jumlah Styrofoam<input id="styrofoamQty" type="number" min="0" value="0"></label>
          <label>Diskon<input id="discount" inputmode="numeric" value="0"></label>
          <label class="full">Uang Dibayar<input id="paid" inputmode="numeric" value="0"></label>
        </div>

        <div id="cartSummary" style="margin-top:12px"></div>
        <div class="toolbar" style="margin-top:14px">
          <button id="holdButton" class="secondary-button">Tahan</button>
          <button id="saveSale" class="primary-button">Simpan & Cetak</button>
        </div>
      </aside>
    </div>`;

  const filteredProducts = () => {
    const query = document.querySelector('#productSearch').value.trim().toLowerCase();
    const category = document.querySelector('#categoryFilter').value;

    return available.filter(product => (
      (category === 'Semua' || product.category === category)
      && (!query || product._search.includes(query))
    ));
  };

  const renderProducts = () => {
    const rows = filteredProducts();
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const level = document.querySelector('#priceLevel').value;

    document.querySelector('#productGrid').innerHTML = pageRows.length
      ? pageRows.map(product => `
          <button class="product-button" data-product="${escapeHTML(product.id)}">
            <strong>${escapeHTML(product.name)}</strong>
            <small class="muted">${escapeHTML(product.category)} · Stok ${product.stock}</small>
            <span>${rupiah(effectivePrice(product, level))}</span>
          </button>`).join('')
      : `<div class="empty-state">Tidak ada barang untuk cabang ${escapeHTML(ctx.branch.name)}.</div>`;

    const firstNumber = rows.length ? start + 1 : 0;
    const lastNumber = Math.min(start + PAGE_SIZE, rows.length);
    document.querySelector('#productCount').textContent =
      `Menampilkan ${firstNumber.toLocaleString('id-ID')}–${lastNumber.toLocaleString('id-ID')} dari ${rows.length.toLocaleString('id-ID')} barang`;

    document.querySelector('#productPageLabel').textContent = `${currentPage} / ${totalPages}`;
    document.querySelector('#previousProductPage').disabled = currentPage <= 1;
    document.querySelector('#nextProductPage').disabled = currentPage >= totalPages;
  };

  const totals = () => {
    const subtotal = sum(cart, item => item.qty * item.price);
    const shipping = number(document.querySelector('#shipping').value);
    const styrofoamQty = number(document.querySelector('#styrofoamQty').value);
    const discount = number(document.querySelector('#discount').value);

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
    const paid = number(document.querySelector('#paid').value);

    document.querySelector('#cartSummary').innerHTML = `
      <div class="summary-row"><span>Subtotal</span><b>${rupiah(values.subtotal)}</b></div>
      <div class="summary-row"><span>Ongkir</span><b>${rupiah(values.shipping)}</b></div>
      <div class="summary-row"><span>Styrofoam</span><b>${rupiah(values.styrofoamTotal)}</b></div>
      <div class="summary-row"><span>Diskon</span><b>-${rupiah(values.discount)}</b></div>
      <div class="summary-row total"><span>Total</span><b>${rupiah(values.total)}</b></div>
      <div class="summary-row"><span>Kembali</span><b>${rupiah(Math.max(0, paid - values.total))}</b></div>`;
  };

  const renderCart = () => {
    document.querySelector('#cartList').innerHTML = cart.length
      ? cart.map(item => `
          <div class="cart-row">
            <div>
              <strong>${escapeHTML(item.name)}</strong>
              <small class="muted">${rupiah(item.price)} / ${escapeHTML(item.unit)}</small>
            </div>
            <div class="qty-controls">
              <button class="secondary-button" data-minus="${escapeHTML(item.id)}">−</button>
              <b>${item.qty}</b>
              <button class="secondary-button" data-plus="${escapeHTML(item.id)}">+</button>
            </div>
          </div>`).join('')
      : '<div class="empty-state">Belum ada item.</div>';

    renderSummary();
  };

  function addProduct(id) {
    const product = productById.get(String(id));
    if (!product) return;

    const level = document.querySelector('#priceLevel').value;
    const existing = cart.find(item => item.id === product.id);

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

    renderCart();
  }

  renderProducts();
  renderCart();

  document.querySelector('#productGrid').onclick = event => {
    const button = event.target.closest('[data-product]');
    if (button) addProduct(button.dataset.product);
  };

  document.querySelector('#productSearch').oninput = debounce(() => {
    currentPage = 1;
    renderProducts();
  });

  document.querySelector('#categoryFilter').onchange = () => {
    currentPage = 1;
    renderProducts();
  };

  document.querySelector('#priceLevel').onchange = renderProducts;

  document.querySelector('#previousProductPage').onclick = () => {
    currentPage--;
    renderProducts();
    document.querySelector('#productGrid').scrollIntoView({ block: 'start' });
  };

  document.querySelector('#nextProductPage').onclick = () => {
    currentPage++;
    renderProducts();
    document.querySelector('#productGrid').scrollIntoView({ block: 'start' });
  };

  document.querySelector('#cartList').onclick = event => {
    const plus = event.target.closest('[data-plus]');
    const minus = event.target.closest('[data-minus]');

    if (plus) {
      const item = cart.find(row => row.id === plus.dataset.plus);
      if (item) item.qty++;
    }

    if (minus) {
      const item = cart.find(row => row.id === minus.dataset.minus);
      if (item) {
        item.qty--;
        if (item.qty <= 0) cart = cart.filter(row => row !== item);
      }
    }

    renderCart();
  };

  ['shipping', 'styrofoamQty', 'discount', 'paid'].forEach(id => {
    document.querySelector(`#${id}`).oninput = renderSummary;
  });

  document.querySelector('#holdButton').onclick = () => {
    if (!cart.length) return ctx.notify('Keranjang masih kosong', 'error');

    held.push({
      id: uid('hold'),
      branchId: ctx.branch.id,
      items: cart,
      at: Date.now()
    });

    saveHeld();
    cart = [];
    ctx.notify('Transaksi ditahan');
    renderCart();
    document.querySelector('#heldButton').textContent = `Tertahan (${held.length})`;
  };

  document.querySelector('#heldButton').onclick = () => showHeld(ctx, renderCart);

  document.querySelector('#saveSale').onclick = async () => {
    if (saleSaving) {
      ctx.notify('Transaksi sedang disimpan. Mohon tunggu.', 'error');
      return;
    }

    if (!cart.length) return ctx.notify('Tambahkan barang terlebih dahulu', 'error');

    const values = totals();
    const method = document.querySelector('#paymentMethod').value;
    const paid = number(document.querySelector('#paid').value);

    if (!values.total) return ctx.notify('Total transaksi tidak valid', 'error');
    if (method === 'TUNAI' && paid < values.total) {
      return ctx.notify('Nominal uang belum cukup. Transaksi tidak dapat disimpan.', 'error');
    }
    if (method === 'HUTANG' && !document.querySelector('#customerName').value.trim()) {
      return ctx.notify('Nama pelanggan wajib untuk transaksi hutang', 'error');
    }

    const saveButton = document.querySelector('#saveSale');
    const originalButtonText = saveButton.textContent;
    const createdAt = Date.now();
    const invoice = `${ctx.branch.code || 'AYA'}-${new Date(createdAt).toISOString().slice(0, 10).replaceAll('-', '')}-${String(createdAt).slice(-6)}`;
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
      orderType: document.querySelector('#orderType').value,
      customerName: document.querySelector('#customerName').value.trim(),
      paid: method === 'TUNAI' ? paid : values.total,
      change: method === 'TUNAI' ? Math.max(0, paid - values.total) : 0,
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

  document.querySelector('#scanButton').onclick = () => openScanner(ctx, code => {
    const product = productByBarcode.get(String(code));

    if (product) {
      addProduct(product.id);
      return;
    }

    document.querySelector('#productSearch').value = code;
    currentPage = 1;
    renderProducts();
    ctx.notify('Barcode belum terdaftar', 'error');
  });
}

function showHeld(ctx, renderCart) {
  const rows = held.filter(item => item.branchId === ctx.branch.id);

  const body = rows.length
    ? rows.map(item => `
        <div class="summary-row">
          <span>${new Date(item.at).toLocaleTimeString('id-ID')} · ${item.items.length} item</span>
          <button class="secondary-button" data-resume="${item.id}">Lanjutkan</button>
        </div>`).join('')
    : '<p class="muted">Tidak ada transaksi tertahan pada cabang ini.</p>';

  ctx.dialog('Transaksi Tertahan', body, '');

  document.querySelector('#dialogBody').onclick = event => {
    const button = event.target.closest('[data-resume]');
    if (!button) return;

    const selected = held.find(item => item.id === button.dataset.resume);
    if (!selected) return;

    cart = selected.items;
    held = held.filter(item => item !== selected);
    saveHeld();
    document.querySelector('#appDialog').close();
    renderCart();
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
