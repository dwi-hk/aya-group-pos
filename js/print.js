import {
  rupiah,
  escapeHTML,
  download
} from './utils.js';
import { getOnce } from './store.js';

function localSettings() {
  try {
    return JSON.parse(
      localStorage.getItem('aya.settings') || '{}'
    );
  } catch {
    return {};
  }
}

function normalizeSettings(value = {}) {
  const local = localSettings();

  /*
   * Firebase menjadi sumber utama agar pengaturan yang dibuat di laptop
   * juga dipakai ketika mencetak dari tablet atau HP.
   * Local storage tetap menjadi cadangan saat perangkat sedang offline.
   */
  const settings = {
    ...local,
    ...(value || {})
  };

  settings.phone = String(
    settings.phone
    || settings.wa
    || settings.whatsapp
    || settings.noHp
    || settings.noHP
    || settings.telepon
    || ''
  ).trim();

  return settings;
}

function saveLocalSettings(settings) {
  try {
    localStorage.setItem(
      'aya.settings',
      JSON.stringify(settings)
    );
  } catch (error) {
    console.warn(
      'Pengaturan nota tidak dapat disimpan lokal:',
      error
    );
  }
}

export function receiptHTML(
  sale,
  receiptSettings = {}
) {
  const s = normalizeSettings(receiptSettings);

  const rows = (sale.items || [])
    .map(item => `
      <tr>
        <td>
          ${escapeHTML(item.name)}
          <br>
          <small>
            ${item.qty} × ${rupiah(item.price)}
          </small>
        </td>
        <td>${rupiah(item.qty * item.price)}</td>
      </tr>
    `)
    .join('');

  const header = s.header || 'AYA GROUP';
  const address = s.address || sale.branchName || '';
  const phone = s.phone;
  const footer = s.footer || 'Terima kasih';

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Nota ${escapeHTML(sale.invoice)}</title>
        <style>
          @page {
            size: 58mm auto;
            margin: 2mm;
          }

          body {
            width: 54mm;
            margin: 0;
            font: 11px monospace;
            color: #000;
          }

          .c {
            text-align: center;
          }

          .r {
            text-align: right;
          }

          h2,
          p {
            margin: 3px 0;
          }

          .contact {
            font-weight: bold;
          }

          table {
            width: 100%;
            border-collapse: collapse;
          }

          td {
            padding: 3px 0;
            border-bottom: 1px dashed #999;
            vertical-align: top;
          }

          td:last-child {
            text-align: right;
          }

          .total {
            font-size: 13px;
            font-weight: bold;
          }

          .cut {
            border-top: 1px dashed #000;
            margin: 8px 0;
          }
        </style>
      </head>

      <body>
        <div class="c">
          <h2>${escapeHTML(header)}</h2>
          ${address
            ? `<p>${escapeHTML(address)}</p>`
            : ''}
          ${phone
            ? `<p class="contact">WA: ${escapeHTML(phone)}</p>`
            : ''}
        </div>

        <div class="cut"></div>

        <p>No: ${escapeHTML(sale.invoice)}</p>
        <p>Kasir: ${escapeHTML(sale.cashierName || '-')}</p>
        <p>${new Date(sale.createdAt).toLocaleString('id-ID')}</p>

        <table>
          ${rows}

          <tr>
            <td>Subtotal</td>
            <td>${rupiah(sale.subtotal)}</td>
          </tr>

          <tr>
            <td>Ongkir</td>
            <td>${rupiah(sale.shipping)}</td>
          </tr>

          <tr>
            <td>Styrofoam</td>
            <td>${rupiah(sale.styrofoamTotal)}</td>
          </tr>

          <tr>
            <td>Diskon</td>
            <td>-${rupiah(sale.discount)}</td>
          </tr>

          <tr class="total">
            <td>TOTAL</td>
            <td>${rupiah(sale.total)}</td>
          </tr>

          <tr>
            <td>Bayar</td>
            <td>${rupiah(sale.paid)}</td>
          </tr>

          <tr>
            <td>Kembali</td>
            <td>${rupiah(sale.change)}</td>
          </tr>
        </table>

        <p>Metode: ${escapeHTML(sale.paymentMethod || '-')}</p>
        <p>Pesanan: ${escapeHTML(sale.orderType || '-')}</p>

        <div class="cut"></div>

        <div class="c">
          <p>${escapeHTML(footer)}</p>
        </div>

        <script>
          onload = () => setTimeout(() => print(), 200);
        </script>
      </body>
    </html>`;
}

function writeReceipt(windowReference, sale, settings) {
  if (!windowReference || windowReference.closed) return;

  windowReference.document.open();
  windowReference.document.write(
    receiptHTML(sale, settings)
  );
  windowReference.document.close();
}

export function printReceipt(sale) {
  /*
   * Pop-up harus dibuka langsung saat tombol ditekan agar tidak diblokir
   * browser. Pengaturan Firebase dimuat setelah jendela berhasil dibuka.
   */
  const printWindow = window.open(
    '',
    '_blank',
    'width=420,height=720'
  );

  if (!printWindow) {
    throw new Error(
      'Pop-up diblokir browser. Izinkan pop-up untuk mencetak.'
    );
  }

  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Menyiapkan nota…</title>
        <style>
          body {
            font: 14px Arial, sans-serif;
            padding: 24px;
            text-align: center;
          }
        </style>
      </head>
      <body>
        Menyiapkan nota dan identitas usaha…
      </body>
    </html>`);
  printWindow.document.close();

  getOnce('businessSettings')
    .then(databaseSettings => {
      const settings = normalizeSettings(
        databaseSettings || {}
      );

      saveLocalSettings(settings);
      writeReceipt(printWindow, sale, settings);
    })
    .catch(error => {
      console.warn(
        'Pengaturan Firebase gagal dimuat. Memakai data lokal:',
        error
      );

      writeReceipt(
        printWindow,
        sale,
        localSettings()
      );
    });

  return printWindow;
}

export function printLabel(
  product,
  { copies = 1 } = {}
) {
  const labels = Array.from(
    { length: copies },
    () => `
      <div class="label">
        <b>${escapeHTML(product.name)}</b>
        <strong>${rupiah(product.price)}</strong>
        <small>${escapeHTML(product.barcode || product.id)}</small>
      </div>
    `
  ).join('');

  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    throw new Error(
      'Pop-up diblokir browser. Izinkan pop-up untuk mencetak.'
    );
  }

  printWindow.document.write(`
    <style>
      @page {
        margin: 4mm;
      }

      .label {
        display: inline-grid;
        width: 45mm;
        height: 28mm;
        border: 1px solid #000;
        padding: 3mm;
        margin: 1mm;
        font: 12px Arial;
      }

      .label strong {
        font-size: 18px;
      }

      .label small {
        margin-top: auto;
      }
    </style>

    ${labels}

    <script>
      onload = () => print();
    </script>
  `);

  printWindow.document.close();
}

export function printPage() {
  window.print();
}

export function exportJSON(name, data) {
  download(
    `${name}-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(data, null, 2)
  );
}
