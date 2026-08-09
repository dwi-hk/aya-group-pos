import { getOnce } from './store.js';
import { printReceipt } from './print.js';
import {
  rupiah,
  escapeHTML,
  toArray,
  sum,
  number,
  csvCell,
  download
} from './utils.js';

const NOTE_PAGE_SIZE = 30;
const ITEM_PAGE_SIZE = 60;
const SEARCH_DELAY = 180;

function flatten(value) {
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

    /*
     * Laporan menjadi lapisan pengaman kedua:
     * satu nomor nota hanya dihitung satu kali dan data V2 diprioritaskan.
     */
    if (!existing || currentIsV2 || !existingIsV2) {
      byInvoice.set(invoice, sale);
    }
  }

  return [
    ...byInvoice.values(),
    ...withoutInvoice
  ];
}

function debounce(callback, delay = SEARCH_DELAY) {
  let timer;

  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
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

function saleDate(sale) {
  return localDate(sale.createdAt, sale.date);
}

function dateTime(value) {
  const date = new Date(value);

  return Number.isFinite(date.getTime())
    ? date.toLocaleString('id-ID')
    : '-';
}

function itemQty(item) {
  return number(item?.qty || 0);
}

function itemGross(item) {
  return itemQty(item) * number(item?.price);
}

function itemCost(item) {
  return itemQty(item) * number(item?.cost);
}

function saleItems(sale) {
  if (Array.isArray(sale?.items)) return sale.items;
  if (sale?.items && typeof sale.items === 'object') {
    return Object.values(sale.items);
  }
  return [];
}

function saleItemGross(sale) {
  return sum(saleItems(sale), itemGross);
}

function saleSubtotal(sale) {
  return number(sale?.subtotal) || saleItemGross(sale);
}

function saleTotal(sale) {
  const stored = number(sale?.total);

  if (sale?.total !== undefined) return stored;

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

function saleDiscount(sale) {
  return number(sale?.discount);
}

function saleExtra(sale) {
  return number(sale?.shipping) + number(sale?.styrofoamTotal);
}

function normalizeReceiptSale(sale) {
  const subtotal = saleSubtotal(sale);
  const shipping = number(sale.shipping);
  const styrofoamTotal = number(sale.styrofoamTotal);
  const discount = saleDiscount(sale);
  const total = saleTotal(sale);
  const paid = number(sale.paid) || total;

  return {
    ...sale,
    invoice: sale.invoice || sale.id || 'NOTA-LAMA',
    branchName: sale.branchName || sale.branchId || '-',
    cashierName: sale.cashierName || sale.kasir || '-',
    paymentMethod: sale.paymentMethod || 'TUNAI',
    orderType: sale.orderType || sale.tipePesanan || '-',
    customerName: sale.customerName || sale.pelangganNama || '',
    createdAt: sale.createdAt || sale.timestamp || Date.now(),
    subtotal,
    shipping,
    styrofoamTotal,
    discount,
    total,
    paid,
    change: number(sale.change) || Math.max(0, paid - total),
    items: saleItems(sale).map((item, index) => ({
      ...item,
      id: String(item.id || item.productId || index),
      name: item.name || item.nama || 'Item',
      qty: itemQty(item) || 1,
      price: number(item.price ?? item.harga),
      cost: number(item.cost ?? item.hargaBeli),
      unit: item.unit || item.satuan || 'pcs',
      category: item.category || item.kategori || 'Lainnya'
    }))
  };
}

function presetRange(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start = new Date(today);
  let end = new Date(today);

  if (preset === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end = new Date(start);
  }

  if (preset === 'thisWeek') {
    const weekday = start.getDay() || 7;
    start.setDate(start.getDate() - weekday + 1);
  }

  if (preset === 'thisMonth') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  }

  if (preset === 'lastMonth') {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end = new Date(today.getFullYear(), today.getMonth(), 0);
  }

  return {
    start: localDate(start),
    end: localDate(end)
  };
}

function aggregateItems(sales) {
  const map = new Map();

  for (const sale of sales) {
    const itemGrossTotal = saleItemGross(sale);
    const discount = saleDiscount(sale);

    for (const item of saleItems(sale)) {
      const id = text(item.id || item.productId);
      const name = text(item.name || item.nama || 'Tanpa nama');
      const key = id || `name:${normalized(name)}`;
      const gross = itemGross(item);
      const discountShare = itemGrossTotal > 0
        ? discount * (gross / itemGrossTotal)
        : 0;
      const netRevenue = Math.max(0, gross - discountShare);
      const cost = itemCost(item);

      const row = map.get(key) || {
        id,
        name,
        category: item.category || item.kategori || 'Lainnya',
        unit: item.unit || item.satuan || 'pcs',
        qty: 0,
        grossRevenue: 0,
        discountShare: 0,
        netRevenue: 0,
        cost: 0,
        invoiceIds: new Set(),
        missingCost: 0
      };

      row.qty += itemQty(item);
      row.grossRevenue += gross;
      row.discountShare += discountShare;
      row.netRevenue += netRevenue;
      row.cost += cost;
      row.invoiceIds.add(sale.invoice || sale.id || '-');

      if (number(item.cost ?? item.hargaBeli) <= 0) {
        row.missingCost++;
      }

      map.set(key, row);
    }
  }

  return [...map.values()].map(row => ({
    ...row,
    invoiceCount: row.invoiceIds.size,
    profit: row.netRevenue - row.cost,
    margin: row.netRevenue > 0
      ? ((row.netRevenue - row.cost) / row.netRevenue) * 100
      : 0,
    averagePrice: row.qty > 0
      ? row.grossRevenue / row.qty
      : 0
  }));
}

function dailySales(sales) {
  const map = new Map();

  for (const sale of sales) {
    const date = saleDate(sale);
    if (!date) continue;

    const row = map.get(date) || {
      date,
      invoices: 0,
      qty: 0,
      grossItems: 0,
      discount: 0,
      extra: 0,
      omzet: 0,
      hpp: 0
    };

    row.invoices++;
    row.qty += saleQty(sale);
    row.grossItems += saleItemGross(sale);
    row.discount += saleDiscount(sale);
    row.extra += saleExtra(sale);
    row.omzet += saleTotal(sale);
    row.hpp += saleCost(sale);

    map.set(date, row);
  }

  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(row => ({
      ...row,
      grossProfit: row.omzet - row.hpp
    }));
}

function branchName(ctx) {
  return ctx.branch.id === 'all'
    ? 'Semua Cabang'
    : ctx.branch.name;
}

export async function renderReports(ctx) {
  /*
   * Fokus v2.10.1 hanya laporan penjualan.
   * Tidak membaca purchases, operations, capital, atau products.
   */
  const salesRaw = await getOnce('sales');
  const flattenedSales = flatten(salesRaw);
  const allSales = dedupeSales(flattenedSales);
  const duplicateRowsIgnored = flattenedSales.length - allSales.length;

  const cashiers = [...new Set(
    allSales.map(sale => sale.cashierName).filter(Boolean)
  )].sort((a, b) => String(a).localeCompare(String(b), 'id'));

  const payments = [...new Set([
    'TUNAI',
    'QRIS',
    'HUTANG',
    'PERSONAL',
    ...allSales
      .map(sale => text(sale.paymentMethod).toUpperCase())
      .filter(Boolean)
  ])];

  const orderTypes = [...new Set(
    allSales
      .map(sale => text(sale.orderType || sale.tipePesanan))
      .filter(Boolean)
  )];

  const initial = presetRange('thisMonth');

  let activeTab = 'summary';
  let filteredSales = [];
  let notePage = 1;
  let itemPage = 1;
  let noteSearch = '';
  let itemSearch = '';

  ctx.host.innerHTML = `
    <article class="card sales-report-filter sales-report-no-print">
      <div class="toolbar">
        <div>
          <h2>Laporan Penjualan</h2>
          <p class="muted">
            Ringkasan omzet, nota, barang terjual, dan laba kotor penjualan.
            ${duplicateRowsIgnored
              ? `<br><strong>${duplicateRowsIgnored} salinan nota ganda diabaikan otomatis.</strong>`
              : ''}
          </p>
        </div>

        <div class="toolbar-group">
          <button type="button" id="salesReportReload" class="secondary-button">
            ↻ Muat Data Terbaru
          </button>
          <button type="button" id="salesReportExport" class="secondary-button">
            Export CSV
          </button>
          <button type="button" id="salesReportPrint" class="primary-button">
            Cetak Tab
          </button>
        </div>
      </div>

      <div class="form-grid sales-report-filter-grid">
        <label>
          Periode
          <select id="salesReportPreset">
            <option value="today">Hari Ini</option>
            <option value="yesterday">Kemarin</option>
            <option value="thisWeek">Minggu Ini</option>
            <option value="thisMonth" selected>Bulan Ini</option>
            <option value="lastMonth">Bulan Lalu</option>
            <option value="custom">Pilih Sendiri</option>
          </select>
        </label>

        <label>
          Dari Tanggal
          <input id="salesReportStart" type="date" value="${initial.start}">
        </label>

        <label>
          Sampai Tanggal
          <input id="salesReportEnd" type="date" value="${initial.end}">
        </label>

        <label>
          Kasir
          <select id="salesReportCashier">
            <option value="all">Semua Kasir</option>
            ${cashiers.map(name =>
              `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`
            ).join('')}
          </select>
        </label>

        <label>
          Pembayaran
          <select id="salesReportPayment">
            <option value="all">Semua Pembayaran</option>
            ${payments.map(method =>
              `<option value="${escapeHTML(method)}">${escapeHTML(method)}</option>`
            ).join('')}
          </select>
        </label>

        <label>
          Jenis Pesanan
          <select id="salesReportOrder">
            <option value="all">Semua Pesanan</option>
            ${orderTypes.map(type =>
              `<option value="${escapeHTML(type)}">${escapeHTML(type)}</option>`
            ).join('')}
          </select>
        </label>
      </div>

      <p class="muted sales-report-branch">
        Cabang: <strong>${escapeHTML(branchName(ctx))}</strong>
      </p>
    </article>

    <nav class="sales-report-tabs sales-report-no-print">
      <button type="button" class="sales-report-tab active" data-sales-tab="summary">
        📊 Ringkasan
      </button>
      <button type="button" class="sales-report-tab" data-sales-tab="notes">
        🧾 Per Nota
      </button>
      <button type="button" class="sales-report-tab" data-sales-tab="items">
        📦 Per Item
      </button>
      <button type="button" class="sales-report-tab" data-sales-tab="profit">
        💹 Laba per Item
      </button>
    </nav>

    <section id="salesReportContent" class="sales-report-content"></section>
  `;

  const host = ctx.host;
  const content = host.querySelector('#salesReportContent');

  const reportHeader = title => `
    <header class="sales-report-print-header">
      <h2>${escapeHTML(title)}</h2>
      <p>
        ${escapeHTML(branchName(ctx))}
        · ${escapeHTML(host.querySelector('#salesReportStart').value)}
        s.d. ${escapeHTML(host.querySelector('#salesReportEnd').value)}
      </p>
    </header>
  `;

  const warnings = () => {
    const missing = filteredSales
      .flatMap(saleItems)
      .filter(item => number(item.cost ?? item.hargaBeli) <= 0)
      .length;

    return missing
      ? `<article class="card sales-report-warning">
          <strong>Catatan HPP:</strong>
          ${missing} baris item belum mempunyai harga beli.
          Laba item tersebut sementara dihitung menggunakan HPP Rp0.
        </article>`
      : '';
  };

  const applyFilters = () => {
    const start = host.querySelector('#salesReportStart').value;
    const end = host.querySelector('#salesReportEnd').value;
    const cashier = host.querySelector('#salesReportCashier').value;
    const payment = host.querySelector('#salesReportPayment').value;
    const orderType = host.querySelector('#salesReportOrder').value;

    filteredSales = allSales.filter(sale => {
      const date = saleDate(sale);
      const saleOrder = text(sale.orderType || sale.tipePesanan);

      return date >= start
        && date <= end
        && (
          ctx.branch.id === 'all'
          || sale.branchId === ctx.branch.id
        )
        && (
          cashier === 'all'
          || sale.cashierName === cashier
        )
        && (
          payment === 'all'
          || text(sale.paymentMethod).toUpperCase() === payment
        )
        && (
          orderType === 'all'
          || saleOrder === orderType
        );
    });

    notePage = 1;
    itemPage = 1;
    renderActive();
  };

  const renderSummary = () => {
    const omzet = sum(filteredSales, saleTotal);
    const grossItems = sum(filteredSales, saleItemGross);
    const discount = sum(filteredSales, saleDiscount);
    const extra = sum(filteredSales, saleExtra);
    const hpp = sum(filteredSales, saleCost);
    const grossProfit = omzet - hpp;
    const qty = sum(filteredSales, saleQty);
    const invoiceCount = filteredSales.length;
    const averageInvoice = invoiceCount > 0
      ? omzet / invoiceCount
      : 0;

    const byPayment = {};
    const byOrder = {};

    filteredSales.forEach(sale => {
      const payment = text(sale.paymentMethod || 'LAINNYA').toUpperCase();
      const order = text(sale.orderType || sale.tipePesanan || 'LAINNYA');

      byPayment[payment] =
        (byPayment[payment] || 0) + saleTotal(sale);

      byOrder[order] =
        (byOrder[order] || 0) + saleTotal(sale);
    });

    const daily = dailySales(filteredSales);

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Ringkasan Penjualan')}
        ${warnings()}

        <div class="grid cards sales-report-metrics">
          <article class="card metric-card accent">
            <span>Omzet Penjualan</span>
            <strong>${rupiah(omzet)}</strong>
            <small>${invoiceCount} nota · ${qty} item</small>
          </article>

          <article class="card metric-card">
            <span>Rata-rata per Nota</span>
            <strong>${rupiah(averageInvoice)}</strong>
            <small>Nilai rata-rata transaksi</small>
          </article>

          <article class="card metric-card">
            <span>Total Diskon</span>
            <strong>${rupiah(discount)}</strong>
            <small>Potongan seluruh nota</small>
          </article>

          <article class="card metric-card">
            <span>Laba Kotor Penjualan</span>
            <strong class="${grossProfit < 0 ? 'sales-report-loss' : 'sales-report-profit'}">
              ${rupiah(grossProfit)}
            </strong>
            <small>Omzet nota - HPP item</small>
          </article>
        </div>

        <div class="grid two" style="margin-top:16px">
          <article class="card">
            <h2>Rincian Nilai Penjualan</h2>
            <div class="summary-row">
              <span>Penjualan item sebelum diskon</span>
              <strong>${rupiah(grossItems)}</strong>
            </div>
            <div class="summary-row">
              <span>Total diskon</span>
              <strong>-${rupiah(discount)}</strong>
            </div>
            <div class="summary-row">
              <span>Ongkir + styrofoam</span>
              <strong>${rupiah(extra)}</strong>
            </div>
            <div class="summary-row total">
              <span>Omzet nota</span>
              <strong>${rupiah(omzet)}</strong>
            </div>
            <div class="summary-row">
              <span>HPP barang terjual</span>
              <strong>-${rupiah(hpp)}</strong>
            </div>
            <div class="summary-row total">
              <span>Laba kotor penjualan</span>
              <strong class="${grossProfit < 0 ? 'sales-report-loss' : 'sales-report-profit'}">
                ${rupiah(grossProfit)}
              </strong>
            </div>
          </article>

          <article class="card">
            <h2>Omzet Berdasarkan Pembayaran</h2>
            ${Object.entries(byPayment)
              .sort((a, b) => b[1] - a[1])
              .map(([method, value]) => `
                <div class="summary-row">
                  <span>${escapeHTML(method)}</span>
                  <strong>${rupiah(value)}</strong>
                </div>
              `).join('')
              || '<p class="muted">Belum ada transaksi.</p>'}
          </article>
        </div>

        <div class="grid two" style="margin-top:16px">
          <article class="card">
            <h2>Omzet Berdasarkan Jenis Pesanan</h2>
            ${Object.entries(byOrder)
              .sort((a, b) => b[1] - a[1])
              .map(([order, value]) => `
                <div class="summary-row">
                  <span>${escapeHTML(order)}</span>
                  <strong>${rupiah(value)}</strong>
                </div>
              `).join('')
              || '<p class="muted">Belum ada data pesanan.</p>'}
          </article>

          <article class="card">
            <h2>Ringkasan Jumlah</h2>
            <div class="summary-row">
              <span>Jumlah nota</span>
              <strong>${invoiceCount}</strong>
            </div>
            <div class="summary-row">
              <span>Jumlah item terjual</span>
              <strong>${qty}</strong>
            </div>
            <div class="summary-row">
              <span>Rata-rata item per nota</span>
              <strong>${invoiceCount ? (qty / invoiceCount).toFixed(1) : '0'}</strong>
            </div>
          </article>
        </div>

        <article class="card" style="margin-top:16px">
          <h2>Penjualan Harian</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Nota</th>
                  <th>Qty</th>
                  <th>Penjualan Item</th>
                  <th>Diskon</th>
                  <th>Tambahan</th>
                  <th>Omzet</th>
                  <th>HPP</th>
                  <th>Laba Kotor</th>
                </tr>
              </thead>
              <tbody>
                ${daily.map(row => `
                  <tr>
                    <td>${escapeHTML(row.date)}</td>
                    <td>${row.invoices}</td>
                    <td>${row.qty}</td>
                    <td>${rupiah(row.grossItems)}</td>
                    <td>${rupiah(row.discount)}</td>
                    <td>${rupiah(row.extra)}</td>
                    <td>${rupiah(row.omzet)}</td>
                    <td>${rupiah(row.hpp)}</td>
                    <td class="${row.grossProfit < 0 ? 'sales-report-loss' : 'sales-report-profit'}">
                      ${rupiah(row.grossProfit)}
                    </td>
                  </tr>
                `).join('')
                || '<tr><td colspan="9">Tidak ada penjualan pada periode ini.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    `;
  };

  const noteResults = () => {
    const query = normalized(noteSearch);

    return [...filteredSales]
      .filter(sale => {
        if (!query) return true;

        const haystack = normalized([
          sale.invoice,
          sale.customerName,
          sale.cashierName,
          sale.paymentMethod,
          sale.orderType,
          ...saleItems(sale).map(item => item.name || item.nama)
        ].join(' '));

        return haystack.includes(query);
      })
      .sort((a, b) =>
        number(b.createdAt || b.timestamp)
        - number(a.createdAt || a.timestamp)
      );
  };

  const renderNotes = () => {
    const sales = noteResults();
    const pages = Math.max(1, Math.ceil(sales.length / NOTE_PAGE_SIZE));

    notePage = Math.min(Math.max(1, notePage), pages);

    const start = (notePage - 1) * NOTE_PAGE_SIZE;
    const pageRows = sales.slice(start, start + NOTE_PAGE_SIZE);

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Laporan Penjualan Per Nota')}

        <article class="card sales-report-no-print">
          <div class="toolbar">
            <div>
              <h2>Cari Nota Penjualan</h2>
              <p class="muted">
                Cari nomor nota, pelanggan, kasir, pembayaran, atau barang.
              </p>
            </div>

            <input
              id="salesNoteSearch"
              value="${escapeHTML(noteSearch)}"
              placeholder="Nomor nota / nama…"
            >
          </div>
        </article>

        ${warnings()}

        <article class="card" style="margin-top:16px">
          <div class="toolbar">
            <div>
              <h2>Daftar Nota Penjualan</h2>
              <p class="muted">
                ${sales.length.toLocaleString('id-ID')} nota ditemukan.
              </p>
            </div>

            <span class="badge">Halaman ${notePage} / ${pages}</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>No. Nota</th>
                  <th>Kasir / Pelanggan</th>
                  <th>Pesanan</th>
                  <th>Qty</th>
                  <th>Pembayaran</th>
                  <th>Diskon</th>
                  <th>Total</th>
                  <th>HPP</th>
                  <th>Laba Kotor</th>
                  <th class="sales-report-no-print">Aksi</th>
                </tr>
              </thead>
              <tbody>
                ${pageRows.map((sale, index) => {
                  const total = saleTotal(sale);
                  const hpp = saleCost(sale);
                  const profit = total - hpp;
                  const globalIndex = start + index;

                  return `
                    <tr>
                      <td>${dateTime(sale.createdAt || sale.timestamp || sale.date)}</td>
                      <td>
                        <strong>${escapeHTML(sale.invoice || sale.id || '-')}</strong>
                        <br>
                        <small>${escapeHTML(sale.branchName || sale.branchId || '-')}</small>
                      </td>
                      <td>
                        ${escapeHTML(sale.cashierName || '-')}
                        <br>
                        <small>${escapeHTML(sale.customerName || 'Umum')}</small>
                      </td>
                      <td>${escapeHTML(sale.orderType || sale.tipePesanan || '-')}</td>
                      <td>${saleQty(sale)}</td>
                      <td>${escapeHTML(sale.paymentMethod || '-')}</td>
                      <td>${rupiah(saleDiscount(sale))}</td>
                      <td>${rupiah(total)}</td>
                      <td>${rupiah(hpp)}</td>
                      <td class="${profit < 0 ? 'sales-report-loss' : 'sales-report-profit'}">
                        ${rupiah(profit)}
                      </td>
                      <td class="sales-report-actions sales-report-no-print">
                        <button
                          type="button"
                          class="secondary-button sales-report-small-button"
                          data-sale-detail="${globalIndex}"
                        >
                          Detail
                        </button>
                        <button
                          type="button"
                          class="primary-button sales-report-small-button"
                          data-sale-print="${globalIndex}"
                        >
                          Cetak Ulang
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')
                || '<tr><td colspan="11">Tidak ada nota penjualan.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="toolbar sales-report-pagination sales-report-no-print">
            <small class="muted">
              Menampilkan
              ${sales.length ? start + 1 : 0}–
              ${Math.min(start + NOTE_PAGE_SIZE, sales.length)}
              dari ${sales.length}
            </small>

            <div class="toolbar-group">
              <button
                type="button"
                id="salesNotePrev"
                class="secondary-button"
                ${notePage <= 1 ? 'disabled' : ''}
              >
                ← Sebelumnya
              </button>

              <button
                type="button"
                id="salesNoteNext"
                class="secondary-button"
                ${notePage >= pages ? 'disabled' : ''}
              >
                Berikutnya →
              </button>
            </div>
          </div>
        </article>
      </div>
    `;
  };

  const itemResults = () => {
    const query = normalized(itemSearch);

    return aggregateItems(filteredSales)
      .filter(item => (
        !query
        || normalized(`${item.name} ${item.category} ${item.id}`).includes(query)
      ))
      .sort((a, b) => b.qty - a.qty || b.netRevenue - a.netRevenue);
  };

  const renderItems = () => {
    const items = itemResults();
    const pages = Math.max(1, Math.ceil(items.length / ITEM_PAGE_SIZE));

    itemPage = Math.min(Math.max(1, itemPage), pages);

    const start = (itemPage - 1) * ITEM_PAGE_SIZE;
    const pageRows = items.slice(start, start + ITEM_PAGE_SIZE);

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Laporan Penjualan Per Item')}

        <article class="card sales-report-no-print">
          <div class="toolbar">
            <div>
              <h2>Cari Item Penjualan</h2>
              <p class="muted">
                Lihat qty terjual, jumlah nota, dan omzet setiap item.
              </p>
            </div>

            <input
              id="salesItemSearch"
              value="${escapeHTML(itemSearch)}"
              placeholder="Nama / kategori barang…"
            >
          </div>
        </article>

        <article class="card" style="margin-top:16px">
          <div class="toolbar">
            <div>
              <h2>Penjualan Per Item</h2>
              <p class="muted">
                ${items.length.toLocaleString('id-ID')} item ditemukan.
              </p>
            </div>

            <span class="badge">Halaman ${itemPage} / ${pages}</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Kategori</th>
                  <th>Qty Terjual</th>
                  <th>Jumlah Nota</th>
                  <th>Rata-rata Harga</th>
                  <th>Penjualan Kotor</th>
                  <th>Bagian Diskon</th>
                  <th>Penjualan Bersih</th>
                </tr>
              </thead>
              <tbody>
                ${pageRows.map(item => `
                  <tr>
                    <td>
                      <strong>${escapeHTML(item.name)}</strong>
                      <br>
                      <small>${escapeHTML(item.id || item.unit)}</small>
                    </td>
                    <td>${escapeHTML(item.category)}</td>
                    <td>
                      ${item.qty.toLocaleString('id-ID')}
                      ${escapeHTML(item.unit)}
                    </td>
                    <td>${item.invoiceCount}</td>
                    <td>${rupiah(item.averagePrice)}</td>
                    <td>${rupiah(item.grossRevenue)}</td>
                    <td>${rupiah(item.discountShare)}</td>
                    <td>${rupiah(item.netRevenue)}</td>
                  </tr>
                `).join('')
                || '<tr><td colspan="8">Belum ada item terjual.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="toolbar sales-report-pagination sales-report-no-print">
            <small class="muted">
              Menampilkan
              ${items.length ? start + 1 : 0}–
              ${Math.min(start + ITEM_PAGE_SIZE, items.length)}
              dari ${items.length}
            </small>

            <div class="toolbar-group">
              <button
                type="button"
                id="salesItemPrev"
                class="secondary-button"
                ${itemPage <= 1 ? 'disabled' : ''}
              >
                ← Sebelumnya
              </button>

              <button
                type="button"
                id="salesItemNext"
                class="secondary-button"
                ${itemPage >= pages ? 'disabled' : ''}
              >
                Berikutnya →
              </button>
            </div>
          </div>
        </article>
      </div>
    `;
  };

  const renderProfit = () => {
    const items = aggregateItems(filteredSales)
      .sort((a, b) => b.profit - a.profit);

    const totalNetRevenue = sum(items, item => item.netRevenue);
    const totalCost = sum(items, item => item.cost);
    const totalProfit = totalNetRevenue - totalCost;
    const profitable = items.filter(item => item.profit >= 0);
    const lossItems = items.filter(item => item.profit < 0);

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Laba Kotor Penjualan Per Item')}
        ${warnings()}

        <div class="grid cards sales-report-metrics">
          <article class="card metric-card">
            <span>Penjualan Bersih Item</span>
            <strong>${rupiah(totalNetRevenue)}</strong>
            <small>Setelah pembagian diskon</small>
          </article>

          <article class="card metric-card">
            <span>Total HPP</span>
            <strong>${rupiah(totalCost)}</strong>
            <small>Harga beli barang terjual</small>
          </article>

          <article class="card metric-card accent">
            <span>Laba Kotor Item</span>
            <strong class="${totalProfit < 0 ? 'sales-report-loss' : 'sales-report-profit'}">
              ${rupiah(totalProfit)}
            </strong>
            <small>Belum dikurangi operasional</small>
          </article>

          <article class="card metric-card">
            <span>Item Rugi</span>
            <strong>${lossItems.length}</strong>
            <small>Perlu diperiksa harga jual/HPP</small>
          </article>
        </div>

        <article class="card" style="margin-top:16px">
          <h2>Laba Kotor Setiap Item</h2>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Penjualan Kotor</th>
                  <th>Bagian Diskon</th>
                  <th>Penjualan Bersih</th>
                  <th>HPP</th>
                  <th>Laba/Rugi Kotor</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => `
                  <tr>
                    <td>
                      <strong>${escapeHTML(item.name)}</strong>
                      ${item.missingCost ? `
                        <br>
                        <small class="danger-text">
                          ${item.missingCost} baris HPP kosong
                        </small>
                      ` : ''}
                    </td>
                    <td>${item.qty}</td>
                    <td>${rupiah(item.grossRevenue)}</td>
                    <td>${rupiah(item.discountShare)}</td>
                    <td>${rupiah(item.netRevenue)}</td>
                    <td>${rupiah(item.cost)}</td>
                    <td class="${item.profit < 0 ? 'sales-report-loss' : 'sales-report-profit'}">
                      ${rupiah(item.profit)}
                    </td>
                    <td>${item.margin.toFixed(1)}%</td>
                  </tr>
                `).join('')
                || '<tr><td colspan="8">Belum ada data laba item.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>

        <div class="grid two" style="margin-top:16px">
          <article class="card">
            <h2>10 Item Laba Terbesar</h2>
            ${profitable
              .slice(0, 10)
              .map((item, index) => `
                <div class="summary-row">
                  <span>${index + 1}. ${escapeHTML(item.name)}</span>
                  <strong class="sales-report-profit">${rupiah(item.profit)}</strong>
                </div>
              `).join('')
              || '<p class="muted">Belum ada item berlaba.</p>'}
          </article>

          <article class="card">
            <h2>Item Rugi / Perlu Diperiksa</h2>
            ${lossItems
              .slice(0, 10)
              .map(item => `
                <div class="summary-row">
                  <span>${escapeHTML(item.name)}</span>
                  <strong class="sales-report-loss">${rupiah(item.profit)}</strong>
                </div>
              `).join('')
              || '<p class="muted">Tidak ada item dengan laba kotor negatif.</p>'}
          </article>
        </div>

        <article class="card sales-report-warning" style="margin-top:16px">
          <strong>Catatan:</strong>
          laba per item adalah laba kotor setelah pembagian diskon nota secara
          proporsional. Ongkir, styrofoam, dan biaya operasional tidak dibagikan
          ke item.
        </article>
      </div>
    `;
  };

  const renderActive = () => {
    host.querySelectorAll('[data-sales-tab]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.salesTab === activeTab
      );
    });

    if (activeTab === 'summary') renderSummary();
    if (activeTab === 'notes') renderNotes();
    if (activeTab === 'items') renderItems();
    if (activeTab === 'profit') renderProfit();
  };

  const showDetail = sale => {
    const normalizedSale = normalizeReceiptSale(sale);
    const hpp = saleCost(normalizedSale);
    const profit = normalizedSale.total - hpp;

    ctx.dialog(
      `Detail Nota ${normalizedSale.invoice}`,
      `
        <div class="sales-report-note-detail">
          <div class="grid two">
            <div>
              <p><strong>Cabang:</strong> ${escapeHTML(normalizedSale.branchName)}</p>
              <p><strong>Kasir:</strong> ${escapeHTML(normalizedSale.cashierName)}</p>
              <p><strong>Pelanggan:</strong> ${escapeHTML(normalizedSale.customerName || 'Umum')}</p>
            </div>

            <div>
              <p><strong>Waktu:</strong> ${dateTime(normalizedSale.createdAt)}</p>
              <p><strong>Pembayaran:</strong> ${escapeHTML(normalizedSale.paymentMethod)}</p>
              <p><strong>Pesanan:</strong> ${escapeHTML(normalizedSale.orderType)}</p>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Harga</th>
                  <th>Jumlah</th>
                  <th>HPP</th>
                </tr>
              </thead>
              <tbody>
                ${normalizedSale.items.map(item => `
                  <tr>
                    <td>${escapeHTML(item.name)}</td>
                    <td>${item.qty}</td>
                    <td>${rupiah(item.price)}</td>
                    <td>${rupiah(item.qty * item.price)}</td>
                    <td>${rupiah(item.qty * item.cost)}</td>
                  </tr>
                `).join('')
                || '<tr><td colspan="5">Tidak ada rincian item.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="sales-report-note-summary">
            <div class="summary-row">
              <span>Subtotal</span>
              <strong>${rupiah(normalizedSale.subtotal)}</strong>
            </div>
            <div class="summary-row">
              <span>Ongkir</span>
              <strong>${rupiah(normalizedSale.shipping)}</strong>
            </div>
            <div class="summary-row">
              <span>Styrofoam</span>
              <strong>${rupiah(normalizedSale.styrofoamTotal)}</strong>
            </div>
            <div class="summary-row">
              <span>Diskon</span>
              <strong>-${rupiah(normalizedSale.discount)}</strong>
            </div>
            <div class="summary-row total">
              <span>Total</span>
              <strong>${rupiah(normalizedSale.total)}</strong>
            </div>
            <div class="summary-row">
              <span>HPP</span>
              <strong>${rupiah(hpp)}</strong>
            </div>
            <div class="summary-row">
              <span>Laba kotor nota</span>
              <strong class="${profit < 0 ? 'sales-report-loss' : 'sales-report-profit'}">
                ${rupiah(profit)}
              </strong>
            </div>
          </div>
        </div>
      `,
      `
        <button type="button" id="salesDetailClose" class="secondary-button">
          Tutup
        </button>
        <button type="button" id="salesDetailPrint" class="primary-button">
          Cetak Ulang Nota
        </button>
      `
    );

    document.querySelector('#salesDetailClose').onclick = () => {
      document.querySelector('#appDialog').close();
    };

    document.querySelector('#salesDetailPrint').onclick = () => {
      try {
        printReceipt(normalizedSale);
      } catch (error) {
        ctx.notify(error.message || 'Nota gagal dicetak.', 'error');
      }
    };
  };

  const printTab = () => {
    const area = content.querySelector('#salesReportPrintArea');
    if (!area) return;

    const clone = area.cloneNode(true);
    clone.querySelectorAll(
      '.sales-report-no-print, button, input, select'
    ).forEach(element => element.remove());

    const popup = window.open('', '_blank', 'width=1100,height=780');

    if (!popup) {
      ctx.notify(
        'Pop-up diblokir. Izinkan pop-up untuk mencetak laporan.',
        'error'
      );
      return;
    }

    popup.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Laporan Penjualan</title>
          <style>
            @page{size:A4 landscape;margin:10mm}
            body{font:11px Arial,sans-serif;color:#111;margin:0}
            h1,h2,h3,p{margin:0 0 8px}
            .sales-report-print-header{margin-bottom:14px;border-bottom:2px solid #222;padding-bottom:8px}
            .grid{display:grid;gap:10px}
            .cards{grid-template-columns:repeat(4,1fr)}
            .two{grid-template-columns:repeat(2,1fr)}
            .card{border:1px solid #aaa;border-radius:7px;padding:10px;break-inside:avoid;margin-bottom:10px}
            .metric-card span,.metric-card small{display:block}
            .metric-card strong{display:block;font-size:18px;margin:5px 0}
            table{width:100%;border-collapse:collapse;font-size:10px}
            th,td{border:1px solid #999;padding:5px;text-align:left;vertical-align:top}
            th{background:#eee}
            .summary-row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:5px 0}
            .total{font-weight:bold}
            .sales-report-profit,.sales-report-loss{font-weight:bold}
            small,.muted{color:#444}
          </style>
        </head>
        <body>
          ${clone.outerHTML}
          <script>onload=()=>setTimeout(()=>print(),250)</script>
        </body>
      </html>`);

    popup.document.close();
  };

  const exportTab = () => {
    const start = host.querySelector('#salesReportStart').value;
    const end = host.querySelector('#salesReportEnd').value;
    const suffix = `${start}-sd-${end}`;

    if (activeTab === 'summary') {
      const data = dailySales(filteredSales);
      const headers = [
        'tanggal',
        'jumlah_nota',
        'qty_item',
        'penjualan_item',
        'diskon',
        'ongkir_styrofoam',
        'omzet',
        'hpp',
        'laba_kotor'
      ];

      const csv = [
        headers.join(','),
        ...data.map(row => [
          row.date,
          row.invoices,
          row.qty,
          row.grossItems,
          row.discount,
          row.extra,
          row.omzet,
          row.hpp,
          row.grossProfit
        ].map(csvCell).join(','))
      ].join('\n');

      download(`ringkasan-penjualan-${suffix}.csv`, csv, 'text/csv');
      return;
    }

    if (activeTab === 'notes') {
      const headers = [
        'tanggal',
        'invoice',
        'cabang',
        'kasir',
        'pelanggan',
        'jenis_pesanan',
        'pembayaran',
        'qty_item',
        'subtotal',
        'diskon',
        'tambahan',
        'total',
        'hpp',
        'laba_kotor'
      ];

      const csv = [
        headers.join(','),
        ...noteResults().map(sale => [
          saleDate(sale),
          sale.invoice,
          sale.branchName || sale.branchId,
          sale.cashierName,
          sale.customerName,
          sale.orderType || sale.tipePesanan,
          sale.paymentMethod,
          saleQty(sale),
          saleSubtotal(sale),
          saleDiscount(sale),
          saleExtra(sale),
          saleTotal(sale),
          saleCost(sale),
          saleTotal(sale) - saleCost(sale)
        ].map(csvCell).join(','))
      ].join('\n');

      download(`penjualan-per-nota-${suffix}.csv`, csv, 'text/csv');
      return;
    }

    const headers = [
      'id',
      'item',
      'kategori',
      'satuan',
      'qty',
      'jumlah_nota',
      'rata_harga',
      'penjualan_kotor',
      'bagian_diskon',
      'penjualan_bersih',
      'hpp',
      'laba_kotor',
      'margin_persen',
      'hpp_kosong'
    ];

    const csv = [
      headers.join(','),
      ...itemResults().map(item => [
        item.id,
        item.name,
        item.category,
        item.unit,
        item.qty,
        item.invoiceCount,
        item.averagePrice,
        item.grossRevenue,
        item.discountShare,
        item.netRevenue,
        item.cost,
        item.profit,
        item.margin.toFixed(2),
        item.missingCost
      ].map(csvCell).join(','))
    ].join('\n');

    download(
      activeTab === 'profit'
        ? `laba-per-item-${suffix}.csv`
        : `penjualan-per-item-${suffix}.csv`,
      csv,
      'text/csv'
    );
  };

  const delayedNoteSearch = debounce(value => {
    noteSearch = value;
    notePage = 1;
    renderNotes();

    requestAnimationFrame(() => {
      const input = host.querySelector('#salesNoteSearch');
      if (!input) return;

      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  const delayedItemSearch = debounce(value => {
    itemSearch = value;
    itemPage = 1;
    renderItems();

    requestAnimationFrame(() => {
      const input = host.querySelector('#salesItemSearch');
      if (!input) return;

      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  host.addEventListener('click', event => {
    const tab = event.target.closest('[data-sales-tab]');

    if (tab) {
      activeTab = tab.dataset.salesTab;
      renderActive();
      return;
    }

    if (event.target.closest('#salesReportReload')) {
      ctx.refreshData?.(['sales']);
      return;
    }

    if (event.target.closest('#salesReportExport')) {
      exportTab();
      return;
    }

    if (event.target.closest('#salesReportPrint')) {
      printTab();
      return;
    }

    if (event.target.closest('#salesNotePrev')) {
      notePage--;
      renderNotes();
      return;
    }

    if (event.target.closest('#salesNoteNext')) {
      notePage++;
      renderNotes();
      return;
    }

    if (event.target.closest('#salesItemPrev')) {
      itemPage--;
      renderItems();
      return;
    }

    if (event.target.closest('#salesItemNext')) {
      itemPage++;
      renderItems();
      return;
    }

    const printButton = event.target.closest('[data-sale-print]');
    const detailButton = event.target.closest('[data-sale-detail]');

    if (printButton || detailButton) {
      const data = noteResults();
      const index = number(
        printButton
          ? printButton.dataset.salePrint
          : detailButton.dataset.saleDetail
      );

      const sale = data[index];
      if (!sale) return;

      if (printButton) {
        try {
          printReceipt(normalizeReceiptSale(sale));
        } catch (error) {
          ctx.notify(error.message || 'Nota gagal dicetak.', 'error');
        }
      } else {
        showDetail(sale);
      }
    }
  });

  host.addEventListener('change', event => {
    if (event.target.id === 'salesReportPreset') {
      if (event.target.value === 'custom') return;

      const range = presetRange(event.target.value);
      host.querySelector('#salesReportStart').value = range.start;
      host.querySelector('#salesReportEnd').value = range.end;
      applyFilters();
      return;
    }

    if (
      event.target.id === 'salesReportStart'
      || event.target.id === 'salesReportEnd'
    ) {
      host.querySelector('#salesReportPreset').value = 'custom';
      applyFilters();
      return;
    }

    if (
      event.target.id === 'salesReportCashier'
      || event.target.id === 'salesReportPayment'
      || event.target.id === 'salesReportOrder'
    ) {
      applyFilters();
    }
  });

  host.addEventListener('input', event => {
    if (event.target.id === 'salesNoteSearch') {
      delayedNoteSearch(event.target.value);
    }

    if (event.target.id === 'salesItemSearch') {
      delayedItemSearch(event.target.value);
    }
  });

  applyFilters();
}
