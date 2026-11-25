import test from 'node:test';
import assert from 'node:assert/strict';
import M from '../web/model.js';
import {assistanceContext,validateAssistance,createAssistance,deidentify} from '../worker/assistance.mjs';

const ready=()=>{let s=M.initial();for(const a of [{type:'attest',value:true},{type:'parse'},{type:'clinicalReview',confirmed:true,reviewer:'QA'},{type:'ready'}])s=M.transition(s,a);return M.transition(s,{type:'consent',value:true},'patient');};
export const output=c=>({action:c.action,recommendations:c.ranked.map(f=>({id:f.id,reasonCodes:['treatment','distance','budget']})),interpretations:c.responses.map(r=>({id:r.id,status:r.status,quote:r.text,focusCode:r.focusCodes[0]})),checkIds:c.checks.map(x=>x.id),draft:c.stage===1?'비식별 수용 문의\n'+c.requiredLines.join('\n')+(c.requestedDate?'\n희망 전원일: '+c.requestedDate:'')+'\n수용 가능 여부와 추가 정보를 회신해 주세요.':''});
const mock=mutate=>async(url,options)=>{const c=JSON.parse(JSON.parse(options.body).messages[1].content),o=output(c);mutate?.(o,c);return Response.json({choices:[{message:{content:JSON.stringify(o)}}]});};
const env={GEMINI_API_KEY:'fake-test-token-only'};

test('수동 문의 지원은 미회신을 만들거나 후보를 자동 선택하지 않음',async()=>{
 let s=ready(),original=structuredClone(s);const a=await createAssistance(M,{env,upstreamFetch:mock()})(s);
 assert.equal(a.mode,'live');assert.equal(a.action,'choose_institutions');assert.ok(a.recommendations.length);assert.deepEqual(s,original);
 s.assistance={...a,inputKey:M.assistanceKey(s)};
 assert.throws(()=>M.transition(s,{type:'send',ids:['saebom']}),/초안/);
 s=M.transition(s,{type:'send',ids:['saebom'],draftConfirmed:true});
 assert.deepEqual(s.inquiries,['saebom']);assert.deepEqual(s.responses,{});assert.equal(s.sentInquiryDraft,a.draft);assert.equal(s.stage,2);
 const b=await createAssistance(M,{env,upstreamFetch:mock()})(s);assert.equal(b.action,'await_replies');assert.equal(b.draft,'');assert.deepEqual(b.interpretations,[]);
});
test('수용기관이 실제 입력한 회신만 인용하고 추가 정보 요청을 수용으로 바꾸지 않음',()=>{
 let s=M.transition(ready(),{type:'send',ids:['saebom','daon']});
 s=M.transition(s,{type:'response',id:'daon',status:'more',reason:'산소 공급량 확인이 필요합니다.'},'facility');
 const c=assistanceContext(M,s),o=output(c),v=validateAssistance(c,o);
 assert.equal(c.action,'provide_information');assert.equal(v.interpretations[0].quote,'산소 공급량 확인이 필요합니다.');assert.equal(v.interpretations[0].status,'more');
 o.interpretations[0].status='accepted';assert.throws(()=>validateAssistance(c,o),/인용/);
 const invented=output(c);invented.interpretations[0].quote='수용 가능합니다';assert.throws(()=>validateAssistance(c,invented),/인용/);
 const focus=output(c);focus.interpretations[0].focusCode='beds';assert.throws(()=>validateAssistance(c,focus),/인용/);
});
test('상태·선택 기관·원문·등록 조건이 바뀌면 기존 AI 근거는 즉시 무효화',()=>{
 let s=ready();const key=M.assistanceKey(s);s.assistance={inputKey:key};assert.equal(M.assistanceKey(s),key);
 for(const mutate of [s=>s.preferences.priority='cost',s=>s.intake={oxygen:'yes'},s=>s.facilityUpdates.saebom={beds:0,iv:true,isolation:true},s=>s.referralRequest={date:'2099-12-01',kind:'inpatient'}]){const clone=structuredClone(s);mutate(clone);assert.notEqual(M.assistanceKey(clone),key);}
 s=M.transition(s,{type:'send',ids:['saebom']});assert.notEqual(M.assistanceKey(s),key);assert.ok(!s.sentInquiryDraft.includes('가상약'));
});
test('LLM 컨텍스트에 환자 이름·번호·연락처·상세 처방과 자유서술 보완 내용을 보내지 않음',()=>{
 let s=M.transition(ready(),{type:'send',ids:['saebom']});s.patient='홍테스트';s.patientRecord={name:'홍테스트',number:'CB-SECRET42',contact:'010-1234-5678'};s.data.drug='비밀약제';s.data.dose='비공개용량';s.data.interval='비공개간격';s.inquiryNotes.saebom='비공개 보완 메모';
 s.responses.saebom={status:'more',reason:'환자: 홍테스트 CB-SECRET42 010-1234-5678 private@example.com 비밀약제 비공개용량 비공개간격 추가 정보 필요'};
 const text=JSON.stringify(assistanceContext(M,s));for(const secret of ['홍테스트','CB-SECRET42','010-1234-5678','private@example.com','비밀약제','비공개용량','비공개간격','비공개 보완 메모'])assert.ok(!text.includes(secret),secret);
 assert.ok(!deidentify('900101-1234567',s).includes('900101'));
});
test('LLM의 순위 변조·누락·없는 근거·완료 권한 침범을 검증에서 차단',()=>{
 const c=assistanceContext(M,ready());
 for(const mutate of [o=>o.recommendations.reverse(),o=>o.recommendations[0].reasonCodes=['guaranteed_bed','distance'],o=>o.action='completed',o=>o.checkIds=[],o=>o.draft='예약 확정']){const o=output(c);mutate(o);assert.throws(()=>validateAssistance(c,o));}
});
test('부분 수용과 보완·미회신은 담당자 선택으로 남고 사유 기반 재문의는 새 분석으로 연결',()=>{
 let s=M.transition(ready(),{type:'send',ids:['saebom','daon']});s=M.transition(s,{type:'response',id:'saebom',status:'accepted'},'facility');assert.equal(M.assistanceAction(s),'review_partial');
 s=M.transition(s,{type:'response',id:'daon',status:'rejected',reason:'희망 일정 불가',reasonCode:'schedule'},'facility');const c=assistanceContext(M,s);assert.equal(c.responses.find(r=>r.id==='daon').focusCodes[0],'schedule');
 s=M.transition(s,{type:'research',reason:'희망 일정 변경',date:'2099-12-02'});assert.equal(s.consent,false);assert.equal(s.roundHistory.length,1);assert.throws(()=>M.transition(s,{type:'send',ids:['saebom']}),/동의/);
});
test('인증 실패는 가짜 AI 결과를 반환하지 않으며 같은 입력만 캐시 재사용',async()=>{
 let calls=0;const fn=createAssistance(M,{env,upstreamFetch:async(...args)=>{calls++;return mock()(...args);}}),s=ready();await fn(s);assert.equal((await fn(s)).cached,true);assert.equal(calls,1);
 s.preferences.priority='cost';await fn(s);assert.equal(calls,2);
 await assert.rejects(()=>createAssistance(M,{env:{}})(s),/사용할 수 없습니다/);
 let failures=0;await assert.rejects(()=>createAssistance(M,{env,pause:async()=>{},upstreamFetch:async()=>{failures++;return new Response('{}',{status:503});}})(s),/완료하지 못했습니다/);assert.equal(failures,3);
});
