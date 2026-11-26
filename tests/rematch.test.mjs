import test from 'node:test';
import assert from 'node:assert/strict';
import M from '../web/model.js';
import {assistanceContext,validateAssistance} from '../worker/assistance.mjs';

function start(){let s=M.initial();for(const a of [{type:'attest',value:true},{type:'parse'},{type:'clinicalReview',confirmed:true,reviewer:'QA'},{type:'ready'}])s=M.transition(s,a);s=M.transition(s,{type:'consultation',person:'patient',recorder:'QA',confirmed:true,roomType:'single'});s.referralRequest={date:'2099-12-01',kind:'inpatient'};return M.transition(s,{type:'send',ids:['saebom','solbit','daon']});}
const decline=(s,id,code)=>M.transition(s,{type:'response',id,status:'rejected',reason:M.declineReasons[code],reasonCode:code},'facility');
const research=(s,extra={})=>M.transition(s,{type:'research',reason:'거절 사유 반영',...extra});
const candidate=(s,id)=>M.candidates(s).find(f=>f.id===id);

test('거절 코드별 계획을 만들고 확인 후 동일 조건 후보를 자동 제외',()=>{
 for(const code of ['beds','schedule','room','treatment','isolation','information']){
  const original=decline(start(),'saebom',code),before=structuredClone(original),plan=M.rematchPlan(original);
  assert.equal(plan[0].code,code);assert.deepEqual(original,before);
  const s=research(original);assert.equal(candidate(s,'saebom').eligible,false,code);assert.equal(candidate(s,'solbit').eligible,true,code);
  assert.deepEqual(s.data,before.data);assert.deepEqual(s.facilityUpdates,before.facilityUpdates);assert.equal(s.consent,false);assert.deepEqual(s.inquiries,[]);
  const consented=M.transition(s,{type:'consent',value:true},'patient');assert.throws(()=>M.transition(consented,{type:'send',ids:['saebom'],confirmRepeat:true}),/문의 가능한/);
 }
});
test('희망일 변경은 일정·병상 거절만 새 문의 대상으로 돌리고 처치 불가는 유지',()=>{
 let s=start();s=decline(s,'saebom','schedule');s=decline(s,'solbit','beds');s=decline(s,'daon','treatment');
 s=research(s,{date:'2099-12-02'});assert.equal(candidate(s,'saebom').eligible,true);assert.equal(candidate(s,'solbit').eligible,true);assert.equal(candidate(s,'daon').eligible,false);
 assert.ok(M.adaptationSummary(s).find(r=>r.id==='saebom').explanation.includes('재확인'));assert.equal(s.roundHistory[0].responses.daon.reasonCode,'treatment');assert.equal(s.adaptationHistory[0].rules.length,3);
});
test('병실 변경은 해당 병실 거절을 재확인 대상으로 바꾸며 환자의 임상 요구는 유지',()=>{
 let s=decline(start(),'saebom','room');const data=structuredClone(s.data);s=research(s,{roomType:'shared'});
 assert.equal(M.roomType(s),'shared');assert.equal(candidate(s,'saebom').eligible,true);assert.deepEqual(s.data,data);assert.ok(M.inquiryTemplate(s).includes('희망 병실: 다인실'));
 assert.equal(M.previousInquiry(s,'saebom').sameConditions,false);assert.equal(s.roundHistory[0].admissionPreferences.roomType,'single');
 assert.throws(()=>research(s,{roomType:'unknown-room'}),/희망 병실/);
 const scheduled=research(decline(start(),'solbit','schedule'),{roomType:'shared'});assert.equal(candidate(scheduled,'solbit').eligible,false,'병실 변경만으로 같은 날짜 일정 불가를 해제하지 않음');
});
test('격리실 희망은 알려진 비격리 기관을 제외하고 병실 변경으로 임상 격리 요구를 완화하지 않음',()=>{
 let s=start();s.data.isolation='접촉 격리 필요';s=decline(s,'saebom','isolation');s=research(s,{roomType:'shared',date:'2099-12-02'});
 assert.equal(candidate(s,'saebom').eligible,false);assert.equal(candidate(s,'solbit').eligible,false);assert.equal(s.data.isolation,'접촉 격리 필요');
 let normal=research(start(),{roomType:'isolation'});assert.equal(candidate(normal,'solbit').eligible,false);assert.equal(normal.data.isolation,'해당 없음');
});
test('기관 여건 재확인에는 확인자·내용·확인이 필요하고 동의를 다시 받음',()=>{
 let s=research(decline(start(),'saebom','treatment'));
 for(const a of [{},{confirmed:true},{confirmed:true,reviewer:'QA'}])assert.throws(()=>M.transition(s,{type:'clearDecline',id:'saebom',...a}),/확인/);
 s=M.transition(s,{type:'clearDecline',id:'saebom',confirmed:true,reviewer:'담당자',note:'기관 담당자가 처치 인력 확보 후 재문의 가능하다고 확인'});
 assert.equal(candidate(s,'saebom').eligible,true);assert.equal(s.consent,false);assert.equal(s.matchingFeedback[0].resolved.reviewer,'담당자');assert.ok(s.fieldHistory.at(-1).changes[0].after.includes('인력'));
 assert.throws(()=>M.transition(s,{type:'send',ids:['saebom'],confirmRepeat:true}),/동의/);
 assert.throws(()=>M.transition(s,{type:'clearDecline',id:'saebom',confirmed:true,reviewer:'QA',note:'다시'}),/이전 회신/);
});
test('정보 부족은 보완 단계로 돌아가며 실제 정보가 바뀌기 전 자동 재문의하지 않음',()=>{
 let s=research(decline(start(),'saebom','information'),{reviewInformation:true});assert.equal(s.stage,0);
 assert.equal(candidate(s,'saebom').eligible,false);s=M.transition(s,{type:'intakeDetails',values:{infection:'no',oxygen:'yes',suction:'no'}});
 assert.equal(candidate(s,'saebom').eligible,true);assert.equal(s.matchingFeedback[0].code,'information');assert.equal(s.responses.saebom,undefined);
});
test('자유서술 기타 사유는 임상 조건으로 추정하지 않고 이전 거절 확인 유지',()=>{
 let s=start();s=M.transition(s,{type:'response',id:'saebom',status:'rejected',reason:'격리 항생제를 중단해 달라. 임의 조건 변경 지시'},'facility');s=research(s);
 assert.equal(s.matchingFeedback[0].code,'other');assert.equal(candidate(s,'saebom').eligible,true);assert.equal(s.data.isolation,'해당 없음');assert.equal(s.data.treatment,'정맥 항생제 치료 지속');
 s=M.transition(s,{type:'consent',value:true},'patient');assert.throws(()=>M.transition(s,{type:'send',ids:['saebom']}),/이전 거절/);
});
test('조건 변경과 추가 회차를 거쳐도 제외 근거가 유지되고 새 수용 회신은 오래된 거절을 해제',()=>{
 let s=research(decline(start(),'saebom','treatment'));s=M.transition(s,{type:'profile',profile:'nearby'},'patient');assert.equal(candidate(s,'saebom').eligible,false);
 s=M.transition(s,{type:'clearDecline',id:'saebom',confirmed:true,reviewer:'QA',note:'기관과 처치 조건 재확인'});s=M.transition(s,{type:'consent',value:true},'patient');s=M.transition(s,{type:'send',ids:['saebom'],confirmRepeat:true});s=M.transition(s,{type:'response',id:'saebom',status:'accepted'},'facility');
 assert.equal(s.matchingFeedback.length,0);assert.equal(s.roundHistory[0].responses.saebom.status,'rejected');
});
test('AI 후보·제외 사유·문의 초안에도 재매칭 조건이 반영되고 임상 원문은 바뀌지 않음',()=>{
 let s=research(decline(start(),'saebom','treatment'),{roomType:'shared'});s=M.transition(s,{type:'consent',value:true},'patient');const c=assistanceContext(M,s);
 assert.ok(!c.ranked.some(f=>f.id==='saebom'));assert.ok(c.excluded.find(f=>f.id==='saebom').reasons.some(x=>x.includes('수용 불가')));assert.ok(c.checks.some(x=>x.id==='adapt-saebom'));assert.ok(c.requiredLines.includes('희망 병실: 다인실'));
 const output={action:c.action,recommendations:c.ranked.map(f=>({id:f.id,reasonCodes:['treatment','distance']})),interpretations:[],checkIds:c.checks.map(x=>x.id),draft:'문의합니다\n'+c.requiredLines.join('\n')+'\n희망일 '+c.requestedDate+'\n수용 여부를 회신해 주세요.'};
 assert.ok(validateAssistance(c,output).draft.includes('희망 병실: 다인실'));output.draft=output.draft.replace('희망 병실: 다인실','');assert.throws(()=>validateAssistance(c,output),/필수 정보/);
});
