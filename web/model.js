(function (root) {
  'use strict';
  const facilities = [
    {id:'saebom', name:'새봄연계병원', type:'가상 요양병원', area:'서울 관악', km:8.2, minutes:22, cost:45000, iv:true, dialysis:false, isolation:true, updated:'10분 전', fresh:true, response:'accepted', note:'정맥 투여 처치 가능 · 희망일 입원 가능'},
    {id:'solbit', name:'솔빛재활병원', type:'가상 재활병원', area:'서울 동작', km:12.6, minutes:31, cost:35000, iv:true, dialysis:false, isolation:false, updated:'25분 전', fresh:true, response:'accepted', note:'정맥 투여 처치 가능 · 입원 일정 협의 가능'},
    {id:'daon', name:'다온연계병원', type:'가상 2차 병원', area:'경기 안양', km:19.4, minutes:42, cost:55000, iv:true, dialysis:true, isolation:true, updated:'5일 전', fresh:false, response:'more', note:'최근 처방 내용 추가 확인 필요'},
    {id:'bom', name:'봄길회복병원', type:'가상 요양병원', area:'서울 금천', km:9.6, minutes:26, cost:30000, iv:false, dialysis:false, isolation:false, updated:'1시간 전', fresh:true, response:'rejected', note:'정맥 투여 처치 불가'},
    {id:'haeon', name:'해온연계병원', type:'가상 2차 병원', area:'경기 의왕', km:27.1, minutes:55, cost:40000, iv:true, dialysis:true, isolation:true, updated:'15분 전', fresh:true, response:'accepted', expanded:true, note:'조건 확인 후 입원 가능'},
  ];
  const profiles={balanced:{label:'거리·비용 균형',text:'보호자 거주지 25km 안에서 이동 거리와 비용을 함께 비교하고 싶어요.',maxKm:25,maxCost:0,maxMinutes:0,weights:{travel:.45,cost:.25,quality:.15,response:.15}},nearby:{label:'가까운 곳 우선',text:'보호자가 자주 방문하므로 15km 이내의 가까운 기관을 우선하고 싶어요.',maxKm:15,maxCost:0,maxMinutes:0,weights:{travel:.65,cost:.1,quality:.15,response:.1}},budget:{label:'하루 4만원 이내',text:'하루 예상 부담 4만원 이하, 25km 이내에서 비교하고 싶어요.',maxKm:25,maxCost:40000,maxMinutes:0,weights:{travel:.15,cost:.65,quality:.1,response:.1}},family:{label:'30분 이내 이동',text:'보호자 방문 시간이 제한되어 편도 30분 이내로 이동할 수 있는 기관을 원해요.',maxKm:25,maxCost:0,maxMinutes:30,weights:{travel:.6,cost:.15,quality:.1,response:.15}}};
  const locations={gwanak:{label:'서울 관악',lat:37.478,lon:126.923},dongjak:{label:'서울 동작',lat:37.512,lon:126.940},anyang:{label:'경기 안양',lat:37.395,lon:126.927}};
  const points={saebom:[126.952,37.480],solbit:[126.941,37.507],daon:[126.962,37.394],bom:[126.900,37.463],haeon:[126.968,37.344]};
  function customPreferences(input){
    if(!locations[input?.location])throw Error('기준 지역을 선택해 주세요.');
    const values={maxKm:Number(input.maxKm),maxCost:Number(input.maxCost),maxMinutes:Number(input.maxMinutes)};
    if(!Number.isFinite(values.maxKm)||values.maxKm<1||values.maxKm>100||!Number.isInteger(values.maxCost)||values.maxCost<0||values.maxCost>1000000||!Number.isInteger(values.maxMinutes)||values.maxMinutes<0||values.maxMinutes>240)throw Error('거리 1~100km, 하루 비용 0~100만원, 이동시간 0~240분 범위로 입력해 주세요. 0은 제한 없음입니다.');
    return {profile:'balanced',priority:['cost','distance'].includes(input.priority)?input.priority:'distance',custom:{location:input.location,...values}};
  }
  function scheduleValid(s){const a=s.transferPlan;return !!(a&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.when)&&Number.isFinite(Date.parse(a.when+'+09:00'))&&new Date(Date.parse(a.when+'+09:00')+9*3600000).toISOString().slice(0,16)===a.when&&a.venue&&a.address&&a.confirmed);}
  const institutionMetrics={saebom:{quality:88,responseRate:96,mismatchRate:2,beds:2},solbit:{quality:82,responseRate:91,mismatchRate:4,beds:1},daon:{quality:92,responseRate:72,mismatchRate:12,beds:3},bom:{quality:75,responseRate:86,mismatchRate:7,beds:2},haeon:{quality:85,responseRate:94,mismatchRate:3,beds:2}};
  const stages=['회송 정보','기관 문의','수용 응답','환자 선택','전원 준비','첫 진료 회신','의뢰기관 확인','연계 완료'];
  const ageGroups=['10대 미만','10대','20대','30대','40대','50대','60대','70대','80대','90대 이상'];
  const fields={treatment:'필요 처치',drug:'약제',dose:'용량',interval:'투여 간격',period:'치료 기간',isolation:'격리 여부'};
  const sourceText = '이 문서는 가상 사례입니다. 실제 처방에 사용할 수 없습니다.\n회송 결정: 담당의 확인\n필요 처치: 정맥 항생제 치료 지속\n약제: 가상약 A\n용량: 담당의 원 처방 참조 (시연)\n투여 간격: 담당의 기록 기준 (시연)\n치료 기간: 회송 후 7일 (가상)\n격리 여부: 해당 없음\n환자 선호: 보호자 거주지 인근, 이동 부담이 적은 기관';
  function initial(scenario='normal') {
    return {version:1,scenario,stage:0,parsed:false,caseId:'CB-026-001',patient:'가상 환자 01',age:'70대',source:scenario==='missing'?sourceText.replace('투여 간격: 담당의 기록 기준 (시연)','투여 간격:'):sourceText,
      data:{},doctorApproved:false,consent:false,preferences:{priority:'distance',maxKm:25,profile:'balanced'},inquiries:[],responses:{},selected:null,shareConsent:false,expanded:false,round:0,
      transferPlan:null,handoffs:{},inquiryNotes:{},facilityUpdates:{},agentRuns:[],inquiryDraft:'',prep:{documents:false,transport:false,guidance:false},visit:null,ack:false,exception:null,reason:'',events:[],metrics:{started:null,actions:0,errors:0}};
  }
  function extract(text) {
    const labels={treatment:'필요 처치',drug:'약제',dose:'용량',interval:'투여 간격',period:'치료 기간',isolation:'격리 여부'};
    return Object.fromEntries(Object.entries(labels).map(([k,v])=>[k,(text.split('\n').find(l=>l.trim().startsWith(v+':'))||'').split(':').slice(1).join(':').trim()]));
  }
  const missing=s=>Object.keys(fields).filter(k=>!s.data[k]?.trim());
  function profile(s){const p=profiles[s.preferences.profile]||profiles.balanced,c=s.preferences.custom;const base=c?{...p,...c,label:'직접 입력한 조건',text:locations[c.location].label+' 기준 '+c.maxKm+'km 이내'+(c.maxCost?' · 하루 '+c.maxCost.toLocaleString('ko-KR')+'원 이하':'')+(c.maxMinutes?' · 이동 '+c.maxMinutes+'분 이내':'' )}:p;const maxKm=s.expanded?Math.max(40,base.maxKm):base.maxKm;return {...base,maxKm,text:base.text.replace(base.maxKm+'km',maxKm+'km')};}

  function score(s,f){const p=profile(s),w=s.preferences.priority==='cost'&&s.preferences.profile!=='budget'?{travel:.15,cost:.65,quality:.1,response:.1}:p.weights;const travel=p.maxMinutes?Math.max(0,1-f.minutes/60):Math.max(0,1-f.km/45),cost=Math.max(0,1-f.cost/70000);return Math.round(100*(travel*w.travel+cost*w.cost+f.quality/100*w.quality+(f.responseRate-f.mismatchRate)/100*w.response));}
  function candidates(s) {
    const requiresIsolation=!!s.data.isolation&&!/해당 없음|불필요|없음/.test(s.data.isolation),p=profile(s);
    return facilities.map(base=>{
      const f={...base,...institutionMetrics[base.id],...(s.facilityUpdates?.[base.id]||{})},reasons=[];
      if(s.preferences.custom){const origin=locations[s.preferences.custom.location],[lon,lat]=points[f.id],rad=x=>x*Math.PI/180,a=Math.sin(rad(lat-origin.lat)/2)**2+Math.cos(rad(origin.lat))*Math.cos(rad(lat))*Math.sin(rad(lon-origin.lon)/2)**2;f.km=Math.round(6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*1.3*10)/10;f.minutes=Math.max(5,Math.round(f.km*2.2+8));f.estimatedTravel=true;f.travelOrigin=origin.label;}
      if(!f.iv)reasons.push('필요 처치 불가');
      if(requiresIsolation&&!f.isolation)reasons.push('격리 조건 불일치');
      if(f.km>p.maxKm)reasons.push('희망 이동 범위 초과');
      if(p.maxCost&&f.cost>p.maxCost)reasons.push('희망 비용 상한 초과');
      if(p.maxMinutes&&f.minutes>p.maxMinutes)reasons.push('희망 이동 시간 초과');
      if(f.beds===0)reasons.push('기관 등록 병상 없음');
      if(f.expanded&&!s.expanded)reasons.push('확장 탐색 대상');
      return {...f,reasons,score:score(s,f),eligible:reasons.length===0,response:s.responses[f.id]||null};
    }).sort((a,b)=>b.score-a.score||a.km-b.km);
  }
  const accepted=s=>candidates(s).filter(f=>f.eligible&&s.inquiries.includes(f.id)&&s.responses[f.id]?.status==='accepted');
  function agentAction(s){
    if(s.stage===0)return missing(s).length?'request_information':'request_consent';
    if(s.stage===1)return !s.consent?'request_consent':candidates(s).some(f=>f.eligible)?'send_inquiries':'manual_review';
    if(s.stage===2){if(s.inquiries.some(id=>!s.responses[id]))return 'wait_responses';if(accepted(s).length)return 'present_candidates';return s.inquiries.some(id=>s.responses[id]?.status==='more')?'request_information':'expand_search';}
    return ['wait_patient_choice','prepare_transfer','request_first_visit',s.visit?.result==='missed'?'relink':'request_referrer_confirmation','complete'][s.stage-3];
  }
  function facilityRequest(s,id){const f=candidates(s).find(f=>f.id===id);return {id,scenario:s.scenario,round:s.round,profile:s.preferences.profile||'balanced',preferences:s.preferences.custom?customPreferences({...s.preferences.custom,priority:s.preferences.priority}):null,expanded:!!s.expanded,consent:s.consent===true,inquiryOpen:s.stage===2&&s.inquiries.includes(id),capabilities:f?{iv:f.iv,isolation:f.isolation,beds:f.beds}:null,summary:{age:s.age,treatment:s.data.treatment,period:s.data.period,isolation:s.data.isolation},informationProvided:!!s.inquiryNotes?.[id],message:s.inquiryDraft||''};}
  function summary(s,facilityId) {
    const shared=s.selected===facilityId&&s.shareConsent;
    return {caseId:s.caseId,age:s.age,treatment:s.data.treatment||'구조화 전',isolation:s.data.isolation||'확인 필요',period:s.data.period||'확인 필요',patientNumber:shared?s.patientRecord?.number:null,contact:shared?s.patientRecord?.contact:null,
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
      case 'rejectCandidates': role('patient');at(3);need(['distance','cost','time'].includes(action.reason),'재탐색 사유를 선택해 주세요.');s.preferences={profile:{distance:'nearby',cost:'budget',time:'family'}[action.reason],priority:action.reason==='cost'?'cost':'distance',maxKm:action.reason==='distance'?15:25};s.stage=1;s.expanded=false;s.consent=false;s.inquiries=[];s.responses={};s.inquiryNotes={};s.lastAgent=null;detail='환자 후보 거절 사유를 재매칭 조건에 반영: '+({distance:'보호자 방문 거리',cost:'비용 부담',time:'이동 시간'}[action.reason])+' · 문의 동의 재확인';break;
      case 'profile': role('patient');need(s.stage>0&&s.stage<4,'기관 문의·선택 단계에서 조건을 바꿀 수 있습니다.');need(profiles[action.profile],'희망 조건을 확인해 주세요.');s.preferences={profile:action.profile,priority:action.profile==='budget'?'cost':'distance',maxKm:profiles[action.profile].maxKm};s.expanded=false;s.lastAgent=null;s.consent=false;if(s.stage>=2){s.stage=1;s.inquiries=[];s.responses={};s.inquiryNotes={};s.consent=false;}detail='환자 생활 조건 반영: '+profiles[action.profile].label+' · 변경 시 문의 동의 재확인';break;
      case 'recordAgent': role('hospital');need(action.result?.mode==='live'&&action.result.nextAction===agentAction(s),'AI 판단이 현재 단계와 일치하지 않습니다.');need(Array.isArray(action.result.recommendations)&&action.result.recommendations.every(r=>candidates(s).some(f=>f.id===r.id&&f.eligible)),'AI 추천 후보 검증에 실패했습니다.');s.lastAgent=action.result;s.agentRuns=s.agentRuns||[];s.agentRuns.unshift({model:action.result.model,action:action.result.nextAction,at:action.result.at});s.agentRuns=s.agentRuns.slice(0,8);if(action.result.inquiryDraft)s.inquiryDraft=action.result.inquiryDraft;detail='Gemini 업무 판단 · '+action.result.actionLabel+' · 근거 및 실행 조건 검증';break;
      case 'customPreferences': role('patient');need(s.stage>0&&s.stage<4,'기관 선택 전에만 희망 조건을 바꿀 수 있습니다.');s.preferences=customPreferences(action.values);s.stage=1;s.consent=false;s.inquiries=[];s.responses={};s.inquiryNotes={};s.expanded=false;s.lastAgent=null;detail='기준 지역·거리·비용·이동시간을 직접 입력 · 문의 동의 재확인';break;
      case 'transferPlan': role('hospital');at(4);{const v=action.values||{},plan={};for(const k of ['when','venue','address','contact','transport','notes']){need(typeof v[k]==='string'&&v[k].length<=(k==='notes'?1000:240),'방문 안내 입력을 확인해 주세요.');plan[k]=v[k].trim();}plan.confirmed=v.confirmed===true;need(scheduleValid({transferPlan:plan}),'방문 일시·장소·주소를 입력하고 수용기관과 확인해 주세요.');need(!plan.contact||/^[0-9+ ()-]{7,30}$/.test(plan.contact),'기관 연락처를 확인해 주세요.');s.transferPlan={...plan,updatedAt:new Date().toISOString()};s.prep.transport=false;s.prep.guidance=false;detail='수용기관과 확인한 방문 일정·장소·이동 안내 기록';}break;
      case 'handoffRequest': role('hospital');need((action.target==='patient'&&[1,3].includes(s.stage))||(action.target==='facility'&&[2,5].includes(s.stage)),'현재 단계의 요청 대상을 확인해 주세요.');s.handoffs=s.handoffs||{};s.handoffs[action.target]={at:new Date().toISOString(),stage:s.stage,round:s.round||0,method:'link',externalSent:false};detail=(action.target==='patient'?'환자·보호자':'수용기관')+'용 요청 링크 복사 기록 · 외부 발송 없음';break;
      case 'facilityUpdate': role('facility');need(s.stage<4,'기관 선택 이후에는 이 시연 건의 등록 조건을 바꿀 수 없습니다.');need(facilities.some(f=>f.id===action.id),'기관을 확인해 주세요.');need(Number.isInteger(action.beds)&&action.beds>=0&&action.beds<=20,'등록 병상은 0~20 사이 정수로 입력해 주세요.');s.facilityUpdates=s.facilityUpdates||{};s.facilityUpdates[action.id]={beds:action.beds,iv:!!action.iv,isolation:!!action.isolation,fresh:true,updated:'방금',registeredAt:new Date().toISOString()};s.lastAgent=null;if(s.stage===3&&!accepted(s).length){s.stage=1;s.consent=false;s.inquiries=[];s.responses={};s.inquiryNotes={};}detail=facilities.find(f=>f.id===action.id).name+' 처치 역량·병상 등록 갱신 (가상)';break;
      case 'timeout': role('simulation');at(2);need(s.inquiries.includes(action.id)&&!s.responses[action.id],'아직 응답이 없는 문의만 무응답 처리할 수 있습니다.');s.responses[action.id]={status:'timeout',reason:'기관 API 응답 기한 초과 · 재문의 필요',at:new Date().toISOString(),simulated:true};detail=facilities.find(f=>f.id===action.id).name+' 문의 응답 기한 초과 · 다음 후보 또는 예외 확인';break;
      case 'receipt': role('simulation');at(2);need(s.inquiries.includes(action.receipt?.id)&&!s.responses[action.receipt.id],'문의 또는 응답 상태를 확인해 주세요.');need(action.receipt.provider==='CareBridge Facility Sandbox'&&action.receipt.simulated&&['accepted','rejected','more'].includes(action.receipt.status),'기관 시연 API 응답 형식이 아닙니다.');s.responses[action.receipt.id]={status:action.receipt.status,reason:action.receipt.reason,at:action.receipt.at,simulated:true,receiptId:action.receipt.requestId,letter:action.receipt.letter,sentMessage:action.receipt.sentMessage};detail=facilities.find(f=>f.id===action.receipt.id).name+' 기관 시연 API 회신 수신';break;
      case 'preferences': role('patient');need(s.stage<4,'기관 선택 후에는 조건을 변경할 수 없습니다.');need(['distance','cost'].includes(action.priority),'정렬 기준을 확인해 주세요.');s.preferences.priority=action.priority;detail='환자·보호자 우선 조건 반영';break;
      case 'consent': role('patient');need(s.stage<4,'진행 단계를 확인해 주세요.');s.consent=!!action.value;if(!s.consent&&s.stage>=2){s.stage=1;s.inquiries=[];s.responses={};}detail=s.consent?'비식별 요약을 이용한 기관 문의 동의':'기관 문의 동의 철회 · 진행 문의 중단';break;
      case 'send': role('hospital');at(1);need(s.consent,'환자·보호자의 비식별 기관 문의 동의가 필요합니다.');need(!missing(s).length,'회송서 필수 항목을 먼저 보완해 주세요.');s.inquiries=candidates(s).filter(f=>f.eligible).map(f=>f.id);need(s.inquiries.length,'조건에 맞는 기관이 없습니다.');s.responses={};s.round++;s.stage=2;s.exception=null;detail=s.inquiries.length+'개 가상 기관에 비식별 수용 문의 생성 · 실제 전송 없음';break;
      case 'response': role('facility');at(2);need(s.inquiries.includes(action.id),'문의 대상 기관이 아닙니다.');need(['accepted','rejected','more'].includes(action.status),'응답을 선택해 주세요.');need(action.status==='accepted'||String(action.reason||'').trim(),'거절 또는 추가 확인 사유를 적어 주세요.');s.responses[action.id]={status:action.status,reason:String(action.reason||'수용 담당자 조건 확인 (시연)'),at:new Date().toISOString()};detail=facilities.find(f=>f.id===action.id).name+' 수용 응답 기록';break;
      case 'demoResponse': role('simulation');at(2);need(s.inquiries.includes(action.id),'문의 대상 기관이 아닙니다.');need(!s.responses[action.id],'이미 응답이 기록된 기관입니다.');{const f=facilities.find(f=>f.id===action.id),status=s.scenario==='unavailable'&&s.round===1?'rejected':s.inquiryNotes?.[action.id]?'accepted':f.response;s.responses[action.id]={status,reason:status==='rejected'?'희망 일정 수용 불가 (가상)':s.inquiryNotes?.[action.id]?'담당의 보완 정보 확인 후 수용 가능 (가상)':f.note,at:new Date().toISOString(),simulated:true};detail=f.name+' 모의 수용 응답 자동 수신';}break;
      case 'provideInfo': role('hospital');at(2);need(s.responses[action.id]?.status==='more','추가 정보 요청 건을 확인해 주세요.');need(action.confirmed,'담당의가 확인한 보완 정보인지 확인해 주세요.');need(String(action.note||'').trim(),'보완 회신 내용을 입력해 주세요.');s.inquiryNotes=s.inquiryNotes||{};s.inquiryNotes[action.id]=String(action.note).trim();delete s.responses[action.id];detail='추가 정보 요청에 담당의 확인 내용 회신 · 재응답 대기';break;
      case 'demoResponses': role('simulation');at(2);for(const id of s.inquiries){if(s.responses[id])continue;const f=facilities.find(f=>f.id===id);const status=s.scenario==='unavailable'&&s.round===1?'rejected':s.inquiryNotes?.[id]?'accepted':f.response;s.responses[id]={status,reason:status==='rejected'?'희망 일정 수용 불가 (가상)':f.note,at:new Date().toISOString()};}detail='미리 준비된 가상 기관 응답 불러오기 · 실제 응답 아님';break;
      case 'publish': role('hospital');at(2);need(accepted(s).length,'수용 가능 응답을 받은 기관이 없습니다. 재탐색 또는 예외 처리가 필요합니다.');s.stage=3;detail='수용 확인된 기관을 환자 비교 화면에 공개';break;
      case 'expand': role('hospital');need(s.stage===1||s.stage===2,'현재 단계에서는 재탐색할 수 없습니다.');s.expanded=true;s.stage=1;s.responses={};s.inquiryNotes={};s.inquiries=[];s.consent=false;s.exception=null;detail='예외 처리 · 이동 범위를 40km로 확장하여 재탐색 · 환자 동의 재확인';break;
      case 'choose': role('patient');at(3);need(accepted(s).some(f=>f.id===action.id),'수용이 확인된 기관만 선택할 수 있습니다.');need(action.consent,'선택한 기관에 정보를 전달하는 동의가 필요합니다.');s.selected=action.id;s.shareConsent=true;s.stage=4;for(const id of s.inquiries)if(id!==action.id)s.responses[id]={...s.responses[id],status:'withdrawn',reason:'다른 기관 선택으로 문의 종료'};detail='환자 기관 선택 및 선택 기관 한정 정보 전달 동의 · 실제 전원 확정 아님';break;
      case 'prep': role('hospital');at(4);need(Object.keys(s.prep).includes(action.key),'확인 항목을 확인해 주세요.');s.prep[action.key]=!!action.value;detail='전원 준비 확인: '+({documents:'회송 서류·원 처방',transport:'이동·입원 일정',guidance:'환자·보호자 안내'}[action.key]);break;
      case 'handoff': role('hospital');at(4);need(!s.requiresSchedule||scheduleValid(s),'방문 일정과 안내를 먼저 저장해 주세요.');need(Object.values(s.prep).every(Boolean),'전원 준비 항목을 모두 확인해 주세요.');s.stage=5;detail='기존 공식 회송 절차의 전달 기록 모의 생성 · 실제 EMR/HIRA 전송 없음';break;
      case 'visit': role('facility');at(5);need(action.id===s.selected,'선택한 수용기관만 진료 이행을 회신할 수 있습니다.');need(['done','missed'].includes(action.result),'진료 이행 여부를 선택해 주세요.');need(action.result!=='missed'||String(action.note||'').trim(),'미이행 사유 또는 추가 확인이 필요한 사항을 기록해 주세요.');s.visit={result:action.result,note:String(action.note||''),at:new Date().toISOString()};s.stage=6;s.exception=action.result==='missed'?'첫 진료 미이행':null;detail=action.result==='done'?'수용기관 첫 진료 이행 회신':'수용기관 첫 진료 미이행 회신 · 담당자 확인 필요';break;
      case 'ack': role('hospital');at(6);need(s.visit?.result==='done','미이행 건은 확인 완료로 처리할 수 없습니다.');s.ack=true;s.stage=7;detail='의뢰기관 담당자가 첫 진료 회신을 확인 · 연계 완료';break;
      case 'relink': role('hospital');at(6);need(s.visit?.result==='missed','미이행 건에서만 재연계할 수 있습니다.');s.stage=1;s.selected=null;s.shareConsent=false;s.consent=false;s.responses={};s.inquiries=[];s.visit=null;s.transferPlan=null;s.prep={documents:false,transport:false,guidance:false};s.expanded=true;s.exception=null;detail='미이행 사유 확인 후 재연계 시작 · 기관 선택과 정보 전달 동의 재확인 필요';break;
      default: throw new Error('지원하지 않는 작업입니다.');
    }
    if(action.type==='relink')s.inquiryNotes={};
    if(['source','preferences','consent','expand','relink'].includes(action.type))s.lastAgent=null;
    s.metrics.started=s.metrics.started||Date.now();s.metrics.actions++;
    s.events.unshift({type:action.type,actor,detail,time:new Date().toISOString()});return s;
  }
  const api={facilities,profiles,locations,customPreferences,scheduleValid,profile,score,agentAction,facilityRequest,stages,ageGroups,fields,initial,extract,missing,candidates,accepted,summary,transition};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CareBridge=api;
})(typeof globalThis!=='undefined'?globalThis:this);
