import { getOnce, setData } from './store.js';
import { fallbackProducts, fallbackBranches } from './menu-data.js';
import { formObject, escapeHTML, download, number } from './utils.js';
import { connectPrinter, bluetoothSupported } from './bluetooth.js';

export async function renderSettings(ctx){
  const [databaseSettings,stats]=await Promise.all([getOnce('businessSettings'),getOnce('legacyStats')]);
  const local=JSON.parse(localStorage.getItem('aya.settings')||'{}');

  /*
   * Firebase menjadi sumber utama agar identitas usaha konsisten
   * pada laptop, tablet, dan HP.
   */
  const current={...local,...(databaseSettings||{})};
  localStorage.setItem('aya.settings',JSON.stringify(current));

  const count=(key)=>Number(stats?.[key]||0).toLocaleString('id-ID');
  ctx.host.innerHTML=`
  <div class="grid two">
    <article class="card"><h2>Nota & Identitas Usaha</h2><p class="muted">Nilai awal dibaca dari node lama <code>pengaturan/nota</code>, lalu perubahan disimpan aman di <code>ayaGroupV2/settings/receipt</code>.</p><form id="settingsForm" class="form-grid"><label>Header Nota<input name="header" value="${escapeHTML(current.header||'AYA GROUP – MULTY PAYMENT')}"></label><label>No. HP / WA<input name="phone" value="${escapeHTML(current.phone||'085136798499')}"></label><label class="full">Alamat<input name="address" value="${escapeHTML(current.address||'Samping Alfamart Prambon')}"></label><label>Modal Awal Laci<input name="cashDrawerCapital" inputmode="numeric" value="${escapeHTML(current.cashDrawerCapital||0)}"></label><label class="full">Footer Nota<input name="footer" value="${escapeHTML(current.footer||'Terima kasih. Pedasnya pas, nikmatnya berkelas.')}"></label><button class="primary-button full">Simpan Setting</button></form></article>
    <article class="card"><h2>Printer Bluetooth / Thermal 58 mm</h2><p class="muted">Web Bluetooth memerlukan HTTPS dan UUID layanan printer yang cocok. Bila gagal, gunakan menu cetak sistem Android/PC.</p><div class="form-grid"><label class="full">Service UUID<input id="serviceUUID" value="${escapeHTML(current.bluetoothServiceUUID||'000018f0-0000-1000-8000-00805f9b34fb')}"></label><label class="full">Characteristic UUID<input id="charUUID" value="${escapeHTML(current.bluetoothCharacteristicUUID||'00002af1-0000-1000-8000-00805f9b34fb')}"></label></div><button id="testBluetooth" class="secondary-button" style="margin-top:12px">Hubungkan Printer</button><p class="muted">Dukungan browser: ${bluetoothSupported()?'Terdeteksi':'Tidak terdeteksi'}</p></article>
  </div>
  <div class="grid two" style="margin-top:16px">
    <article class="card"><h2>Backup & Restore</h2><p class="muted">Backup manual khusus namespace <code>ayaGroupV2</code>. Restore tidak menghapus node database lama.</p><div class="toolbar-group"><button id="backupButton" class="secondary-button">Download Backup V2</button><label class="danger-button" style="display:inline-flex;cursor:pointer">Restore V2<input id="restoreFile" type="file" accept=".json" hidden></label></div></article>
    <article class="card"><h2>Data Lama Terdeteksi</h2><div class="summary-row"><span>Master menu</span><b>${count('master_menu')}</b></div><div class="summary-row"><span>Menu tambahan</span><b>${count('menu_tambahan')}</b></div><div class="summary-row"><span>Transaksi</span><b>${count('transaksi')}</b></div><div class="summary-row"><span>Pengeluaran</span><b>${count('pengeluaran')}</b></div><div class="summary-row"><span>Transaksi tanpa cabang</span><b>${count('transaksiTanpaCabang')}</b></div><p class="muted">Data lama dibaca langsung melalui adaptor. Transaksi yang tidak mempunyai kolom cabang ditandai sebagai data cabang utama AYA Seblak dan Angkringan.</p></article>
  </div>
  <article class="card" style="margin-top:16px"><h2>Inisialisasi Aman</h2><p class="muted">Data contoh hanya diisi bila data produk atau cabang benar-benar kosong. Tidak ada proses hapus otomatis.</p><button id="seedButton" class="primary-button">Periksa & Isi Data Kosong</button></article>`;

  document.querySelector('#settingsForm').onsubmit=async e=>{
    e.preventDefault();
    const raw=formObject(e.currentTarget);
    const data={...current,...raw,cashDrawerCapital:number(raw.cashDrawerCapital),bluetoothServiceUUID:document.querySelector('#serviceUUID').value.trim(),bluetoothCharacteristicUUID:document.querySelector('#charUUID').value.trim(),updatedAt:Date.now()};
    localStorage.setItem('aya.settings',JSON.stringify(data));
    await setData('settings/receipt',data);
    ctx.notify('Setting nota disimpan');
  };
  document.querySelector('#testBluetooth').onclick=async()=>{
    const data={...current,bluetoothServiceUUID:document.querySelector('#serviceUUID').value.trim(),bluetoothCharacteristicUUID:document.querySelector('#charUUID').value.trim()};
    localStorage.setItem('aya.settings',JSON.stringify(data));
    try{const name=await connectPrinter();ctx.notify(`Terhubung: ${name}`)}catch(error){ctx.notify(error.message,'error')}
  };
  document.querySelector('#backupButton').onclick=async()=>{const data=await getOnce('');download(`aya-group-backup-v2-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data||{},null,2));ctx.notify('Backup V2 diunduh')};
  document.querySelector('#restoreFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!confirm('Restore akan mengganti namespace ayaGroupV2. Node lama tidak dihapus. Lanjutkan?'))return;await setData('',data);ctx.notify('Restore V2 selesai')}catch(error){ctx.notify('File backup tidak valid','error')}};
  document.querySelector('#seedButton').onclick=async()=>{const existingProducts=await getOnce('products'),existingBranches=await getOnce('branches');if(!existingProducts)for(const p of fallbackProducts)await setData(`products/${p.id}`,p);if(!existingBranches)for(const b of fallbackBranches)await setData(`branches/${b.id}`,b);ctx.notify('Pemeriksaan selesai; data lama tetap aman');window.dispatchEvent(new Event('aya-branches-changed'))};
}
