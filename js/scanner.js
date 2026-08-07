let stream=null,timer=null;
export function scannerSupported(){return 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia}
export async function startScanner(video,onCode,{facingMode='environment'}={}){
  if(!scannerSupported())throw new Error('Pemindai kamera otomatis belum didukung browser ini. Gunakan input barcode manual.');
  const detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','qr_code','upc_a','upc_e']});
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode},audio:false});video.srcObject=stream;await video.play();
  const tick=async()=>{try{const codes=await detector.detect(video);if(codes[0]){onCode(codes[0].rawValue);stopScanner();return}}catch(_){}timer=requestAnimationFrame(tick)};tick();
}
export function stopScanner(){if(timer)cancelAnimationFrame(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;timer=null}
