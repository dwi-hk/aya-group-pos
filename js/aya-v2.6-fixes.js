import {
  getOnce, setData, updateData, pushData, removeData
} from './store.js';
import {
  number, escapeHTML
} from './utils.js';
import { printReceipt } from './print.js';

const appDialog = document.querySelector('#appDialog');
const dialogBody = document.querySelector('#dialogBody');
const dialogFooter = document.querySelector('#dialogFooter');
const dialogTitle = document.querySelector('#dialogTitle');
const viewHost = document.querySelector('#viewHost');
const branchSelector = document.querySelector('#branchSelector');

let categoryRecords = [];
let unitRecords = [];
let productRecords = [];
let categoryNames = [];
let unitNames = [];
let salesByInvoice = new Map();
let bodyTimer = 0;
let dialogTimer = 0;
let dialogWasOpen = false;
let inventoryRenderToken = '';

function values(value) {
  if (!value || typeof value !== 'object') return [];
  return Array.isArray(value)
    ? value.filter(Boolean)
    : Object.entries(value).map(([id, row]) => (
      row && typeof row === 'object'
        ? { id: row.id || id, ...row }
        : { id, name: row }
    ));
}

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLocaleLowerCase('id-ID');
}

function slug(value, fallback = 'data') {
  return text(value)
    .toLocaleLowerCase('id-ID')
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '') || `${fallback}-${Date.now()}`;
}

function currentRoute() {
  return location.hash.replace(/^#/, '') || 'users';
}

function currentBranch() {
  const id = branchSelector?.value || '';
  const option = branchSelector?.selectedOptions?.[0];
  return { id, name: option?.textContent?.trim() || id };
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
  setTimeout(() => toast.remove(), 4600);
}

function rupiah(value) {
  return `Rp${Math.round(number(value)).toLocaleString('id-ID')}`;
}

function closeDialog() {
  if (appDialog?.open) appDialog.close();
}

function openDialog(title, body, footer = '') {
  if (appDialog.open) appDialog.close();
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  dialogFooter.innerHTML = footer;
  dialogBody.scrollTop = 0;
  appDialog.showModal();
}

document.querySelector('#dialogClose')?.addEventListener('click', closeDialog);

document.addEventListener('click', event => {
  const cancel = event.target.closest('#dialogFooter button[value="cancel"], #dialogFooter [data-dialog-close]');
  if (!cancel) return;
  event.preventDefault();
  closeDialog();
}, true);

async function loadTaxonomies() {
  const [categoriesRaw, unitsRaw, productsRaw] = await Promise.all([
    getOnce('productCategories'),
    getOnce('productUnits'),
    getOnce('products')
  ]);

  categoryRecords = values(categoriesRaw);
  unitRecords = values(unitsRaw);
  productRecords = values(productsRaw).filter(row => row.active !== false);

  const inactiveCategories = new Set(
    categoryRecords.filter(row => row.active === false).map(row => normalized(row.name))
  );
  const inactiveUnits = new Set(
    unitRecords.filter(row => row.active === false).map(row => normalized(row.name))
  );

  const savedCategories = categoryRecords
    .filter(row => row.active !== false)
    .map(row => text(row.name));

  const productCategories = productRecords
    .map(row => text(row.category))
    .filter(name => name && !inactiveCategories.has(normalized(name)));

  const savedUnits = unitRecords
    .filter(row => row.active !== false)
    .map(row => text(row.name));

  const productUnits = productRecords.flatMap(row => [
    text(row.unit),
    text(row.largeUnit)
  ]).filter(name => name && !inactiveUnits.has(normalized(name)));

  categoryNames = [...new Set([...savedCategories, ...productCategories].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id'));

  unitNames = [...new Set([...savedUnits, ...productUnits, 'pcs', 'pak', 'dus', 'karton', 'botol', 'gelas', 'porsi'].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id'));

  refreshUnitDatalist();
}

function refreshUnitDatalist() {
  let list = document.querySelector('#ayaUnitList');
  if (!list) {
    list = document.createElement('datalist');
    list.id = 'ayaUnitList';
    document.body.append(list);
  }
  list.innerHTML = unitNames.map(name => `<option value="${escapeHTML(name)}"></option>`).join('');
}

async function ensureCategory(name) {
  const clean = text(name);
  if (!clean) return '';
  await loadTaxonomies();
  const existing = categoryRecords.find(row => normalized(row.name) === normalized(clean));
  const id = existing?.id || slug(clean, 'kategori');
  await setData(`productCategories/${id}`, {
    ...(existing || {}),
    id,
    name: clean,
    active: true,
    updatedAt: Date.now()
  });
  await loadTaxonomies();
  return clean;
}

async function ensureUnit(name) {
  const clean = text(name);
  if (!clean) return '';
  await loadTaxonomies();
  const existing = unitRecords.find(row => normalized(row.name) === normalized(clean));
  const id = existing?.id || slug(clean, 'satuan');
  await setData(`productUnits/${id}`, {
    ...(existing || {}),
    id,
    name: clean,
    active: true,
    updatedAt: Date.now()
  });
  await loadTaxonomies();
  return clean;
}

async function editCategory(record) {
  const oldName = text(record.name);
  const nextName = text(prompt('Ubah nama kategori:', oldName));
  if (!nextName || nextName === oldName) return;

  await loadTaxonomies();
  const duplicate = categoryRecords.find(row =>
    row.active !== false &&
    row.id !== record.id &&
    normalized(row.name) === normalized(nextName)
  );
  if (duplicate) {
    notify('Nama kategori tersebut sudah ada.', 'error');
    return;
  }

  const usedProducts = productRecords.filter(row => normalized(row.category) === normalized(oldName));
  for (const product of usedProducts) {
    await updateData(`products/${product.id}`, {
      category: nextName,
      updatedAt: Date.now()
    });
  }

  await setData(`productCategories/${record.id}`, {
    ...record,
    id: record.id,
    name: nextName,
    active: true,
    updatedAt: Date.now()
  });

  notify(`Kategori diubah menjadi “${nextName}”`);
  await openCategoryManager();
  await enhanceMasterPage();
}

async function deleteCategory(record) {
  await loadTaxonomies();
  const used = productRecords.filter(row => normalized(row.category) === normalized(record.name));
  if (used.length) {
    notify(`Kategori masih dipakai oleh ${used.length} barang. Ubah kategori barang tersebut terlebih dahulu.`, 'error');
    return;
  }
  if (!confirm(`Hapus kategori “${record.name}”?`)) return;

  await setData(`productCategories/${record.id}`, {
    ...record,
    active: false,
    updatedAt: Date.now()
  });

  notify('Kategori dihapus');
  await openCategoryManager();
  await enhanceMasterPage();
}

async function editUnit(record) {
  const oldName = text(record.name);
  const nextName = text(prompt('Ubah nama satuan:', oldName));
  if (!nextName || nextName === oldName) return;

  await loadTaxonomies();
  const duplicate = unitRecords.find(row =>
    row.active !== false &&
    row.id !== record.id &&
    normalized(row.name) === normalized(nextName)
  );
  if (duplicate) {
    notify('Nama satuan tersebut sudah ada.', 'error');
    return;
  }

  const usedProducts = productRecords.filter(row =>
    normalized(row.unit) === normalized(oldName) ||
    normalized(row.largeUnit) === normalized(oldName)
  );

  for (const product of usedProducts) {
    const patch = { updatedAt: Date.now() };
    if (normalized(product.unit) === normalized(oldName)) patch.unit = nextName;
    if (normalized(product.largeUnit) === normalized(oldName)) patch.largeUnit = nextName;
    await updateData(`products/${product.id}`, patch);
  }

  await setData(`productUnits/${record.id}`, {
    ...record,
    id: record.id,
    name: nextName,
    active: true,
    updatedAt: Date.now()
  });

  notify(`Satuan diubah menjadi “${nextName}”`);
  await openUnitManager();
}

async function deleteUnit(record) {
  await loadTaxonomies();
  const used = productRecords.filter(row =>
    normalized(row.unit) === normalized(record.name) ||
    normalized(row.largeUnit) === normalized(record.name)
  );
  if (used.length) {
    notify(`Satuan masih dipakai oleh ${used.length} barang. Ubah satuan barang tersebut terlebih dahulu.`, 'error');
    return;
  }
  if (!confirm(`Hapus satuan “${record.name}”? Data transaksi lama tidak ikut dihapus.`)) return;

  await setData(`productUnits/${record.id}`, {
    ...record,
    active: false,
    updatedAt: Date.now()
  });

  notify('Satuan dihapus');
  await openUnitManager();
}

async function openCategoryManager() {
  await loadTaxonomies();
  const active = categoryNames
    .map(name => categoryRecords.find(row =>
      row.active !== false && normalized(row.name) === normalized(name)
    ) || { id: slug(name, 'kategori'), name, active: true, synthetic: true })
    .sort((a, b) => text(a.name).localeCompare(text(b.name), 'id'));

  openDialog(
    'Kelola Kategori',
    `<div class="taxonomy-manager">
      <div class="taxonomy-add-row">
        <label>Nama Kategori Baru
          <input id="newCategoryName" autocomplete="off" placeholder="Contoh: Minuman Dingin">
        </label>
        <button id="saveNewCategory" type="button" class="primary-button">Tambah Kategori</button>
      </div>
      <p class="muted v26-help">Kategori dapat ditambah, diubah, dan dihapus. Kategori yang masih dipakai barang tidak dapat dihapus.</p>
      <div class="taxonomy-list">
        ${active.map(row => `
          <div class="taxonomy-row">
            <strong>${escapeHTML(row.name)}</strong>
            <div class="taxonomy-row-actions">
              <button type="button" class="secondary-button" data-category-edit="${escapeHTML(row.id)}">Edit</button>
              <button type="button" class="danger-button" data-category-delete="${escapeHTML(row.id)}">Hapus</button>
            </div>
          </div>`).join('') || '<p class="muted">Belum ada kategori.</p>'}
      </div>
    </div>`,
    '<button type="button" class="secondary-button" data-dialog-close>Tutup</button>'
  );

  document.querySelector('#saveNewCategory').onclick = async () => {
    const input = document.querySelector('#newCategoryName');
    const name = text(input.value);
    if (!name) return notify('Nama kategori wajib diisi.', 'error');
    await ensureCategory(name);
    notify(`Kategori “${name}” ditambahkan`);
    await openCategoryManager();
    await enhanceMasterPage();
  };

  dialogBody.onclick = async event => {
    const edit = event.target.closest('[data-category-edit]');
    const del = event.target.closest('[data-category-delete]');
    if (edit) {
      const row = categoryRecords.find(item => String(item.id) === edit.dataset.categoryEdit);
      if (row) await editCategory(row);
    }
    if (del) {
      const row = categoryRecords.find(item => String(item.id) === del.dataset.categoryDelete);
      if (row) await deleteCategory(row);
    }
  };
}

async function openUnitManager() {
  await loadTaxonomies();
  const active = unitNames
    .map(name => unitRecords.find(row =>
      row.active !== false && normalized(row.name) === normalized(name)
    ) || { id: slug(name, 'satuan'), name, active: true, synthetic: true })
    .sort((a, b) => text(a.name).localeCompare(text(b.name), 'id'));

  openDialog(
    'Kelola Satuan',
    `<div class="taxonomy-manager">
      <div class="taxonomy-add-row">
        <label>Nama Satuan Baru
          <input id="newUnitName" autocomplete="off" placeholder="Contoh: pcs, dus, botol, porsi">
        </label>
        <button id="saveNewUnit" type="button" class="primary-button">Tambah Satuan</button>
      </div>
      <p class="muted v26-help">Satuan baru juga dapat diketik langsung pada kolom satuan. Nilainya akan disimpan sebagai pilihan berikutnya.</p>
      <div class="taxonomy-list">
        ${active.map(row => `
          <div class="taxonomy-row">
            <strong>${escapeHTML(row.name)}</strong>
            <div class="taxonomy-row-actions">
              <button type="button" class="secondary-button" data-unit-edit="${escapeHTML(row.id)}">Edit</button>
              <button type="button" class="danger-button" data-unit-delete="${escapeHTML(row.id)}">Hapus</button>
            </div>
          </div>`).join('') || '<p class="muted">Belum ada satuan tersimpan.</p>'}
      </div>
    </div>`,
    '<button type="button" class="secondary-button" data-dialog-close>Tutup</button>'
  );

  document.querySelector('#saveNewUnit').onclick = async () => {
    const input = document.querySelector('#newUnitName');
    const name = text(input.value);
    if (!name) return notify('Nama satuan wajib diisi.', 'error');
    await ensureUnit(name);
    notify(`Satuan “${name}” ditambahkan`);
    await openUnitManager();
  };

  dialogBody.onclick = async event => {
    const edit = event.target.closest('[data-unit-edit]');
    const del = event.target.closest('[data-unit-delete]');
    if (edit) {
      const row = unitRecords.find(item => String(item.id) === edit.dataset.unitEdit);
      if (row) await editUnit(row);
    }
    if (del) {
      const row = unitRecords.find(item => String(item.id) === del.dataset.unitDelete);
      if (row) await deleteUnit(row);
    }
  };
}

function buildCategoryOptions(select, currentValue = '') {
  if (!select) return;
  const current = text(currentValue || select.value);
  const names = [...new Set([...categoryNames, current].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id'));

  select.innerHTML = `
    <option value="">Pilih kategori</option>
    ${names.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('')}
    <option value="__new_category__">➕ Tambah kategori baru…</option>
  `;
  select.value = current;
}

async function enhanceProductForm() {
  const form = document.querySelector('#productForm');
  if (!form) return;

  await loadTaxonomies();

  let categoryField = form.elements.category;
  if (categoryField && categoryField.tagName !== 'SELECT') {
    const current = text(categoryField.value);
    const select = document.createElement('select');
    select.name = 'category';
    select.required = true;
    categoryField.replaceWith(select);
    categoryField = select;
    buildCategoryOptions(categoryField, current);
  } else if (categoryField && categoryField.dataset.v26Category !== 'true') {
    buildCategoryOptions(categoryField, categoryField.value);
  }

  if (categoryField && categoryField.dataset.v26Category !== 'true') {
    categoryField.dataset.v26Category = 'true';
    categoryField.addEventListener('change', async () => {
      if (categoryField.value === '__new_category__') {
        const name = text(prompt('Masukkan nama kategori baru:'));
        if (!name) {
          categoryField.value = '';
          return;
        }
        await ensureCategory(name);
        buildCategoryOptions(categoryField, name);
        notify(`Kategori “${name}” ditambahkan`);
      }
    });
  }

  enhanceUnitInputs(form);

  const saveButton = document.querySelector('#saveProduct');
  if (saveButton && saveButton.dataset.v26Units !== 'true') {
    saveButton.dataset.v26Units = 'true';
    saveButton.addEventListener('click', () => {
      const unit = text(form.elements.unit?.value);
      const largeUnit = text(form.elements.largeUnit?.value);
      if (unit) ensureUnit(unit).catch(console.error);
      if (largeUnit) ensureUnit(largeUnit).catch(console.error);
    }, true);
  }
}

function enhanceUnitInputs(root = document) {
  root.querySelectorAll(
    'input[name="unit"], input[name="largeUnit"], #buyLargeUnit, input[data-unit-input]'
  ).forEach(input => {
    input.setAttribute('list', 'ayaUnitList');
    input.setAttribute('autocomplete', 'off');
    if (input.dataset.v26UnitInput === 'true') return;
    input.dataset.v26UnitInput = 'true';
    input.addEventListener('blur', () => {
      const value = text(input.value);
      if (value) ensureUnit(value).catch(console.error);
    });
  });
}

async function enhanceMasterPage() {
  if (currentRoute() !== 'master') return;
  await loadTaxonomies();

  const categoryFilter = document.querySelector('#masterCategory');
  if (categoryFilter) {
    const current = categoryFilter.value;
    categoryFilter.innerHTML = `
      <option value="Semua">Semua</option>
      ${categoryNames.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('')}
    `;
    categoryFilter.value = [...categoryFilter.options].some(option => option.value === current) ? current : 'Semua';
  }

  const addProduct = document.querySelector('#addProduct');
  const toolbar = addProduct?.parentElement;
  if (toolbar) {
    toolbar.classList.add('v26-toolbar-buttons');

    if (!document.querySelector('#manageProductCategories')) {
      const button = document.createElement('button');
      button.id = 'manageProductCategories';
      button.type = 'button';
      button.className = 'secondary-button';
      button.textContent = 'Kelola Kategori';
      button.onclick = openCategoryManager;
      toolbar.insertBefore(button, addProduct);
    }

    if (!document.querySelector('#manageProductUnits')) {
      const button = document.createElement('button');
      button.id = 'manageProductUnits';
      button.type = 'button';
      button.className = 'secondary-button';
      button.textContent = 'Kelola Satuan';
      button.onclick = openUnitManager;
      toolbar.insertBefore(button, addProduct);
    }
  }
}

async function renderInventoryV26(force = false) {
  if (currentRoute() !== 'inventory') {
    inventoryRenderToken = '';
    return;
  }

  const branch = currentBranch();
  const token = `${branch.id}|${branch.name}`;
  if (!force && inventoryRenderToken === token && document.querySelector('#inventoryV26')) return;
  inventoryRenderToken = token;

  if (!branch.id || branch.id === 'all') {
    viewHost.innerHTML = `
      <article id="inventoryV26" class="card">
        <h2>Pilih satu cabang</h2>
        <p class="muted">Inventaris harus dicatat pada cabang tertentu. Pilih cabang dari bagian atas aplikasi.</p>
      </article>`;
    return;
  }

  await loadTaxonomies();
  const raw = await getOnce(`inventory/${branch.id}`);
  const rows = values(raw)
    .filter(row => row.active !== false)
    .map(row => {
      const unitPrice = number(row.unitPrice ?? row.purchasePrice ?? row.price ?? row.balance);
      const qty = number(row.qty ?? row.quantity ?? 1);
      return {
        ...row,
        unit: text(row.unit || 'pcs'),
        unitPrice,
        qty,
        total: number(row.total) || unitPrice * qty
      };
    })
    .sort((a, b) => text(a.name).localeCompare(text(b.name), 'id'));
  const totalInventoryValue = rows.reduce(
    (total, row) => total + number(row.total),
    0
  );

  viewHost.innerHTML = `
    <article id="inventoryV26" class="card">
      <div class="toolbar">
        <div>
          <h2>Inventaris ${escapeHTML(branch.name)}</h2>
          <p class="muted">Harga satuan × qty dihitung otomatis menjadi total nilai inventaris.</p>
        </div>
        <div class="v26-toolbar-buttons">
          <button id="manageInventoryUnits" type="button" class="secondary-button">Kelola Satuan</button>
          <button id="addInventoryV26" type="button" class="primary-button">+ Inventaris</button>
        </div>
      </div>
      <section class="inventory-grand-total" aria-live="polite">
        <div>
          <span>TOTAL NILAI INVENTARIS</span>
          <small>Jumlah seluruh Harga Satuan × Qty inventaris aktif</small>
        </div>
        <strong id="inventoryGrandTotal">${rupiah(totalInventoryValue)}</strong>
      </section>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama Inventaris</th>
              <th>Kode</th>
              <th>Harga Satuan</th>
              <th>Qty</th>
              <th>Satuan</th>
              <th>Total</th>
              <th>Keterangan</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td><strong>${escapeHTML(row.name || '-')}</strong></td>
                <td>${escapeHTML(row.code || '-')}</td>
                <td>${rupiah(row.unitPrice)}</td>
                <td>${row.qty}</td>
                <td>${escapeHTML(row.unit)}</td>
                <td><strong>${rupiah(row.total)}</strong></td>
                <td>${escapeHTML(row.notes || row.address || '-')}</td>
                <td>
                  <div class="v26-table-actions">
                    <button type="button" class="icon-button" data-inventory-edit="${escapeHTML(row.id)}" title="Edit">✏️</button>
                    <button type="button" class="icon-button" data-inventory-delete="${escapeHTML(row.id)}" title="Hapus">🗑️</button>
                  </div>
                </td>
              </tr>`).join('') || '<tr><td colspan="8">Belum ada inventaris.</td></tr>'}
          </tbody>
          <tfoot>
            <tr class="inventory-grand-total-row">
              <th colspan="5">TOTAL KESELURUHAN</th>
              <th>${rupiah(totalInventoryValue)}</th>
              <th colspan="2">${rows.length} inventaris aktif</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </article>`;

  document.querySelector('#manageInventoryUnits').onclick = openUnitManager;
  document.querySelector('#addInventoryV26').onclick = () => openInventoryForm(branch, null);

  document.querySelector('#inventoryV26 tbody').onclick = async event => {
    const edit = event.target.closest('[data-inventory-edit]');
    const del = event.target.closest('[data-inventory-delete]');

    if (edit) {
      const row = rows.find(item => String(item.id) === edit.dataset.inventoryEdit);
      if (row) openInventoryForm(branch, row);
    }

    if (del) {
      const row = rows.find(item => String(item.id) === del.dataset.inventoryDelete);
      if (!row || !confirm(`Hapus inventaris “${row.name}”?`)) return;
      await removeData(`inventory/${branch.id}/${row.id}`);
      notify('Inventaris dihapus');
      await renderInventoryV26(true);
    }
  };
}

async function openInventoryForm(branch, row = null) {
  await loadTaxonomies();
  const data = row || {};
  const unitPrice = number(data.unitPrice ?? data.purchasePrice ?? data.price);
  const qty = number(data.qty ?? data.quantity ?? 1) || 1;

  openDialog(
    row ? 'Edit Inventaris' : 'Tambah Inventaris',
    `<form id="inventoryFormV26" class="form-grid">
      <label>Nama Inventaris
        <input name="name" required value="${escapeHTML(data.name || '')}">
      </label>
      <label>Kode Inventaris
        <input name="code" value="${escapeHTML(data.code || '')}">
      </label>
      <label>Harga Satuan
        <input name="unitPrice" inputmode="numeric" required value="${unitPrice}">
      </label>
      <label>Qty
        <input name="qty" type="number" min="0.01" step="0.01" required value="${qty}">
      </label>
      <label>Satuan
        <input name="unit" data-unit-input list="ayaUnitList" required value="${escapeHTML(data.unit || 'pcs')}" placeholder="Ketik atau pilih satuan">
        <span class="unit-datalist-note">Satuan baru dapat diketik langsung dan akan disimpan.</span>
      </label>
      <label>Tanggal Pembelian
        <input name="purchaseDate" type="date" value="${escapeHTML(data.purchaseDate || new Date().toISOString().slice(0, 10))}">
      </label>
      <label class="full">Keterangan
        <textarea name="notes">${escapeHTML(data.notes || data.address || '')}</textarea>
      </label>
      <div class="inventory-total-preview full">
        Total Nilai: <strong id="inventoryTotalPreview">${rupiah(unitPrice * qty)}</strong>
      </div>
    </form>`,
    '<button type="button" value="cancel" class="secondary-button">Batal</button><button id="saveInventoryV26" type="button" class="primary-button">Simpan</button>'
  );

  const form = document.querySelector('#inventoryFormV26');
  const priceInput = form.elements.unitPrice;
  const qtyInput = form.elements.qty;
  const preview = document.querySelector('#inventoryTotalPreview');

  const calculate = () => {
    preview.textContent = rupiah(number(priceInput.value) * number(qtyInput.value));
  };
  priceInput.addEventListener('input', calculate);
  qtyInput.addEventListener('input', calculate);
  enhanceUnitInputs(form);

  document.querySelector('#saveInventoryV26').onclick = async () => {
    if (!form.reportValidity()) return;
    const raw = Object.fromEntries(new FormData(form).entries());
    const item = {
      ...data,
      name: text(raw.name),
      code: text(raw.code),
      unitPrice: number(raw.unitPrice),
      qty: number(raw.qty),
      unit: text(raw.unit) || 'pcs',
      total: number(raw.unitPrice) * number(raw.qty),
      purchaseDate: text(raw.purchaseDate),
      notes: text(raw.notes),
      branchId: branch.id,
      branchName: branch.name,
      active: true,
      updatedAt: Date.now()
    };

    if (row?.id) {
      await setData(`inventory/${branch.id}/${row.id}`, item);
    } else {
      await pushData(`inventory/${branch.id}`, item);
    }

    await ensureUnit(item.unit);
    closeDialog();
    notify('Inventaris disimpan');
    await renderInventoryV26(true);
  };
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
  [
    articleByTitle('Barang Terjual & Laba per Item'),
    articleByTitle('Transaksi Per Nota')
  ].filter(Boolean).forEach(article => {
    article.querySelectorAll('tbody tr').forEach(row => {
      row.classList.toggle('row-filtered', !!query && !row.textContent.toLowerCase().includes(query));
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
    if (cells.length < 2) return;

    const invoice = text(cells[1].textContent);
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = 'Cetak Ulang';
    button.onclick = async () => {
      let sale = salesByInvoice.get(invoice);
      if (!sale) {
        await loadSalesMap();
        sale = salesByInvoice.get(invoice);
      }
      if (!sale) return notify(`Data nota ${invoice} tidak ditemukan`, 'error');
      try {
        printReceipt(normalizedSaleForPrint(sale));
      } catch (error) {
        notify(error.message || 'Nota gagal dicetak', 'error');
      }
    };
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
    label.innerHTML = `Cari Barang / Nomor Nota / Pelanggan / Kasir
      <input id="reportSearch" placeholder="Contoh: Seblak, INV-001, nama pelanggan…">`;
    filterGrid.append(label);
    label.querySelector('input').addEventListener('input', applyReportSearch);
  }

  await addReprintButtons();
  applyReportSearch();
}

function applyOperationPeriod() {
  const start = text(document.querySelector('#operationStart')?.value);
  const end = text(document.querySelector('#operationEnd')?.value);
  const rows = [...document.querySelectorAll('#operationTable tbody tr')];
  let visible = 0;
  let total = 0;

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 7) return;
    const date = text(cells[0].textContent).slice(0, 10);
    const show = (!start || date >= start) && (!end || date <= end);
    row.classList.toggle('row-filtered', !show);
    if (show) {
      visible += 1;
      total += number(cells[6].textContent.replace(/[^\d-]/g, ''));
    }
  });

  const info = document.querySelector('#operationPeriodInfo');
  if (info) info.textContent = `${visible} data tampil · Total periode ${rupiah(total)}`;
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
    panel.querySelector('#operationStart').onchange = applyOperationPeriod;
    panel.querySelector('#operationEnd').onchange = applyOperationPeriod;
  }

  applyOperationPeriod();
  enhanceUnitInputs(article);
}

async function enhanceOpenDialog() {
  if (!appDialog?.open) return;
  await enhanceProductForm();
  enhanceUnitInputs(dialogBody);

  const operationForm = document.querySelector('#operationForm');
  const saveOperation = document.querySelector('#saveOperation');
  if (operationForm && saveOperation && saveOperation.dataset.v26Units !== 'true') {
    saveOperation.dataset.v26Units = 'true';
    saveOperation.addEventListener('click', () => {
      const unit = text(operationForm.elements.unit?.value);
      if (unit) ensureUnit(unit).catch(console.error);
    }, true);
  }
}

async function runViewEnhancements() {
  try {
    await renderInventoryV26();
    await enhanceMasterPage();
    await enhanceReports();
    enhanceOperations();
    enhanceUnitInputs(viewHost);
  } catch (error) {
    console.error('AYA v2.6 view enhancement:', error);
  }
}

const viewObserver = new MutationObserver(() => {
  clearTimeout(bodyTimer);
  bodyTimer = setTimeout(runViewEnhancements, 60);
});
viewObserver.observe(viewHost, { childList: true, subtree: true });

const dialogObserver = new MutationObserver(() => {
  clearTimeout(dialogTimer);
  dialogTimer = setTimeout(async () => {
    const isOpen = appDialog.open;

    // Reset scroll hanya ketika dialog baru dibuka. Tidak memindahkan fokus,
    // sehingga input Harga Beli Satuan Besar tidak lagi membuat cursor lompat.
    if (isOpen && !dialogWasOpen) {
      dialogBody.scrollTop = 0;
    }
    dialogWasOpen = isOpen;

    if (isOpen) {
      try {
        await enhanceOpenDialog();
      } catch (error) {
        console.error('AYA v2.6 dialog enhancement:', error);
      }
    }
  }, 30);
});
dialogObserver.observe(appDialog, {
  attributes: true,
  attributeFilter: ['open'],
  childList: true,
  subtree: true
});

window.addEventListener('hashchange', () => {
  inventoryRenderToken = '';
  salesByInvoice.clear();
  setTimeout(runViewEnhancements, 80);
});

branchSelector?.addEventListener('change', () => {
  inventoryRenderToken = '';
  setTimeout(runViewEnhancements, 80);
});

window.addEventListener('unhandledrejection', event => {
  const message = text(event.reason?.message || event.reason);
  if (/permission_denied|permission denied/i.test(message)) {
    notify('Firebase menolak penyimpanan. Pastikan login sebagai Owner dan Rules sudah dipublikasikan.', 'error');
  }
});

await loadTaxonomies();
runViewEnhancements();
