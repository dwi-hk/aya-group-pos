const encoder=new TextEncoder();
let device=null,characteristic=null;
export function bluetoothSupported(){return 'bluetooth' in navigator}
export async function connectPrinter(){
  if(!bluetoothSupported())throw new Error('Web Bluetooth tidak didukung browser ini. Gunakan Chrome/Edge Android atau cetak sistem.');
  const cfg=JSON.parse(localStorage.getItem('aya.settings')||'{}');
  const service=cfg.bluetoothServiceUUID||'000018f0-0000-1000-8000-00805f9b34fb';
  const char=cfg.bluetoothCharacteristicUUID||'00002af1-0000-1000-8000-00805f9b34fb';
  device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[service]});
  const server=await device.gatt.connect();const svc=await server.getPrimaryService(service);characteristic=await svc.getCharacteristic(char);return device.name||'Printer Bluetooth';
}
export async function bluetoothPrint(text){if(!characteristic)await connectPrinter();const bytes=encoder.encode(text);for(let i=0;i<bytes.length;i+=160){await characteristic.writeValueWithoutResponse(bytes.slice(i,i+160))}}
export function disconnectPrinter(){device?.gatt?.disconnect();device=null;characteristic=null}
