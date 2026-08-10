import {
  getOnce,
  pushData
} from './store.js';

import {
  rupiah,
  escapeHTML,
  toArray,
  sum,
  number,
  csvCell,
  download,
  dateTime
} from './utils.js';

import { audit } from './audit.js';

const METHODS = ['TUNAI', 'QRIS', 'HUTANG', 'PERSONAL'];
const CAPITAL_METHODS = ['TUNAI', 'TRANSFER BANK', 'QRIS', 'LAINNYA'];

function localISO(value) {
  if (!value) return '';

  if (
    typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return value;
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';

  const pad = item => String(item).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rowDate(row = {}) {
  return String(
    row.date
    || row.tanggalISO
    || localISO(row.createdAt || row.timestamp || row.iso)
  );
}

function flattenByBranch(value) {
  return Object.entries(value || {}).flatMap(([branchId, rows]) =>
    toArray(rows).map(row => ({
      ...row,
      branchId: row.branchId || branchId
    }))
  );
}

function flattenNested(value) {
  const result = [];

  for (const [outerId, outerValue] of Object.entries(value || {})) {
    if (!outerValue || typeof outerValue !== 'object') continue;

    if (
      'amount' in outerValue
      || 'nominal' in outerValue
      || 'createdAt' in outerValue
    ) {
      result.push({
        id: outerId,
        ...outerValue
      });
      continue;
    }

    for (const [id, row] of Object.entries(outerValue)) {
      if (row && typeof row === 'object') {
        result.push({
          id,
          parentId: outerId,
          ...row
        });
      }
    }
  }

  return result;
}

function methodOf(row = {}) {
  const raw = String(
    row.paymentMethod
    || row.method
    || row.metodePembayaran
    || row.metode
    || 'TUNAI'
  ).toUpperCase();

  return raw === 'KONSUMSI' ? 'PERSONAL' : raw;
}

function capitalMethodOf(row = {}) {
  return String(
    row.paymentMethod
    || row.method
    || row.metode
    || 'TUNAI'
  ).toUpperCase();
}

function capitalAmount(row = {}) {
  return number(
    row.amount
    ?? row.nominal
    ?? row.total
    ?? 0
  );
}

function capitalSource(row = {}) {
  return String(
    row.source
    || row.sourceName
    || row.from
    || row.asal
    || row.keteranganSumber
    || 'Tidak dicatat'
  ).trim();
}

function branchMatches(row, branchId) {
  return (
    branchId === 'all'
    || !row.branchId
    || row.branchId === branchId
  );
}

function inRange(row, start, end) {
  const date = rowDate(row);
  return date && date >= start && date <= end;
}

function statusFor(variance, hasActual) {
  if (!hasActual) {
    return {
      key: 'pending',
      label: 'Belum dihitung',
      className: 'warning'
    };
  }

  if (variance === 0) {
    return {
      key: 'match',
      label: 'Cocok',
      className: 'success'
    };
  }

  if (variance > 0) {
    return {
      key: 'over',
      label: `Lebih ${rupiah(variance)}`,
      className: 'warning'
    };
  }

  return {
    key: 'short',
    label: `Kurang ${rupiah(Math.abs(variance))}`,
    className: 'danger'
  };
}

function capitalSummary(rows) {
  const bySource = new Map();
  const byMethod = new Map();

  for (const row of rows) {
    const source = capitalSource(row);
    const method = capitalMethodOf(row);
    const amount = capitalAmount(row);

    bySource.set(
      source,
      (bySource.get(source) || 0) + amount
    );

    byMethod.set(
      method,
      (byMethod.get(method) || 0) + amount
    );
  }

  return {
    bySource: [...bySource.entries()]
      .sort((a, b) => b[1] - a[1]),
    byMethod: [...byMethod.entries()]
      .sort((a, b) => b[1] - a[1])
  };
}

function calculate({
  sales,
  purchases,
  operations,
  capital,
  debtPayments,
  debts,
  settings,
  branchId,
  start,
  end
}) {
  const filteredSales = sales.filter(
    row => branchMatches(row, branchId) && inRange(row, start, end)
  );

  const filteredPurchases = purchases.filter(
    row => branchMatches(row, branchId) && inRange(row, start, end)
  );

  const filteredOperations = operations.filter(
    row => branchMatches(row, branchId) && inRange(row, start, end)
  );

  const filteredCapital = capital
    .filter(row =>
      branchMatches(row, branchId)
      && inRange(row, start, end)
    )
    .sort((a, b) =>
      String(rowDate(b)).localeCompare(String(rowDate(a)))
      || number(b.createdAt) - number(a.createdAt)
    );

  const debtsById = new Map(
    debts.map(row => [String(row.id), row])
  );

  const filteredDebtPayments = debtPayments
    .map(row => {
      const debt = debtsById.get(
        String(row.debtId || row.parentId)
      ) || {};

      return {
        ...row,
        branchId: row.branchId || debt.branchId,
        debtType: row.debtType || debt.type,
        paymentMethod: methodOf(row),
        amount: number(row.amount ?? row.nominal)
      };
    })
    .filter(row =>
      branchMatches(row, branchId)
      && inRange(row, start, end)
    );

  const byPayment = Object.fromEntries(
    METHODS.map(method => [method, 0])
  );

  filteredSales.forEach(row => {
    const method = methodOf(row);

    byPayment[method] =
      (byPayment[method] || 0) + number(row.total);
  });

  const cashSales = byPayment.TUNAI || 0;

  /*
   * v2.11.2:
   * Semua Modal Tambahan dilaporkan, tetapi hanya yang benar-benar
   * masuk TUNAI yang menambah kas fisik/laci.
   * Data lama tanpa metode otomatis dianggap TUNAI.
   */
  const capitalTotal = sum(
    filteredCapital,
    capitalAmount
  );

  const capitalCash = sum(
    filteredCapital.filter(
      row => capitalMethodOf(row) === 'TUNAI'
    ),
    capitalAmount
  );

  const capitalNonCash =
    capitalTotal - capitalCash;

  const cashOperations = sum(
    filteredOperations.filter(
      row => methodOf(row) === 'TUNAI'
    ),
    row =>
      row.total
      ?? row.biaya
      ?? row.nominal
  );

  const cashPurchases = sum(
    filteredPurchases.filter(
      row => methodOf(row) === 'TUNAI'
    ),
    row => row.total
  );

  const customerDebtCash = sum(
    filteredDebtPayments.filter(
      row =>
        row.paymentMethod === 'TUNAI'
        && row.debtType === 'customer'
    ),
    row => row.amount
  );

  const outgoingDebtCash = sum(
    filteredDebtPayments.filter(
      row =>
        row.paymentMethod === 'TUNAI'
        && ['supplier', 'employee'].includes(row.debtType)
    ),
    row => row.amount
  );

  const openingCash =
    branchId === 'all'
      ? 0
      : number(settings?.cashDrawerCapital);

  const expectedCash =
    openingCash
    + capitalCash
    + cashSales
    + customerDebtCash
    - cashOperations
    - cashPurchases
    - outgoingDebtCash;

  return {
    start,
    end,
    openingCash,
    byPayment,
    cashSales,

    // kompatibilitas nama lama:
    capitalIn: capitalCash,

    capitalTotal,
    capitalCash,
    capitalNonCash,
    capitalRows: filteredCapital,

    customerDebtCash,
    cashOperations,
    cashPurchases,
    outgoingDebtCash,
    expectedCash,

    salesCount: filteredSales.length,
    purchasesCount: filteredPurchases.length,
    operationsCount: filteredOperations.length,
    capitalCount: filteredCapital.length,
    debtPaymentCount: filteredDebtPayments.length
  };
}

export async function renderCashReport(ctx) {
  const [
    salesRaw,
    purchasesRaw,
    operationsRaw,
    capitalRaw,
    settings,
    closingsRaw,
    debtPaymentsRaw,
    debtsRaw
  ] = await Promise.all([
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

  let closings = flattenByBranch(closingsRaw)
    .sort((a, b) =>
      number(b.createdAt) - number(a.createdAt)
    );

  const today = localISO(Date.now());
  let current = null;
  let savingCapital = false;

  ctx.host.innerHTML = `
    <article class="card">
      <div class="toolbar">
        <div>
          <h2>Laporan KAS & Rekonsiliasi Laci</h2>
          <p class="muted">
            Hanya pembayaran TUNAI yang menambah kas fisik.
            QRIS, HUTANG, PERSONAL, dan modal non-tunai tetap dilaporkan
            tetapi tidak masuk laci.
          </p>
        </div>

        <div class="toolbar-group">
          <button id="cashExport" class="secondary-button">
            Export CSV
          </button>

          <button id="cashPrint" class="primary-button">
            Cetak
          </button>
        </div>
      </div>

      <div class="form-grid">
        <label>
          Dari Tanggal
          <input
            id="cashStart"
            type="date"
            value="${today}"
          >
        </label>

        <label>
          Sampai Tanggal
          <input
            id="cashEnd"
            type="date"
            value="${today}"
          >
        </label>
      </div>
    </article>

    <section
      id="cashOutput"
      style="margin-top:16px"
    ></section>
  `;

  const render = () => {
    const start =
      ctx.host.querySelector('#cashStart').value;

    const end =
      ctx.host.querySelector('#cashEnd').value;

    current = calculate({
      ...data,
      branchId: ctx.branch.id,
      start,
      end
    });

    const matching = closings.find(row =>
      branchMatches(row, ctx.branch.id)
      && row.startDate === start
      && row.endDate === end
    );

    const hasActual = (
      matching
      && matching.actualCash !== undefined
      && matching.actualCash !== null
    );

    const actualCash = hasActual
      ? number(matching.actualCash)
      : null;

    const variance = hasActual
      ? actualCash - current.expectedCash
      : 0;

    const status =
      statusFor(variance, hasActual);

    const singleBranch =
      ctx.branch.id !== 'all';

    const history = closings
      .filter(row =>
        branchMatches(row, ctx.branch.id)
      )
      .slice(0, 30);

    const capitalStats =
      capitalSummary(current.capitalRows);

    ctx.host.querySelector('#cashOutput').innerHTML = `
      ${!singleBranch ? `
        <article
          class="card"
          style="margin-bottom:16px"
        >
          <strong>
            Pilih satu cabang untuk rekonsiliasi dan menambah modal.
          </strong>

          <p class="muted" style="margin-bottom:0">
            Ringkasan tetap bisa dilihat untuk semua cabang,
            tetapi modal dan kas fisik harus dicatat per cabang.
          </p>
        </article>
      ` : ''}

      <div class="grid cards">
        <article class="card metric-card accent">
          <span>Kas Sistem / Seharusnya</span>
          <strong>${rupiah(current.expectedCash)}</strong>
          <small>Kas tunai hasil perhitungan</small>
        </article>

        <article class="card metric-card">
          <span>Kas Fisik Sebenarnya</span>
          <strong>
            ${hasActual ? rupiah(actualCash) : '-'}
          </strong>
          <small>
            ${hasActual
              ? `Dicatat ${dateTime(matching.createdAt)}`
              : 'Belum ada hitung fisik'}
          </small>
        </article>

        <article class="card metric-card">
          <span>Selisih Kas</span>
          <strong class="${
            hasActual
              ? (
                  variance < 0
                    ? 'danger-text'
                    : variance > 0
                      ? ''
                      : 'success-text'
                )
              : ''
          }">
            ${hasActual ? rupiah(variance) : '-'}
          </strong>
          <small>Kas fisik − kas sistem</small>
        </article>

        <article class="card metric-card">
          <span>Status</span>
          <strong>
            <span class="status ${status.className}">
              ${status.label}
            </span>
          </strong>
          <small>
            ${hasActual
              ? (
                  variance === 0
                    ? 'Tidak ada selisih'
                    : 'Wajib diberi keterangan'
                )
              : 'Lakukan hitung laci'}
          </small>
        </article>
      </div>

      <div class="grid two" style="margin-top:16px">
        <article class="card">
          <h2>Metode Pembayaran Penjualan</h2>

          ${METHODS.map(method => `
            <div class="summary-row">
              <span>
                ${method}
                ${method === 'TUNAI'
                  ? ' · masuk laci'
                  : ' · tidak masuk laci'}
              </span>
              <b>
                ${rupiah(
                  current.byPayment[method] || 0
                )}
              </b>
            </div>
          `).join('')}

          <div class="summary-row total">
            <span>Total seluruh metode</span>
            <b>
              ${rupiah(
                sum(
                  METHODS,
                  method =>
                    current.byPayment[method] || 0
                )
              )}
            </b>
          </div>

          <small class="muted">
            ${current.salesCount} nota pada periode terpilih.
          </small>
        </article>

        <article class="card">
          <h2>Perhitungan Kas Tunai</h2>

          <div class="summary-row">
            <span>Modal awal laci</span>
            <b>${rupiah(current.openingCash)}</b>
          </div>

          <div class="summary-row">
            <span>+ Modal tambahan TUNAI</span>
            <b>${rupiah(current.capitalCash)}</b>
          </div>

          <div class="summary-row">
            <span>+ Penjualan tunai</span>
            <b>${rupiah(current.cashSales)}</b>
          </div>

          <div class="summary-row">
            <span>
              + Pembayaran hutang pelanggan tunai
            </span>
            <b>${rupiah(current.customerDebtCash)}</b>
          </div>

          <div class="summary-row">
            <span>− Operasional tunai</span>
            <b>${rupiah(current.cashOperations)}</b>
          </div>

          <div class="summary-row">
            <span>− Kulakan tunai</span>
            <b>${rupiah(current.cashPurchases)}</b>
          </div>

          <div class="summary-row">
            <span>− Bayar supplier/kasbon tunai</span>
            <b>${rupiah(current.outgoingDebtCash)}</b>
          </div>

          <div class="summary-row total">
            <span>Kas seharusnya</span>
            <b>${rupiah(current.expectedCash)}</b>
          </div>

          <small class="muted">
            Modal non-tunai tetap ada di Laporan Modal,
            tetapi tidak menambah uang fisik di laci.
            Data modal lama tanpa metode dianggap TUNAI.
          </small>
        </article>
      </div>

      <div class="grid two" style="margin-top:16px">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2>+ Modal Tambahan</h2>
              <p class="muted">
                Catat asal modal, nominal, dan cara modal masuk.
              </p>
            </div>

            <span class="badge">
              ${escapeHTML(ctx.branch.name)}
            </span>
          </div>

          <form
            id="capitalForm"
            class="form-grid"
          >
            <label>
              Tanggal Modal Masuk
              <input
                name="date"
                type="date"
                value="${today}"
                required
                ${singleBranch ? '' : 'disabled'}
              >
            </label>

            <label>
              Sumber Modal
              <input
                name="source"
                placeholder="Contoh: Owner / Dwi / Pinjaman / Investor"
                required
                ${singleBranch ? '' : 'disabled'}
              >
            </label>

            <label>
              Nominal Modal
              <input
                name="amount"
                inputmode="numeric"
                placeholder="Contoh: 500000"
                required
                ${singleBranch ? '' : 'disabled'}
              >
            </label>

            <label>
              Modal Masuk Melalui
              <select
                name="paymentMethod"
                ${singleBranch ? '' : 'disabled'}
              >
                ${CAPITAL_METHODS.map(method => `
                  <option value="${method}">
                    ${method}
                  </option>
                `).join('')}
              </select>
            </label>

            <label class="full">
              Keterangan
              <textarea
                name="notes"
                placeholder="Contoh: tambahan modal belanja bahan / uang pribadi owner"
                ${singleBranch ? '' : 'disabled'}
              ></textarea>
            </label>

            <button
              id="saveCapital"
              class="primary-button full"
              ${singleBranch ? '' : 'disabled'}
            >
              Simpan Modal Tambahan
            </button>
          </form>

          <p class="muted" style="margin-top:10px">
            Modal Tambahan <strong>bukan omzet</strong> dan
            tidak dihitung sebagai laba usaha.
          </p>
        </article>

        <article class="card">
          <h2>Ringkasan Modal Periode</h2>

          <div class="summary-row">
            <span>Total Modal Tambahan</span>
            <strong>${rupiah(current.capitalTotal)}</strong>
          </div>

          <div class="summary-row">
            <span>Modal TUNAI · masuk laci</span>
            <strong>${rupiah(current.capitalCash)}</strong>
          </div>

          <div class="summary-row">
            <span>Modal Non-Tunai</span>
            <strong>${rupiah(current.capitalNonCash)}</strong>
          </div>

          <div class="summary-row">
            <span>Jumlah Setoran Modal</span>
            <strong>${current.capitalCount}</strong>
          </div>

          <h3 style="margin-top:16px">
            Berdasarkan Sumber Modal
          </h3>

          ${capitalStats.bySource.map(
            ([source, amount]) => `
              <div class="summary-row">
                <span>${escapeHTML(source)}</span>
                <strong>${rupiah(amount)}</strong>
              </div>
            `
          ).join('') || `
            <p class="muted">
              Belum ada modal tambahan pada periode ini.
            </p>
          `}

          <h3 style="margin-top:16px">
            Berdasarkan Cara Masuk
          </h3>

          ${capitalStats.byMethod.map(
            ([method, amount]) => `
              <div class="summary-row">
                <span>${escapeHTML(method)}</span>
                <strong>${rupiah(amount)}</strong>
              </div>
            `
          ).join('') || `
            <p class="muted">
              Belum ada data metode modal.
            </p>
          `}
        </article>
      </div>

      <article class="card" style="margin-top:16px">
        <div class="toolbar">
          <div>
            <h2>Laporan Modal Tambahan Per Periode</h2>
            <p class="muted">
              ${escapeHTML(start)}
              s.d.
              ${escapeHTML(end)}
            </p>
          </div>

          <button
            id="capitalExport"
            class="secondary-button"
          >
            Export Modal CSV
          </button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Sumber Modal</th>
                <th>Metode Masuk</th>
                <th>Nominal</th>
                <th>Masuk Laci?</th>
                <th>Keterangan</th>
                <th>Dicatat Oleh</th>
              </tr>
            </thead>

            <tbody>
              ${current.capitalRows.map(row => `
                <tr>
                  <td>${escapeHTML(rowDate(row) || '-')}</td>
                  <td>
                    <strong>
                      ${escapeHTML(capitalSource(row))}
                    </strong>
                  </td>
                  <td>
                    ${escapeHTML(capitalMethodOf(row))}
                  </td>
                  <td>
                    ${rupiah(capitalAmount(row))}
                  </td>
                  <td>
                    ${
                      capitalMethodOf(row) === 'TUNAI'
                        ? '<span class="status success">YA</span>'
                        : '<span class="status warning">TIDAK</span>'
                    }
                  </td>
                  <td>
                    ${escapeHTML(row.notes || row.keterangan || '-')}
                  </td>
                  <td>
                    ${escapeHTML(row.createdBy || row.inputBy || '-')}
                  </td>
                </tr>
              `).join('') || `
                <tr>
                  <td colspan="7">
                    Belum ada Modal Tambahan pada periode ini.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </article>

      <div class="grid two" style="margin-top:16px">
        <article class="card">
          <h2>Hitung Kas Fisik</h2>

          <p class="muted">
            Masukkan seluruh uang yang benar-benar ada
            di laci pada akhir periode.
          </p>

          <form
            id="cashCountForm"
            class="form-grid"
          >
            <label class="full">
              Kas Fisik Sebenarnya
              <input
                name="actualCash"
                inputmode="numeric"
                placeholder="Contoh: 350000"
                value="${hasActual ? actualCash : ''}"
                ${singleBranch ? '' : 'disabled'}
                required
              >
            </label>

            <label class="full">
              Keterangan Selisih
              <textarea
                name="notes"
                placeholder="Contoh: uang lebih karena modal belum dicatat, atau pengeluaran belum masuk sistem"
                ${singleBranch ? '' : 'disabled'}
              >${escapeHTML(matching?.notes || '')}</textarea>
            </label>

            <button
              class="primary-button full"
              ${singleBranch ? '' : 'disabled'}
            >
              Simpan Rekonsiliasi Kas
            </button>
          </form>
        </article>

        <article class="card">
          <h2>Keterangan Periode</h2>

          <div class="summary-row">
            <span>Cabang</span>
            <b>${escapeHTML(ctx.branch.name)}</b>
          </div>

          <div class="summary-row">
            <span>Periode</span>
            <b>
              ${escapeHTML(start)}
              s.d.
              ${escapeHTML(end)}
            </b>
          </div>

          <div class="summary-row">
            <span>Nota penjualan</span>
            <b>${current.salesCount}</b>
          </div>

          <div class="summary-row">
            <span>Kulakan</span>
            <b>${current.purchasesCount}</b>
          </div>

          <div class="summary-row">
            <span>Operasional</span>
            <b>${current.operationsCount}</b>
          </div>

          <div class="summary-row">
            <span>Modal Tambahan</span>
            <b>${current.capitalCount}</b>
          </div>

          <div class="summary-row">
            <span>Pembayaran hutang/kasbon</span>
            <b>${current.debtPaymentCount}</b>
          </div>
        </article>
      </div>

      <article class="card" style="margin-top:16px">
        <h2>Riwayat Rekonsiliasi Kas</h2>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Cabang</th>
                <th>Periode</th>
                <th>Kas Sistem</th>
                <th>Kas Fisik</th>
                <th>Selisih</th>
                <th>Status</th>
                <th>Keterangan</th>
                <th>Petugas</th>
              </tr>
            </thead>

            <tbody>
              ${history.map(row => {
                const rowVariance = number(
                  row.variance
                  ?? number(row.actualCash) - number(row.expectedCash)
                );

                const rowStatus =
                  statusFor(rowVariance, true);

                return `
                  <tr>
                    <td>${dateTime(row.createdAt)}</td>
                    <td>
                      ${escapeHTML(row.branchName || row.branchId || '-')}
                    </td>
                    <td>
                      ${escapeHTML(row.startDate || '-')}
                      s.d.
                      ${escapeHTML(row.endDate || '-')}
                    </td>
                    <td>${rupiah(row.expectedCash)}</td>
                    <td>${rupiah(row.actualCash)}</td>
                    <td class="${
                      rowVariance < 0
                        ? 'danger-text'
                        : rowVariance === 0
                          ? 'success-text'
                          : ''
                    }">
                      ${rupiah(rowVariance)}
                    </td>
                    <td>
                      <span class="status ${rowStatus.className}">
                        ${rowStatus.label}
                      </span>
                    </td>
                    <td>${escapeHTML(row.notes || '-')}</td>
                    <td>${escapeHTML(row.countedBy || '-')}</td>
                  </tr>
                `;
              }).join('') || `
                <tr>
                  <td colspan="9">
                    Belum ada rekonsiliasi kas.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </article>
    `;

    const capitalForm =
      ctx.host.querySelector('#capitalForm');

    if (capitalForm && singleBranch) {
      capitalForm.onsubmit = async event => {
        event.preventDefault();

        if (savingCapital) return;
        if (!capitalForm.reportValidity()) return;

        const formData =
          new FormData(capitalForm);

        const date =
          String(formData.get('date') || '').trim();

        const source =
          String(formData.get('source') || '').trim();

        const amount =
          number(formData.get('amount'));

        const paymentMethod =
          String(
            formData.get('paymentMethod') || 'TUNAI'
          ).toUpperCase();

        const notes =
          String(formData.get('notes') || '').trim();

        if (!date) {
          return ctx.notify(
            'Tanggal modal wajib diisi',
            'error'
          );
        }

        if (!source) {
          return ctx.notify(
            'Sumber modal wajib diisi',
            'error'
          );
        }

        if (amount <= 0) {
          return ctx.notify(
            'Nominal modal harus lebih dari Rp0',
            'error'
          );
        }

        const record = {
          branchId: ctx.branch.id,
          branchName: ctx.branch.name,
          date,
          source,
          amount,
          nominal: amount,
          paymentMethod,
          notes,
          createdBy: ctx.user.name,
          createdByUid: ctx.user.uid || '',
          createdAt: Date.now()
        };

        const button =
          ctx.host.querySelector('#saveCapital');

        const oldText = button.textContent;

        savingCapital = true;
        button.disabled = true;
        button.textContent = 'Menyimpan Modal…';

        try {
          const result =
            await pushData('capital', record);

          data.capital.unshift({
            ...record,
            id: result.key
          });

          await audit(
            'CREATE',
            'CAPITAL_ADDITION',
            {
              branchId: record.branchId,
              date: record.date,
              source: record.source,
              amount: record.amount,
              paymentMethod: record.paymentMethod
            }
          );

          ctx.notify(
            `Modal ${rupiah(amount)} dari ${source} berhasil dicatat`
          );

          render();
        } catch (error) {
          console.error(
            'Simpan Modal Tambahan gagal:',
            error
          );

          ctx.notify(
            error.message
              || 'Modal Tambahan gagal disimpan.',
            'error'
          );

          button.disabled = false;
          button.textContent = oldText;
        } finally {
          savingCapital = false;
        }
      };
    }

    const cashForm =
      ctx.host.querySelector('#cashCountForm');

    if (cashForm && singleBranch) {
      cashForm.onsubmit = async event => {
        event.preventDefault();

        const formData =
          new FormData(cashForm);

        const actualRaw =
          formData.get('actualCash');

        if (String(actualRaw).trim() === '') {
          return ctx.notify(
            'Kas fisik sebenarnya wajib diisi',
            'error'
          );
        }

        const actual =
          number(actualRaw);

        const notes =
          String(
            formData.get('notes') || ''
          ).trim();

        const varianceNow =
          actual - current.expectedCash;

        if (varianceNow !== 0 && !notes) {
          return ctx.notify(
            'Keterangan wajib diisi bila ada selisih kas',
            'error'
          );
        }

        const record = {
          branchId: ctx.branch.id,
          branchName: ctx.branch.name,
          startDate: current.start,
          endDate: current.end,

          openingCash: current.openingCash,
          cashSales: current.cashSales,

          qrisSales:
            current.byPayment.QRIS || 0,

          debtSales:
            current.byPayment.HUTANG || 0,

          personalSales:
            current.byPayment.PERSONAL || 0,

          // kompatibilitas lama: capitalIn = modal tunai
          capitalIn: current.capitalCash,

          capitalTotal: current.capitalTotal,
          capitalCash: current.capitalCash,
          capitalNonCash: current.capitalNonCash,

          customerDebtCash:
            current.customerDebtCash,

          cashOperations:
            current.cashOperations,

          cashPurchases:
            current.cashPurchases,

          outgoingDebtCash:
            current.outgoingDebtCash,

          expectedCash:
            current.expectedCash,

          actualCash:
            actual,

          variance:
            varianceNow,

          status:
            varianceNow === 0
              ? 'match'
              : varianceNow > 0
                ? 'over'
                : 'short',

          notes,

          countedBy:
            ctx.user.name,

          countedByUid:
            ctx.user.uid,

          createdAt:
            Date.now()
        };

        const result =
          await pushData(
            `cashClosings/${ctx.branch.id}`,
            record
          );

        closings.unshift({
          ...record,
          id: result.key
        });

        await audit(
          'CREATE',
          'CASH_CLOSING',
          {
            branchId:
              ctx.branch.id,

            expectedCash:
              current.expectedCash,

            actualCash:
              actual,

            variance:
              varianceNow,

            capitalCash:
              current.capitalCash,

            capitalTotal:
              current.capitalTotal
          }
        );

        ctx.notify(
          'Rekonsiliasi kas tersimpan'
        );

        render();
      };
    }

    const capitalExport =
      ctx.host.querySelector('#capitalExport');

    if (capitalExport) {
      capitalExport.onclick = () => {
        const headers = [
          'tanggal',
          'cabang',
          'sumber_modal',
          'metode_masuk',
          'nominal',
          'masuk_laci',
          'keterangan',
          'dicatat_oleh'
        ];

        const csv = [
          headers.join(','),

          ...current.capitalRows.map(row => [
            rowDate(row),
            row.branchName || row.branchId || ctx.branch.name,
            capitalSource(row),
            capitalMethodOf(row),
            capitalAmount(row),
            capitalMethodOf(row) === 'TUNAI'
              ? 'YA'
              : 'TIDAK',
            row.notes || row.keterangan || '',
            row.createdBy || row.inputBy || ''
          ].map(csvCell).join(','))
        ].join('\n');

        download(
          `modal-tambahan-${current.start}-sd-${current.end}.csv`,
          csv,
          'text/csv'
        );
      };
    }
  };

  ctx.host.querySelector('#cashStart').onchange =
    render;

  ctx.host.querySelector('#cashEnd').onchange =
    render;

  ctx.host.querySelector('#cashPrint').onclick =
    () => window.print();

  ctx.host.querySelector('#cashExport').onclick = () => {
    if (!current) return;

    const rows = [
      ['Cabang', ctx.branch.name],
      ['Dari', current.start],
      ['Sampai', current.end],

      ['Modal awal laci', current.openingCash],

      [
        'Total Modal Tambahan',
        current.capitalTotal
      ],

      [
        'Modal Tambahan TUNAI masuk laci',
        current.capitalCash
      ],

      [
        'Modal Tambahan non-tunai',
        current.capitalNonCash
      ],

      [
        'Penjualan TUNAI',
        current.byPayment.TUNAI || 0
      ],

      [
        'Penjualan QRIS',
        current.byPayment.QRIS || 0
      ],

      [
        'Penjualan HUTANG',
        current.byPayment.HUTANG || 0
      ],

      [
        'Penjualan PERSONAL',
        current.byPayment.PERSONAL || 0
      ],

      [
        'Pembayaran hutang pelanggan tunai',
        current.customerDebtCash
      ],

      [
        'Operasional tunai',
        current.cashOperations
      ],

      [
        'Kulakan tunai',
        current.cashPurchases
      ],

      [
        'Bayar supplier/kasbon tunai',
        current.outgoingDebtCash
      ],

      [
        'Kas seharusnya',
        current.expectedCash
      ]
    ];

    const csv = [
      ['Keterangan', 'Nilai'],
      ...rows
    ]
      .map(row =>
        row.map(csvCell).join(',')
      )
      .join('\n');

    download(
      `laporan-kas-${current.start}-${current.end}.csv`,
      csv,
      'text/csv'
    );
  };

  render();
}
