/*
 * AYA GROUP POS - Direct Thermal Printer v2.16.1 - RPP02N
 * ------------------------------------------------------------
 * Direct printing from the browser without a helper application.
 * Desktop priority: Web Serial -> Bluetooth Classic RFCOMM/SPP.
 * Fallback: Web Bluetooth -> BLE thermal printers.
 *
 * IMPORTANT:
 * - Web Serial / Web Bluetooth require HTTPS (or localhost).
 * - The first device selection must be initiated by a user click.
 * - On desktop, Chrome/Edge are recommended for Web Serial.
 */

const encoder = new TextEncoder();

let serialPort = null;
let bleDevice = null;
let bleCharacteristic = null;
let bleWriteMode = 'withoutResponse';

const DEFAULT_SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

// Preset khusus Rongta RPP02N: 58 mm, Bluetooth Classic SPP/RFCOMM, ESC/POS.
const RPP02N_MODEL = 'rpp02n';
const RPP02N_DEFAULTS = Object.freeze({
  directPrinterModel: RPP02N_MODEL,
  directPrinterMode: 'serial',
  directPrinterPaper: '58',
  directPrinterBaudRate: 9600,
  directPrinterAutoCut: false
});

function effectiveSettings(value = {}) {
  const merged = { ...readLocalSettings(), ...(value || {}) };
  const model = String(merged.directPrinterModel || RPP02N_MODEL).toLowerCase();
  if (model === RPP02N_MODEL) {
    return {
      ...merged,
      directPrinterModel: RPP02N_MODEL,
      // RPP02N memakai Bluetooth Classic Serial Port Profile (SPP), bukan BLE GATT.
      directPrinterMode: merged.directPrinterMode === 'browser' ? 'browser' : 'serial',
      directPrinterPaper: '58',
      directPrinterBaudRate: Number(merged.directPrinterBaudRate || 9600) || 9600,
      // RPP02N portable menggunakan tear bar, sehingga perintah cutter tidak dikirim.
      directPrinterAutoCut: false
    };
  }
  return merged;
}

const DEFAULT_BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
];

function readLocalSettings() {
  try {
    return JSON.parse(localStorage.getItem('aya.settings') || '{}');
  } catch {
    return {};
  }
}

function writeLocalSettings(patch = {}) {
  const next = { ...readLocalSettings(), ...patch };
  try {
    localStorage.setItem('aya.settings', JSON.stringify(next));
  } catch (error) {
    console.warn('Pengaturan printer tidak dapat disimpan lokal:', error);
  }
  return next;
}

function normalizeUuid(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeMode(value = 'auto') {
  const mode = String(value || 'auto').toLowerCase();
  return ['auto', 'serial', 'ble', 'browser'].includes(mode) ? mode : 'auto';
}

function cleanText(value = '') {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\r\n]/g, '?');
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `Rp ${Math.round(number(value)).toLocaleString('id-ID')}`;
}

function fingerprintFromInfo(info = {}) {
  return JSON.stringify({
    usbVendorId: info.usbVendorId ?? null,
    usbProductId: info.usbProductId ?? null,
    bluetoothServiceClassId: info.bluetoothServiceClassId ?? null
  });
}

function currentSerialFingerprint() {
  return String(readLocalSettings().directPrinterSerialFingerprint || '');
}

function portMatchesSaved(port) {
  try {
    const saved = currentSerialFingerprint();
    if (!saved) return false;
    return fingerprintFromInfo(port.getInfo?.() || {}) === saved;
  } catch {
    return false;
  }
}

function chunkBytes(bytes, size = 180) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.slice(i, i + size));
  }
  return chunks;
}

function padRight(text, width) {
  const value = cleanText(text).slice(0, width);
  return value + ' '.repeat(Math.max(0, width - value.length));
}

function padLeft(text, width) {
  const value = cleanText(text).slice(0, width);
  return ' '.repeat(Math.max(0, width - value.length)) + value;
}

function twoColumns(left, right, width) {
  const r = cleanText(right);
  const availableLeft = Math.max(1, width - r.length - 1);
  const l = cleanText(left).slice(0, availableLeft);
  return `${l}${' '.repeat(Math.max(1, width - l.length - r.length))}${r}`.slice(0, width);
}

function center(text, width) {
  const value = cleanText(text).slice(0, width);
  const left = Math.max(0, Math.floor((width - value.length) / 2));
  return `${' '.repeat(left)}${value}`;
}

function wrap(text, width) {
  const words = cleanText(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines = [];
  let line = '';

  for (const word of words) {
    if (!line) {
      line = word.slice(0, width);
      continue;
    }

    const trial = `${line} ${word}`;
    if (trial.length <= width) {
      line = trial;
    } else {
      lines.push(line);
      line = word.slice(0, width);
    }
  }

  if (line) lines.push(line);
  return lines;
}

function receiptText(sale, settings = {}) {
  settings = effectiveSettings(settings);
  const paper = String(settings.directPrinterPaper || '58');
  const width = paper === '80' ? 48 : 32;
  const line = '-'.repeat(width);
  const rows = [];

  const header = settings.header || 'AYA GROUP - MULTY PAYMENT';
  const address = settings.address || sale.branchName || '';
  const phone = settings.phone || settings.wa || settings.whatsapp || '';
  const footer = settings.footer || 'Terima kasih';

  rows.push(center(header, width));
  if (address) {
    for (const addressLine of wrap(address, width)) rows.push(center(addressLine, width));
  }
  if (phone) rows.push(center(`WA: ${phone}`, width));
  rows.push(line);
  rows.push(twoColumns('No', sale.invoice || '-', width));
  rows.push(twoColumns('Kasir', sale.cashierName || '-', width));
  rows.push(cleanText(new Date(sale.createdAt || Date.now()).toLocaleString('id-ID')));

  if (sale.customerName) rows.push(twoColumns('Pelanggan', sale.customerName, width));
  if (sale.customerPhone) rows.push(twoColumns('WA', sale.customerPhone, width));

  rows.push(line);

  for (const item of sale.items || []) {
    for (const itemLine of wrap(item.name || '-', width)) rows.push(itemLine);
    const qty = number(item.qty);
    const unit = number(item.price);
    rows.push(twoColumns(`${qty} x ${money(unit)}`, money(qty * unit), width));
  }

  rows.push(line);
  rows.push(twoColumns('Subtotal', money(sale.subtotal), width));

  if (number(sale.shipping)) {
    rows.push(twoColumns('Ongkir', money(sale.shipping), width));
  }
  if (number(sale.styrofoamTotal)) {
    rows.push(twoColumns('Styrofoam', money(sale.styrofoamTotal), width));
  }
  if (number(sale.discount)) {
    rows.push(twoColumns('Diskon', `-${money(sale.discount)}`, width));
  }

  rows.push(line);
  rows.push(twoColumns('TOTAL', money(sale.total), width));
  rows.push(twoColumns('Bayar', money(sale.paid), width));
  rows.push(twoColumns('Kembali', money(sale.change), width));
  rows.push(line);
  rows.push(twoColumns('Metode', sale.paymentMethod || '-', width));
  rows.push(twoColumns('Pesanan', sale.orderType || '-', width));

  if (sale.notes) {
    rows.push(line);
    rows.push('Catatan:');
    rows.push(...wrap(sale.notes, width));
  }

  rows.push(line);
  for (const footerLine of wrap(footer, width)) rows.push(center(footerLine, width));
  rows.push('');
  rows.push('');
  rows.push('');

  return rows.join('\n');
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function escposReceiptBytes(sale, settings = {}) {
  settings = effectiveSettings(settings);
  const init = new Uint8Array([0x1b, 0x40]); // ESC @
  const left = new Uint8Array([0x1b, 0x61, 0x00]);
  const normal = new Uint8Array([0x1b, 0x21, 0x00]);
  const feed = new Uint8Array([0x1b, 0x64, 0x03]);
  const cut = settings.directPrinterAutoCut
    ? new Uint8Array([0x1d, 0x56, 0x42, 0x00])
    : new Uint8Array([]);

  return concatBytes(
    init,
    left,
    normal,
    encoder.encode(receiptText(sale, settings)),
    feed,
    cut
  );
}

export function directPrinterCapabilities() {
  return {
    secureContext: window.isSecureContext,
    serial: 'serial' in navigator,
    bluetooth: 'bluetooth' in navigator,
    userAgent: navigator.userAgent
  };
}

export function directPrinterSupported() {
  const caps = directPrinterCapabilities();
  return caps.secureContext && (caps.serial || caps.bluetooth);
}

async function openSerialPort(port, settings = {}) {
  settings = effectiveSettings(settings);
  if (!port) throw new Error('Port printer belum dipilih.');
  if (port.writable) return port;

  const baudRate = Math.max(1200, number(settings.directPrinterBaudRate || 9600));

  try {
    await port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 4096
    });
  } catch (error) {
    // Jika port sudah terbuka oleh halaman ini, writable biasanya sudah tersedia.
    if (!port.writable) throw error;
  }

  return port;
}

async function rememberedSerialPort() {
  if (!('serial' in navigator)) return null;

  const ports = await navigator.serial.getPorts();
  if (!ports.length) return null;

  const matches = ports.filter(portMatchesSaved);
  if (matches.length === 1) return matches[0];

  // Fingerprint Bluetooth SPP bisa sama untuk lebih dari satu printer.
  // Jangan menebak bila ada beberapa port yang sudah diberi izin.
  if (matches.length > 1) return null;
  return ports.length === 1 ? ports[0] : null;
}

export async function connectSerialPrinter({ choose = true } = {}) {
  if (!window.isSecureContext) {
    throw new Error('Direct printer membutuhkan HTTPS. Buka aplikasi dari Firebase Hosting/HTTPS.');
  }
  if (!('serial' in navigator)) {
    throw new Error('Web Serial tidak didukung browser ini. Gunakan Chrome atau Edge desktop terbaru.');
  }

  const settings = effectiveSettings(readLocalSettings());
  let port = serialPort || await rememberedSerialPort();

  if (!port && choose) {
    // RPP02N memakai Bluetooth Classic SPP (UUID 0x1101). Chrome 117+ desktop
    // dapat menampilkan RFCOMM/SPP langsung melalui Web Serial.
    if (settings.directPrinterModel === RPP02N_MODEL) {
      try {
        port = await navigator.serial.requestPort({
          filters: [{ bluetoothServiceClassId: DEFAULT_SPP_UUID }]
        });
      } catch (error) {
        // Fallback untuk browser lama yang belum menerima filter Bluetooth.
        if (error?.name === 'TypeError') {
          port = await navigator.serial.requestPort();
        } else {
          throw error;
        }
      }
    } else {
      port = await navigator.serial.requestPort();
    }
  }

  if (!port) {
    throw new Error('Printer belum diizinkan. Klik Hubungkan / Pilih Printer terlebih dahulu.');
  }

  await openSerialPort(port, settings);
  serialPort = port;

  const info = port.getInfo?.() || {};
  writeLocalSettings({
    directPrinterTransport: 'serial',
    directPrinterSerialFingerprint: fingerprintFromInfo(info),
    directPrinterSerialInfo: info,
    directPrinterLastConnectedAt: Date.now(),
    directPrinterModel: settings.directPrinterModel || RPP02N_MODEL
  });

  return {
    transport: 'serial',
    name: info.bluetoothServiceClassId
      ? (settings.directPrinterModel === RPP02N_MODEL ? 'Rongta RPP02N - Bluetooth SPP' : 'Printer Bluetooth Classic / RFCOMM')
      : (settings.directPrinterModel === RPP02N_MODEL ? 'Rongta RPP02N - Serial/USB' : 'Printer Serial / USB'),
    info
  };
}

async function discoverBleWritableCharacteristic(device, settings = {}) {
  const server = device.gatt.connected
    ? device.gatt
    : await device.gatt.connect();

  const configuredService = normalizeUuid(settings.bluetoothServiceUUID);
  const configuredChar = normalizeUuid(settings.bluetoothCharacteristicUUID);

  const services = [configuredService, ...DEFAULT_BLE_SERVICES]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  const errors = [];

  for (const serviceUuid of services) {
    try {
      const service = await server.getPrimaryService(serviceUuid);

      if (configuredChar && serviceUuid === configuredService) {
        try {
          const characteristic = await service.getCharacteristic(configuredChar);
          if (characteristic.properties.writeWithoutResponse || characteristic.properties.write) {
            return characteristic;
          }
        } catch (error) {
          errors.push(`${serviceUuid}: ${error.message}`);
        }
      }

      const chars = await service.getCharacteristics();
      const writable = chars.find(char =>
        char.properties.writeWithoutResponse || char.properties.write
      );

      if (writable) return writable;
    } catch (error) {
      errors.push(`${serviceUuid}: ${error.message}`);
    }
  }

  throw new Error(
    'Karakteristik tulis printer BLE tidak ditemukan. Isi Service UUID dan Characteristic UUID printer pada Pengaturan bila printer memakai UUID khusus.'
  );
}

export async function connectBlePrinter({ choose = true } = {}) {
  if (!window.isSecureContext) {
    throw new Error('Direct printer membutuhkan HTTPS. Buka aplikasi dari Firebase Hosting/HTTPS.');
  }
  if (!('bluetooth' in navigator)) {
    throw new Error('Web Bluetooth tidak didukung browser ini. Gunakan Chrome/Edge pada perangkat yang mendukung.');
  }

  const settings = readLocalSettings();
  const configuredService = normalizeUuid(settings.bluetoothServiceUUID);
  const services = [configuredService, ...DEFAULT_BLE_SERVICES]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  if (!bleDevice && choose) {
    bleDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: services
    });
  }

  if (!bleDevice) {
    throw new Error('Printer BLE belum dipilih. Klik Hubungkan / Pilih Printer terlebih dahulu.');
  }

  bleCharacteristic = await discoverBleWritableCharacteristic(bleDevice, settings);
  bleWriteMode = bleCharacteristic.properties.writeWithoutResponse
    ? 'withoutResponse'
    : 'withResponse';

  writeLocalSettings({
    directPrinterTransport: 'ble',
    directPrinterBleName: bleDevice.name || 'Printer BLE',
    directPrinterLastConnectedAt: Date.now()
  });

  return {
    transport: 'ble',
    name: bleDevice.name || 'Printer Bluetooth BLE'
  };
}

export async function connectDirectPrinter({ mode } = {}) {
  const settings = effectiveSettings(readLocalSettings());
  const selectedMode = normalizeMode(mode || settings.directPrinterMode || 'serial');

  if (selectedMode === 'browser') {
    throw new Error('Mode printer saat ini adalah Cetak Browser, bukan Direct Printer.');
  }

  if (selectedMode === 'serial') return connectSerialPrinter({ choose: true });
  if (selectedMode === 'ble') return connectBlePrinter({ choose: true });

  // Auto: pada desktop pilih Web Serial lebih dulu karena mendukung Bluetooth Classic SPP/RFCOMM.
  if ('serial' in navigator) {
    return connectSerialPrinter({ choose: true });
  }
  if ('bluetooth' in navigator) {
    return connectBlePrinter({ choose: true });
  }

  throw new Error('Browser ini tidak mendukung Direct Printer. Gunakan Chrome atau Edge desktop terbaru.');
}

async function writeSerial(bytes, settings = {}) {
  settings = effectiveSettings(settings);

  async function writeOnce(port) {
    await openSerialPort(port, settings);
    serialPort = port;

    if (!port.writable) {
      throw new Error('Port RPP02N tidak dapat ditulis. Pastikan printer menyala dan Bluetooth Windows masih terhubung.');
    }

    const writer = port.writable.getWriter();
    try {
      // RPP02N memiliki buffer portable yang relatif kecil. Kirim per 256 byte
      // dengan jeda singkat agar nota panjang tidak terpotong.
      for (const chunk of chunkBytes(bytes, 256)) {
        await writer.write(chunk);
        await new Promise(resolve => setTimeout(resolve, 8));
      }
    } finally {
      writer.releaseLock();
    }
  }

  let port = serialPort || await rememberedSerialPort();
  if (!port) {
    throw new Error('RPP02N belum dipilih. Buka Pengaturan > Printer RPP02N lalu klik Hubungkan / Pilih RPP02N.');
  }

  try {
    await writeOnce(port);
  } catch (firstError) {
    // Satu kali reconnect otomatis untuk kasus RFCOMM sempat putus/tidur.
    try {
      if (port.readable || port.writable) await port.close();
    } catch {}
    serialPort = null;
    await new Promise(resolve => setTimeout(resolve, 250));

    port = await rememberedSerialPort();
    if (!port) throw firstError;
    await writeOnce(port);
  }
}

async function writeBle(bytes) {
  if (!bleDevice || !bleCharacteristic) {
    throw new Error('Printer BLE belum aktif pada sesi ini. Hubungkan printer dari Pengaturan.');
  }

  if (!bleDevice.gatt.connected) {
    bleCharacteristic = await discoverBleWritableCharacteristic(
      bleDevice,
      readLocalSettings()
    );
  }

  for (const chunk of chunkBytes(bytes, 120)) {
    if (bleWriteMode === 'withoutResponse' && bleCharacteristic.writeValueWithoutResponse) {
      await bleCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await bleCharacteristic.writeValue(chunk);
    }

    // Jeda kecil membantu printer BLE murah yang memiliki buffer kecil.
    await new Promise(resolve => setTimeout(resolve, 18));
  }
}

export async function printDirectReceipt(sale, overrideSettings = {}) {
  const settings = effectiveSettings(overrideSettings || {});
  const mode = normalizeMode(settings.directPrinterMode || 'serial');

  if (mode === 'browser') {
    throw new Error('Direct print tidak aktif karena mode Cetak Browser dipilih.');
  }

  if (!window.isSecureContext) {
    throw new Error('Direct print hanya berjalan melalui HTTPS/secure context.');
  }

  const bytes = escposReceiptBytes(sale, settings);
  const rememberedTransport = settings.directPrinterTransport;

  if (mode === 'serial' || (mode === 'auto' && rememberedTransport === 'serial')) {
    await writeSerial(bytes, settings);
    return { transport: 'serial' };
  }

  if (mode === 'ble' || (mode === 'auto' && rememberedTransport === 'ble')) {
    await writeBle(bytes);
    return { transport: 'ble' };
  }

  // Auto tanpa transport tersimpan: coba port serial yang sudah pernah diberi izin.
  if (mode === 'auto' && 'serial' in navigator) {
    const port = await rememberedSerialPort();
    if (port) {
      await writeSerial(bytes, settings);
      return { transport: 'serial' };
    }
  }

  throw new Error('Printer direct belum dihubungkan. Buka Pengaturan > Printer, klik Hubungkan / Pilih Printer, lalu Tes Cetak.');
}

export async function printDirectTest(overrideSettings = {}) {
  const settings = effectiveSettings(overrideSettings || {});
  const now = Date.now();

  return printDirectReceipt({
    invoice: 'TEST-PRINTER',
    cashierName: 'AYA POS',
    createdAt: now,
    branchName: settings.address || 'AYA SEBLAK DAN ANGKRINGAN',
    customerName: '',
    customerPhone: '',
    items: [
      { name: 'RPP02N TEST PRINT', qty: 1, price: 1000 },
      { name: 'Bluetooth SPP OK', qty: 1, price: 0 }
    ],
    subtotal: 1000,
    shipping: 0,
    styrofoamTotal: 0,
    discount: 0,
    total: 1000,
    paid: 1000,
    change: 0,
    paymentMethod: 'TEST',
    orderType: 'TEST',
    notes: ''
  }, settings);
}

export async function disconnectDirectPrinter() {
  const tasks = [];

  if (serialPort) {
    const port = serialPort;
    serialPort = null;
    if (port.readable || port.writable) {
      tasks.push(port.close().catch(() => {}));
    }
  }

  if (bleDevice?.gatt?.connected) {
    bleDevice.gatt.disconnect();
  }
  bleDevice = null;
  bleCharacteristic = null;

  await Promise.all(tasks);
}

export function directPrinterStatusText() {
  const caps = directPrinterCapabilities();
  const settings = effectiveSettings(readLocalSettings());
  const mode = normalizeMode(settings.directPrinterMode || 'serial');
  const transport = settings.directPrinterTransport || '-';

  if (!caps.secureContext) return 'Tidak aktif: aplikasi harus dibuka lewat HTTPS.';
  if (!caps.serial && !caps.bluetooth) return 'Tidak didukung browser ini. Gunakan Chrome/Edge desktop terbaru.';

  if (serialPort?.writable) return settings.directPrinterModel === RPP02N_MODEL ? 'Terhubung - Rongta RPP02N (Bluetooth SPP)' : 'Terhubung - Direct Serial/Bluetooth Classic';
  if (bleDevice?.gatt?.connected && bleCharacteristic) return `Terhubung - ${bleDevice.name || 'Bluetooth BLE'}`;

  if (mode === 'browser') return 'Mode: Cetak Browser';
  if (transport === 'serial') return settings.directPrinterModel === RPP02N_MODEL ? 'RPP02N sudah pernah diizinkan; AYA POS akan mencoba menyambung otomatis saat mencetak.' : 'Printer Serial/Bluetooth Classic sudah pernah diizinkan; akan tersambung otomatis saat mencetak.';
  if (transport === 'ble') return 'Printer BLE pernah dipilih; hubungkan ulang setelah halaman dimuat ulang bila diperlukan.';
  return 'Belum dihubungkan.';
}
