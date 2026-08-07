import { getProducts, getOnce, stockForBranch } from './store.js';
import { rupiah, toArray, sum, escapeHTML } from './utils.js';

function flattenSales(value){return Object.entries(value||{}).flatMap(([branchId,rows])=>toArray(rows).map(r=>({...r,branchId:r.branchId||branchId})))}
export async function renderDashboard(ctx){
  const [products,salesRaw,operationsRaw,debtsRaw]=await Promise.all([getProducts(),getOnce('sales'),getOnce('operations'),getOnce('debts')]);
  const allSales=flattenSales(salesRaw);const sales=ctx.branch.id==='all'?allSales:allSales.filter(s=>s.branchId===ctx.branch.id);
  const today=new Date().toISOString().slice(0,10);const month=today.slice(0,7);
  const todaySales=sales.filter(s=>new Date(s.createdAt).toISOString().slice(0,10)===today);
  const monthSales=sales.filter(s=>new Date(s.createdAt).toISOString().slice(0,7)===month);
  const branchProducts=(ctx.branch.id==='all'?products:products.filter(p=>!p.branchIds?.length||p.branchIds.includes(ctx.branch.id))).map(p=>({...p,stock:stockForBranch(p,ctx.branch.id)}));
  const low=branchProducts.filter(p=>Number(p.stock)<=Number(p.minStock??0));
  const operations=Object.entries(operationsRaw||{}).flatMap(([b,rows])=>toArray(rows).map(r=>({...r,branchId:b})));
  const monthOps=sum(operations.filter(o=>(ctx.branch.id==='all'||o.branchId===ctx.branch.id)&&String(o.date||'').startsWith(month)),o=>o.total);
  const receivable=sum(toArray(debtsRaw),d=>d.status==='paid'?0:d.remaining??d.amount);
  ctx.host.innerHTML=`
    <div class="grid cards">
      <article class="card metric-card accent"><span>Omzet Hari Ini</span><strong>${rupiah(sum(todaySales,s=>s.total))}</strong><small>${todaySales.length} transaksi</small></article>
      <article class="card metric-card"><span>Omzet Bulan Ini</span><strong>${rupiah(sum(monthSales,s=>s.total))}</strong><small>Sebelum operasional</small></article>
      <article class="card metric-card"><span>Operasional Bulan Ini</span><strong>${rupiah(monthOps)}</strong><small>Tercatat per cabang</small></article>
      <article class="card metric-card"><span>Piutang Berjalan</span><strong>${rupiah(receivable)}</strong><small>Belum lunas</small></article>
    </div>
    <div class="grid two" style="margin-top:16px">
      <article class="card"><div class="toolbar"><div><h2>Omzet 7 Hari</h2><p class="muted">Transaksi kasir tersimpan</p></div><button class="secondary-button" data-action="print">Cetak</button></div><canvas id="revenueChart" class="chart" width="900" height="260"></canvas></article>
      <article class="card"><div class="toolbar"><div><h2>Notifikasi Stok</h2><p class="muted">Barang mencapai stok minimum</p></div><span class="badge">${low.length} item</span></div>
        <div class="table-wrap"><table><thead><tr><th>Barang</th><th>Stok</th><th>Minimum</th></tr></thead><tbody>${low.slice(0,12).map(p=>`<tr><td>${escapeHTML(p.name)}</td><td class="danger-text">${p.stock} ${escapeHTML(p.unit)}</td><td>${p.minStock}</td></tr>`).join('')||'<tr><td colspan="3">Stok aman.</td></tr>'}</tbody></table></div>
      </article>
    </div>
    <div class="grid two" style="margin-top:16px">
      <article class="card"><h2>Produk Terlaris</h2><div id="bestSeller"></div></article>
      <article class="card"><h2>Ringkasan Pembayaran</h2><div id="paymentSummary"></div></article>
    </div>`;
  const byItem={};sales.flatMap(s=>s.items||[]).forEach(i=>byItem[i.name]=(byItem[i.name]||0)+Number(i.qty||0));
  document.querySelector('#bestSeller').innerHTML=Object.entries(byItem).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,qty],i)=>`<div class="summary-row"><span>${i+1}. ${escapeHTML(name)}</span><strong>${qty}</strong></div>`).join('')||'<p class="muted">Belum ada penjualan.</p>';
  const byPay={};sales.forEach(s=>byPay[s.paymentMethod||'LAINNYA']=(byPay[s.paymentMethod||'LAINNYA']||0)+Number(s.total||0));
  document.querySelector('#paymentSummary').innerHTML=Object.entries(byPay).map(([m,v])=>`<div class="summary-row"><span>${escapeHTML(m)}</span><strong>${rupiah(v)}</strong></div>`).join('')||'<p class="muted">Belum ada data.</p>';
  drawChart(document.querySelector('#revenueChart'),sales);
  ctx.host.querySelector('[data-action="print"]').onclick=()=>window.print();
}
function drawChart(canvas,sales){
  const ctx=canvas.getContext('2d'),days=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d.toISOString().slice(0,10))}
  const values=days.map(day=>sum(sales.filter(s=>new Date(s.createdAt).toISOString().slice(0,10)===day),s=>s.total));const max=Math.max(...values,1);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#343842';ctx.fillStyle='#aeb3bd';ctx.font='14px sans-serif';
  values.forEach((v,i)=>{const x=50+i*120,h=(v/max)*170,y=210-h;ctx.fillStyle='#f57c00';ctx.fillRect(x,y,64,h);ctx.fillStyle='#aeb3bd';ctx.fillText(days[i].slice(5),x,235);ctx.fillText(Math.round(v/1000)+'k',x,y-8)});
}
