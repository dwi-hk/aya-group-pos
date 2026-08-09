import { db, auth } from './firebase-config.js';
import {
  ref,
  get,
  set,
  update,
  push,
  remove,
  onValue,
  off,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { fallbackProducts, fallbackBranches } from './menu-data.js';
import { toArray, uid, number } from './utils.js';
import {
  DEFAULT_BRANCH_ID,
  DEFAULT_BRANCH_NAME,
  parseLegacyDate,
  normalizeBranchRecord,
  dedupeBranches,
  branchIdFor,
  branchNameFor,
  normalizeLegacySale,
  normalizeLegacyOperation,
  normalizeCustomer,
  normalizeSupplier,
  normalizeConsignment,
  normalizeLegacyTransfer,
  normalizeLegacyDebt,
  normalizeCapital,
  normalizeSettings,
  objectEntries
} from './legacy-adapter.js';

export const ROOT = 'ayaGroupV2';

const LOCAL_KEY = 'aya.localdb.v2';
const QUEUE_KEY = 'aya.offline.queue';

const CACHE_TIME = {
  branches: 10 * 60 * 1000,
  products: 10 * 60 * 1000,
  sales: 90 * 1000,
  operations: 90 * 1000,
  purchases: 90 * 1000,
  debts: 90 * 1000,
  capital: 90 * 1000,
  stockTransfers: 90 * 1000,
  customers: 5 * 60 * 1000,
  suppliers: 5 * 60 * 1000,
  consignments: 5 * 60 * 1000,
  employees: 5 * 60 * 1000,
  attendance: 2 * 60 * 1000,
  users: 2 * 60 * 1000,
  businessSettings: 10 * 60 * 1000,
  default: 2 * 60 * 1000
};

const listeners = new Map();
const productCache = new Map();
const memoryCache = new Map();
const pendingReads = new Map();

let cacheRevision = 0;
let branchCache = [];
let connected = navigator.onLine;
let user = auth.currentUser;
let firebaseReadable = true;

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

function parts(path) {
  return String(path || '').split('/').filter(Boolean);
}

function getNested(object, path) {
  return parts(path).reduce((value, key) => value?.[key], object);
}

function setNested(object, path, value) {
  const keys = parts(path);
  if (!keys.length) return value;

  let current = object;
  keys.slice(0, -1).forEach(key => {
    current = current[key] ??= {};
  });

  if (value === null) delete current[keys.at(-1)];
  else current[keys.at(-1)] = value;

  return object;
}

function localPath(path) {
  return `${ROOT}/${path}`.replace(/\/$/, '');
}

function emitLocal(path) {
  const top = parts(path)[0] || '';
  const callback = listeners.get(top);

  if (callback) {
    callback(
      getNested(loadLocal(), localPath(top)) || null,
      { source: 'local' }
    );
  }
}

function cleanInternal(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([key]) => !key.startsWith('_'))
  );
}

function objectFromRows(rows) {
  return Object.fromEntries(
    rows.filter(Boolean).map(row => [row.id, row])
  );
}

function cacheTtl(path) {
  return CACHE_TIME[parts(path)[0]] || CACHE_TIME.default;
}

function cacheValue(key) {
  const entry = memoryCache.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.savedAt > entry.ttl) {
    memoryCache.delete(key);
    return undefined;
  }

  return entry.value;
}

function saveCache(key, value, ttl) {
  memoryCache.set(key, {
    value,
    ttl,
    savedAt: Date.now()
  });

  return value;
}

async function memoRead(key, ttl, loader, force = false) {
  if (!force) {
    const cached = cacheValue(key);
    if (cached !== undefined) return cached;

    if (pendingReads.has(key)) return pendingReads.get(key);
  }

  const revisionAtStart = cacheRevision;

  const request = Promise.resolve()
    .then(loader)
    .then(value => {
      if (revisionAtStart === cacheRevision) {
        saveCache(key, value, ttl);
      }
      return value;
    })
    .finally(() => {
      if (pendingReads.get(key) === request) {
        pendingReads.delete(key);
      }
    });

  pendingReads.set(key, request);
  return request;
}

function deleteCacheWhere(test) {
  for (const key of memoryCache.keys()) {
    if (test(key)) memoryCache.delete(key);
  }

  for (const key of pendingReads.keys()) {
    if (test(key)) pendingReads.delete(key);
  }
}

function normalizeScopes(scope) {
  if (Array.isArray(scope)) return scope.filter(Boolean);
  if (!scope || scope === 'all' || scope === '*') return ['all'];
  return [String(scope)];
}

export function invalidateDataCache(scope = 'all') {
  const scopes = normalizeScopes(scope);
  cacheRevision++;

  if (scopes.includes('all')) {
    memoryCache.clear();
    pendingReads.clear();
    productCache.clear();
    branchCache = [];
    return;
  }

  for (const item of scopes) {
    const base = parts(item)[0] || item;

    deleteCacheWhere(key => (
      key === base
      || key.startsWith(`once:${base}`)
      || key.includes(`|${base}|`)
    ));

    if (base === 'products' || base === 'stockByBranch') {
      memoryCache.delete('products');
      pendingReads.delete('products');

      /*
       * Map produk tetap dipertahankan sampai pemuatan ulang selesai.
       * Ini penting untuk pembelian/kulakan multi-item dan transaksi stok
       * yang masih berjalan.
       */
    }

    if (base === 'branches') {
      memoryCache.delete('branches');
      pendingReads.delete('branches');
      branchCache = [];
    }
  }
}

function affectedScopes(path, legacy = false) {
  const top = parts(path)[0] || '';

  if (legacy) {
    if (['master_menu', 'menu_tambahan', 'master_barang', 'menu', 'stok_cabang'].includes(top)) {
      return ['products', 'sales'];
    }

    if (top === 'transaksi') return ['sales', 'debts', 'capital'];
    if (top === 'pengeluaran') return ['operations'];
    if (top === 'cabang') return ['branches', 'products', 'sales', 'operations', 'debts', 'capital'];
    if (top === 'transfer') return ['branches', 'stockTransfers'];
    if (['pelanggan', 'master_pelanggan'].includes(top)) return ['customers'];
    if (['supplier', 'suppliers'].includes(top)) return ['suppliers'];
    if (top === 'barang_titipan') return ['consignments'];
    if (top === 'modal_tambahan') return ['capital'];
    return [];
  }

  if (top === 'branches') {
    return ['branches', 'products', 'sales', 'operations', 'debts', 'capital', 'stockTransfers'];
  }

  if (top === 'products') return ['products', 'sales'];
  if (top === 'stockByBranch') return ['products'];
  return top ? [top] : [];
}

function announceChange(path, legacy = false) {
  const scopes = affectedScopes(path, legacy);
  if (scopes.length) invalidateDataCache(scopes);

  window.dispatchEvent(new CustomEvent('aya-data-changed', {
    detail: {
      path,
      legacy,
      scopes
    }
  }));
}

onAuthStateChanged(auth, nextUser => {
  user = nextUser;

  window.dispatchEvent(new CustomEvent('aya-auth', {
    detail: nextUser
  }));

  if (nextUser && navigator.onLine) flushQueue();
});

onValue(ref(db, '.info/connected'), snapshot => {
  connected = snapshot.val() === true;

  window.dispatchEvent(new CustomEvent('aya-connection', {
    detail: {
      connected,
      firebaseReadable,
      user
    }
  }));

  if (connected) flushQueue();
});

window.addEventListener('online', () => {
  connected = true;
  flushQueue();
});

window.addEventListener('offline', () => {
  connected = false;

  window.dispatchEvent(new CustomEvent('aya-connection', {
    detail: { connected: false }
  }));
});

async function rawGet(path) {
  const snapshot = await get(ref(db, path));
  return snapshot.exists() ? snapshot.val() : null;
}

async function safeRawGet(path) {
  try {
    return await rawGet(path);
  } catch (error) {
    firebaseReadable = false;
    console.warn(`Firebase read ${path}:`, error.message);
    return null;
  }
}

function normalizeProduct(raw, id, branches = [], meta = {}) {
  const price = number(
    raw.price ?? raw.hargaJual ?? raw.harga ?? raw.sellPrice
  );

  const cost = number(
    raw.cost ?? raw.hargaBeli ?? raw.buyPrice
  );

  const minRaw = raw.minStock ?? raw.stokMinimum;
  const rawBranch = raw.branchId || raw.branch || raw.cabang;

  const branchIds = Array.isArray(raw.branchIds || raw.cabangIds)
    ? (raw.branchIds || raw.cabangIds).map(value => branchIdFor(value, branches))
    : rawBranch
      ? [branchIdFor(rawBranch, branches)]
      : [];

  const stockByBranch = {
    ...(raw.stockByBranch || {}),
    ...(meta.stockByBranch || {})
  };

  const branchStockValues = Object.values(stockByBranch)
    .map(value => number(
      typeof value === 'object'
        ? value.stock ?? value.qty
        : value
    ));

  const stock = (
    raw.stock !== undefined
    || raw.stok !== undefined
    || raw.qty !== undefined
  )
    ? number(raw.stock ?? raw.stok ?? raw.qty)
    : branchStockValues.length
      ? branchStockValues.reduce((total, value) => total + value, 0)
      : 0;

  return {
    ...cleanInternal(raw),
    id: String(raw.id || id),
    name: raw.name || raw.nama || raw.namaBarang || raw.menu || 'Tanpa nama',
    category: raw.category || raw.kategori || 'Lainnya',
    barcode: String(raw.barcode || raw.kodeBarcode || raw.code || ''),
    code: String(raw.code || raw.kode || ''),
    cost,
    price,
    cartonCost: number(raw.cartonCost ?? raw.hargaBeliTotal),
    packSize: Math.max(1, number(raw.packSize ?? raw.isi ?? 1)),
    wholesalePrice: number(raw.wholesalePrice ?? raw.hargaGrosir ?? price) || price,
    resellerPrice: number(raw.resellerPrice ?? raw.hargaReseller ?? price) || price,
    stock,
    stockByBranch,
    minStock: minRaw === undefined ? 0 : number(minRaw),
    unit: raw.unit || raw.satuan || 'pcs',
    active: raw.active !== false && raw.aktif !== false,
    ingredients: raw.ingredients || raw.komposisi || [],
    branchIds: [...new Set(branchIds.filter(Boolean))],
    description: raw.description || raw.keterangan || '',
    image: raw.image || raw.gambar || '',
    supplierId: raw.supplierId || '',
    source: meta.source || raw.source || 'database',
    _legacyPath: meta.legacyPath || raw._legacyPath || '',
    _legacyStockPath: meta.legacyStockPath || raw._legacyStockPath || '',
    _legacyBranchStockPaths: meta.legacyBranchStockPaths || raw._legacyBranchStockPaths || {}
  };
}

export async function getBranches({ force = false } = {}) {
  return memoRead(
    'branches',
    CACHE_TIME.branches,
    async () => {
      const [legacy, newRows, legacyTransfers] = await Promise.all([
        safeRawGet('cabang'),
        safeRawGet(`${ROOT}/branches`),
        safeRawGet('transfer')
      ]);

      const byId = new Map();

      objectEntries(legacy).forEach(([id, row]) => {
        byId.set(
          String(row?.id || id),
          normalizeBranchRecord(
            { ...row, source: 'legacy:cabang' },
            id
          )
        );
      });

      toArray(newRows).forEach(row => {
        const id = String(row.id);
        const previous = byId.get(id) || {};

        byId.set(
          id,
          normalizeBranchRecord(
            { ...previous, ...row, source: 'ayaGroupV2' },
            id
          )
        );
      });

      const records = [...byId.values()];
      const knownIds = new Set(
        records.flatMap(branch => [
          branch.id,
          ...(branch.aliases || [])
        ])
      );

      objectEntries(legacyTransfers)
        .flatMap(([, row]) => [
          row?.fromId || row?.dariCabang,
          row?.toId || row?.keCabang
        ])
        .filter(Boolean)
        .forEach(value => {
          const id = String(value);
          if (knownIds.has(id)) return;

          records.push(normalizeBranchRecord({
            id,
            nama: `Cabang lama (${id})`,
            aktif: false,
            source: 'legacy:transfer-reference'
          }, id));

          knownIds.add(id);
        });

      if (!records.length) {
        records.push(...fallbackBranches.map(row =>
          normalizeBranchRecord(
            { ...row, source: 'fallback' },
            row.id
          )
        ));
      }

      branchCache = dedupeBranches(records);
      return branchCache;
    },
    force
  );
}

function branchStockMap(raw, branches) {
  const result = {};

  for (const [branchKey, rows] of objectEntries(raw)) {
    const branchId = branchIdFor(branchKey, branches);

    for (const [productId, value] of objectEntries(rows)) {
      const qty = number(value?.stock ?? value?.qty ?? value);

      result[productId] ??= {};
      result[productId][branchId] = qty;
    }
  }

  return result;
}

export async function getProducts({ force = false } = {}) {
  return memoRead(
    'products',
    CACHE_TIME.products,
    async () => {
      const branches = branchCache.length
        ? branchCache
        : await getBranches();

      const [
        masterMenu,
        menuTambahan,
        masterBarang,
        legacyMenu,
        newProducts,
        legacyBranchStock,
        newBranchStock
      ] = await Promise.all([
        safeRawGet('master_menu'),
        safeRawGet('menu_tambahan'),
        safeRawGet('master_barang'),
        safeRawGet('menu'),
        safeRawGet(`${ROOT}/products`),
        safeRawGet('stok_cabang'),
        safeRawGet(`${ROOT}/stockByBranch`)
      ]);

      const rawMap = new Map();

      const add = (rows, path, source) => {
        objectEntries(rows).forEach(([id, row]) => {
          if (!row || typeof row !== 'object') return;

          const previous = rawMap.get(String(id)) || {
            raw: {},
            meta: {}
          };

          const legacyPath = source.startsWith('legacy')
            ? `${path}/${id}`
            : previous.meta.legacyPath;

          const hasStock = (
            Object.prototype.hasOwnProperty.call(row, 'stok')
            || Object.prototype.hasOwnProperty.call(row, 'stock')
          );

          rawMap.set(String(id), {
            raw: {
              ...previous.raw,
              ...row,
              id: row.id ?? id
            },
            meta: {
              ...previous.meta,
              source,
              legacyPath: legacyPath || previous.meta.legacyPath,
              legacyStockPath: (
                hasStock && source.startsWith('legacy')
                  ? `${path}/${id}/${Object.prototype.hasOwnProperty.call(row, 'stok') ? 'stok' : 'stock'}`
                  : previous.meta.legacyStockPath
              )
            }
          });
        });
      };

      add(masterMenu, 'master_menu', 'legacy:master_menu');
      add(menuTambahan, 'menu_tambahan', 'legacy:menu_tambahan');
      add(masterBarang, 'master_barang', 'legacy:master_barang');

      objectEntries(legacyMenu).forEach(([id, row]) => {
        const previous = rawMap.get(String(id)) || {
          raw: { id },
          meta: { source: 'legacy:menu' }
        };

        rawMap.set(String(id), {
          raw: {
            ...previous.raw,
            stok: row?.stok ?? previous.raw.stok
          },
          meta: {
            ...previous.meta,
            legacyStockPath: `menu/${id}/stok`
          }
        });
      });

      add(newProducts, `${ROOT}/products`, 'ayaGroupV2');

      const legacyStocks = branchStockMap(legacyBranchStock, branches);
      const v2Stocks = branchStockMap(newBranchStock, branches);
      const legacyBranchPaths = {};

      for (const [branchKey, rows] of objectEntries(legacyBranchStock)) {
        const branchId = branchIdFor(branchKey, branches);

        for (const [productId, value] of objectEntries(rows)) {
          const field = (
            value
            && typeof value === 'object'
            && Object.prototype.hasOwnProperty.call(value, 'qty')
          ) ? 'qty' : 'stock';

          legacyBranchPaths[productId] ??= {};
          legacyBranchPaths[productId][branchId] =
            `stok_cabang/${branchKey}/${productId}/${field}`;
        }
      }

      const found = [];
      productCache.clear();

      for (const [id, { raw, meta }] of rawMap) {
        const stockByBranch = {
          /*
           * Urutan prioritas stok:
           * legacy < stok tertanam produk < stok cabang aktif V2.
           * Dengan demikian hasil transaksi pada stockByBranch tidak
           * tertimpa angka lama ketika aplikasi dimuat ulang.
           */
          ...(legacyStocks[id] || {}),
          ...(raw.stockByBranch || {}),
          ...(v2Stocks[id] || {})
        };

        const product = normalizeProduct(
          raw,
          id,
          branches,
          {
            ...meta,
            stockByBranch,
            legacyBranchStockPaths: legacyBranchPaths[id] || {}
          }
        );

        found.push(product);
        productCache.set(product.id, product);
      }

      if (!found.length) {
        fallbackProducts.forEach(row => {
          const product = normalizeProduct(
            row,
            row.id,
            branches,
            { source: 'fallback' }
          );

          found.push(product);
          productCache.set(product.id, product);
        });
      }

      return found.sort((a, b) =>
        String(a.name).localeCompare(String(b.name), 'id')
      );
    },
    force
  );
}

export function stockForBranch(product, branchId) {
  if (!product) return 0;

  if (!branchId || branchId === 'all') {
    const values = Object.values(product.stockByBranch || {})
      .map(value => number(
        typeof value === 'object'
          ? value.stock ?? value.qty
          : value
      ));

    return values.length
      ? values.reduce((total, value) => total + value, 0)
      : number(product.stock);
  }

  const value = product.stockByBranch?.[branchId];

  return value === undefined
    ? number(product.stock)
    : number(
        typeof value === 'object'
          ? value.stock ?? value.qty
          : value
      );
}

function normalizeNewSale(raw, id, branchKey, branches) {
  const branchId = branchIdFor(
    raw.branchId || branchKey || raw.branchName,
    branches
  );

  return {
    ...raw,
    id: String(raw.id || id),
    invoice: String(raw.invoice || raw.id || id),
    branchId,
    branchName: raw.branchName || branchNameFor(branchId, branches),
    _storageBranchKey: String(branchKey || branchId),
    _storageId: String(id),
    cashierName: raw.cashierName || raw.kasir || 'Kasir',
    paymentMethod: String(
      raw.paymentMethod || raw.metodePembayaran || 'TUNAI'
    ).toUpperCase(),
    customerName: raw.customerName || raw.pelangganNama || '',
    createdAt: parseLegacyDate(raw) || Date.now(),
    items: (raw.items || []).map((item, index) => ({
      ...item,
      id: String(item.id || item.productId || index),
      name: item.name || item.nama || 'Item',
      qty: number(item.qty || 1),
      price: number(item.price ?? item.harga),
      cost: number(item.cost ?? item.hargaBeli),
      unit: item.unit || item.satuan || 'pcs',
      category: item.category || item.kategori || 'Lainnya'
    })),
    source: raw.source || 'ayaGroupV2'
  };
}

function enrichSaleCosts(sale) {
  return {
    ...sale,
    items: (sale.items || []).map(item => {
      const product = productCache.get(String(item.id));

      return {
        ...item,
        cost: number(item.cost) || number(product?.cost),
        unit: item.unit || product?.unit || 'pcs',
        category: item.category || product?.category || 'Lainnya'
      };
    })
  };
}

function putNested(target, branchId, row) {
  target[branchId] ??= {};
  target[branchId][row.id] = row;
}

function saleIdentity(row) {
  const invoice = String(
    row?.invoice
    || row?.clientTransactionId
    || ''
  ).trim().toUpperCase();

  /*
   * Nomor nota dibuat unik untuk seluruh cabang.
   * Menggunakan invoice saja mencegah salinan legacy dan V2 tampil dua kali
   * ketika alias/ID cabangnya berbeda.
   */
  if (invoice) return `invoice:${invoice}`;

  return `row:${row?.branchId || ''}|${row?.id || ''}`;
}

async function compositeSales() {
  const branches = branchCache.length
    ? branchCache
    : await getBranches();

  /*
   * Perbaikan utama v2.9:
   * laporan penjualan tidak lagi memanggil getProducts().
   * HPP transaksi memakai cost yang sudah tersimpan pada item.
   * Master produk di memori hanya menjadi cadangan bila sudah pernah dimuat.
   */
  const [legacy, newRows] = await Promise.all([
    safeRawGet('transaksi'),
    safeRawGet(`${ROOT}/sales`)
  ]);

  const byIdentity = new Map();

  objectEntries(legacy).forEach(([id, row]) => {
    const normalized = normalizeLegacySale(row, id, branches);
    if (!normalized) return;

    const enriched = enrichSaleCosts(normalized);

    byIdentity.set(
      saleIdentity(enriched),
      enriched
    );
  });

  for (const [branchKey, rows] of objectEntries(newRows)) {
    for (const [id, row] of objectEntries(rows)) {
      const normalized = enrichSaleCosts(
        normalizeNewSale(row, id, branchKey, branches)
      );

      /*
       * Data V2 diproses setelah legacy sehingga, bila nomor notanya sama,
       * versi V2 menjadi sumber utama.
       */
      byIdentity.set(
        saleIdentity(normalized),
        normalized
      );
    }
  }

  const result = {};

  for (const row of byIdentity.values()) {
    putNested(result, row.branchId, row);
  }

  return result;
}

async function compositeOperations() {
  const branches = branchCache.length
    ? branchCache
    : await getBranches();

  const [legacy, newRows] = await Promise.all([
    safeRawGet('pengeluaran'),
    safeRawGet(`${ROOT}/operations`)
  ]);

  const result = {};

  objectEntries(legacy).forEach(([id, row]) => {
    const normalized = normalizeLegacyOperation(row, id, branches);
    putNested(result, normalized.branchId, normalized);
  });

  for (const [branchKey, rows] of objectEntries(newRows)) {
    for (const [id, row] of objectEntries(rows)) {
      const branchId = branchIdFor(
        row.branchId || branchKey,
        branches
      );

      putNested(result, branchId, {
        ...row,
        id: String(row.id || id),
        branchId,
        branchName: row.branchName || branchNameFor(branchId, branches),
        createdAt: parseLegacyDate(row) || Date.now(),
        source: row.source || 'ayaGroupV2'
      });
    }
  }

  return result;
}

async function compositeDirectory(type) {
  const newRows = await safeRawGet(`${ROOT}/${type}`);
  const result = {};

  if (type === 'customers') {
    const [first, second] = await Promise.all([
      safeRawGet('pelanggan'),
      safeRawGet('master_pelanggan')
    ]);

    objectEntries(first).forEach(([id, row]) => {
      result[id] = normalizeCustomer(
        { ...row, _legacyPath: `pelanggan/${id}` },
        id,
        'legacy:pelanggan'
      );
    });

    objectEntries(second).forEach(([id, row]) => {
      result[id] = normalizeCustomer(
        { ...row, _legacyPath: `master_pelanggan/${id}` },
        id,
        'legacy:master_pelanggan'
      );
    });
  }

  if (type === 'suppliers') {
    const [first, second] = await Promise.all([
      safeRawGet('supplier'),
      safeRawGet('suppliers')
    ]);

    objectEntries(first).forEach(([id, row]) => {
      result[id] = normalizeSupplier(
        { ...row, _legacyPath: `supplier/${id}` },
        id,
        'legacy:supplier'
      );
    });

    objectEntries(second).forEach(([id, row]) => {
      result[id] = normalizeSupplier(
        { ...row, _legacyPath: `suppliers/${id}` },
        id,
        'legacy:suppliers'
      );
    });
  }

  if (type === 'consignments') {
    const rows = await safeRawGet('barang_titipan');

    objectEntries(rows).forEach(([id, row]) => {
      result[id] = normalizeConsignment(
        { ...row, _legacyPath: `barang_titipan/${id}` },
        id
      );
    });
  }

  toArray(newRows).forEach(row => {
    result[row.id] = {
      ...result[row.id],
      ...row,
      id: String(row.id),
      source: 'ayaGroupV2'
    };
  });

  return result;
}

async function compositeTransfers() {
  const branches = branchCache.length
    ? branchCache
    : await getBranches();

  const [legacy, newRows] = await Promise.all([
    safeRawGet('transfer'),
    safeRawGet(`${ROOT}/stockTransfers`)
  ]);

  const result = {};

  objectEntries(legacy).forEach(([id, row]) => {
    result[id] = normalizeLegacyTransfer(row, id, branches);
  });

  toArray(newRows).forEach(row => {
    result[row.id] = {
      ...result[row.id],
      ...row,
      id: String(row.id),
      source: 'ayaGroupV2'
    };
  });

  return result;
}

async function compositeDebts() {
  const branches = branchCache.length
    ? branchCache
    : await getBranches();

  const [legacySales, newRows] = await Promise.all([
    safeRawGet('transaksi'),
    safeRawGet(`${ROOT}/debts`)
  ]);

  const byId = new Map();
  const byIdentity = new Map();

  const identity = row =>
    `${row.type || 'customer'}|${row.branchId || ''}|${row.invoice || row.id || ''}`;

  objectEntries(legacySales).forEach(([id, row]) => {
    const debt = normalizeLegacyDebt(row, id, branches);
    if (!debt) return;

    byId.set(debt.id, debt);
    byIdentity.set(identity(debt), debt.id);
  });

  toArray(newRows).forEach(row => {
    const id = String(row.id);
    const sameId = byId.get(id);
    const matchedId = byIdentity.get(identity(row));
    const previous = sameId || byId.get(matchedId) || {};

    const merged = {
      ...previous,
      ...row,
      id,
      source: 'ayaGroupV2'
    };

    if (matchedId && matchedId !== id) byId.delete(matchedId);

    byId.set(id, merged);
    byIdentity.set(identity(merged), id);
  });

  return Object.fromEntries(byId);
}

async function compositeCapital() {
  const branches = branchCache.length
    ? branchCache
    : await getBranches();

  const [legacyCapital, legacySales, newRows] = await Promise.all([
    safeRawGet('modal_tambahan'),
    safeRawGet('transaksi'),
    safeRawGet(`${ROOT}/capital`)
  ]);

  const result = {};

  objectEntries(legacyCapital).forEach(([id, row]) => {
    result[id] = normalizeCapital(row, id, branches);
  });

  objectEntries(legacySales).forEach(([id, row]) => {
    if (String(row.metodePembayaran || '').toUpperCase() === 'MODAL_MASUK') {
      result[id] = normalizeCapital({
        ...row,
        nominal: row.total,
        source: 'legacy:transaksi-modal'
      }, id, branches);
    }
  });

  toArray(newRows).forEach(row => {
    result[row.id] = {
      ...result[row.id],
      ...row,
      id: String(row.id),
      source: 'ayaGroupV2'
    };
  });

  return result;
}

async function legacyStats() {
  const keys = [
    'master_menu',
    'menu_tambahan',
    'master_barang',
    'transaksi',
    'pengeluaran',
    'cabang',
    'pelanggan',
    'master_pelanggan',
    'supplier',
    'suppliers',
    'barang_titipan',
    'transfer',
    'modal_tambahan',
    'pembayaran'
  ];

  const values = await Promise.all(keys.map(safeRawGet));

  const counts = Object.fromEntries(
    keys.map((key, index) => [
      key,
      values[index] && typeof values[index] === 'object'
        ? Object.keys(values[index]).length
        : 0
    ])
  );

  const transactions = values[keys.indexOf('transaksi')] || {};

  counts.transaksiTanpaCabang = Object.values(transactions)
    .filter(row => !row?.cabang && !row?.branchId)
    .length;

  counts.transaksiModal = Object.values(transactions)
    .filter(row =>
      String(row?.metodePembayaran || '').toUpperCase() === 'MODAL_MASUK'
    )
    .length;

  return counts;
}

async function compositeRead(path, force = false) {
  const [base, ...rest] = parts(path);
  const sub = rest.join('/');

  if (base === 'sales') {
    const value = await compositeSales();
    return {
      handled: true,
      value: sub ? getNested(value, sub) : value
    };
  }

  if (base === 'operations') {
    const value = await compositeOperations();
    return {
      handled: true,
      value: sub ? getNested(value, sub) : value
    };
  }

  if (
    ['customers', 'suppliers', 'consignments'].includes(base)
    && !sub
  ) {
    return {
      handled: true,
      value: await compositeDirectory(base)
    };
  }

  if (base === 'stockTransfers' && !sub) {
    return {
      handled: true,
      value: await compositeTransfers()
    };
  }

  if (base === 'debts' && !sub) {
    return {
      handled: true,
      value: await compositeDebts()
    };
  }

  if (base === 'capital' && !sub) {
    return {
      handled: true,
      value: await compositeCapital()
    };
  }

  if (base === 'businessSettings' && !sub) {
    const [legacy, newSettings] = await Promise.all([
      safeRawGet('pengaturan'),
      safeRawGet(`${ROOT}/settings/receipt`)
    ]);

    return {
      handled: true,
      value: {
        ...normalizeSettings(legacy || {}),
        ...(newSettings || {})
      }
    };
  }

  if (base === 'legacyStats' && !sub) {
    return {
      handled: true,
      value: await legacyStats()
    };
  }

  if (base === 'branches' && !sub) {
    return {
      handled: true,
      value: objectFromRows(await getBranches({ force }))
    };
  }

  if (base === 'products' && !sub) {
    return {
      handled: true,
      value: objectFromRows(await getProducts({ force }))
    };
  }

  return {
    handled: false,
    value: null
  };
}

export async function getOnce(
  path,
  {
    legacy = [],
    force = false,
    maxAge
  } = {}
) {
  const key = `once:${path}|legacy:${legacy.join(',')}`;
  const ttl = Number.isFinite(maxAge) ? maxAge : cacheTtl(path);

  return memoRead(
    key,
    ttl,
    async () => {
      try {
        const composite = await compositeRead(path, force);

        if (composite.handled) {
          firebaseReadable = true;
          return composite.value ?? null;
        }

        const primary = await rawGet(
          `${ROOT}/${path}`.replace(/\/$/, '')
        );

        firebaseReadable = true;

        if (primary !== null) return primary;

        for (const legacyPath of legacy) {
          const value = await rawGet(legacyPath);
          if (value !== null) return value;
        }
      } catch (error) {
        firebaseReadable = false;
        console.warn('Firebase read fallback:', error.message);
      }

      return getNested(loadLocal(), localPath(path)) ?? null;
    },
    force
  );
}

export async function warmDataCache(paths = []) {
  for (const path of paths) {
    try {
      await getOnce(path);
    } catch (error) {
      console.warn(`Warm cache ${path}:`, error.message);
    }
  }
}

export async function refreshDataCache(paths = []) {
  const list = Array.isArray(paths) ? paths : [paths];

  for (const path of list.filter(Boolean)) {
    await getOnce(path, { force: true });
  }
}

export function dataCacheInfo() {
  return [...memoryCache.entries()].map(([key, entry]) => ({
    key,
    age: Date.now() - entry.savedAt,
    ttl: entry.ttl
  }));
}

export function subscribe(path, callback, { fallback = null } = {}) {
  listeners.set(path, callback);

  const databaseRef = ref(db, `${ROOT}/${path}`);

  const unsubscribe = onValue(
    databaseRef,
    snapshot => {
      firebaseReadable = true;
      invalidateDataCache(parts(path)[0]);

      callback(
        snapshot.exists() ? snapshot.val() : fallback,
        { source: 'firebase' }
      );
    },
    error => {
      firebaseReadable = false;
      console.warn(error.message);

      callback(
        getNested(loadLocal(), localPath(path)) ?? fallback,
        {
          source: 'local',
          error
        }
      );
    }
  );

  return () => {
    listeners.delete(path);
    off(databaseRef);
    unsubscribe?.();
  };
}

function queue(operation) {
  const rows = JSON.parse(
    localStorage.getItem(QUEUE_KEY) || '[]'
  );

  rows.push({
    ...operation,
    id: operation.id || uid('queue'),
    queuedAt: Date.now()
  });

  localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));

  window.dispatchEvent(new CustomEvent('aya-queue', {
    detail: rows.length
  }));
}

async function remoteWrite(operation) {
  if (operation.type === 'legacySet') {
    return set(
      ref(db, operation.absolutePath),
      operation.value
    );
  }

  if (operation.type === 'legacyUpdate') {
    return update(
      ref(db, operation.absolutePath),
      operation.value
    );
  }

  const target = ref(db, `${ROOT}/${operation.path}`);

  if (operation.type === 'set') return set(target, operation.value);
  if (operation.type === 'update') return update(target, operation.value);
  if (operation.type === 'remove') return remove(target);

  if (operation.type === 'push') {
    return set(
      ref(db, `${ROOT}/${operation.path}/${operation.key}`),
      operation.value
    );
  }
}

async function write(operation, { silent = false } = {}) {
  const local = loadLocal();

  const targetPath = localPath(
    operation.type === 'push'
      ? `${operation.path}/${operation.key}`
      : operation.path
  );

  if (operation.type === 'update') {
    const existing = getNested(local, targetPath) || {};

    setNested(local, targetPath, {
      ...existing,
      ...operation.value
    });
  } else {
    setNested(
      local,
      targetPath,
      operation.type === 'remove'
        ? null
        : operation.value
    );
  }

  saveLocal(local);
  emitLocal(operation.path);
  announceChange(operation.path);

  if (!auth.currentUser) {
    return {
      ok: true,
      source: 'local-demo',
      demo: true,
      key: operation.key
    };
  }

  try {
    if (!navigator.onLine) throw new Error('offline');

    await remoteWrite(operation);

    return {
      ok: true,
      source: 'firebase',
      key: operation.key
    };
  } catch (error) {
    queue(operation);

    if (!silent) {
      console.warn(
        'Disimpan lokal dan masuk antrean sinkronisasi:',
        error.message
      );
    }

    return {
      ok: true,
      source: 'local',
      queued: true,
      key: operation.key,
      error
    };
  }
}

export const setData = (path, value, options) =>
  write({ type: 'set', path, value }, options);

export const updateData = (path, value, options) =>
  write({ type: 'update', path, value }, options);

export const removeData = (path, options) =>
  write({ type: 'remove', path, value: null }, options);

export function pushData(path, value, options = {}) {
  const key = (
    push(ref(db, `${ROOT}/${path}`)).key
    || uid('row')
  );

  return write({
    type: 'push',
    path,
    key,
    value: {
      ...value,
      createdAt: value.createdAt || Date.now(),
      updatedAt: Date.now()
    }
  }, options);
}

async function legacyWrite(
  type,
  absolutePath,
  value,
  { silent = true } = {}
) {
  announceChange(absolutePath, true);

  if (!auth.currentUser) {
    return {
      ok: false,
      skipped: true,
      demo: true
    };
  }

  try {
    if (!navigator.onLine) throw new Error('offline');

    await remoteWrite({
      type,
      absolutePath,
      value
    });

    return { ok: true };
  } catch (error) {
    queue({
      type,
      absolutePath,
      value
    });

    if (!silent) {
      console.warn(
        `Legacy write ${absolutePath}:`,
        error.message
      );
    }

    return {
      ok: false,
      queued: true,
      error
    };
  }
}

export async function saveProduct(product) {
  const clean = cleanInternal(product);

  const result = await setData(
    `products/${product.id}`,
    clean
  );

  const legacyPath = (
    product._legacyPath
    || (
      /^[0-9]+$/.test(String(product.id))
        ? `menu_tambahan/${product.id}`
        : `master_barang/${product.id}`
    )
  );

  const payload = {
    id: product.id,
    nama: product.name,
    kategori: product.category,
    barcode: product.barcode || '',
    kode: product.code || '',
    hargaBeli: number(product.cost),
    hargaBeliTotal: number(product.cartonCost),
    hargaJual: number(product.price),
    harga: number(product.price),
    isi: number(product.packSize) || 1,
    satuan: product.unit || 'pcs',
    stok: number(product.stock),
    stokMinimum: number(product.minStock),
    keterangan: product.description || '',
    aktif: product.active !== false,
    updatedAt: new Date().toISOString()
  };

  await legacyWrite(
    'legacyUpdate',
    legacyPath,
    payload
  );

  productCache.set(String(product.id), product);
  return result;
}

export async function updateProductCost(productId, cost) {
  const id = String(productId);
  const value = number(cost);
  const product = productCache.get(id);

  await updateData(`products/${id}`, {
    cost: value,
    updatedAt: Date.now()
  });

  if (product) {
    product.cost = value;
    product.updatedAt = Date.now();
    productCache.set(id, product);
  }

  const legacyPath = (
    product?._legacyPath
    || (
      /^[0-9]+$/.test(id)
        ? `menu_tambahan/${id}`
        : `master_barang/${id}`
    )
  );

  await legacyWrite('legacyUpdate', legacyPath, {
    hargaBeli: value,
    updatedAt: new Date().toISOString()
  });
}

export async function updateProductPurchaseInfo(
  productId,
  {
    cartonCost,
    packSize,
    cost,
    price,
    largeUnit = 'karton'
  } = {}
) {
  const id = String(productId);
  const product = productCache.get(id);
  const safePack = Math.max(1, number(packSize) || 1);
  const safeCarton = number(cartonCost);
  const safeCost = (
    number(cost)
    || (
      safeCarton > 0
        ? Math.round(safeCarton / safePack)
        : 0
    )
  );

  const safePrice = number(price) || number(product?.price);

  const patch = {
    cartonCost: safeCarton,
    packSize: safePack,
    cost: safeCost,
    price: safePrice,
    largeUnit: String(largeUnit || 'karton'),
    updatedAt: Date.now()
  };

  await updateData(`products/${id}`, patch);

  if (product) {
    Object.assign(product, patch);
    productCache.set(id, product);
  }

  const legacyPath = (
    product?._legacyPath
    || (
      /^[0-9]+$/.test(id)
        ? `menu_tambahan/${id}`
        : `master_barang/${id}`
    )
  );

  await legacyWrite('legacyUpdate', legacyPath, {
    hargaBeli: safeCost,
    hargaBeliTotal: safeCarton,
    isi: safePack,
    hargaJual: safePrice,
    harga: safePrice,
    satuanBesar: patch.largeUnit,
    updatedAt: new Date().toISOString()
  });

  return patch;
}

export async function mirrorLegacySale(sale) {
  const date = new Date(sale.createdAt || Date.now());

  const orderMap = {
    'Makan di tempat': 'DINE_IN',
    Dibungkus: 'TAKE_AWAY',
    Delivery: 'DELIVERY'
  };

  const payload = {
    id: sale.invoice,
    items: (sale.items || []).map(item => ({
      id: item.id,
      nama: item.name,
      qty: number(item.qty),
      harga: number(item.price),
      hargaBeli: number(item.cost),
      kategori: item.category,
      satuan: item.unit
    })),
    total: number(sale.total),
    bayar: number(sale.paid),
    kembalian: number(sale.change),
    metodePembayaran: sale.paymentMethod,
    ongkir: number(sale.shipping),
    qtyStyrofoam: number(sale.styrofoamQty),
    styrofoam: number(sale.styrofoamTotal),
    tipePesanan: orderMap[sale.orderType] || sale.orderType,
    cabang: sale.branchName,
    kasir: sale.cashierName,
    pelangganNama: sale.customerName || '',
    tanggalISO: date.toISOString().slice(0, 10),
    timestamp: sale.createdAt || Date.now(),
    waktu: date.toLocaleString('id-ID')
  };

  return legacyWrite(
    'legacySet',
    `transaksi/${sale.invoice}`,
    payload
  );
}

async function stockTransaction(
  path,
  base,
  delta,
  legacy = false
) {
  if (!auth.currentUser) {
    return {
      committed: false,
      demo: true
    };
  }

  try {
    if (!navigator.onLine) throw new Error('offline');

    return await runTransaction(
      ref(db, path),
      value => Math.max(
        0,
        number(value ?? base) + delta
      )
    );
  } catch (error) {
    queue({
      type: legacy
        ? 'legacyStockDelta'
        : 'stockDelta',
      absolutePath: legacy ? path : undefined,
      path: legacy
        ? undefined
        : path.replace(`${ROOT}/`, ''),
      delta,
      base
    });

    return {
      committed: false,
      error
    };
  }
}

export async function atomicStock(
  productId,
  delta,
  branchId = ''
) {
  const id = String(productId);
  const product = productCache.get(id);
  const change = number(delta);
  const base = stockForBranch(product, branchId);
  const legacyGlobalBase = number(product?.stock);
  const next = Math.max(0, base + change);

  if (product) {
    if (branchId && branchId !== 'all') {
      product.stockByBranch = {
        ...(product.stockByBranch || {}),
        [branchId]: next
      };
    } else {
      product.stock = next;
    }

    productCache.set(id, product);
  }

  /*
   * Stok diperbarui pada object cache yang sama.
   * Cache produk tidak dibuang, sehingga Kasir tidak perlu memuat
   * 8.000+ produk lagi setelah setiap transaksi.
   */
  window.dispatchEvent(new CustomEvent('aya-data-changed', {
    detail: {
      path: `stockByBranch/${branchId}/${id}`,
      scopes: [],
      inMemoryOnly: true
    }
  }));

  const target = (
    branchId && branchId !== 'all'
      ? `${ROOT}/stockByBranch/${branchId}/${id}`
      : `${ROOT}/products/${id}/stock`
  );

  const result = await stockTransaction(
    target,
    base,
    change
  );

  const legacyBranchPath =
    product?._legacyBranchStockPaths?.[branchId];

  if (legacyBranchPath) {
    await stockTransaction(
      legacyBranchPath,
      base,
      change,
      true
    );
  } else if (product?._legacyStockPath) {
    await stockTransaction(
      product._legacyStockPath,
      legacyGlobalBase,
      change,
      true
    );
  }

  return result;
}

export async function flushQueue() {
  if (!navigator.onLine || !auth.currentUser) return;

  const rows = JSON.parse(
    localStorage.getItem(QUEUE_KEY) || '[]'
  );

  if (!rows.length) return;

  const remaining = [];

  for (const operation of rows) {
    try {
      if (operation.type === 'stockDelta') {
        await runTransaction(
          ref(db, `${ROOT}/${operation.path}`),
          value => Math.max(
            0,
            number(value ?? operation.base)
              + number(operation.delta)
          )
        );
      } else if (operation.type === 'legacyStockDelta') {
        await runTransaction(
          ref(db, operation.absolutePath),
          value => Math.max(
            0,
            number(value ?? operation.base)
              + number(operation.delta)
          )
        );
      } else {
        await remoteWrite(operation);
      }
    } catch {
      remaining.push(operation);
    }
  }

  localStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(remaining)
  );

  window.dispatchEvent(new CustomEvent('aya-queue', {
    detail: remaining.length
  }));
}

export function queueCount() {
  return JSON.parse(
    localStorage.getItem(QUEUE_KEY) || '[]'
  ).length;
}

export function connectionInfo() {
  return {
    connected,
    firebaseReadable,
    user,
    queued: queueCount()
  };
}

export {
  serverTimestamp,
  DEFAULT_BRANCH_ID,
  DEFAULT_BRANCH_NAME
};
