import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {databaseConfigured,getDatabase} from './database.mjs';
import {createAgentApi,createFacilityApi} from './agents.mjs';

export const hashToken=t=>createHash('sha256').update(t).digest('hex');
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const token=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
const allow={hospital:['attest','source','parse','applyExtraction','supplement','ready','provideInfo','expand','prep','handoff','ack','relink'],patient:['profile','preferences','consent','choose','rejectCandidates'],facility:['facilityUpdate','response','visit']};
function credentialsFor(M,owner){return Object.fromEntries(['hospital','patient',...M.facilities.map(f=>'facility/'+f.id)].map(key=>[key,key==='hospital'?owner:createHmac('sha256',owner).update(key).digest('base64url')]));}
export function projectState(M,state,grant){
 const s=structuredClone(state);
 if(grant.role==='facility'){
  const own=grant.facility,shared=s.selected===own&&s.shareConsent;
  s.responses=s.responses[own]?{[own]:s.responses[own]}:{};s.inquiries=s.inquiries.includes(own)?[own]:[];
  s.events=[];s.agentRuns=[];s.lastAgent=null;s.extraction=null;
  s.inquiryNotes=s.inquiryNotes[own]?{[own]:s.inquiryNotes[own]}:{};
  s.facilityUpdates=s.facilityUpdates[own]?{[own]:s.facilityUpdates[own]}:{};
  if(!shared){s.patient='비식별 의뢰 대상자';s.data=Object.fromEntries(['treatment','period','isolation'].map(k=>[k,s.data[k]||'']));s.source=Object.entries(s.data).map(([k,v])=>M.fields[k]+': '+v).join('\n');s.inquiryDraft='';s.visit=null;}
 }
 return s;
}
export function createCasesApi(M,{store,configured=()=>databaseConfigured(),agent=createAgentApi(M),facility=createFacilityApi(M)}={}){
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 const response=(row,grant,extra={})=>json({id:row.id,revision:row.revision,state:projectState(M,row.state,grant),role:grant.role,facility:grant.facility||null,synthetic:true,...(grant.role==='hospital'&&grant.rawAccess&&row.state.accessVersion===2?{credentials:credentialsFor(M,grant.rawAccess)}:{}),...extra});
 return async request=>{
  const url=new URL(request.url);if(url.pathname!=='/api/cases')return null;
  if(request.method==='GET'&&url.searchParams.get('status')==='1')return json({available:configured(),storage:configured()?'postgresql':'unavailable',syntheticOnly:true});
  if(!configured())return json({error:'공유 저장소 연결을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.'},503);
  const db=store||getDatabase();
  try{
   let body={};
   if(request.method==='POST'){
    if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
    const text=await request.text();if(text.length>80000)return json({error:'입력 크기를 줄여 주세요.'},413);body=JSON.parse(text);
    if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'허용되지 않은 요청입니다.'},403);
   }else if(request.method!=='GET')return json({error:'지원하지 않는 요청입니다.'},405);
   if(request.method==='POST'&&body.operation==='create'){
    if(!['normal','missing','unavailable'].includes(body.scenario))return json({error:'시나리오를 확인해 주세요.'},400);
    const id=randomUUID(),s=M.initial(body.scenario),credentials=credentialsFor(M,randomBytes(32).toString('base64url'));s.caseId='CB-'+id.slice(0,8).toUpperCase();s.accessVersion=2;
    const grants=Object.entries(credentials).map(([key,value])=>({hash:hashToken(value),role:key.split('/')[0],facility:key.split('/')[1]||''}));
    const row=await db.create(id,s,grants);return response(row,{role:'hospital'},{credentials});
   }
   const id=url.searchParams.get('id'),key=request.headers.get('authorization')?.replace(/^Bearer /,'');
   if(!uuid(id)||!token(key))return json({error:'회송 건의 유효한 이용 링크가 필요합니다.'},401);
   const row=await db.read(id,hashToken(key));if(!row)return json({error:'이용 링크를 확인해 주세요.'},403);
   row.rawAccess=key;
   if(request.method==='GET')return response(row,row);
   if(!uuid(body.requestId)||!Number.isInteger(body.revision)||body.revision<0)return json({error:'요청 정보를 확인해 주세요.'},400);
   if(await db.replay(id,body.requestId))return response(row,row,{replayed:true});
   if(row.revision!==body.revision)return response(row,row,{conflict:true});
   if(body.operation==='advance'){
    if(row.role==='facility')return json({error:'수용기관은 직접 회신해 주세요.'},403);
    const s=row.state;if(!(s.consent&&(s.stage===1||s.stage===2)))return response(row,row);
    const lease=randomUUID();if(!await db.claim(id,lease))return response(row,row,{processing:true});
    try{
     let next=structuredClone(s);
     if(body.basic===true)next.inquiryDraft=['treatment','period','isolation'].map(k=>M.fields[k]+': '+next.data[k]).join('\n');
     if(s.stage===1){
      if(body.basic===true){next.automationMode='basic';next.lastAgent=null;next=M.transition(next,{type:'send'},'hospital');}
      else{
      const r=await agent(new Request(url.origin+'/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:s})})),a=await r.json();
      if(!r.ok)return json({error:a.error||'자동 처리를 잠시 후 다시 시도해 주세요.'},503);
      next=M.transition(next,{type:'recordAgent',result:a},'hospital');
      if(a.nextAction==='send_inquiries')next=M.transition(next,{type:'send'},'hospital');
      }
     }else{
      const pending=s.inquiries.filter(f=>!s.responses[f]);
      if(pending.length){
       const replies=await Promise.all(pending.map(async f=>{const r=await facility(new Request(url.origin+'/api/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:M.facilityRequest(next,f)})}));if(!r.ok)throw Error('기관 응답을 확인하지 못했습니다.');return (await r.json()).receipt;}));
       for(const receipt of replies)next=M.transition(next,{type:'receipt',receipt},'simulation');
      }
      if(body.basic===true){next.automationMode='basic';next.lastAgent=null;if(M.accepted(next).length)next=M.transition(next,{type:'publish'},'hospital');}
      else{
      const r=await agent(new Request(url.origin+'/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:next})})),a=await r.json();
      if(!r.ok)return json({error:a.error||'회신 분석을 다시 시도해 주세요.'},503);
      next=M.transition(next,{type:'recordAgent',result:a},'hospital');
      if(a.nextAction==='present_candidates'&&M.accepted(next).length)next=M.transition(next,{type:'publish'},'hospital');
      }
     }
     const saved=await db.commit(row,next,body.requestId);return saved?response(saved,row):response(await db.read(id,hashToken(key)),row,{conflict:true});
    }finally{await db.release(id,lease);}
   }
   if(body.operation!=='transition'||!allow[row.role].includes(body.action?.type))return json({error:'이 화면에서 처리할 수 없는 작업입니다.'},403);
   if(row.role==='facility'&&body.action.id!==row.facility)return json({error:'해당 기관의 작업만 처리할 수 있습니다.'},403);
   const next=M.transition(row.state,body.action,row.role),saved=await db.commit(row,next,body.requestId);
   return saved?response(saved,row):response(await db.read(id,hashToken(key)),row,{conflict:true});
  }catch(e){
   if(e instanceof SyntaxError)return json({error:'요청 형식을 확인해 주세요.'},400);
   // Never return database errors, queries, connection strings or provider credentials.
   if(e.storageFailure||e.code||e instanceof TypeError||e.message==='DB_NOT_CONFIGURED'){console.warn('CareBridge shared storage unavailable');return json({error:'공유 기록을 저장하지 못했습니다. 기록은 변경하지 않았습니다. 다시 시도해 주세요.'},503);}
   return json({error:String(e.message||'요청을 처리하지 못했습니다.').slice(0,240)},422);
  }
 };
}
