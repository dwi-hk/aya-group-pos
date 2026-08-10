import {
  getOnce,
  pushData,
  setData,
  removeData
} from './store.js';

import {
  escapeHTML,
  formObject,
  number,
  rupiah,
  toArray
} from './utils.js';

const DEFAULT_CHECK_IN = '09:00';
const DEFAULT_CHECK_OUT = '22:00';

function text(value) {
  return String(value ?? '').trim();
}

function todayISO() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthStartISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoursBetween(checkIn, checkOut) {
  const [inH, inM] = text(checkIn || DEFAULT_CHECK_IN).split(':').map(Number);
  const [outH, outM] = text(checkOut || DEFAULT_CHECK_OUT).split(':').map(Number);

  if (![inH, inM, outH, outM].every(Number.isFinite)) return 0;

  let start = inH * 60 + inM;
  let end = outH * 60 + outM;

  if (end < start) end += 24 * 60;

  return Math.max(0, (end - start) / 60);
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

function attendanceWage(row) {
  if (row?.netWage !== undefined) return number(row.netWage);
  return Math.max(0, number(row?.dailyWage) - number(row?.deduction));
}

function salaryPaymentDate(row) {
  // Data baru: tanggal kosong berarti memang belum dibayar.
  if (row?.attendanceV2) return text(row.salaryPaymentDate);

  // Kompatibilitas data lama yang belum memiliki kolom tanggal pembayaran.
  return text(row?.salaryPaymentDate || row?.date);
}

function bonusPaymentDate(row) {
  return text(row?.bonusPaymentDate || (number(row?.bonus) > 0 ? row?.date : ''));
}

function cashAdvancePaymentDate(row) {
  return text(
    row?.cashAdvancePaymentDate
    || (number(row?.cashAdvanceGiven) > 0 ? row?.date : '')
  );
}

function inPeriod(date, start, end) {
  if (!date) return false;
  return date >= start && date <= end;
}

function employeeKey(row) {
  return text(row?.employeeId) || `name:${text(row?.employeeName).toLowerCase()}`;
}

function bonusRecipientKey(row) {
  return text(row?.bonusRecipientId)
    || `name:${text(row?.bonusRecipientName || row?.employeeName).toLowerCase()}`;
}

/* ============================================================
   DATA KARYAWAN
   ============================================================ */

export async function renderEmployees(ctx) {
  let employees = toArray(await getOnce('employees'));

  const draw = () => {
    ctx.host.innerHTML = `
      <article class="card">
        <div class="toolbar">
          <div>
            <h2>Data & Manajemen Karyawan</h2>
            <p class="muted">
              Gaji harian, kontak, alamat, saldo kasbon, dan jabatan.
            </p>
          </div>
          <button id="addEmployee" class="primary-button">+ Karyawan</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Kontak</th>
                <th>Alamat</th>
                <th>Gaji/Hari</th>
                <th>Saldo Kasbon</th>
                <th>Cabang</th>
                <th>Jabatan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${employees.map(employee => `
                <tr>
                  <td><strong>${escapeHTML(employee.name)}</strong></td>
                  <td>${escapeHTML(employee.phone || '-')}</td>
                  <td>${escapeHTML(employee.address || '-')}</td>
                  <td>${rupiah(employee.dailyWage)}</td>
                  <td>${rupiah(employee.cashAdvance || 0)}</td>
                  <td>${escapeHTML(employee.branchName || '-')}</td>
                  <td>${escapeHTML(employee.position || 'Karyawan')}</td>
                  <td>
                    <button class="icon-button" data-edit="${escapeHTML(employee.id)}">✏️</button>
                    <button class="icon-button" data-delete="${escapeHTML(employee.id)}">🗑️</button>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="8">Belum ada karyawan.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>
    `;

    ctx.host.querySelector('#addEmployee').onclick = () =>
      employeeForm(ctx, null, async item => {
        const result = await pushData('employees', item);
        employees.push({ ...item, id: result.key });
        draw();
      });

    ctx.host.querySelector('tbody').onclick = async event => {
      const edit = event.target.closest('[data-edit]');
      const del = event.target.closest('[data-delete]');

      if (edit) {
        const old = employees.find(item => item.id === edit.dataset.edit);
        if (!old) return;

        employeeForm(ctx, old, async item => {
          await setData(`employees/${old.id}`, item);
          employees = employees.map(row =>
            row.id === old.id ? { ...item, id: old.id } : row
          );
          draw();
        });
      }

      if (del && confirm('Hapus karyawan?')) {
        await removeData(`employees/${del.dataset.delete}`);
        employees = employees.filter(item => item.id !== del.dataset.delete);
        draw();
      }
    };
  };

  draw();
}

function employeeForm(ctx, row, onSave) {
  row = row || {};

  ctx.dialog(
    row.id ? 'Edit Karyawan' : 'Tambah Karyawan',
    `
      <form id="employeeForm" class="form-grid">
        <label>
          Nama
          <input name="name" required value="${escapeHTML(row.name || '')}">
        </label>

        <label>
          No. WA
          <input name="phone" value="${escapeHTML(row.phone || '')}">
        </label>

        <label class="full">
          Alamat
          <input name="address" value="${escapeHTML(row.address || '')}">
        </label>

        <label>
          Gaji Per Hari
          <input name="dailyWage" inputmode="numeric" value="${row.dailyWage || 0}">
        </label>

        <label>
          Saldo Kasbon
          <input name="cashAdvance" inputmode="numeric" value="${row.cashAdvance || 0}">
        </label>

        <label>
          Cabang
          <input name="branchName" value="${escapeHTML(row.branchName || ctx.branch.name)}">
        </label>

        <label>
          Jabatan
          <input name="position" value="${escapeHTML(row.position || 'Karyawan')}">
        </label>
      </form>
    `,
    `
      <button value="cancel" class="secondary-button">Batal</button>
      <button id="saveEmployee" class="primary-button">Simpan</button>
    `
  );

  document.querySelector('#saveEmployee').onclick = async event => {
    event.preventDefault();

    const form = document.querySelector('#employeeForm');
    if (!form.reportValidity()) return;

    const raw = formObject(form);

    await onSave({
      ...row,
      ...raw,
      dailyWage: number(raw.dailyWage),
      cashAdvance: number(raw.cashAdvance),
      updatedAt: Date.now()
    });

    document.querySelector('#appDialog').close();
    ctx.notify('Karyawan disimpan');
  };
}

/* ============================================================
   ABSENSI & GAJI v2.11.1
   ============================================================ */

export async function renderAttendance(ctx) {
  if (ctx.branch.id === 'all') {
    ctx.host.innerHTML = `
      <article class="card">
        <h2>Pilih satu cabang</h2>
        <p class="muted">
          Absensi, gaji, kasbon, dan bonus harus dicatat pada cabang tertentu.
        </p>
      </article>
    `;
    return;
  }

  const [employeesRaw, attendanceRaw] = await Promise.all([
    getOnce('employees', { force: true }),
    getOnce(`attendance/${ctx.branch.id}`, { force: true })
  ]);

  let employees = toArray(employeesRaw)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id'));

  let attendance = toArray(attendanceRaw)
    .sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || ''))
      || number(b.createdAt) - number(a.createdAt)
    );

  let summaryStart = monthStartISO();
  let summaryEnd = todayISO();
  let saving = false;

  const currentEmployee = id =>
    employees.find(employee => String(employee.id) === String(id));

  const renderEmployeeSummary = () => {
    const body = ctx.host.querySelector('#attendanceEmployeeSummaryRows');
    if (!body) return;

    const effectiveEnd = clampEndToToday(summaryEnd);
    const calendarDays = daysInclusive(summaryStart, effectiveEnd);

    const rows = employees.map(employee => {
      const key = String(employee.id);
      const rowsByAttendanceDate = attendance.filter(row =>
        String(row.employeeId) === key
        && inPeriod(text(row.date), summaryStart, summaryEnd)
      );

      const presenceDates = new Set(
        rowsByAttendanceDate.map(row => text(row.date)).filter(Boolean)
      );

      const totalHours = rowsByAttendanceDate.reduce(
        (total, row) =>
          total + (
            number(row.hoursWorked)
            || hoursBetween(row.checkIn, row.checkOut)
          ),
        0
      );

      const grossWage = rowsByAttendanceDate.reduce(
        (total, row) => total + number(row.dailyWage),
        0
      );

      const deductions = rowsByAttendanceDate.reduce(
        (total, row) => total + number(row.deduction),
        0
      );

      const netWage = rowsByAttendanceDate.reduce(
        (total, row) => total + attendanceWage(row),
        0
      );

      const paidSalary = attendance.reduce((total, row) => {
        if (String(row.employeeId) !== key) return total;
        const paidDate = salaryPaymentDate(row);
        return inPeriod(paidDate, summaryStart, summaryEnd)
          ? total + attendanceWage(row)
          : total;
      }, 0);

      const cashAdvanceGiven = attendance.reduce((total, row) => {
        if (String(row.employeeId) !== key) return total;
        const paidDate = cashAdvancePaymentDate(row);
        return inPeriod(paidDate, summaryStart, summaryEnd)
          ? total + number(row.cashAdvanceGiven)
          : total;
      }, 0);

      const bonusReceived = attendance.reduce((total, row) => {
        if (bonusRecipientKey(row) !== key) return total;
        const paidDate = bonusPaymentDate(row);
        return inPeriod(paidDate, summaryStart, summaryEnd)
          ? total + number(row.bonus)
          : total;
      }, 0);

      const daysPresent = presenceDates.size;
      const daysOff = Math.max(0, calendarDays - daysPresent);

      return {
        employee,
        daysPresent,
        daysOff,
        totalHours,
        grossWage,
        deductions,
        netWage,
        paidSalary,
        cashAdvanceGiven,
        bonusReceived
      };
    });

    body.innerHTML = rows.map(row => `
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
        <td>${rupiah(row.cashAdvanceGiven)}</td>
        <td>${rupiah(row.employee.cashAdvance || 0)}</td>
        <td>${rupiah(row.bonusReceived)}</td>
      </tr>
    `).join('') || '<tr><td colspan="11">Belum ada data karyawan.</td></tr>';
  };

  const exportSummary = () => {
    const rows = [...ctx.host.querySelectorAll('#attendanceEmployeeSummaryRows tr')]
      .map(tr => [...tr.children].map(td =>
        `"${String(td.innerText || '').replaceAll('"', '""')}"`
      ).join(','));

    const header = [
      'nama',
      'hari_masuk',
      'hari_libur_tidak_masuk',
      'total_jam',
      'gaji_kotor',
      'potong_kasbon',
      'gaji_bersih',
      'gaji_dibayar',
      'kasbon_baru',
      'saldo_kasbon',
      'bonus_diterima'
    ].join(',');

    const blob = new Blob(
      [`\ufeff${header}\n${rows.join('\n')}`],
      { type: 'text/csv;charset=utf-8' }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `absensi-gaji-${summaryStart}-sd-${summaryEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const draw = () => {
    const latestRows = attendance.slice(0, 100);

    ctx.host.innerHTML = `
      <div class="grid two">
        <article class="card">
          <div class="toolbar">
            <div>
              <h2>Absensi & Gaji</h2>
              <p class="muted">
                Satu kali input untuk absensi, gaji, kasbon, potongan, bonus,
                dan tanggal pembayaran. Data otomatis dibaca Laporan Lengkap.
              </p>
            </div>
            <span class="badge">${escapeHTML(ctx.branch.name)}</span>
          </div>

          <form id="attendanceForm" class="form-grid">
            <label class="full">
              Nama Karyawan
              <select name="employeeId" required>
                ${employees.map(employee => `
                  <option value="${escapeHTML(employee.id)}">
                    ${escapeHTML(employee.name)}
                  </option>
                `).join('')}
              </select>
            </label>

            <label>
              Tanggal Kerja
              <input name="date" type="date" required value="${todayISO()}">
            </label>

            <label>
              Gaji Per Hari
              <input name="dailyWage" inputmode="numeric" value="0">
            </label>

            <label>
              Jam Masuk
              <input name="checkIn" type="time" value="${DEFAULT_CHECK_IN}">
            </label>

            <label>
              Jam Pulang
              <input name="checkOut" type="time" value="${DEFAULT_CHECK_OUT}">
            </label>

            <label>
              Total Jam Kerja
              <input name="hoursWorked" value="13.0" readonly>
            </label>

            <label>
              Kasbon Baru
              <input name="cashAdvanceGiven" inputmode="numeric" value="0">
            </label>

            <label>
              Tanggal Pemberian Kasbon
              <input name="cashAdvancePaymentDate" type="date" value="${todayISO()}">
            </label>

            <label>
              Potong Kasbon dari Gaji
              <input name="deduction" inputmode="numeric" value="0">
            </label>

            <label>
              Tanggal Pembayaran Gaji
              <input name="salaryPaymentDate" type="date" value="${todayISO()}">
            </label>

            <label>
              Bonus
              <input name="bonus" inputmode="numeric" value="0">
            </label>

            <label>
              Bonus Diberikan Kepada
              <select name="bonusRecipientId">
                ${employees.map(employee => `
                  <option value="${escapeHTML(employee.id)}">
                    ${escapeHTML(employee.name)}
                  </option>
                `).join('')}
              </select>
            </label>

            <label>
              Tanggal Pembayaran Bonus
              <input name="bonusPaymentDate" type="date" value="${todayISO()}">
            </label>

            <label>
              Saldo Kasbon Saat Ini
              <input name="currentCashAdvance" value="Rp0" readonly>
            </label>

            <label class="full">
              Keterangan
              <input
                name="notes"
                placeholder="Contoh: lembur, izin terlambat, bonus target, dll."
              >
            </label>

            <div class="full card" style="padding:12px;background:#121419">
              <div class="summary-row">
                <span>Gaji Hari Ini</span>
                <strong id="attendanceGrossWage">${rupiah(0)}</strong>
              </div>
              <div class="summary-row">
                <span>Potong Kasbon</span>
                <strong id="attendanceDeduction">-${rupiah(0)}</strong>
              </div>
              <div class="summary-row total">
                <span>Gaji Bersih</span>
                <strong id="attendanceNetWage">${rupiah(0)}</strong>
              </div>
              <small class="muted">
                Bonus dicatat terpisah karena bonus dapat diberikan kepada
                karyawan yang berbeda.
              </small>
            </div>

            <button id="saveAttendance" class="primary-button full">
              Simpan Absensi & Gaji
            </button>
          </form>
        </article>

        <article class="card">
          <h2>100 Catatan Terbaru</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Nama</th>
                  <th>Masuk</th>
                  <th>Pulang</th>
                  <th>Jam</th>
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
                ${latestRows.map(row => `
                  <tr>
                    <td>${escapeHTML(row.date || '-')}</td>
                    <td><strong>${escapeHTML(row.employeeName || '-')}</strong></td>
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
                `).join('') || '<tr><td colspan="12">Belum ada absensi.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article class="card" style="margin-top:16px">
        <div class="toolbar">
          <div>
            <h2>Ringkasan Detail Per Karyawan</h2>
            <p class="muted">
              Hari libur/tidak masuk dihitung dari hari kalender yang sudah
              berjalan dalam periode dikurangi tanggal absensi yang tercatat.
            </p>
          </div>
          <button id="attendanceExportSummary" class="secondary-button">
            Export CSV
          </button>
        </div>

        <div class="form-grid" style="margin-bottom:14px">
          <label>
            Dari Tanggal
            <input id="attendanceSummaryStart" type="date" value="${summaryStart}">
          </label>

          <label>
            Sampai Tanggal
            <input id="attendanceSummaryEnd" type="date" value="${summaryEnd}">
          </label>
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
                <th>Total Potong Kasbon</th>
                <th>Total Gaji Bersih</th>
                <th>Gaji Dibayar</th>
                <th>Kasbon Baru</th>
                <th>Saldo Kasbon</th>
                <th>Bonus Diterima</th>
              </tr>
            </thead>
            <tbody id="attendanceEmployeeSummaryRows"></tbody>
          </table>
        </div>
      </article>
    `;

    const form = ctx.host.querySelector('#attendanceForm');
    const employeeSelect = form.querySelector('[name="employeeId"]');
    const bonusRecipient = form.querySelector('[name="bonusRecipientId"]');
    const dailyWageInput = form.querySelector('[name="dailyWage"]');
    const checkInInput = form.querySelector('[name="checkIn"]');
    const checkOutInput = form.querySelector('[name="checkOut"]');
    const hoursInput = form.querySelector('[name="hoursWorked"]');
    const cashAdvanceInput = form.querySelector('[name="cashAdvanceGiven"]');
    const deductionInput = form.querySelector('[name="deduction"]');
    const bonusInput = form.querySelector('[name="bonus"]');
    const currentCashAdvanceInput = form.querySelector('[name="currentCashAdvance"]');

    const recalcHours = () => {
      hoursInput.value = hoursBetween(
        checkInInput.value,
        checkOutInput.value
      ).toFixed(1);
    };

    const recalcWage = () => {
      const gross = number(dailyWageInput.value);
      const deduction = number(deductionInput.value);
      const net = Math.max(0, gross - deduction);

      ctx.host.querySelector('#attendanceGrossWage').textContent = rupiah(gross);
      ctx.host.querySelector('#attendanceDeduction').textContent = `-${rupiah(deduction)}`;
      ctx.host.querySelector('#attendanceNetWage').textContent = rupiah(net);
    };

    const loadEmployee = () => {
      const employee = currentEmployee(employeeSelect.value);

      dailyWageInput.value = number(employee?.dailyWage);
      currentCashAdvanceInput.value = rupiah(employee?.cashAdvance || 0);

      // Default penerima bonus mengikuti karyawan yang sedang diabsen.
      bonusRecipient.value = employeeSelect.value;

      recalcWage();
    };

    employeeSelect.onchange = loadEmployee;
    checkInInput.oninput = recalcHours;
    checkOutInput.oninput = recalcHours;
    dailyWageInput.oninput = recalcWage;
    deductionInput.oninput = recalcWage;

    loadEmployee();
    recalcHours();

    const summaryStartInput = ctx.host.querySelector('#attendanceSummaryStart');
    const summaryEndInput = ctx.host.querySelector('#attendanceSummaryEnd');

    summaryStartInput.onchange = () => {
      summaryStart = summaryStartInput.value;
      renderEmployeeSummary();
    };

    summaryEndInput.onchange = () => {
      summaryEnd = summaryEndInput.value;
      renderEmployeeSummary();
    };

    ctx.host.querySelector('#attendanceExportSummary').onclick = exportSummary;

    form.onsubmit = async event => {
      event.preventDefault();

      if (saving) return;
      if (!form.reportValidity()) return;

      const raw = formObject(form);
      const employee = currentEmployee(raw.employeeId);

      if (!employee) {
        ctx.notify('Karyawan tidak ditemukan.', 'error');
        return;
      }

      const dailyWage = number(raw.dailyWage);
      const deduction = number(raw.deduction);
      const cashAdvanceGiven = number(raw.cashAdvanceGiven);
      const bonus = number(raw.bonus);
      const existingCashAdvance = number(employee.cashAdvance);
      const availableCashAdvance = existingCashAdvance + cashAdvanceGiven;

      if (deduction > availableCashAdvance) {
        ctx.notify(
          `Potong kasbon ${rupiah(deduction)} melebihi saldo kasbon ${rupiah(availableCashAdvance)}.`,
          'error'
        );
        return;
      }

      const bonusEmployee =
        currentEmployee(raw.bonusRecipientId) || employee;

      const netWage = Math.max(0, dailyWage - deduction);
      const hoursWorked = hoursBetween(raw.checkIn, raw.checkOut);
      const nextCashAdvance = Math.max(
        0,
        existingCashAdvance + cashAdvanceGiven - deduction
      );

      const item = {
        ...raw,
        attendanceV2: true,
        employeeName: employee.name || '',
        dailyWage,
        deduction,
        cashAdvanceGiven,
        bonus,
        bonusRecipientId: bonusEmployee.id || '',
        bonusRecipientName: bonusEmployee.name || employee.name || '',
        hoursWorked,
        netWage,
        branchId: ctx.branch.id,
        branchName: ctx.branch.name,
        createdBy: ctx.user.name,
        createdByUid: ctx.user.uid || '',
        createdAt: Date.now()
      };

      // Nilai 0 tidak dianggap pembayaran kasbon/bonus.
      if (cashAdvanceGiven <= 0) item.cashAdvancePaymentDate = '';
      if (bonus <= 0) item.bonusPaymentDate = '';

      saving = true;
      const button = ctx.host.querySelector('#saveAttendance');
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Menyimpan…';

      try {
        const result = await pushData(
          `attendance/${ctx.branch.id}`,
          item
        );

        await setData(`employees/${employee.id}`, {
          ...employee,
          cashAdvance: nextCashAdvance,
          updatedAt: Date.now()
        });

        employee.cashAdvance = nextCashAdvance;
        attendance.unshift({ ...item, id: result.key });

        ctx.notify(
          `Absensi ${employee.name} tersimpan. Saldo kasbon sekarang ${rupiah(nextCashAdvance)}.`
        );

        draw();
      } catch (error) {
        console.error('Simpan Absensi & Gaji gagal:', error);
        ctx.notify(
          error.message || 'Absensi & Gaji gagal disimpan.',
          'error'
        );
        button.disabled = false;
        button.textContent = oldText;
      } finally {
        saving = false;
      }
    };

    renderEmployeeSummary();
  };

  draw();
}

/* ============================================================
   KALKULATOR
   ============================================================ */

export function renderCalculator(ctx) {
  ctx.host.innerHTML = `
    <div class="grid two">
      <article class="card">
        <h2>Kalkulator Sederhana</h2>
        <input
          id="calcDisplay"
          value="0"
          readonly
          style="font-size:2rem;text-align:right;margin-bottom:12px"
        >

        <div class="grid" style="grid-template-columns:repeat(4,1fr)">
          ${[
            '7','8','9','/',
            '4','5','6','*',
            '1','2','3','-',
            '0','.','C','+'
          ].map(key => `
            <button class="secondary-button" data-key="${key}">
              ${key}
            </button>
          `).join('')}

          <button
            class="primary-button"
            data-key="="
            style="grid-column:1/-1"
          >
            =
          </button>
        </div>
      </article>

      <article class="card">
        <h2>Catatan</h2>
        <textarea id="calcNotes" placeholder="Catatan hitungan…"></textarea>
        <button id="saveCalcNotes" class="secondary-button" style="margin-top:10px">
          Simpan Catatan Lokal
        </button>
      </article>
    </div>
  `;

  let expression = '';
  const display = ctx.host.querySelector('#calcDisplay');

  ctx.host.onclick = event => {
    const button = event.target.closest('[data-key]');
    if (!button) return;

    const key = button.dataset.key;

    if (key === 'C') {
      expression = '';
      display.value = '0';
      return;
    }

    if (key === '=') {
      try {
        if (!/^[0-9+\-*/.() ]+$/.test(expression)) throw new Error();

        expression = String(
          Function(`"use strict";return (${expression})`)()
        );

        display.value = expression;
      } catch {
        display.value = 'Error';
        expression = '';
      }
      return;
    }

    expression += key;
    display.value = expression;
  };

  const notes = ctx.host.querySelector('#calcNotes');
  notes.value = localStorage.getItem('aya.calc.notes') || '';

  ctx.host.querySelector('#saveCalcNotes').onclick = () => {
    localStorage.setItem('aya.calc.notes', notes.value);
    ctx.notify('Catatan disimpan di perangkat');
  };
}

/* ============================================================
   DOKUMEN
   ============================================================ */

export function renderDocuments(ctx) {
  ctx.host.innerHTML = `
    <div class="grid two">
      <article class="card">
        <h2>Surat Perjanjian Kerja</h2>
        <p class="muted">Template dapat diisi lalu dicetak.</p>

        <div class="form-grid">
          <label>
            Nama Karyawan
            <input id="contractName">
          </label>

          <label>
            Jabatan
            <input id="contractPosition" value="Karyawan">
          </label>

          <label>
            Gaji Harian
            <input id="contractWage">
          </label>

          <label>
            Tanggal Mulai
            <input id="contractDate" type="date">
          </label>
        </div>

        <button id="printContract" class="primary-button" style="margin-top:12px">
          Buat & Cetak
        </button>
      </article>

      <article class="card">
        <h2>SOP Profesional</h2>
        <p>
          Standar pembukaan, kebersihan, pelayanan, transaksi, stok,
          dapur, penutupan, dan keselamatan kerja.
        </p>
        <button id="printSOP" class="secondary-button">Cetak SOP</button>
      </article>
    </div>
  `;

  ctx.host.querySelector('#printContract').onclick = () =>
    printDocument(
      'SURAT PERJANJIAN KERJA',
      `Pada hari ini, ${new Date().toLocaleDateString('id-ID')}, AYA GROUP dan ${
        escapeHTML(ctx.host.querySelector('#contractName').value || '________________')
      } sepakat mengadakan hubungan kerja sebagai ${
        escapeHTML(ctx.host.querySelector('#contractPosition').value || 'Karyawan')
      }. Gaji harian sebesar ${
        rupiah(ctx.host.querySelector('#contractWage').value)
      }. Karyawan wajib menaati SOP, menjaga aset, kejujuran transaksi, kebersihan, dan kerahasiaan data usaha.`
    );

  ctx.host.querySelector('#printSOP').onclick = () =>
    printDocument(
      'STANDAR OPERASIONAL PROSEDUR AYA GROUP',
      `1. Pembukaan: hadir tepat waktu, cek kebersihan, kas awal, perangkat kasir, dan stok kritis.<br>
       2. Pelayanan: sapa pelanggan, konfirmasi pesanan, harga, jenis pesanan, dan metode pembayaran.<br>
       3. Kasir: setiap transaksi wajib masuk sistem; dilarang menghapus transaksi tanpa izin supervisor/owner.<br>
       4. Dapur: gunakan bahan FIFO/FEFO, jaga higienitas, dan perbarui status Kitchen Display.<br>
       5. Stok: penerimaan dan transfer harus dihitung serta disetujui.<br>
       6. Penutupan: cocokkan uang riil dengan laporan Tunai/QRIS/Hutang/Personal, catat selisih, bersihkan area, dan amankan peralatan.`
    );
}

function printDocument(title, body) {
  const popup = window.open('', '_blank');

  popup.document.write(`
    <style>
      body{font:14px Arial;line-height:1.7;margin:25mm}
      h1{text-align:center;font-size:20px}
      .sign{display:flex;justify-content:space-between;margin-top:70px}
    </style>
    <h1>${title}</h1>
    <p>${body}</p>
    <div class="sign">
      <span>Owner<br><br><br>____________</span>
      <span>Karyawan<br><br><br>____________</span>
    </div>
    <script>onload=()=>print()</script>
  `);

  popup.document.close();
}
