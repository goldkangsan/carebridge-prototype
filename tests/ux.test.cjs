const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../web/model.js');
const U=require('../web/ux.js');
function ready(scenario='normal'){let s=M.transition(M.initial(scenario),{type:'attest',value:true});s=M.transition(s,{type:'parse'});return M.transition(s,{type:'ready'});}
function sent(scenario='normal'){let s=ready(scenario);s=M.transition(s,{type:'consent',value:true},'patient');return M.transition(s,{type:'send'});}
test('처치 역량이 있어도 이동 범위 제외 기관은 수용 가능으로 표시하지 않음',()=>{
 const s=ready(),f=M.candidates(s).find(x=>x.id==='haeon');assert.equal(f.iv,true);assert.equal(f.eligible,false);assert.equal(U.facilityStatus(f,s).label,'문의 대상 제외');assert.equal(U.facilityStatus(f,s).tone,'neutral');
});
test('역량 정보와 현재 수용 응답을 구분하고 불가·추가 확인도 구분',()=>{
 let s=ready(),f=M.candidates(s).find(x=>x.id==='saebom');assert.equal(U.facilityStatus(f,s).tone,'amber');
 s=sent();f=M.candidates(s).find(x=>x.id==='saebom');assert.equal(U.facilityStatus(f,s).tone,'pending');
 for(const [status,tone]of[['accepted','green'],['rejected','red'],['more','amber']]){const next=M.transition(s,{type:'response',id:f.id,status,reason:'기관 확인 내용 (가상)'},'facility');assert.equal(U.facilityStatus(M.candidates(next).find(x=>x.id===f.id),next).tone,tone);}
});
test('담당의 확인이나 누락 보완을 건너뛰는 다음 행동을 제안하지 않음',()=>{
 assert.equal(U.nextTask(M.initial(),'hospital').action,'focus-attest');
 let s=M.transition(M.initial('missing'),{type:'attest',value:true});s=M.transition(s,{type:'parse'});assert.equal(U.nextTask(s,'hospital',{missing:M.missing(s)}).action,'supplement');
});
test('동의 체크 초안과 실제 문의 시작을 구분',()=>{
 const s=ready();assert.equal(U.nextTask(s,'patient').action,'focus-consent');assert.equal(U.nextTask(s,'patient',{consentDraft:true}).action,'consent-start');assert.equal(s.consent,false);assert.equal(s.inquiries.length,0);
 const consent=M.transition(s,{type:'consent',value:true},'patient');assert.equal(U.nextTask(consent,'hospital',{auto:false}).action,'send');assert.equal(U.nextTask(consent,'patient',{auto:true}).action,null);
});
test('자동 응답 수집 중 불필요한 역할 전환을 요구하지 않음',()=>{
 const s=sent();assert.equal(U.nextTask(s,'hospital',{auto:true}).action,null);assert.equal(U.nextTask(s,'patient',{auto:true}).action,null);
});
test('수용 불가·추가 정보 요청 시 후보 공개 대신 예외 처리 안내',()=>{
 let s=sent('unavailable');s=M.transition(s,{type:'demoResponses'},'simulation');assert.equal(U.nextTask(s,'hospital',{auto:true}).action,'expand');
 s=sent();for(const id of s.inquiries)s=M.transition(s,{type:'response',id,status:id==='daon'?'more':'rejected',reason:'기관 확인 필요 (가상)'},'facility');const task=U.nextTask(s,'hospital',{auto:true});assert.equal(task.action,'more-info');assert.equal(task.id,'daon');
});
test('문의 없는 기관에는 응답 제출 대신 문의 대상 이동 안내',()=>{
 assert.equal(U.nextTask(sent(),'facility',{facility:'bom'}).action,'go-facility');
});
test('환자 비교와 기관 선택은 환자 역할에서 수행',()=>{
 let s=sent();s=M.transition(s,{type:'demoResponses'},'simulation');s=M.transition(s,{type:'publish'});
 assert.equal(U.nextTask(s,'hospital').action,'request-handoff');assert.equal(U.nextTask(s,'patient',{compareCount:1}).action,'focus-candidates');assert.equal(U.nextTask(s,'patient',{compareCount:2}).action,'open-compare');
 s=M.transition(s,{type:'choose',id:'saebom',consent:true},'patient');assert.equal(U.nextTask(s,'hospital').action,'focus-prep');for(const key of Object.keys(s.prep))s=M.transition(s,{type:'prep',key,value:true});assert.equal(U.nextTask(s,'hospital').action,'handoff');
 s=M.transition(s,{type:'handoff'});assert.equal(U.nextTask(s,'facility',{facility:'solbit'}).action,'go-facility');assert.equal(U.nextTask(s,'facility',{facility:'saebom'}).action,'visit');
 s=M.transition(s,{type:'visit',id:'saebom',result:'missed',note:'일정 재확인 (가상)'},'facility');assert.equal(U.nextTask(s,'hospital').action,'relink');assert.equal(U.nextTask(s,'patient').action,null);
});

test('원문 강조는 알려진 항목만 구분하고 모든 원문 줄을 보존',()=>{const text='가상 문서\n필요 처치: 정맥 항생제 지속\n약제: 가상약: A\n임의 메모: 원문 그대로\n';const lines=U.sourceSegments(text);assert.equal(lines.map(x=>x.text).join('\n'),text);assert.equal(lines[1].kind,'treatment');assert.equal(lines[2].value,'가상약: A');assert.equal(lines[3].kind,'text');});
test('원문 강조는 빈 값만 누락으로 표시하고 없음이나 참조값을 추정하지 않음',()=>{const lines=U.sourceSegments('투여 간격:  \n격리 여부: 해당 없음\n용량: 담당의 원 처방 참조 (시연)');assert.equal(lines[0].missing,true);assert.equal(lines[1].missing,false);assert.equal(lines[2].value,'담당의 원 처방 참조 (시연)');});
test('원문 메타데이터나 HTML 문자열을 알려진 임상 항목으로 오인하지 않음',()=>{const lines=U.sourceSegments('__proto__: 테스트\nconstructor: 테스트\n약제: <b>표시 확인</b>');assert.equal(lines[0].kind,'text');assert.equal(lines[1].kind,'text');assert.equal(lines[2].value,'<b>표시 확인</b>');});

test('회신 강조는 추가 정보·미응답을 수용 가능 또는 불가로 오인하지 않음',()=>{assert.equal(U.responsePresentation('accepted').tone,'green');assert.equal(U.responsePresentation('rejected').tone,'red');for(const state of ['more','timeout']){assert.equal(U.responsePresentation(state).tone,'amber');assert.notEqual(U.responsePresentation(state).label,'수용 가능');}assert.equal(U.responsePresentation('pending').tone,'pending');});
