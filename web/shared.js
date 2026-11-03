(function(root){
 'use strict';
 const ACTIVE='carebridge-shared-case-v1',BOOK='carebridge-shared-book-v1';
 let session=null,available=false;
 const read=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))||fallback;}catch{return fallback;}};
 const keyFor=p=>{const r=root.CareBridgeRoutes.parse(p);return r.role==='facility'?'facility/'+r.facility:r.role;};
 function parseLink(hash){const q=new URLSearchParams(String(hash||'').replace(/^#/,''));if(!q.has('case')&&!q.has('access'))return null;return {id:q.get('case'),access:q.get('access')};}
 function fragment(id,access){return '#'+new URLSearchParams({case:id,access}).toString();}
 function remember(){if(!session)return;localStorage.setItem(ACTIVE,JSON.stringify(session));{const book=read(BOOK,[]).filter(x=>x.id!==session.id);book.unshift(session);localStorage.setItem(BOOK,JSON.stringify(book.slice(0,20)));}}
 function access(path){const key=keyFor(path);return key?session?.credentials[key]:session?.access;}
 function pathHref(path){if(!session)return path;const a=access(path);return a?path+fragment(session.id,a):null;}
 async function request(body,path=location.pathname){
  const current=session,a=access(path);if(!session||!a)throw Error('이 화면의 이용 링크가 필요합니다.');
  const r=await fetch('/api/cases?id='+encodeURIComponent(session.id),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+a,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify({...body,revision:session.revision,requestId:crypto.randomUUID()})}:{}),signal:AbortSignal.timeout(body?.operation==='advance'?29000:12000)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'공유 기록을 불러오지 못했습니다.');
  if(session!==current)return {...data,stale:true};
  if(data.credentials)Object.assign(session.credentials,data.credentials);
  session.revision=data.revision;session.profileRevision=data.profileRevision||'';session.access=a;session.role=data.role;session.facility=data.facility;session.caseId=data.state.caseId;session.stage=data.state.stage;remember();return data;
 }
 async function init(){
  if(location.protocol==='file:')return null;
  const q=parseLink(location.hash),saved=read(ACTIVE,null);
  if(q){const owner=read(BOOK,[]).find(x=>x.id===q.id)||saved?.id===q.id&&saved;session={id:q.id,access:q.access,revision:0,credentials:owner?.credentials||{}};
   const r=await fetch('/api/cases?id='+encodeURIComponent(q.id),{headers:{Authorization:'Bearer '+q.access},signal:AbortSignal.timeout(12000)}),data=await r.json();if(!r.ok){session=null;throw Error(data.error||'이용 링크를 확인해 주세요.');}
   if(data.credentials)Object.assign(session.credentials,data.credentials);
   const key=data.role==='facility'?'facility/'+data.facility:data.role;session.credentials[key]=q.access;session.role=data.role;session.facility=data.facility;session.revision=data.revision;session.profileRevision=data.profileRevision||'';session.caseId=data.state.caseId;session.stage=data.state.stage;remember();
   const expected=keyFor(location.pathname);if(expected&&expected!==key&&!session.credentials[expected])throw Error('이 링크로는 요청한 화면을 이용할 수 없습니다.');
   if(expected&&expected!==key)return request();return data;
  }
  session=saved;if(session)return request();return null;
 }
 async function create(scenario,patientSelection){
  const r=await fetch('/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'create',scenario,requiresPatient:true,requiresSchedule:true,...(patientSelection?{patientSelection}:{})}),signal:AbortSignal.timeout(15000)}),data=await r.json();if(!r.ok)throw Error(data.error||'새 회송 건을 만들지 못했습니다.');
  session={id:data.id,revision:data.revision,profileRevision:data.profileRevision||'',credentials:data.credentials,access:data.credentials.hospital,role:'hospital',facility:null,caseId:data.state.caseId,stage:0};remember();return data;
 }
 async function reopen(caseId,patientSelection){
  const r=await fetch('/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'open-patient-case',caseId,patientSelection}),signal:AbortSignal.timeout(15000)}),data=await r.json();if(!r.ok)throw Error(data.error||'회송 기록을 열지 못했습니다.');
  session={id:data.id,revision:data.revision,profileRevision:data.profileRevision||'',credentials:data.credentials,access:data.credentials.hospital,role:'hospital',caseId:data.state.caseId,stage:data.state.stage};remember();return data;
 }
 async function tasks(role,facility){const key=role==='facility'?'facility/'+facility:role;const items=read(BOOK,[]).filter(x=>x.credentials?.[key]);return Promise.all(items.map(async x=>{try{const r=await fetch('/api/cases?id='+encodeURIComponent(x.id),{headers:{Authorization:'Bearer '+x.credentials[key]},signal:AbortSignal.timeout(12000)});if(!r.ok)return null;const d=await r.json(),s=d.state;if(role==='facility'&&!s.inquiries.includes(facility)&&s.selected!==facility)return null;return {id:x.id,case_number:s.caseId,name:s.patient,number:s.patientRecord?.number||'',stage:s.stage,selected:s.selected,consent:s.consent,response:s.responses?.[facility]?.status,information_provided:!!s.inquiryNotes?.[facility],responses:role==='hospital'?s.responses:undefined,inquiries:s.inquiries,updated_at:d.updatedAt||null,visit_result:s.visit?.result,href:('/'+key)+fragment(x.id,x.credentials[key])};}catch{return null;}})).then(rows=>rows.filter(Boolean));}
 root.CareBridgeShared={parseLink,fragment,keyFor,init,create,reopen,tasks,refresh:()=>request(),assignPatient:patientSelection=>request({operation:'assign-patient',patientSelection},'/hospital'),transition:action=>request({operation:'transition',action}),simulate:action=>request({operation:'simulate',action}),advance:basic=>request({operation:'advance',basic:basic===true}),href:pathHref,
  get active(){return !!session;},get revision(){return session?.revision;},get session(){return session;},get available(){return available;},set available(v){available=v;},
  book:()=>read(BOOK,[]),can:path=>!session||!!access(path),forget(){session=null;localStorage.removeItem(ACTIVE);},historyHref(item){return '/hospital'+fragment(item.id,item.credentials.hospital);}};
})(typeof globalThis!=='undefined'?globalThis:this);
