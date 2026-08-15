const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const dateForTest = value => [
  value.getFullYear(),
  String(value.getMonth() + 1).padStart(2, '0'),
  String(value.getDate()).padStart(2, '0')
].join('-');
const todayForTest = value => dateForTest(new Date(value));
const previousDateForTest = value => {
  const date = new Date(value);
  date.setDate(date.getDate() - 1);
  return dateForTest(date);
};
const stripImports = source => source
  .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s{0,}/g, '')
  .replace(/export\s+async\s+function/g, 'async function')
  .replace(/export\s+function/g, 'function');

async function testCashier() {
  const dom = new JSDOM(`
    <body>
      <section id="host"></section>
      <section id="alertHost"></section>
      <dialog id="appDialog">
        <h2 id="dialogTitle"></h2>
        <div id="dialogBody"></div>
        <footer id="dialogFooter"></footer>
      </dialog>
    </body>
  `, {
    url: 'http://localhost/#pos',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.confirm = () => true;
  window.prompt = () => '12000';
  const dialog = window.document.querySelector('#appDialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };

  const posSource = stripImports(
    fs.readFileSync(path.join(root, 'js/pos.js'), 'utf8')
  );

  window.eval(`
    const __posWrites = [];
    const pushData = async (path, value) => {
      __posWrites.push({ path, value });
      return { source: 'test', key: 'sale-1' };
    };
    const atomicStock = async () => ({});
    const mirrorLegacySale = async () => ({});
    const stockForBranch = product => Number(product.stock || 0);
    const getCachedProducts = async () => [{
      id: 'menu-1', code: 'SBK01', barcode: '8990001', name: 'Seblak', category: 'Makanan', active: true,
      price: 10000, cost: 5000, unit: 'porsi', stock: 20
    }];
    const productBelongsToBranch = () => true;
    const rupiah = value => 'Rp' + Number(value || 0).toLocaleString('id-ID');
    const number = value => Number(String(value ?? 0).replace(/[^0-9.-]/g, '')) || 0;
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, '');
    const uid = prefix => prefix + '-1';
    const sum = (rows, selector) => rows.reduce((total, row) => total + Number(selector(row) || 0), 0);
    const printReceipt = () => {};
    const audit = async () => {};
    const startScanner = async () => {};
    const stopScanner = () => {};
    const scannerSupported = () => false;
    ${posSource}
    window.__renderPOS = renderPOS;
    window.__posWrites = __posWrites;
  `);

  const messages = [];
  const ctx = {
    host: window.document.querySelector('#host'),
    branch: { id: 'aya', name: 'AYA SEBLAK DAN ANGKRINGAN', code: 'AYA' },
    user: { uid: 'owner', name: 'Owner' },
    notify: message => messages.push(message),
    dialog: (title, body, footer) => {
      window.document.querySelector('#dialogTitle').textContent = title;
      window.document.querySelector('#dialogBody').innerHTML = body;
      window.document.querySelector('#dialogFooter').innerHTML = footer;
      dialog.showModal();
    }
  };

  await window.__renderPOS(ctx);
  const uiSource = fs.readFileSync(
    path.join(root, 'js/pos-ui-v2.10.14.js'),
    'utf8'
  );
  window.eval(`${uiSource}\nwindow.__posObserver = observer;`);
  await wait(30);

  assert.ok(window.document.querySelector('.aya-pos-view'));
  assert.ok(window.document.querySelector('.aya-pos-pro'));
  assert.ok(window.document.querySelector('.pos-pro-layout'));
  assert.ok(window.document.querySelector('.pos-pro-catalog'));
  assert.ok(window.document.querySelector('.pos-pro-receipt'));
  ['customerPhone', 'customerAddress', 'orderNotes', 'shareLocationReceived', 'deliveryDistanceBand', 'deliveryDistanceButtons'].forEach(id => {
    assert.ok(window.document.querySelector('#' + id), 'Kolom #' + id + ' wajib tersedia');
  });
  assert.equal(window.document.querySelector('#requestedAt'), null);
  assert.equal(window.document.querySelector('#deliveryOptions').hidden, true);
  assert.equal(window.document.querySelector('#shippingField').hidden, true);
  assert.equal(window.document.querySelector('#deliveryDistanceBand').disabled, true);
  assert.equal(window.document.querySelectorAll('[data-delivery-band]').length, 6);
  assert.ok([...window.document.querySelectorAll('[data-delivery-band]')].every(button => button.disabled));
  assert.deepEqual(
    [...window.document.querySelectorAll('#paymentMethod option')]
      .map(option => option.textContent.trim()),
    ['TUNAI', 'QRIS', 'PERSONAL', 'HUTANG']
  );
  assert.equal(window.document.querySelectorAll('[data-payment-method]').length, 4);
  assert.ok(window.document.querySelector('[data-cash-action="exact"]'));
  assert.ok(window.document.querySelector('[data-cash-add="50000"]'));
  assert.equal(window.document.querySelector('#holdButton').textContent.trim(), 'TAHAN');
  assert.match(window.document.querySelector('#heldButton').textContent, /AMBIL/);

  window.document.querySelector('#paymentMethod').value = 'QRIS';
  window.document.querySelector('#paymentMethod').dispatchEvent(
    new window.Event('change', { bubbles: true })
  );
  assert.equal(window.document.querySelector('#paidField').hidden, true);

  window.document.querySelector('#paymentMethod').value = 'TUNAI';
  window.document.querySelector('#paymentMethod').dispatchEvent(
    new window.Event('change', { bubbles: true })
  );
  assert.equal(window.document.querySelector('#paidField').hidden, false);

  window.document.querySelector('[data-product="menu-1"]').click();
  assert.ok(window.document.querySelector('[data-cart-item="menu-1"]').classList.contains('is-selected'));
  const cartCopy = window.document.querySelector('[data-cart-item="menu-1"] .pos-pro-cart-copy');
  assert.equal(cartCopy.querySelectorAll(':scope > strong').length, 1);
  assert.equal(cartCopy.querySelectorAll(':scope > small').length, 1);
  assert.equal(cartCopy.querySelectorAll(':scope > b').length, 0);
  assert.match(cartCopy.textContent.replace(/\s+/g, ' ').trim(), /Seblak.*Total/);
  window.document.querySelector('#editSelectedPrice').click();
  assert.match(window.document.querySelector('#cartList').textContent, /12\.000/);
  window.document.querySelector('#orderType').value = 'Delivery';
  window.document.querySelector('#orderType').dispatchEvent(
    new window.Event('change', { bubbles: true })
  );
  assert.equal(window.document.querySelector('#deliveryOptions').hidden, false);
  assert.equal(window.document.querySelector('#shippingField').hidden, false);
  assert.equal(window.document.querySelector('#deliveryDistanceBand').disabled, true);
  window.document.querySelector('#shareLocationReceived').checked = true;
  window.document.querySelector('#shareLocationReceived').dispatchEvent(
    new window.Event('change', { bubbles: true })
  );
  assert.equal(window.document.querySelector('#deliveryDistanceBand').disabled, false);
  assert.ok([...window.document.querySelectorAll('[data-delivery-band]')].every(button => !button.disabled));
  for (const [band, fee] of Object.entries({
    '0-1': '3000', '1-2': '5000', '2-3': '7000', '3-4': '9000', '4-5': '11000'
  })) {
    window.document.querySelector(`[data-delivery-band="${band}"]`).click();
    assert.equal(window.document.querySelector('#shipping').value, fee);
    assert.equal(window.document.querySelector('#shipping').readOnly, true);
    assert.ok(window.document.querySelector(`[data-delivery-band="${band}"]`).classList.contains('is-active'));
    assert.match(
      window.document.querySelector('#cartSummary').textContent,
      new RegExp((12000 + Number(fee)).toLocaleString('id-ID').replaceAll('.', '\\.'))
    );
  }
  window.document.querySelector('[data-delivery-band="1-2"]').click();
  assert.equal(window.document.querySelector('#shipping').value, '5000');
  assert.match(window.document.querySelector('#deliveryRatePreview').textContent, /Min\./);
  assert.equal(window.document.querySelector('#deliveryMinimumStatus').dataset.state, 'error');
  window.document.querySelector('#customerName').value = 'Pelanggan A';
  window.document.querySelector('#customerPhone').value = '08123456789';
  window.document.querySelector('#customerAddress').value = 'Jl. AYA No. 1';
  window.document.querySelector('#orderNotes').value = 'Tidak pedas';
  window.document.querySelector('#discount').value = '1000';
  window.document.querySelector('[data-cash-action="exact"]').click();
  assert.equal(window.document.querySelector('#paid').value, '16000');
  window.document.querySelector('#holdButton').click();

  const held = JSON.parse(window.localStorage.getItem('aya.held'));
  assert.equal(held.length, 1);
  assert.equal(held[0].customerName, 'Pelanggan A');
  assert.equal(held[0].orderType, 'Delivery');
  assert.equal(held[0].shipping, 5000);
  assert.equal(held[0].shareLocationReceived, true);
  assert.equal(held[0].deliveryDistanceBand, '1-2');
  assert.equal(held[0].customerPhone, '08123456789');
  assert.equal(held[0].customerAddress, 'Jl. AYA No. 1');
  assert.equal(held[0].orderNotes, 'Tidak pedas');
  assert.equal(held[0].items[0].price, 12000);
  assert.equal(held[0].items[0].name, 'Seblak');

  window.document.querySelector('#heldButton').click();
  await wait(20);
  window.document.querySelector('[data-resume]').click();
  await wait(20);

  assert.match(window.document.querySelector('#cartList').textContent, /Seblak/);
  assert.equal(window.document.querySelector('#customerName').value, 'Pelanggan A');
  assert.equal(window.document.querySelector('#orderType').value, 'Delivery');
  assert.equal(window.document.querySelector('#shipping').value, '5000');
  assert.equal(window.document.querySelector('#shareLocationReceived').checked, true);
  assert.equal(window.document.querySelector('#deliveryDistanceBand').value, '1-2');
  assert.ok(window.document.querySelector('[data-delivery-band="1-2"]').classList.contains('is-active'));
  assert.equal(window.document.querySelector('#customerPhone').value, '08123456789');
  assert.equal(window.document.querySelector('#customerAddress').value, 'Jl. AYA No. 1');
  assert.equal(window.document.querySelector('#orderNotes').value, 'Tidak pedas');
  assert.equal(JSON.parse(window.localStorage.getItem('aya.held')).length, 0);
  assert.ok(messages.some(message => /berhasil diambil/.test(message)));

  window.document.querySelector('[data-payment-method="QRIS"]').click();
  assert.equal(window.document.querySelector('#paymentMethod').value, 'QRIS');
  assert.equal(window.document.querySelector('#paidField').hidden, true);
  window.document.querySelector('#saveSale').click();
  await wait(40);

  assert.equal(window.__posWrites.find(row => row.path === 'sales/aya'), undefined);
  assert.ok(messages.some(message => /Minimum belanja/.test(message)));
  window.document.querySelector('[data-plus="menu-1"]').click();
  assert.equal(window.document.querySelector('#deliveryMinimumStatus').dataset.state, 'success');
  window.document.querySelector('#saveSale').click();
  await wait(40);

  const saleWrite = window.__posWrites.find(row => row.path === 'sales/aya');
  assert.ok(saleWrite);
  assert.equal(saleWrite.value.paymentMethod, 'QRIS');
  assert.equal(saleWrite.value.customerPhone, '08123456789');
  assert.equal(saleWrite.value.customerAddress, 'Jl. AYA No. 1');
  assert.equal('requestedAt' in saleWrite.value, false);
  assert.equal(saleWrite.value.orderNotes, 'Tidak pedas');
  assert.equal(saleWrite.value.shareLocationReceived, true);
  assert.equal(saleWrite.value.deliveryDistanceBand, '1-2');
  assert.equal(saleWrite.value.deliveryMinimumPurchase, 15000);
  assert.equal(window.document.querySelector('#cartList [data-cart-item]'), null);

  window.document.querySelector('[data-product="menu-1"]').click();
  window.document.querySelector('#orderType').value = 'Delivery';
  window.document.querySelector('#orderType').dispatchEvent(new window.Event('change', { bubbles: true }));
  window.document.querySelector('#shareLocationReceived').checked = true;
  window.document.querySelector('#shareLocationReceived').dispatchEvent(new window.Event('change', { bubbles: true }));
  window.document.querySelector('[data-delivery-band="over-5"]').click();
  assert.equal(window.document.querySelector('#shipping').readOnly, false);
  assert.equal(window.document.querySelector('#shipping').value, '0');
  assert.match(window.document.querySelector('#deliveryRatePreview').textContent, /Konfirmasi admin/);

  window.document.querySelector('#orderType').value = 'Dibungkus';
  window.document.querySelector('#orderType').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(window.document.querySelector('#deliveryOptions').hidden, true);
  assert.equal(window.document.querySelector('#shipping').value, '0');
  assert.equal(window.document.querySelector('#shareLocationReceived').checked, false);

  window.__posObserver.disconnect();
  await wait(40);
  dom.window.close();
}

async function testPayroll() {
  const dom = new JSDOM(`
    <body>
      <section id="host"></section>
      <dialog id="appDialog">
        <h2 id="dialogTitle"></h2>
        <div id="dialogBody"></div>
        <footer id="dialogFooter"></footer>
      </dialog>
    </body>
  `, {
    url: 'http://localhost/#attendance',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  window.confirm = () => true;
  window.__promptValues = [];
  window.prompt = () => window.__promptValues.shift() ?? null;
  const payrollDialog = window.document.querySelector('#appDialog');
  payrollDialog.showModal = () => { payrollDialog.open = true; };
  payrollDialog.close = () => { payrollDialog.open = false; };
  const payrollSource = stripImports(
    fs.readFileSync(path.join(root, 'js/payroll-v2.11.3.js'), 'utf8')
  );

  window.eval(`
    const __writes = [];
    const getOnce = async path => {
      if (path === 'employees') return {
        emp1: { id: 'emp1', name: 'Binti', dailyWage: 50000, cashAdvance: 10000, active: true },
        emp2: { id: 'emp2', name: 'Nando', dailyWage: 60000, cashAdvance: 0, active: true }
      };
      if (path.startsWith('attendance/')) return {
        att1: {
          id: 'att1', attendanceV3: true, employeeId: 'emp1', employeeName: 'Binti',
          date: '2026-08-14', checkIn: '09:00', checkOut: '22:00',
          hoursWorked: 13, dailyWage: 50000, netWage: 50000,
          salaryPaymentDate: '', notes: 'Gaji harian', createdAt: 1
        },
        attLegacy: {
          id: 'attLegacy', attendanceV3: true, employeeId: 'emp1', employeeName: 'Binti',
          date: '2026-07-31', checkIn: '09:00', checkOut: '22:00',
          hoursWorked: 13, dailyWage: 50000, netWage: 50000,
          salaryPaymentDate: '2026-07-31', paymentTime: '22:00:00',
          notes: 'Gaji lama tersimpan', createdAt: 0
        },
        att2: {
          id: 'att2', attendanceV3: true, employeeId: 'emp2', employeeName: 'Nando',
          date: '2026-08-13', checkIn: '10:00', checkOut: '21:00',
          hoursWorked: 11, dailyWage: 60000, netWage: 60000,
          salaryPaymentDate: '', notes: 'Gaji Nando', createdAt: 2
        }
      };
      return {};
    };
    const pushData = async (path, value) => {
      __writes.push({ type: 'push', path, value });
      return { key: 'key-' + __writes.length };
    };
    const setData = async (path, value) => {
      __writes.push({ type: 'set', path, value });
      return { ok: true };
    };
    const removeData = async path => {
      __writes.push({ type: 'remove', path });
      return { ok: true };
    };
    const escapeHTML = value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
    const number = value => Number(String(value ?? 0).replace(/[^0-9.-]/g, '')) || 0;
    const rupiah = value => new Intl.NumberFormat('id-ID', {
      style: 'currency', currency: 'IDR', maximumFractionDigits: 0
    }).format(Number(value || 0));
    const toArray = value => Array.isArray(value)
      ? value
      : Object.entries(value || {}).map(([id, row]) => ({ ...row, id: row.id || id }));
    ${payrollSource}
    window.__renderPayroll = renderPayrollAttendance;
    window.__writes = __writes;
  `);

  const messages = [];
  const ctx = {
    host: window.document.querySelector('#host'),
    branch: { id: 'aya', name: 'AYA SEBLAK DAN ANGKRINGAN' },
    user: { uid: 'owner', name: 'Owner', role: 'owner' },
    notify: (message, type) => messages.push({ message, type }),
    dialog: (title, body, footer) => {
      window.document.querySelector('#dialogTitle').textContent = title;
      window.document.querySelector('#dialogBody').innerHTML = body;
      window.document.querySelector('#dialogFooter').innerHTML = footer;
      payrollDialog.showModal();
    }
  };

  await window.__renderPayroll(ctx);

  assert.equal(window.document.querySelectorAll('[data-payroll-tab]').length, 4);
  assert.ok(window.document.querySelector('#payrollDeviceName').value);
  assert.match(
    window.document.querySelector('[data-payroll-panel="running"]').textContent,
    /Rp\s?50\.000/
  );
  assert.match(
    window.document.querySelector('[data-payroll-panel="running"]').textContent,
    /Rp\s?10\.000/
  );

  window.document.querySelector('[data-payroll-tab="payment"]').click();
  const payForm = window.document.querySelector('#paySalaryForm');
  assert.equal(payForm.elements.amount.value, '50000');
  assert.equal(payForm.elements.paymentDate.type, 'date');
  payForm.elements.paymentDate.value = '2026-08-10';
  payForm.elements.amount.value = '20000';
  payForm.dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true
  }));
  await wait(30);

  const paymentWrite = window.__writes.find(row =>
    row.path === 'payrollPayments/aya'
  );
  assert.ok(paymentWrite);
  assert.equal(paymentWrite.value.amount, 20000);
  assert.equal(paymentWrite.value.paymentDate, '2026-08-10');
  assert.ok(paymentWrite.value.paymentTime);
  assert.ok(paymentWrite.value.deviceName);

  window.document.querySelector('[data-payroll-tab="running"]').click();
  assert.match(
    window.document.querySelector('[data-payroll-panel="running"]').textContent,
    /Rp\s?30\.000/
  );

  window.document.querySelector('[data-payroll-tab="report"]').click();
  assert.equal(window.document.querySelectorAll('[data-edit-payment]').length, 0);
  assert.match(
    window.document.querySelector('[data-payroll-panel="report"]').textContent,
    /Klik nama karyawan terlebih dahulu/
  );
  window.document
    .querySelector('[data-payroll-panel="report"] [data-report-employee="emp1"]')
    .click();
  assert.equal(window.document.querySelectorAll('[data-edit-payment]').length, 2);
  assert.doesNotMatch(
    window.document.querySelector('.aya-payroll-report-table').textContent,
    /Nando/
  );
  assert.equal(window.document.querySelectorAll('[data-delete-payment]').length, 2);
  assert.equal(
    window.document.querySelector('.aya-payroll-report-table th:first-child').textContent.trim(),
    'Aksi Owner'
  );
  window.__promptValues.push('2026-08-09', '15000', 'Pembayaran dikoreksi Owner');
  window.document.querySelector('[data-edit-payment^="key-"]').click();
  await wait(30);

  const editedPaymentWrite = window.__writes.find(row =>
    row.type === 'set'
    && row.path.startsWith('payrollPayments/aya/')
  );
  assert.ok(editedPaymentWrite);
  assert.equal(editedPaymentWrite.value.paymentDate, '2026-08-09');
  assert.equal(editedPaymentWrite.value.amount, 15000);
  assert.equal(editedPaymentWrite.value.notes, 'Pembayaran dikoreksi Owner');
  assert.equal(editedPaymentWrite.value.editedBy, 'Owner');

  window.document.querySelector('[data-delete-payment^="key-"]').click();
  await wait(30);
  assert.ok(window.__writes.some(row =>
    row.type === 'remove'
    && row.path.startsWith('payrollPayments/aya/')
  ));

  window.__promptValues.push('2026-07-30', '45000', 'Laporan lama dikoreksi Owner');
  window.document.querySelector('[data-edit-payment="legacy-attLegacy"]').click();
  await wait(30);
  const legacyEditWrite = window.__writes.find(row =>
    row.type === 'set'
    && row.path === 'payrollReportAdjustments/aya/legacy-attLegacy'
    && row.value.hidden === false
  );
  assert.ok(legacyEditWrite);
  assert.equal(legacyEditWrite.value.amount, 45000);
  assert.equal(legacyEditWrite.value.paymentDate, '2026-07-30');
  assert.equal(legacyEditWrite.value.notes, 'Laporan lama dikoreksi Owner');
  window.document.querySelector('[data-delete-payment="legacy-attLegacy"]').click();
  await wait(30);
  const legacyHideWrite = [...window.__writes].reverse().find(row =>
    row.type === 'set'
    && row.path === 'payrollReportAdjustments/aya/legacy-attLegacy'
    && row.value.hidden === true
  );
  assert.ok(legacyHideWrite);
  assert.equal(window.document.querySelector('[data-edit-payment="legacy-attLegacy"]'), null);

  window.document.querySelector('[data-payroll-tab="running"]').click();
  assert.match(
    window.document.querySelector('[data-payroll-panel="running"]').textContent,
    /Rp\s?50\.000/
  );

  window.document.querySelector('[data-payroll-tab="attendance"]').click();
  let attendanceForm = window.document.querySelector('#attendanceV3Form');
  assert.equal(window.document.querySelectorAll('[data-edit-attendance]').length, 2);
  assert.equal(window.document.querySelectorAll('[data-delete-attendance]').length, 2);
  assert.doesNotMatch(
    window.document.querySelector('.aya-attendance-report-table').textContent,
    /Nando/
  );
  window.document.querySelector('[data-edit-attendance="attLegacy"]').click();
  assert.equal(payrollDialog.open, true);
  const editAttendanceForm = window.document.querySelector('#editAttendanceHistoryForm');
  assert.equal(editAttendanceForm.elements.deduction, undefined);
  assert.doesNotMatch(editAttendanceForm.textContent, /Potong Kasbon/i);
  assert.equal(editAttendanceForm.elements[2].readOnly, true);
  assert.equal(editAttendanceForm.elements[3].readOnly, true);
  assert.equal(editAttendanceForm.elements[2].value, '09:00');
  assert.equal(editAttendanceForm.elements[3].value, '22:00');
  editAttendanceForm.elements.dailyWage.value = '45000';
  editAttendanceForm.elements.notes.value = 'Absensi lama dikoreksi Owner';
  window.document.querySelector('#saveAttendanceHistoryEdit').click();
  await wait(30);
  const attendanceHistoryEdit = window.__writes.find(row =>
    row.type === 'set'
    && row.path === 'attendance/aya/attLegacy'
    && row.value.reportEditedBy === 'Owner'
  );
  assert.ok(attendanceHistoryEdit);
  assert.equal(attendanceHistoryEdit.value.dailyWage, 45000);
  assert.equal(attendanceHistoryEdit.value.deduction, undefined);
  assert.equal(attendanceHistoryEdit.value.netWage, 45000);
  assert.equal(attendanceHistoryEdit.value.checkIn, '09:00');
  assert.equal(attendanceHistoryEdit.value.checkOut, '22:00');
  window.document.querySelector('[data-delete-attendance="attLegacy"]').click();
  await wait(30);
  const attendanceHistoryHide = [...window.__writes].reverse().find(row =>
    row.type === 'set'
    && row.path === 'attendance/aya/attLegacy'
    && row.value.reportHidden === true
  );
  assert.ok(attendanceHistoryHide);
  assert.equal(window.document.querySelector('[data-edit-attendance="attLegacy"]'), null);
  assert.equal(window.document.querySelectorAll('[data-edit-attendance]').length, 1);

  attendanceForm = window.document.querySelector('#attendanceV3Form');
  assert.equal(attendanceForm.elements.dailyWage.readOnly, false);
  assert.equal(attendanceForm.elements.currentCashAdvance, undefined);
  assert.equal(attendanceForm.elements.deduction, undefined);
  assert.doesNotMatch(attendanceForm.textContent, /Potong Kasbon/i);
  assert.ok(attendanceForm.elements.runningSalaryAfterCashAdvance);
  assert.equal(attendanceForm.elements.checkIn.readOnly, true);
  assert.equal(attendanceForm.elements.checkOut.readOnly, true);
  assert.equal(attendanceForm.elements.checkIn.type, 'text');
  assert.equal(attendanceForm.elements.checkOut.type, 'text');
  attendanceForm.elements.checkIn.value = '01:23:45';
  attendanceForm.elements.checkOut.value = '02:34:56';
  window.document.querySelector('#clockInNow').click();
  await wait(30);

  const clockInWrite = window.__writes.find(row =>
    row.type === 'push' && row.path === 'attendance/aya'
  );
  assert.ok(clockInWrite);
  assert.equal(clockInWrite.value.attendanceV4, true);
  assert.equal(clockInWrite.value.status, 'working');
  assert.equal(clockInWrite.value.checkOut, '');
  assert.equal(clockInWrite.value.checkIn, clockInWrite.value.deviceTime);
  assert.equal(clockInWrite.value.checkIn, clockInWrite.value.checkInDeviceTime);
  assert.notEqual(clockInWrite.value.checkIn, '01:23:45');
  assert.match(clockInWrite.value.checkIn, /^\d{2}:\d{2}:\d{2}$/);

  attendanceForm = window.document.querySelector('#attendanceV3Form');
  assert.equal(attendanceForm.elements.checkIn.readOnly, true);
  assert.equal(attendanceForm.elements.checkOut.readOnly, true);
  assert.equal(attendanceForm.elements.checkIn.value, clockInWrite.value.checkIn);
  assert.equal(window.document.querySelector('#clockInNow').disabled, true);
  assert.equal(window.document.querySelector('#saveAttendanceV3').disabled, false);
  attendanceForm.elements.cashAdvanceGiven.value = '5000';
  attendanceForm.elements.cashAdvanceGiven.dispatchEvent(
    new window.Event('input', { bubbles: true })
  );
  assert.match(attendanceForm.elements.runningSalaryAfterCashAdvance.value, /85\.000/);
  assert.match(window.document.querySelector('#attendanceTotalSalary').textContent, /100\.000/);
  assert.match(window.document.querySelector('#attendanceTotalCashAdvance').textContent, /15\.000/);
  assert.match(window.document.querySelector('#attendanceTotalNetSalary').textContent, /85\.000/);
  assert.match(window.document.querySelector('#attendanceLatestCashAdvance').textContent, /5\.000/);
  assert.match(
    window.document.querySelector('#attendanceLatestCashAdvanceDate').textContent,
    /^\d{4}-\d{2}-\d{2}$/
  );
  assert.match(window.document.querySelector('#attendanceNetPreview').textContent, /45\.000/);
  attendanceForm.elements.checkIn.value = '03:33:33';
  attendanceForm.elements.checkOut.value = '04:44:44';
  attendanceForm.dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true
  }));
  await wait(30);

  const attendanceWrite = window.__writes.find(row =>
    row.type === 'set'
    && row.path.startsWith('attendance/aya/')
    && row.value.attendanceV4 === true
    && row.value.status === 'completed'
  );
  assert.ok(attendanceWrite);
  assert.equal(attendanceWrite.value.attendanceV4, true);
  assert.equal(attendanceWrite.value.status, 'completed');
  assert.equal(attendanceWrite.value.checkIn, clockInWrite.value.checkIn);
  assert.equal(attendanceWrite.value.checkOut, attendanceWrite.value.deviceTime);
  assert.equal(attendanceWrite.value.checkOut, attendanceWrite.value.checkOutDeviceTime);
  assert.notEqual(attendanceWrite.value.checkIn, '03:33:33');
  assert.notEqual(attendanceWrite.value.checkOut, '04:44:44');
  assert.match(attendanceWrite.value.checkOut, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(attendanceWrite.value.salaryPaymentDate, '');
  assert.equal(attendanceWrite.value.deduction, 0);
  assert.equal(attendanceWrite.value.cashAdvanceGiven, 5000);
  assert.equal(attendanceWrite.value.netWage, 45000);
  assert.ok(attendanceWrite.value.deviceName);
  assert.ok(attendanceWrite.value.deviceDate);
  assert.ok(attendanceWrite.value.deviceTime);
  assert.ok(attendanceWrite.value.checkInTimestamp > 0);
  assert.ok(attendanceWrite.value.checkOutTimestamp >= attendanceWrite.value.checkInTimestamp);
  attendanceForm = window.document.querySelector('#attendanceV3Form');
  assert.equal(attendanceForm.elements.checkIn.value, attendanceWrite.value.checkIn);
  assert.equal(attendanceForm.elements.checkOut.value, attendanceWrite.value.checkOut);
  assert.equal(window.document.querySelector('#clockInNow').disabled, true);
  assert.equal(window.document.querySelector('#saveAttendanceV3').disabled, true);
  assert.equal(window.document.querySelector('.aya-attendance-live').dataset.state, 'completed');

  const backfillForm = window.document.querySelector('#attendanceBackfillForm');
  assert.ok(backfillForm);
  assert.equal(backfillForm.elements.date.min, previousDateForTest(new Date()));
  assert.equal(backfillForm.elements.date.max, todayForTest(new Date()));
  assert.equal(backfillForm.elements.checkIn.value, '09:00');
  assert.equal(backfillForm.elements.checkOut.value, '22:00');
  assert.equal(backfillForm.elements.hoursWorked.value, '13.00');
  assert.equal(backfillForm.elements.dailyWage.value, '50000');
  backfillForm.dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true
  }));
  await wait(30);

  const backfillWrite = [...window.__writes].reverse().find(row =>
    row.type === 'push'
    && row.path === 'attendance/aya'
    && row.value.manualAttendanceEntry === true
  );
  assert.ok(backfillWrite);
  assert.equal(backfillWrite.value.status, 'completed');
  assert.equal(backfillWrite.value.checkIn, '09:00:00');
  assert.equal(backfillWrite.value.checkOut, '22:00:00');
  assert.equal(backfillWrite.value.hoursWorked, 13);
  assert.equal(backfillWrite.value.dailyWage, 50000);
  assert.equal(backfillWrite.value.netWage, 50000);
  assert.equal(backfillWrite.value.salaryPaymentDate, '');
  assert.match(backfillWrite.value.deviceName, /Form Absensi Susulan/);
  assert.ok(backfillWrite.value.checkOutTimestamp > backfillWrite.value.checkInTimestamp);

  const duplicatePushCount = window.__writes.filter(row =>
    row.type === 'push'
    && row.path === 'attendance/aya'
    && row.value.manualAttendanceEntry === true
  ).length;
  window.document.querySelector('#attendanceBackfillForm').dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true
  }));
  await wait(30);
  assert.equal(window.__writes.filter(row =>
    row.type === 'push'
    && row.path === 'attendance/aya'
    && row.value.manualAttendanceEntry === true
  ).length, duplicatePushCount);
  assert.ok(messages.some(row => /tidak diduplikasi/.test(row.message)));

  assert.ok(messages.some(row => /tersimpan dalam laporan/.test(row.message)));
  assert.ok(messages.some(row => /Jam masuk/.test(row.message)));
  assert.ok(messages.some(row => /Jam pulang/.test(row.message)));

  ctx.host.remove();
  await wait(1050);

  const supervisorHost = window.document.createElement('section');
  supervisorHost.id = 'supervisorHost';
  window.document.body.append(supervisorHost);
  const supervisorMessages = [];
  await window.__renderPayroll({
    host: supervisorHost,
    branch: { id: 'aya', name: 'AYA SEBLAK DAN ANGKRINGAN' },
    user: { uid: 'supervisor', name: 'Supervisor', role: 'supervisor' },
    notify: (message, type) => supervisorMessages.push({ message, type })
  });

  assert.equal(supervisorHost.querySelectorAll('[data-payroll-tab]').length, 2);
  assert.equal(supervisorHost.querySelector('[data-payroll-tab="running"]'), null);
  assert.equal(supervisorHost.querySelector('[data-payroll-tab="report"]'), null);
  assert.equal(supervisorHost.querySelector('[data-payroll-panel="running"]'), null);
  assert.equal(supervisorHost.querySelector('[data-payroll-panel="report"]'), null);
  assert.equal(supervisorHost.querySelectorAll('[data-edit-payment]').length, 0);
  assert.equal(supervisorHost.querySelectorAll('[data-delete-payment]').length, 0);
  assert.equal(supervisorHost.querySelectorAll('[data-edit-attendance]').length, 0);
  assert.equal(supervisorHost.querySelector('#attendanceBackfillForm'), null);
  assert.match(
    supervisorHost.querySelector('[data-payroll-panel="attendance"]').textContent,
    /Klik nama karyawan terlebih dahulu/
  );
  supervisorHost.querySelector('[data-report-employee="emp1"]').click();
  assert.equal(supervisorHost.querySelectorAll('[data-edit-attendance]').length, 0);
  assert.equal(supervisorHost.querySelectorAll('[data-delete-attendance]').length, 0);
  assert.match(
    supervisorHost.querySelector('.aya-attendance-report-table').textContent,
    /Binti/
  );
  assert.doesNotMatch(
    supervisorHost.querySelector('.aya-attendance-report-table').textContent,
    /Nando/
  );
  const supervisorWage = supervisorHost.querySelector('[name="dailyWage"]');
  assert.equal(supervisorWage.readOnly, true);
  supervisorWage.value = '999999';
  supervisorHost.querySelector('#clockInNow').click();
  await wait(30);
  const supervisorClockIn = [...window.__writes].reverse().find(row =>
    row.type === 'push' && row.path === 'attendance/aya'
  );
  assert.ok(supervisorClockIn);
  assert.equal(supervisorClockIn.value.dailyWage, 50000);

  supervisorHost.remove();
  await wait(1050);
  dom.window.close();
}

(async () => {
  await testCashier();
  await testPayroll();
  console.log('SMOKE FORM ABSENSI SUSULAN v2.14.5: LULUS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
