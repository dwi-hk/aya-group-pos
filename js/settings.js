import { getOnce, setData } from './store.js';
import { fallbackProducts, fallbackBranches } from './menu-data.js';
import { formObject, escapeHTML, download, number } from './utils.js';
import {
  connectDirectPrinter,
  printDirectTest,
  disconnectDirectPrinter,
  directPrinterCapabilities,
  directPrinterStatusText
} from './direct-printer-v2.16.1.js';

function localSettings() {
  try {
    return JSON.parse(localStorage.getItem('aya.settings') || '{}');
  } catch {
    return {};
  }
}

function saveLocal(value) {
  localStorage.setItem('aya.settings', JSON.stringify(value || {}));
}

function checked(value) {
  return value ? 'checked' : '';
}

function selected(value, expected) {
  return String(value) === String(expected) ? 'selected' : '';
}

export async function renderSettings(ctx) {
  const [databaseSettings, stats] = await Promise.all([
    getOnce('businessSettings'),
    getOnce('legacyStats')
  ]);

  const local = localSettings();

  /*
   * Firebase tetap menjadi sumber utama untuk identitas nota.
   * Izin perangkat printer sendiri tetap dikelola browser/perangkat lokal.
   */
  const current = { ...local, ...(databaseSettings || {}) };
  saveLocal(current);

  const count = key => Number(stats?.[key] || 0).toLocaleString('id-ID');
  const caps = directPrinterCapabilities();
  // Printer milik AYA: Rongta RPP02N. Preset ini memprioritaskan Bluetooth Classic SPP.
  const printerModel = current.directPrinterModel || 'rpp02n';
  const printerMode = printerModel === 'rpp02n'
    ? (current.directPrinterMode === 'browser' ? 'browser' : 'serial')
    : (current.directPrinterMode || 'auto');
  const paper = printerModel === 'rpp02n' ? '58' : (current.directPrinterPaper || '58');
  const baud = current.directPrinterBaudRate || 9600;

  ctx.host.innerHTML = `
    <div class="grid two">
      <article class="card">
        <h2>Nota & Identitas Usaha</h2>
        <p class="muted">
          Nilai awal dibaca dari node lama <code>pengaturan/nota</code>, lalu perubahan
          disimpan aman di <code>ayaGroupV2/settings/receipt</code>.
        </p>

        <form id="settingsForm" class="form-grid">
          <label>
            Header Nota
            <input name="header" value="${escapeHTML(current.header || 'AYA GROUP – MULTY PAYMENT')}">
          </label>

          <label>
            No. HP / WA
            <input name="phone" value="${escapeHTML(current.phone || '085136798499')}">
          </label>

          <label class="full">
            Alamat
            <input name="address" value="${escapeHTML(current.address || 'Samping Alfamart Prambon')}">
          </label>

          <label>
            Modal Awal Laci
            <input name="cashDrawerCapital" inputmode="numeric" value="${escapeHTML(current.cashDrawerCapital || 0)}">
          </label>

          <label class="full">
            Footer Nota
            <input name="footer" value="${escapeHTML(current.footer || 'Terima kasih. Pedasnya pas, nikmatnya berkelas.')}">
          </label>

          <button class="primary-button full">Simpan Setting</button>
        </form>
      </article>

      <article class="card" id="directPrinterCard">
        <h2>Printer Thermal Langsung - Rongta RPP02N</h2>
        <p class="muted">
          Preset ini khusus <b>Rongta RPP02N 58 mm</b>. Nota ESC/POS dikirim langsung
          melalui <b>Bluetooth Classic SPP/RFCOMM</b>, tanpa aplikasi pencetak pihak ketiga
          dan tanpa dialog print Windows. Pair RPP02N lebih dulu di Bluetooth Windows; bila
          diminta PIN gunakan <b>0000</b>. Untuk laptop/komputer gunakan Chrome/Edge desktop.
        </p>

        <div class="form-grid">
          <label>
            Model Printer
            <select id="directPrinterModel">
              <option value="rpp02n" ${selected(printerModel, 'rpp02n')}>Rongta RPP02N (Preset AYA)</option>
              <option value="generic" ${selected(printerModel, 'generic')}>Generic ESC/POS</option>
            </select>
          </label>

          <label>
            Mode Printer
            <select id="directPrinterMode">
              <option value="serial" ${selected(printerMode, 'serial')}>RPP02N Bluetooth Classic / SPP</option>
              <option value="auto" ${selected(printerMode, 'auto')}>Auto</option>
              <option value="ble" ${selected(printerMode, 'ble')}>Bluetooth BLE</option>
              <option value="browser" ${selected(printerMode, 'browser')}>Cetak Browser / Windows</option>
            </select>
          </label>

          <label>
            Lebar Kertas
            <select id="directPrinterPaper">
              <option value="58" ${selected(paper, '58')}>58 mm - RPP02N</option>
              <option value="80" ${printerModel === 'rpp02n' ? 'disabled' : ''} ${selected(paper, '80')}>80 mm${printerModel === 'rpp02n' ? ' (tidak untuk RPP02N)' : ''}</option>
            </select>
          </label>

          <label>
            Baud Rate
            <select id="directPrinterBaudRate">
              <option value="9600" ${selected(baud, 9600)}>9600</option>
              <option value="19200" ${selected(baud, 19200)}>19200</option>
              <option value="38400" ${selected(baud, 38400)}>38400</option>
              <option value="57600" ${selected(baud, 57600)}>57600</option>
              <option value="115200" ${selected(baud, 115200)}>115200</option>
            </select>
          </label>

          <label style="display:flex;gap:8px;align-items:center;margin-top:24px">
            <input id="directPrinterAutoCut" type="checkbox" ${printerModel === 'rpp02n' ? 'disabled' : ''} ${checked(printerModel !== 'rpp02n' && current.directPrinterAutoCut === true)}>
            Auto cutter${printerModel === 'rpp02n' ? ' (RPP02N: tidak digunakan)' : ''}
          </label>
        </div>

        <details style="margin-top:12px">
          <summary>Pengaturan BLE lanjutan</summary>
          <p class="muted">
            Tidak perlu diubah untuk kebanyakan printer. Isi hanya jika printer BLE memakai UUID khusus.
          </p>
          <div class="form-grid">
            <label class="full">
              Service UUID
              <input id="serviceUUID" value="${escapeHTML(current.bluetoothServiceUUID || '000018f0-0000-1000-8000-00805f9b34fb')}">
            </label>
            <label class="full">
              Characteristic UUID
              <input id="charUUID" value="${escapeHTML(current.bluetoothCharacteristicUUID || '00002af1-0000-1000-8000-00805f9b34fb')}">
            </label>
          </div>
        </details>

        <div class="toolbar-group" style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button id="applyRpp02nPreset" class="secondary-button" type="button">
            Terapkan Preset RPP02N
          </button>
          <button id="connectDirectPrinter" class="primary-button" type="button">
            Hubungkan / Pilih RPP02N
          </button>
          <button id="testDirectPrinter" class="secondary-button" type="button">
            Tes Cetak
          </button>
          <button id="disconnectDirectPrinter" class="secondary-button" type="button">
            Putuskan
          </button>
        </div>

        <div style="margin-top:12px;padding:10px;border:1px solid var(--border,#ddd);border-radius:8px">
          <div><b>Status:</b> <span id="directPrinterStatus">${escapeHTML(directPrinterStatusText())}</span></div>
          <div class="muted" style="margin-top:6px">
            HTTPS: ${caps.secureContext ? 'Ya' : 'Tidak'} |
            Web Serial: ${caps.serial ? 'Tersedia' : 'Tidak tersedia'} |
            Web Bluetooth: ${caps.bluetooth ? 'Tersedia' : 'Tidak tersedia'}
          </div>
        </div>

        <p class="muted" style="margin-top:10px">
          Setelah RPP02N dipilih satu kali melalui Web Serial, Chrome/Edge dapat mengenali kembali port SPP yang sudah diberi izin. Pada transaksi berikutnya nota akan langsung dikirim setelah transaksi tersimpan. Jika Bluetooth sempat tidur/putus, sistem mencoba reconnect satu kali otomatis.
        </p>
      </article>
    </div>

    <div class="grid two" style="margin-top:16px">
      <article class="card">
        <h2>Backup & Restore</h2>
        <p class="muted">
          Backup manual khusus namespace <code>ayaGroupV2</code>. Restore tidak menghapus node database lama.
        </p>
        <div class="toolbar-group">
          <button id="backupButton" class="secondary-button">Download Backup V2</button>
          <label class="danger-button" style="display:inline-flex;cursor:pointer">
            Restore V2
            <input id="restoreFile" type="file" accept=".json" hidden>
          </label>
        </div>
      </article>

      <article class="card">
        <h2>Data Lama Terdeteksi</h2>
        <div class="summary-row"><span>Master menu</span><b>${count('master_menu')}</b></div>
        <div class="summary-row"><span>Menu tambahan</span><b>${count('menu_tambahan')}</b></div>
        <div class="summary-row"><span>Transaksi</span><b>${count('transaksi')}</b></div>
        <div class="summary-row"><span>Pengeluaran</span><b>${count('pengeluaran')}</b></div>
        <div class="summary-row"><span>Transaksi tanpa cabang</span><b>${count('transaksiTanpaCabang')}</b></div>
        <p class="muted">
          Data lama dibaca langsung melalui adaptor. Transaksi yang tidak mempunyai kolom cabang
          ditandai sebagai data cabang utama AYA Seblak dan Angkringan.
        </p>
      </article>
    </div>

    <article class="card" style="margin-top:16px">
      <h2>Inisialisasi Aman</h2>
      <p class="muted">
        Data contoh hanya diisi bila data produk atau cabang benar-benar kosong.
        Tidak ada proses hapus otomatis.
      </p>
      <button id="seedButton" class="primary-button">Periksa & Isi Data Kosong</button>
    </article>`;

  const printerFields = () => {
    const model = document.querySelector('#directPrinterModel').value;
    return {
    directPrinterModel: model,
    directPrinterMode: model === 'rpp02n' ? 'serial' : document.querySelector('#directPrinterMode').value,
    directPrinterPaper: model === 'rpp02n' ? '58' : document.querySelector('#directPrinterPaper').value,
    directPrinterBaudRate: number(document.querySelector('#directPrinterBaudRate').value) || 9600,
    directPrinterAutoCut: model === 'rpp02n' ? false : document.querySelector('#directPrinterAutoCut').checked,
    bluetoothServiceUUID: document.querySelector('#serviceUUID').value.trim(),
    bluetoothCharacteristicUUID: document.querySelector('#charUUID').value.trim()
  };
  };

  const persistPrinterLocal = () => {
    const next = {
      ...localSettings(),
      ...printerFields(),
      updatedAt: Date.now()
    };
    saveLocal(next);
    return next;
  };

  const refreshPrinterStatus = () => {
    const status = document.querySelector('#directPrinterStatus');
    if (status) status.textContent = directPrinterStatusText();
  };

  document.querySelector('#settingsForm').onsubmit = async event => {
    event.preventDefault();
    const raw = formObject(event.currentTarget);
    const data = {
      ...current,
      ...raw,
      ...printerFields(),
      cashDrawerCapital: number(raw.cashDrawerCapital),
      updatedAt: Date.now()
    };

    saveLocal(data);
    await setData('settings/receipt', data);
    ctx.notify('Setting nota dan printer disimpan');
    refreshPrinterStatus();
  };

  document.querySelector('#applyRpp02nPreset').onclick = async () => {
    document.querySelector('#directPrinterModel').value = 'rpp02n';
    document.querySelector('#directPrinterMode').value = 'serial';
    document.querySelector('#directPrinterPaper').value = '58';
    document.querySelector('#directPrinterBaudRate').value = '9600';
    document.querySelector('#directPrinterAutoCut').checked = false;

    const data = persistPrinterLocal();
    await setData('settings/receipt', { ...current, ...data, updatedAt: Date.now() });
    refreshPrinterStatus();
    ctx.notify('Preset Rongta RPP02N diterapkan: 58 mm, Bluetooth SPP, ESC/POS, tanpa auto cutter.');
  };

  document.querySelector('#connectDirectPrinter').onclick = async () => {
    try {
      const data = persistPrinterLocal();
      if (data.directPrinterMode === 'browser') {
        ctx.notify('Mode Cetak Browser dipilih. Ubah ke Auto / Bluetooth Classic / BLE untuk direct print.', 'error');
        return;
      }

      const result = await connectDirectPrinter({ mode: data.directPrinterMode });
      refreshPrinterStatus();
      ctx.notify(`Printer terhubung: ${result.name || result.transport}`);
    } catch (error) {
      refreshPrinterStatus();
      ctx.notify(error.message || 'Printer gagal dihubungkan.', 'error');
    }
  };

  document.querySelector('#testDirectPrinter').onclick = async () => {
    try {
      const data = persistPrinterLocal();
      if (data.directPrinterMode === 'browser') {
        ctx.notify('Tes direct printer tidak tersedia pada mode Cetak Browser.', 'error');
        return;
      }

      await printDirectTest(data);
      refreshPrinterStatus();
      ctx.notify('Tes cetak berhasil dikirim ke printer');
    } catch (error) {
      refreshPrinterStatus();
      ctx.notify(error.message || 'Tes cetak gagal.', 'error');
    }
  };

  document.querySelector('#disconnectDirectPrinter').onclick = async () => {
    await disconnectDirectPrinter();
    refreshPrinterStatus();
    ctx.notify('Koneksi printer diputuskan');
  };

  document.querySelector('#directPrinterModel').onchange = () => {
    const model = document.querySelector('#directPrinterModel').value;
    const paper80 = document.querySelector('#directPrinterPaper option[value="80"]');
    const cutter = document.querySelector('#directPrinterAutoCut');
    if (model === 'rpp02n') {
      document.querySelector('#directPrinterMode').value = 'serial';
      document.querySelector('#directPrinterPaper').value = '58';
      cutter.checked = false;
      cutter.disabled = true;
      if (paper80) paper80.disabled = true;
    } else {
      cutter.disabled = false;
      if (paper80) paper80.disabled = false;
    }
    persistPrinterLocal();
    refreshPrinterStatus();
  };

  document.querySelector('#directPrinterMode').onchange = () => {
    persistPrinterLocal();
    refreshPrinterStatus();
  };

  document.querySelector('#directPrinterPaper').onchange = persistPrinterLocal;
  document.querySelector('#directPrinterBaudRate').onchange = persistPrinterLocal;
  document.querySelector('#directPrinterAutoCut').onchange = persistPrinterLocal;

  document.querySelector('#backupButton').onclick = async () => {
    const data = await getOnce('');
    download(
      `aya-group-backup-v2-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data || {}, null, 2)
    );
    ctx.notify('Backup V2 diunduh');
  };

  document.querySelector('#restoreFile').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());
      if (!confirm('Restore akan mengganti namespace ayaGroupV2. Node lama tidak dihapus. Lanjutkan?')) return;
      await setData('', data);
      ctx.notify('Restore V2 selesai');
    } catch (error) {
      ctx.notify('File backup tidak valid', 'error');
    }
  };

  document.querySelector('#seedButton').onclick = async () => {
    const existingProducts = await getOnce('products');
    const existingBranches = await getOnce('branches');

    if (!existingProducts) {
      for (const product of fallbackProducts) {
        await setData(`products/${product.id}`, product);
      }
    }

    if (!existingBranches) {
      for (const branch of fallbackBranches) {
        await setData(`branches/${branch.id}`, branch);
      }
    }

    ctx.notify('Pemeriksaan selesai; data lama tetap aman');
    window.dispatchEvent(new Event('aya-branches-changed'));
  };
}
