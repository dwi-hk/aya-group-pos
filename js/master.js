import {
  saveProduct,
  updateProductCost,
  setData,
  getOnce,
  pushData,
  stockForBranch
} from './store.js';
import { db } from './firebase-config.js';
import {
  ref,
  update
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  getCachedProducts,
  invalidateProductCache,
  productBelongsToBranch
} from './product-cache.js';
import {
  rupiah, escapeHTML, formObject, uid, number, csvCell, download, toArray
} from './utils.js';
import { audit } from './audit.js';
import { printLabel } from './print.js';

const MASTER_PAGE_SIZE = 100;
const MASTER_SEARCH_DELAY = 180;
const THIN_MARGIN_LIMIT = 10;

const INITIAL_STOCK_BRANCH_ID = 'aya-seblak-angkringan';
const INITIAL_STOCK_VALUE = 100000;
const INITIAL_STOCK_DATE = '2026-08-09';
const INITIAL_STOCK_MARKER =
  `settings/stockInitializations/${INITIAL_STOCK_BRANCH_ID}/${INITIAL_STOCK_DATE}`;

function profitInfo(product = {}) {
  const hpp = number(product.cost);
  const retailPrice = number(product.price);
  const wholesalePrice = number(
    product.wholesalePrice || retailPrice
  );
  const resellerPrice = number(
    product.resellerPrice || retailPrice
  );

  const retailProfit = retailPrice - hpp;
  const wholesaleProfit = wholesalePrice - hpp;
  const resellerProfit = resellerPrice - hpp;
  const retailMargin = retailPrice > 0
    ? (retailProfit / retailPrice) * 100
    : 0;

  let status = 'Untung';
  let statusClass = 'profit-good';

  if (hpp <= 0) {
    status = 'HPP Belum Diisi';
    statusClass = 'profit-missing';
  } else if (retailProfit < 0) {
    status = 'Rugi';
    statusClass = 'profit-loss';
  } else if (retailProfit === 0) {
    status = 'Impas';
    statusClass = 'profit-even';
  } else if (retailMargin < THIN_MARGIN_LIMIT) {
    status = 'Profit Tipis';
    statusClass = 'profit-thin';
  }

  return {
    hpp,
    retailPrice,
    wholesalePrice,
    resellerPrice,
    retailProfit,
    wholesaleProfit,
    resellerProfit,
    retailMargin,
    status,
    statusClass
  };
}

function profitSummary(products = []) {
  return products.reduce((summary, product) => {
    const info = profitInfo(product);

    summary.total++;

    if (info.hpp <= 0) summary.missing++;
    else if (info.retailProfit < 0) summary.loss++;
    else if (info.retailProfit === 0) summary.even++;
    else if (info.retailMargin < THIN_MARGIN_LIMIT) summary.thin++;
    else summary.profit++;

    return summary;
  }, {
    total: 0,
    profit: 0,
    thin: 0,
    even: 0,
    loss: 0,
    missing: 0
  });
}

function profitCell(product) {
  const info = profitInfo(product);

  if (info.hpp <= 0) {
    return `
      <div class="master-profit-cell">
        <strong class="profit-missing">HPP belum diisi</strong>
        <small>Profit belum dapat dihitung dengan benar.</small>
        <span class="master-profit-badge profit-missing">
          Lengkapi HPP
        </span>
      </div>
    `;
  }

  return `
    <div class="master-profit-cell">
      <strong class="${info.statusClass}">
        Ecer: ${rupiah(info.retailProfit)}
      </strong>
      <small>Margin ${info.retailMargin.toFixed(1)}%</small>
      <small>Grosir: ${rupiah(info.wholesaleProfit)}</small>
      <small>Reseller: ${rupiah(info.resellerProfit)}</small>
      <span class="master-profit-badge ${info.statusClass}">
        ${escapeHTML(info.status)}
      </span>
    </div>
  `;
}

function debounce(callback, delay = MASTER_SEARCH_DELAY) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export async function renderMaster(ctx) {
  let allProducts = await getCachedProducts();
  let products = [];
  let currentPage = 1;
  let productById = new Map();

  const canInitializeStock = (
    String(ctx.user?.role || '').toLowerCase() === 'owner'
    && ctx.branch.id === INITIAL_STOCK_BRANCH_ID
  );

  let stockInitialization = canInitializeStock
    ? await getOnce(INITIAL_STOCK_MARKER, { force: true })
    : null;

  const applyBranch = () => {
    products = allProducts
      .filter(product => (
        product.active !== false
        && productBelongsToBranch(product, ctx.branch.id)
      ))
      .map(product => ({
        ...product,
        stock: stockForBranch(product, ctx.branch.id),
        _search: `${product.name || ''} ${product.barcode || ''} ${product.code || ''} ${product.id || ''}`
          .toLowerCase()
      }));

    productById = new Map(products.map(product => [String(product.id), product]));
  };

  const filteredRows = () => {
    const query = (document.querySelector('#masterSearch')?.value || '').trim().toLowerCase();
    const category = document.querySelector('#masterCategory')?.value || 'Semua';

    return products.filter(product => (
      (category === 'Semua' || product.category === category)
      && (!query || product._search.includes(query))
    ));
  };

  const renderRows = () => {
    const body = document.querySelector('#productRows');
    if (!body) return;

    const rows = filteredRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / MASTER_PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * MASTER_PAGE_SIZE;
    const pageRows = rows.slice(start, start + MASTER_PAGE_SIZE);

    body.innerHTML = pageRows.length
      ? pageRows.map(product => `
          <tr>
            <td>
              <strong>${escapeHTML(product.name)}</strong><br>
              <small class="muted">${escapeHTML(product.unit)} · ${escapeHTML(product.source || 'database')}</small>
            </td>
            <td>${escapeHTML(product.category)}</td>
            <td>${escapeHTML(product.barcode || '-')}</td>
            <td>
              ${rupiah(product.cost)} / ${escapeHTML(product.unit)}<br>
              <small class="muted">
                ${rupiah(product.cartonCost || 0)} / ${escapeHTML(product.largeUnit || 'satuan besar')}
                · isi ${product.packSize || 1}
              </small>
            </td>
            <td>${rupiah(product.price)}</td>
            <td>${rupiah(product.wholesalePrice)}</td>
            <td>${profitCell(product)}</td>
            <td>
              <span class="status ${Number(product.stock) <= Number(product.minStock) ? 'danger' : 'success'}">
                ${product.stock} / min ${product.minStock}
              </span>
            </td>
            <td class="nowrap">
              <button class="icon-button" data-product-label="${escapeHTML(product.id)}" title="Cetak label">🏷️</button>
              <button class="icon-button" data-product-edit="${escapeHTML(product.id)}">✏️</button>
              <button class="icon-button" data-product-delete="${escapeHTML(product.id)}">🗑️</button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="9">Belum ada data barang pada cabang ini.</td></tr>';

    const firstNumber = rows.length ? start + 1 : 0;
    const lastNumber = Math.min(start + MASTER_PAGE_SIZE, rows.length);

    document.querySelector('#masterCount').textContent =
      `Menampilkan ${firstNumber.toLocaleString('id-ID')}–${lastNumber.toLocaleString('id-ID')} dari ${rows.length.toLocaleString('id-ID')} barang`;

    document.querySelector('#masterPageLabel').textContent = `${currentPage} / ${totalPages}`;
    document.querySelector('#previousMasterPage').disabled = currentPage <= 1;
    document.querySelector('#nextMasterPage').disabled = currentPage >= totalPages;
  };

  const reloadProducts = async () => {
    invalidateProductCache();
    allProducts = await getCachedProducts({ force: true });
    applyBranch();
  };

  const initializeAllBranchStock = async () => {
    if (!canInitializeStock) {
      ctx.notify(
        'Fitur ini hanya untuk Owner di cabang AYA SEBLAK DAN ANGKRINGAN.',
        'error'
      );
      return;
    }

    if (!navigator.onLine) {
      ctx.notify(
        'Inisialisasi stok harus dilakukan saat perangkat online agar semua perangkat langsung memakai nilai yang sama.',
        'error'
      );
      return;
    }

    const latestMarker = await getOnce(
      INITIAL_STOCK_MARKER,
      { force: true }
    );

    if (latestMarker?.status === 'done') {
      stockInitialization = latestMarker;
      ctx.notify(
        'Stok awal 100.000 sudah pernah diaktifkan dan tidak akan disetel ulang.'
      );
      draw();
      return;
    }

    const eligibleProducts = products.filter(
      product => product.active !== false
    );

    if (!eligibleProducts.length) {
      ctx.notify(
        'Tidak ada barang aktif pada cabang ini.',
        'error'
      );
      return;
    }

    const approved = confirm(
      `Set semua stok cabang AYA SEBLAK DAN ANGKRINGAN menjadi ${INITIAL_STOCK_VALUE.toLocaleString('id-ID')}?\n\n`
      + `Jumlah barang: ${eligibleProducts.length.toLocaleString('id-ID')}\n`
      + `Mulai berlaku: saat tombol ini dijalankan pada ${INITIAL_STOCK_DATE}\n\n`
      + `Transaksi sebelum tombol dijalankan tidak dihitung ulang. `
      + `Setelah aktif, setiap penjualan tetap mengurangi stok.\n\n`
      + `Tindakan ini hanya boleh dijalankan satu kali.`
    );

    if (!approved) return;

    const typed = prompt(
      `Ketik SET 100000 untuk melanjutkan.\n\n`
      + `Semua stok cabang akan diubah menjadi 100.000.`
    );

    if (String(typed || '').trim().toUpperCase() !== 'SET 100000') {
      ctx.notify(
        'Konfirmasi tidak cocok. Inisialisasi dibatalkan.',
        'error'
      );
      return;
    }

    const button = document.querySelector('#initializeBranchStock');
    const originalText = button?.textContent || 'Aktifkan Stok 100.000';

    if (button) {
      button.disabled = true;
      button.textContent = 'Mengatur stok…';
    }

    const completedAt = Date.now();
    const databaseUpdates = {};

    for (const product of eligibleProducts) {
      const id = String(product.id);

      /*
       * Dua lokasi disamakan saat inisialisasi:
       * 1. stockByBranch = sumber stok transaksi aktif.
       * 2. products/.../stockByBranch = kompatibilitas data produk.
       */
      databaseUpdates[
        `stockByBranch/${INITIAL_STOCK_BRANCH_ID}/${id}`
      ] = INITIAL_STOCK_VALUE;

      databaseUpdates[
        `products/${id}/stockByBranch/${INITIAL_STOCK_BRANCH_ID}`
      ] = INITIAL_STOCK_VALUE;
    }

    databaseUpdates[INITIAL_STOCK_MARKER] = {
      status: 'done',
      branchId: INITIAL_STOCK_BRANCH_ID,
      branchName: ctx.branch.name,
      value: INITIAL_STOCK_VALUE,
      productCount: eligibleProducts.length,
      effectiveDate: INITIAL_STOCK_DATE,
      completedAt,
      completedBy: ctx.user.name || 'Owner',
      completedByUid: ctx.user.uid || ''
    };

    try {
      /*
       * Satu multi-location update Firebase:
       * semua barang dan marker berhasil bersama-sama atau gagal bersama-sama.
       */
      await update(
        ref(db, 'ayaGroupV2'),
        databaseUpdates
      );

      for (const product of eligibleProducts) {
        product.stock = INITIAL_STOCK_VALUE;
        product.stockByBranch = {
          ...(product.stockByBranch || {}),
          [INITIAL_STOCK_BRANCH_ID]: INITIAL_STOCK_VALUE
        };

        const original = allProducts.find(
          row => String(row.id) === String(product.id)
        );

        if (original) {
          original.stockByBranch = {
            ...(original.stockByBranch || {}),
            [INITIAL_STOCK_BRANCH_ID]: INITIAL_STOCK_VALUE
          };
        }
      }

      stockInitialization = databaseUpdates[
        INITIAL_STOCK_MARKER
      ];

      try {
        await audit('UPDATE', 'INITIALIZE_BRANCH_STOCK', {
          branchId: INITIAL_STOCK_BRANCH_ID,
          stockValue: INITIAL_STOCK_VALUE,
          productCount: eligibleProducts.length,
          effectiveDate: INITIAL_STOCK_DATE
        });
      } catch (auditError) {
        console.warn(
          'Audit inisialisasi stok gagal:',
          auditError
        );
      }

      await reloadProducts();
      draw();

      ctx.notify(
        `${eligibleProducts.length.toLocaleString('id-ID')} barang berhasil disetel ke stok ${INITIAL_STOCK_VALUE.toLocaleString('id-ID')}. Penjualan berikutnya akan mengurangi stok.`
      );
    } catch (error) {
      console.error(
        'Inisialisasi stok 100.000 gagal:',
        error
      );

      ctx.notify(
        error.message
          || 'Stok belum diubah. Periksa koneksi dan izin Firebase.',
        'error'
      );

      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  };

  const draw = () => {
    const categories = [
      'Semua',
      ...new Set(products.map(product => product.category || 'Lainnya'))
    ].sort((a, b) => (
      a === 'Semua' ? -1 : b === 'Semua' ? 1 : String(a).localeCompare(String(b), 'id')
    ));

    const summary = profitSummary(products);

    ctx.host.innerHTML = `
      <article class="card">
        <div class="toolbar">
          <div class="toolbar-group">
            <input id="masterSearch" placeholder="Cari barang, kode, barcode…">
            <select id="masterCategory">
              ${categories.map(category => `<option>${escapeHTML(category)}</option>`).join('')}
            </select>
          </div>
          <div class="toolbar-group">
            <button id="refreshProducts" class="secondary-button">↻ Muat Ulang</button>
            ${canInitializeStock ? `
              <button
                id="initializeBranchStock"
                class="${stockInitialization?.status === 'done' ? 'secondary-button' : 'danger-button'}"
                ${stockInitialization?.status === 'done' ? 'disabled' : ''}
              >
                ${stockInitialization?.status === 'done'
                  ? '✓ Stok 100.000 Sudah Aktif'
                  : 'Set Semua Stok 100.000'}
              </button>
            ` : ''}
            <button id="exportProducts" class="secondary-button">Export CSV</button>
            <label class="secondary-button" style="display:inline-flex;cursor:pointer">
              <span id="importProductsLabel">Import CSV</span>
              <input id="importProducts" type="file" accept=".csv" hidden>
            </label>
            <button id="addProduct" class="primary-button">+ Barang</button>
          </div>
        </div>

        <p class="muted" style="margin-top:0">
          Cabang aktif: <strong>${escapeHTML(ctx.branch.name)}</strong>.
          Daftar dibatasi 100 baris per halaman agar tetap ringan.
        </p>

        ${canInitializeStock ? `
          <p class="muted" style="margin-top:-6px">
            Stok awal cabang:
            <strong>
              ${stockInitialization?.status === 'done'
                ? `${INITIAL_STOCK_VALUE.toLocaleString('id-ID')} telah diaktifkan pada ${new Date(stockInitialization.completedAt).toLocaleString('id-ID')}`
                : `${INITIAL_STOCK_VALUE.toLocaleString('id-ID')} belum diaktifkan`}
            </strong>.
            Nilai hanya disetel satu kali; transaksi berikutnya tetap memotong stok.
          </p>
        ` : ''}

        <section class="master-profit-summary">
          <article class="master-profit-stat">
            <span>Total Barang</span>
            <strong>${summary.total.toLocaleString('id-ID')}</strong>
          </article>

          <article class="master-profit-stat profit-good">
            <span>Untung</span>
            <strong>${summary.profit.toLocaleString('id-ID')}</strong>
          </article>

          <article class="master-profit-stat profit-thin">
            <span>Profit Tipis</span>
            <strong>${summary.thin.toLocaleString('id-ID')}</strong>
          </article>

          <article class="master-profit-stat profit-loss">
            <span>Rugi / Impas</span>
            <strong>${(summary.loss + summary.even).toLocaleString('id-ID')}</strong>
          </article>

          <article class="master-profit-stat profit-missing">
            <span>HPP Kosong</span>
            <strong>${summary.missing.toLocaleString('id-ID')}</strong>
          </article>
        </section>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Barang</th>
                <th>Kategori</th>
                <th>Barcode</th>
                <th>HPP / Harga Beli</th>
                <th>Harga Ecer</th>
                <th>Grosir</th>
                <th>Profit & Margin</th>
                <th>Stok</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody id="productRows"></tbody>
          </table>
        </div>

        <div class="toolbar" style="margin-top:12px">
          <small id="masterCount" class="muted"></small>
          <div class="toolbar-group">
            <button id="previousMasterPage" class="secondary-button">← Sebelumnya</button>
            <span id="masterPageLabel" class="badge">1 / 1</span>
            <button id="nextMasterPage" class="secondary-button">Berikutnya →</button>
          </div>
        </div>
      </article>`;

    bind();
    renderRows();
  };

  const bind = () => {
    document.querySelector('#masterSearch').oninput = debounce(() => {
      currentPage = 1;
      renderRows();
    });

    document.querySelector('#masterCategory').onchange = () => {
      currentPage = 1;
      renderRows();
    };

    document.querySelector('#previousMasterPage').onclick = () => {
      currentPage--;
      renderRows();
    };

    document.querySelector('#nextMasterPage').onclick = () => {
      currentPage++;
      renderRows();
    };

    document.querySelector('#refreshProducts').onclick = async () => {
      ctx.notify('Memuat ulang data barang…');
      await reloadProducts();
      currentPage = 1;
      draw();
      ctx.notify('Data barang terbaru sudah dimuat');
    };

    const initializeButton =
      document.querySelector('#initializeBranchStock');

    if (initializeButton && !initializeButton.disabled) {
      initializeButton.onclick = initializeAllBranchStock;
    }

    document.querySelector('#addProduct').onclick = () => productForm(
      ctx,
      null,
      async product => {
        await saveProduct({
          ...product,
          branchIds: ctx.branch.id === 'all'
            ? product.branchIds || []
            : [ctx.branch.id],
          stockByBranch: ctx.branch.id === 'all'
            ? product.stockByBranch || {}
            : {
                ...(product.stockByBranch || {}),
                [ctx.branch.id]: number(product.stock)
              }
        });

        await reloadProducts();
        draw();
      }
    );

    document.querySelector('#productRows').onclick = async event => {
      const edit = event.target.closest('[data-product-edit]');
      const remove = event.target.closest('[data-product-delete]');
      const label = event.target.closest('[data-product-label]');

      if (label) {
        const product = productById.get(String(label.dataset.productLabel));
        if (product) printLabel(product);
        return;
      }

      if (edit) {
        const product = productById.get(String(edit.dataset.productEdit));
        if (!product) return;

        productForm(ctx, product, async updated => {
          const stockByBranch = {
            ...(product.stockByBranch || {}),
            ...(ctx.branch.id === 'all'
              ? {}
              : { [ctx.branch.id]: number(updated.stock) })
          };

          await saveProduct({
            ...updated,
            stockByBranch,
            branchIds: product.branchIds?.length
              ? product.branchIds
              : ctx.branch.id === 'all'
                ? []
                : [ctx.branch.id]
          });

          await audit('UPDATE', 'MASTER_PRODUCT', { id: updated.id });
          await reloadProducts();
          draw();
        });
        return;
      }

      if (
        remove
        && confirm('Nonaktifkan barang ini? Data lama tidak akan dihapus.')
      ) {
        const product = productById.get(String(remove.dataset.productDelete));
        if (!product) return;

        await saveProduct({ ...product, active: false });
        await reloadProducts();
        draw();
      }
    };

    document.querySelector('#exportProducts').onclick = () => {
      const headers = [
        'id',
        'name',
        'category',
        'barcode',
        'hpp',
        'price',
        'profitEcer',
        'marginEcerPersen',
        'wholesalePrice',
        'profitGrosir',
        'resellerPrice',
        'profitReseller',
        'profitStatus',
        'stock',
        'minStock',
        'unit'
      ];

      const csv = [
        headers.join(','),
        ...products.map(product => {
          const info = profitInfo(product);

          const row = {
            id: product.id,
            name: product.name,
            category: product.category,
            barcode: product.barcode,
            hpp: info.hpp,
            price: info.retailPrice,
            profitEcer: info.retailProfit,
            marginEcerPersen: info.retailMargin.toFixed(2),
            wholesalePrice: info.wholesalePrice,
            profitGrosir: info.wholesaleProfit,
            resellerPrice: info.resellerPrice,
            profitReseller: info.resellerProfit,
            profitStatus: info.status,
            stock: product.stock,
            minStock: product.minStock,
            unit: product.unit
          };

          return headers
            .map(header => csvCell(row[header]))
            .join(',');
        })
      ].join('\n');

      download(
        `master-hpp-profit-${ctx.branch.id}.csv`,
        csv,
        'text/csv'
      );
    };

    const importInput = document.querySelector('#importProducts');
    const importLabel = document.querySelector('#importProductsLabel');

    importInput.onchange = event => importCSV(
      event.target.files[0],
      async (rows, headers) => {
        if (!rows.length) {
          ctx.notify('File CSV tidak memiliki data.', 'error');
          return;
        }

        if (!navigator.onLine) {
          ctx.notify(
            'Import HPP harus dilakukan saat perangkat online.',
            'error'
          );
          return;
        }

        importInput.disabled = true;
        importLabel.textContent = 'Memeriksa CSV…';

        try {
          /*
           * Ambil data terbaru agar keputusan "HPP kosong" tidak memakai
           * cache lama dari sebelum pengguna mengedit barang.
           */
          invalidateProductCache();
          allProducts = await getCachedProducts({ force: true });
          applyBranch();

          const existingById = new Map(
            allProducts.map(product => [
              String(product.id),
              product
            ])
          );

          const byNameCategory = new Map();

          for (const product of allProducts) {
            const key = [
              String(product.name || '').trim().toLowerCase(),
              String(product.category || '').trim().toLowerCase()
            ].join('|');

            if (!byNameCategory.has(key)) {
              byNameCategory.set(key, []);
            }

            byNameCategory.get(key).push(product);
          }

          const hppMode = headers.includes('hpp');

          if (hppMode) {
            const planned = [];
            let protectedCount = 0;
            let zeroInFile = 0;
            let notFoundCount = 0;
            let ambiguousCount = 0;

            for (const row of rows) {
              const importedHpp = number(row.hpp);

              if (importedHpp <= 0) {
                zeroInFile++;
                continue;
              }

              let existing = row.id
                ? existingById.get(String(row.id))
                : null;

              /*
               * Cadangan untuk CSV lama yang ID-nya kosong:
               * nama + kategori hanya dipakai bila hasilnya tepat satu.
               * Import HPP tidak pernah membuat barang baru.
               */
              if (!existing) {
                const key = [
                  String(row.name || '').trim().toLowerCase(),
                  String(row.category || '').trim().toLowerCase()
                ].join('|');

                const matches = byNameCategory.get(key) || [];

                if (matches.length === 1) {
                  existing = matches[0];
                } else if (matches.length > 1) {
                  ambiguousCount++;
                  continue;
                }
              }

              if (!existing) {
                notFoundCount++;
                continue;
              }

              if (number(existing.cost) > 0) {
                protectedCount++;
                continue;
              }

              planned.push({
                existing,
                importedHpp
              });
            }

            if (!planned.length) {
              ctx.notify(
                `Tidak ada HPP kosong yang perlu diperbarui. `
                + `${protectedCount} HPP lama dilindungi; `
                + `${notFoundCount} ID tidak ditemukan.`,
                'error'
              );
              return;
            }

            const approved = confirm(
              `Import HPP Saja\n\n`
              + `HPP kosong yang akan diisi: ${planned.length}\n`
              + `HPP lama yang dilindungi: ${protectedCount}\n`
              + `HPP 0 di dalam CSV: ${zeroInFile}\n`
              + `ID tidak ditemukan: ${notFoundCount}\n`
              + `Nama ganda/ambigu: ${ambiguousCount}\n\n`
              + `Nama, harga jual, stok, kategori, komposisi, dan bundle `
              + `tidak akan diubah. Tidak ada barang baru yang dibuat.\n\n`
              + `Lanjutkan?`
            );

            if (!approved) return;

            let updatedCount = 0;

            for (let index = 0; index < planned.length; index++) {
              const { existing, importedHpp } = planned[index];

              importLabel.textContent =
                `Mengisi HPP ${index + 1}/${planned.length}…`;

              /*
               * Mode HPP hanya mengubah field cost/HPP. Harga, stok,
               * komposisi, bundle, dan data produk lain tidak disentuh.
               */
              await updateProductCost(
                existing.id,
                importedHpp
              );

              existing.cost = importedHpp;
              updatedCount++;
            }

            try {
              await audit('UPDATE', 'IMPORT_HPP_CSV', {
                branchId: ctx.branch.id,
                updatedCount,
                protectedCount,
                notFoundCount,
                ambiguousCount,
                mode: 'hpp-only'
              });
            } catch (auditError) {
              console.warn('Audit Import HPP gagal:', auditError);
            }

            await reloadProducts();
            draw();

            ctx.notify(
              `${updatedCount} HPP kosong berhasil diisi. `
              + `${protectedCount} HPP lama tidak diubah.`
            );

            return;
          }

          /*
           * Mode CSV umum:
           * data lama digabung dahulu agar ingredients, bundle,
           * stockByBranch, dan metadata lain tidak terhapus.
           */
          let importedCount = 0;
          let addedCount = 0;

          for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const id = String(row.id || uid('product'));
            const existing = existingById.get(id) || null;

            const {
              hpp,
              profitEcer,
              marginEcerPersen,
              profitGrosir,
              profitReseller,
              profitStatus,
              ...editableRow
            } = row;

            const importedCost = number(
              String(editableRow.cost ?? '').trim() !== ''
                ? editableRow.cost
                : hpp
            );

            const rowStockBlank =
              String(editableRow.stock ?? '').trim() === '';

            const currentBranchStock = existing
              ? stockForBranch(existing, ctx.branch.id)
              : 0;

            const nextStock = rowStockBlank
              ? (
                  existing
                    ? currentBranchStock
                    : ctx.branch.id === INITIAL_STOCK_BRANCH_ID
                      ? INITIAL_STOCK_VALUE
                      : 0
                )
              : number(editableRow.stock);

            const product = normalizeRow({
              ...(existing || {}),
              ...editableRow,
              id,
              cost: importedCost > 0
                ? importedCost
                : number(existing?.cost),
              branchIds: existing?.branchIds?.length
                ? existing.branchIds
                : ctx.branch.id === 'all'
                  ? []
                  : [ctx.branch.id],
              stockByBranch: ctx.branch.id === 'all'
                ? (existing?.stockByBranch || {})
                : {
                    ...(existing?.stockByBranch || {}),
                    [ctx.branch.id]: nextStock
                  },
              stock: nextStock
            });

            importLabel.textContent =
              `Mengimpor ${index + 1}/${rows.length}…`;

            await saveProduct(product);

            if (!existing) addedCount++;
            importedCount++;
          }

          await reloadProducts();
          draw();

          ctx.notify(
            `${importedCount} barang diproses; `
            + `${addedCount} barang baru ditambahkan.`
          );
        } catch (error) {
          console.error('Import CSV gagal:', error);
          ctx.notify(
            error.message || 'Import CSV gagal.',
            'error'
          );
        } finally {
          importInput.disabled = false;
          importInput.value = '';

          if (importLabel?.isConnected) {
            importLabel.textContent = 'Import CSV';
          }
        }
      }
    );
  };

  applyBranch();
  draw();
}

function normalizeRow(product) {
  return {
    ...product,
    id: product.id || uid('product'),
    name: product.name || 'Barang baru',
    category: product.category || 'Lainnya',
    barcode: product.barcode || '',
    cost: number(
      String(product.cost ?? '').trim() !== ''
        ? product.cost
        : String(product.hpp ?? '').trim() !== ''
          ? product.hpp
          : product.hargaBeli
    ),
    price: number(product.price),
    wholesalePrice: number(product.wholesalePrice || product.price),
    resellerPrice: number(product.resellerPrice || product.price),
    stock: number(product.stock),
    minStock: product.minStock === undefined || product.minStock === ''
      ? 5
      : number(product.minStock),
    unit: product.unit || 'pcs',
    active: product.active !== false,
    updatedAt: Date.now()
  };
}

function productForm(ctx, product, onSave) {
  product = product || {};

  const defaultStock = (
    !product.id
    && ctx.branch.id === INITIAL_STOCK_BRANCH_ID
  )
    ? INITIAL_STOCK_VALUE
    : number(product.stock);

  ctx.dialog(
    product.id ? 'Edit Barang' : 'Tambah Barang',
    `<form id="productForm" class="form-grid">
      <label>Nama Barang<input name="name" required value="${escapeHTML(product.name || '')}"></label>
      <label>Kategori<input name="category" required value="${escapeHTML(product.category || '')}"></label>
      <label>Kode / Barcode<input name="barcode" value="${escapeHTML(product.barcode || '')}"></label>
      <label>Satuan Kecil<input name="unit" value="${escapeHTML(product.unit || 'pcs')}"></label>
      <label>Harga Beli Satuan Besar<input id="productCartonCost" name="cartonCost" inputmode="numeric" value="${product.cartonCost || 0}"></label>
      <label>Isi per Satuan Besar (Jumlah Satuan Kecil)<input id="productPackSize" name="packSize" inputmode="numeric" value="${product.packSize || 1}"></label>
      <label>HPP / Harga Beli Satuan Kecil<input id="productUnitCost" name="cost" inputmode="numeric" value="${product.cost || 0}"></label>
      <label>Harga Jual Ecer<input id="productRetailPrice" name="price" inputmode="numeric" required value="${product.price || 0}"></label>
      <p id="productCostHint" class="muted full" style="margin:0">
        Harga beli satuan kecil dihitung otomatis dari harga satuan besar ÷ isi.
      </p>

      <section id="productProfitPreview" class="product-profit-preview full"></section>

      <label>Harga Grosir<input id="productWholesalePrice" name="wholesalePrice" inputmode="numeric" value="${product.wholesalePrice || product.price || 0}"></label>
      <label>Harga Reseller<input id="productResellerPrice" name="resellerPrice" inputmode="numeric" value="${product.resellerPrice || product.price || 0}"></label>
      <label>Stok<input name="stock" inputmode="numeric" value="${defaultStock}"></label>
      <label>Stok Minimum<input name="minStock" inputmode="numeric" value="${product.minStock ?? 5}"></label>
      <label class="full">
        Komposisi / Bahan (satu baris per bahan)
        <textarea name="ingredientsText">${escapeHTML(
          (product.ingredients || [])
            .map(item => typeof item === 'string'
              ? item
              : `${item.name || ''}|${item.qty || ''}|${item.cost || ''}`)
            .join('\n')
        )}</textarea>
      </label>
    </form>`,
    `<button type="button" id="cancelProduct" class="secondary-button">Batal</button>
     <button type="button" id="saveProduct" class="primary-button">Simpan</button>`
  );

  const cartonInput = document.querySelector('#productCartonCost');
  const packInput = document.querySelector('#productPackSize');
  const unitCostInput = document.querySelector('#productUnitCost');
  const retailInput = document.querySelector('#productRetailPrice');
  const wholesaleInput = document.querySelector('#productWholesalePrice');
  const resellerInput = document.querySelector('#productResellerPrice');
  const costHint = document.querySelector('#productCostHint');
  const profitPreview = document.querySelector('#productProfitPreview');
  const saveButton = document.querySelector('#saveProduct');
  const cancelButton = document.querySelector('#cancelProduct');

  let saving = false;

  const updateProfitPreview = () => {
    const info = profitInfo({
      cost: unitCostInput.value,
      price: retailInput.value,
      wholesalePrice: wholesaleInput.value,
      resellerPrice: resellerInput.value
    });

    if (info.hpp <= 0) {
      profitPreview.innerHTML = `
        <strong class="profit-missing">HPP belum diisi</strong>
        <span>Masukkan HPP agar profit dapat dihitung.</span>
      `;
      return;
    }

    profitPreview.innerHTML = `
      <div>
        <span>HPP</span>
        <strong>${rupiah(info.hpp)}</strong>
      </div>
      <div>
        <span>Profit Ecer</span>
        <strong class="${info.statusClass}">
          ${rupiah(info.retailProfit)}
        </strong>
      </div>
      <div>
        <span>Margin Ecer</span>
        <strong class="${info.statusClass}">
          ${info.retailMargin.toFixed(1)}%
        </strong>
      </div>
      <div>
        <span>Profit Grosir</span>
        <strong class="${info.wholesaleProfit < 0 ? 'profit-loss' : 'profit-good'}">
          ${rupiah(info.wholesaleProfit)}
        </strong>
      </div>
      <div>
        <span>Profit Reseller</span>
        <strong class="${info.resellerProfit < 0 ? 'profit-loss' : 'profit-good'}">
          ${rupiah(info.resellerProfit)}
        </strong>
      </div>
      <span class="master-profit-badge ${info.statusClass}">
        ${escapeHTML(info.status)}
      </span>
    `;
  };

  const recalculateCost = () => {
    const carton = number(cartonInput.value);
    const pack = Math.max(1, number(packInput.value));

    if (carton > 0) {
      const unitCost = Math.round(carton / pack);
      unitCostInput.value = unitCost;
      costHint.textContent =
        `Perhitungan: ${rupiah(carton)} ÷ ${pack} = ${rupiah(unitCost)} per satuan kecil.`;
    } else {
      costHint.textContent =
        'Isi harga beli satuan besar untuk menghitung harga beli satuan kecil secara otomatis.';
    }

    updateProfitPreview();
  };

  cartonInput.oninput = recalculateCost;
  packInput.oninput = recalculateCost;
  unitCostInput.oninput = updateProfitPreview;
  retailInput.oninput = updateProfitPreview;
  wholesaleInput.oninput = updateProfitPreview;
  resellerInput.oninput = updateProfitPreview;

  cancelButton.onclick = () => {
    if (!saving) document.querySelector('#appDialog').close();
  };

  if (number(cartonInput.value) > 0) {
    recalculateCost();
  } else {
    updateProfitPreview();
  }

  saveButton.onclick = async event => {
    event.preventDefault();

    const form = document.querySelector('#productForm');
    if (!form.reportValidity()) return;

    if (saving) return;

    const raw = formObject(form);
    const pack = Math.max(1, number(raw.packSize));
    const carton = number(raw.cartonCost);
    const derivedCost = carton > 0
      ? Math.round(carton / pack)
      : number(raw.cost);

    const ingredients = String(raw.ingredientsText || '')
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [name = '', qty = '', cost = ''] = line.split('|');
        return {
          name: name.trim(),
          qty: number(qty),
          cost: number(cost)
        };
      });

    const item = normalizeRow({
      ...product,
      ...raw,
      id: product.id || uid('product'),
      cost: derivedCost,
      cartonCost: carton,
      packSize: pack,
      ingredients
    });

    saving = true;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    saveButton.textContent = 'Menyimpan…';

    try {
      await onSave(item);
      document.querySelector('#appDialog').close();
      ctx.notify('Data barang berhasil disimpan');
    } catch (error) {
      console.error('Gagal menyimpan Master Barang:', error);
      ctx.notify(
        error.message
          || 'Data barang gagal disimpan. Periksa koneksi dan izin Firebase.',
        'error'
      );
    } finally {
      saving = false;

      if (saveButton.isConnected) {
        saveButton.disabled = false;
        saveButton.textContent = 'Simpan';
      }

      if (cancelButton.isConnected) {
        cancelButton.disabled = false;
      }
    }
  };
}

async function importCSV(file, done) {
  if (!file) return;

  const text = await file.text();
  const lines = text
    .split(/\r?\n/)
    .filter(line => line.trim());

  if (!lines.length) {
    await done([], []);
    return;
  }

  /*
   * Hapus UTF-8 BOM dari header pertama.
   * Tanpa ini "id" dapat terbaca sebagai "﻿id" dan gagal mencocokkan
   * produk yang sudah ada.
   */
  const headers = parseLine(lines.shift())
    .map((header, index) => String(header || '')
      .replace(index === 0 ? /^\uFEFF/ : /^$/, '')
      .trim()
    );

  const rows = lines.map(line => Object.fromEntries(
    parseLine(line).map((value, index) => [
      headers[index],
      value
    ])
  ));

  await done(rows, headers);
}

function parseLine(line) {
  const output = [];
  let current = '';
  let quote = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];

    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index++;
    } else if (character === '"') {
      quote = !quote;
    } else if (character === ',' && !quote) {
      output.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  output.push(current);
  return output;
}

const directoryConfig = {
  customers: { title: 'Data Pelanggan', nameLabel: 'Nama Pelanggan' },
  suppliers: { title: 'Data Supplier', nameLabel: 'Nama Supplier' },
  consignments: { title: 'Barang Titipan', nameLabel: 'Pemilik / Supplier' },
  inventory: { title: 'Inventaris Cabang', nameLabel: 'Nama Alat / Barang' }
};

export async function renderDirectory(ctx, type) {
  const config = directoryConfig[type];
  const path = type === 'inventory' ? `inventory/${ctx.branch.id}` : type;
  let rows = toArray(await getOnce(path)).filter(row => row.active !== false);

  const draw = () => {
    ctx.host.innerHTML = `
      <article class="card">
        <div class="toolbar">
          <div>
            <h2>${config.title}</h2>
            <p class="muted">Tersimpan dan dapat dilacak riwayatnya.</p>
          </div>
          <button id="addRow" class="primary-button">+ Tambah</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Kontak / Kode</th>
                <th>Alamat / Keterangan</th>
                <th>Nilai</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td><strong>${escapeHTML(row.name)}</strong></td>
                  <td>${escapeHTML(row.phone || row.code || '-')}</td>
                  <td>${escapeHTML(row.address || row.notes || '-')}</td>
                  <td>${rupiah(row.balance || row.total || row.purchasePrice || 0)}</td>
                  <td>
                    <button class="icon-button" data-edit="${row.id}">✏️</button>
                    <button class="icon-button" data-delete="${row.id}">🗑️</button>
                  </td>
                </tr>`).join('') || '<tr><td colspan="5">Belum ada data.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>`;

    document.querySelector('#addRow').onclick = () => directoryForm(
      ctx,
      config,
      null,
      async item => {
        const result = await pushData(path, item);
        rows.push({ ...item, id: result.key });
        draw();
      }
    );

    ctx.host.querySelector('tbody').onclick = async event => {
      const edit = event.target.closest('[data-edit]');
      const remove = event.target.closest('[data-delete]');

      if (edit) {
        const old = rows.find(row => row.id === edit.dataset.edit);
        directoryForm(ctx, config, old, async item => {
          await setData(`${path}/${old.id}`, item);
          rows = rows.map(row => row.id === old.id
            ? { ...item, id: old.id }
            : row);
          draw();
        });
      }

      if (
        remove
        && confirm('Nonaktifkan data ini? Data lama tidak akan dihapus.')
      ) {
        const old = rows.find(row => row.id === remove.dataset.delete);
        await setData(`${path}/${old.id}`, {
          ...old,
          active: false,
          updatedAt: Date.now()
        });
        rows = rows.filter(row => row.id !== remove.dataset.delete);
        draw();
      }
    };
  };

  draw();
}

function directoryForm(ctx, config, row, onSave) {
  row = row || {};

  ctx.dialog(
    row.id ? 'Edit Data' : 'Tambah Data',
    `<form id="directoryForm" class="form-grid">
      <label>${config.nameLabel}<input name="name" required value="${escapeHTML(row.name || '')}"></label>
      <label>Contact Person / Kode<input name="contact" value="${escapeHTML(row.contact || row.code || '')}"></label>
      <label>No. WA<input name="phone" value="${escapeHTML(row.phone || '')}"></label>
      <label>Alamat<input name="address" value="${escapeHTML(row.address || '')}"></label>
      <label>Saldo Hutang/Piutang/Nilai<input name="balance" inputmode="numeric" value="${row.balance || row.total || 0}"></label>
      <label>Tanggal<input name="date" type="date" value="${row.date || new Date().toISOString().slice(0, 10)}"></label>
      <label class="full">Keterangan<textarea name="notes">${escapeHTML(row.notes || '')}</textarea></label>
    </form>`,
    `<button value="cancel" class="secondary-button">Batal</button>
     <button id="saveDirectory" class="primary-button">Simpan</button>`
  );

  document.querySelector('#saveDirectory').onclick = async event => {
    event.preventDefault();

    const form = document.querySelector('#directoryForm');
    if (!form.reportValidity()) return;

    const raw = formObject(form);
    await onSave({
      ...row,
      ...raw,
      balance: number(raw.balance),
      updatedAt: Date.now()
    });

    document.querySelector('#appDialog').close();
    ctx.notify('Data tersimpan');
  };
}
