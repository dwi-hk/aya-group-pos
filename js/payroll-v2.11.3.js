import {
  getOnce,
  pushData,
  removeData,
  setData
} from './store.js';

import {
  escapeHTML,
  number,
  rupiah,
  toArray
} from './utils.js';

const DEVICE_NAME_KEY = 'aya.payroll.deviceName';
const DEFAULT_CHECK_IN = '09:00';
const DEFAULT_CHECK_OUT = '22:00';

const text = value => String(value ?? '').trim();
const sum = (rows, selector) =>
  rows.reduce((total, row) => total + number(selector(row)), 0);

function pad(value) {
  return String(value).padStart(2, '0');
}

function previousDate(date) {
  const [year, month, day] = text(date).split('-').map(Number);
  const value = new Date(year, month - 1, day, 12, 0, 0);
  value.setDate(value.getDate() - 1);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function timeWithSeconds(value) {
  const [hour = '00', minute = '00', second = '00'] = text(value).split(':');
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function attendanceTimestamp(date, time) {
  const timestamp = new Date(`${date}T${timeWithSeconds(time)}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function deviceStamp() {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return {
    date,
    time,
    timestamp: now.getTime(),
    iso: now.toISOString(),
    display: now.toLocaleString('id-ID', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta'
  };
}

function detectedDeviceName() {
  const platform = navigator.userAgentData?.platform
    || navigator.platform
    || 'Device';
  const agent = navigator.userAgent || '';
  const browser = agent.includes('Firefox/')
    ? 'Firefox'
    : agent.includes('Edg/')
      ? 'Edge'
      : agent.includes('Chrome/')
        ? 'Chrome'
        : agent.includes('Safari/')
          ? 'Safari'
          : 'Browser';

  return `${platform} · ${browser}`;
}

function hoursBetween(checkIn, checkOut) {
  const [inHour, inMinute] = text(checkIn || DEFAULT_CHECK_IN).split(':').map(Number);
  const [outHour, outMinute] = text(checkOut || DEFAULT_CHECK_OUT).split(':').map(Number);

  if (![inHour, inMinute, outHour, outMinute].every(Number.isFinite)) return 0;

  const start = inHour * 60 + inMinute;
  let finish = outHour * 60 + outMinute;
  if (finish < start) finish += 24 * 60;

  return Math.max(0, (finish - start) / 60);
}

function attendanceWage(row) {
  if (row?.netWage !== undefined) return number(row.netWage);
  return Math.max(0, number(row?.dailyWage) - number(row?.deduction));
}

function employeeId(row) {
  return text(row?.employeeId)
    || `name:${text(row?.employeeName).toLowerCase()}`;
}

function salaryPaymentDate(row) {
  if (row?.attendanceV2 || row?.attendanceV3) {
    return text(row.salaryPaymentDate);
  }

  return text(row?.salaryPaymentDate || row?.date);
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadCSV(filename, rows) {
  const blob = new Blob(
    [`\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\n')}`],
    { type: 'text/csv;charset=utf-8' }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function renderPayrollAttendance(ctx) {
  if (ctx.branch.id === 'all') {
    ctx.host.innerHTML = `
      <article class="card aya-payroll-view">
        <h2>Pilih satu cabang</h2>
        <p class="muted">Absensi, gaji, dan kasbon harus dicatat pada cabang tertentu.</p>
      </article>
    `;
    return;
  }

  const [employeesRaw, attendanceRaw, paymentsRaw, reportAdjustmentsRaw] = await Promise.all([
    getOnce('employees', { force: true }),
    getOnce(`attendance/${ctx.branch.id}`, { force: true }),
    getOnce(`payrollPayments/${ctx.branch.id}`, { force: true }),
    getOnce(`payrollReportAdjustments/${ctx.branch.id}`, { force: true })
  ]);

  let employees = toArray(employeesRaw)
    .filter(row => row.active !== false)
    .sort((a, b) => text(a.name).localeCompare(text(b.name), 'id'));

  let attendance = toArray(attendanceRaw)
    .sort((a, b) => number(b.createdAt) - number(a.createdAt));

  let payments = toArray(paymentsRaw)
    .sort((a, b) => number(b.createdAt) - number(a.createdAt));

  let reportAdjustments = toArray(reportAdjustmentsRaw);

  const isOwner = text(ctx.user?.role).toLowerCase() === 'owner';
  let activeTab = isOwner ? 'running' : 'attendance';
  let saving = false;
  let clockTimer = null;
  let selectedAttendanceEmployeeId = employees[0]?.id || '';
  let selectedReportEmployeeId = '';
  let selectedBackfillEmployeeId = employees.find(employee =>
    text(employee.name).toLowerCase() === 'deni'
  )?.id || employees[0]?.id || '';
  let selectedBackfillDate = '';
  let deviceName = localStorage.getItem(DEVICE_NAME_KEY)
    || detectedDeviceName();

  const currentEmployee = id =>
    employees.find(row => String(row.id) === String(id));

  const rowBelongsToEmployee = (row, employee) => {
    if (!row || !employee) return false;
    const rowEmployeeId = text(row.employeeId);
    if (rowEmployeeId) return rowEmployeeId === String(employee.id);
    return text(row.employeeName).toLowerCase() === text(employee.name).toLowerCase();
  };

  const employeeForRecord = row =>
    employees.find(employee => rowBelongsToEmployee(row, employee));

  const attendanceTodayFor = (employee, date) => {
    const rows = attendance.filter(row => (
      row.reportHidden !== true
      &&
      row.attendanceV4 === true
      && employeeId(row) === String(employee?.id || '')
    ));
    return rows.find(row => row.checkIn && !row.checkOut && row.status !== 'completed')
      || rows.find(row => text(row.date) === text(date));
  };

  const unpaidAttendance = employee => attendance.filter(row =>
    rowBelongsToEmployee(row, employee)
    && row.reportHidden !== true
    && !salaryPaymentDate(row)
  );

  const employeePayments = employee => payments.filter(row =>
    rowBelongsToEmployee(row, employee)
  );

  const runningFor = employee => {
    const sourceRows = unpaidAttendance(employee);
    const wage = sum(sourceRows, attendanceWage);
    const paid = sum(employeePayments(employee), row => row.amount);

    return {
      employee,
      sourceRows,
      wage,
      paid,
      remaining: Math.max(0, wage - paid),
      cashAdvance: number(employee.cashAdvance)
    };
  };

  const runningRows = () => employees
    .map(runningFor)
    .filter(row => row.remaining > 0 || row.cashAdvance > 0);

  const rowMoment = row => {
    const stored = number(
      row?.completedAt
      || row?.checkOutTimestamp
      || row?.paymentTimestamp
      || row?.createdAt
    );
    if (stored > 0) return stored;

    const date = text(row?.paymentDate || row?.date);
    const time = text(row?.paymentTime || row?.recordedTime || row?.checkOut || '00:00:00');
    const parsed = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}`);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const grossAttendanceWage = row => row?.dailyWage !== undefined
    ? number(row.dailyWage)
    : attendanceWage(row) + number(row?.deduction) + number(row?.cashAdvanceGiven);

  const salarySummaryFor = employee => {
    if (!employee) {
      return {
        totalSalary: 0,
        totalCashAdvance: 0,
        totalNetSalary: 0,
        latestCashAdvance: 0,
        latestCashAdvanceDate: '-'
      };
    }

    const paymentRows = employeePayments(employee);
    const latestFullPayment = paymentRows
      .filter(row => row.remainingAfter !== undefined && number(row.remainingAfter) <= 0)
      .sort((a, b) => rowMoment(b) - rowMoment(a))[0];
    const cutoff = latestFullPayment ? rowMoment(latestFullPayment) : 0;
    const sourceRows = attendance.filter(row => (
      row.reportHidden !== true
      && rowBelongsToEmployee(row, employee)
      && !salaryPaymentDate(row)
      && (row.status === 'completed' || row.checkOut || row.attendanceV4 !== true)
      && rowMoment(row) > cutoff
    ));
    const paymentsAfterCutoff = paymentRows.filter(row => rowMoment(row) > cutoff);
    const totalSalary = Math.max(
      0,
      sum(sourceRows, grossAttendanceWage)
        - sum(paymentsAfterCutoff, row => row.amount)
    );
    const totalCashAdvance = Math.max(
      0,
      cutoff > 0
        ? sum(sourceRows, row => number(row.cashAdvanceGiven) - number(row.deduction))
        : number(employee.cashAdvance)
    );
    const latestCashAdvanceRow = sourceRows
      .filter(row => number(row.cashAdvanceGiven) > 0)
      .sort((a, b) => rowMoment(b) - rowMoment(a))[0];

    return {
      totalSalary,
      totalCashAdvance,
      totalNetSalary: Math.max(0, totalSalary - totalCashAdvance),
      latestCashAdvance: number(latestCashAdvanceRow?.cashAdvanceGiven),
      latestCashAdvanceDate: text(
        latestCashAdvanceRow?.cashAdvancePaymentDate
        || latestCashAdvanceRow?.date
      ) || '-'
    };
  };

  const historicalPayments = () => {
    const legacy = attendance
      .filter(row => row.reportHidden !== true && salaryPaymentDate(row))
      .map(row => {
        const id = `legacy-${row.id || row.createdAt}`;
        const adjustment = reportAdjustments.find(item =>
          String(item.id) === id || String(item.legacyReportId) === id
        );
        if (adjustment?.hidden === true) return null;

        return {
          id,
          isLegacy: true,
          legacySourceId: row.id || '',
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          paymentDate: adjustment?.paymentDate || salaryPaymentDate(row),
          paymentTime: adjustment?.paymentTime || row.paymentTime || row.recordedTime || '',
          amount: adjustment?.amount ?? attendanceWage(row),
          remainingAfter: adjustment?.remainingAfter ?? 0,
          deviceName: adjustment?.deviceName || row.deviceName || 'Data lama',
          deviceTimezone: adjustment?.deviceTimezone || row.deviceTimezone || '',
          notes: adjustment?.notes ?? row.notes ?? 'Pembayaran dari data lama',
          createdBy: adjustment?.editedBy || row.createdBy || '',
          createdAt: number(row.createdAt)
        };
      })
      .filter(Boolean);

    return [...payments, ...legacy].sort((a, b) =>
      text(b.paymentDate).localeCompare(text(a.paymentDate))
      || number(b.createdAt) - number(a.createdAt)
    );
  };

  const updateClock = () => {
    if (!ctx.host.isConnected) {
      clearInterval(clockTimer);
      return;
    }

    const stamp = deviceStamp();
    ctx.host.querySelectorAll('[data-device-date]').forEach(node => {
      node.textContent = stamp.date;
    });
    ctx.host.querySelectorAll('[data-device-time]').forEach(node => {
      node.textContent = stamp.time;
    });
    ctx.host.querySelectorAll('[data-device-display]').forEach(node => {
      node.textContent = stamp.display;
    });

    const form = ctx.host.querySelector('#attendanceV3Form');
    const employeeSelect = form?.querySelector('[name="employeeId"]');
    const hoursInput = form?.querySelector('[name="hoursWorked"]');
    const employee = currentEmployee(employeeSelect?.value);
    const record = attendanceTodayFor(employee, stamp.date);
    if (hoursInput && record?.checkInTimestamp && !record?.checkOutTimestamp) {
      hoursInput.value = Math.max(
        0,
        (stamp.timestamp - number(record.checkInTimestamp)) / 3600000
      ).toFixed(2);
    }
  };

  const activateTab = tab => {
    if (!isOwner && (tab === 'running' || tab === 'report')) {
      activeTab = 'attendance';
      ctx.notify('Laporan gaji berjalan hanya dapat dibuka oleh Owner.', 'error');
      tab = 'attendance';
    }
    activeTab = tab;
    ctx.host.querySelectorAll('[data-payroll-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.payrollTab === tab);
    });
    ctx.host.querySelectorAll('[data-payroll-panel]').forEach(panel => {
      panel.hidden = panel.dataset.payrollPanel !== tab;
    });
  };

  const draw = () => {
    clearInterval(clockTimer);

    const stamp = deviceStamp();
    const running = runningRows();
    const reports = historicalPayments();
    if (selectedReportEmployeeId && !currentEmployee(selectedReportEmployeeId)) {
      selectedReportEmployeeId = '';
    }
    const selectedReportEmployee = currentEmployee(selectedReportEmployeeId);
    const selectedAttendanceHistory = selectedReportEmployee
      ? attendance.filter(row =>
        row.reportHidden !== true
        && rowBelongsToEmployee(row, selectedReportEmployee)
      )
      : [];
    const selectedPaymentReports = selectedReportEmployee
      ? reports.filter(row =>
        rowBelongsToEmployee(row, selectedReportEmployee)
      )
      : [];
    const currentMonth = stamp.date.slice(0, 7);
    const paidThisMonth = sum(
      reports.filter(row => text(row.paymentDate).startsWith(currentMonth)),
      row => row.amount
    );
    const totalRunning = sum(running, row => row.remaining);
    const totalCashAdvance = sum(employees, row => row.cashAdvance);
    if (!currentEmployee(selectedAttendanceEmployeeId)) {
      selectedAttendanceEmployeeId = employees[0]?.id || '';
    }
    const selectedAttendanceEmployee = currentEmployee(selectedAttendanceEmployeeId);
    const selectedSalarySummary = salarySummaryFor(selectedAttendanceEmployee);
    const attendanceToday = attendanceTodayFor(selectedAttendanceEmployee, stamp.date);
    const attendanceStillOpen = Boolean(
      attendanceToday?.checkIn
      && !attendanceToday?.checkOut
      && attendanceToday?.status !== 'completed'
    );
    const attendanceCompleted = Boolean(attendanceToday?.checkOut || attendanceToday?.status === 'completed');
    const backfillYesterday = previousDate(stamp.date);
    if (![backfillYesterday, stamp.date].includes(selectedBackfillDate)) {
      selectedBackfillDate = backfillYesterday;
    }
    if (!currentEmployee(selectedBackfillEmployeeId)) {
      selectedBackfillEmployeeId = employees[0]?.id || '';
    }
    const selectedBackfillEmployee = currentEmployee(selectedBackfillEmployeeId);

    ctx.host.innerHTML = `
      <section class="aya-payroll-view">
        <header class="aya-payroll-head">
          <div>
            <span class="aya-eyebrow">BACK OFFICE · ${escapeHTML(ctx.branch.name)}</span>
            <h2>GAJI & KASBON</h2>
            <p>Absensi, saldo berjalan, pembayaran gaji, dan laporan tersimpan per cabang.</p>
          </div>
          <div class="aya-device-panel">
            <div>
              <span>WAKTU DEVICE</span>
              <strong data-device-display>${escapeHTML(stamp.display)}</strong>
              <small>${escapeHTML(stamp.timezone)}</small>
            </div>
            <label>
              NAMA DEVICE
              <input id="payrollDeviceName" value="${escapeHTML(deviceName)}">
            </label>
            <button id="savePayrollDevice" type="button" class="primary-button">Simpan Device</button>
          </div>
        </header>

        <nav class="aya-payroll-tabs" aria-label="Subtab Gaji dan Kasbon">
          ${isOwner ? '<button type="button" data-payroll-tab="running">Saldo Berjalan</button>' : ''}
          <button type="button" data-payroll-tab="attendance">Absensi</button>
          <button type="button" data-payroll-tab="payment">GAJI DIBAYAR</button>
          ${isOwner ? '<button type="button" data-payroll-tab="report">Laporan</button>' : ''}
        </nav>

        <div class="aya-payroll-metrics">
          <article><span>GAJI BELUM DIBAYAR</span><strong>${rupiah(totalRunning)}</strong></article>
          <article><span>KASBON BERJALAN</span><strong>${rupiah(totalCashAdvance)}</strong></article>
          <article><span>KARYAWAN AKTIF</span><strong>${employees.length}</strong></article>
          <article><span>GAJI DIBAYAR BULAN INI</span><strong>${rupiah(paidThisMonth)}</strong></article>
        </div>

        ${isOwner ? `<section data-payroll-panel="running">
          <article class="aya-payroll-card">
            <div class="aya-card-title">
              <div>
                <span class="aya-eyebrow">BELUM SELESAI</span>
                <h3>Gaji & Kasbon Berjalan</h3>
                <p>Hanya saldo yang belum dibayar atau kasbon yang belum lunas yang tampil.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table class="aya-payroll-table">
                <thead>
                  <tr>
                    <th>Karyawan</th>
                    <th>Keterangan Berjalan</th>
                    <th>Gaji Tercatat</th>
                    <th>Sudah Dibayar</th>
                    <th>Sisa Gaji</th>
                    <th>Kasbon Berjalan</th>
                  </tr>
                </thead>
                <tbody>
                  ${running.map(row => `
                    <tr>
                      <td><strong>${escapeHTML(row.employee.name || '-')}</strong><br><small>${escapeHTML(row.employee.position || 'Karyawan')}</small></td>
                      <td>${row.sourceRows.map(item => `${escapeHTML(item.date || '-')} · ${escapeHTML(item.notes || 'Gaji harian')}`).join('<br>') || 'Kasbon masih berjalan'}</td>
                      <td>${rupiah(row.wage)}</td>
                      <td>${rupiah(row.paid)}</td>
                      <td><strong class="aya-orange">${rupiah(row.remaining)}</strong></td>
                      <td>${rupiah(row.cashAdvance)}</td>
                    </tr>
                  `).join('') || '<tr><td colspan="6" class="aya-empty">Tidak ada gaji atau kasbon yang masih berjalan.</td></tr>'}
                </tbody>
              </table>
            </div>
          </article>
        </section>` : ''}

        <section data-payroll-panel="attendance" hidden>
          <div class="aya-payroll-grid">
            ${isOwner ? `<form id="attendanceBackfillForm" class="aya-payroll-card aya-payroll-form aya-attendance-backfill">
              <div class="aya-card-title">
                <div>
                  <span class="aya-eyebrow">FORM SEKALI PAKAI · KHUSUS OWNER</span>
                  <h3>Input Absensi Susulan</h3>
                  <p>Untuk memasukkan absensi kemarin atau hari ini. Sistem menolak data karyawan dan tanggal yang sama.</p>
                </div>
              </div>
              <div class="aya-backfill-notice full">
                <strong>BATAS TANGGAL: ${escapeHTML(backfillYesterday)} s.d. ${escapeHTML(stamp.date)}</strong>
                <span>Data disimpan langsung ke Firebase sebagai absensi selesai dan gaji berjalan yang belum dibayar.</span>
              </div>
              <label>Nama Karyawan
                <select name="employeeId" required>
                  ${employees.map(employee => `<option value="${escapeHTML(employee.id)}" ${String(employee.id) === String(selectedBackfillEmployeeId) ? 'selected' : ''}>${escapeHTML(employee.name)}</option>`).join('')}
                </select>
              </label>
              <label>Tanggal Absensi
                <input name="date" type="date" value="${escapeHTML(selectedBackfillDate)}" min="${escapeHTML(backfillYesterday)}" max="${escapeHTML(stamp.date)}" required>
              </label>
              <label>Jam Masuk
                <input name="checkIn" type="time" value="${DEFAULT_CHECK_IN}" required>
              </label>
              <label>Jam Pulang
                <input name="checkOut" type="time" value="${DEFAULT_CHECK_OUT}" required>
              </label>
              <label>Total Jam
                <input name="hoursWorked" value="${hoursBetween(DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT).toFixed(2)}" readonly>
              </label>
              <label>Gaji Per Hari
                <input name="dailyWage" inputmode="numeric" value="${number(selectedBackfillEmployee?.dailyWage)}" required>
              </label>
              <label>Gaji Bersih
                <input name="netWage" value="${rupiah(selectedBackfillEmployee?.dailyWage)}" readonly>
              </label>
              <label>Keterangan
                <input name="notes" value="Absensi susulan oleh Owner" placeholder="Keterangan absensi susulan">
              </label>
              <button id="saveAttendanceBackfill" class="primary-button full" ${employees.length ? '' : 'disabled'}>SIMPAN ABSENSI SUSULAN KE FIREBASE</button>
            </form>` : ''}

            <form id="attendanceV3Form" class="aya-payroll-card aya-payroll-form">
              <div class="aya-card-title">
                <div><span class="aya-eyebrow">WAKTU DEVICE</span><h3>Catat Absensi & Gaji Berjalan</h3></div>
              </div>
              <div class="aya-stamp">
                <div><span>TANGGAL DEVICE</span><strong data-device-date>${stamp.date}</strong></div>
                <div><span>JAM DEVICE</span><strong data-device-time>${stamp.time}</strong></div>
                <div><span>NAMA DEVICE</span><strong>${escapeHTML(deviceName)}</strong></div>
              </div>
              <label>Nama Karyawan
                <select name="employeeId" required>
                  ${employees.map(employee => `<option value="${escapeHTML(employee.id)}" ${String(employee.id) === String(selectedAttendanceEmployeeId) ? 'selected' : ''}>${escapeHTML(employee.name)}</option>`).join('')}
                </select>
              </label>
              <label>Tanggal Absensi
                <input name="date" type="date" value="${escapeHTML(attendanceToday?.date || stamp.date)}" readonly>
              </label>
              <label>Jam Masuk
                <input name="checkIn" type="text" value="${escapeHTML(attendanceToday?.checkIn || '--:--:--')}" readonly tabindex="-1">
              </label>
              <label>Jam Pulang
                <input name="checkOut" type="text" value="${escapeHTML(attendanceToday?.checkOut || '--:--:--')}" readonly tabindex="-1">
              </label>
              <label>Total Jam
                <input name="hoursWorked" value="${number(attendanceToday?.hoursWorked).toFixed(2)}" readonly tabindex="-1">
              </label>
              <div class="aya-attendance-live full" data-state="${attendanceCompleted ? 'completed' : attendanceStillOpen ? 'working' : 'waiting'}">
                <div><span>STATUS ABSENSI REAL-TIME</span><strong>${attendanceCompleted ? 'ABSENSI HARI INI SELESAI' : attendanceStillOpen ? 'SUDAH MASUK · BELUM PULANG' : 'BELUM MENCATAT JAM MASUK'}</strong></div>
                <small>Jam diambil langsung dari waktu device saat tombol ditekan dan tidak dapat diedit.</small>
              </div>
              <section class="aya-daily-payroll-summary full">
                <div class="aya-daily-total-list">
                  <article>
                    <div><span>Total Gaji per hari ini</span><small>Total gaji setelah pembayaran gaji lunas sebelumnya.</small></div>
                    <strong id="attendanceTotalSalary">${rupiah(selectedSalarySummary.totalSalary)}</strong>
                  </article>
                  <article>
                    <div><span>Total Kasbon per hari ini</span><small>Total kasbon setelah potongan gaji sebelumnya.</small></div>
                    <strong id="attendanceTotalCashAdvance">${rupiah(selectedSalarySummary.totalCashAdvance)}</strong>
                  </article>
                  <article class="aya-daily-net-row">
                    <div><span>Total Gaji Bersih per hari ini</span><small>Total gaji setelah dikurangi seluruh kasbon berjalan.</small></div>
                    <strong id="attendanceTotalNetSalary">${rupiah(selectedSalarySummary.totalNetSalary)}</strong>
                  </article>
                </div>
                <div class="aya-latest-cash-advance">
                  <span>KASBON BARU</span>
                  <strong id="attendanceLatestCashAdvance">${rupiah(selectedSalarySummary.latestCashAdvance)}</strong>
                  <span>TANGGAL KASBON</span>
                  <strong id="attendanceLatestCashAdvanceDate">${escapeHTML(selectedSalarySummary.latestCashAdvanceDate)}</strong>
                </div>
              </section>
              <button id="clockInNow" type="button" class="secondary-button full" ${employees.length && !attendanceToday ? '' : 'disabled'}>CATAT JAM MASUK SEKARANG</button>
              <label>Gaji Per Hari
                <input name="dailyWage" inputmode="numeric" value="0" ${isOwner ? '' : 'readonly'}>
              </label>
              <label>Kasbon Baru
                <input name="cashAdvanceGiven" inputmode="numeric" value="0">
              </label>
              <label>Bonus
                <input name="bonus" inputmode="numeric" value="0">
              </label>
              <label>Sisa Gaji Berjalan
                <input name="runningSalaryAfterCashAdvance" value="${rupiah(0)}" readonly>
              </label>
              <label class="full">Keterangan
                <input name="notes" placeholder="Contoh: masuk kerja, lembur, izin, atau kasbon">
              </label>
              <div class="aya-wage-preview full">
                <span>Gaji Bersih Hari Ini</span>
                <strong id="attendanceNetPreview">${rupiah(0)}</strong>
              </div>
              <button id="saveAttendanceV3" class="primary-button full" ${employees.length && attendanceStillOpen ? '' : 'disabled'}>CATAT JAM PULANG &amp; SIMPAN GAJI</button>
            </form>

            <article class="aya-payroll-card">
              <div class="aya-card-title"><div><span class="aya-eyebrow">RIWAYAT</span><h3>Absensi Terbaru</h3></div></div>
              <div class="aya-employee-report-filter">
                <span>KLIK NAMA KARYAWAN UNTUK MELIHAT RIWAYAT</span>
                <div>
                  ${employees.map(employee => `
                    <button type="button" data-report-employee="${escapeHTML(employee.id)}" class="${String(employee.id) === String(selectedReportEmployeeId) ? 'active' : ''}">
                      ${escapeHTML(employee.name)}
                    </button>
                  `).join('')}
                </div>
              </div>
              <div class="table-wrap">
                <table class="aya-payroll-table aya-attendance-report-table">
                  <thead><tr>${isOwner ? '<th class="aya-attendance-action-column">Aksi Owner</th>' : ''}<th>Tanggal & Jam</th><th>Karyawan</th><th>Jam Kerja</th><th>Gaji Bersih</th><th>Device</th></tr></thead>
                  <tbody>
                    ${selectedAttendanceHistory.slice(0, 100).map(row => `
                      <tr>
                        ${isOwner ? `
                          <td class="aya-attendance-action-column">
                            <div class="aya-report-actions">
                              <button type="button" class="secondary-button" data-edit-attendance="${escapeHTML(row.id)}">Edit</button>
                              <button type="button" class="danger-button" data-delete-attendance="${escapeHTML(row.id)}">Hapus</button>
                            </div>
                          </td>
                        ` : ''}
                        <td>${escapeHTML(row.date || '-')}<br><small>${escapeHTML(row.recordedTime || row.deviceTime || '-')}</small></td>
                        <td>${escapeHTML(row.employeeName || '-')}</td>
                        <td>${escapeHTML(row.checkIn || '-')}–${escapeHTML(row.checkOut || '-')}<br><small>${number(row.hoursWorked).toFixed(1)} jam</small></td>
                        <td>${rupiah(attendanceWage(row))}</td>
                        <td>${escapeHTML(row.deviceName || 'Data lama')}</td>
                      </tr>
                    `).join('') || `<tr><td colspan="${isOwner ? 6 : 5}" class="aya-empty">${selectedReportEmployee ? `Belum ada riwayat absensi untuk ${escapeHTML(selectedReportEmployee.name)}.` : 'Klik nama karyawan terlebih dahulu untuk menampilkan riwayat absensi.'}</td></tr>`}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>

        <section data-payroll-panel="payment" hidden>
          <div class="aya-payroll-grid">
            <form id="paySalaryForm" class="aya-payroll-card aya-payroll-form">
              <div class="aya-card-title">
                <div><span class="aya-eyebrow">PEMBAYARAN</span><h3>GAJI DIBAYAR</h3><p>Setiap pembayaran tersimpan dalam laporan dan mengurangi saldo berjalan.</p></div>
              </div>
              <div class="aya-stamp">
                <div><span>TANGGAL DEVICE</span><strong data-device-date>${stamp.date}</strong></div>
                <div><span>JAM BAYAR</span><strong data-device-time>${stamp.time}</strong></div>
                <div><span>DEVICE</span><strong>${escapeHTML(deviceName)}</strong></div>
              </div>
              <label>Nama Karyawan
                <select name="employeeId" required>
                  ${employees.map(employee => `<option value="${escapeHTML(employee.id)}">${escapeHTML(employee.name)}</option>`).join('')}
                </select>
              </label>
              <label>Sisa Gaji Berjalan
                <input name="runningBalance" value="${rupiah(0)}" readonly>
              </label>
              <label>Tanggal Pembayaran Gaji
                <input name="paymentDate" type="date" value="${escapeHTML(stamp.date)}" max="${escapeHTML(stamp.date)}" required>
              </label>
              <label>Nilai Gaji Dibayar
                <input name="amount" inputmode="numeric" value="0" required>
              </label>
              <label class="full">Keterangan Pembayaran
                <input name="notes" placeholder="Contoh: Gajian mingguan / pembayaran sebagian">
              </label>
              <button id="saveSalaryPayment" class="primary-button full" ${employees.length ? '' : 'disabled'}>SIMPAN GAJI DIBAYAR</button>
            </form>

            ${isOwner ? `<article class="aya-payroll-card">
              <div class="aya-card-title"><div><span class="aya-eyebrow">TERBARU</span><h3>Pembayaran Gaji</h3></div></div>
              <div class="aya-employee-report-filter">
                <span>KLIK NAMA KARYAWAN UNTUK MELIHAT PEMBAYARAN</span>
                <div>
                  ${employees.map(employee => `
                    <button type="button" data-report-employee="${escapeHTML(employee.id)}" class="${String(employee.id) === String(selectedReportEmployeeId) ? 'active' : ''}">
                      ${escapeHTML(employee.name)}
                    </button>
                  `).join('')}
                </div>
              </div>
              <div class="table-wrap">
                <table class="aya-payroll-table">
                  <thead><tr><th>Tanggal & Jam</th><th>Karyawan</th><th>Nilai Dibayar</th><th>Sisa</th><th>Device</th></tr></thead>
                  <tbody>
                    ${selectedPaymentReports.slice(0, 100).map(row => `
                      <tr>
                        <td>${escapeHTML(row.paymentDate || '-')}<br><small>${escapeHTML(row.paymentTime || '-')}</small></td>
                        <td>${escapeHTML(row.employeeName || '-')}</td>
                        <td><strong>${rupiah(row.amount)}</strong></td>
                        <td>${rupiah(row.remainingAfter || 0)}</td>
                        <td>${escapeHTML(row.deviceName || 'Data lama')}</td>
                      </tr>
                    `).join('') || `<tr><td colspan="5" class="aya-empty">${selectedReportEmployee ? `Belum ada pembayaran gaji untuk ${escapeHTML(selectedReportEmployee.name)}.` : 'Klik nama karyawan terlebih dahulu untuk menampilkan pembayaran gaji.'}</td></tr>`}
                  </tbody>
                </table>
              </div>
            </article>` : ''}
          </div>
        </section>

        ${isOwner ? `<section data-payroll-panel="report" hidden>
          <article class="aya-payroll-card">
            <div class="aya-card-title">
              <div><span class="aya-eyebrow">LAPORAN TERSIMPAN</span><h3>Laporan Lengkap GAJI DIBAYAR</h3><p>Data pembayaran tetap tersimpan walaupun sudah tidak tampil pada Keterangan Berjalan.</p></div>
              <button id="exportPayrollPayments" type="button" class="secondary-button" ${selectedReportEmployee ? '' : 'disabled'}>Unduh CSV</button>
            </div>
            <div class="aya-employee-report-filter">
              <span>KLIK NAMA KARYAWAN UNTUK MEMBUKA LAPORAN</span>
              <div>
                ${employees.map(employee => `
                  <button type="button" data-report-employee="${escapeHTML(employee.id)}" class="${String(employee.id) === String(selectedReportEmployeeId) ? 'active' : ''}">
                    ${escapeHTML(employee.name)}
                  </button>
                `).join('')}
              </div>
            </div>
            <div class="table-wrap">
              <table class="aya-payroll-table aya-payroll-report-table">
                <thead>
                  <tr><th class="aya-report-action-column">Aksi Owner</th><th>Tanggal</th><th>Jam</th><th>Karyawan</th><th>Nilai Dibayar</th><th>Sisa Setelah Bayar</th><th>Keterangan</th><th>Nama Device</th><th>Timezone</th><th>Dicatat Oleh</th></tr>
                </thead>
                <tbody>
                  ${selectedPaymentReports.map(row => `
                    <tr>
                      <td class="aya-report-action-column">
                        <div class="aya-report-actions">
                          <button type="button" class="secondary-button" data-edit-payment="${escapeHTML(row.id)}">Edit</button>
                          <button type="button" class="danger-button" data-delete-payment="${escapeHTML(row.id)}">Hapus</button>
                        </div>
                      </td>
                      <td>${escapeHTML(row.paymentDate || '-')}</td>
                      <td>${escapeHTML(row.paymentTime || '-')}</td>
                      <td>${escapeHTML(row.employeeName || '-')}</td>
                      <td>${rupiah(row.amount)}</td>
                      <td>${rupiah(row.remainingAfter || 0)}</td>
                      <td>${escapeHTML(row.notes || '-')}</td>
                      <td>${escapeHTML(row.deviceName || 'Data lama')}</td>
                      <td>${escapeHTML(row.deviceTimezone || '-')}</td>
                      <td>${escapeHTML(row.createdBy || '-')}</td>
                    </tr>
                  `).join('') || `<tr><td colspan="10" class="aya-empty">${selectedReportEmployee ? `Belum ada pembayaran gaji untuk ${escapeHTML(selectedReportEmployee.name)}.` : 'Klik nama karyawan terlebih dahulu untuk menampilkan laporan gaji.'}</td></tr>`}
                </tbody>
              </table>
            </div>
          </article>
        </section>` : ''}
      </section>
    `;

    ctx.host.querySelectorAll('[data-payroll-tab]').forEach(button => {
      button.onclick = () => activateTab(button.dataset.payrollTab);
    });

    ctx.host.querySelectorAll('[data-report-employee]').forEach(button => {
      button.onclick = () => {
        selectedReportEmployeeId = button.dataset.reportEmployee;
        draw();
      };
    });

    ctx.host.querySelector('#savePayrollDevice').onclick = () => {
      const value = text(ctx.host.querySelector('#payrollDeviceName').value);
      if (!value) return ctx.notify('Nama device wajib diisi.', 'error');
      deviceName = value;
      localStorage.setItem(DEVICE_NAME_KEY, deviceName);
      ctx.notify('Nama device berhasil disimpan.');
      draw();
    };

    const attendanceForm = ctx.host.querySelector('#attendanceV3Form');
    const attendanceEmployee = attendanceForm.querySelector('[name="employeeId"]');
    const dailyWage = attendanceForm.querySelector('[name="dailyWage"]');
    const checkIn = attendanceForm.querySelector('[name="checkIn"]');
    const checkOut = attendanceForm.querySelector('[name="checkOut"]');
    const hoursWorked = attendanceForm.querySelector('[name="hoursWorked"]');
    const cashAdvanceGivenInput = attendanceForm.querySelector('[name="cashAdvanceGiven"]');
    const runningSalaryAfterCashAdvance = attendanceForm.querySelector('[name="runningSalaryAfterCashAdvance"]');
    const clockInButton = attendanceForm.querySelector('#clockInNow');

    const backfillForm = ctx.host.querySelector('#attendanceBackfillForm');
    if (isOwner && backfillForm) {
      const backfillEmployee = backfillForm.querySelector('[name="employeeId"]');
      const backfillDate = backfillForm.querySelector('[name="date"]');
      const backfillCheckIn = backfillForm.querySelector('[name="checkIn"]');
      const backfillCheckOut = backfillForm.querySelector('[name="checkOut"]');
      const backfillHours = backfillForm.querySelector('[name="hoursWorked"]');
      const backfillDailyWage = backfillForm.querySelector('[name="dailyWage"]');
      const backfillNetWage = backfillForm.querySelector('[name="netWage"]');

      const updateBackfillPreview = ({ reloadWage = false } = {}) => {
        const employee = currentEmployee(backfillEmployee.value);
        selectedBackfillEmployeeId = backfillEmployee.value;
        selectedBackfillDate = backfillDate.value;
        if (reloadWage) backfillDailyWage.value = number(employee?.dailyWage);
        backfillHours.value = hoursBetween(
          backfillCheckIn.value,
          backfillCheckOut.value
        ).toFixed(2);
        backfillNetWage.value = rupiah(number(backfillDailyWage.value));
      };

      backfillEmployee.onchange = () => updateBackfillPreview({ reloadWage: true });
      backfillDate.onchange = updateBackfillPreview;
      backfillCheckIn.oninput = updateBackfillPreview;
      backfillCheckOut.oninput = updateBackfillPreview;
      backfillDailyWage.oninput = updateBackfillPreview;

      backfillForm.onsubmit = async event => {
        event.preventDefault();
        if (saving || !backfillForm.reportValidity()) return;

        const employee = currentEmployee(backfillEmployee.value);
        if (!employee) return ctx.notify('Karyawan tidak ditemukan.', 'error');

        const currentStamp = deviceStamp();
        const allowedDates = [previousDate(currentStamp.date), currentStamp.date];
        const workDate = text(backfillDate.value);
        if (!allowedDates.includes(workDate)) {
          return ctx.notify('Tanggal absensi susulan hanya boleh kemarin atau hari ini.', 'error');
        }

        const duplicate = attendance.some(row =>
          row.reportHidden !== true
          && rowBelongsToEmployee(row, employee)
          && text(row.date) === workDate
        );
        if (duplicate) {
          return ctx.notify(`Absensi ${employee.name} tanggal ${workDate} sudah ada. Data tidak diduplikasi.`, 'error');
        }

        const checkInValue = timeWithSeconds(backfillCheckIn.value);
        const checkOutValue = timeWithSeconds(backfillCheckOut.value);
        const checkInTimestamp = attendanceTimestamp(workDate, checkInValue);
        let checkOutTimestamp = attendanceTimestamp(workDate, checkOutValue);
        const calculatedHours = hoursBetween(checkInValue, checkOutValue);
        if (!checkInTimestamp || !checkOutTimestamp || calculatedHours <= 0) {
          return ctx.notify('Jam masuk dan jam pulang tidak valid.', 'error');
        }
        if (checkOutTimestamp < checkInTimestamp) checkOutTimestamp += 24 * 60 * 60 * 1000;

        const gross = number(backfillDailyWage.value);
        if (gross < 0) return ctx.notify('Nominal gaji tidak boleh negatif.', 'error');

        const auditDeviceName = `${deviceName} · Form Absensi Susulan`;
        const item = {
          attendanceV3: true,
          attendanceV4: true,
          manualAttendanceEntry: true,
          manualAttendanceSource: 'owner-backfill-v2.14.5',
          status: 'completed',
          employeeId: employee.id,
          employeeName: employee.name || '',
          date: workDate,
          checkIn: checkInValue,
          checkOut: checkOutValue,
          checkInTimestamp,
          checkOutTimestamp,
          hoursWorked: calculatedHours,
          dailyWage: gross,
          deduction: 0,
          netWage: gross,
          cashAdvanceGiven: 0,
          cashAdvancePaymentDate: '',
          bonus: 0,
          bonusRecipientId: employee.id,
          bonusRecipientName: employee.name || '',
          bonusPaymentDate: '',
          salaryPaymentDate: '',
          notes: text(backfillForm.elements.notes.value) || 'Absensi susulan oleh Owner',
          branchId: ctx.branch.id,
          branchName: ctx.branch.name,
          checkInDeviceDate: workDate,
          checkInDeviceTime: checkInValue,
          checkInDeviceTimestamp: checkInTimestamp,
          checkInDeviceISO: new Date(checkInTimestamp).toISOString(),
          checkInDeviceTimezone: currentStamp.timezone,
          checkInDeviceName: auditDeviceName,
          checkOutDeviceDate: workDate,
          checkOutDeviceTime: checkOutValue,
          checkOutDeviceTimestamp: checkOutTimestamp,
          checkOutDeviceISO: new Date(checkOutTimestamp).toISOString(),
          checkOutDeviceTimezone: currentStamp.timezone,
          checkOutDeviceName: auditDeviceName,
          deviceDate: currentStamp.date,
          deviceTime: currentStamp.time,
          deviceTimestamp: currentStamp.timestamp,
          deviceISO: currentStamp.iso,
          deviceTimezone: currentStamp.timezone,
          deviceName: auditDeviceName,
          devicePlatform: navigator.platform || '',
          recordedTime: currentStamp.time,
          createdBy: ctx.user.name,
          createdByUid: ctx.user.uid || '',
          createdAt: checkInTimestamp,
          completedAt: checkOutTimestamp,
          updatedAt: currentStamp.timestamp,
          manualEntryCreatedAt: currentStamp.timestamp
        };

        saving = true;
        const button = backfillForm.querySelector('#saveAttendanceBackfill');
        button.disabled = true;
        button.textContent = 'MENYIMPAN ABSENSI SUSULAN…';

        try {
          const result = await pushData(`attendance/${ctx.branch.id}`, item);
          attendance.unshift({ ...item, id: result.key });
          selectedAttendanceEmployeeId = employee.id;
          selectedBackfillEmployeeId = employee.id;
          selectedBackfillDate = workDate;
          selectedReportEmployeeId = employee.id;
          activeTab = 'attendance';
          ctx.notify(`Absensi susulan ${employee.name} tanggal ${workDate} tersimpan. Gaji ${rupiah(gross)} masuk ke saldo berjalan.`);
          draw();
        } catch (error) {
          console.error(error);
          ctx.notify(error.message || 'Absensi susulan gagal disimpan ke Firebase.', 'error');
          button.disabled = false;
          button.textContent = 'SIMPAN ABSENSI SUSULAN KE FIREBASE';
        } finally {
          saving = false;
        }
      };
    }

    const updateAttendancePreview = () => {
      const employee = currentEmployee(attendanceEmployee.value);
      const gross = isOwner
        ? number(dailyWage.value)
        : number(employee?.dailyWage);
      const stamp = deviceStamp();
      const record = attendanceTodayFor(employee, stamp.date);
      const liveHours = record?.checkInTimestamp && !record?.checkOutTimestamp
        ? Math.max(0, (stamp.timestamp - number(record.checkInTimestamp)) / 3600000)
        : number(record?.hoursWorked);
      hoursWorked.value = liveHours.toFixed(2);
      const summary = salarySummaryFor(employee);
      const salaryNotYetRecorded = record?.checkIn && !record?.checkOut
        ? gross
        : 0;
      const newCashAdvance = number(cashAdvanceGivenInput.value);
      const totalSalary = summary.totalSalary + salaryNotYetRecorded;
      const totalCashAdvance = Math.max(0, summary.totalCashAdvance + newCashAdvance);
      const totalNetSalary = Math.max(0, totalSalary - totalCashAdvance);
      runningSalaryAfterCashAdvance.value = rupiah(totalNetSalary);
      ctx.host.querySelector('#attendanceTotalSalary').textContent = rupiah(totalSalary);
      ctx.host.querySelector('#attendanceTotalCashAdvance').textContent = rupiah(totalCashAdvance);
      ctx.host.querySelector('#attendanceTotalNetSalary').textContent = rupiah(totalNetSalary);
      ctx.host.querySelector('#attendanceLatestCashAdvance').textContent = rupiah(
        newCashAdvance > 0 ? newCashAdvance : summary.latestCashAdvance
      );
      ctx.host.querySelector('#attendanceLatestCashAdvanceDate').textContent =
        newCashAdvance > 0 ? stamp.date : summary.latestCashAdvanceDate;
      ctx.host.querySelector('#attendanceNetPreview').textContent =
        rupiah(Math.max(0, gross - newCashAdvance));
    };

    const loadAttendanceEmployee = () => {
      const employee = currentEmployee(attendanceEmployee.value);
      dailyWage.value = number(employee?.dailyWage);
      updateAttendancePreview();
    };

    attendanceEmployee.onchange = () => {
      selectedAttendanceEmployeeId = attendanceEmployee.value;
      activeTab = 'attendance';
      draw();
    };
    dailyWage.oninput = updateAttendancePreview;
    cashAdvanceGivenInput.oninput = updateAttendancePreview;
    loadAttendanceEmployee();

    clockInButton.onclick = async () => {
      if (saving) return;

      const employee = currentEmployee(attendanceEmployee.value);
      if (!employee) return ctx.notify('Karyawan tidak ditemukan.', 'error');

      const currentStamp = deviceStamp();
      if (attendanceTodayFor(employee, currentStamp.date)) {
        return ctx.notify('Absensi karyawan ini untuk hari ini sudah tercatat.', 'error');
      }

      const item = {
        attendanceV3: true,
        attendanceV4: true,
        status: 'working',
        employeeId: employee.id,
        employeeName: employee.name || '',
        date: currentStamp.date,
        checkIn: currentStamp.time,
        checkOut: '',
        checkInTimestamp: currentStamp.timestamp,
        checkOutTimestamp: 0,
        hoursWorked: 0,
        dailyWage: isOwner
          ? number(dailyWage.value)
          : number(employee.dailyWage),
        deduction: 0,
        netWage: 0,
        cashAdvanceGiven: 0,
        cashAdvancePaymentDate: '',
        bonus: 0,
        bonusRecipientId: employee.id,
        bonusRecipientName: employee.name || '',
        bonusPaymentDate: '',
        salaryPaymentDate: '',
        notes: '',
        branchId: ctx.branch.id,
        branchName: ctx.branch.name,
        checkInDeviceDate: currentStamp.date,
        checkInDeviceTime: currentStamp.time,
        checkInDeviceTimestamp: currentStamp.timestamp,
        checkInDeviceISO: currentStamp.iso,
        checkInDeviceTimezone: currentStamp.timezone,
        checkInDeviceName: deviceName,
        deviceDate: currentStamp.date,
        deviceTime: currentStamp.time,
        deviceTimestamp: currentStamp.timestamp,
        deviceISO: currentStamp.iso,
        deviceTimezone: currentStamp.timezone,
        deviceName,
        devicePlatform: navigator.platform || '',
        recordedTime: currentStamp.time,
        createdBy: ctx.user.name,
        createdByUid: ctx.user.uid || '',
        createdAt: currentStamp.timestamp,
        updatedAt: currentStamp.timestamp
      };

      saving = true;
      clockInButton.disabled = true;
      clockInButton.textContent = 'MENCATAT JAM MASUK…';

      try {
        const result = await pushData(`attendance/${ctx.branch.id}`, item);
        attendance.unshift({ ...item, id: result.key });
        selectedAttendanceEmployeeId = employee.id;
        activeTab = 'attendance';
        ctx.notify(`Jam masuk ${employee.name} tercatat otomatis pada ${currentStamp.time}.`);
        draw();
      } catch (error) {
        console.error(error);
        ctx.notify(error.message || 'Jam masuk gagal disimpan.', 'error');
        clockInButton.disabled = false;
        clockInButton.textContent = 'CATAT JAM MASUK SEKARANG';
      } finally {
        saving = false;
      }
    };

    attendanceForm.onsubmit = async event => {
      event.preventDefault();
      if (saving || !attendanceForm.reportValidity()) return;

      const employee = currentEmployee(attendanceEmployee.value);
      if (!employee) return ctx.notify('Karyawan tidak ditemukan.', 'error');

      const currentStamp = deviceStamp();
      const openAttendance = attendanceTodayFor(employee, currentStamp.date);
      if (!openAttendance?.id || !openAttendance.checkIn || openAttendance.checkOut) {
        return ctx.notify('Catat Jam Masuk terlebih dahulu sebelum mencatat Jam Pulang.', 'error');
      }

      const cashAdvanceGiven = number(attendanceForm.elements.cashAdvanceGiven.value);
      const oldCashAdvance = number(employee.cashAdvance);
      const availableCashAdvance = oldCashAdvance + cashAdvanceGiven;

      const gross = isOwner
        ? number(dailyWage.value)
        : number(employee.dailyWage);
      const bonus = number(attendanceForm.elements.bonus.value);
      const nextCashAdvance = Math.max(0, availableCashAdvance);
      const calculatedHours = number(openAttendance.checkInTimestamp)
        ? Math.max(0, (currentStamp.timestamp - number(openAttendance.checkInTimestamp)) / 3600000)
        : hoursBetween(openAttendance.checkIn, currentStamp.time);
      const { id: attendanceId, ...openAttendanceData } = openAttendance;

      const item = {
        ...openAttendanceData,
        attendanceV3: true,
        attendanceV4: true,
        status: 'completed',
        employeeId: employee.id,
        employeeName: employee.name || '',
        date: openAttendance.date || currentStamp.date,
        checkIn: openAttendance.checkIn,
        checkOut: currentStamp.time,
        checkInTimestamp: number(openAttendance.checkInTimestamp),
        checkOutTimestamp: currentStamp.timestamp,
        hoursWorked: calculatedHours,
        dailyWage: gross,
        deduction: 0,
        netWage: Math.max(0, gross - cashAdvanceGiven),
        cashAdvanceGiven,
        cashAdvancePaymentDate: cashAdvanceGiven > 0 ? currentStamp.date : '',
        bonus,
        bonusRecipientId: employee.id,
        bonusRecipientName: employee.name || '',
        bonusPaymentDate: bonus > 0 ? currentStamp.date : '',
        salaryPaymentDate: '',
        notes: text(attendanceForm.elements.notes.value),
        branchId: ctx.branch.id,
        branchName: ctx.branch.name,
        checkOutDeviceDate: currentStamp.date,
        checkOutDeviceTime: currentStamp.time,
        checkOutDeviceTimestamp: currentStamp.timestamp,
        checkOutDeviceISO: currentStamp.iso,
        checkOutDeviceTimezone: currentStamp.timezone,
        checkOutDeviceName: deviceName,
        deviceDate: currentStamp.date,
        deviceTime: currentStamp.time,
        deviceTimestamp: currentStamp.timestamp,
        deviceISO: currentStamp.iso,
        deviceTimezone: currentStamp.timezone,
        deviceName,
        devicePlatform: navigator.platform || '',
        recordedTime: currentStamp.time,
        createdBy: ctx.user.name,
        createdByUid: ctx.user.uid || '',
        createdAt: number(openAttendance.createdAt) || number(openAttendance.checkInTimestamp) || currentStamp.timestamp,
        completedAt: currentStamp.timestamp,
        updatedAt: currentStamp.timestamp
      };

      saving = true;
      const button = ctx.host.querySelector('#saveAttendanceV3');
      button.disabled = true;
      button.textContent = 'MENCATAT JAM PULANG…';

      try {
        await setData(`attendance/${ctx.branch.id}/${attendanceId}`, item);
        await setData(`employees/${employee.id}`, {
          ...employee,
          cashAdvance: nextCashAdvance,
          updatedAt: Date.now()
        });

        employee.cashAdvance = nextCashAdvance;
        attendance = attendance.map(row => row === openAttendance ? { ...item, id: attendanceId } : row);
        activeTab = 'attendance';
        ctx.notify(`Jam pulang ${employee.name} tercatat otomatis pada ${currentStamp.time}. Absensi selesai.`);
        draw();
      } catch (error) {
        console.error(error);
        ctx.notify(error.message || 'Jam pulang gagal disimpan.', 'error');
        button.disabled = false;
        button.textContent = 'CATAT JAM PULANG & SIMPAN GAJI';
      } finally {
        saving = false;
      }
    };

    ctx.host.querySelectorAll('[data-edit-attendance]').forEach(button => {
      button.onclick = () => {
        if (!isOwner || saving) return;
        const record = attendance.find(row =>
          String(row.id) === button.dataset.editAttendance
          && row.reportHidden !== true
        );
        if (!record) return ctx.notify('Riwayat absensi tidak ditemukan.', 'error');

        const employee = employeeForRecord(record);
        ctx.dialog(
          'Edit Riwayat Absensi',
          `<form id="editAttendanceHistoryForm" class="form-grid">
            <label>Nama Karyawan
              <input value="${escapeHTML(record.employeeName || employee?.name || '-')}" readonly>
            </label>
            <label>Tanggal Absensi
              <input value="${escapeHTML(record.date || '-')}" readonly>
            </label>
            <label>Jam Masuk dari Device
              <input value="${escapeHTML(record.checkIn || '-')}" readonly>
            </label>
            <label>Jam Pulang dari Device
              <input value="${escapeHTML(record.checkOut || '-')}" readonly>
            </label>
            <label>Gaji Per Hari
              <input name="dailyWage" inputmode="numeric" value="${number(record.dailyWage)}" required>
            </label>
            <label>Kasbon Baru
              <input name="cashAdvanceGiven" inputmode="numeric" value="${number(record.cashAdvanceGiven)}">
            </label>
            <label>Bonus
              <input name="bonus" inputmode="numeric" value="${number(record.bonus)}">
            </label>
            <label class="full">Keterangan
              <input name="notes" value="${escapeHTML(record.notes || '')}" placeholder="Keterangan absensi dan gaji">
            </label>
            <div class="aya-wage-preview full">
              <span>GAJI BERSIH SETELAH EDIT</span>
              <strong id="editAttendanceNetPreview">${rupiah(attendanceWage(record))}</strong>
            </div>
            <small class="full">Jam Masuk dan Jam Pulang tetap berasal dari waktu device dan tidak dapat diedit.</small>
          </form>`,
          '<button value="cancel" class="secondary-button">Batal</button><button id="saveAttendanceHistoryEdit" class="primary-button">Simpan Perubahan</button>'
        );

        const form = document.querySelector('#editAttendanceHistoryForm');
        const saveButton = document.querySelector('#saveAttendanceHistoryEdit');
        const updatePreview = () => {
          const dailyWageValue = number(form.elements.dailyWage.value);
          const cashAdvanceValue = number(form.elements.cashAdvanceGiven.value);
          document.querySelector('#editAttendanceNetPreview').textContent = rupiah(
            Math.max(0, dailyWageValue - number(record.deduction) - cashAdvanceValue)
          );
        };
        ['dailyWage', 'cashAdvanceGiven'].forEach(name => {
          form.elements[name].oninput = updatePreview;
        });

        saveButton.onclick = async event => {
          event.preventDefault();
          if (saving || !form.reportValidity()) return;

          const dailyWageValue = number(form.elements.dailyWage.value);
          const cashAdvanceValue = number(form.elements.cashAdvanceGiven.value);
          const preservedDeduction = number(record.deduction);
          const bonusValue = number(form.elements.bonus.value);
          const baseCashAdvance = employee
            ? number(employee.cashAdvance)
              - number(record.cashAdvanceGiven)
              + number(record.deduction)
            : 0;
          const nextCashAdvance = baseCashAdvance
            + cashAdvanceValue
            - preservedDeduction;

          if (dailyWageValue < 0 || cashAdvanceValue < 0 || bonusValue < 0) {
            return ctx.notify('Nilai edit tidak boleh kurang dari Rp0.', 'error');
          }

          const currentStamp = deviceStamp();
          const updatedRecord = {
            ...record,
            dailyWage: dailyWageValue,
            cashAdvanceGiven: cashAdvanceValue,
            bonus: bonusValue,
            netWage: Math.max(0, dailyWageValue - preservedDeduction - cashAdvanceValue),
            notes: text(form.elements.notes.value),
            reportEditedBy: ctx.user.name,
            reportEditedByUid: ctx.user.uid || '',
            reportEditedAt: currentStamp.timestamp,
            updatedAt: currentStamp.timestamp
          };

          saving = true;
          saveButton.disabled = true;
          saveButton.textContent = 'Menyimpan…';
          try {
            await setData(
              `attendance/${ctx.branch.id}/${record.id}`,
              updatedRecord
            );
            if (employee) {
              const updatedEmployee = {
                ...employee,
                cashAdvance: Math.max(0, nextCashAdvance),
                updatedAt: currentStamp.timestamp
              };
              await setData(`employees/${employee.id}`, updatedEmployee);
              employees = employees.map(row =>
                String(row.id) === String(employee.id) ? updatedEmployee : row
              );
            }
            attendance = attendance.map(row =>
              String(row.id) === String(record.id)
                ? { ...updatedRecord, id: record.id }
                : row
            );
            selectedReportEmployeeId = employee?.id || '';
            activeTab = 'attendance';
            document.querySelector('#appDialog')?.close();
            ctx.notify('Riwayat absensi berhasil diperbarui oleh Owner.');
            draw();
          } catch (error) {
            console.error(error);
            ctx.notify(error.message || 'Riwayat absensi gagal diperbarui.', 'error');
            saveButton.disabled = false;
            saveButton.textContent = 'Simpan Perubahan';
          } finally {
            saving = false;
          }
        };
      };
    });

    ctx.host.querySelectorAll('[data-delete-attendance]').forEach(button => {
      button.onclick = async () => {
        if (!isOwner || saving) return;
        const record = attendance.find(row =>
          String(row.id) === button.dataset.deleteAttendance
          && row.reportHidden !== true
        );
        if (!record) return ctx.notify('Riwayat absensi tidak ditemukan.', 'error');
        if (!window.confirm(
          `Hapus riwayat absensi ${record.employeeName || ''} tanggal ${record.date || '-'} dari laporan? Data asli tetap disimpan.`
        )) return;

        const employee = employeeForRecord(record);
        const currentStamp = deviceStamp();
        const updatedRecord = {
          ...record,
          reportHidden: true,
          reportHiddenBy: ctx.user.name,
          reportHiddenByUid: ctx.user.uid || '',
          reportHiddenAt: currentStamp.timestamp,
          updatedAt: currentStamp.timestamp
        };
        const nextCashAdvance = employee
          ? Math.max(
            0,
            number(employee.cashAdvance)
              - number(record.cashAdvanceGiven)
              + number(record.deduction)
          )
          : 0;

        saving = true;
        try {
          await setData(
            `attendance/${ctx.branch.id}/${record.id}`,
            updatedRecord
          );
          if (employee) {
            const updatedEmployee = {
              ...employee,
              cashAdvance: nextCashAdvance,
              updatedAt: currentStamp.timestamp
            };
            await setData(`employees/${employee.id}`, updatedEmployee);
            employees = employees.map(row =>
              String(row.id) === String(employee.id) ? updatedEmployee : row
            );
          }
          attendance = attendance.map(row =>
            String(row.id) === String(record.id)
              ? { ...updatedRecord, id: record.id }
              : row
          );
          selectedReportEmployeeId = employee?.id || '';
          activeTab = 'attendance';
          ctx.notify('Riwayat absensi disembunyikan. Data asli tetap tersimpan.');
          draw();
        } catch (error) {
          console.error(error);
          ctx.notify(error.message || 'Riwayat absensi gagal dihapus.', 'error');
        } finally {
          saving = false;
        }
      };
    });

    const paymentForm = ctx.host.querySelector('#paySalaryForm');
    const paymentEmployee = paymentForm.querySelector('[name="employeeId"]');
    const paymentBalance = paymentForm.querySelector('[name="runningBalance"]');
    const paymentAmount = paymentForm.querySelector('[name="amount"]');
    const paymentDate = paymentForm.querySelector('[name="paymentDate"]');

    const loadPaymentEmployee = () => {
      const employee = currentEmployee(paymentEmployee.value);
      const row = employee ? runningFor(employee) : { remaining: 0 };
      paymentBalance.value = rupiah(row.remaining);
      paymentAmount.value = row.remaining;
      paymentAmount.max = String(row.remaining);
    };

    paymentEmployee.onchange = loadPaymentEmployee;
    loadPaymentEmployee();

    paymentForm.onsubmit = async event => {
      event.preventDefault();
      if (saving || !paymentForm.reportValidity()) return;

      const employee = currentEmployee(paymentEmployee.value);
      if (!employee) return ctx.notify('Karyawan tidak ditemukan.', 'error');

      const running = runningFor(employee);
      const amount = number(paymentAmount.value);

      if (amount <= 0) return ctx.notify('Nilai gaji dibayar harus lebih dari Rp0.', 'error');
      if (amount > running.remaining) {
        return ctx.notify(
          `Nilai pembayaran melebihi sisa gaji ${rupiah(running.remaining)}.`,
          'error'
        );
      }

      const currentStamp = deviceStamp();
      const selectedPaymentDate = text(paymentDate.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedPaymentDate)) {
        return ctx.notify('Tanggal pembayaran gaji wajib dipilih.', 'error');
      }
      if (selectedPaymentDate > currentStamp.date) {
        return ctx.notify('Tanggal pembayaran tidak boleh melewati tanggal device.', 'error');
      }
      const payment = {
        payrollPaymentV3: true,
        employeeId: employee.id,
        employeeName: employee.name || '',
        branchId: ctx.branch.id,
        branchName: ctx.branch.name,
        paymentDate: selectedPaymentDate,
        paymentTime: currentStamp.time,
        paymentTimestamp: currentStamp.timestamp,
        paymentISO: currentStamp.iso,
        amount,
        runningBefore: running.remaining,
        remainingAfter: Math.max(0, running.remaining - amount),
        notes: text(paymentForm.elements.notes.value),
        deviceName,
        devicePlatform: navigator.platform || '',
        deviceTimezone: currentStamp.timezone,
        createdBy: ctx.user.name,
        createdByUid: ctx.user.uid || '',
        createdAt: currentStamp.timestamp
      };

      saving = true;
      const button = ctx.host.querySelector('#saveSalaryPayment');
      button.disabled = true;
      button.textContent = 'Menyimpan…';

      try {
        const result = await pushData(
          `payrollPayments/${ctx.branch.id}`,
          payment
        );

        payments.unshift({ ...payment, id: result.key });
        activeTab = 'payment';
        ctx.notify(
          `Gaji ${employee.name} sebesar ${rupiah(amount)} tersimpan dalam laporan.`
        );
        draw();
      } catch (error) {
        console.error(error);
        ctx.notify(error.message || 'Pembayaran gaji gagal disimpan.', 'error');
        button.disabled = false;
        button.textContent = 'SIMPAN GAJI DIBAYAR';
      } finally {
        saving = false;
      }
    };

    const exportPayrollPayments = ctx.host.querySelector('#exportPayrollPayments');
    if (exportPayrollPayments) exportPayrollPayments.onclick = () => {
      if (!selectedReportEmployee) {
        return ctx.notify('Pilih nama karyawan terlebih dahulu.', 'error');
      }
      const rows = selectedPaymentReports;
      downloadCSV(
        `laporan-gaji-${selectedReportEmployee.name || selectedReportEmployee.id}-${ctx.branch.id}-${stamp.date}.csv`,
        [
          ['tanggal', 'jam', 'karyawan', 'nilai_dibayar', 'sisa_setelah_bayar', 'keterangan', 'device', 'timezone', 'dicatat_oleh'],
          ...rows.map(row => [
            row.paymentDate,
            row.paymentTime,
            row.employeeName,
            number(row.amount),
            number(row.remainingAfter),
            row.notes,
            row.deviceName,
            row.deviceTimezone,
            row.createdBy
          ])
        ]
      );
    };

    ctx.host.querySelectorAll('[data-edit-payment]').forEach(button => {
      button.onclick = async () => {
        if (!isOwner || saving) return;
        const payment = historicalPayments().find(row =>
          String(row.id) === button.dataset.editPayment
        );
        if (!payment) return ctx.notify('Laporan pembayaran tidak ditemukan.', 'error');

        const editedDate = window.prompt(
          'Tanggal pembayaran (YYYY-MM-DD):',
          text(payment.paymentDate) || stamp.date
        );
        if (editedDate === null) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text(editedDate)) || text(editedDate) > stamp.date) {
          return ctx.notify('Tanggal pembayaran tidak valid atau melewati tanggal device.', 'error');
        }

        const editedAmountText = window.prompt(
          'Nilai gaji dibayar:',
          String(number(payment.amount))
        );
        if (editedAmountText === null) return;
        const editedAmount = number(editedAmountText);
        const employee = currentEmployee(payment.employeeId);
        const availableSalary = payment.isLegacy
          ? Number.MAX_SAFE_INTEGER
          : (employee ? runningFor(employee).remaining : 0) + number(payment.amount);
        if (editedAmount <= 0 || editedAmount > availableSalary) {
          return ctx.notify(
            `Nilai pembayaran harus lebih dari Rp0 dan tidak boleh melebihi ${rupiah(availableSalary)}.`,
            'error'
          );
        }

        const editedNotes = window.prompt(
          'Keterangan pembayaran:',
          text(payment.notes)
        );
        if (editedNotes === null) return;

        const currentStamp = deviceStamp();
        const updatedPayment = {
          ...payment,
          paymentDate: text(editedDate),
          amount: editedAmount,
          runningBefore: payment.isLegacy
            ? number(payment.runningBefore || payment.amount)
            : availableSalary,
          remainingAfter: payment.isLegacy
            ? number(payment.remainingAfter)
            : Math.max(0, availableSalary - editedAmount),
          notes: text(editedNotes),
          editedBy: ctx.user.name,
          editedByUid: ctx.user.uid || '',
          editedAt: currentStamp.timestamp,
          updatedAt: currentStamp.timestamp
        };

        saving = true;
        try {
          if (payment.isLegacy) {
            const adjustment = {
              legacyReportId: payment.id,
              legacySourceId: payment.legacySourceId || '',
              hidden: false,
              paymentDate: updatedPayment.paymentDate,
              paymentTime: updatedPayment.paymentTime,
              amount: updatedPayment.amount,
              remainingAfter: updatedPayment.remainingAfter,
              notes: updatedPayment.notes,
              deviceName: updatedPayment.deviceName,
              deviceTimezone: updatedPayment.deviceTimezone || '',
              editedBy: ctx.user.name,
              editedByUid: ctx.user.uid || '',
              editedAt: currentStamp.timestamp,
              updatedAt: currentStamp.timestamp
            };
            await setData(
              `payrollReportAdjustments/${ctx.branch.id}/${payment.id}`,
              adjustment
            );
            reportAdjustments = [
              ...reportAdjustments.filter(row => String(row.id) !== String(payment.id)),
              { ...adjustment, id: payment.id }
            ];
          } else {
            await setData(
              `payrollPayments/${ctx.branch.id}/${payment.id}`,
              updatedPayment
            );
            payments = payments.map(row =>
              String(row.id) === String(payment.id) ? updatedPayment : row
            );
          }
          activeTab = 'report';
          ctx.notify('Laporan pembayaran gaji berhasil diperbarui.');
          draw();
        } catch (error) {
          console.error(error);
          ctx.notify(error.message || 'Laporan pembayaran gagal diperbarui.', 'error');
        } finally {
          saving = false;
        }
      };
    });

    ctx.host.querySelectorAll('[data-delete-payment]').forEach(button => {
      button.onclick = async () => {
        if (!isOwner || saving) return;
        const payment = historicalPayments().find(row =>
          String(row.id) === button.dataset.deletePayment
        );
        if (!payment) return ctx.notify('Laporan pembayaran tidak ditemukan.', 'error');
        if (!window.confirm(
          payment.isLegacy
            ? `Hapus laporan lama ${payment.employeeName || ''} sebesar ${rupiah(payment.amount)} dari tampilan? Data absensi aslinya tetap disimpan.`
            : `Hapus laporan pembayaran ${payment.employeeName || ''} sebesar ${rupiah(payment.amount)}? Sisa gaji berjalan akan dihitung ulang.`
        )) return;

        saving = true;
        try {
          if (payment.isLegacy) {
            const currentStamp = deviceStamp();
            const adjustment = {
              legacyReportId: payment.id,
              legacySourceId: payment.legacySourceId || '',
              hidden: true,
              hiddenBy: ctx.user.name,
              hiddenByUid: ctx.user.uid || '',
              hiddenAt: currentStamp.timestamp,
              updatedAt: currentStamp.timestamp
            };
            await setData(
              `payrollReportAdjustments/${ctx.branch.id}/${payment.id}`,
              adjustment
            );
            reportAdjustments = [
              ...reportAdjustments.filter(row => String(row.id) !== String(payment.id)),
              { ...adjustment, id: payment.id }
            ];
          } else {
            await removeData(`payrollPayments/${ctx.branch.id}/${payment.id}`);
            payments = payments.filter(row => String(row.id) !== String(payment.id));
          }
          activeTab = 'report';
          ctx.notify(payment.isLegacy
            ? 'Laporan lama disembunyikan. Data absensi asli tetap tersimpan.'
            : 'Laporan pembayaran dihapus dan sisa gaji berjalan dihitung ulang.');
          draw();
        } catch (error) {
          console.error(error);
          ctx.notify(error.message || 'Laporan pembayaran gagal dihapus.', 'error');
        } finally {
          saving = false;
        }
      };
    });

    activateTab(activeTab);
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
  };

  draw();
}
