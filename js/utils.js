export const rupiah = value => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value)||0);
export const number = value => Number(String(value ?? 0).replace(/[^0-9.-]/g,'')) || 0;
export const uid = (prefix='id') => `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
export const todayISO = () => new Date().toISOString().slice(0,10);
export const dateTime = value => value ? new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '-';
export const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
export const debounce = (fn,wait=250)=>{let t;return(...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),wait)}};
export const download = (filename,content,type='application/json')=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)};
export const csvCell = v => `"${String(v ?? '').replaceAll('"','""')}"`;
export const toArray = object => object ? Object.entries(object).map(([id,v])=>({id,...v})) : [];
export const sum = (arr,fn=v=>v) => arr.reduce((a,v)=>a+number(fn(v)),0);
export const wait = ms => new Promise(r=>setTimeout(r,ms));
export function formObject(form){return Object.fromEntries(new FormData(form).entries())}
export function groupBy(items,keyFn){return items.reduce((out,item)=>{const k=keyFn(item);(out[k]??=[]).push(item);return out},{})}
export function safeJSON(value,fallback=[]){try{return JSON.parse(value)}catch{return fallback}}
