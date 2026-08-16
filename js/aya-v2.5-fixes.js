import { getOnce, setData } from './store.js';
import { printReceipt } from './print.js';
import { number } from './utils.js';

const appDialog = document.querySelector('#appDialog');
const dialogBody = document.querySelector('#dialogBody');
const dialogFooter = document.querySelector('#dialogFooter');
const viewHost = document.querySelector('#viewHost');

let categoryNames = [];
let salesByInvoice = new Map();
let enhancementRunning = false;
let enhancementQueued = false;

function values(value) {
  if (!value || typeof value !== 'object') return [];
  return Array.isArray(value)
    ? value.filter(Boolean)
    : Object.entries(value).map(([id, row]) => (
        row && typeof row === 'object' ? { id: row.id || id, ...row } : { id, name: row }
      ));
}

function text(value) {
  return String(value ?? '').trim();
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `kategori-${Date.now()}`;
}

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'users';
}

function notify(message, type = 'success') {
  const host = document.querySelector('#alertHost');
  if (!host) {
    alert(message);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.append(toast);
  setTimeout(() => toast.remove(), 4500);
}

function closeDialog() {
  if (appDialog?.open) appDialog.close();
}

document.querySelector('#dialogClose')?.addEventListener('click', closeDialog);

document.addEventListener('click', event => {
  const cancel = event.target.closest('#dialogFooter button[value="cancel"]');
  if (!cancel) return;
  event.preventDefault();
  closeDialog();
}, true);

function resetDialog() {
  if (!appDialog?.open) return;
  if (dialogBody) dialogBody.scrollTop = 0;
  requestAnimationFrame(() => {
    if (dialogBody) dialogBody.scrollTop = 0;
    const first = dialogBody?.querySelector('input:not([type="hidden"]), select, textarea');
    first?.focus({ preventScroll: true });
  });
}

async function loadCategoryNames() {
  const [savedRaw, productsRaw] = await Promise.all([
    getOnce('productCategories'),
    getOnce('products')
  ]);

  const saved = values(savedRaw)
    .filter(row => row.active !== false)
    .map(row => text(row.name || row.category || row.label));

  const fromProducts = values(productsRaw)
    .filter(row => row.active !== false)
    .map(row => text(row.category));

  categoryNames = [...new Set([...saved, ...fromProducts].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id'));

  return categoryNames;
}

function appendOptions(select, names, current = '') {
  if (!select) return;
  const existing = new Set([...select.options].map(option => option.value));
  [...names, current].filter(Boolean).forEach(name => {
    if (existing.has(name)) return;
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
    existing.add(name);
  });
}

async function enhanceProductForm() {
  const form = document.querySelector('#productForm');
  if (!form || form.dataset.categoryEnhanced === 'true') return;

  await loadCategoryNames();

  const oldField = form.elements.category;
  if (!oldField) return;

  const current = text(oldField.value);
  const select = document.createElement('select');
  select.name = 'category';
  select.required = true;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Pilih kategori';
  select.append(placeholder);

  appendOptions(select, categoryNames, current);
  select.value = current;
  oldField.replaceWith(select);
  form.dataset.categoryEnhanced = 'true';
}

async function addCategory() {
  const name = text(prompt('Masukkan nama kategori baru:'));
  if (!name) return;

  try {
    await setData(`productCategories/${slug(name)}`, {
      id: slug(name),
      name,
      active: true,
      updatedAt: Date.now()
    });
    await loadCategoryNames();
    enhanceMasterPage();
    await enhanceProductForm();
    notify(`Kategori “${name}” ditambahkan`);
  } catch (error) {
    console.error(error);
    notify(error.message || 'Kategori gagal disimpan', 'error');
  }
}

async function enhanceMasterPage() {
  if (currentRoute() !== 'master') return;

  await loadCategoryNames();

  const categoryFilter = document.querySelector('#masterCategory');
  appendOptions(categoryFilter, categoryNames);

  const addProduct = document.querySelector('#addProduct');
  const toolbar = addProduct?.parentElement;
  if (toolbar && !document.querySelector('#addProductCategory')) {
    const button = document.createElement('button');
    button.id = 'addProductCategory';
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = '+ Kategori';
    button.addEventListener('click', addCategory);
    toolbar.insertBefore(button, addProduct);
  }
}

function flattenSales(value) {
  return Object.entries(value || {}).flatMap(([branchId, rows]) =>
    values(rows).map(row => ({ ...row, branchId: row.branchId || branchId }))
  );
}

async function loadSalesMap() {
  const raw = await getOnce('sales');
  salesByInvoice = new Map();
  flattenSales(raw).forEach(sale => {
    const invoice = text(sale.invoice || sale.id);
    if (invoice) salesByInvoice.set(invoice, sale);
  });
}

function normalizedSaleForPrint(sale) {
  const items = sale.items || [];
  const subtotal = number(sale.subtotal) || items.reduce(
    (total, item) => total + number(item.qty) * number(item.price),
    0
  );
  const shipping = number(sale.shipping);
  const styrofoamTotal = number(sale.styrofoamTotal);
  const discount = number(sale.discount);
  const total = number(sale.total) || subtotal + shipping + styrofoamTotal - discount;

  return {
    ...sale,
    invoice: sale.invoice || sale.id || `NOTA-${Date.now()}`,
    subtotal,
    shipping,
    styrofoamTotal,
    discount,
    total,
    paid: number(sale.paid) || total,
    change: number(sale.change),
    paymentMethod: sale.paymentMethod || 'TUNAI',
    orderType: sale.orderType || '-',
    createdAt: number(sale.createdAt) || Date.now()
  };
}

function articleByTitle(title) {
  return [...document.querySelectorAll('#reportOutput article.card')]
    .find(article => article.querySelector('h2')?.textContent.trim() === title);
}

function applyReportSearch() {
  const query = text(document.querySelector('#reportSearch')?.value).toLowerCase();
  const articles = [
    articleByTitle('Barang Terjual & Laba per Item'),
    articleByTitle('Transaksi Per Nota')
  ].filter(Boolean);

  articles.forEach(article => {
    article.querySelectorAll('tbody tr').forEach(row => {
      const show = !query || row.textContent.toLowerCase().includes(query);
      row.classList.toggle('row-filtered', !show);
    });
  });
}

async function addReprintButtons() {
  const article = articleByTitle('Transaksi Per Nota');
  const table = article?.querySelector('table');
  if (!table || table.dataset.reprintEnhanced === 'true') return;

  if (!salesByInvoice.size) await loadSalesMap();

  const headRow = table.querySelector('thead tr');
  const header = document.createElement('th');
  header.textContent = 'Cetak Ulang';
  headRow?.append(header);

  table.querySelectorAll('tbody tr').forEach(row => {
    const cells = row.querySelectorAll('td');
    if (!cells.length || cells.length < 2) return;

    const invoice = text(cells[1].textContent);
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button reprint-button';
    button.textContent = 'Cetak Ulang';
    button.addEventListener('click', async () => {
      let sale = salesByInvoice.get(invoice);
      if (!sale) {
        await loadSalesMap();
        sale = salesByInvoice.get(invoice);
      }
      if (!sale) {
        notify(`Data nota ${invoice} tidak ditemukan`, 'error');
        return;
      }
      try {
        await Promise.resolve(printReceipt(normalizedSaleForPrint(sale)));
      } catch (error) {
        notify(error.message || 'Nota gagal dicetak', 'error');
      }
    });
    cell.append(button);
    row.append(cell);
  });

  table.dataset.reprintEnhanced = 'true';
}

async function enhanceReports() {
  if (currentRoute() !== 'reports') return;

  const filterGrid = document.querySelector('#reportStart')?.closest('.form-grid');
  if (filterGrid && !document.querySelector('#reportSearch')) {
    const label = document.createElement('label');
    label.className = 'full report-extra-filter';
    label.innerHTML = 'Cari Barang / Nomor Nota / Pelanggan / Kasir'
      + '<input id="reportSearch" class="report-search-input" '
      + 'placeholder="Contoh: Seblak, INV-001, nama pelanggan…">';
    filterGrid.append(label);
    label.querySelector('input').addEventListener('input', applyReportSearch);
  }

  await addReprintButtons();
  applyReportSearch();
}

function parseRowDate(row) {
  return text(row.querySelector('td')?.textContent).slice(0, 10);
}

function applyOperationPeriod() {
  const start = text(document.querySelector('#operationStart')?.value);
  const end = text(document.querySelector('#operationEnd')?.value);
  const rows = [...document.querySelectorAll('#operationTable tbody tr')];
  let visible = 0;
  let total = 0;

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (!cells.length || cells.length < 7) return;
    const date = parseRowDate(row);
    const show = (!start || date >= start) && (!end || date <= end);
    row.classList.toggle('row-filtered', !show);
    if (show) {
      visible += 1;
      const raw = cells[6].textContent.replace(/[^\d-]/g, '');
      total += number(raw);
    }
  });

  const info = document.querySelector('#operationPeriodInfo');
  if (info) {
    info.textContent = `${visible} data tampil · Total periode Rp${Math.round(total).toLocaleString('id-ID')}`;
  }
}

function enhanceOperations() {
  if (currentRoute() !== 'operations') return;

  const article = [...viewHost.querySelectorAll('article.card')]
    .find(item => item.querySelector('h2')?.textContent.trim() === 'Operasional Cabang');
  const table = article?.querySelector('table');
  if (!article || !table) return;

  table.id = 'operationTable';

  if (!document.querySelector('#operationStart')) {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const panel = document.createElement('div');
    panel.className = 'form-grid operation-period-filter';
    panel.innerHTML = `
      <label>Tanggal Mulai
        <input id="operationStart" type="date" value="${start}">
      </label>
      <label>Tanggal Akhir
        <input id="operationEnd" type="date" value="${end}">
      </label>
      <p id="operationPeriodInfo" class="muted full" style="margin:0"></p>
    `;

    const tableWrap = table.closest('.table-wrap');
    article.insertBefore(panel, tableWrap);

    panel.querySelector('#operationStart').addEventListener('change', applyOperationPeriod);
    panel.querySelector('#operationEnd').addEventListener('change', applyOperationPeriod);
  }

  applyOperationPeriod();
}

async function enhanceDialog() {
  if (!appDialog?.open) return;
  resetDialog();
  await enhanceProductForm();
}

async function runEnhancements() {
  if (enhancementRunning) {
    enhancementQueued = true;
    return;
  }

  enhancementRunning = true;
  try {
    await enhanceMasterPage();
    await enhanceReports();
    enhanceOperations();
    await enhanceDialog();
  } catch (error) {
    console.error('AYA v2.5 enhancement:', error);
  } finally {
    enhancementRunning = false;
    if (enhancementQueued) {
      enhancementQueued = false;
      setTimeout(runEnhancements, 30);
    }
  }
}

const observer = new MutationObserver(() => {
  clearTimeout(observer._timer);
  observer._timer = setTimeout(runEnhancements, 40);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['open']
});

window.addEventListener('hashchange', () => {
  salesByInvoice.clear();
  setTimeout(runEnhancements, 50);
});

window.addEventListener('unhandledrejection', event => {
  const message = text(event.reason?.message || event.reason);
  if (/permission_denied|permission denied/i.test(message)) {
    notify('Firebase menolak penyimpanan. Pastikan login Owner dan Rules sudah dipublikasikan.', 'error');
  }
});

runEnhancements();
