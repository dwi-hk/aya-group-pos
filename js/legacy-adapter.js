import { number } from './utils.js';

export const DEFAULT_BRANCH_ID = 'aya-seblak-angkringan';
export const DEFAULT_BRANCH_NAME = 'AYA SEBLAK DAN ANGKRINGAN';

const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase().replace(/&/g, 'dan').replace(/[^a-z0-9]+/g, ' ').trim();
const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function parseLegacyDate(raw = {}) {
  for (const value of [raw.createdAt, raw.timestamp, raw.updatedAt, raw.iso]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  if (raw.tanggalISO) {
    const parsed = Date.parse(`${raw.tanggalISO}T12:00:00+07:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const match = clean(raw.waktu).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?)?/);
  if (match) {
    const [, day, month, year, hour = '12', minute = '0', second = '0'] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
  }
  return 0;
}

export function normalizeBranchRecord(raw = {}, id = '') {
  return {
    ...raw,
    id: clean(raw.id || id),
    name: clean(raw.name || raw.nama || raw.namaCabang || 'Cabang'),
    code: clean(raw.code || raw.kode || (String(raw.id || id).startsWith('CAB-') ? raw.id || id : '')),
    address: clean(raw.address || raw.alamat),
    phone: clean(raw.phone || raw.noHp || raw.wa),
    type: clean(raw.type || raw.tipe),
    active: raw.active !== false && raw.aktif !== false,
    source: raw.source || 'legacy:cabang'
  };
}

export function dedupeBranches(records = []) {
  const groups = new Map();
  for (const branch of records.filter(Boolean)) {
    const key = norm(branch.name) || branch.id;
    const score = [branch.address, branch.phone, branch.type, branch.code].filter(Boolean).length + (branch.id.includes('-') ? 1 : 0);
    const existing = groups.get(key);
    if (!existing || score >= existing.score) {
      const aliases = [...new Set([...(existing?.branch.aliases || []), existing?.branch.id, ...(branch.aliases || []), branch.id].filter(Boolean))];
      groups.set(key, { score, branch: { ...branch, aliases } });
    } else {
      existing.branch.aliases = [...new Set([...(existing.branch.aliases || []), branch.id, ...(branch.aliases || [])].filter(Boolean))];
    }
  }
  return [...groups.values()].map(x => x.branch);
}

export function branchIdFor(value, branches = []) {
  const raw = clean(value);
  if (!raw) return DEFAULT_BRANCH_ID;
  const normalized = norm(raw);
  const exact = branches.find(b => b.id === raw || (b.aliases || []).includes(raw));
  if (exact) return exact.id;
  const named = branches.find(b => norm(b.name) === normalized);
  if (named) return named.id;
  if (normalized.includes('seblak') || normalized.includes('angkringan')) return branches.find(b => norm(b.name).includes('seblak'))?.id || DEFAULT_BRANCH_ID;
  if (normalized.includes('sembako') || normalized.includes('toko')) return branches.find(b => norm(b.name).includes('sembako') || norm(b.name).includes('toko'))?.id || 'aya-toko-sembako';
  if (normalized.includes('dapur')) return branches.find(b => norm(b.name).includes('dapur'))?.id || 'dapur-aya';
  return raw;
}

export function branchNameFor(id, branches = []) {
  return branches.find(b => b.id === id || (b.aliases || []).includes(id))?.name || (id === DEFAULT_BRANCH_ID ? DEFAULT_BRANCH_NAME : clean(id));
}

function normalizeLegacyItem(raw = {}, index = 0) {
  const qty = Math.max(0, number(raw.qty ?? raw.jumlah ?? 1));
  const price = number(raw.price ?? raw.harga ?? raw.hargaJual);
  const cost = number(raw.cost ?? raw.hargaBeli ?? raw.buyPrice);
  return {
    id: clean(raw.id || raw.productId || raw.barangId || `legacy-item-${index}`),
    name: clean(raw.name || raw.nama || raw.namaBarang || 'Tanpa nama'),
    qty,
    price,
    cost,
    category: clean(raw.category || raw.kategori || 'Lainnya'),
    unit: clean(raw.unit || raw.satuan || 'pcs')
  };
}

export function normalizeLegacySale(raw = {}, id = '', branches = []) {
  const methodRaw = clean(raw.paymentMethod || raw.metodePembayaran || 'TUNAI').toUpperCase();
  if (methodRaw === 'MODAL_MASUK') return null;
  const paymentMethod = methodRaw === 'KONSUMSI' ? 'PERSONAL' : methodRaw;
  const branchId = branchIdFor(raw.branchId || raw.cabang, branches);
  const createdAt = parseLegacyDate(raw);
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeLegacyItem) : [];
  const itemSubtotal = items.reduce((total, item) => total + item.qty * item.price, 0);
  const shipping = number(raw.shipping ?? raw.ongkir);
  const styrofoamQty = number(raw.styrofoamQty ?? raw.qtyStyrofoam);
  const styrofoamTotal = number(raw.styrofoamTotal ?? raw.styrofoam) || styrofoamQty * 1000;
  const discount = number(raw.discount ?? raw.diskon);
  const total = number(raw.total) || Math.max(0, itemSubtotal + shipping + styrofoamTotal - discount);
  const paid = number(raw.paid ?? raw.bayar);
  const change = number(raw.change ?? raw.kembalian);
  const invoice = clean(raw.invoice || raw.id || id);
  const orderMap = { DINE_IN: 'Makan di tempat', TAKE_AWAY: 'Dibungkus', DELIVERY: 'Delivery' };
  return {
    id: clean(raw.id || id || invoice),
    invoice,
    branchId,
    branchName: branchNameFor(branchId, branches),
    branchInferred: !raw.branchId && !raw.cabang,
    cashierId: clean(raw.cashierId || raw.userId || 'legacy'),
    cashierName: clean(raw.cashierName || raw.kasir || 'Kasir Lama'),
    items,
    subtotal: number(raw.subtotal) || itemSubtotal,
    shipping,
    styrofoamQty,
    styrofoamTotal,
    discount,
    total,
    paymentMethod,
    orderType: orderMap[clean(raw.orderType || raw.tipePesanan).toUpperCase()] || clean(raw.orderType || raw.tipePesanan || 'Data lama'),
    customerName: clean(raw.customerName || raw.pelangganNama || raw.pelanggan),
    customerId: clean(raw.customerId || raw.pelangganId),
    customerPhone: clean(raw.customerPhone || raw.pelangganKontak),
    paid,
    change,
    status: clean(raw.status || 'done').toLowerCase(),
    createdAt,
    date: raw.tanggalISO || (createdAt ? new Date(createdAt).toISOString().slice(0, 10) : ''),
    source: 'legacy:transaksi',
    legacyRawId: clean(id)
  };
}

export function normalizeLegacyOperation(raw = {}, id = '', branches = []) {
  const branchId = branchIdFor(raw.branchId || raw.cabang, branches);
  const items = Array.isArray(raw.items) ? raw.items.map((item, index) => ({
    id: clean(item.id || `item-${index}`),
    name: clean(item.name || item.nama || item.namaBarang || 'Item'),
    qty: number(item.qty ?? item.jumlah ?? 1),
    unit: clean(item.unit || item.satuan || 'pcs'),
    price: number(item.price ?? item.harga ?? item.nominal),
    total: number(item.total) || number(item.qty ?? item.jumlah ?? 1) * number(item.price ?? item.harga ?? item.nominal)
  })) : [];
  const total = number(raw.total ?? raw.biaya ?? raw.nominal) || items.reduce((sum, item) => sum + item.total, 0) || number(raw.harga) * Math.max(1, number(raw.qty));
  const createdAt = parseLegacyDate(raw);
  return {
    id: clean(raw.id || id),
    branchId,
    branchName: branchNameFor(branchId, branches),
    branchInferred: !raw.branchId && !raw.cabang,
    date: clean(raw.date || raw.tanggalISO || (createdAt ? new Date(createdAt).toISOString().slice(0, 10) : '')),
    name: clean(raw.name || raw.namaBarang || raw.nama || raw.keterangan || 'Operasional'),
    category: clean(raw.category || raw.kategori || 'Operasional lama'),
    method: clean(raw.paymentMethod || raw.method || raw.metode || 'TUNAI'),
    paymentMethod: clean(raw.paymentMethod || raw.method || raw.metode || 'TUNAI'),
    qty: number(raw.qty) || 1,
    unit: clean(raw.unit || raw.satuan || 'item'),
    price: number(raw.price ?? raw.harga ?? raw.biaya ?? raw.nominal),
    total,
    notes: clean(raw.notes || raw.keterangan),
    contactPerson: clean(raw.contactPerson || raw.pic || raw.namaKontak),
    address: clean(raw.address || raw.alamat),
    whatsapp: clean(raw.whatsapp || raw.wa || raw.telepon || raw.noWa),
    items,
    createdAt,
    source: 'legacy:pengeluaran'
  };
}

export function normalizeCustomer(raw = {}, id = '', source = 'legacy:pelanggan') {
  return {
    ...raw,
    id: clean(raw.id || id),
    name: clean(raw.name || raw.nama || 'Pelanggan'),
    contact: clean(raw.contact || raw.kontak || raw.contactPerson),
    phone: clean(raw.phone || raw.telepon || raw.wa || raw.kontak),
    address: clean(raw.address || raw.alamat),
    balance: number(raw.balance ?? raw.hutang ?? raw.piutang),
    active: raw.active !== false,
    source,
    _legacyPath: raw._legacyPath
  };
}

export function normalizeSupplier(raw = {}, id = '', source = 'legacy:suppliers') {
  return {
    ...raw,
    id: clean(raw.id || id),
    name: clean(raw.name || raw.nama || 'Supplier'),
    contact: clean(raw.contact || raw.kontak || raw.contactPerson),
    phone: clean(raw.phone || raw.wa || raw.telepon || raw.kontak),
    address: clean(raw.address || raw.alamat),
    notes: clean(raw.notes || raw.keterangan),
    balance: number(raw.balance ?? raw.piutang ?? raw.hutang),
    active: raw.active !== false,
    source,
    _legacyPath: raw._legacyPath
  };
}

export function normalizeConsignment(raw = {}, id = '') {
  const initial = number(raw.initial ?? raw.jumlahAwal ?? raw.awal);
  const sold = number(raw.sold ?? raw.terjual);
  const returned = number(raw.returned ?? raw.retur);
  const paid = number(raw.paid ?? raw.sudahDibayar);
  return {
    ...raw,
    id: clean(raw.id || id),
    name: clean(raw.name || raw.nama || 'Barang titipan'),
    contact: clean(raw.contact || raw.kontak),
    phone: clean(raw.phone || raw.wa),
    address: clean(raw.address || raw.alamat),
    initial,
    sold,
    returned,
    paid,
    cost: number(raw.cost ?? raw.hargaBeli),
    price: number(raw.price ?? raw.hargaJual),
    total: Math.max(0, sold * number(raw.hargaJual) - paid),
    balance: Math.max(0, sold * number(raw.hargaJual) - paid),
    notes: `Awal ${initial}, terjual ${sold}, retur ${returned}, dibayar ${paid}`,
    active: raw.active !== false,
    source: 'legacy:barang_titipan',
    _legacyPath: raw._legacyPath
  };
}

export function normalizeLegacyTransfer(raw = {}, id = '', branches = []) {
  const fromId = branchIdFor(raw.fromId || raw.dariCabang, branches);
  const toId = branchIdFor(raw.toId || raw.keCabang, branches);
  const statusRaw = clean(raw.status).toUpperCase();
  const status = statusRaw === 'COMPLETED' || statusRaw === 'DITERIMA' ? 'received' : statusRaw === 'APPROVED' || statusRaw === 'DISETUJUI' ? 'approved' : 'pending';
  return {
    id: clean(raw.id || id),
    productId: clean(raw.productId || raw.barangId || raw.produkId),
    productName: clean(raw.productName || raw.barangNama || raw.namaBarang || 'Barang'),
    fromId,
    toId,
    fromName: branchNameFor(fromId, branches),
    toName: branchNameFor(toId, branches),
    qty: number(raw.qty || raw.jumlah),
    status,
    notes: clean(raw.notes || raw.keterangan),
    createdAt: parseLegacyDate(raw),
    receivedAt: raw.waktuDiterima ? parseLegacyDate({ waktu: raw.waktuDiterima }) : 0,
    source: 'legacy:transfer'
  };
}

export function normalizeLegacyDebt(raw = {}, id = '', branches = []) {
  if (clean(raw.metodePembayaran).toUpperCase() !== 'HUTANG') return null;
  const amount = number(raw.total);
  const paid = number(raw.sudahDibayar);
  const remaining = Math.max(0, amount - paid);
  return {
    id: `legacy-debt-${clean(raw.id || id)}`,
    type: 'customer',
    customerId: clean(raw.pelangganId),
    customerName: clean(raw.pelangganNama || raw.pelanggan || 'Pelanggan'),
    customerPhone: clean(raw.pelangganKontak),
    invoice: clean(raw.id || id),
    amount,
    remaining,
    status: remaining <= 0 ? 'paid' : 'open',
    dueDate: clean(raw.jatuhTempo),
    branchId: branchIdFor(raw.cabang, branches),
    createdAt: parseLegacyDate(raw),
    notes: 'Hutang dari transaksi database lama',
    source: 'legacy:transaksi'
  };
}

export function normalizeCapital(raw = {}, id = '', branches = []) {
  const branchId = branchIdFor(raw.branchId || raw.cabang, branches);
  return {
    id: clean(raw.id || id),
    branchId,
    branchName: branchNameFor(branchId, branches),
    amount: number(raw.amount ?? raw.nominal ?? raw.total),
    date: clean(raw.date || raw.tanggalISO),
    createdAt: parseLegacyDate(raw),
    notes: clean(raw.notes || raw.keterangan || 'Modal tambahan'),
    source: raw.source || 'legacy:modal'
  };
}

export function normalizeSettings(raw = {}) {
  const receipt = asObject(raw.nota);
  const printer = asObject(raw.printer);
  const source = Object.keys(receipt).length ? receipt : printer;
  return {
    header: clean(source.header),
    address: clean(source.alamat),
    phone: clean(source.wa),
    footer: clean(source.footer),
    cashDrawerCapital: number(raw.modal_laci),
    source: 'legacy:pengaturan'
  };
}

export function objectEntries(value) {
  return Object.entries(asObject(value));
}
