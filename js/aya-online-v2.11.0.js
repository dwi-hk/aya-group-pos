/*
 * AYA POS ONLINE v2.11.0
 * ------------------------------------------------------------
 * Tambahan aman di atas aplikasi online yang sudah berjalan:
 * 1. Kolom Scan/Ketik Barcode pada Pembelian / Kulakan.
 * 2. Tab Laba/Rugi Bersih pada Laporan.
 * 3. Tab Pemakaian PERSONAL per periode.
 *
 * Tidak mengganti reports.js / transaction.js.
 * Tidak mengubah struktur transaksi yang sudah tersimpan.
 */

import { getOnce } from './store.js';
import { getCachedProducts } from './product-cache.js';
import {
  rupiah,
  number,
  escapeHTML,
  toArray,
  sum,
  csvCell,
  download
} from './utils.js';

const VERSION = '2.11.0';
const REPORT_MODES = new Set(['net-profit', 'personal']);
const dataCache = new Map();

let observerScheduled = false;
let extraReportMode = null;
let reportRenderToken = 0;

const $ = (selector, root = document) => root.querySelector(selector);

function notify(message, type = 'success') {
  const host = $('#alertHost');
  if (!host) {
    console.log(`[AYA ${VERSION}] ${message}`);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.append(toast);

  setTimeout(() => toast.remove(), 4200);
}

function text(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return text(value).toLocaleLowerCase('id-ID');
}

function localDate(value, fallback = '') {
  if (!value) return text(fallback).slice(0, 10);

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return text(fallback).slice(0, 10);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function dateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('id-ID')
    : '-';
}

function saleDate(sale) {
  return localDate(sale?.createdAt || sale?.timestamp, sale?.date);
}

function rowDate(row) {
  return localDate(row?.createdAt, row?.date);
}

function saleItems(sale) {
  if (Array.isArray(sale?.items)) return sale.items;

  if (sale?.items && typeof sale.items === 'object') {
    return Object.values(sale.items);
  }

  return [];
}

function itemQty(item) {
  return number(item?.qty || 0);
}

function itemGross(item) {
  return itemQty(item) * number(item?.price ?? item?.harga);
}

function itemCost(item) {
  return itemQty(item) * number(item?.cost ?? item?.hargaBeli);
}

function saleSubtotal(sale) {
  const stored = number(sale?.subtotal);
  if (sale?.subtotal !== undefined) return stored;
  return sum(saleItems(sale), itemGross);
}

function saleTotal(sale) {
  if (sale?.total !== undefined) return number(sale.total);

  return Math.max(
    0,
    saleSubtotal(sale)
      + number(sale?.shipping)
      + number(sale?.styrofoamTotal)
      - number(sale?.discount)
  );
}

function saleCost(sale) {
  return sum(saleItems(sale), itemCost);
}

function saleQty(sale) {
  return sum(saleItems(sale), itemQty);
}

function isPersonal(sale) {
  return text(sale?.paymentMethod).toUpperCase() === 'PERSONAL';
}

function flattenSales(value) {
  return Object.entries(value || {}).flatMap(([branchId, rows]) =>
    toArray(rows).map(row => ({
      ...row,
      branchId: row.branchId || branchId
    }))
  );
}

function dedupeSales(sales) {
  const byInvoice = new Map();
  const withoutInvoice = [];

  for (const sale of sales) {
    const invoice = text(
      sale.invoice
      || sale.clientTransactionId
      || ''
    ).toUpperCase();

    if (!invoice) {
      withoutInvoice.push(sale);
      continue;
    }

    const existing = byInvoice.get(invoice);
    const currentIsV2 = !String(sale.source || '')
      .startsWith('legacy:');
    const existingIsV2 = existing
      && !String(existing.source || '').startsWith('legacy:');

    if (!existing || currentIsV2 || !existingIsV2) {
      byInvoice.set(invoice, sale);
    }
  }

  return [...byInvoice.values(), ...withoutInvoice];
}

function currentBranchId() {
  return $('#branchSelector')?.value || '';
}

function currentBranchName() {
  const select = $('#branchSelector');
  const option = select?.options?.[select.selectedIndex];
  return option?.textContent?.trim() || 'AYA SEBLAK DAN ANGKRINGAN';
}

function reportBranchIds() {
  const select = $('#branchSelector');
  const selected = select?.value;

  if (!select || !selected) return [];

  if (selected !== 'all') return [selected];

  return [...select.options]
    .map(option => option.value)
    .filter(value => value && value !== 'all');
}

function reportPeriod() {
  return {
    start: $('#salesReportStart')?.value || '',
    end: $('#salesReportEnd')?.value || ''
  };
}

function inPeriod(date, start, end) {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

/* ============================================================
   SCAN BARCODE PEMBELIAN / KULAKAN
   ============================================================ */

let purchaseProductsPromise = null;

async function purchaseProducts() {
  if (!purchaseProductsPromise) {
    purchaseProductsPromise = getCachedProducts()
      .catch(error => {
        purchaseProductsPromise = null;
        throw error;
      });
  }

  return purchaseProductsPromise;
}

async function findPurchaseByBarcode() {
  const input = $('#purchaseBarcodeLookup');
  const select = $('#buyProduct');

  if (!input || !select) return;

  const code = text(input.value);
  if (!code) {
    notify('Scan atau ketik barcode terlebih dahulu.', 'error');
    input.focus();
    return;
  }

  const products = await purchaseProducts();

  const found = products.find(product => {
    const candidates = [
      product.barcode,
      product.code,
      product.legacyCode,
      product.id
    ]
      .map(value => text(value))
      .filter(Boolean);

    return candidates.includes(code);
  });

  if (!found) {
    notify(`Barcode ${code} belum ditemukan di Master Barang.`, 'error');
    input.select();
    return;
  }

  const optionExists = [...select.options]
    .some(option => String(option.value) === String(found.id));

  if (!optionExists) {
    notify(
      `${found.name || 'Barang'} ditemukan, tetapi belum tersedia pada daftar Kulakan.`,
      'error'
    );
    input.select();
    return;
  }

  select.value = String(found.id);
  select.dispatchEvent(new Event('change', { bubbles: true }));

  notify(`Barang ditemukan: ${found.name || code}`);

  const qty = $('#buyLargeQty');
  if (qty) {
    qty.focus();
    qty.select();
  }
}

function ensurePurchaseBarcode() {
  const select = $('#buyProduct');
  if (!select || $('#purchaseBarcodeLookup')) return;

  const productLabel = select.closest('label');
  if (!productLabel?.parentElement) return;

  const wrap = document.createElement('div');
  wrap.id = 'purchaseBarcodeWrap';
  wrap.className = 'full';
  wrap.style.marginBottom = '2px';

  wrap.innerHTML = `
    <label style="display:grid;gap:6px">
      <span>Scan Barcode / Ketik Barcode</span>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px">
        <input
          id="purchaseBarcodeLookup"
          inputmode="numeric"
          autocomplete="off"
          placeholder="Scan barcode lalu tekan Enter"
        >
        <button
          id="purchaseBarcodeFind"
          type="button"
          class="secondary-button"
        >
          🔎 Cari
        </button>
      </div>
      <small class="muted">
        Bisa memakai scanner barcode USB/keyboard. Barang otomatis dipilih
        tanpa mencari satu per satu di dropdown.
      </small>
    </label>
  `;

  productLabel.parentElement.insertBefore(wrap, productLabel);

  const input = $('#purchaseBarcodeLookup');
  const button = $('#purchaseBarcodeFind');

  button.onclick = () => {
    findPurchaseByBarcode().catch(error => {
      console.error('Scan barcode kulakan gagal:', error);
      notify(error.message || 'Barcode gagal dicari.', 'error');
    });
  };

  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    button.click();
  });
}

/*
 * Sesudah item kulakan dimasukkan ke draft, arahkan scanner kembali
 * ke barcode supaya kasir dapat scan barang berikutnya secara berurutan.
 */
document.addEventListener('click', event => {
  if (event.target?.closest('#addBuyItem')) {
    setTimeout(() => {
      const input = $('#purchaseBarcodeLookup');
      if (!input) return;
      input.value = '';
      input.focus();
    }, 0);
  }
});

/* ============================================================
   DATA LAPORAN LABA/RUGI + PERSONAL
   ============================================================ */

async function loadFinanceData(force = false) {
  const branchIds = reportBranchIds();
  const cacheKey = branchIds.slice().sort().join('|') || 'none';

  if (!force && dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey);
  }

  const salesPromise = getOnce('sales', { force });

  const operationPromises = branchIds.map(async branchId => {
    const raw = await getOnce(`operations/${branchId}`, { force });
    return toArray(raw).map(row => ({
      ...row,
      branchId: row.branchId || branchId
    }));
  });

  const attendancePromises = branchIds.map(async branchId => {
    const raw = await getOnce(`attendance/${branchId}`, { force });
    return toArray(raw).map(row => ({
      ...row,
      branchId: row.branchId || branchId
    }));
  });

  const [salesRaw, operationGroups, attendanceGroups] = await Promise.all([
    salesPromise,
    Promise.all(operationPromises),
    Promise.all(attendancePromises)
  ]);

  const branchSet = new Set(branchIds);

  const sales = dedupeSales(flattenSales(salesRaw))
    .filter(sale => branchSet.has(text(sale.branchId)));

  const data = {
    sales,
    operations: operationGroups.flat(),
    attendance: attendanceGroups.flat(),
    loadedAt: Date.now()
  };

  dataCache.set(cacheKey, data);
  return data;
}

function filteredFinancialData(data) {
  const { start, end } = reportPeriod();

  return {
    start,
    end,
    sales: data.sales.filter(sale =>
      inPeriod(saleDate(sale), start, end)
    ),
    operations: data.operations.filter(row =>
      inPeriod(rowDate(row), start, end)
    ),
    attendance: data.attendance.filter(row =>
      inPeriod(rowDate(row), start, end)
    )
  };
}

function operationTotal(row) {
  if (row?.total !== undefined) return number(row.total);
  return number(row?.qty || 1) * number(row?.price);
}

function attendanceWage(row) {
  if (row?.netWage !== undefined) return number(row.netWage);

  return Math.max(
    0,
    number(row?.dailyWage) - number(row?.deduction)
  );
}

function aggregatePersonalItems(sales) {
  const map = new Map();

  for (const sale of sales) {
    for (const item of saleItems(sale)) {
      const id = text(item.id || item.productId);
      const name = text(item.name || item.nama || 'Tanpa Nama');
      const key = id || `name:${normalized(name)}`;

      const row = map.get(key) || {
        id,
        name,
        unit: item.unit || item.satuan || 'pcs',
        qty: 0,
        value: 0,
        cost: 0,
        invoices: new Set()
      };

      row.qty += itemQty(item);
      row.value += itemGross(item);
      row.cost += itemCost(item);
      row.invoices.add(sale.invoice || sale.id || '-');

      map.set(key, row);
    }
  }

  return [...map.values()]
    .map(row => ({
      ...row,
      invoiceCount: row.invoices.size
    }))
    .sort((a, b) => b.value - a.value || b.qty - a.qty);
}

function reportHeader(title, start, end) {
  return `
    <header class="sales-report-print-header">
      <h2>${escapeHTML(title)}</h2>
      <p>
        ${escapeHTML(currentBranchName())}
        · ${escapeHTML(start || '-')}
        s.d. ${escapeHTML(end || '-')}
      </p>
    </header>
  `;
}

function metric(label, value, hint = '', accent = false, className = '') {
  return `
    <article class="card metric-card ${accent ? 'accent' : ''}">
      <span>${escapeHTML(label)}</span>
      <strong class="${className}">${rupiah(value)}</strong>
      <small>${escapeHTML(hint)}</small>
    </article>
  `;
}

function emptyRow(cols, message) {
  return `<tr><td colspan="${cols}">${escapeHTML(message)}</td></tr>`;
}

async function renderNetProfit(force = false) {
  const content = $('#salesReportContent');
  if (!content) return;

  const token = ++reportRenderToken;

  content.innerHTML = `
    <article class="card">
      <div class="empty-state">
        <div class="spinner"></div>
        <p>Menghitung laba/rugi periode…</p>
      </div>
    </article>
  `;

  try {
    const data = filteredFinancialData(
      await loadFinanceData(force)
    );

    if (token !== reportRenderToken || extraReportMode !== 'net-profit') {
      return;
    }

    const omzet = sum(data.sales, saleTotal);
    const hpp = sum(data.sales, saleCost);
    const personalSales = data.sales.filter(isPersonal);
    const personal = sum(personalSales, saleTotal);
    const operation = sum(data.operations, operationTotal);
    const wages = sum(data.attendance, attendanceWage);

    const nonPersonalOmzet = omzet - personal;
    const grossProfit = omzet - hpp;

    /*
     * PERSONAL berasal dari transaksi kasir dan sudah ikut di dalam omzet.
     * Karena diminta sebagai pemakaian internal, nilainya dikurangkan sekali.
     * HPP PERSONAL tetap termasuk di HPP seluruh barang yang keluar.
     */
    const netProfit =
      omzet - hpp - operation - wages - personal;

    const netClass = netProfit < 0
      ? 'sales-report-loss'
      : 'sales-report-profit';

    const operations = [...data.operations]
      .sort((a, b) =>
        String(rowDate(b)).localeCompare(String(rowDate(a)))
        || number(b.createdAt) - number(a.createdAt)
      );

    const attendance = [...data.attendance]
      .sort((a, b) =>
        String(rowDate(b)).localeCompare(String(rowDate(a)))
        || number(b.createdAt) - number(a.createdAt)
      );

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Laporan Laba / Rugi Bersih', data.start, data.end)}

        <article class="card sales-report-warning">
          <strong>Perhitungan periode penuh:</strong>
          tab ini memakai seluruh transaksi pada cabang dan periode yang dipilih.
          Filter Kasir, Pembayaran, dan Jenis Pesanan tidak membatasi perhitungan
          laba/rugi, supaya biaya cabang tidak dibandingkan dengan sebagian omzet.
        </article>

        <div class="grid cards sales-report-metrics" style="margin-top:16px">
          ${metric(
            'Omzet Kasir',
            omzet,
            `${data.sales.length} nota termasuk PERSONAL`
          )}
          ${metric(
            'Omzet Non-PERSONAL',
            nonPersonalOmzet,
            'Omzet kasir setelah PERSONAL dipisahkan'
          )}
          ${metric(
            'HPP Barang Keluar',
            hpp,
            'Termasuk HPP barang PERSONAL'
          )}
          ${metric(
            'Laba Kotor',
            grossProfit,
            'Omzet - HPP'
          )}
          ${metric(
            'Operasional',
            operation,
            `${data.operations.length} catatan pengeluaran`
          )}
          ${metric(
            'Gaji Karyawan',
            wages,
            `${data.attendance.length} catatan Absensi & Gaji`
          )}
          ${metric(
            'Pemakaian PERSONAL',
            personal,
            `${personalSales.length} nota PERSONAL`
          )}
          ${metric(
            'LABA BERSIH',
            netProfit,
            'Omzet - HPP - Operasional - Gaji - PERSONAL',
            true,
            netClass
          )}
        </div>

        <div class="grid two" style="margin-top:16px">
          <article class="card">
            <div class="toolbar">
              <div>
                <h2>Rincian Perhitungan Laba Bersih</h2>
                <p class="muted">Semua angka mengikuti periode yang dipilih.</p>
              </div>
              <button
                id="onlineNetProfitExport"
                type="button"
                class="secondary-button sales-report-no-print"
              >
                Export CSV
              </button>
            </div>

            <div class="summary-row">
              <span>Omzet seluruh nota kasir</span>
              <strong>${rupiah(omzet)}</strong>
            </div>
            <div class="summary-row">
              <span>HPP seluruh barang keluar</span>
              <strong>-${rupiah(hpp)}</strong>
            </div>
            <div class="summary-row">
              <span>Laba kotor</span>
              <strong>${rupiah(grossProfit)}</strong>
            </div>
            <div class="summary-row">
              <span>Pengeluaran operasional</span>
              <strong>-${rupiah(operation)}</strong>
            </div>
            <div class="summary-row">
              <span>Gaji karyawan</span>
              <strong>-${rupiah(wages)}</strong>
            </div>
            <div class="summary-row">
              <span>Pemakaian PERSONAL</span>
              <strong>-${rupiah(personal)}</strong>
            </div>
            <div class="summary-row total">
              <span>LABA BERSIH</span>
              <strong class="${netClass}">${rupiah(netProfit)}</strong>
            </div>

            <p class="muted" style="margin-top:12px">
              PERSONAL sudah tercatat sebagai transaksi kasir sehingga awalnya
              masuk ke omzet. Di laporan laba/rugi nilainya dikurangkan kembali
              sebagai pemakaian internal.
            </p>
          </article>

          <article class="card">
            <h2>Ringkasan Aktivitas Periode</h2>
            <div class="summary-row">
              <span>Total nota kasir</span>
              <strong>${data.sales.length.toLocaleString('id-ID')}</strong>
            </div>
            <div class="summary-row">
              <span>Nota PERSONAL</span>
              <strong>${personalSales.length.toLocaleString('id-ID')}</strong>
            </div>
            <div class="summary-row">
              <span>Qty barang keluar</span>
              <strong>${sum(data.sales, saleQty).toLocaleString('id-ID')}</strong>
            </div>
            <div class="summary-row">
              <span>Catatan operasional</span>
              <strong>${data.operations.length.toLocaleString('id-ID')}</strong>
            </div>
            <div class="summary-row">
              <span>Catatan absensi/gaji</span>
              <strong>${data.attendance.length.toLocaleString('id-ID')}</strong>
            </div>
          </article>
        </div>

        <article class="card" style="margin-top:16px">
          <h2>Detail Pengeluaran Operasional</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Pengeluaran</th>
                  <th>Qty</th>
                  <th>Harga</th>
                  <th>Metode</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${operations.map(row => `
                  <tr>
                    <td>${escapeHTML(rowDate(row) || '-')}</td>
                    <td>${escapeHTML(row.name || 'Pengeluaran')}</td>
                    <td>${number(row.qty || 1)}</td>
                    <td>${rupiah(row.price)}</td>
                    <td>${escapeHTML(row.paymentMethod || row.method || 'TUNAI')}</td>
                    <td>${rupiah(operationTotal(row))}</td>
                  </tr>
                `).join('') || emptyRow(6, 'Tidak ada pengeluaran operasional pada periode ini.')}
              </tbody>
            </table>
          </div>
        </article>

        <article class="card" style="margin-top:16px">
          <h2>Detail Gaji Karyawan dari Absensi & Gaji</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Karyawan</th>
                  <th>Gaji Hari Ini</th>
                  <th>Potong Kasbon</th>
                  <th>Gaji Bersih</th>
                </tr>
              </thead>
              <tbody>
                ${attendance.map(row => `
                  <tr>
                    <td>${escapeHTML(rowDate(row) || '-')}</td>
                    <td>${escapeHTML(row.employeeName || '-')}</td>
                    <td>${rupiah(row.dailyWage)}</td>
                    <td>${rupiah(row.deduction)}</td>
                    <td>${rupiah(attendanceWage(row))}</td>
                  </tr>
                `).join('') || emptyRow(5, 'Tidak ada data gaji pada periode ini.')}
              </tbody>
            </table>
          </div>
          <p class="muted" style="margin-top:10px">
            Gaji dihitung dari nilai Gaji Bersih pada tab Absensi & Gaji.
            Hindari mencatat gaji yang sama sekali lagi sebagai Operasional
            karena dapat membuat biaya terhitung dua kali.
          </p>
        </article>
      </div>
    `;

    $('#onlineNetProfitExport')?.addEventListener('click', () => {
      const rows = [
        ['komponen', 'nilai'],
        ['omzet_kasir', omzet],
        ['omzet_non_personal', nonPersonalOmzet],
        ['hpp', hpp],
        ['laba_kotor', grossProfit],
        ['operasional', operation],
        ['gaji_karyawan', wages],
        ['pemakaian_personal', personal],
        ['laba_bersih', netProfit]
      ];

      const csv = rows
        .map(row => row.map(csvCell).join(','))
        .join('\n');

      download(
        `laba-rugi-bersih-${data.start}-sd-${data.end}.csv`,
        csv,
        'text/csv'
      );
    });
  } catch (error) {
    console.error('Laporan laba/rugi gagal:', error);

    if (token !== reportRenderToken) return;

    content.innerHTML = `
      <article class="card">
        <h2>Laporan gagal dimuat</h2>
        <p class="danger-text">${escapeHTML(error.message || String(error))}</p>
      </article>
    `;

    notify(error.message || 'Laporan laba/rugi gagal dimuat.', 'error');
  }
}

async function renderPersonal(force = false) {
  const content = $('#salesReportContent');
  if (!content) return;

  const token = ++reportRenderToken;

  content.innerHTML = `
    <article class="card">
      <div class="empty-state">
        <div class="spinner"></div>
        <p>Memuat pemakaian PERSONAL…</p>
      </div>
    </article>
  `;

  try {
    const data = filteredFinancialData(
      await loadFinanceData(force)
    );

    if (token !== reportRenderToken || extraReportMode !== 'personal') {
      return;
    }

    const sales = data.sales
      .filter(isPersonal)
      .sort((a, b) =>
        number(b.createdAt || b.timestamp)
        - number(a.createdAt || a.timestamp)
      );

    const total = sum(sales, saleTotal);
    const hpp = sum(sales, saleCost);
    const qty = sum(sales, saleQty);
    const items = aggregatePersonalItems(sales);

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Laporan Pemakaian PERSONAL', data.start, data.end)}

        <div class="grid cards sales-report-metrics">
          ${metric(
            'Total PERSONAL',
            total,
            `${sales.length} nota`
          )}
          ${metric(
            'HPP Barang PERSONAL',
            hpp,
            'Harga beli barang yang dipakai'
          )}
          <article class="card metric-card">
            <span>Qty Barang PERSONAL</span>
            <strong>${qty.toLocaleString('id-ID')}</strong>
            <small>Total jumlah barang pada nota PERSONAL</small>
          </article>
          <article class="card metric-card accent">
            <span>Rata-rata / Nota</span>
            <strong>${rupiah(sales.length ? total / sales.length : 0)}</strong>
            <small>Nilai PERSONAL rata-rata</small>
          </article>
        </div>

        <article class="card" style="margin-top:16px">
          <div class="toolbar">
            <div>
              <h2>Detail PERSONAL Per Nota</h2>
              <p class="muted">
                Semua nota Kasir dengan metode pembayaran PERSONAL.
              </p>
            </div>
            <button
              id="onlinePersonalExport"
              type="button"
              class="secondary-button sales-report-no-print"
            >
              Export PERSONAL CSV
            </button>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>No. Nota</th>
                  <th>Pemakai / Pelanggan</th>
                  <th>Kasir</th>
                  <th>Qty</th>
                  <th>Total PERSONAL</th>
                  <th>HPP</th>
                </tr>
              </thead>
              <tbody>
                ${sales.map(sale => `
                  <tr>
                    <td>${dateTime(sale.createdAt || sale.timestamp || sale.date)}</td>
                    <td><strong>${escapeHTML(sale.invoice || sale.id || '-')}</strong></td>
                    <td>${escapeHTML(sale.customerName || 'PERSONAL')}</td>
                    <td>${escapeHTML(sale.cashierName || '-')}</td>
                    <td>${saleQty(sale)}</td>
                    <td>${rupiah(saleTotal(sale))}</td>
                    <td>${rupiah(saleCost(sale))}</td>
                  </tr>
                `).join('') || emptyRow(7, 'Tidak ada transaksi PERSONAL pada periode ini.')}
              </tbody>
            </table>
          </div>
        </article>

        <article class="card" style="margin-top:16px">
          <h2>Detail PERSONAL Per Item</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Barang</th>
                  <th>Qty</th>
                  <th>Jumlah Nota</th>
                  <th>Nilai PERSONAL</th>
                  <th>HPP</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => `
                  <tr>
                    <td>
                      <strong>${escapeHTML(item.name)}</strong>
                      <br>
                      <small class="muted">${escapeHTML(item.unit || 'pcs')}</small>
                    </td>
                    <td>${item.qty.toLocaleString('id-ID')}</td>
                    <td>${item.invoiceCount}</td>
                    <td>${rupiah(item.value)}</td>
                    <td>${rupiah(item.cost)}</td>
                  </tr>
                `).join('') || emptyRow(5, 'Belum ada item PERSONAL pada periode ini.')}
              </tbody>
            </table>
          </div>
        </article>

        <article class="card sales-report-warning" style="margin-top:16px">
          <strong>Catatan:</strong>
          nilai PERSONAL diambil langsung dari transaksi Kasir dengan metode
          pembayaran PERSONAL. Tidak perlu dicatat ulang di Operasional.
        </article>
      </div>
    `;

    $('#onlinePersonalExport')?.addEventListener('click', () => {
      const headers = [
        'tanggal',
        'invoice',
        'pemakai',
        'kasir',
        'qty',
        'nilai_personal',
        'hpp'
      ];

      const csv = [
        headers.join(','),
        ...sales.map(sale => [
          saleDate(sale),
          sale.invoice || sale.id || '-',
          sale.customerName || 'PERSONAL',
          sale.cashierName || '-',
          saleQty(sale),
          saleTotal(sale),
          saleCost(sale)
        ].map(csvCell).join(','))
      ].join('\n');

      download(
        `pemakaian-personal-${data.start}-sd-${data.end}.csv`,
        csv,
        'text/csv'
      );
    });
  } catch (error) {
    console.error('Laporan PERSONAL gagal:', error);

    if (token !== reportRenderToken) return;

    content.innerHTML = `
      <article class="card">
        <h2>Laporan PERSONAL gagal dimuat</h2>
        <p class="danger-text">${escapeHTML(error.message || String(error))}</p>
      </article>
    `;

    notify(error.message || 'Laporan PERSONAL gagal dimuat.', 'error');
  }
}

function setExtraTabVisual(mode) {
  document.querySelectorAll('[data-sales-tab]').forEach(button => {
    button.classList.remove('active');
  });

  document.querySelectorAll('[data-online-extra-tab]').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.onlineExtraTab === mode
    );
  });
}

async function renderExtraReport(force = false) {
  if (!extraReportMode) return;

  setExtraTabVisual(extraReportMode);

  if (extraReportMode === 'net-profit') {
    await renderNetProfit(force);
  }

  if (extraReportMode === 'personal') {
    await renderPersonal(force);
  }
}

function ensureExtraReportTabs() {
  const tabs = $('.sales-report-tabs');
  const content = $('#salesReportContent');

  if (!tabs || !content) {
    extraReportMode = null;
    return;
  }

  if (!$('[data-online-extra-tab="net-profit"]', tabs)) {
    const net = document.createElement('button');
    net.type = 'button';
    net.className = 'sales-report-tab';
    net.dataset.onlineExtraTab = 'net-profit';
    net.textContent = '💰 Laba/Rugi Bersih';
    tabs.append(net);

    const personal = document.createElement('button');
    personal.type = 'button';
    personal.className = 'sales-report-tab';
    personal.dataset.onlineExtraTab = 'personal';
    personal.textContent = '👤 Pemakaian PERSONAL';
    tabs.append(personal);
  }
}

/*
 * Event delegasi laporan tambahan.
 */
document.addEventListener('click', event => {
  const extra = event.target?.closest('[data-online-extra-tab]');

  if (extra) {
    extraReportMode = extra.dataset.onlineExtraTab;

    renderExtraReport(true).catch(error => {
      console.error(error);
      notify(error.message || 'Laporan gagal dimuat.', 'error');
    });

    return;
  }

  if (event.target?.closest('[data-sales-tab]')) {
    extraReportMode = null;
  }

  if (event.target?.closest('#salesReportReload') && extraReportMode) {
    dataCache.clear();

    setTimeout(() => {
      ensureExtraReportTabs();

      renderExtraReport(true).catch(error => {
        console.error(error);
      });
    }, 60);
  }
});

/*
 * Filter tanggal pada laporan: bila sedang membuka tab tambahan,
 * render ulang setelah handler reports.js selesai.
 */
document.addEventListener('change', event => {
  const id = event.target?.id || '';

  if (
    extraReportMode
    && [
      'salesReportPreset',
      'salesReportStart',
      'salesReportEnd'
    ].includes(id)
  ) {
    setTimeout(() => {
      renderExtraReport(false).catch(error => {
        console.error(error);
      });
    }, 0);
  }
});

/* ============================================================
   OBSERVER NAVIGASI
   ============================================================ */

function syncEnhancements() {
  ensurePurchaseBarcode();
  ensureExtraReportTabs();

  if (
    extraReportMode
    && REPORT_MODES.has(extraReportMode)
    && $('#salesReportContent')
  ) {
    setExtraTabVisual(extraReportMode);
  }
}

function scheduleSync() {
  if (observerScheduled) return;

  observerScheduled = true;

  requestAnimationFrame(() => {
    observerScheduled = false;
    syncEnhancements();
  });
}

const observer = new MutationObserver(mutations => {
  if (
    mutations.some(mutation =>
      mutation.type === 'childList'
      && (
        mutation.addedNodes.length
        || mutation.removedNodes.length
      )
    )
  ) {
    scheduleSync();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('hashchange', () => {
  extraReportMode = null;
  scheduleSync();
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

console.info(`AYA POS ONLINE v${VERSION} enhancements loaded.`);
