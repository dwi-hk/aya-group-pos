import { pushData } from './store.js';
export async function audit(action,module,details={}){
  const session = JSON.parse(localStorage.getItem('aya.session') || '{}');
  return pushData('auditLogs',{action,module,details,userId:session.uid||'local',userName:session.name||'Mode Lokal',branchId:localStorage.getItem('aya.branch')||'',at:Date.now()},{silent:true});
}
