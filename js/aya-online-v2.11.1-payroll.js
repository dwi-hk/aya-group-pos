/*
 * AYA POS ONLINE v2.11.1
 * Payroll / Absensi / Gaji enhancement.
 *
 * Script v2.11.0 tetap menangani:
 * - Scan barcode Kulakan
 * - Laporan PERSONAL
 *
 * Script ini mengambil alih tab Laba/Rugi Bersih agar gaji dihitung
 * berdasarkan TANGGAL PEMBAYARAN GAJI dan BONUS, serta menambahkan
 * tab Gaji & Absensi detail.
 */

import { getOnce } from './store.js';
import {
  rupiah,
  number,
  escapeHTML,
  toArray,
  sum,
  csvCell,
  download
} from './utils.js';

const $ = (selector, root = document) => root.querySelector(selector);

let payrollMode = null;
let renderToken = 0;
let cache = new Map();
let currentExport = null;

function text(value) {
  return String(value ?? '').trim();
}

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDate(value, fallback = '') {
  if (!value) return text(fallback).slice(0, 10);

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return text(fallback).slice(0, 10);
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function inPeriod(date, start, end) {
  if (!date) return false;
  return date >= start && date <= end;
}

function daysInclusive(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);

  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || b < a) {
    return 0;
  }

  return Math.floor((b - a) / 86400000) + 1;
}

function clampEndToToday(end) {
  const today = todayISO();
  return end > today ? today : end;
}

function hoursBetween(checkIn, checkOut) {
  const [inH, inM] = text(checkIn || '09:00').split(':').map(Number);
  const [outH, outM] = text(checkOut || '22:00').split(':').map(Number);

  if (![inH, inM, outH, outM].every(Number.isFinite)) return 0;

  let start = inH * 60 + inM;
  let finish = outH * 60 + outM;
  if (finish < start) finish += 24 * 60;

  return Math.max(0, (finish - start) / 60);
}

function salaryPaymentDate(row) {
  if (row?.attendanceV2) return text(row.salaryPaymentDate);
  return text(row?.salaryPaymentDate || row?.date);
}

function cashAdvancePaymentDate(row) {
  return text(
    row?.cashAdvancePaymentDate
    || (number(row?.cashAdvanceGiven) > 0 ? row?.date : '')
  );
}

function bonusPaymentDate(row) {
  return text(
    row?.bonusPaymentDate
    || (number(row?.bonus) > 0 ? row?.date : '')
  );
}

function attendanceWage(row) {
  if (row?.netWage !== undefined) return number(row.netWage);
  return Math.max(0, number(row?.dailyWage) - number(row?.deduction));
}

function operationTotal(row) {
  if (row?.total !== undefined) return number(row.total);
  return number(row?.qty || 1) * number(row?.price);
}

function saleItems(sale) {
  if (Array.isArray(sale?.items)) return sale.items;
  if (sale?.items && typeof sale.items === 'object') return Object.values(sale.items);
  return [];
}

function saleQty(sale) {
  return sum(saleItems(sale), item => number(item?.qty || 0));
}

function saleCost(sale) {
  return sum(
    saleItems(sale),
    item => number(item?.qty || 0) * number(item?.cost ?? item?.hargaBeli)
  );
}

function saleSubtotal(sale) {
  if (sale?.subtotal !== undefined) return number(sale.subtotal);

  return sum(
    saleItems(sale),
    item => number(item?.qty || 0) * number(item?.price ?? item?.harga)
  );
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

function saleDate(sale) {
  return localDate(sale?.createdAt || sale?.timestamp, sale?.date);
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
  const map = new Map();
  const noInvoice = [];

  for (const sale of sales) {
    const invoice = text(
      sale.invoice || sale.clientTransactionId || ''
    ).toUpperCase();

    if (!invoice) {
      noInvoice.push(sale);
      continue;
    }

    const old = map.get(invoice);
    const saleV2 = !String(sale.source || '').startsWith('legacy:');
    const oldV2 = old && !String(old.source || '').startsWith('legacy:');

    if (!old || saleV2 || !oldV2) map.set(invoice, sale);
  }

  return [...map.values(), ...noInvoice];
}

function branchIds() {
  const select = $('#branchSelector');
  if (!select?.value) return [];

  if (select.value !== 'all') return [select.value];

  return [...select.options]
    .map(option => option.value)
    .filter(value => value && value !== 'all');
}

function branchName() {
  const select = $('#branchSelector');
  const option = select?.options?.[select.selectedIndex];
  return option?.textContent?.trim() || 'AYA SEBLAK DAN ANGKRINGAN';
}

function period() {
  return {
    start: $('#salesReportStart')?.value || '',
    end: $('#salesReportEnd')?.value || ''
  };
}

function employeeKey(employee) {
  return text(employee?.id)
    || `name:${text(employee?.name).toLowerCase()}`;
}

function attendanceEmployeeKey(row) {
  return text(row?.employeeId)
    || `name:${text(row?.employeeName).toLowerCase()}`;
}

function bonusRecipientKey(row) {
  return text(row?.bonusRecipientId)
    || `name:${text(row?.bonusRecipientName || row?.employeeName).toLowerCase()}`;
}

function notify(message, type = 'success') {
  const host = $('#alertHost');
  if (!host) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.append(toast);

  setTimeout(() => toast.remove(), 4200);
}

function reportHeader(title, start, end) {
  return `
    <header class="sales-report-print-header">
      <h2>${escapeHTML(title)}</h2>
      <p>
        ${escapeHTML(branchName())}
        · ${escapeHTML(start || '-')} s.d. ${escapeHTML(end || '-')}
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

async function loadData(force = false) {
  const ids = branchIds();
  const key = ids.slice().sort().join('|') || 'none';

  if (!force && cache.has(key)) return cache.get(key);

  const [salesRaw, employeesRaw, operations, attendance] = await Promise.all([
    getOnce('sales', { force }),
    getOnce('employees', { force }),
    Promise.all(ids.map(async branchId =>
      toArray(await getOnce(`operations/${branchId}`, { force }))
        .map(row => ({ ...row, branchId: row.branchId || branchId }))
    )),
    Promise.all(ids.map(async branchId =>
      toArray(await getOnce(`attendance/${branchId}`, { force }))
        .map(row => ({ ...row, branchId: row.branchId || branchId }))
    ))
  ]);

  const idSet = new Set(ids);

  const data = {
    sales: dedupeSales(flattenSales(salesRaw))
      .filter(sale => idSet.has(text(sale.branchId))),
    employees: toArray(employeesRaw),
    operations: operations.flat(),
    attendance: attendance.flat()
  };

  cache.set(key, data);
  return data;
}

function rowsForPeriod(data) {
  const { start, end } = period();

  return {
    start,
    end,
    sales: data.sales.filter(row => inPeriod(saleDate(row), start, end)),
    operations: data.operations.filter(row =>
      inPeriod(localDate(row.createdAt, row.date), start, end)
    ),
    attendanceWorked: data.attendance.filter(row =>
      inPeriod(text(row.date), start, end)
    ),
    salaryPaid: data.attendance.filter(row =>
      inPeriod(salaryPaymentDate(row), start, end)
    ),
    cashAdvancePaid: data.attendance.filter(row =>
      number(row.cashAdvanceGiven) > 0
      && inPeriod(cashAdvancePaymentDate(row), start, end)
    ),
    bonusesPaid: data.attendance.filter(row =>
      number(row.bonus) > 0
      && inPeriod(bonusPaymentDate(row), start, end)
    )
  };
}

function forceBaseSummary() {
  // Membuat v2.11.0 melepas mode PERSONAL/net-profit internalnya.
  const summary = $('[data-sales-tab="summary"]');
  if (summary) summary.click();
}

function setActive(mode) {
  document.querySelectorAll('[data-sales-tab]').forEach(button =>
    button.classList.remove('active')
  );

  document.querySelectorAll('[data-online-extra-tab]').forEach(button =>
    button.classList.remove('active')
  );

  document.querySelectorAll('[data-payroll-extra-tab]').forEach(button =>
    button.classList.toggle(
      'active',
      button.dataset.payrollExtraTab === mode
    )
  );

  if (mode === 'net-profit') {
    $('[data-online-extra-tab="net-profit"]')?.classList.add('active');
  }
}

function ensurePayrollTab() {
  const tabs = $('.sales-report-tabs');
  if (!tabs) {
    payrollMode = null;
    return;
  }

  if (!$('[data-payroll-extra-tab="payroll"]', tabs)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sales-report-tab';
    button.dataset.payrollExtraTab = 'payroll';
    button.textContent = '👥 Gaji & Absensi';
    tabs.append(button);
  }

  if (payrollMode) setActive(payrollMode);
}

async function renderNetProfit(force = false) {
  const content = $('#salesReportContent');
  if (!content) return;

  const token = ++renderToken;
  currentExport = null;

  content.innerHTML = `
    <article class="card">
      <div class="empty-state">
        <div class="spinner"></div>
        <p>Menghitung laba/rugi bersih…</p>
      </div>
    </article>
  `;

  try {
    const all = await loadData(force);
    const data = rowsForPeriod(all);

    if (token !== renderToken || payrollMode !== 'net-profit') return;

    const omzet = sum(data.sales, saleTotal);
    const hpp = sum(data.sales, saleCost);
    const personalRows = data.sales.filter(
      sale => text(sale.paymentMethod).toUpperCase() === 'PERSONAL'
    );
    const personal = sum(personalRows, saleTotal);
    const operations = sum(data.operations, operationTotal);
    const wages = sum(data.salaryPaid, attendanceWage);
    const bonuses = sum(data.bonusesPaid, row => number(row.bonus));
    const cashAdvance = sum(
      data.cashAdvancePaid,
      row => number(row.cashAdvanceGiven)
    );

    const grossProfit = omzet - hpp;

    /*
     * Kasbon baru tidak dikurangi dari laba karena dicatat sebagai
     * piutang/kasbon karyawan, bukan biaya gaji. Tetap ditampilkan agar
     * arus uang dapat dipantau.
     */
    const netProfit =
      omzet - hpp - operations - wages - bonuses - personal;

    const netClass = netProfit < 0
      ? 'sales-report-loss'
      : 'sales-report-profit';

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Laporan Laba / Rugi Bersih', data.start, data.end)}

        <div class="grid cards sales-report-metrics">
          ${metric('Omzet Kasir', omzet, `${data.sales.length} nota`)}
          ${metric('HPP Barang Keluar', hpp, 'Termasuk barang PERSONAL')}
          ${metric('Laba Kotor', grossProfit, 'Omzet - HPP')}
          ${metric('Operasional', operations, `${data.operations.length} pengeluaran`)}
          ${metric('Gaji Dibayar', wages, `${data.salaryPaid.length} pembayaran/record`)}
          ${metric('Bonus Dibayar', bonuses, `${data.bonusesPaid.length} bonus`)}
          ${metric('Pemakaian PERSONAL', personal, `${personalRows.length} nota PERSONAL`)}
          ${metric(
            'LABA BERSIH',
            netProfit,
            'Omzet - HPP - Operasional - Gaji - Bonus - PERSONAL',
            true,
            netClass
          )}
        </div>

        <div class="grid two" style="margin-top:16px">
          <article class="card">
            <div class="toolbar">
              <div>
                <h2>Rincian Laba Bersih</h2>
                <p class="muted">
                  Gaji dan bonus mengikuti tanggal pembayaran, bukan sekadar
                  tanggal absensi.
                </p>
              </div>
              <button id="payrollNetExport" class="secondary-button sales-report-no-print">
                Export CSV
              </button>
            </div>

            <div class="summary-row">
              <span>Omzet Kasir</span>
              <strong>${rupiah(omzet)}</strong>
            </div>
            <div class="summary-row">
              <span>HPP</span>
              <strong>-${rupiah(hpp)}</strong>
            </div>
            <div class="summary-row">
              <span>Laba Kotor</span>
              <strong>${rupiah(grossProfit)}</strong>
            </div>
            <div class="summary-row">
              <span>Operasional</span>
              <strong>-${rupiah(operations)}</strong>
            </div>
            <div class="summary-row">
              <span>Gaji Dibayar</span>
              <strong>-${rupiah(wages)}</strong>
            </div>
            <div class="summary-row">
              <span>Bonus Dibayar</span>
              <strong>-${rupiah(bonuses)}</strong>
            </div>
            <div class="summary-row">
              <span>Pemakaian PERSONAL</span>
              <strong>-${rupiah(personal)}</strong>
            </div>
            <div class="summary-row total">
              <span>LABA BERSIH</span>
              <strong class="${netClass}">${rupiah(netProfit)}</strong>
            </div>
          </article>

          <article class="card">
            <h2>Informasi Kasbon Karyawan</h2>
            <div class="summary-row">
              <span>Kasbon Baru Dibayarkan</span>
              <strong>${rupiah(cashAdvance)}</strong>
            </div>
            <div class="summary-row">
              <span>Jumlah Pemberian Kasbon</span>
              <strong>${data.cashAdvancePaid.length}</strong>
            </div>
            <p class="muted" style="margin-top:10px">
              Kasbon baru ditampilkan di Laporan Lengkap tetapi tidak
              dikurangkan dari Laba Bersih karena merupakan piutang kepada
              karyawan. Potong kasbon sudah mengurangi saldo kasbon dan gaji
              bersih pada tab Absensi & Gaji.
            </p>
          </article>
        </div>

        <article class="card" style="margin-top:16px">
          <h2>Detail Gaji Dibayar</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal Bayar</th>
                  <th>Karyawan</th>
                  <th>Tanggal Kerja</th>
                  <th>Gaji/Hari</th>
                  <th>Potong Kasbon</th>
                  <th>Gaji Bersih</th>
                </tr>
              </thead>
              <tbody>
                ${data.salaryPaid.map(row => `
                  <tr>
                    <td>${escapeHTML(salaryPaymentDate(row) || '-')}</td>
                    <td>${escapeHTML(row.employeeName || '-')}</td>
                    <td>${escapeHTML(row.date || '-')}</td>
                    <td>${rupiah(row.dailyWage)}</td>
                    <td>${rupiah(row.deduction)}</td>
                    <td>${rupiah(attendanceWage(row))}</td>
                  </tr>
                `).join('') || '<tr><td colspan="6">Tidak ada pembayaran gaji pada periode ini.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>

        <article class="card" style="margin-top:16px">
          <h2>Detail Bonus Dibayar</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal Bonus</th>
                  <th>Penerima Bonus</th>
                  <th>Dicatat Bersama Absensi</th>
                  <th>Nominal</th>
                </tr>
              </thead>
              <tbody>
                ${data.bonusesPaid.map(row => `
                  <tr>
                    <td>${escapeHTML(bonusPaymentDate(row) || '-')}</td>
                    <td>${escapeHTML(row.bonusRecipientName || row.employeeName || '-')}</td>
                    <td>${escapeHTML(row.employeeName || '-')} · ${escapeHTML(row.date || '-')}</td>
                    <td>${rupiah(row.bonus)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4">Tidak ada bonus pada periode ini.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    `;

    currentExport = () => {
      const rows = [
        ['komponen', 'nilai'],
        ['omzet_kasir', omzet],
        ['hpp', hpp],
        ['laba_kotor', grossProfit],
        ['operasional', operations],
        ['gaji_dibayar', wages],
        ['bonus_dibayar', bonuses],
        ['pemakaian_personal', personal],
        ['kasbon_baru_informasi', cashAdvance],
        ['laba_bersih', netProfit]
      ];

      download(
        `laba-rugi-bersih-${data.start}-sd-${data.end}.csv`,
        rows.map(row => row.map(csvCell).join(',')).join('\n'),
        'text/csv'
      );
    };

    $('#payrollNetExport')?.addEventListener('click', currentExport);
  } catch (error) {
    console.error('Laporan laba/rugi v2.11.1 gagal:', error);
    content.innerHTML = `
      <article class="card">
        <h2>Laporan gagal dimuat</h2>
        <p class="danger-text">${escapeHTML(error.message || String(error))}</p>
      </article>
    `;
    notify(error.message || 'Laporan gagal dimuat.', 'error');
  }
}

async function renderPayroll(force = false) {
  const content = $('#salesReportContent');
  if (!content) return;

  const token = ++renderToken;
  currentExport = null;

  content.innerHTML = `
    <article class="card">
      <div class="empty-state">
        <div class="spinner"></div>
        <p>Menyusun laporan Absensi & Gaji per nama…</p>
      </div>
    </article>
  `;

  try {
    const all = await loadData(force);
    const data = rowsForPeriod(all);

    if (token !== renderToken || payrollMode !== 'payroll') return;

    const effectiveEnd = clampEndToToday(data.end);
    const calendarDays = daysInclusive(data.start, effectiveEnd);

    const employees = all.employees
      .slice()
      .sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'id')
      );

    const summary = employees.map(employee => {
      const key = employeeKey(employee);

      const worked = data.attendanceWorked.filter(
        row => attendanceEmployeeKey(row) === key
      );

      const presence = new Set(
        worked.map(row => text(row.date)).filter(Boolean)
      );

      const totalHours = worked.reduce(
        (total, row) =>
          total + (
            number(row.hoursWorked)
            || hoursBetween(row.checkIn, row.checkOut)
          ),
        0
      );

      const grossWage = sum(worked, row => number(row.dailyWage));
      const deductions = sum(worked, row => number(row.deduction));
      const netWage = sum(worked, attendanceWage);

      const paidSalary = sum(
        data.salaryPaid.filter(row => attendanceEmployeeKey(row) === key),
        attendanceWage
      );

      const cashAdvance = sum(
        data.cashAdvancePaid.filter(row => attendanceEmployeeKey(row) === key),
        row => number(row.cashAdvanceGiven)
      );

      const bonus = sum(
        data.bonusesPaid.filter(row => bonusRecipientKey(row) === key),
        row => number(row.bonus)
      );

      return {
        employee,
        daysPresent: presence.size,
        daysOff: Math.max(0, calendarDays - presence.size),
        totalHours,
        grossWage,
        deductions,
        netWage,
        paidSalary,
        cashAdvance,
        bonus
      };
    });

    const totalGross = sum(summary, row => row.grossWage);
    const totalNet = sum(summary, row => row.netWage);
    const totalPaid = sum(summary, row => row.paidSalary);
    const totalBonus = sum(summary, row => row.bonus);
    const totalCashAdvance = sum(summary, row => row.cashAdvance);

    content.innerHTML = `
      <div id="salesReportPrintArea">
        ${reportHeader('Laporan Detail Gaji & Absensi', data.start, data.end)}

        <div class="grid cards sales-report-metrics">
          ${metric('Total Gaji Kotor', totalGross, 'Berdasarkan tanggal kerja')}
          ${metric('Total Gaji Bersih', totalNet, 'Setelah potong kasbon')}
          ${metric('Gaji Dibayar', totalPaid, 'Berdasarkan tanggal pembayaran')}
          ${metric('Bonus Dibayar', totalBonus, 'Berdasarkan tanggal bonus')}
          ${metric('Kasbon Baru', totalCashAdvance, 'Informasi pemberian kasbon')}
        </div>

        <article class="card" style="margin-top:16px">
          <div class="toolbar">
            <div>
              <h2>Ringkasan Per Nama Karyawan</h2>
              <p class="muted">
                Hari libur/tidak masuk = hari kalender yang sudah berjalan
                dalam periode - hari dengan absensi tercatat.
              </p>
            </div>
            <button id="payrollReportExport" class="secondary-button sales-report-no-print">
              Export CSV
            </button>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Hari Masuk</th>
                  <th>Libur / Tidak Masuk</th>
                  <th>Total Jam</th>
                  <th>Total Gaji Kotor</th>
                  <th>Potong Kasbon</th>
                  <th>Total Gaji Bersih</th>
                  <th>Gaji Dibayar</th>
                  <th>Kasbon Baru</th>
                  <th>Saldo Kasbon</th>
                  <th>Bonus Diterima</th>
                </tr>
              </thead>
              <tbody>
                ${summary.map(row => `
                  <tr>
                    <td>
                      <strong>${escapeHTML(row.employee.name || '-')}</strong>
                      <br>
                      <small class="muted">${escapeHTML(row.employee.position || 'Karyawan')}</small>
                    </td>
                    <td>${row.daysPresent}</td>
                    <td>${row.daysOff}</td>
                    <td>${row.totalHours.toFixed(1)} jam</td>
                    <td>${rupiah(row.grossWage)}</td>
                    <td>${rupiah(row.deductions)}</td>
                    <td>${rupiah(row.netWage)}</td>
                    <td>${rupiah(row.paidSalary)}</td>
                    <td>${rupiah(row.cashAdvance)}</td>
                    <td>${rupiah(row.employee.cashAdvance || 0)}</td>
                    <td>${rupiah(row.bonus)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="11">Belum ada data karyawan.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>

        <article class="card" style="margin-top:16px">
          <h2>Detail Absensi Harian</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Nama</th>
                  <th>Jam Masuk</th>
                  <th>Jam Pulang</th>
                  <th>Total Jam</th>
                  <th>Gaji/Hari</th>
                  <th>Kasbon Baru</th>
                  <th>Potong Kasbon</th>
                  <th>Gaji Bersih</th>
                  <th>Tgl Bayar Gaji</th>
                  <th>Bonus</th>
                  <th>Penerima Bonus</th>
                </tr>
              </thead>
              <tbody>
                ${data.attendanceWorked
                  .slice()
                  .sort((a, b) =>
                    String(b.date || '').localeCompare(String(a.date || ''))
                  )
                  .map(row => `
                    <tr>
                      <td>${escapeHTML(row.date || '-')}</td>
                      <td>${escapeHTML(row.employeeName || '-')}</td>
                      <td>${escapeHTML(row.checkIn || '-')}</td>
                      <td>${escapeHTML(row.checkOut || '-')}</td>
                      <td>${(
                        number(row.hoursWorked)
                        || hoursBetween(row.checkIn, row.checkOut)
                      ).toFixed(1)}</td>
                      <td>${rupiah(row.dailyWage)}</td>
                      <td>
                        ${rupiah(row.cashAdvanceGiven || 0)}
                        ${number(row.cashAdvanceGiven) > 0
                          ? `<br><small>${escapeHTML(cashAdvancePaymentDate(row) || '-')}</small>`
                          : ''}
                      </td>
                      <td>${rupiah(row.deduction || 0)}</td>
                      <td>${rupiah(attendanceWage(row))}</td>
                      <td>${escapeHTML(salaryPaymentDate(row) || 'Belum dibayar')}</td>
                      <td>
                        ${rupiah(row.bonus || 0)}
                        ${number(row.bonus) > 0
                          ? `<br><small>${escapeHTML(bonusPaymentDate(row) || '-')}</small>`
                          : ''}
                      </td>
                      <td>${escapeHTML(row.bonusRecipientName || row.employeeName || '-')}</td>
                    </tr>
                  `).join('')
                  || '<tr><td colspan="12">Tidak ada absensi pada periode ini.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>

        <div class="grid two" style="margin-top:16px">
          <article class="card">
            <h2>Rincian Pembayaran Gaji</h2>
            ${data.salaryPaid.map(row => `
              <div class="summary-row">
                <span>
                  ${escapeHTML(salaryPaymentDate(row) || '-')}
                  · ${escapeHTML(row.employeeName || '-')}
                </span>
                <strong>${rupiah(attendanceWage(row))}</strong>
              </div>
            `).join('') || '<p class="muted">Belum ada pembayaran gaji.</p>'}
          </article>

          <article class="card">
            <h2>Rincian Bonus</h2>
            ${data.bonusesPaid.map(row => `
              <div class="summary-row">
                <span>
                  ${escapeHTML(bonusPaymentDate(row) || '-')}
                  · ${escapeHTML(row.bonusRecipientName || row.employeeName || '-')}
                </span>
                <strong>${rupiah(row.bonus)}</strong>
              </div>
            `).join('') || '<p class="muted">Belum ada bonus.</p>'}
          </article>
        </div>

        <article class="card" style="margin-top:16px">
          <h2>Rincian Kasbon Baru</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Karyawan</th>
                  <th>Kasbon Baru</th>
                  <th>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                ${data.cashAdvancePaid.map(row => `
                  <tr>
                    <td>${escapeHTML(cashAdvancePaymentDate(row) || '-')}</td>
                    <td>${escapeHTML(row.employeeName || '-')}</td>
                    <td>${rupiah(row.cashAdvanceGiven)}</td>
                    <td>${escapeHTML(row.notes || '-')}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4">Tidak ada kasbon baru pada periode ini.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    `;

    currentExport = () => {
      const headers = [
        'nama',
        'hari_masuk',
        'libur_tidak_masuk',
        'total_jam',
        'gaji_kotor',
        'potong_kasbon',
        'gaji_bersih',
        'gaji_dibayar',
        'kasbon_baru',
        'saldo_kasbon',
        'bonus_diterima'
      ];

      const csv = [
        headers.join(','),
        ...summary.map(row => [
          row.employee.name,
          row.daysPresent,
          row.daysOff,
          row.totalHours.toFixed(1),
          row.grossWage,
          row.deductions,
          row.netWage,
          row.paidSalary,
          row.cashAdvance,
          number(row.employee.cashAdvance),
          row.bonus
        ].map(csvCell).join(','))
      ].join('\n');

      download(
        `gaji-absensi-${data.start}-sd-${data.end}.csv`,
        csv,
        'text/csv'
      );
    };

    $('#payrollReportExport')?.addEventListener('click', currentExport);
  } catch (error) {
    console.error('Laporan Gaji & Absensi gagal:', error);
    content.innerHTML = `
      <article class="card">
        <h2>Laporan Gaji & Absensi gagal dimuat</h2>
        <p class="danger-text">${escapeHTML(error.message || String(error))}</p>
      </article>
    `;
    notify(error.message || 'Laporan Gaji & Absensi gagal dimuat.', 'error');
  }
}

async function renderCurrent(force = false) {
  if (!payrollMode) return;

  ensurePayrollTab();
  setActive(payrollMode);

  if (payrollMode === 'net-profit') {
    await renderNetProfit(force);
  }

  if (payrollMode === 'payroll') {
    await renderPayroll(force);
  }
}

/*
 * CAPTURE: ambil alih tombol Laba/Rugi Bersih v2.11.0.
 * Dengan capture, handler v2.11.0 tidak ikut menjalankan perhitungan lamanya.
 */
document.addEventListener('click', event => {
  const oldNet = event.target?.closest('[data-online-extra-tab="net-profit"]');

  if (oldNet) {
    event.preventDefault();
    event.stopImmediatePropagation();

    forceBaseSummary();
    payrollMode = 'net-profit';

    renderCurrent(true).catch(error => {
      console.error(error);
      notify(error.message || 'Laporan gagal dimuat.', 'error');
    });

    return;
  }

  const payroll = event.target?.closest('[data-payroll-extra-tab="payroll"]');

  if (payroll) {
    event.preventDefault();
    event.stopImmediatePropagation();

    forceBaseSummary();
    payrollMode = 'payroll';

    renderCurrent(true).catch(error => {
      console.error(error);
      notify(error.message || 'Laporan Gaji & Absensi gagal dimuat.', 'error');
    });

    return;
  }

  // Export utama mengikuti tab baru yang sedang terbuka.
  if (event.target?.closest('#salesReportExport') && payrollMode && currentExport) {
    event.preventDefault();
    event.stopImmediatePropagation();
    currentExport();
    return;
  }

  // Tab laporan lain: lepaskan mode payroll.
  if (
    event.target?.closest('[data-sales-tab]')
    || event.target?.closest('[data-online-extra-tab="personal"]')
  ) {
    payrollMode = null;
    currentExport = null;
  }
}, true);

document.addEventListener('change', event => {
  const id = event.target?.id || '';

  if (
    payrollMode
    && [
      'salesReportPreset',
      'salesReportStart',
      'salesReportEnd'
    ].includes(id)
  ) {
    setTimeout(() => {
      renderCurrent(false).catch(console.error);
    }, 0);
  }
});

document.addEventListener('click', event => {
  if (event.target?.closest('#salesReportReload') && payrollMode) {
    cache.clear();

    setTimeout(() => {
      ensurePayrollTab();
      renderCurrent(true).catch(console.error);
    }, 100);
  }
});

let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    ensurePayrollTab();
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
    schedule();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
} else {
  schedule();
}

console.info('AYA POS ONLINE v2.11.1 payroll enhancement loaded.');
