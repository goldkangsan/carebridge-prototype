import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import M from '../web/model.js';
import {schema} from '../worker/schema.mjs';
import {createStore} from '../worker/database.mjs';
import {createPatientsApi} from '../worker/patients.mjs';
import {createCasesApi} from '../worker/cases.mjs';
import {canonicalState,planContext} from '../worker/agents.mjs';
let pg,store,patients,cases,legacyId;
before(async()=>{
 pg=new PGlite();await pg.exec(schema.find(q=>q.startsWith('CREATE TABLE IF NOT EXISTS cb_cases')));
 legacyId=randomUUID();await pg.query('INSERT INTO cb_cases(id,state) VALUES($1,$2)',[legacyId,JSON.stringify(M.initial())]);
 store=createStore({query:async(q,p)=>(await pg.query(q,p)).rows,batch:async qs=>pg.transaction(async tx=>{for(const q of qs)await tx.exec(q);})});
 await store.init();patients=createPatientsApi({store,configured:()=>true});cases=createCasesApi(M,{store,configured:()=>true});
});
after(()=>pg.close());
async function patientRequest(register,body){const r=await patients(new Request('https://demo.test/api/patients'+(register?'?register='+register.id:''),{method:'POST',headers:{'Content-Type':'application/json',...(register?{Authorization:'Bearer '+register.access}:{})},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};}
const newRegister=async()=>(await patientRequest(null,{operation:'create-register'})).register;
async function newCase(selection){const r=await cases(new Request('https://demo.test/api/cases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'create',scenario:'normal',requiresPatient:true,...(selection?{patientSelection:selection}:{})})}));return {status:r.status,...await r.json()};}
async function action(c,key,body){const r=await cases(new Request('https://demo.test/api/cases?id='+c.id,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.credentials[key]},body:JSON.stringify({revision:c.revision,requestId:randomUUID(),...body})}));const x=await r.json();if(r.ok)c.revision=x.revision;return {status:r.status,...x};}
const select=(r,id)=>({registerId:r.id,access:r.access,patientId:id});

test('기존 회송 기록을 보존하면서 환자 테이블과 외래키 추가',async()=>{
 const row=(await pg.query('SELECT state,register_id,patient_id FROM cb_cases WHERE id=$1',[legacyId])).rows[0];assert.equal(row.state.caseId,'CB-026-001');assert.equal(row.patient_id,null);assert.equal(row.register_id,null);
});
test('목록별 환자 격리·권한 검사·이름 및 환자번호 검색',async()=>{
 const a=await newRegister(),b=await newRegister();const all=await patientRequest(a,{operation:'search',query:'CB-P'});assert.equal(all.patients.length,3);
 assert.equal((await patientRequest(a,{operation:'search',query:'하늘'})).patients[0].number,'CB-P1001');
 assert.equal((await patientRequest(a,{operation:'search',query:'cb-p1002'})).patients[0].name,'박서준');
 assert.equal((await patientRequest({...a,access:b.access},{operation:'search',query:'CB-P'})).status,403);
 const other=(await patientRequest(b,{operation:'search',query:'CB-P'})).patients[0];assert.equal((await patientRequest(a,{operation:'detail',patientId:other.id})).status,404);
 assert.equal((await patientRequest(null,{operation:'search',query:'CB-P'})).status,401);
 assert.equal((await patientRequest(a,{operation:'search',query:'%'})).patients.length,0);
});
test('빈 검색어로 환자 목록을 노출하지 않음',async()=>{
 const r=await newRegister();
 for(const query of ['', '   ']){
  const response=await patientRequest(r,{operation:'search',query});
  assert.equal(response.status,200);assert.deepEqual(response.patients,[]);
 }
 assert.deepEqual(await store.searchPatients(r.id,''),[]);
});
test('환자 등록·선택 정보 조회·중복 환자번호와 잘못된 입력 차단',async()=>{
 const r=await newRegister(),p={name:'홍예시',number:'cb-new-21',age:'80대',contact:'010-0000-0000'};
 const first=await patientRequest(r,{operation:'register',patient:p});assert.equal(first.status,201);assert.equal(first.patient.number,'CB-NEW-21');
 const duplicate=await patientRequest(r,{operation:'register',patient:{...p,name:'다른이름'}});assert.equal(duplicate.status,409);
 const detail=await patientRequest(r,{operation:'detail',patientId:first.patient.id});assert.equal(detail.patient.name,'홍예시');assert.equal(detail.patient.contact,p.contact);
 assert.equal((await patientRequest(r,{operation:'register',patient:{...p,number:'CB-NEW-22',contact:'invalid'}})).status,422);
 assert.equal((await patientRequest(r,{operation:'register',patient:{...p,number:"';DROP TABLE cb_patients;--"}})).status,422);
 assert.equal((await patientRequest(r,{operation:'register',patient:{...p,name:'<script>'}})).status,422);
});
test('새 회송에서 대상 환자 확인 필수·권한 확인 후 기본 정보 불러오기',async()=>{
 const r=await newRegister(),p=(await patientRequest(r,{operation:'search',query:'CB-P1002'})).patients[0],c=await newCase();
 assert.equal((await action(c,'hospital',{operation:'transition',action:{type:'attest',value:true}})).status,422);
 assert.equal((await action(c,'patient',{operation:'assign-patient',patientSelection:select(r,p.id)})).status,403);
 const wrong=await newRegister();assert.equal((await action(c,'hospital',{operation:'assign-patient',patientSelection:select(wrong,p.id)})).status,403);
 const attached=await action(c,'hospital',{operation:'assign-patient',patientSelection:select(r,p.id)});assert.equal(attached.state.patient,p.name);assert.equal(attached.state.age,'60대');assert.equal(attached.state.patientRecord.number,'CB-P1002');
 await action(c,'hospital',{operation:'transition',action:{type:'attest',value:true}});
 assert.equal((await action(c,'hospital',{operation:'assign-patient',patientSelection:select(r,p.id)})).status,422);
});
test('한 환자를 여러 회송에 연결하고 이력을 DB에서 조회·목록 토큰은 회송에 노출하지 않음',async()=>{
 const r=await newRegister(),p=(await patientRequest(r,{operation:'search',query:'CB-P1001'})).patients[0];const a=await newCase(select(r,p.id)),b=await newCase(select(r,p.id));assert.notEqual(a.id,b.id);
 const d=await patientRequest(r,{operation:'detail',patientId:p.id});assert.equal(d.cases.length,2);
 const rows=(await pg.query('SELECT patient_id,register_id,state FROM cb_cases WHERE id=$1',[a.id])).rows[0];assert.equal(rows.patient_id,p.id);assert.equal(rows.register_id,r.id);assert.ok(!JSON.stringify(rows.state).includes(r.access));
 const unauthorized=await patientRequest({id:r.id,access:a.credentials.patient},{operation:'search',query:'CB-P'});assert.equal(unauthorized.status,403);
});
test('확인 전 대상 환자를 바꾸면 이전 환자의 편집 회송서를 이어 쓰지 않음',async()=>{
 const r=await newRegister(),rows=(await patientRequest(r,{operation:'search',query:'CB-P'})).patients,c=await newCase(select(r,rows[0].id));
 await action(c,'hospital',{operation:'transition',action:{type:'source',value:M.initial().source+'\n이전 환자의 메모'}});
 const changed=await action(c,'hospital',{operation:'assign-patient',patientSelection:select(r,rows[1].id)});
 assert.equal(changed.state.patient,rows[1].name);assert.equal(changed.state.source,M.initial().source);assert.equal(changed.state.parsed,false);assert.equal(changed.state.doctorApproved,false);
});
test('기관 선택·동의 전 환자번호·연락처를 서버 응답에서 제거; 연령대만 비식별 문의에 반영',async()=>{
 const r=await newRegister(),p=(await patientRequest(r,{operation:'register',patient:{name:'홍예시',number:'CB-SAFE-1',age:'80대',contact:'010-0000-0000'}})).patient,c=await newCase(select(r,p.id));
 const read=await cases(new Request('https://demo.test/api/cases?id='+c.id,{headers:{Authorization:'Bearer '+c.credentials['facility/saebom']}})),f=await read.json();assert.equal(f.state.patientRecord,undefined);assert.equal(f.state.patient,'비식별 의뢰 대상자');assert.ok(!JSON.stringify(f).includes('010-0000-0000'));
 await action(c,'hospital',{operation:'transition',action:{type:'attest',value:true}});await action(c,'hospital',{operation:'transition',action:{type:'parse'}});const ready=await action(c,'hospital',{operation:'transition',action:{type:'ready'}});
 const canonical=canonicalState(M,ready.state),context=JSON.stringify(planContext(M,canonical));assert.ok(!context.includes(p.name));assert.ok(!context.includes(p.number));assert.ok(!context.includes(p.contact));assert.equal(canonical.age,'80대');
 await action(c,'patient',{operation:'transition',action:{type:'consent',value:true}});await action(c,'patient',{operation:'advance',basic:true});const published=await action(c,'patient',{operation:'advance',basic:true});assert.equal(published.status,200);assert.equal(published.state.stage,3);
 await action(c,'patient',{operation:'transition',action:{type:'choose',id:'saebom',consent:true}});
 const selected=await cases(new Request('https://demo.test/api/cases?id='+c.id,{headers:{Authorization:'Bearer '+c.credentials['facility/saebom']}})).then(r=>r.json());assert.equal(selected.state.patientRecord.contact,p.contact);assert.equal(selected.state.patientRecord.number,p.number);assert.equal(selected.state.patientRecord.registerId,undefined);
 const unselected=await cases(new Request('https://demo.test/api/cases?id='+c.id,{headers:{Authorization:'Bearer '+c.credentials['facility/solbit']}})).then(r=>r.json());assert.equal(unselected.state.patientRecord,undefined);
});
