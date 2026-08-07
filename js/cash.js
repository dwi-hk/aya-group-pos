import { getOnce, pushData } from './store.js';
import { rupiah, escapeHTML, toArray, sum, number, csvCell, download, dateTime } from './utils.js';
import { audit } from './audit.js';

const METHODS = ['TUNAI', 'QRIS', 'HUTANG', 'PERSONAL'];

function localISO(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = item => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rowDate(row = {}) {
  return String(row.date || row.tanggalISO || localISO(row.createdAt || row.timestamp || row.iso));
}

function flattenByBranch(value) {
  return Object.entries(value || {}).flatMap(([branchId, rows]) =>
    toArray(rows).map(row => ({ ...row, branchId: row.branchId || branchId }))
  );
}

function flattenNested(value) {
  const result = [];
  for (const [outerId, outerValue] of Object.entries(value || {})) {
    if (!outerValue || typeof outerValue !== 'object') continue;
    if ('amount' in outerValue || 'nominal' in outerValue || 'createdAt' in outerValue) {
      result.push({ id: outerId, ...outerValue });
      continue;
    }
    for (const [id, row] of Object.entries(outerValue)) {
      if (row && typeof row === 'object') result.push({ id, parentId: outerId, ...row });
    }
  }
  return result;
}

function methodOf(row = {}) {
  const raw = String(row.paymentMethod || row.method || row.metodePembayaran || row.metode || 'TUNAI').toUpperCase();
  return raw === 'KONSUMSI' ? 'PERSONAL' : raw;
}

function branchMatches(row, branchId) {
  return branchId === 'all' || !row.branchId || row.branchId === branchId;
}

function inRange(row, start, end) {
  const date = rowDate(row);
  return date && date >= start && date <= end;
}

function statusFor(variance, hasActual) {
  if (!hasActual) return { key: 'pending', label: 'Belum dihitung', className: 'warning' };
  if (variance === 0) return { key: 'match', label: 'Cocok', className: 'success' };
  if (variance > 0) return { key: 'over', label: `Lebih ${rupiah(variance)}`, className: 'warning' };
  return { key: 'short', label: `Kurang ${rupiah(Math.abs(variance))}`, className: 'danger' };
}

function calculate({ sales, purchases, operations, capital, debtPayments, debts, settings, branchId, start, end }) {
  const filteredSales = sales.filter(row => branchMatches(row, branchId) && inRange(row, start, end));
  const filteredPurchases = purchases.filter(row => branchMatches(row, branchId) && inRange(row, start, end));
  const filteredOperations = operations.filter(row => branchMatches(row, branchId) && inRange(row, start, end));
  const filteredCapital = capital.filter(row => branchMatches(row, branchId) && inRange(row, start, end));
  const debtsById = new Map(debts.map(row => [String(row.id), row]));
  const filteredDebtPayments = debtPayments
    .map(row => {
      const debt = debtsById.get(String(row.debtId || row.parentId)) || {};
      return {
        ...row,
        branchId: row.branchId || debt.branchId,
        debtType: row.debtType || debt.type,
        paymentMethod: methodOf(row),
        amount: number(row.amount ?? row.nominal)
      };
    })
    .filter(row => branchMatches(row, branchId) && inRange(row, start, end));

  const byPayment = Object.fromEntries(METHODS.map(method => [method, 0]));
  filteredSales.forEach(row => {
    const method = methodOf(row);
    byPayment[method] = (byPayment[method] || 0) + number(row.total);
  });

  const cashSales = byPayment.TUNAI || 0;
  const capitalIn = sum(filteredCapital, row => row.amount ?? row.nominal ?? row.total);
  const cashOperations = sum(filteredOperations.filter(row => methodOf(row) === 'TUNAI'), row => row.total ?? row.biaya ?? row.nominal);
  const cashPurchases = sum(filteredPurchases.filter(row => methodOf(row) === 'TUNAI'), row => row.total);
  const customerDebtCash = sum(filteredDebtPayments.filter(row => row.paymentMethod === 'TUNAI' && row.debtType === 'customer'), row => row.amount);
  const outgoingDebtCash = sum(filteredDebtPayments.filter(row => row.paymentMethod === 'TUNAI' && ['supplier', 'employee'].includes(row.debtType)), row => row.amount);
  const openingCash = branchId === 'all' ? 0 : number(settings?.cashDrawerCapital);
  const expectedCash = openingCash + capitalIn + cashSales + customerDebtCash - cashOperations - cashPurchases - outgoingDebtCash;

  return {
    start,
    end,
    openingCash,
    byPayment,
    cashSales,
    capitalIn,
    customerDebtCash,
    cashOperations,
    cashPurchases,
    outgoingDebtCash,
    expectedCash,
    salesCount: filteredSales.length,
    purchasesCount: filteredPurchases.length,
    operationsCount: filteredOperations.length,
    debtPaymentCount: filteredDebtPayments.length
  };
}

export async function renderCashReport(ctx) {
  const [salesRaw, purchasesRaw, operationsRaw, capitalRaw, settings, closingsRaw, debtPaymentsRaw, debtsRaw] = await Promise.all([
    getOnce('sales'),
    getOnce('purchases'),
    getOnce('operations'),
    getOnce('capital'),
    getOnce('businessSettings'),
    getOnce('cashClosings'),
    getOnce('debtPayments'),
    getOnce('debts')
  ]);

  const data = {
    sales: flattenByBranch(salesRaw),
    purchases: flattenByBranch(purchasesRaw),
    operations: flattenByBranch(operationsRaw),
    capital: toArray(capitalRaw),
    debtPayments: flattenNested(debtPaymentsRaw),
    debts: toArray(debtsRaw),
    settings: settings || {}
  };
  let closings = flattenByBranch(closingsRaw).sort((a, b) => number(b.createdAt) - number(a.createdAt));
  const today = localISO(Date.now());
  let current = null;

  ctx.host.innerHTML = `
    <article class="card">
      <div class="toolbar">
        <div>
          <h2>Laporan KAS & Rekonsiliasi Laci</h2>
          <p class="muted">Hanya pembayaran TUNAI yang menambah kas fisik. QRIS, HUTANG, dan PERSONAL tetap dilaporkan tetapi tidak masuk laci.</p>
        </div>
        <div class="toolbar-group">
          <button id="cashExport" class="secondary-button">Export CSV</button>
          <button id="cashPrint" class="primary-button">Cetak</button>
        </div>
      </div>
      <div class="form-grid">
        <label>Dari Tanggal<input id="cashStart" type="date" value="${today}"></label>
        <label>Sampai Tanggal<input id="cashEnd" type="date" value="${today}"></label>
      </div>
    </article>
    <section id="cashOutput" style="margin-top:16px"></section>`;

  const render = () => {
    const start = document.querySelector('#cashStart').value;
    const end = document.querySelector('#cashEnd').value;
    current = calculate({ ...data, branchId: ctx.branch.id, start, end });
    const matching = closings.find(row =>
      branchMatches(row, ctx.branch.id) && row.startDate === start && row.endDate === end
    );
    const hasActual = matching && matching.actualCash !== undefined && matching.actualCash !== null;
    const actualCash = hasActual ? number(matching.actualCash) : null;
    const variance = hasActual ? actualCash - current.expectedCash : 0;
    const status = statusFor(variance, hasActual);
    const singleBranch = ctx.branch.id !== 'all';
    const history = closings.filter(row => branchMatches(row, ctx.branch.id)).slice(0, 30);

    document.querySelector('#cashOutput').innerHTML = `
      ${!singleBranch ? `<article class="card" style="margin-bottom:16px"><strong>Pilih satu cabang untuk rekonsiliasi kas fisik.</strong><p class="muted" style="margin-bottom:0">Ringkasan metode pembayaran tetap bisa dilihat untuk semua cabang, tetapi modal awal laci dan kas sebenarnya harus dicatat per cabang.</p></article>` : ''}
      <div class="grid cards">
        <article class="card metric-card accent"><span>Kas Sistem / Seharusnya</span><strong>${rupiah(current.expectedCash)}</strong><small>Kas tunai hasil perhitungan</small></article>
        <article class="card metric-card"><span>Kas Fisik Sebenarnya</span><strong>${hasActual ? rupiah(actualCash) : '-'}</strong><small>${hasActual ? `Dicatat ${dateTime(matching.createdAt)}` : 'Belum ada hitung fisik'}</small></article>
        <article class="card metric-card"><span>Selisih Kas</span><strong class="${hasActual ? (variance < 0 ? 'danger-text' : variance > 0 ? '' : 'success-text') : ''}">${hasActual ? rupiah(variance) : '-'}</strong><small>Kas fisik − kas sistem</small></article>
        <article class="card metric-card"><span>Status</span><strong><span class="status ${status.className}">${status.label}</span></strong><small>${hasActual ? (variance === 0 ? 'Tidak ada selisih' : 'Wajib diberi keterangan') : 'Lakukan hitung laci'}</small></article>
      </div>

      <div class="grid two" style="margin-top:16px">
        <article class="card">
          <h2>Metode Pembayaran Penjualan</h2>
          ${METHODS.map(method => `<div class="summary-row"><span>${method}${method === 'TUNAI' ? ' · masuk laci' : ' · tidak masuk laci'}</span><b>${rupiah(current.byPayment[method] || 0)}</b></div>`).join('')}
          <div class="summary-row total"><span>Total seluruh metode</span><b>${rupiah(sum(METHODS, method => current.byPayment[method] || 0))}</b></div>
          <small class="muted">${current.salesCount} nota pada periode terpilih.</small>
        </article>
        <article class="card">
          <h2>Perhitungan Kas Tunai</h2>
          <div class="summary-row"><span>Modal awal laci</span><b>${rupiah(current.openingCash)}</b></div>
          <div class="summary-row"><span>+ Modal tambahan</span><b>${rupiah(current.capitalIn)}</b></div>
          <div class="summary-row"><span>+ Penjualan tunai</span><b>${rupiah(current.cashSales)}</b></div>
          <div class="summary-row"><span>+ Pembayaran hutang pelanggan tunai</span><b>${rupiah(current.customerDebtCash)}</b></div>
          <div class="summary-row"><span>− Operasional tunai</span><b>${rupiah(current.cashOperations)}</b></div>
          <div class="summary-row"><span>− Kulakan tunai</span><b>${rupiah(current.cashPurchases)}</b></div>
          <div class="summary-row"><span>− Bayar supplier/kasbon tunai</span><b>${rupiah(current.outgoingDebtCash)}</b></div>
          <div class="summary-row total"><span>Kas seharusnya</span><b>${rupiah(current.expectedCash)}</b></div>
          <small class="muted">Data lama tanpa metode pembayaran dianggap TUNAI. Ubah transaksi baru ke QRIS/HUTANG/PERSONAL bila memang bukan tunai.</small>
        </article>
      </div>

      <div class="grid two" style="margin-top:16px">
        <article class="card">
          <h2>Hitung Kas Fisik</h2>
          <p class="muted">Masukkan seluruh uang yang benar-benar ada di laci pada akhir periode.</p>
          <form id="cashCountForm" class="form-grid">
            <label class="full">Kas Fisik Sebenarnya<input name="actualCash" inputmode="numeric" placeholder="Contoh: 350000" value="${hasActual ? actualCash : ''}" ${singleBranch ? '' : 'disabled'} required></label>
            <label class="full">Keterangan Selisih<textarea name="notes" placeholder="Contoh: uang lebih karena modal awal belum dicatat, atau kurang karena pengeluaran belum masuk sistem" ${singleBranch ? '' : 'disabled'}>${escapeHTML(matching?.notes || '')}</textarea></label>
            <button class="primary-button full" ${singleBranch ? '' : 'disabled'}>Simpan Rekonsiliasi Kas</button>
          </form>
        </article>
        <article class="card">
          <h2>Keterangan Periode</h2>
          <div class="summary-row"><span>Cabang</span><b>${escapeHTML(ctx.branch.name)}</b></div>
          <div class="summary-row"><span>Periode</span><b>${escapeHTML(start)} s.d. ${escapeHTML(end)}</b></div>
          <div class="summary-row"><span>Nota penjualan</span><b>${current.salesCount}</b></div>
          <div class="summary-row"><span>Kulakan</span><b>${current.purchasesCount}</b></div>
          <div class="summary-row"><span>Operasional</span><b>${current.operationsCount}</b></div>
          <div class="summary-row"><span>Pembayaran hutang/kasbon</span><b>${current.debtPaymentCount}</b></div>
        </article>
      </div>

      <article class="card" style="margin-top:16px">
        <h2>Riwayat Rekonsiliasi Kas</h2>
        <div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Cabang</th><th>Periode</th><th>Kas Sistem</th><th>Kas Fisik</th><th>Selisih</th><th>Status</th><th>Keterangan</th><th>Petugas</th></tr></thead><tbody>
          ${history.map(row => {
            const rowVariance = number(row.variance ?? number(row.actualCash) - number(row.expectedCash));
            const rowStatus = statusFor(rowVariance, true);
            return `<tr><td>${dateTime(row.createdAt)}</td><td>${escapeHTML(row.branchName || row.branchId || '-')}</td><td>${escapeHTML(row.startDate || '-')} s.d. ${escapeHTML(row.endDate || '-')}</td><td>${rupiah(row.expectedCash)}</td><td>${rupiah(row.actualCash)}</td><td class="${rowVariance < 0 ? 'danger-text' : rowVariance === 0 ? 'success-text' : ''}">${rupiah(rowVariance)}</td><td><span class="status ${rowStatus.className}">${rowStatus.label}</span></td><td>${escapeHTML(row.notes || '-')}</td><td>${escapeHTML(row.countedBy || '-')}</td></tr>`;
          }).join('') || '<tr><td colspan="9">Belum ada rekonsiliasi kas.</td></tr>'}
        </tbody></table></div>
      </article>`;

    const form = document.querySelector('#cashCountForm');
    if (form && singleBranch) {
      form.onsubmit = async event => {
        event.preventDefault();
        const actualRaw = new FormData(form).get('actualCash');
        if (String(actualRaw).trim() === '') return ctx.notify('Kas fisik sebenarnya wajib diisi', 'error');
        const actual = number(actualRaw);
        const notes = String(new FormData(form).get('notes') || '').trim();
        const varianceNow = actual - current.expectedCash;
        if (varianceNow !== 0 && !notes) return ctx.notify('Keterangan wajib diisi bila ada selisih kas', 'error');
        const record = {
          branchId: ctx.branch.id,
          branchName: ctx.branch.name,
          startDate: current.start,
          endDate: current.end,
          openingCash: current.openingCash,
          cashSales: current.cashSales,
          qrisSales: current.byPayment.QRIS || 0,
          debtSales: current.byPayment.HUTANG || 0,
          personalSales: current.byPayment.PERSONAL || 0,
          capitalIn: current.capitalIn,
          customerDebtCash: current.customerDebtCash,
          cashOperations: current.cashOperations,
          cashPurchases: current.cashPurchases,
          outgoingDebtCash: current.outgoingDebtCash,
          expectedCash: current.expectedCash,
          actualCash: actual,
          variance: varianceNow,
          status: varianceNow === 0 ? 'match' : varianceNow > 0 ? 'over' : 'short',
          notes,
          countedBy: ctx.user.name,
          countedByUid: ctx.user.uid,
          createdAt: Date.now()
        };
        const result = await pushData(`cashClosings/${ctx.branch.id}`, record);
        closings.unshift({ ...record, id: result.key });
        await audit('CREATE', 'CASH_CLOSING', { branchId: ctx.branch.id, expectedCash: current.expectedCash, actualCash: actual, variance: varianceNow });
        ctx.notify('Rekonsiliasi kas tersimpan');
        render();
      };
    }
  };

  document.querySelector('#cashStart').onchange = render;
  document.querySelector('#cashEnd').onchange = render;
  document.querySelector('#cashPrint').onclick = () => window.print();
  document.querySelector('#cashExport').onclick = () => {
    if (!current) return;
    const rows = [
      ['Cabang', ctx.branch.name],
      ['Dari', current.start],
      ['Sampai', current.end],
      ['Modal awal laci', current.openingCash],
      ['Modal tambahan', current.capitalIn],
      ['Penjualan TUNAI', current.byPayment.TUNAI || 0],
      ['Penjualan QRIS', current.byPayment.QRIS || 0],
      ['Penjualan HUTANG', current.byPayment.HUTANG || 0],
      ['Penjualan PERSONAL', current.byPayment.PERSONAL || 0],
      ['Pembayaran hutang pelanggan tunai', current.customerDebtCash],
      ['Operasional tunai', current.cashOperations],
      ['Kulakan tunai', current.cashPurchases],
      ['Bayar supplier/kasbon tunai', current.outgoingDebtCash],
      ['Kas seharusnya', current.expectedCash]
    ];
    const csv = [['Keterangan', 'Nilai'], ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    download(`laporan-kas-${current.start}-${current.end}.csv`, csv, 'text/csv');
  };
  render();
}
