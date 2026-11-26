import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import M from '../web/model.js';
import {createStore} from '../worker/database.mjs';
import {createCasesApi} from '../worker/cases.mjs';
import {assistanceContext,validateAssistance} from '../worker/assistance.mjs';

let pg,store,api;
before(async()=>{
 pg=new PGlite();store=createStore({query:async(q,p)=>{const r=await pg.query(q,p);return r.rows;},batch:async qs=>pg.transaction(async tx=>{for(const q of qs)await tx.exec(q);})});
 await store.init();
 const agent=async r=>{const {state:s}=await r.json();return new Response(JSON.stringify({mode:'live',nextAction:M.agentAction(s),actionLabel:'검증용 자동 처리',recommendations:M.candidates(s).filter(f=>f.eligible).map(f=>({id:f.id})),inquiryDraft:['treatment','period','isolation'].map(k=>M.fields[k]+': '+s.data[k]).join('\n'),at:new Date().toISOString(),model:'test-only'}));};
 const assist=async s=>{const c=assistanceContext(M,s);return {...validateAssistance(c,{action:c.action,recommendations:c.ranked.map(f=>({id:f.id,reasonCodes:['treatment','distance']})),interpretations:c.responses.map(r=>({id:r.id,status:r.status,quote:r.text,focusCode:r.focusCodes[0]})),checkIds:c.checks.map(x=>x.id),draft:c.stage===1?'수용 문의\n'+c.requiredLines.join('\n')+'\n수용 가능 여부를 회신해 주세요.':''}),mode:'live',at:new Date().toISOString(),model:'test-only'};};
 api=createCasesApi(M,{store,configured:()=>true,agent,assist});
});
after(async()=>pg.close());
async function create(){const r=await api(new Request('https://demo.test/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'create',scenario:'normal'})}));assert.equal(r.status,200);return r.json();}
async function read(c,key='hospital'){const r=await api(new Request('https://demo.test/api/cases?id='+c.id,{headers:{Authorization:'Bearer '+c.credentials[key]}}));return {status:r.status,...await r.json()};}
async function post(c,key,body){const r=await api(new Request('https://demo.test/api/cases?id='+c.id,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.credentials[key]},body:JSON.stringify({revision:c.revision,requestId:randomUUID(),...body})}));const result=await r.json();if(r.ok&&result.revision!==undefined)c.revision=result.revision;return {status:r.status,...result};}
async function act(c,key,action){const r=await post(c,key,{operation:'transition',action});assert.equal(r.status,200,JSON.stringify(r));assert.ok(!r.conflict);return r;}
async function ready(c){await act(c,'hospital',{type:'attest',value:true});await act(c,'hospital',{type:'parse'});await act(c,'hospital',{type:'clinicalReview',confirmed:true,reviewer:'검증 담당자'});await act(c,'hospital',{type:'ready'});}

test('SQL에 독립 회송 건과 해시된 역할별 접근 권한 저장; 서버 재생성 후에도 유지',async()=>{
 const a=await create(),b=await create();assert.notEqual(a.id,b.id);assert.notEqual(a.state.caseId,b.state.caseId);
 assert.deepEqual((await read(a)).credentials,a.credentials);
 const rows=(await pg.query('SELECT token_hash,role FROM cb_access WHERE case_id=$1',[a.id])).rows;
 assert.equal(rows.length,7);assert.ok(rows.every(x=>x.token_hash.length===64&&!Object.values(a.credentials).includes(x.token_hash)));
 await act(a,'hospital',{type:'attest',value:true});const secondApi=createCasesApi(M,{store:createStore({query:async(q,p)=>(await pg.query(q,p)).rows,batch:async()=>{}}),configured:()=>true});
 const r=await secondApi(new Request('https://demo.test/api/cases?id='+a.id,{headers:{Authorization:'Bearer '+a.credentials.hospital}}));assert.equal((await r.json()).state.doctorApproved,true);assert.equal((await read(b)).state.doctorApproved,false);
});
test('링크 없이 읽기·다른 역할 변경·다른 기관의 회신을 서버에서 차단',async()=>{
 const c=await create();const unauth=await api(new Request('https://demo.test/api/cases?id='+c.id));assert.equal(unauth.status,401);
 assert.equal((await post(c,'patient',{operation:'transition',action:{type:'attest',value:true}})).status,403);
 assert.equal((await post(c,'facility/solbit',{operation:'transition',action:{type:'response',id:'saebom',status:'accepted'}})).status,403);
 const wrong=await api(new Request('https://demo.test/api/cases?id='+c.id,{headers:{Authorization:'Bearer '+'A'.repeat(43)}}));assert.equal(wrong.status,403);
 const r=await read(c,'patient');assert.equal(r.credentials,undefined);
});
test('중복 요청은 재처리하지 않고 동시 편집은 이전 기록을 덮어쓰지 않음',async()=>{
 const c=await create(),id=randomUUID(),request={operation:'transition',requestId:id,revision:0,action:{type:'attest',value:true}};
 const a=await post(c,'hospital',request),b=await post(c,'hospital',request);assert.equal(a.revision,1);assert.equal(b.revision,1);assert.equal(b.replayed,true);
 const conflict=await post(c,'hospital',{...request,requestId:randomUUID(),action:{type:'attest',value:false}});assert.equal(conflict.conflict,true);assert.equal(conflict.state.doctorApproved,true);
 const rows=(await pg.query('SELECT * FROM cb_events WHERE case_id=$1',[c.id])).rows;assert.equal(rows.length,1);
});
test('수용기관에는 동의 전 환자 식별명·약제·타 기관 응답을 전달하지 않음',async()=>{
 const c=await create();await ready(c);const f=await read(c,'facility/solbit');assert.equal(f.state.patient,'비식별 의뢰 대상자');assert.equal(f.state.data.drug,undefined);assert.ok(!f.state.source.includes('가상약'));assert.deepEqual(f.state.events,[]);assert.equal(f.state.lastAgent,null);
});
test('DB 공용 상태로 동의→문의→비교→선택→준비→첫 진료→의뢰기관 확인 수행',async()=>{
 const c=await create();await ready(c);await act(c,'patient',{type:'consent',value:true});
 await act(c,'hospital',{type:'send',ids:['solbit','daon']});
 await act(c,'facility/solbit',{type:'response',id:'solbit',status:'accepted'});
 const published=await act(c,'hospital',{type:'publish',pendingChoice:'close'});assert.equal(published.state.stage,3);
 await act(c,'patient',{type:'choose',id:'solbit',consent:true});
 const other=await read(c,'facility/daon'),chosen=await read(c,'facility/solbit');assert.equal(other.state.data.drug,undefined);assert.equal(chosen.state.data.drug,'가상약 A');
 for(const key of ['documents','transport','guidance'])await act(c,'hospital',{type:'prep',key,value:true});await act(c,'hospital',{type:'handoff'});
 await act(c,'facility/solbit',{type:'visit',id:'solbit',result:'done'});const waiting=await read(c);assert.equal(waiting.state.stage,6);assert.equal(waiting.state.ack,false);
 const done=await act(c,'hospital',{type:'ack'});assert.equal(done.state.stage,7);
 assert.equal((await pg.query('SELECT count(*)::int n FROM cb_inquiries WHERE case_id=$1',[c.id])).rows[0].n,2);
 const consents=(await pg.query('SELECT kind,granted FROM cb_consents WHERE case_id=$1',[c.id])).rows;assert.deepEqual(consents.map(x=>x.kind).sort(),['inquiry','selected-facility']);assert.ok(consents.every(x=>x.granted));
 const newer=await create();assert.equal(newer.state.stage,0);assert.equal((await read(c)).state.stage,7);
});
test('다른 Origin·잘못된 ID·구성 없는 저장소 요청 차단',async()=>{
 const r=await api(new Request('https://demo.test/api/cases',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.test'},body:JSON.stringify({operation:'create',scenario:'normal'})}));assert.equal(r.status,403);
 const bad=await api(new Request("https://demo.test/api/cases?id=';DROP%20TABLE%20cb_cases;--",{headers:{Authorization:'Bearer '+'A'.repeat(43)}}));assert.equal(bad.status,401);
 const unavailable=createCasesApi(M,{configured:()=>false});assert.equal((await unavailable(new Request('https://demo.test/api/cases?status=1')).then(r=>r.json())).available,false);
 assert.equal((await unavailable(new Request('https://demo.test/api/cases'))).status,503);
});
test('담당자가 고른 기관에만 문의가 생성되고 자동 진행이 회신이나 후보 안내를 대신하지 않음',async()=>{
 const c=await create();await ready(c);await act(c,'patient',{type:'consent',value:true});
 const unchanged=await post(c,'patient',{operation:'advance',basic:true});
 assert.equal(unchanged.state.stage,1);assert.deepEqual(unchanged.state.inquiries,[]);
 for(const ids of [undefined,[],['solbit','solbit'],['unknown'],['haeon']]){
  const invalid=await post(c,'hospital',{operation:'transition',action:{type:'send',ids}});
  assert.equal(invalid.status,422);
 }
 const sent=await act(c,'hospital',{type:'send',ids:['solbit','daon']});
 assert.deepEqual(sent.state.inquiries,['solbit','daon']);
 assert.equal((await read(c,'facility/saebom')).state.inquiries.length,0);
 const unwanted=await post(c,'facility/saebom',{operation:'transition',action:{type:'response',id:'saebom',status:'accepted'}});
 assert.equal(unwanted.status,422);
 await act(c,'facility/solbit',{type:'response',id:'solbit',status:'accepted'});
 const result=await post(c,'hospital',{operation:'advance'});
 assert.equal(result.state.stage,2);
 assert.deepEqual(Object.keys(result.state.responses),['solbit']);
});
test('자동 진행을 끈 공유 회송에서 수동 문의·기관 응답·후보 안내가 서버 권한과 일치',async()=>{const c=await create();await ready(c);await act(c,'patient',{type:'consent',value:true});assert.equal((await act(c,'hospital',{type:'send',ids:['saebom','solbit','daon']})).state.stage,2);await act(c,'facility/saebom',{type:'response',id:'saebom',status:'accepted',reason:'조건 확인'});assert.equal((await act(c,'hospital',{type:'publish',pendingChoice:'close'})).state.stage,3);});
test('발표자용 무응답·모의 응답은 의뢰기관만 현재 문의 단계에 기록',async()=>{const c=await create();assert.equal((await post(c,'hospital',{operation:'simulate',action:{type:'demoResponses'}})).status,422);await ready(c);await act(c,'patient',{type:'consent',value:true});await act(c,'hospital',{type:'send',ids:['saebom','solbit','daon']});assert.equal((await post(c,'patient',{operation:'simulate',action:{type:'timeout',id:'saebom'}})).status,403);assert.equal((await post(c,'facility/saebom',{operation:'simulate',action:{type:'demoResponses'}})).status,403);const timed=await post(c,'hospital',{operation:'simulate',action:{type:'timeout',id:'saebom'}});assert.equal(timed.state.responses.saebom.status,'timeout');assert.equal(timed.state.events[0].actor,'simulation');const rest=await post(c,'hospital',{operation:'simulate',action:{type:'demoResponses'}});assert.equal(rest.status,200);assert.equal(rest.state.responses.saebom.status,'timeout');assert.equal(rest.state.responses.solbit.status,'accepted');});


test('DB AI 분석은 의뢰기관만 요청하고 초안·회신 근거를 저장하며 상태와 기관 응답을 바꾸지 않음',async()=>{
 const c=await create();await ready(c);
 assert.equal((await post(c,'hospital',{operation:'assist'})).status,422);
 await act(c,'patient',{type:'consent',value:true});
 assert.equal((await post(c,'patient',{operation:'assist'})).status,403);
 let r=await post(c,'hospital',{operation:'assist'});assert.equal(r.status,200);assert.equal(r.state.stage,1);assert.deepEqual(r.state.inquiries,[]);assert.ok(r.state.assistance.draft);
 const revision=r.revision;r=await post(c,'hospital',{operation:'assist'});assert.equal(r.revision,revision);
 const declined=await post(c,'hospital',{operation:'transition',action:{type:'send',ids:['saebom','daon']}});assert.equal(declined.status,422);
 await act(c,'hospital',{type:'send',ids:['saebom','daon'],draftConfirmed:true});
 await act(c,'facility/daon',{type:'response',id:'daon',status:'more',reason:'산소 공급량 확인 필요'});
 const before=await read(c);r=await post(c,'hospital',{operation:'assist'});assert.equal(r.status,200);assert.equal(r.state.stage,2);assert.deepEqual(r.state.responses,before.state.responses);assert.equal(r.state.assistance.interpretations[0].quote,'산소 공급량 확인 필요');assert.equal(r.state.assistanceRuns.length,2);
 const receiver=await read(c,'facility/daon');assert.equal(receiver.state.assistance,null);assert.deepEqual(receiver.state.assistanceRuns,[]);assert.ok(receiver.state.inquiryDraft.includes('필요 처치:'));assert.ok(!receiver.state.inquiryDraft.includes('가상약'));assert.equal(receiver.state.sentInquiryDraft,'');
});
test('분석 중 다른 화면이 회신하면 오래된 분석을 저장하지 않고 최신 기록을 반환',async()=>{
 const c=await create();await ready(c);await act(c,'patient',{type:'consent',value:true});await act(c,'hospital',{type:'send',ids:['saebom']});
 let entered,finish;const started=new Promise(r=>entered=r),gate=new Promise(r=>finish=r);
 const slowApi=createCasesApi(M,{store,configured:()=>true,assist:async s=>{entered();await gate;return {mode:'live',action:M.assistanceAction(s),actionText:'확인',at:new Date().toISOString(),recommendations:[],interpretations:[],checks:[],draft:''};}});
 const analysis=slowApi(new Request('https://demo.test/api/cases?id='+c.id,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.credentials.hospital},body:JSON.stringify({operation:'assist',revision:c.revision,requestId:randomUUID()})}));await started;
 await act(c,'facility/saebom',{type:'response',id:'saebom',status:'accepted'});finish();const response=await(await analysis).json();assert.equal(response.conflict,true);assert.equal(response.state.responses.saebom.status,'accepted');assert.equal(response.state.assistance,undefined);
});


test('AI 분석만 갱신된 경우 기관 회신 입력은 유지하며 해당 기관의 실제 회신 변경은 충돌로 보호',async()=>{
 const c=await create();await ready(c);await act(c,'patient',{type:'consent',value:true});await act(c,'hospital',{type:'send',ids:['saebom']});
 const old=await read(c,'facility/saebom'),viewKey=M.assistanceKey(old.state);await post(c,'hospital',{operation:'assist'});
 const accepted=await post(c,'facility/saebom',{operation:'transition',revision:old.revision,viewKey,action:{type:'response',id:'saebom',status:'accepted',reason:'수용 가능'}});
 assert.equal(accepted.status,200);assert.ok(!accepted.conflict);assert.equal(accepted.state.responses.saebom.status,'accepted');
 const conflict=await post(c,'facility/saebom',{operation:'transition',revision:old.revision,viewKey,action:{type:'response',id:'saebom',status:'rejected',reason:'과거 화면의 변경'}});
 assert.equal(conflict.conflict,true);assert.equal(conflict.state.responses.saebom.status,'accepted');
});

test('SQL 재매칭은 기관별 거절 조건을 보존하고 후보 제외와 확인자 기록을 서버에서 강제',async()=>{
 const c=await create();await ready(c);await act(c,'hospital',{type:'consultation',person:'patient',recorder:'QA',confirmed:true,roomType:'single'});
 await act(c,'hospital',{type:'send',ids:['saebom','solbit','daon']});
 await act(c,'facility/saebom',{type:'response',id:'saebom',status:'rejected',reason:'처치 인력 부족',reasonCode:'treatment'});
 await act(c,'facility/solbit',{type:'response',id:'solbit',status:'rejected',reason:'희망 일정 불가',reasonCode:'schedule'});
 await act(c,'facility/daon',{type:'response',id:'daon',status:'rejected',reason:'1인실 불가',reasonCode:'room'});
 const changed=await act(c,'hospital',{type:'research',reason:'거절 사유 반영',date:'2099-12-02',roomType:'single'});
 assert.equal(M.candidates(changed.state).find(f=>f.id==='saebom').eligible,false);assert.equal(M.candidates(changed.state).find(f=>f.id==='solbit').eligible,true);assert.equal(M.candidates(changed.state).find(f=>f.id==='daon').eligible,false);
 assert.equal(changed.state.roundHistory[0].responses.daon.reasonCode,'room');assert.equal(changed.state.matchingFeedback.length,3);
 assert.equal((await read(c,'facility/saebom')).state.matchingFeedback.length,0);assert.equal((await read(c,'facility/saebom')).state.adaptationHistory.length,0);
 assert.equal((await post(c,'patient',{operation:'transition',action:{type:'clearDecline',id:'saebom',confirmed:true,reviewer:'QA',note:'변경'}})).status,403);
 await act(c,'hospital',{type:'consultation',person:'patient',recorder:'QA',confirmed:true,roomType:'single'});
 const invalid=await post(c,'hospital',{operation:'transition',action:{type:'send',ids:['saebom'],confirmRepeat:true}});assert.equal(invalid.status,422);
 const resolution=await act(c,'hospital',{type:'clearDecline',id:'saebom',confirmed:true,reviewer:'기관 연락 확인자',note:'새 처치 인력이 확보되어 다시 검토 가능하다고 기관에서 확인'});
 assert.equal(resolution.state.consent,false);assert.equal(resolution.state.matchingFeedback.find(f=>f.id==='saebom').resolved.reviewer,'기관 연락 확인자');
 const reread=await read(c);assert.equal(M.candidates(reread.state).find(f=>f.id==='saebom').eligible,true);assert.equal(reread.state.fieldHistory.at(-1).reviewer,'기관 연락 확인자');
});
