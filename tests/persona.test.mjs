import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import M from '../web/model.js';import U from '../web/ux.js';import {projectState} from '../worker/cases.mjs';
const local=ms=>new Date(ms+9*3600000).toISOString().slice(0,16),today=local(Date.now()).slice(0,10),offer={when:local(Date.now()-3600000),venue:'접수처',address:'합성 주소 100',contact:'',notes:'회송 서류 지참'};
function inquiry(){let s=M.initial();s.requiresCoordination=true;s.requiresSchedule=true;for(const action of [{type:'attest',value:true},{type:'parse'},{type:'requestDetails',values:{date:today,kind:'inpatient'}},{type:'clinicalReview',confirmed:true,reviewer:'검증 담당자'},{type:'ready'}])s=M.transition(s,action);s=M.transition(s,{type:'consent',value:true},'patient');return M.transition(s,{type:'send',ids:M.candidates(s).filter(f=>f.eligible).map(f=>f.id)});}
function chosen(){let s=inquiry();s=M.transition(s,{type:'response',id:'saebom',status:'accepted',offer},'facility');s=M.transition(s,{type:'publish',pendingChoice:'close'});return M.transition(s,{type:'choose',id:'saebom',consent:true},'patient');}
function prepared(){let s=chosen();s=M.transition(s,{type:'transferPlan',values:{...s.transferPlan,confirmed:true}});for(const key of Object.keys(s.prep))s=M.transition(s,{type:'prep',key,value:true});return M.transition(s,{type:'handoff'});}
test('부분 보완 요청은 다른 기관 미응답·수용 가능 여부와 관계없이 즉시 의뢰기관 업무가 됨',()=>{let s=inquiry();s=M.transition(s,{type:'response',id:'daon',status:'more',reason:'시작일 확인'},'facility');for(const accepted of [false,true]){const c={...s,...(accepted?{responses:{...s.responses,saebom:{status:'accepted'}}}:{})};const w=U.workItem(c,'hospital');assert.equal(w.actionable,true);assert.equal(w.owner,'의뢰기관');assert.match(w.next,/보완/);assert.equal(U.nextTask(c,'hospital',{auto:true}).action,'more-info');}});
test('수용기관 보완 회신 도착을 다음 작업으로 안내하고 원 요청을 보관',()=>{let s=inquiry();s=M.transition(s,{type:'response',id:'daon',status:'more',reason:'시작일 확인'},'facility');s=M.transition(s,{type:'provideInfo',id:'daon',note:'담당의 확인 완료',confirmed:true});assert.equal(s.inquiryRequests.daon,'시작일 확인');assert.equal(U.nextTask(s,'facility',{facility:'daon'}).title,'새 보완 회신이 도착했습니다.');assert.equal(U.workItem(s,'hospital').actionable,false);});
test('의뢰 일정은 달력 날짜·수용 형태를 검증하고 새 문의 전에 요구',()=>{assert.equal(M.requestValid({date:'2026-02-30',kind:'inpatient'}),false);assert.equal(M.requestValid({date:today,kind:'other'}),false);let s=M.initial();s.requiresCoordination=true;s=M.transition(M.transition(s,{type:'attest',value:true}),{type:'parse'});assert.throws(()=>M.transition(s,{type:'ready'}),/희망 전원일/);assert.deepEqual(M.facilityRequest(inquiry(),'saebom').referralRequest,{date:today,kind:'inpatient'});});
test('수용 회신에 구조화된 방문 안내를 요구하고 선택 후 미확인 초안으로 전달',()=>{const s=inquiry();assert.throws(()=>M.transition(s,{type:'response',id:'saebom',status:'accepted'},'facility'),/일시·접수/);const c=chosen();assert.equal(c.transferPlan.when,offer.when);assert.equal(c.transferPlan.fromFacility,'saebom');assert.equal(c.transferPlan.confirmed,false);assert.equal(M.scheduleValid(c),false);});
test('기관 안내가 자동 채워져도 의뢰기관 확인·준비 전에는 전달되지 않음',()=>{let s=chosen();for(const key of Object.keys(s.prep))s=M.transition(s,{type:'prep',key,value:true});assert.throws(()=>M.transition(s,{type:'handoff'}),/방문 일정/);s=M.transition(s,{type:'transferPlan',values:{...s.transferPlan,confirmed:true}});assert.equal(s.prep.transport,false);assert.equal(s.prep.guidance,false);assert.equal(prepared().stage,5);});
test('미래 실제 진료·실제시각 누락은 서버 상태 전환에서도 차단',()=>{const s=prepared();assert.throws(()=>M.transition(s,{type:'visit',id:'saebom',result:'done'},'facility'),/실제 첫 진료/);assert.throws(()=>M.transition(s,{type:'visit',id:'saebom',result:'done',visitedAt:local(Date.now()+86400000)},'facility'),/미래/);});
test('예정일보다 앞선 실제 진료는 변경 확인·사유를 요구하고 실제일과 회신일을 분리',()=>{const s=prepared();s.transferPlan.when=local(Date.now()+86400000);const action={type:'visit',id:'saebom',result:'done',visitedAt:local(Date.now()-60000)};assert.throws(()=>M.transition(s,action,'facility'),/일정 변경/);assert.throws(()=>M.transition(s,{...action,scheduleChanged:true},'facility'),/사유/);const v=M.transition(s,{...action,scheduleChanged:true,note:'일정 앞당김 확인'},'facility');assert.equal(v.visit.visitedAt,action.visitedAt);assert.equal(v.visit.scheduleChanged,true);assert.equal(M.transition(v,{type:'ack'}).stage,7);});
test('다른 기관에 방문 안내·개인정보·타기관 보완 요청을 공개하지 않음',()=>{const c=chosen();c.inquiryRequests={saebom:'자기관 요청',daon:'타기관 요청'};const own=projectState(M,c,{role:'facility',facility:'saebom'}),other=projectState(M,c,{role:'facility',facility:'daon'});assert.equal(own.transferPlan.when,offer.when);assert.equal(other.transferPlan,null);assert.equal(other.inquiryRequests.saebom,undefined);});
test('대기 시간은 실제 단계 시작 기준이며 기한 초과로 단정하지 않음',()=>{const now=Date.now(),c={stage_since:new Date(now-26*3600000).toISOString(),updated_at:new Date(now).toISOString()};assert.equal(U.waitState(c,now).long,true);assert.match(U.waitState(c,now).text,/1일 경과/);assert.equal(U.waitState({},now).minutes,null);});
test('같은 탭에서 목록 링크 변경시 새 권한으로 조회하고 늦은 이전 결과는 폐기',async()=>{const source=await readFile(new URL('../web/patient-register.js',import.meta.url),'utf8'),requests=[],storage=new Map();let release;const context={URLSearchParams,AbortSignal,location:{hash:'#register=A&registerAccess=key-A'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:async(url,opt)=>{requests.push({url,access:opt.headers.Authorization});if(url.includes('register=A'))return new Promise(resolve=>{release=()=>resolve(Response.json({patients:[{name:'이전 목록'}]}));});return Response.json({patients:[{name:'새 목록'}]});}};vm.runInNewContext(source,context);const P=context.CareBridgePatients,old=P.search('김');await new Promise(resolve=>setImmediate(resolve));context.location.hash='#register=B&registerAccess=key-B';assert.equal(P.sync(),true);const current=await P.search('김');release();await assert.rejects(old,/목록이 바뀌었습니다/);assert.equal(current.patients[0].name,'새 목록');assert.equal(requests.at(-1).access,'Bearer key-B');});

test('합성 기관 연결도 희망일을 받아 구조화된 제안 일정을 회신하고 선택까지 유지',async()=>{const {createFacilityApi}=await import('../worker/agents.mjs');const s=inquiry();s.inquiryDraft=['treatment','period','isolation'].map(k=>M.fields[k]+': '+s.data[k]).join('\n');const query=M.facilityRequest(s,'saebom'),r=await createFacilityApi(M)(new Request('http://localhost/api/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})}));assert.equal(r.status,200);const {receipt}=await r.json();assert.equal(receipt.offer.when,today+'T10:00');let next=M.transition(s,{type:'receipt',receipt},'simulation');next=M.transition(next,{type:'publish',pendingChoice:'close'});next=M.transition(next,{type:'choose',id:'saebom',consent:true},'patient');assert.equal(next.transferPlan.when,receipt.offer.when);assert.equal(next.transferPlan.confirmed,false);});
test('의뢰 일정에 범위 밖 개인정보 필드를 붙이면 연결에서 거절',async()=>{const {createFacilityApi}=await import('../worker/agents.mjs');const query=M.facilityRequest(inquiry(),'saebom');query.referralRequest.name='범위 밖 이름';const r=await createFacilityApi(M)(new Request('http://localhost/api/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})}));assert.equal(r.status,422);});

test('참조·모름은 미확정으로 표시되고 원 처방 확인 전 다음 단계 차단',()=>{
 let s=M.transition(M.transition(M.initial(),{type:'attest',value:true}),{type:'parse'});
 assert.deepEqual(M.unresolved(s),['dose','interval']);
 s.data.interval='모름';
 assert.throws(()=>M.transition(s,{type:'ready'}),/미확정/);
 assert.throws(()=>M.transition(s,{type:'clinicalReview',confirmed:false,reviewer:'담당자'}),/원 처방/);
 s=M.transition(s,{type:'clinicalReview',confirmed:true,reviewer:'담당자'});
 assert.equal(M.transition(s,{type:'ready'}).stage,1);
 s.data.interval='값 변경';assert.equal(M.clinicalReviewed(s),false);
});
test('모름을 보완값으로 제출할 수 없으며 변경 전후와 확인자를 보존',()=>{
 let s=M.transition(M.transition(M.initial(),{type:'attest',value:true}),{type:'parse'});
 assert.throws(()=>M.transition(s,{type:'supplement',confirmed:true,values:{dose:'모름',interval:'확인값'}}),/확인된 값/);
 s=M.transition(s,{type:'supplement',confirmed:true,reviewer:'원 처방 확인자',values:{dose:'합성 용량 값 A',interval:'합성 간격 값 B'}});
 assert.equal(M.unresolved(s).length,0);assert.equal(s.fieldHistory[0].changes.length,2);assert.equal(s.fieldHistory[0].reviewer,'원 처방 확인자');
 assert.match(s.fieldHistory[0].changes[0].before,/참조/);
});
test('과거 희망일은 신규 저장과 발송에서 차단하고 기존 날짜 형식은 조회 가능',()=>{
 const past=local(Date.now()-86400000).slice(0,10);let s=M.initial();
 assert.equal(M.requestValid({date:past,kind:'inpatient'}),true);
 assert.throws(()=>M.transition(s,{type:'requestDetails',values:{date:past,kind:'inpatient'}}),/오늘 이후/);
 s=inquiry();s.stage=1;s.referralRequest.date=past;
 assert.throws(()=>M.transition(s,{type:'send',ids:['saebom']}),/날짜/);
});
test('상담 기록으로 기관 문의 동의를 남기며 보호자 권한 확인을 요구',()=>{
 let s=inquiry();s.stage=1;s.inquiries=[];s.consent=false;
 const a={type:'consultation',person:'representative',relationship:'자녀',recorder:'기록자',confirmed:true};
 assert.throws(()=>M.transition(s,a),/권한/);
 s=M.transition(s,{...a,authorityConfirmed:true});assert.equal(s.consent,true);assert.equal(s.consultation.person,'representative');assert.ok(s.consultation.at);
 assert.equal(M.transition(s,{type:'send',ids:['saebom']}).stage,2);
});
test('대기·보완 기관 제외를 명시해야 후보 안내하며 종료된 기관의 재응답 차단',()=>{
 let s=inquiry();s=M.transition(s,{type:'response',id:'saebom',status:'accepted',offer},'facility');
 s=M.transition(s,{type:'response',id:'daon',status:'more',reason:'일정 확인'},'facility');
 assert.throws(()=>M.transition(s,{type:'publish'}),/제외/);
 s=M.transition(s,{type:'publish',pendingChoice:'close'});
 assert.equal(s.responses.daon.status,'withdrawn');assert.equal(s.responseHistory.find(h=>h.id==='daon').response.reason,'일정 확인');
 s.stage=2;assert.throws(()=>M.transition(s,{type:'response',id:'daon',status:'accepted',offer},'facility'),/종료/);
});
test('일정 문제는 날짜를 바꿔 재문의하고 회차별 거절·방문 기록을 보존',()=>{
 let s=inquiry();s=M.transition(s,{type:'response',id:'saebom',status:'rejected',reason:'희망일 불가',reasonCode:'schedule'},'facility');
 const tomorrow=local(Date.now()+86400000).slice(0,10);
 s=M.transition(s,{type:'research',date:tomorrow,reason:'희망일 변경'});
 assert.equal(s.roundHistory.length,1);assert.equal(s.roundHistory[0].responses.saebom.reasonCode,'schedule');assert.equal(s.referralRequest.date,tomorrow);assert.equal(s.expanded,false);assert.equal(s.consent,false);
 assert.equal(M.previousInquiry(s,'saebom').sameConditions,false);
});
test('같은 조건 재문의는 이전 거절 확인을 요구',()=>{
 let s=inquiry();s=M.transition(s,{type:'response',id:'saebom',status:'rejected',reason:'병상 없음',reasonCode:'beds'},'facility');
 s=M.transition(s,{type:'research',reason:'다시 확인'});s=M.transition(s,{type:'consent',value:true},'patient');
 assert.throws(()=>M.transition(s,{type:'send',ids:['saebom'],confirmRepeat:true}),/문의 가능한/);
 s=M.transition(s,{type:'clearDecline',id:'saebom',confirmed:true,reviewer:'확인 담당자',note:'기관과 새 병상 여건 확인'});s=M.transition(s,{type:'consent',value:true},'patient');
 assert.throws(()=>M.transition(s,{type:'send',ids:['saebom']}),/이전 거절/);
 assert.equal(M.transition(s,{type:'send',ids:['saebom'],confirmRepeat:true}).stage,2);
});
test('상태 변화로 미이행한 건은 담당의 재확인 뒤 정보 확인으로 돌아감',()=>{
 let s=M.transition(prepared(),{type:'visit',id:'saebom',result:'missed',note:'상태 변화'},'facility');
 assert.throws(()=>M.transition(s,{type:'relink',confirmed:true,reasonType:'condition'}),/담당의/);
 s=M.transition(s,{type:'relink',confirmed:true,reasonType:'condition',physicianConfirmed:true});
 assert.equal(s.stage,0);assert.equal(s.doctorApproved,false);assert.equal(s.roundHistory.at(-1).visit.note,'상태 변화');
});
test('수용기관 투영에는 미확정 항목명만 포함하고 타 기관 이력·확인자 정보 제외',()=>{
 const s=inquiry();s.fieldHistory=[{reviewer:'담당자',changes:[]}];s.roundHistory=[{responses:{daon:{reason:'타기관 응답'}}}];
 const f=projectState(M,s,{role:'facility',facility:'saebom'}),sum=M.summary(f,'saebom');
 assert.deepEqual(sum.unresolvedFields,['용량','투여 간격']);assert.equal(f.data.dose,undefined);assert.deepEqual(f.roundHistory,[]);assert.deepEqual(f.fieldHistory,[]);assert.equal(f.clinicalReview,null);
});
test('기관 기본 접수 안내 저장은 기존 등록 역량을 보존하고 회신에 재사용',()=>{
 const s=M.transition(inquiry(),{type:'facilityContact',id:'saebom',values:{venue:'본관 접수',address:'합성 주소',contact:'02-0000-0000',notes:'서류 지참'}},'facility');
 const f=M.candidates(s).find(f=>f.id==='saebom');assert.equal(f.iv,true);assert.equal(f.address,'합성 주소');assert.equal(f.beds,2);
});
