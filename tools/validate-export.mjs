import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeBranchRecord, dedupeBranches, normalizeLegacySale,
  normalizeLegacyOperation, normalizeLegacyDebt, normalizeCapital
} from '../js/legacy-adapter.js';

const filename=process.argv[2];
if(!filename){console.error('Cara pakai: node tools/validate-export.mjs <file-export.json>');process.exit(1)}
const full=path.resolve(filename);
let data;
try{data=JSON.parse(fs.readFileSync(full,'utf8'))}catch(error){console.error(`File JSON gagal dibaca: ${error.message}`);process.exit(1)}
const count=node=>data[node]&&typeof data[node]==='object'?Object.keys(data[node]).length:0;
const branches=dedupeBranches(Object.entries(data.cabang||{}).map(([id,row])=>normalizeBranchRecord(row,id)));
const sales=Object.entries(data.transaksi||{}).map(([id,row])=>normalizeLegacySale(row,id,branches)).filter(Boolean);
const operations=Object.entries(data.pengeluaran||{}).map(([id,row])=>normalizeLegacyOperation(row,id,branches));
const debts=Object.entries(data.transaksi||{}).map(([id,row])=>normalizeLegacyDebt(row,id,branches)).filter(Boolean);
const capital=[
  ...Object.entries(data.modal_tambahan||{}).map(([id,row])=>normalizeCapital(row,id,branches)),
  ...Object.entries(data.transaksi||{}).filter(([,row])=>String(row.metodePembayaran||'').toUpperCase()==='MODAL_MASUK').map(([id,row])=>normalizeCapital({...row,nominal:row.total},id,branches))
];
const productIds=new Set([...Object.keys(data.master_menu||{}),...Object.keys(data.menu_tambahan||{}),...Object.keys(data.master_barang||{}),...Object.keys(data.menu||{})]);
const missingBranch=Object.values(data.transaksi||{}).filter(row=>!row?.cabang&&!row?.branchId).length;
console.log(JSON.stringify({
  file:full,
  topLevelNodes:Object.keys(data).length,
  canonicalBranches:branches.map(branch=>({id:branch.id,name:branch.name,aliases:branch.aliases||[]})),
  uniqueProducts:productIds.size,
  rawTransactions:count('transaksi'),
  normalizedSales:sales.length,
  capitalEntries:capital.length,
  operations:operations.length,
  customerDebts:debts.length,
  transactionsWithoutBranch:missingBranch,
  sourceCounts:Object.fromEntries(Object.keys(data).sort().map(key=>[key,count(key)]))
},null,2));
