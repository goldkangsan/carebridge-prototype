(function(root){
 'use strict';
 const KEY='carebridge-patient-register-v1';let register=null,pending;
 try{register=JSON.parse(localStorage.getItem(KEY));}catch{}
 const fragment=new URLSearchParams(location.hash.slice(1));
 if(fragment.has('register')&&fragment.has('registerAccess'))register={id:fragment.get('register'),access:fragment.get('registerAccess')};
 async function call(body){
  const r=await fetch('/api/patients'+(register?'?register='+encodeURIComponent(register.id):''),{method:'POST',headers:{'Content-Type':'application/json',...(register?{Authorization:'Bearer '+register.access}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await r.json();if(!r.ok){const e=Error(data.error||'환자 정보를 불러오지 못했습니다.');e.duplicate=data.duplicate===true;throw e;}if(register&&body.operation!=='create-register')try{localStorage.setItem(KEY,JSON.stringify(register));}catch{}return data;
 }
 async function ensure(){
  if(register)return register;if(pending)return pending;
  pending=(async()=>{const data=await call({operation:'create-register'});register=data.register;localStorage.setItem(KEY,JSON.stringify(register));return register;})();
  try{return await pending;}finally{pending=null;}
 }
 root.CareBridgePatients={ensure,tasks:async()=>{await ensure();return call({operation:'tasks'});},search:async query=>{await ensure();return call({operation:'search',query});},detail:async patientId=>{await ensure();return call({operation:'detail',patientId});},
  create:async patient=>{await ensure();return call({operation:'register',patient});},selection:patientId=>({registerId:register.id,access:register.access,patientId}),
  href:()=>'/hospital/patients#'+new URLSearchParams({register:register.id,registerAccess:register.access}).toString()};
})(typeof globalThis!=='undefined'?globalThis:this);
