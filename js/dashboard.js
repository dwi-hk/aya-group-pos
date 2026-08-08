import { getOnce, stockForBranch } from './store.js';
import { getCachedProducts, productBelongsToBranch } from './product-cache.js';
import { rupiah, toArray, sum, escapeHTML } from './utils.js';

function flattenSales(value) {
  return Object.entries(value || {}).flatMap(([branchId, rows]) =>
    toArray(rows).map(row => ({
      ...row,
      branchId: row.branchId || branchId
    }))
  );
}

export async function renderDashboard(ctx) {
  // Angka utama ditampilkan lebih dulu. Produk yang jumlahnya ribuan
  // dimuat setelah kerangka Dashboard sudah terlihat.
  const [salesRaw, operationsRaw, debtsRaw] = await Promise.all([
    getOnce('sales'),
    getOnce('operations'),
    getOnce('debts')
  ]);

  const allSales = flattenSales(salesRaw);
  const sales = ctx.branch.id === 'all'
    ? allSales
    : allSales.filter(sale => sale.branchId === ctx.branch.id);

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const todaySales = sales.filter(sale =>
    new Date(sale.createdAt).toISOString().slice(0, 10) === today
  );

  const monthSales = sales.filter(sale =>
    new Date(sale.createdAt).toISOString().slice(0, 7) === month
  );

  const operations = Object.entries(operationsRaw || {}).flatMap(([branchId, rows]) =>
    toArray(rows).map(row => ({ ...row, branchId }))
  );

  const monthOperations = sum(
    operations.filter(operation => (
      (ctx.branch.id === 'all' || operation.branchId === ctx.branch.id)
      && String(operation.date || '').startsWith(month)
    )),
    operation => operation.total
  );

  const receivable = sum(
    toArray(debtsRaw),
    debt => debt.status === 'paid' ? 0 : debt.remaining ?? debt.amount
  );

  ctx.host.innerHTML = `
    <div class="grid cards">
      <article class="card metric-card accent">
        <span>Omzet Hari Ini</span>
        <strong>${rupiah(sum(todaySales, sale => sale.total))}</strong>
        <small>${todaySales.length} transaksi</small>
      </article>
      <article class="card metric-card">
        <span>Omzet Bulan Ini</span>
        <strong>${rupiah(sum(monthSales, sale => sale.total))}</strong>
        <small>Sebelum operasional</small>
      </article>
      <article class="card metric-card">
        <span>Operasional Bulan Ini</span>
        <strong>${rupiah(monthOperations)}</strong>
        <small>Tercatat per cabang</small>
      </article>
      <article class="card metric-card">
        <span>Piutang Berjalan</span>
        <strong>${rupiah(receivable)}</strong>
        <small>Belum lunas</small>
      </article>
    </div>

    <div class="grid two" style="margin-top:16px">
      <article class="card">
        <div class="toolbar">
          <div>
            <h2>Omzet 7 Hari</h2>
            <p class="muted">Transaksi kasir tersimpan</p>
          </div>
          <button class="secondary-button" data-action="print">Cetak</button>
        </div>
        <canvas id="revenueChart" class="chart" width="900" height="260"></canvas>
      </article>

      <article class="card">
        <div class="toolbar">
          <div>
            <h2>Notifikasi Stok</h2>
            <p class="muted">Barang mencapai stok minimum</p>
          </div>
          <span id="lowStockBadge" class="badge">Memuat…</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Barang</th><th>Stok</th><th>Minimum</th></tr>
            </thead>
            <tbody id="lowStockRows">
              <tr><td colspan="3">Memuat data stok tanpa menghambat Dashboard…</td></tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>

    <div class="grid two" style="margin-top:16px">
      <article class="card"><h2>Produk Terlaris</h2><div id="bestSeller"></div></article>
      <article class="card"><h2>Ringkasan Pembayaran</h2><div id="paymentSummary"></div></article>
    </div>`;

  const byItem = {};
  sales.flatMap(sale => sale.items || []).forEach(item => {
    byItem[item.name] = (byItem[item.name] || 0) + Number(item.qty || 0);
  });

  document.querySelector('#bestSeller').innerHTML = (
    Object.entries(byItem)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, qty], index) => `
        <div class="summary-row">
          <span>${index + 1}. ${escapeHTML(name)}</span>
          <strong>${qty}</strong>
        </div>`).join('')
    || '<p class="muted">Belum ada penjualan.</p>'
  );

  const byPayment = {};
  sales.forEach(sale => {
    const method = sale.paymentMethod || 'LAINNYA';
    byPayment[method] = (byPayment[method] || 0) + Number(sale.total || 0);
  });

  document.querySelector('#paymentSummary').innerHTML = (
    Object.entries(byPayment)
      .map(([method, value]) => `
        <div class="summary-row">
          <span>${escapeHTML(method)}</span>
          <strong>${rupiah(value)}</strong>
        </div>`).join('')
    || '<p class="muted">Belum ada data.</p>'
  );

  drawChart(document.querySelector('#revenueChart'), sales);
  ctx.host.querySelector('[data-action="print"]').onclick = () => window.print();

  // Proses berat dipindahkan ke belakang agar halaman utama cepat terlihat.
  getCachedProducts()
    .then(products => {
      if (!document.querySelector('#lowStockRows')) return;

      const branchProducts = products
        .filter(product => productBelongsToBranch(product, ctx.branch.id))
        .map(product => ({
          ...product,
          stock: stockForBranch(product, ctx.branch.id)
        }));

      const lowStock = branchProducts.filter(product =>
        Number(product.stock) <= Number(product.minStock ?? 0)
      );

      document.querySelector('#lowStockBadge').textContent = `${lowStock.length} item`;
      document.querySelector('#lowStockRows').innerHTML = (
        lowStock.slice(0, 12).map(product => `
          <tr>
            <td>${escapeHTML(product.name)}</td>
            <td class="danger-text">${product.stock} ${escapeHTML(product.unit)}</td>
            <td>${product.minStock}</td>
          </tr>`).join('')
        || '<tr><td colspan="3">Stok aman.</td></tr>'
      );
    })
    .catch(error => {
      const badge = document.querySelector('#lowStockBadge');
      const rows = document.querySelector('#lowStockRows');
      if (badge) badge.textContent = 'Gagal';
      if (rows) {
        rows.innerHTML = `<tr><td colspan="3">${escapeHTML(error.message || 'Data stok gagal dimuat.')}</td></tr>`;
      }
    });
}

function drawChart(canvas, sales) {
  const context = canvas.getContext('2d');
  const days = [];

  for (let index = 6; index >= 0; index--) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    days.push(date.toISOString().slice(0, 10));
  }

  const values = days.map(day => sum(
    sales.filter(sale =>
      new Date(sale.createdAt).toISOString().slice(0, 10) === day
    ),
    sale => sale.total
  ));

  const maximum = Math.max(...values, 1);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#343842';
  context.fillStyle = '#aeb3bd';
  context.font = '14px sans-serif';

  values.forEach((value, index) => {
    const x = 50 + index * 120;
    const height = (value / maximum) * 170;
    const y = 210 - height;

    context.fillStyle = '#f57c00';
    context.fillRect(x, y, 64, height);
    context.fillStyle = '#aeb3bd';
    context.fillText(days[index].slice(5), x, 235);
    context.fillText(`${Math.round(value / 1000)}k`, x, y - 8);
  });
}
