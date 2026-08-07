let deferredPrompt=null;
export function setupPWA(button){
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(console.warn);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;button.hidden=false});
  button.addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;button.hidden=true});
}
