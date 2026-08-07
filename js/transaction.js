import { getProducts, getOnce, pushData, atomicStock, updateData, updateProductPurchaseInfo, stockForBranch } from './store.js';
import { rupiah, escapeHTML, number, formObject, toArray, dateTime, sum } from './utils.js';
import { audit } from './audit.js';

const PAYMENT_OPTIONS = ['TUNAI', 'QRIS', 'HUTANG', 'PERSONAL'];
const paymentSelect = (id, value = 'TUNAI') => `<select id="${id}">${PAYMENT_OPTIONS.map(method => `<option ${method === value ? 'selected' : ''}>${method}</option>`).join('')}</select>`;

function requireBranch(ctx) {
  if (ctx.branch.id !== 'all') return true;
  ctx.host.innerHTML = '<article class="card"><h2>Pilih satu cabang</h2><p class="muted">Transaksi pembelian dan operasional harus dicatat pada cabang tertentu agar stok dan laporan kas akurat.</p></article>';
  return false;
}

export async function renderPurchases(ctx) {
  if (!requireBranch(ctx)) return;
  const [products, raw, suppliersRaw] = await Promise.all([
    getProducts(),
    getOnce(`purchases/${ctx.branch.id}`),
    getOnce('suppliers')
  ]);
  let rows = toArray(raw).sort((a, b) => number(b.createdAt) - number(a.createdAt));
  let draft = [];
  const suppliers = toArray(suppliersRaw);
  const itemTotal = item => number(item.total) || number(item.qtyLarge) * number(item.cartonCost) || number(item.qty) * number(item.cost);

  const renderDraft = () => {
    const host = document.querySelector('#draftPurchase');
    if (!host) return;
    host.innerHTML = draft.map((item, index) => `
      <div class="card" style="padding:12px;margin-bottom:8px">
        <div class="summary-row"><span><strong>${escapeHTML(item.name)}</strong></span><button class="icon-button" data-remove="${index}" title="Hapus">✕</button></div>
        <div class="summary-row"><span>${item.qtyLarge} ${escapeHTML(item.largeUnit)} × ${rupiah(item.cartonCost)}</span><b>${rupiah(itemTotal(item))}</b></div>
        <small class="muted">Stok bertambah ${item.qtySmall} ${escapeHTML(item.unit)} · isi ${item.packSize}/${escapeHTML(item.largeUnit)} · HPP ${rupiah(item.cost)}/${escapeHTML(item.unit)} · harga jual ${rupiah(item.price)}</small>
      </div>`).join('') + `<div class="summary-row total"><span>Total Pembelian</span><b>${rupiah(sum(draft, itemTotal))}</b></div>`;
    host.onclick = event => {
      const button = event.target.closest('[data-remove]');
      if (!button) return;
      draft.splice(Number(button.dataset.remove), 1);
      renderDraft();
    };
  };

  const draw = () => {
    ctx.host.innerHTML = `
      <div class="grid two">
        <article class="card">
          <h2>Pembelian / Kulakan</h2>
          <p class="muted">Harga beli besar, isi, HPP satuan kecil, dan harga jual akan disinkronkan ke Master Barang saat pembelian disimpan.</p>
          <div class="form-grid">
            <label class="full">Barang<select id="buyProduct">${products.map(product => `<option value="${escapeHTML(product.id)}">${escapeHTML(product.name)} · stok ${stockForBranch(product, ctx.branch.id)} ${escapeHTML(product.unit)}</option>`).join('')}</select></label>
            <label>Jumlah Satuan Besar<input id="buyLargeQty" type="number" min="1" step="1" value="1"></label>
            <label>Nama Satuan Besar<input id="buyLargeUnit" value="karton" placeholder="karton/dus/pak"></label>
            <label>Harga Beli Satuan Besar<input id="buyLargeCost" inputmode="numeric" value="0"></label>
            <label>Isi per Satuan Besar (Jumlah Satuan Kecil)<input id="buyPackSize" type="number" min="1" step="1" value="1"></label>
            <label>Harga Beli Satuan Kecil<input id="buyUnitCost" inputmode="numeric" value="0" readonly></label>
            <label>Satuan Kecil<input id="buySmallUnit" value="pcs" readonly></label>
            <label>Harga Jual<input id="buySellPrice" inputmode="numeric" value="0"></label>
            <p id="purchaseCalculation" class="muted full" style="margin:0">Pilih barang untuk melihat perhitungan pembelian.</p>
            <label>Supplier<select id="buySupplier"><option value="">Tanpa supplier</option>${suppliers.map(supplier => `<option value="${supplier.id}">${escapeHTML(supplier.name)}</option>`).join('')}</select></label>
            <label>No. Faktur<input id="buyInvoice"></label>
            <label>Metode Pembayaran${paymentSelect('buyPayment')}</label>
          </div>
          <button id="addBuyItem" class="secondary-button" style="margin-top:12px">+ Tambah Item</button>
          <div id="draftPurchase" style="margin-top:12px"></div>
          <button id="savePurchase" class="primary-button" style="width:100%;margin-top:12px">Simpan Pembelian</button>
        </article>
        <article class="card">
          <h2>Riwayat Kulakan</h2>
          <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Faktur</th><th>Item</th><th>Metode</th><th>Total</th></tr></thead><tbody>
            ${rows.map(row => `<tr><td>${dateTime(row.createdAt)}</td><td>${escapeHTML(row.invoice || '-')}</td><td>${(row.items || []).map(item => item.qtyLarge ? `${escapeHTML(item.name)}: ${item.qtyLarge} ${escapeHTML(item.largeUnit || 'besar')} (${item.qtySmall || item.qty} ${escapeHTML(item.unit || 'pcs')})` : `${escapeHTML(item.name)} × ${item.qty}`).join('<br>')}</td><td>${escapeHTML(row.paymentMethod || 'TUNAI')}</td><td>${rupiah(row.total)}</td></tr>`).join('') || '<tr><td colspan="5">Belum ada pembelian.</td></tr>'}
          </tbody></table></div>
        </article>
      </div>`;

    const productSelect = document.querySelector('#buyProduct');
    const largeQtyInput = document.querySelector('#buyLargeQty');
    const largeUnitInput = document.querySelector('#buyLargeUnit');
    const largeCostInput = document.querySelector('#buyLargeCost');
    const packSizeInput = document.querySelector('#buyPackSize');
    const unitCostInput = document.querySelector('#buyUnitCost');
    const smallUnitInput = document.querySelector('#buySmallUnit');
    const sellPriceInput = document.querySelector('#buySellPrice');
    const calculation = document.querySelector('#purchaseCalculation');

    const calculate = () => {
      const largeQty = Math.max(1, number(largeQtyInput.value));
      const largeCost = number(largeCostInput.value);
      const packSize = Math.max(1, number(packSizeInput.value));
      const unitCost = largeCost > 0 ? Math.round(largeCost / packSize) : 0;
      const totalUnits = largeQty * packSize;
      unitCostInput.value = unitCost;
      calculation.textContent = `${largeQty} ${largeUnitInput.value || 'satuan besar'} × isi ${packSize} = stok bertambah ${totalUnits} ${smallUnitInput.value || 'pcs'}. HPP per satuan kecil: ${rupiah(unitCost)}.`;
    };

    const loadSelectedProduct = () => {
      const product = products.find(item => item.id === productSelect.value);
      if (!product) return;
      const packSize = Math.max(1, number(product.packSize) || 1);
      packSizeInput.value = packSize;
      largeCostInput.value = number(product.cartonCost) || number(product.cost) * packSize || 0;
      largeUnitInput.value = product.largeUnit || 'karton';
      smallUnitInput.value = product.unit || 'pcs';
      sellPriceInput.value = number(product.price);
      calculate();
    };
    productSelect.onchange = loadSelectedProduct;
    [largeQtyInput, largeUnitInput, largeCostInput, packSizeInput].forEach(input => input.oninput = calculate);
    loadSelectedProduct();

    document.querySelector('#addBuyItem').onclick = () => {
      const product = products.find(item => item.id === productSelect.value);
      const qtyLarge = Math.max(1, number(largeQtyInput.value));
      const cartonCost = number(largeCostInput.value);
      const packSize = Math.max(1, number(packSizeInput.value));
      const cost = cartonCost > 0 ? Math.round(cartonCost / packSize) : 0;
      const price = number(sellPriceInput.value);
      const largeUnit = largeUnitInput.value.trim() || 'karton';
      const qtySmall = qtyLarge * packSize;
      if (!product || cartonCost <= 0 || packSize <= 0 || price <= 0) return ctx.notify('Barang, harga beli besar, isi, dan harga jual wajib diisi', 'error');
      draft.push({
        productId: product.id,
        name: product.name,
        qtyLarge,
        largeUnit,
        cartonCost,
        packSize,
        qtySmall,
        qty: qtySmall,
        cost,
        price,
        unit: product.unit || 'pcs',
        total: qtyLarge * cartonCost
      });
      renderDraft();
    };

    document.querySelector('#savePurchase').onclick = async () => {
      if (!draft.length) return ctx.notify('Tambahkan item kulakan', 'error');
      const supplierId = document.querySelector('#buySupplier').value;
      const supplier = suppliers.find(item => item.id === supplierId);
      const paymentMethod = document.querySelector('#buyPayment').value;
      if (paymentMethod === 'HUTANG' && !supplierId) return ctx.notify('Supplier wajib dipilih untuk kulakan hutang', 'error');
      const purchase = {
        branchId: ctx.branch.id,
        branchName: ctx.branch.name,
        invoice: document.querySelector('#buyInvoice').value.trim() || `BUY-${Date.now()}`,
        supplierId,
        supplierName: supplier?.name || '',
        items: draft,
        total: sum(draft, itemTotal),
        paymentMethod,
        createdBy: ctx.user.name,
        createdAt: Date.now()
      };
      const result = await pushData(`purchases/${ctx.branch.id}`, purchase);
      for (const item of draft) {
        await atomicStock(item.productId, item.qtySmall, ctx.branch.id);
        const patch = await updateProductPurchaseInfo(item.productId, item);
        const product = products.find(row => row.id === item.productId);
        if (product) Object.assign(product, patch);
      }
      if (paymentMethod === 'HUTANG') {
        await pushData('debts', {
          type: 'supplier',
          supplierId,
          supplierName: supplier?.name || 'Supplier',
          invoice: purchase.invoice,
          amount: purchase.total,
          remaining: purchase.total,
          status: 'open',
          dueDate: '',
          branchId: ctx.branch.id,
          createdAt: Date.now(),
          notes: 'Hutang dari transaksi kulakan'
        });
      }
      rows.unshift({ ...purchase, id: result.key });
      draft = [];
      await audit('CREATE', 'PURCHASE', { invoice: purchase.invoice, total: purchase.total, paymentMethod });
      ctx.notify('Pembelian tersimpan; stok, HPP, isi, dan harga jual Master Barang sudah diperbarui');
      draw();
    };
    renderDraft();
  };
  draw();
}

export async function renderOperations(ctx) {
  if (!requireBranch(ctx)) return;
  let rows = toArray(await getOnce(`operations/${ctx.branch.id}`)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const draw = () => {
    ctx.host.innerHTML = `
      <article class="card">
        <div class="toolbar"><div><h2>Operasional Cabang</h2><p class="muted">Catat metode pembayaran agar laporan kas tunai tidak tercampur dengan QRIS, hutang, atau personal.</p></div><button id="addOperation" class="primary-button">+ Pengeluaran</button></div>
        <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Nama Pengeluaran</th><th>Satuan</th><th>Qty</th><th>Harga</th><th>Metode</th><th>Total</th><th>Keterangan</th></tr></thead><tbody>
          ${rows.map(row => `<tr><td>${escapeHTML(row.date)}</td><td>${escapeHTML(row.name)}</td><td>${escapeHTML(row.unit)}</td><td>${row.qty}</td><td>${rupiah(row.price)}</td><td>${escapeHTML(row.paymentMethod || row.method || 'TUNAI')}</td><td>${rupiah(row.total)}</td><td>${escapeHTML(row.notes || '-')}</td></tr>`).join('') || '<tr><td colspan="8">Belum ada pengeluaran.</td></tr>'}
        </tbody></table></div>
      </article>`;
    document.querySelector('#addOperation').onclick = () => operationForm(ctx, async item => {
      const result = await pushData(`operations/${ctx.branch.id}`, item);
      rows.unshift({ ...item, id: result.key });
      draw();
    });
  };
  draw();
}

function operationForm(ctx, onSave) {
  ctx.dialog('Tambah Operasional', `
    <form id="operationForm" class="form-grid">
      <label>Tanggal<input name="date" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Nama Barang/Pengeluaran<input name="name" required></label>
      <label>Satuan<input name="unit" value="pcs"></label>
      <label>Jumlah<input name="qty" type="number" min="0.01" step="0.01" value="1"></label>
      <label>Harga Satuan<input name="price" inputmode="numeric" required></label>
      <label>Metode Pembayaran<select name="paymentMethod">${PAYMENT_OPTIONS.map(method => `<option>${method}</option>`).join('')}</select></label>
      <label>Kategori<select name="category"><option>Bahan Baku</option><option>Listrik/Air</option><option>Transportasi</option><option>Perawatan</option><option>Makan Karyawan</option><option>Lainnya</option></select></label>
      <label class="full">Keterangan<textarea name="notes"></textarea></label>
    </form>`,
    '<button value="cancel" class="secondary-button">Batal</button><button id="saveOperation" class="primary-button">Simpan</button>'
  );
  document.querySelector('#saveOperation').onclick = async event => {
    event.preventDefault();
    const form = document.querySelector('#operationForm');
    if (!form.reportValidity()) return;
    const raw = formObject(form);
    const item = {
      ...raw,
      qty: number(raw.qty),
      price: number(raw.price),
      total: number(raw.qty) * number(raw.price),
      branchId: ctx.branch.id,
      branchName: ctx.branch.name,
      createdBy: ctx.user.name,
      createdAt: Date.now()
    };
    await onSave(item);
    await audit('CREATE', 'OPERATION', { name: item.name, total: item.total, paymentMethod: item.paymentMethod });
    document.querySelector('#appDialog').close();
    ctx.notify('Operasional tersimpan');
  };
}

export async function renderDebts(ctx) {
  let debts = toArray(await getOnce('debts'))
    .filter(row => ctx.branch.id === 'all' || !row.branchId || row.branchId === ctx.branch.id)
    .sort((a, b) => (a.status === 'paid') - (b.status === 'paid'));

  const draw = () => {
    ctx.host.innerHTML = `
      <article class="card">
        <div class="toolbar"><div><h2>Hutang, Piutang, dan Kasbon</h2><p class="muted">Pembayaran tunai pelanggan menambah laci; pembayaran tunai supplier atau kasbon mengurangi laci.</p></div><button id="addDebt" class="primary-button">+ Catatan</button></div>
        <div class="table-wrap"><table><thead><tr><th>Jenis</th><th>Nama</th><th>Referensi</th><th>Jatuh Tempo</th><th>Nilai</th><th>Sisa</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
          ${debts.map(debt => `<tr><td>${escapeHTML(debt.type)}</td><td>${escapeHTML(debt.customerName || debt.supplierName || debt.employeeName || debt.name || '-')}</td><td>${escapeHTML(debt.invoice || debt.notes || '-')}</td><td>${escapeHTML(debt.dueDate || '-')}</td><td>${rupiah(debt.amount)}</td><td>${rupiah(debt.remaining)}</td><td><span class="status ${debt.status === 'paid' ? 'success' : debt.dueDate && debt.dueDate < new Date().toISOString().slice(0, 10) ? 'danger' : 'warning'}">${escapeHTML(debt.status || 'open')}</span></td><td>${debt.status !== 'paid' ? `<button class="secondary-button" data-pay="${debt.id}">Bayar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8">Belum ada catatan.</td></tr>'}
        </tbody></table></div>
      </article>`;

    document.querySelector('#addDebt').onclick = () => debtForm(ctx, async item => {
      const result = await pushData('debts', item);
      debts.unshift({ ...item, id: result.key });
      draw();
    });

    ctx.host.querySelector('tbody').onclick = event => {
      const button = event.target.closest('[data-pay]');
      if (!button) return;
      const debt = debts.find(item => item.id === button.dataset.pay);
      paymentForm(ctx, debt, async (amount, paymentMethod) => {
        const remaining = Math.max(0, number(debt.remaining) - amount);
        const status = remaining <= 0 ? 'paid' : 'open';
        await updateData(`debts/${debt.id}`, { remaining, status, lastPaidAt: Date.now() });
        await pushData(`debtPayments/${debt.id}`, {
          debtId: debt.id,
          debtType: debt.type,
          branchId: debt.branchId || ctx.branch.id,
          branchName: ctx.branch.name,
          amount,
          paymentMethod,
          name: debt.customerName || debt.supplierName || debt.employeeName || debt.name || '',
          invoice: debt.invoice || '',
          paidBy: ctx.user.name,
          createdAt: Date.now()
        });
        debt.remaining = remaining;
        debt.status = status;
        await audit('CREATE', 'DEBT_PAYMENT', { debtId: debt.id, debtType: debt.type, amount, paymentMethod });
        draw();
      });
    };
  };
  draw();
}

function debtForm(ctx, onSave) {
  ctx.dialog('Tambah Hutang/Piutang/Kasbon', `
    <form id="debtForm" class="form-grid">
      <label>Jenis<select name="type"><option value="customer">Hutang Pelanggan</option><option value="supplier">Utang Supplier</option><option value="employee">Kasbon Karyawan</option></select></label>
      <label>Nama<input name="name" required></label>
      <label>Nominal<input name="amount" inputmode="numeric" required></label>
      <label>Jatuh Tempo<input name="dueDate" type="date"></label>
      <label class="full">Referensi / Keterangan<textarea name="notes"></textarea></label>
    </form>`,
    '<button value="cancel" class="secondary-button">Batal</button><button id="saveDebt" class="primary-button">Simpan</button>'
  );
  document.querySelector('#saveDebt').onclick = async event => {
    event.preventDefault();
    const form = document.querySelector('#debtForm');
    if (!form.reportValidity()) return;
    const raw = formObject(form);
    const amount = number(raw.amount);
    const nameField = raw.type === 'customer' ? 'customerName' : raw.type === 'supplier' ? 'supplierName' : 'employeeName';
    await onSave({
      ...raw,
      [nameField]: raw.name,
      amount,
      remaining: amount,
      status: 'open',
      branchId: ctx.branch.id === 'all' ? '' : ctx.branch.id,
      createdAt: Date.now()
    });
    document.querySelector('#appDialog').close();
    ctx.notify('Catatan tersimpan');
  };
}

function paymentForm(ctx, debt, onPay) {
  ctx.dialog('Pembayaran', `
    <p>Sisa tagihan: <strong>${rupiah(debt.remaining)}</strong></p>
    <form id="payForm" class="form-grid">
      <label>Nominal Bayar<input name="amount" inputmode="numeric" required value="${debt.remaining}"></label>
      <label>Metode Pembayaran<select name="paymentMethod"><option>TUNAI</option><option>QRIS</option></select></label>
    </form>`,
    '<button value="cancel" class="secondary-button">Batal</button><button id="savePay" class="primary-button">Bayar</button>'
  );
  document.querySelector('#savePay').onclick = async event => {
    event.preventDefault();
    const formData = new FormData(document.querySelector('#payForm'));
    const amount = number(formData.get('amount'));
    const paymentMethod = String(formData.get('paymentMethod') || 'TUNAI');
    if (amount <= 0) return;
    await onPay(Math.min(amount, number(debt.remaining)), paymentMethod);
    document.querySelector('#appDialog').close();
    ctx.notify('Pembayaran dicatat');
  };
}
