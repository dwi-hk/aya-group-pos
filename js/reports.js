import { getOnce } from './store.js';
import { rupiah, escapeHTML, toArray, sum, number, csvCell, download, dateTime } from './utils.js';

function flatten(value){return Object.entries(value||{}).flatMap(([branchId,rows])=>toArray(rows).map(row=>({...row,branchId:row.branchId||branchId})))}
function isoDate(value,fallback=''){const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):fallback}

export async function renderReports(ctx){
  const [salesRaw,purchasesRaw,operationsRaw,capitalRaw]=await Promise.all([getOnce('sales'),getOnce('purchases'),getOnce('operations'),getOnce('capital')]);
  const allSales=flatten(salesRaw),allPurchases=flatten(purchasesRaw),allOperations=flatten(operationsRaw),allCapital=toArray(capitalRaw);
  const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10),end=now.toISOString().slice(0,10);
  const cashiers=[...new Set(allSales.map(s=>s.cashierName).filter(Boolean))];
  ctx.host.innerHTML=`<article class="card"><div class="toolbar"><div><h2>Laporan Lengkap</h2><p class="muted">Penjualan lama dan baru, pembelian, operasional, modal, laba/rugi, pembayaran, dan rincian per item.</p></div><div class="toolbar-group"><button id="exportReport" class="secondary-button">Export CSV</button><button id="printReport" class="primary-button">Cetak</button></div></div><div class="form-grid"><label>Dari Tanggal<input id="reportStart" type="date" value="${start}"></label><label>Sampai Tanggal<input id="reportEnd" type="date" value="${end}"></label><label>Kasir<select id="reportCashier"><option value="all">Semua</option>${cashiers.map(x=>`<option>${escapeHTML(x)}</option>`).join('')}</select></label><label>Pembayaran<select id="reportPayment"><option value="all">Semua</option><option>TUNAI</option><option>QRIS</option><option>HUTANG</option><option>PERSONAL</option></select></label></div></article><section id="reportOutput" style="margin-top:16px"></section>`;
  let current=[];
  const update=()=>{
    const a=document.querySelector('#reportStart').value,b=document.querySelector('#reportEnd').value,cashier=document.querySelector('#reportCashier').value,payment=document.querySelector('#reportPayment').value;
    current=allSales.filter(s=>{const d=isoDate(s.createdAt,s.date);return d>=a&&d<=b&&(ctx.branch.id==='all'||s.branchId===ctx.branch.id)&&(cashier==='all'||s.cashierName===cashier)&&(payment==='all'||s.paymentMethod===payment)});
    const purchases=allPurchases.filter(p=>{const d=isoDate(p.createdAt,p.date);return d>=a&&d<=b&&(ctx.branch.id==='all'||p.branchId===ctx.branch.id)});
    const operations=allOperations.filter(o=>{const d=String(o.date||isoDate(o.createdAt));return d>=a&&d<=b&&(ctx.branch.id==='all'||o.branchId===ctx.branch.id)});
    const capital=allCapital.filter(m=>{const d=String(m.date||isoDate(m.createdAt));return d>=a&&d<=b&&(ctx.branch.id==='all'||m.branchId===ctx.branch.id)});
    renderOutput(current,purchases,operations,capital);
  };
  ['reportStart','reportEnd','reportCashier','reportPayment'].forEach(id=>document.querySelector('#'+id).onchange=update);
  document.querySelector('#printReport').onclick=()=>window.print();
  document.querySelector('#exportReport').onclick=()=>{const headers=['invoice','tanggal','cabang','kasir','pembayaran','pelanggan','subtotal','ongkir','styrofoam','diskon','total','bayar','kembali','sumber'];const csv=[headers.join(','),...current.map(s=>[s.invoice,new Date(s.createdAt).toISOString(),s.branchName,s.cashierName,s.paymentMethod,s.customerName,s.subtotal,s.shipping,s.styrofoamTotal,s.discount,s.total,s.paid,s.change,s.source].map(csvCell).join(','))].join('\n');download('laporan-penjualan.csv',csv,'text/csv')};
  update();
}

function renderOutput(sales,purchases,operations,capital){
  const gross=sum(sales,s=>s.total),cogs=sum(sales,s=>sum(s.items||[],i=>number(i.cost)*number(i.qty))),op=sum(operations,o=>o.total),capitalTotal=sum(capital,m=>m.amount),profit=gross-cogs-op,purchaseTotal=sum(purchases,p=>p.total),hppMissing=sales.flatMap(s=>s.items||[]).filter(i=>number(i.cost)<=0).length;
  const byPay={};sales.forEach(s=>byPay[s.paymentMethod]=(byPay[s.paymentMethod]||0)+number(s.total));
  const cashOperations=sum(operations.filter(o=>String(o.paymentMethod||o.method||'TUNAI').toUpperCase()==='TUNAI'),o=>o.total);
  const cashPurchases=sum(purchases.filter(p=>String(p.paymentMethod||p.method||'TUNAI').toUpperCase()==='TUNAI'),p=>p.total);
  const cashReal=capitalTotal+(byPay.TUNAI||0)-cashOperations-cashPurchases;
  const byItem={};sales.flatMap(s=>s.items||[]).forEach(i=>{const name=i.name||'Tanpa nama',entry=byItem[name]??={qty:0,revenue:0,cost:0};entry.qty+=number(i.qty);entry.revenue+=number(i.qty)*number(i.price);entry.cost+=number(i.qty)*number(i.cost)});
  const inferred=sales.filter(s=>s.branchInferred).length;
  document.querySelector('#reportOutput').innerHTML=`
    ${inferred?`<article class="card" style="margin-bottom:16px"><strong>Catatan pemetaan data lama:</strong> ${inferred} transaksi pada hasil ini tidak mempunyai kolom cabang di database lama, sehingga dimasukkan ke cabang utama AYA Seblak dan Angkringan.</article>`:''}
    ${hppMissing?`<article class="card" style="margin-bottom:16px"><strong>Catatan HPP:</strong> ${hppMissing} baris item belum mempunyai harga beli pada transaksi maupun master produk. Estimasi laba untuk item tersebut memakai HPP Rp0 sampai harga beli dilengkapi.</article>`:''}
    <div class="grid cards">
      <article class="card metric-card"><span>Omzet</span><strong>${rupiah(gross)}</strong><small>${sales.length} nota</small></article>
      <article class="card metric-card"><span>HPP Terjual</span><strong>${rupiah(cogs)}</strong><small>Harga beli per item</small></article>
      <article class="card metric-card"><span>Operasional</span><strong>${rupiah(op)}</strong><small>Kulakan ${rupiah(purchaseTotal)}</small></article>
      <article class="card metric-card accent"><span>Estimasi Laba Bersih</span><strong>${rupiah(profit)}</strong><small>Omzet - HPP - operasional</small></article>
    </div>
    <div class="grid two" style="margin-top:16px">
      <article class="card"><h2>Uang Riil & Pembayaran</h2>${['TUNAI','QRIS','HUTANG','PERSONAL'].map(method=>`<div class="summary-row"><span>${method}</span><b>${rupiah(byPay[method]||0)}</b></div>`).join('')}<div class="summary-row"><span>Modal masuk</span><b>${rupiah(capitalTotal)}</b></div><div class="summary-row total"><span>Estimasi kas tunai</span><b>${rupiah(cashReal)}</b></div><small class="muted">Hanya transaksi TUNAI yang memengaruhi estimasi kas. Rekonsiliasi fisik tersedia pada menu Kas & Rekonsiliasi.</small></article>
      <article class="card"><h2>Grafik Omzet Harian</h2><canvas id="reportChart" class="chart" width="900" height="260"></canvas></article>
    </div>
    <article class="card" style="margin-top:16px"><h2>Barang Terjual & Laba per Item</h2><div class="table-wrap"><table><thead><tr><th>Barang</th><th>Qty</th><th>Omzet</th><th>HPP</th><th>Laba Kotor</th></tr></thead><tbody>${Object.entries(byItem).sort((a,b)=>b[1].qty-a[1].qty).map(([name,value])=>`<tr><td>${escapeHTML(name)}</td><td>${value.qty}</td><td>${rupiah(value.revenue)}</td><td>${rupiah(value.cost)}</td><td>${rupiah(value.revenue-value.cost)}</td></tr>`).join('')||'<tr><td colspan="5">Belum ada data.</td></tr>'}</tbody></table></div></article>
    <article class="card" style="margin-top:16px"><h2>Transaksi Per Nota</h2><div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Nota</th><th>Cabang</th><th>Kasir</th><th>Item</th><th>Pembayaran</th><th>Total</th></tr></thead><tbody>${[...sales].sort((a,b)=>b.createdAt-a.createdAt).map(s=>`<tr><td>${dateTime(s.createdAt)}</td><td>${escapeHTML(s.invoice)}</td><td>${escapeHTML(s.branchName||'-')}</td><td>${escapeHTML(s.cashierName||'-')}</td><td>${(s.items||[]).map(i=>`${escapeHTML(i.name)} × ${i.qty}`).join('<br>')}</td><td>${escapeHTML(s.paymentMethod)}</td><td>${rupiah(s.total)}</td></tr>`).join('')||'<tr><td colspan="7">Tidak ada transaksi pada periode ini.</td></tr>'}</tbody></table></div></article>`;
  drawDaily(document.querySelector('#reportChart'),sales);
}

function drawDaily(canvas,sales){
  const daily={};sales.forEach(s=>{const d=isoDate(s.createdAt,s.date).slice(5,10);if(d)daily[d]=(daily[d]||0)+number(s.total)});
  const entries=Object.entries(daily).sort(),max=Math.max(...entries.map(x=>x[1]),1),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  entries.slice(-12).forEach(([date,value],index)=>{const x=35+index*70,height=value/max*170;ctx.fillStyle='#f57c00';ctx.fillRect(x,210-height,42,height);ctx.fillStyle='#aeb3bd';ctx.font='12px sans-serif';ctx.fillText(date,x,232);ctx.fillText(Math.round(value/1000)+'k',x,202-height)});
}
