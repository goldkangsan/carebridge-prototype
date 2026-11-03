import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import M from '../web/model.js';
import {createStore} from '../worker/database.mjs';
import {createCasesApi} from '../worker/cases.mjs';

let pg,store,api;
before(async()=>{
 pg=new PGlite();store=createStore({query:async(q,p)=>{const r=await pg.query(q,p);return r.rows;},batch:async qs=>pg.transaction(async tx=>{for(const q of qs)await tx.exec(q);})});
 await store.init();
 const agent=async r=>{const {state:s}=await r.json();return new Response(JSON.stringify({mode:'live',nextAction:M.agentAction(s),actionLabel:'검증용 자동 처리',recommendations:M.candidates(s).filter(f=>f.eligible).map(f=>({id:f.id})),inquiryDraft:['treatment','period','isolation'].map(k=>M.fields[k]+': '+s.data[k]).join('\n'),at:new Date().toISOString(),model:'test-only'}));};
 api=createCasesApi(M,{store,configured:()=>true,agent});
});
after(async()=>pg.close());
async function create(){const r=await api(new Request('https://demo.test/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'create',scenario:'normal'})}));assert.equal(r.status,200);return r.json();}
async function read(c,key='hospital'){const r=await api(new Request('https://demo.test/api/cases?id='+c.id,{headers:{Authorization:'Bearer '+c.credentials[key]}}));return {status:r.status,...await r.json()};}
async function post(c,key,body){const r=await api(new Request('https://demo.test/api/cases?id='+c.id,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.credentials[key]},body:JSON.stringify({revision:c.revision,requestId:randomUUID(),...body})}));const result=await r.json();if(r.ok&&result.revision!==undefined)c.revision=result.revision;return {status:r.status,...result};}
async function act(c,key,action){const r=await post(c,key,{operation:'transition',action});assert.equal(r.status,200,JSON.stringify(r));assert.ok(!r.conflict);return r;}
async function ready(c){await act(c,'hospital',{type:'attest',value:true});await act(c,'hospital',{type:'parse'});await act(c,'hospital',{type:'ready'});}

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
 assert.equal((await post(c,'patient',{operation:'advance'})).state.stage,2);
 const published=await post(c,'patient',{operation:'advance'});assert.equal(published.status,200);assert.equal(published.state.stage,3);
 await act(c,'patient',{type:'choose',id:'solbit',consent:true});
 const other=await read(c,'facility/saebom'),chosen=await read(c,'facility/solbit');assert.equal(other.state.data.drug,undefined);assert.equal(chosen.state.data.drug,'가상약 A');
 for(const key of ['documents','transport','guidance'])await act(c,'hospital',{type:'prep',key,value:true});await act(c,'hospital',{type:'handoff'});
 await act(c,'facility/solbit',{type:'visit',id:'solbit',result:'done'});const waiting=await read(c);assert.equal(waiting.state.stage,6);assert.equal(waiting.state.ack,false);
 const done=await act(c,'hospital',{type:'ack'});assert.equal(done.state.stage,7);
 assert.equal((await pg.query('SELECT count(*)::int n FROM cb_inquiries WHERE case_id=$1',[c.id])).rows[0].n,3);
 const consents=(await pg.query('SELECT kind,granted FROM cb_consents WHERE case_id=$1',[c.id])).rows;assert.deepEqual(consents.map(x=>x.kind).sort(),['inquiry','selected-facility']);assert.ok(consents.every(x=>x.granted));
 const newer=await create();assert.equal(newer.state.stage,0);assert.equal((await read(c)).state.stage,7);
});
test('다른 Origin·잘못된 ID·구성 없는 저장소 요청 차단',async()=>{
 const r=await api(new Request('https://demo.test/api/cases',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.test'},body:JSON.stringify({operation:'create',scenario:'normal'})}));assert.equal(r.status,403);
 const bad=await api(new Request("https://demo.test/api/cases?id=';DROP%20TABLE%20cb_cases;--",{headers:{Authorization:'Bearer '+'A'.repeat(43)}}));assert.equal(bad.status,401);
 const unavailable=createCasesApi(M,{configured:()=>false});assert.equal((await unavailable(new Request('https://demo.test/api/cases?status=1')).then(r=>r.json())).available,false);
 assert.equal((await unavailable(new Request('https://demo.test/api/cases'))).status,503);
});
test('명시적으로 선택한 기본 모드는 LLM 결과로 가장하지 않고 공유 상태를 진행',async()=>{
 const c=await create();await ready(c);await act(c,'patient',{type:'consent',value:true});
 await post(c,'patient',{operation:'advance',basic:true});const r=await post(c,'patient',{operation:'advance',basic:true});
 assert.equal(r.state.stage,3);assert.equal(r.state.automationMode,'basic');assert.equal(r.state.lastAgent,null);assert.equal(r.state.agentRuns.length,0);
});
