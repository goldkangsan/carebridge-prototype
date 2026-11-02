(function (root) {
  'use strict';
  const facilities = [
    {id:'saebom', name:'새봄연계병원', type:'가상 요양병원', area:'서울 관악', km:8.2, minutes:22, cost:45000, iv:true, dialysis:false, isolation:true, updated:'10분 전', fresh:true, response:'accepted', note:'정맥 투여 처치 가능 · 희망일 입원 가능'},
    {id:'solbit', name:'솔빛재활병원', type:'가상 재활병원', area:'서울 동작', km:12.6, minutes:31, cost:35000, iv:true, dialysis:false, isolation:false, updated:'25분 전', fresh:true, response:'accepted', note:'정맥 투여 처치 가능 · 입원 일정 협의 가능'},
    {id:'daon', name:'다온연계병원', type:'가상 2차 병원', area:'경기 안양', km:19.4, minutes:42, cost:55000, iv:true, dialysis:true, isolation:true, updated:'5일 전', fresh:false, response:'more', note:'최근 처방 내용 추가 확인 필요'},
    {id:'bom', name:'봄길회복병원', type:'가상 요양병원', area:'서울 금천', km:9.6, minutes:26, cost:30000, iv:false, dialysis:false, isolation:false, updated:'1시간 전', fresh:true, response:'rejected', note:'정맥 투여 처치 불가'},
    {id:'haeon', name:'해온연계병원', type:'가상 2차 병원', area:'경기 의왕', km:27.1, minutes:55, cost:40000, iv:true, dialysis:true, isolation:true, updated:'15분 전', fresh:true, response:'accepted', expanded:true, note:'조건 확인 후 입원 가능'},
  ];
  const stages=['회송 정보','기관 문의','수용 응답','환자 선택','전원 준비','첫 진료 회신','의뢰기관 확인','연계 완료'];
  const fields={treatment:'필요 처치',drug:'약제',dose:'용량',interval:'투여 간격',period:'치료 기간',isolation:'격리 여부'};
  const sourceText = '이 문서는 가상 사례입니다. 실제 처방에 사용할 수 없습니다.\n회송 결정: 담당의 확인\n필요 처치: 정맥 항생제 치료 지속\n약제: 가상약 A\n용량: 담당의 원 처방 참조 (시연)\n투여 간격: 담당의 기록 기준 (시연)\n치료 기간: 회송 후 7일 (가상)\n격리 여부: 해당 없음\n환자 선호: 보호자 거주지 인근, 이동 부담이 적은 기관';
  function initial(scenario='normal') {
    return {version:1,scenario,stage:0,parsed:false,caseId:'CB-026-001',patient:'가상 환자 01',age:'70대',source:scenario==='missing'?sourceText.replace('투여 간격: 담당의 기록 기준 (시연)','투여 간격:'):sourceText,
      data:{},doctorApproved:false,consent:false,preferences:{priority:'distance',maxKm:25},inquiries:[],responses:{},selected:null,shareConsent:false,expanded:false,round:0,
      inquiryNotes:{},prep:{documents:false,transport:false,guidance:false},visit:null,ack:false,exception:null,reason:'',events:[],metrics:{started:null,actions:0,errors:0}};
  }
  function extract(text) {
    const labels={treatment:'필요 처치',drug:'약제',dose:'용량',interval:'투여 간격',period:'치료 기간',isolation:'격리 여부'};
    return Object.fromEntries(Object.entries(labels).map(([k,v])=>[k,(text.split('\n').find(l=>l.trim().startsWith(v+':'))||'').split(':').slice(1).join(':').trim()]));
  }
  const missing=s=>Object.keys(fields).filter(k=>!s.data[k]?.trim());
  function candidates(s) {
    const requiresIsolation=!!s.data.isolation && !/해당 없음|불필요|없음/.test(s.data.isolation);
    return facilities.map(f=>{
      const reasons=[];
      if(!f.iv)reasons.push('필요 처치 불가');
      if(requiresIsolation&&!f.isolation)reasons.push('격리 조건 불일치');
      if(f.km>(s.expanded?40:s.preferences.maxKm))reasons.push('희망 이동 범위 초과');
      if(f.expanded&&!s.expanded)reasons.push('확장 탐색 대상');
      return {...f,reasons,eligible:reasons.length===0,response:s.responses[f.id]||null};
    }).sort((a,b)=>s.preferences.priority==='cost'?a.cost-b.cost:a.km-b.km);
  }
  const accepted=s=>candidates(s).filter(f=>s.inquiries.includes(f.id)&&s.responses[f.id]?.status==='accepted');
  function summary(s,facilityId) {
    const shared=s.selected===facilityId&&s.shareConsent;
    return {caseId:s.caseId,age:s.age,treatment:s.data.treatment||'구조화 전',isolation:s.data.isolation||'확인 필요',period:s.data.period||'확인 필요',
      patient:shared?s.patient:null,drug:shared?s.data.drug:null,dose:shared?s.data.dose:null,interval:shared?s.data.interval:null,shared};
  }
  function transition(state,action,actor='hospital') {
    const s=JSON.parse(JSON.stringify(state));
    const need=(ok,message)=>{if(!ok)throw new Error(message);};
    const role=r=>need(actor===r,'현재 역할에서는 이 작업을 수행할 수 없습니다.');
    const at=n=>need(s.stage===n,'진행 단계를 확인해 주세요.');
    let detail='';
    switch(action.type){
      case 'attest': role('hospital');at(0);s.doctorApproved=!!action.value;detail='담당의의 비응급 회송 결정 확인 기록';break;
      case 'source': role('hospital');at(0);s.source=String(action.value);s.parsed=false;s.data={};s.extraction=null;detail='가상 회송서 내용 수정';break;
      case 'parse': role('hospital');at(0);need(s.doctorApproved,'담당의의 비응급 회송 결정을 먼저 확인해 주세요.');s.data=extract(s.source);s.parsed=true;s.extraction=null;detail='시연용 규칙 추출 및 필수 항목 점검';break;
      case 'applyExtraction': role('hospital');at(0);need(s.doctorApproved,'담당의의 비응급 회송 결정을 먼저 확인해 주세요.');need(s.source===initial(s.scenario).source,'AI 분석은 준비된 가상 문서에만 사용할 수 있습니다.');need(action.result?.mode==='live'&&Object.keys(fields).every(k=>action.result.data?.[k]===extract(s.source)[k]),'AI 결과가 원문과 일치하지 않습니다.');s.data=action.result.data;s.parsed=true;s.extraction={model:action.result.model,at:action.result.at,cached:!!action.result.cached};detail='실제 AI API 문서 추출 · 원문 대조 완료';break;
      case 'supplement': role('hospital');at(0);need(s.parsed,'먼저 회송 정보를 구조화해 주세요.');need(action.confirmed,'담당의 보완 회신임을 확인해 주세요.');
        for(const k of missing(s)){need(String(action.values[k]||'').trim(),fields[k]+' 보완이 필요합니다.');s.data[k]=String(action.values[k]).trim();}detail='담당의 보완 회신 반영 (시연)';break;
      case 'ready': role('hospital');at(0);need(s.parsed&&!missing(s).length,'누락된 회송 정보를 먼저 보완해 주세요.');need(/정맥.*항생제|항생제.*정맥/.test(s.data.treatment),'현재 프로토타입은 정맥 항생제 치료 시나리오만 지원합니다. 다른 처치는 별도 설계가 필요합니다.');s.stage=1;detail='필수 정보 점검 완료 · 기관 문의 준비';break;
      case 'preferences': role('patient');need(s.stage<4,'기관 선택 후에는 조건을 변경할 수 없습니다.');need(['distance','cost'].includes(action.priority),'정렬 기준을 확인해 주세요.');s.preferences.priority=action.priority;detail='환자·보호자 우선 조건 반영';break;
      case 'consent': role('patient');need(s.stage<4,'진행 단계를 확인해 주세요.');s.consent=!!action.value;if(!s.consent&&s.stage>=2){s.stage=1;s.inquiries=[];s.responses={};}detail=s.consent?'비식별 요약을 이용한 기관 문의 동의':'기관 문의 동의 철회 · 진행 문의 중단';break;
      case 'send': role('hospital');at(1);need(s.consent,'환자·보호자의 비식별 기관 문의 동의가 필요합니다.');need(!missing(s).length,'회송서 필수 항목을 먼저 보완해 주세요.');s.inquiries=candidates(s).filter(f=>f.eligible).map(f=>f.id);need(s.inquiries.length,'조건에 맞는 기관이 없습니다.');s.responses={};s.round++;s.stage=2;s.exception=null;detail=s.inquiries.length+'개 가상 기관에 비식별 수용 문의 생성 · 실제 전송 없음';break;
      case 'response': role('facility');at(2);need(s.inquiries.includes(action.id),'문의 대상 기관이 아닙니다.');need(['accepted','rejected','more'].includes(action.status),'응답을 선택해 주세요.');need(action.status==='accepted'||String(action.reason||'').trim(),'거절 또는 추가 확인 사유를 적어 주세요.');s.responses[action.id]={status:action.status,reason:String(action.reason||'수용 담당자 조건 확인 (시연)'),at:new Date().toISOString()};detail=facilities.find(f=>f.id===action.id).name+' 수용 응답 기록';break;
      case 'demoResponse': role('simulation');at(2);need(s.inquiries.includes(action.id),'문의 대상 기관이 아닙니다.');need(!s.responses[action.id],'이미 응답이 기록된 기관입니다.');{const f=facilities.find(f=>f.id===action.id),status=s.scenario==='unavailable'&&s.round===1?'rejected':s.inquiryNotes?.[action.id]?'accepted':f.response;s.responses[action.id]={status,reason:status==='rejected'?'희망 일정 수용 불가 (가상)':s.inquiryNotes?.[action.id]?'담당의 보완 정보 확인 후 수용 가능 (가상)':f.note,at:new Date().toISOString(),simulated:true};detail=f.name+' 모의 수용 응답 자동 수신';}break;
      case 'provideInfo': role('hospital');at(2);need(s.responses[action.id]?.status==='more','추가 정보 요청 건을 확인해 주세요.');need(action.confirmed,'담당의가 확인한 보완 정보인지 확인해 주세요.');need(String(action.note||'').trim(),'보완 회신 내용을 입력해 주세요.');s.inquiryNotes=s.inquiryNotes||{};s.inquiryNotes[action.id]=String(action.note).trim();delete s.responses[action.id];detail='추가 정보 요청에 담당의 확인 내용 회신 · 재응답 대기';break;
      case 'demoResponses': role('simulation');at(2);for(const id of s.inquiries){const f=facilities.find(f=>f.id===id);const status=s.scenario==='unavailable'&&s.round===1?'rejected':f.response;s.responses[id]={status,reason:status==='rejected'?'희망 일정 수용 불가 (가상)':f.note,at:new Date().toISOString()};}detail='미리 준비된 가상 기관 응답 불러오기 · 실제 응답 아님';break;
      case 'publish': role('hospital');at(2);need(accepted(s).length,'수용 가능 응답을 받은 기관이 없습니다. 재탐색 또는 예외 처리가 필요합니다.');s.stage=3;detail='수용 확인된 기관을 환자 비교 화면에 공개';break;
      case 'expand': role('hospital');need(s.stage===1||s.stage===2,'현재 단계에서는 재탐색할 수 없습니다.');s.expanded=true;s.stage=1;s.responses={};s.inquiryNotes={};s.inquiries=[];s.consent=false;s.exception=null;detail='예외 처리 · 이동 범위를 40km로 확장하여 재탐색 · 환자 동의 재확인';break;
      case 'choose': role('patient');at(3);need(accepted(s).some(f=>f.id===action.id),'수용이 확인된 기관만 선택할 수 있습니다.');need(action.consent,'선택한 기관에 정보를 전달하는 동의가 필요합니다.');s.selected=action.id;s.shareConsent=true;s.stage=4;for(const id of s.inquiries)if(id!==action.id)s.responses[id]={...s.responses[id],status:'withdrawn',reason:'다른 기관 선택으로 문의 종료'};detail='환자 기관 선택 및 선택 기관 한정 정보 전달 동의 · 실제 전원 확정 아님';break;
      case 'prep': role('hospital');at(4);need(Object.keys(s.prep).includes(action.key),'확인 항목을 확인해 주세요.');s.prep[action.key]=!!action.value;detail='전원 준비 확인: '+({documents:'회송 서류·원 처방',transport:'이동·입원 일정',guidance:'환자·보호자 안내'}[action.key]);break;
      case 'handoff': role('hospital');at(4);need(Object.values(s.prep).every(Boolean),'전원 준비 항목을 모두 확인해 주세요.');s.stage=5;detail='기존 공식 회송 절차의 전달 기록 모의 생성 · 실제 EMR/HIRA 전송 없음';break;
      case 'visit': role('facility');at(5);need(action.id===s.selected,'선택한 수용기관만 진료 이행을 회신할 수 있습니다.');need(['done','missed'].includes(action.result),'진료 이행 여부를 선택해 주세요.');need(action.result!=='missed'||String(action.note||'').trim(),'미이행 사유 또는 추가 확인이 필요한 사항을 기록해 주세요.');s.visit={result:action.result,note:String(action.note||''),at:new Date().toISOString()};s.stage=6;s.exception=action.result==='missed'?'첫 진료 미이행':null;detail=action.result==='done'?'수용기관 첫 진료 이행 회신':'수용기관 첫 진료 미이행 회신 · 담당자 확인 필요';break;
      case 'ack': role('hospital');at(6);need(s.visit?.result==='done','미이행 건은 확인 완료로 처리할 수 없습니다.');s.ack=true;s.stage=7;detail='의뢰기관 담당자가 첫 진료 회신을 확인 · 연계 완료';break;
      case 'relink': role('hospital');at(6);need(s.visit?.result==='missed','미이행 건에서만 재연계할 수 있습니다.');s.stage=1;s.selected=null;s.shareConsent=false;s.consent=false;s.responses={};s.inquiries=[];s.visit=null;s.prep={documents:false,transport:false,guidance:false};s.expanded=true;s.exception=null;detail='미이행 사유 확인 후 재연계 시작 · 기관 선택과 정보 전달 동의 재확인 필요';break;
      default: throw new Error('지원하지 않는 작업입니다.');
    }
    if(action.type==='relink')s.inquiryNotes={};
    s.metrics.started=s.metrics.started||Date.now();s.metrics.actions++;
    s.events.unshift({type:action.type,actor,detail,time:new Date().toISOString()});return s;
  }
  const api={facilities,stages,fields,initial,extract,missing,candidates,accepted,summary,transition};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CareBridge=api;
})(typeof globalThis!=='undefined'?globalThis:this);
