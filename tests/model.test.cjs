const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../web/model.js');
function start(scenario='normal'){let s=M.initial(scenario);s=M.transition(s,{type:'attest',value:true});return M.transition(s,{type:'parse'});}
function sent(scenario='normal'){let s=start(scenario);s=M.transition(s,{type:'ready'});s=M.transition(s,{type:'consent',value:true},'patient');return M.transition(s,{type:'send'});}
function choice(){let s=sent();s=M.transition(s,{type:'demoResponses'},'simulation');s=M.transition(s,{type:'publish'});return s;}
test('담당의 회송 결정 확인 없이 구조화 진행 차단',()=>assert.throws(()=>M.transition(M.initial(),{type:'parse'}),/회송 결정/));
test('회송서 필수 항목 누락을 추정하지 않음',()=>{const s=start('missing');assert.deepEqual(M.missing(s),['interval']);assert.throws(()=>M.transition(s,{type:'ready'}),/누락/);});
test('누락 보완은 담당의 회신 확인 필요',()=>{const s=start('missing');assert.throws(()=>M.transition(s,{type:'supplement',values:{interval:'시연값'},confirmed:false}),/담당의/);const b=M.transition(s,{type:'supplement',values:{interval:'담당의 기록 (가상)'},confirmed:true});assert.equal(M.missing(b).length,0);});
test('환자 동의 없이는 기관 문의 생성 불가',()=>{let s=M.transition(start(),{type:'ready'});assert.throws(()=>M.transition(s,{type:'send'}),/동의/);});
test('처치 불가 기관은 문의에서 제외',()=>{const s=sent();assert.ok(!s.inquiries.includes('bom'));assert.equal(s.stage,2);});
test('초기 문의 요약은 비식별이고 상세 처방은 숨김',()=>{const sum=M.summary(sent(),'saebom');assert.equal(sum.patient,null);assert.equal(sum.interval,null);assert.equal(sum.shared,false);});
test('기관 회신 없는 상태에서 후보 공개 차단',()=>assert.throws(()=>M.transition(sent(),{type:'publish'}),/수용 가능/));
test('추가 확인 필요 기관은 선택 후보에 포함하지 않음',()=>{const s=choice();assert.deepEqual(M.accepted(s).map(f=>f.id).sort(),['saebom','solbit']);assert.throws(()=>M.transition(s,{type:'choose',id:'daon',consent:true},'patient'),/수용/);});
test('환자 선택에는 선택 기관 정보 제공 동의 필요',()=>assert.throws(()=>M.transition(choice(),{type:'choose',id:'saebom',consent:false},'patient'),/동의/));
test('선택한 기관에만 상세 정보 공개, 타 기관 문의 종료',()=>{const s=M.transition(choice(),{type:'choose',id:'saebom',consent:true},'patient');assert.equal(s.stage,4);assert.equal(s.ack,false);assert.equal(M.summary(s,'saebom').patient,'가상 환자 01');assert.equal(M.summary(s,'solbit').patient,null);assert.equal(s.responses.solbit.status,'withdrawn');});
test('준비 확인 전 공식 전달 모의 기록 생성 불가',()=>{const s=M.transition(choice(),{type:'choose',id:'saebom',consent:true},'patient');assert.throws(()=>M.transition(s,{type:'handoff'}),/전원 준비/);});
function handed(){let s=M.transition(choice(),{type:'choose',id:'saebom',consent:true},'patient');for(const key of Object.keys(s.prep))s=M.transition(s,{type:'prep',key,value:true});return M.transition(s,{type:'handoff'});}
test('수용기관 회신만으로 연계가 자동 완료되지 않음',()=>{let s=handed();assert.throws(()=>M.transition(s,{type:'visit',id:'solbit',result:'done'},'facility'),/선택/);s=M.transition(s,{type:'visit',id:'saebom',result:'done'},'facility');assert.equal(s.stage,6);assert.equal(s.ack,false);s=M.transition(s,{type:'ack'});assert.equal(s.stage,7);assert.equal(s.ack,true);});
test('첫 진료 미이행은 완료 차단, 재연계 시 선택·동의 재설정',()=>{let s=M.transition(handed(),{type:'visit',id:'saebom',result:'missed',note:'환자 일정 재확인 필요 (가상)'},'facility');assert.throws(()=>M.transition(s,{type:'ack'}),/미이행/);s=M.transition(s,{type:'relink'});assert.equal(s.stage,1);assert.equal(s.selected,null);assert.equal(s.shareConsent,false);assert.equal(s.consent,false);});
test('모든 기관 수용 불가 → 범위 확장 후 동의 재확인·재문의',()=>{let s=sent('unavailable');s=M.transition(s,{type:'demoResponses'},'simulation');assert.equal(M.accepted(s).length,0);s=M.transition(s,{type:'expand'});assert.throws(()=>M.transition(s,{type:'send'}),/동의/);s=M.transition(s,{type:'consent',value:true},'patient');s=M.transition(s,{type:'send'});assert.ok(s.inquiries.includes('haeon'));s=M.transition(s,{type:'demoResponses'},'simulation');assert.ok(M.accepted(s).length>0);});
test('역할별 작업 가드 적용',()=>assert.throws(()=>M.transition(choice(),{type:'choose',id:'saebom',consent:true},'hospital'),/현재 역할/));
test('선호 조건에 따라 수용 확인된 기관 정렬이 달라짐',()=>{let s=choice();assert.equal(M.accepted(s)[0].id,'saebom');s=M.transition(s,{type:'preferences',priority:'cost'},'patient');assert.equal(M.accepted(s)[0].id,'solbit');});
test('문의 동의를 철회하면 진행 중 문의와 후보 공개 중단',()=>{let s=choice();s=M.transition(s,{type:'consent',value:false},'patient');assert.equal(s.stage,1);assert.equal(s.inquiries.length,0);assert.equal(M.accepted(s).length,0);});
test('아직 지원하지 않는 처치 시나리오의 매칭 차단',()=>{const s=start();s.data.treatment='투석';assert.throws(()=>M.transition(s,{type:'ready'}),/시나리오/);});
