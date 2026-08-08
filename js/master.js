import { saveProduct, setData, getOnce, pushData, stockForBranch } from './store.js';
import {
  getCachedProducts,
  invalidateProductCache,
  productBelongsToBranch
} from './product-cache.js';
import {
  rupiah, escapeHTML, formObject, uid, number, csvCell, download, toArray
} from './utils.js';
import { audit } from './audit.js';
import { printLabel } from './print.js';

const MASTER_PAGE_SIZE = 100;
const MASTER_SEARCH_DELAY = 180;

function debounce(callback, delay = MASTER_SEARCH_DELAY) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export async function renderMaster(ctx) {
  let allProducts = await getCachedProducts();
  let products = [];
  let currentPage = 1;
  let productById = new Map();

  const applyBranch = () => {
    products = allProducts
      .filter(product => (
        product.active !== false
        && productBelongsToBranch(product, ctx.branch.id)
      ))
      .map(product => ({
        ...product,
        stock: stockForBranch(product, ctx.branch.id),
        _search: `${product.name || ''} ${product.barcode || ''} ${product.code || ''} ${product.id || ''}`
          .toLowerCase()
      }));

    productById = new Map(products.map(product => [String(product.id), product]));
  };

  const filteredRows = () => {
    const query = (document.querySelector('#masterSearch')?.value || '').trim().toLowerCase();
    const category = document.querySelector('#masterCategory')?.value || 'Semua';

    return products.filter(product => (
      (category === 'Semua' || product.category === category)
      && (!query || product._search.includes(query))
    ));
  };

  const renderRows = () => {
    const body = document.querySelector('#productRows');
    if (!body) return;

    const rows = filteredRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / MASTER_PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * MASTER_PAGE_SIZE;
    const pageRows = rows.slice(start, start + MASTER_PAGE_SIZE);

    body.innerHTML = pageRows.length
      ? pageRows.map(product => `
          <tr>
            <td>
              <strong>${escapeHTML(product.name)}</strong><br>
              <small class="muted">${escapeHTML(product.unit)} · ${escapeHTML(product.source || 'database')}</small>
            </td>
            <td>${escapeHTML(product.category)}</td>
            <td>${escapeHTML(product.barcode || '-')}</td>
            <td>
              ${rupiah(product.cost)} / ${escapeHTML(product.unit)}<br>
              <small class="muted">
                ${rupiah(product.cartonCost || 0)} / ${escapeHTML(product.largeUnit || 'satuan besar')}
                · isi ${product.packSize || 1}
              </small>
            </td>
            <td>${rupiah(product.price)}</td>
            <td>${rupiah(product.wholesalePrice)}</td>
            <td>
              <span class="status ${Number(product.stock) <= Number(product.minStock) ? 'danger' : 'success'}">
                ${product.stock} / min ${product.minStock}
              </span>
            </td>
            <td class="nowrap">
              <button class="icon-button" data-product-label="${escapeHTML(product.id)}" title="Cetak label">🏷️</button>
              <button class="icon-button" data-product-edit="${escapeHTML(product.id)}">✏️</button>
              <button class="icon-button" data-product-delete="${escapeHTML(product.id)}">🗑️</button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="8">Belum ada data barang pada cabang ini.</td></tr>';

    const firstNumber = rows.length ? start + 1 : 0;
    const lastNumber = Math.min(start + MASTER_PAGE_SIZE, rows.length);

    document.querySelector('#masterCount').textContent =
      `Menampilkan ${firstNumber.toLocaleString('id-ID')}–${lastNumber.toLocaleString('id-ID')} dari ${rows.length.toLocaleString('id-ID')} barang`;

    document.querySelector('#masterPageLabel').textContent = `${currentPage} / ${totalPages}`;
    document.querySelector('#previousMasterPage').disabled = currentPage <= 1;
    document.querySelector('#nextMasterPage').disabled = currentPage >= totalPages;
  };

  const reloadProducts = async () => {
    invalidateProductCache();
    allProducts = await getCachedProducts({ force: true });
    applyBranch();
  };

  const draw = () => {
    const categories = [
      'Semua',
      ...new Set(products.map(product => product.category || 'Lainnya'))
    ].sort((a, b) => (
      a === 'Semua' ? -1 : b === 'Semua' ? 1 : String(a).localeCompare(String(b), 'id')
    ));

    ctx.host.innerHTML = `
      <article class="card">
        <div class="toolbar">
          <div class="toolbar-group">
            <input id="masterSearch" placeholder="Cari barang, kode, barcode…">
            <select id="masterCategory">
              ${categories.map(category => `<option>${escapeHTML(category)}</option>`).join('')}
            </select>
          </div>
          <div class="toolbar-group">
            <button id="refreshProducts" class="secondary-button">↻ Muat Ulang</button>
            <button id="exportProducts" class="secondary-button">Export CSV</button>
            <label class="secondary-button" style="display:inline-flex;cursor:pointer">
              Import CSV
              <input id="importProducts" type="file" accept=".csv" hidden>
            </label>
            <button id="addProduct" class="primary-button">+ Barang</button>
          </div>
        </div>

        <p class="muted" style="margin-top:0">
          Cabang aktif: <strong>${escapeHTML(ctx.branch.name)}</strong>.
          Daftar dibatasi 100 baris per halaman agar tetap ringan.
        </p>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Barang</th>
                <th>Kategori</th>
                <th>Barcode</th>
                <th>Harga Beli</th>
                <th>Harga Ecer</th>
                <th>Grosir</th>
                <th>Stok</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody id="productRows"></tbody>
          </table>
        </div>

        <div class="toolbar" style="margin-top:12px">
          <small id="masterCount" class="muted"></small>
          <div class="toolbar-group">
            <button id="previousMasterPage" class="secondary-button">← Sebelumnya</button>
            <span id="masterPageLabel" class="badge">1 / 1</span>
            <button id="nextMasterPage" class="secondary-button">Berikutnya →</button>
          </div>
        </div>
      </article>`;

    bind();
    renderRows();
  };

  const bind = () => {
    document.querySelector('#masterSearch').oninput = debounce(() => {
      currentPage = 1;
      renderRows();
    });

    document.querySelector('#masterCategory').onchange = () => {
      currentPage = 1;
      renderRows();
    };

    document.querySelector('#previousMasterPage').onclick = () => {
      currentPage--;
      renderRows();
    };

    document.querySelector('#nextMasterPage').onclick = () => {
      currentPage++;
      renderRows();
    };

    document.querySelector('#refreshProducts').onclick = async () => {
      ctx.notify('Memuat ulang data barang…');
      await reloadProducts();
      currentPage = 1;
      draw();
      ctx.notify('Data barang terbaru sudah dimuat');
    };

    document.querySelector('#addProduct').onclick = () => productForm(
      ctx,
      null,
      async product => {
        await saveProduct({
          ...product,
          branchIds: ctx.branch.id === 'all'
            ? product.branchIds || []
            : [ctx.branch.id],
          stockByBranch: ctx.branch.id === 'all'
            ? product.stockByBranch || {}
            : {
                ...(product.stockByBranch || {}),
                [ctx.branch.id]: number(product.stock)
              }
        });

        await reloadProducts();
        draw();
      }
    );

    document.querySelector('#productRows').onclick = async event => {
      const edit = event.target.closest('[data-product-edit]');
      const remove = event.target.closest('[data-product-delete]');
      const label = event.target.closest('[data-product-label]');

      if (label) {
        const product = productById.get(String(label.dataset.productLabel));
        if (product) printLabel(product);
        return;
      }

      if (edit) {
        const product = productById.get(String(edit.dataset.productEdit));
        if (!product) return;

        productForm(ctx, product, async updated => {
          const stockByBranch = {
            ...(product.stockByBranch || {}),
            ...(ctx.branch.id === 'all'
              ? {}
              : { [ctx.branch.id]: number(updated.stock) })
          };

          await saveProduct({
            ...updated,
            stockByBranch,
            branchIds: product.branchIds?.length
              ? product.branchIds
              : ctx.branch.id === 'all'
                ? []
                : [ctx.branch.id]
          });

          await audit('UPDATE', 'MASTER_PRODUCT', { id: updated.id });
          await reloadProducts();
          draw();
        });
        return;
      }

      if (
        remove
        && confirm('Nonaktifkan barang ini? Data lama tidak akan dihapus.')
      ) {
        const product = productById.get(String(remove.dataset.productDelete));
        if (!product) return;

        await saveProduct({ ...product, active: false });
        await reloadProducts();
        draw();
      }
    };

    document.querySelector('#exportProducts').onclick = () => {
      const headers = [
        'id', 'name', 'category', 'barcode', 'cost', 'price',
        'wholesalePrice', 'resellerPrice', 'stock', 'minStock', 'unit'
      ];

      const csv = [
        headers.join(','),
        ...products.map(product => headers.map(header => csvCell(product[header])).join(','))
      ].join('\n');

      download(
        `master-barang-${ctx.branch.id}.csv`,
        csv,
        'text/csv'
      );
    };

    document.querySelector('#importProducts').onchange = event => importCSV(
      event.target.files[0],
      async rows => {
        for (const row of rows) {
          const id = row.id || uid('product');
          const product = normalizeRow({
            ...row,
            id,
            branchIds: ctx.branch.id === 'all' ? [] : [ctx.branch.id],
            stockByBranch: ctx.branch.id === 'all'
              ? {}
              : { [ctx.branch.id]: number(row.stock) }
          });

          await saveProduct(product);
        }

        await reloadProducts();
        draw();
        ctx.notify(`${rows.length} barang diimpor`);
      }
    );
  };

  applyBranch();
  draw();
}

function normalizeRow(product) {
  return {
    ...product,
    id: product.id || uid('product'),
    name: product.name || 'Barang baru',
    category: product.category || 'Lainnya',
    barcode: product.barcode || '',
    cost: number(product.cost),
    price: number(product.price),
    wholesalePrice: number(product.wholesalePrice || product.price),
    resellerPrice: number(product.resellerPrice || product.price),
    stock: number(product.stock),
    minStock: product.minStock === undefined || product.minStock === ''
      ? 5
      : number(product.minStock),
    unit: product.unit || 'pcs',
    active: product.active !== false,
    updatedAt: Date.now()
  };
}

function productForm(ctx, product, onSave) {
  product = product || {};

  ctx.dialog(
    product.id ? 'Edit Barang' : 'Tambah Barang',
    `<form id="productForm" class="form-grid">
      <label>Nama Barang<input name="name" required value="${escapeHTML(product.name || '')}"></label>
      <label>Kategori<input name="category" required value="${escapeHTML(product.category || '')}"></label>
      <label>Kode / Barcode<input name="barcode" value="${escapeHTML(product.barcode || '')}"></label>
      <label>Satuan Kecil<input name="unit" value="${escapeHTML(product.unit || 'pcs')}"></label>
      <label>Harga Beli Satuan Besar<input id="productCartonCost" name="cartonCost" inputmode="numeric" value="${product.cartonCost || 0}"></label>
      <label>Isi per Satuan Besar (Jumlah Satuan Kecil)<input id="productPackSize" name="packSize" inputmode="numeric" value="${product.packSize || 1}"></label>
      <label>Harga Beli Satuan Kecil<input id="productUnitCost" name="cost" inputmode="numeric" value="${product.cost || 0}"></label>
      <label>Harga Jual Ecer<input name="price" inputmode="numeric" required value="${product.price || 0}"></label>
      <p id="productCostHint" class="muted full" style="margin:0">
        Harga beli satuan kecil dihitung otomatis dari harga satuan besar ÷ isi.
      </p>
      <label>Harga Grosir<input name="wholesalePrice" inputmode="numeric" value="${product.wholesalePrice || product.price || 0}"></label>
      <label>Harga Reseller<input name="resellerPrice" inputmode="numeric" value="${product.resellerPrice || product.price || 0}"></label>
      <label>Stok<input name="stock" inputmode="numeric" value="${product.stock || 0}"></label>
      <label>Stok Minimum<input name="minStock" inputmode="numeric" value="${product.minStock ?? 5}"></label>
      <label class="full">
        Komposisi / Bahan (satu baris per bahan)
        <textarea name="ingredientsText">${escapeHTML(
          (product.ingredients || [])
            .map(item => typeof item === 'string'
              ? item
              : `${item.name || ''}|${item.qty || ''}|${item.cost || ''}`)
            .join('\n')
        )}</textarea>
      </label>
    </form>`,
    `<button value="cancel" class="secondary-button">Batal</button>
     <button id="saveProduct" value="default" class="primary-button">Simpan</button>`
  );

  const cartonInput = document.querySelector('#productCartonCost');
  const packInput = document.querySelector('#productPackSize');
  const unitCostInput = document.querySelector('#productUnitCost');
  const costHint = document.querySelector('#productCostHint');

  const recalculateCost = () => {
    const carton = number(cartonInput.value);
    const pack = Math.max(1, number(packInput.value));

    if (carton > 0) {
      const unitCost = Math.round(carton / pack);
      unitCostInput.value = unitCost;
      costHint.textContent =
        `Perhitungan: ${rupiah(carton)} ÷ ${pack} = ${rupiah(unitCost)} per satuan kecil.`;
    } else {
      costHint.textContent =
        'Isi harga beli satuan besar untuk menghitung harga beli satuan kecil secara otomatis.';
    }
  };

  cartonInput.oninput = recalculateCost;
  packInput.oninput = recalculateCost;
  if (number(cartonInput.value) > 0) recalculateCost();

  document.querySelector('#saveProduct').onclick = async event => {
    event.preventDefault();

    const form = document.querySelector('#productForm');
    if (!form.reportValidity()) return;

    const raw = formObject(form);
    const pack = Math.max(1, number(raw.packSize));
    const carton = number(raw.cartonCost);
    const derivedCost = carton > 0
      ? Math.round(carton / pack)
      : number(raw.cost);

    const ingredients = raw.ingredientsText
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, qty, cost] = line.split('|');
        return {
          name: name.trim(),
          qty: number(qty),
          cost: number(cost)
        };
      });

    const item = normalizeRow({
      ...product,
      ...raw,
      id: product.id || uid('product'),
      cost: derivedCost,
      cartonCost: carton,
      packSize: pack,
      ingredients
    });

    await onSave(item);
    document.querySelector('#appDialog').close();
    ctx.notify('Data barang disimpan');
  };
}

async function importCSV(file, done) {
  if (!file) return;

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseLine(lines.shift());

  const rows = lines.map(line => Object.fromEntries(
    parseLine(line).map((value, index) => [headers[index], value])
  ));

  await done(rows);
}

function parseLine(line) {
  const output = [];
  let current = '';
  let quote = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];

    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index++;
    } else if (character === '"') {
      quote = !quote;
    } else if (character === ',' && !quote) {
      output.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  output.push(current);
  return output;
}

const directoryConfig = {
  customers: { title: 'Data Pelanggan', nameLabel: 'Nama Pelanggan' },
  suppliers: { title: 'Data Supplier', nameLabel: 'Nama Supplier' },
  consignments: { title: 'Barang Titipan', nameLabel: 'Pemilik / Supplier' },
  inventory: { title: 'Inventaris Cabang', nameLabel: 'Nama Alat / Barang' }
};

export async function renderDirectory(ctx, type) {
  const config = directoryConfig[type];
  const path = type === 'inventory' ? `inventory/${ctx.branch.id}` : type;
  let rows = toArray(await getOnce(path)).filter(row => row.active !== false);

  const draw = () => {
    ctx.host.innerHTML = `
      <article class="card">
        <div class="toolbar">
          <div>
            <h2>${config.title}</h2>
            <p class="muted">Tersimpan dan dapat dilacak riwayatnya.</p>
          </div>
          <button id="addRow" class="primary-button">+ Tambah</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Kontak / Kode</th>
                <th>Alamat / Keterangan</th>
                <th>Nilai</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td><strong>${escapeHTML(row.name)}</strong></td>
                  <td>${escapeHTML(row.phone || row.code || '-')}</td>
                  <td>${escapeHTML(row.address || row.notes || '-')}</td>
                  <td>${rupiah(row.balance || row.total || row.purchasePrice || 0)}</td>
                  <td>
                    <button class="icon-button" data-edit="${row.id}">✏️</button>
                    <button class="icon-button" data-delete="${row.id}">🗑️</button>
                  </td>
                </tr>`).join('') || '<tr><td colspan="5">Belum ada data.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>`;

    document.querySelector('#addRow').onclick = () => directoryForm(
      ctx,
      config,
      null,
      async item => {
        const result = await pushData(path, item);
        rows.push({ ...item, id: result.key });
        draw();
      }
    );

    ctx.host.querySelector('tbody').onclick = async event => {
      const edit = event.target.closest('[data-edit]');
      const remove = event.target.closest('[data-delete]');

      if (edit) {
        const old = rows.find(row => row.id === edit.dataset.edit);
        directoryForm(ctx, config, old, async item => {
          await setData(`${path}/${old.id}`, item);
          rows = rows.map(row => row.id === old.id
            ? { ...item, id: old.id }
            : row);
          draw();
        });
      }

      if (
        remove
        && confirm('Nonaktifkan data ini? Data lama tidak akan dihapus.')
      ) {
        const old = rows.find(row => row.id === remove.dataset.delete);
        await setData(`${path}/${old.id}`, {
          ...old,
          active: false,
          updatedAt: Date.now()
        });
        rows = rows.filter(row => row.id !== remove.dataset.delete);
        draw();
      }
    };
  };

  draw();
}

function directoryForm(ctx, config, row, onSave) {
  row = row || {};

  ctx.dialog(
    row.id ? 'Edit Data' : 'Tambah Data',
    `<form id="directoryForm" class="form-grid">
      <label>${config.nameLabel}<input name="name" required value="${escapeHTML(row.name || '')}"></label>
      <label>Contact Person / Kode<input name="contact" value="${escapeHTML(row.contact || row.code || '')}"></label>
      <label>No. WA<input name="phone" value="${escapeHTML(row.phone || '')}"></label>
      <label>Alamat<input name="address" value="${escapeHTML(row.address || '')}"></label>
      <label>Saldo Hutang/Piutang/Nilai<input name="balance" inputmode="numeric" value="${row.balance || row.total || 0}"></label>
      <label>Tanggal<input name="date" type="date" value="${row.date || new Date().toISOString().slice(0, 10)}"></label>
      <label class="full">Keterangan<textarea name="notes">${escapeHTML(row.notes || '')}</textarea></label>
    </form>`,
    `<button value="cancel" class="secondary-button">Batal</button>
     <button id="saveDirectory" class="primary-button">Simpan</button>`
  );

  document.querySelector('#saveDirectory').onclick = async event => {
    event.preventDefault();

    const form = document.querySelector('#directoryForm');
    if (!form.reportValidity()) return;

    const raw = formObject(form);
    await onSave({
      ...row,
      ...raw,
      balance: number(raw.balance),
      updatedAt: Date.now()
    });

    document.querySelector('#appDialog').close();
    ctx.notify('Data tersimpan');
  };
}
