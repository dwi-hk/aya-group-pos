import {
  getCachedProducts,
  productBelongsToBranch
} from './product-cache.js';
import { stockForBranch } from './store.js';
import {
  rupiah,
  number,
  escapeHTML,
  csvCell,
  download
} from './utils.js';

const THIN_MARGIN_LIMIT = 10;

let cachedRows = [];
let productMap = new Map();
let loadPromise = null;
let enhancementScheduled = false;
let enhancing = false;

function profitInfo(product) {
  const hpp = number(product?.cost);
  const price = number(product?.price);
  const wholesale = number(
    product?.wholesalePrice || price
  );
  const reseller = number(
    product?.resellerPrice || price
  );

  const retailProfit = price - hpp;
  const wholesaleProfit = wholesale - hpp;
  const resellerProfit = reseller - hpp;

  const retailMargin = price > 0
    ? (retailProfit / price) * 100
    : 0;

  let status = 'Untung';
  let statusClass = 'profit-good';

  if (hpp <= 0) {
    status = 'HPP Belum Diisi';
    statusClass = 'profit-missing';
  } else if (retailProfit < 0) {
    status = 'Rugi';
    statusClass = 'profit-loss';
  } else if (retailProfit === 0) {
    status = 'Impas';
    statusClass = 'profit-even';
  } else if (retailMargin < THIN_MARGIN_LIMIT) {
    status = 'Profit Tipis';
    statusClass = 'profit-thin';
  }

  return {
    hpp,
    price,
    wholesale,
    reseller,
    retailProfit,
    wholesaleProfit,
    resellerProfit,
    retailMargin,
    status,
    statusClass
  };
}

async function ensureProducts(force = false) {
  if (!force && cachedRows.length) return cachedRows;
  if (!force && loadPromise) return loadPromise;

  loadPromise = getCachedProducts({ force })
    .then(rows => {
      cachedRows = Array.isArray(rows) ? rows : [];
      productMap = new Map(
        cachedRows.map(product => [
          String(product.id),
          product
        ])
      );
      return cachedRows;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

function currentBranchId() {
  return (
    document.querySelector('#branchSelector')?.value
    || 'all'
  );
}

function branchProducts() {
  const branchId = currentBranchId();

  return cachedRows
    .filter(product => (
      product.active !== false
      && productBelongsToBranch(product, branchId)
    ))
    .map(product => ({
      ...product,
      stock: stockForBranch(product, branchId)
    }));
}

function summaryData(products) {
  return products.reduce((summary, product) => {
    const info = profitInfo(product);

    summary.total++;

    if (info.hpp <= 0) summary.missing++;
    else if (info.retailProfit < 0) summary.loss++;
    else if (info.retailProfit === 0) summary.even++;
    else if (info.retailMargin < THIN_MARGIN_LIMIT) summary.thin++;
    else summary.profit++;

    return summary;
  }, {
    total: 0,
    profit: 0,
    thin: 0,
    even: 0,
    loss: 0,
    missing: 0
  });
}

function renderSummary() {
  const table = document.querySelector('#productRows')?.closest('table');
  if (!table) return;

  const card = table.closest('.card');
  if (!card) return;

  const branchNote = [...card.querySelectorAll('p.muted')]
    .find(element => element.textContent.includes('Cabang aktif'));

  if (!branchNote) return;

  const products = branchProducts();
  const data = summaryData(products);

  let summary = card.querySelector('#masterProfitSummary');

  if (!summary) {
    summary = document.createElement('section');
    summary.id = 'masterProfitSummary';
    summary.className = 'master-profit-summary';
    branchNote.insertAdjacentElement('afterend', summary);
  }

  summary.innerHTML = `
    <article class="master-profit-stat">
      <span>Total Barang</span>
      <strong>${data.total.toLocaleString('id-ID')}</strong>
    </article>

    <article class="master-profit-stat profit-good">
      <span>Untung</span>
      <strong>${data.profit.toLocaleString('id-ID')}</strong>
    </article>

    <article class="master-profit-stat profit-thin">
      <span>Profit Tipis</span>
      <strong>${data.thin.toLocaleString('id-ID')}</strong>
    </article>

    <article class="master-profit-stat profit-loss">
      <span>Rugi / Impas</span>
      <strong>${(data.loss + data.even).toLocaleString('id-ID')}</strong>
    </article>

    <article class="master-profit-stat profit-missing">
      <span>HPP Kosong</span>
      <strong>${data.missing.toLocaleString('id-ID')}</strong>
    </article>
  `;
}

function ensureProfitHeader(table) {
  const headerRow = table.querySelector('thead tr');
  if (!headerRow) return;

  const headers = [...headerRow.children];

  if (headers[3]) {
    headers[3].textContent = 'HPP / Harga Beli';
  }

  if (!headerRow.querySelector('[data-master-profit-header]')) {
    const profitHeader = document.createElement('th');
    profitHeader.dataset.masterProfitHeader = 'true';
    profitHeader.textContent = 'Profit & Margin';

    const stockHeader = [...headerRow.children]
      .find(cell => cell.textContent.trim() === 'Stok');

    headerRow.insertBefore(
      profitHeader,
      stockHeader || headerRow.lastElementChild
    );
  }
}

function profitCellHTML(product) {
  const info = profitInfo(product);

  if (info.hpp <= 0) {
    return `
      <div class="master-profit-cell">
        <strong class="profit-missing">HPP belum diisi</strong>
        <small>Profit belum dapat dinilai dengan benar.</small>
        <span class="master-profit-badge profit-missing">
          Lengkapi HPP
        </span>
      </div>
    `;
  }

  return `
    <div class="master-profit-cell">
      <strong class="${info.statusClass}">
        Ecer: ${rupiah(info.retailProfit)}
      </strong>

      <small>
        Margin ${info.retailMargin.toFixed(1)}%
      </small>

      <small>
        Grosir: ${rupiah(info.wholesaleProfit)}
      </small>

      <small>
        Reseller: ${rupiah(info.resellerProfit)}
      </small>

      <span class="master-profit-badge ${info.statusClass}">
        ${escapeHTML(info.status)}
      </span>
    </div>
  `;
}

function enhanceRows(table) {
  const body = table.querySelector('#productRows');
  if (!body) return;

  for (const row of body.querySelectorAll('tr')) {
    const editButton = row.querySelector('[data-product-edit]');

    if (!editButton) {
      const emptyCell = row.querySelector('td[colspan]');
      if (emptyCell) emptyCell.colSpan = 9;
      continue;
    }

    const productId = String(editButton.dataset.productEdit);
    const product = productMap.get(productId);

    if (!product) continue;

    let profitCell = row.querySelector('[data-master-profit-cell]');

    if (!profitCell) {
      profitCell = document.createElement('td');
      profitCell.dataset.masterProfitCell = 'true';

      const stockCell = [...row.children]
        .find(cell => cell.querySelector('.status'));

      row.insertBefore(
        profitCell,
        stockCell || row.lastElementChild
      );
    }

    profitCell.innerHTML = profitCellHTML(product);

    const hppCell = row.children[3];
    if (hppCell) {
      hppCell.classList.toggle(
        'master-hpp-missing',
        number(product.cost) <= 0
      );
    }
  }
}

function bindProfitExport() {
  const button = document.querySelector('#exportProducts');

  if (!button || button.dataset.profitExportBound) return;

  button.dataset.profitExportBound = 'true';

  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const products = branchProducts();

    const headers = [
      'id',
      'name',
      'category',
      'barcode',
      'hpp',
      'price',
      'profitEcer',
      'marginEcerPersen',
      'wholesalePrice',
      'profitGrosir',
      'resellerPrice',
      'profitReseller',
      'profitStatus',
      'stock',
      'minStock',
      'unit'
    ];

    const csv = [
      headers.join(','),
      ...products.map(product => {
        const info = profitInfo(product);

        const row = {
          id: product.id,
          name: product.name,
          category: product.category,
          barcode: product.barcode,
          hpp: info.hpp,
          price: info.price,
          profitEcer: info.retailProfit,
          marginEcerPersen: info.retailMargin.toFixed(2),
          wholesalePrice: info.wholesale,
          profitGrosir: info.wholesaleProfit,
          resellerPrice: info.reseller,
          profitReseller: info.resellerProfit,
          profitStatus: info.status,
          stock: product.stock,
          minStock: product.minStock,
          unit: product.unit
        };

        return headers
          .map(header => csvCell(row[header]))
          .join(',');
      })
    ].join('\n');

    download(
      `master-hpp-profit-${currentBranchId()}.csv`,
      csv,
      'text/csv'
    );
  }, true);
}

function updateFormPreview(form, preview) {
  const hpp = number(form.elements.cost?.value);
  const price = number(form.elements.price?.value);
  const wholesale = number(
    form.elements.wholesalePrice?.value || price
  );
  const reseller = number(
    form.elements.resellerPrice?.value || price
  );

  const info = profitInfo({
    cost: hpp,
    price,
    wholesalePrice: wholesale,
    resellerPrice: reseller
  });

  if (hpp <= 0) {
    preview.innerHTML = `
      <strong class="profit-missing">
        HPP belum diisi
      </strong>
      <span>
        Masukkan harga beli satuan kecil agar profit dapat dihitung.
      </span>
    `;
    return;
  }

  preview.innerHTML = `
    <div>
      <span>HPP</span>
      <strong>${rupiah(info.hpp)}</strong>
    </div>

    <div>
      <span>Profit Ecer</span>
      <strong class="${info.statusClass}">
        ${rupiah(info.retailProfit)}
      </strong>
    </div>

    <div>
      <span>Margin Ecer</span>
      <strong class="${info.statusClass}">
        ${info.retailMargin.toFixed(1)}%
      </strong>
    </div>

    <div>
      <span>Profit Grosir</span>
      <strong class="${info.wholesaleProfit < 0 ? 'profit-loss' : 'profit-good'}">
        ${rupiah(info.wholesaleProfit)}
      </strong>
    </div>

    <div>
      <span>Profit Reseller</span>
      <strong class="${info.resellerProfit < 0 ? 'profit-loss' : 'profit-good'}">
        ${rupiah(info.resellerProfit)}
      </strong>
    </div>

    <span class="master-profit-badge ${info.statusClass}">
      ${escapeHTML(info.status)}
    </span>
  `;
}

function enhanceProductForm() {
  const form = document.querySelector('#productForm');
  if (!form || form.dataset.profitPreviewBound) return;

  form.dataset.profitPreviewBound = 'true';

  const costHint = document.querySelector('#productCostHint');
  const preview = document.createElement('section');

  preview.id = 'productProfitPreview';
  preview.className = 'product-profit-preview full';

  if (costHint) {
    costHint.insertAdjacentElement('afterend', preview);
  } else {
    form.prepend(preview);
  }

  const refresh = () => {
    setTimeout(() => updateFormPreview(form, preview), 0);
  };

  for (const inputName of [
    'cartonCost',
    'packSize',
    'cost',
    'price',
    'wholesalePrice',
    'resellerPrice'
  ]) {
    form.elements[inputName]?.addEventListener('input', refresh);
    form.elements[inputName]?.addEventListener('change', refresh);
  }

  updateFormPreview(form, preview);
}

async function enhanceMaster() {
  if (enhancing) return;

  const body = document.querySelector('#productRows');

  if (!body) {
    enhanceProductForm();
    return;
  }

  enhancing = true;

  try {
    await ensureProducts();

    const table = body.closest('table');
    if (!table) return;

    ensureProfitHeader(table);
    enhanceRows(table);
    renderSummary();
    bindProfitExport();
    enhanceProductForm();
  } catch (error) {
    console.warn(
      'Kolom HPP dan profit gagal dipasang:',
      error
    );
  } finally {
    enhancing = false;
  }
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;

  enhancementScheduled = true;

  requestAnimationFrame(() => {
    enhancementScheduled = false;
    enhanceMaster();
  });
}

const observer = new MutationObserver(scheduleEnhancement);

const viewHost = document.querySelector('#viewHost');
const dialog = document.querySelector('#appDialog');

if (viewHost) {
  observer.observe(viewHost, {
    childList: true,
    subtree: true
  });
}

if (dialog) {
  observer.observe(dialog, {
    childList: true,
    subtree: true
  });
}

document.querySelector('#branchSelector')
  ?.addEventListener('change', () => {
    scheduleEnhancement();
  });

window.addEventListener('aya-data-changed', event => {
  const scopes = event.detail?.scopes || [];

  if (
    scopes.includes('products')
    || scopes.includes('stockByBranch')
    || scopes.includes('branches')
  ) {
    cachedRows = [];
    productMap.clear();

    ensureProducts(true)
      .then(scheduleEnhancement)
      .catch(error => console.warn(error));
  }
});

scheduleEnhancement();
