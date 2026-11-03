(function(){
  'use strict';
  const M=window.CareBridge,U=window.CareBridgeUX,R=window.CareBridgeRoutes,S=window.CareBridgeShared,P=window.CareBridgePatients,KEY='carebridge-prototype-v2';
  let renderedScope='';
  let taskRows=null,tasksLoading=false,tasksError='',taskFilter='active';
  let patientRows=null,patientQuery='',patientDetail=null,patientsLoading=false,patientsError='',patientSearchId=0;
  let sharedLoading=true,sharedError='',sourceDirty=false;
  let agentError='',basicMode=false,sourceEditMode=false;
  const roles={hospital:'의뢰기관',patient:'환자·보호자',facility:'수용기관',simulation:'자동 처리'};
  const initialRoute=R.parse(routeLocation());
  let state=M.initial(),role=initialRoute.role||'hospital',view=initialRoute.view,facility=initialRoute.facility||'saebom',compare=new Set(),toastTimer,consentDraft=false;
  let apiReady=false,aiAvailable=false,apiChecked=false,working=false,autoEnabled=true,autoRunning=false,autoRunId=0,generation=0,apiCalls=[],routeResults={},hospitalResults=null,hospitalFocus=null,hospitalArea='gwanak',hospitalLoading=false,hospitalError='',aiError='',liveMessage='서비스 준비 중';
  try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved?.version===1&&Number.isInteger(saved.stage)&&saved.stage>=0&&saved.stage<=7)state=saved;}catch{}
  if(!state.preferences.profile)state.preferences.profile='balanced';state.facilityUpdates=state.facilityUpdates||{};state.agentRuns=state.agentRuns||[];state.inquiryDraft=state.inquiryDraft||'';
  try{autoEnabled=localStorage.getItem(KEY+'-auto')!=='false';}catch{}
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>n.toLocaleString('ko-KR')+'원';
  const serviceText=value=>String(value??'').replace(/Gemini/g,'AI').replace(/기관 (?:\uC2DC\uC5F0|예시) API/g,'기관').replace(/기관 API/g,'기관').replace(/AI API/g,'AI').replace(/실제 API/g,'실제').replace(/API/g,'서비스').replace(/\uC2DC\uC5F0/g,'예시');
  const displayFact=value=>esc(serviceText(value).replace(/\s*\((?:가상(?:·비교용)?|예시(?: 기준)?)\)/g,''));
  const facilityType=f=>esc(f.type.replace(/^가상\s+/,''));
  const when=t=>new Date(t).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  const button=(text,action,cls='',extra='')=>{if(action.startsWith('go-')&&action.slice(3)!==role){const target=action.slice(3);return role==='hospital'&&((target==='patient'&&[1,3].includes(state.stage))||(target==='facility'&&[2,5].includes(state.stage)))?button(target==='patient'?'환자 요청 링크 준비':'기관 요청 링크 준비','request-handoff',cls,`data-id="${target}"`):'';}const dest=action.startsWith('go-')?rolePath(action.slice(3)):['case','history','flow','guide','hospitals','patients','tasks'].includes(action)?rolePath(role,action):null;return dest?`<a class="route-link ${cls}" href="${dest}" data-route="${dest}" data-action="${action}" ${extra}>${text}</a>`:`<button type="button" class="${cls}" data-action="${action}" ${extra}>${text}</button>`;};
  const badge=(text,tone='')=>`<span class="badge ${tone}">${text}</span>`;
  const statusBadge=x=>badge(`<span aria-hidden="true" class="status-symbol">${esc(x.icon)}</span>${esc(x.label)}`,x.tone+' status-badge');
  const capability=(label,yes)=>statusBadge({label:label+(yes?' 가능':' 불가'),tone:yes?'green':'red',icon:yes?'✓':'×'});
  const checks=(key,text,checked,more='')=>`<label class="check"><input type="checkbox" data-change="${key}" ${checked?'checked':''}><span>${text}${more?`<small>${more}</small>`:''}</span></label>`;
  const dl=(items)=>`<dl>${items.map(([k,v])=>`<div class="data-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const selected=()=>M.candidates(state).find(f=>f.id===state.selected);
  function toast(message,error=false){if(error&&$('#dialog').open){let alert=$('#dialog .dialog-error');if(!alert){alert=document.createElement('p');alert.className='notice red dialog-error';alert.setAttribute('role','alert');$('#dialog .dialog-body').prepend(alert);}alert.textContent=serviceText(message);alert.scrollIntoView({block:'nearest'});}const t=$('#toast');t.textContent=serviceText(message);t.className='show'+(error?' toast-error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='',4000);}
  function routeLocation(){return location.protocol==='file:'?(location.hash.startsWith('#/')?location.hash.slice(1):'/'):location.pathname;}
  function rolePath(r,v='case',id){
    const receiver=id||state.selected||(state.stage===2&&state.inquiries.length?state.inquiries.includes(facility)?facility:state.inquiries[0]:facility);
    return R.path({role:r,view:v,facility:receiver});
  }
  function writeRoute(path,replace=false){
    const target=location.protocol==='file:'?'#'+path:S.href(path)||path;
    if(location.pathname+location.hash!==target||replace)history[replace?'replaceState':'pushState']({},'',target);
  }
  async function navigateRoute(path,{replace=false,pop=false}={}){
    if(pop&&S.parseLink(location.hash)?.id!==S.session?.id){sharedLoading=true;render();try{const loaded=await S.init();if(loaded)state=loaded.state;}catch(e){sharedError=e.message;}finally{sharedLoading=false;}}
    if(S.active&&!S.can(path)){toast('해당 역할의 이용 링크가 필요합니다.',true);return;}
    const dest=R.parse(path);if(view==='patients'||dest.view==='patients')resetPatientSearch();if(S.active)generation++;close();
    if(dest.role==='facility'&&state.stage===2&&autoEnabled){autoEnabled=false;generation++;autoRunId++;autoRunning=false;liveMessage='수용기관 직접 응답 모드';save();}
    role=dest.role||'hospital';view=dest.view;
    if(dest.role==='facility')facility=dest.facility||state.selected||state.inquiries[0]||'saebom';
    const canonical=dest.role?rolePath(role,view,facility):view==='home'?'/':path;
    if(!pop)writeRoute(canonical,replace);else if(canonical!==path)writeRoute(canonical,true);
    if(S.active){sharedLoading=true;render();try{const data=await S.refresh();state=data.state;sharedError='';sourceDirty=false;}catch(e){sharedError=e.message;}finally{sharedLoading=false;}}
    render();window.scrollTo(0,0);$('#main')?.focus({preventScroll:true});
    if(view==='tasks')loadTasks();
    if(view==='hospitals'&&!hospitalResults)loadHospitals();
    if(view==='case')queueMicrotask(kickAutomation);
  }
  function portalMarkup(){
    const entries=[['hospital','의뢰기관','회송 정보 확인과 기관 문의','진행 현황과 회신을 확인하고 전원을 준비합니다.'],['patient','환자·보호자','희망 조건과 병원 비교·선택','수용 가능한 병원을 비교하고 진행 상황을 확인합니다.'],['facility','수용기관','수용 문의와 첫 진료 회신','도착한 문의에 응답하고 진료 이행 여부를 전달합니다.']];
    return `<div class="demo-strip"><span><strong>서비스 프로토타입</strong> · 환자·기관 응답은 예시 데이터입니다. 실제 환자 정보를 입력하지 마세요.</span></div><header><a class="brand" href="/" data-route="/" aria-label="케어브릿지 첫 화면으로"><div class="brand-mark" aria-hidden="true">cb</div><div><strong>케어브릿지</strong><span>CAREBRIDGE</span></div></a><span class="current-workspace">비응급 전원·회송 연계</span></header><main id="main" class="portal-main" tabindex="-1"><div class="portal-intro"><p class="eyebrow">CAREBRIDGE</p><h1>케어브릿지</h1><p>기관 탐색부터 첫 진료 확인까지.<br>이용할 화면을 선택해 주세요.</p></div><nav class="portal-entries" aria-label="역할별 서비스">${entries.map(([r,title,task,desc],i)=>`<a class="portal-entry" href="${rolePath(r,'tasks')}" data-route="${rolePath(r,'tasks')}"><span class="portal-entry-index">0${i+1}</span><div><h2>${title}</h2><strong>${task}</strong><p>${desc}</p></div><span class="portal-arrow" aria-hidden="true">→</span></a>`).join('')}</nav>${state.events.length?`<section class="portal-resume"><div><h2>진행 중인 회송</h2><p>${esc(state.caseId)} · ${esc(M.stages[state.stage])}${state.stage===7?' · 완료':''}</p></div><a class="route-link primary" href="${rolePath(nextRole())}" data-route="${rolePath(nextRole())}">진행 기록 이어보기</a></section>`:''}<details class="support-details receiver-links"><summary>수용기관별 화면 주소</summary><div>${M.facilities.map(f=>`<a class="route-link small" href="${rolePath('facility','case',f.id)}" data-route="${rolePath('facility','case',f.id)}">${esc(f.name)}</a>`).join('')}</div></details><p class="portal-note">각 화면은 별도 주소로 열립니다. 진행 정보는 현재 브라우저에 저장되며, 다른 기기와 자동 공유되지는 않습니다.</p><footer class="app-footer">서울대학교 산업공학과 · 헬스케어 서비스 혁신 프로젝트 / CareBridge</footer></main>`;
  }

  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));localStorage.setItem(KEY+'-auto',String(autoEnabled));}catch{toast('이 브라우저에서는 진행 상태를 저장할 수 없습니다.');}}
  function setBusy(value,label='진행 상태를 반영하고 있습니다…'){
    working=value;document.body.classList.toggle('is-working',value);document.body.setAttribute('aria-busy',String(value));
    if(value){for(const el of document.querySelectorAll('button,input,select,textarea')){if(el.disabled||el.dataset.action==='close'||el.dataset.action==='toggle-auto')continue;el.dataset.busyDisabled='true';el.disabled=true;}let status=document.querySelector('#busy-status');if(!status){status=document.createElement('div');status.id='busy-status';status.setAttribute('role','status');document.body.append(status);}status.textContent=label;}
    else{for(const el of document.querySelectorAll('[data-busy-disabled]')){el.disabled=false;delete el.dataset.busyDisabled;}document.querySelector('#busy-status')?.remove();}
  }
  async function analyzeAI(){
    if(working)return;if(!state.doctorApproved){toast('담당의의 비응급 회송 결정을 먼저 확인해 주세요.',true);return;}
    if(state.source!==M.initial(state.scenario).source){toast('AI는 준비된 예시 회송서만 분석합니다. 편집한 문서는 기본 항목 점검을 사용해 주세요.',true);return;}
    const epoch=generation;aiError='';setBusy(true,'AI가 가상 회송서를 분석하고 원문과 대조하고 있습니다…');
    try{const start=performance.now(),r=await fetch('/api/extract?scenario='+state.scenario,{signal:AbortSignal.timeout(25000)}),result=await r.json();result.cached=!!result.cached||['HIT','STALE'].includes(r.headers.get('x-vercel-cache'))||Number(r.headers.get('age'))>0;apiCalls.unshift({action:'AI 문서 추출',status:r.status,ms:Math.round(performance.now()-start),time:new Date().toISOString()});if(!r.ok)throw Error(result.error);if(epoch!==generation)return;setBusy(false);if(await act({type:'applyExtraction',result}))toast('AI 분석과 원문 대조를 완료했습니다.');}
    catch(e){if(epoch===generation){aiError=e.message||'AI 분석을 잠시 후 다시 시도해 주세요.';setBusy(false);render();toast('AI 분석을 완료하지 못했습니다. 기본 항목 점검으로 계속할 수 있습니다.',true);}}finally{setBusy(false);}
  }
  async function act(action,actor=role){
    if(working){toast('앞선 요청을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.');return false;}
    setBusy(true);const epoch=generation;
    try{let next;const started=performance.now();
      if(S.active){const result=await (actor==='simulation'?S.simulate(action):S.transition(action));if(result.conflict){state=result.state;save();render();toast('다른 화면의 변경 내용을 불러왔습니다. 내용을 확인하고 다시 진행해 주세요.',true);return false;}next=result.state;}
      else if(apiReady){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);try{const response=await fetch('/api/transition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,action,actor}),signal:controller.signal});const result=await response.json();apiCalls.unshift({action:action.type,status:response.status,ms:Math.round(performance.now()-started),time:new Date().toISOString()});apiCalls=apiCalls.slice(0,40);if(!response.ok)throw Error(result.error);next=result.state;}finally{clearTimeout(timeout);}}
      else{next=M.transition(state,action,actor);}
      if(epoch!==generation)return false;const stageChanged=state.stage!==next.stage;state=next;save();working=false;render();if(stageChanged){$('.page-heading')?.scrollIntoView({block:'start',behavior:'smooth'});$('#task-title')?.focus({preventScroll:true});}queueMicrotask(kickAutomation);return true;
    }catch(e){if(epoch===generation){state.metrics.errors++;save();toast(e.name==='AbortError'?'처리 시간이 초과되었습니다. 진행 상태는 유지했습니다.':e.message||'작업을 완료하지 못했습니다.',true);}return false;}
    finally{setBusy(false);}
  }
  async function runAgent(){
    if(S.active)return sharedAdvance();
    if(working)return false;const epoch=generation;agentError='';setBusy(true,'AI가 환자 조건과 기관 회신을 확인하고 있습니다…');
    try{const start=performance.now(),r=await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state}),signal:AbortSignal.timeout(27000)}),result=await r.json();apiCalls.unshift({action:'Gemini 매칭·업무 판단',status:r.status,ms:Math.round(performance.now()-start),time:new Date().toISOString()});if(!r.ok)throw Error(result.error||'AI 업무 판단에 실패했습니다.');if(epoch!==generation)return false;setBusy(false);return await act({type:'recordAgent',result},'hospital');}
    catch(e){if(epoch===generation){agentError=e.name==='TimeoutError'?'AI 응답 시간이 초과되었습니다. 다시 시도할 수 있습니다.':e.message;setBusy(false);render();toast('AI 업무 판단을 완료하지 못해 자동 진행을 멈췄습니다.',true);}return false;}finally{setBusy(false);}
  }
  async function facilityReceipt(id,snapshot){
    for(let attempt=0;attempt<2;attempt++){
      try{
        const start=performance.now(),r=await fetch('/api/facility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:M.facilityRequest(snapshot,id)}),signal:AbortSignal.timeout(6000)}),result=await r.json();
        apiCalls.unshift({action:M.facilities.find(f=>f.id===id).name+' 기관 예시 API',status:r.status,ms:Math.round(performance.now()-start),time:new Date().toISOString()});
        if(r.ok)return {id,receipt:result.receipt};
        if(r.status>=400&&r.status<500)return {id,requestError:true,message:result.error||'문의 요약의 형식을 확인해 주세요.'};
        if(attempt===1)return {id,requestError:true,message:'기관 문의를 완료하지 못했습니다. 다시 시도해 주세요.'};
      }catch(e){if(attempt===1)return e.name==='TimeoutError'||e.name==='AbortError'?{id,error:true}:{id,requestError:true,message:'기관 문의 통신을 완료하지 못했습니다. 다시 시도해 주세요.'};}
    }
  }
  async function sharedAdvance(){
    if(working||autoRunning||sharedLoading||sharedError||role==='facility')return false;
    autoRunning=true;const epoch=generation,oldRevision=S.revision;agentError='';setBusy(true,'기관 문의와 회신을 확인하고 있습니다…');
    try{
      const result=await S.advance(basicMode||state.automationMode==='basic');if(epoch!==generation)return false;
      state=result.state;save();setBusy(false);render();
      if(result.conflict)toast('다른 화면의 변경 내용을 반영했습니다.');
      if(S.revision!==oldRevision&&autoEnabled&&sharedCanAdvance())queueMicrotask(()=>{autoRunning=false;kickAutomation();});
      return !result.conflict;
    }catch(e){agentError=e.message;toast('자동 처리를 완료하지 못했습니다. 다시 시도할 수 있습니다.',true);return false;}
    finally{autoRunning=false;setBusy(false);render();}
  }
  function sharedCanAdvance(){const pending=state.inquiries.some(f=>!state.responses[f]);return state.consent&&(state.stage===1&&M.candidates(state).some(f=>f.eligible)||state.stage===2&&(state.automationMode==='basic'?pending||M.accepted(state).length>0:pending||!state.lastAgent||state.lastAgent.nextAction!==M.agentAction(state)));}
  async function initializeSharing(){
    sharedLoading=true;sharedError='';render();
    try{
      const registryLink=view==='patients'&&new URLSearchParams(location.hash.slice(1)).has('register');
      const [loaded,status]=await Promise.allSettled([registryLink?null:S.init(),location.protocol==='file:'?null:fetch('/api/cases?status=1',{signal:AbortSignal.timeout(6000)}).then(r=>r.ok?r.json():null)]);
      S.available=status.status==='fulfilled'&&status.value?.available===true;
      if(loaded.status==='rejected')throw loaded.reason;const data=loaded.value;
      if(data){state=data.state;sourceDirty=false;save();writeRoute(routeLocation(),true);}
    }catch(e){sharedError=e.message;}
    finally{await checkApi();sharedLoading=false;render();if(view==='tasks')loadTasks();kickAutomation();}
  }
  async function refreshShared(){
    if(!S.active||working||autoRunning||sharedLoading||sourceDirty||$('#dialog').open||document.hidden)return;
    const active=document.activeElement;if(active?.matches('input,textarea,select'))return;
    try{const old=S.revision,oldProfiles=S.session.profileRevision,result=await S.refresh();if(result.stale)return;if(old!==result.revision||oldProfiles!==result.profileRevision||sharedError){generation++;state=result.state;sharedError='';agentError='';save();render();}if(sharedCanAdvance())queueMicrotask(kickAutomation);}
    catch(e){sharedError=e.message;render();}
  }
  function enhanceShared(){
    const header=document.querySelector('header');
    if(header&&!header.querySelector('.case-tools'))header.insertAdjacentHTML('beforeend',`<div class="case-tools">${S.active?button('이용 링크','share-links','small'):''}${button('처음부터 시작','reset','small')}</div>`);
    for(const a of document.querySelectorAll('a[data-route],a.brand')){
      const path=a.dataset.route||'/';const href=S.href(path);
      if(href)a.href=href;
      else{const note=document.createElement('span');note.className=a.className+' unavailable-entry';note.innerHTML=a.classList.contains('portal-entry')?a.innerHTML+'<small>별도 이용 링크가 필요합니다.</small>':'다음 담당자 처리 대기';a.replaceWith(note);}
    }
    const note=$('.portal-note');if(note)note.textContent=S.active?'이 회송 건은 참여자의 이용 링크로 연결됩니다. 다른 화면에서 처리한 내용도 자동으로 반영됩니다.':'처음부터 시작하면 새 회송 건을 만듭니다. 로고를 눌러 첫 화면으로 돌아가도 기존 기록은 유지됩니다.';
    const resume=$('.portal-resume');if(resume)resume.insertAdjacentHTML('beforeend',button('처음부터 시작','reset','small'));
    if(view==='home'){
      const previous=S.book().filter(x=>x.id!==S.session?.id);
      if(previous.length)$('#main').insertAdjacentHTML('beforeend',`<details class="support-details saved-cases"><summary>이전에 시작한 회송 ${previous.length}건</summary>${previous.slice(0,10).map(x=>`<a class="saved-case" href="${esc(S.historyHref(x))}"><strong>${esc(x.caseId)}</strong><span>${esc(M.stages[x.stage]||'회송 정보')} · 기록 열기 →</span></a>`).join('')}</details>`);
      try{const old=JSON.parse(localStorage.getItem(KEY+'-archives')||'[]').map((x,i)=>({...x,index:i})).filter(x=>x.state?.caseId==='CB-026-001');if(old.length)$('#main').insertAdjacentHTML('beforeend',`<details class="support-details saved-cases"><summary>이전 브라우저 기록</summary>${old.map(x=>`<div class="saved-case"><span>${esc(x.state.caseId)} · ${esc(M.stages[x.state.stage])}</span>${button('기록 열기','restore-local','small',`data-id="${x.index}"`)}</div>`).join('')}</details>`);}catch{}
    }
    if(S.active&&view==='case')$('.focused-heading')?.insertAdjacentHTML('beforeend','<span class="badge green shared-indicator">공유 기록 연결됨</span>');
    if(view==='case'&&state.patientRecord&&(role==='hospital'||role==='facility'&&state.selected===facility&&state.shareConsent)){const p=state.patientRecord;$('.focused-heading')?.insertAdjacentHTML('afterend',`<section class="patient-identity" aria-label="회송 대상 환자"><div><span class="tiny">회송 대상자</span><strong>${esc(p.name)}</strong><span class="patient-number">${esc(p.number)}</span><span>${esc(p.age)}</span></div><div><span class="tiny">연락처</span><span>${esc(p.contact||'미등록')}</span>${role==='hospital'&&state.stage===0&&!state.doctorApproved&&!state.parsed?button('환자 다시 선택','patients','small'):''}</div></section>`);}
    if(view==='home'&&(!S.active||S.session?.credentials.hospital))$('.portal-intro')?.insertAdjacentHTML('beforeend',button('환자 검색·등록','patients','primary'));
  }
  function shareLinks(){
    const targets=[['hospital','의뢰기관'],['patient','환자·보호자'],...M.facilities.map(f=>['facility/'+f.id,f.name])].filter(([key])=>S.session?.credentials[key]);
    modal('회송 건 이용 링크',`<p>같은 회송 건을 각자의 기기에서 이어갈 수 있습니다. 해당 역할의 링크를 참여자에게 전달해 주세요.</p><p class="tiny">링크를 가진 사람만 이 예시 회송 건에 접근합니다. 실제 환자 정보는 입력하지 마세요.</p><div class="share-links">${targets.map(([key,label])=>{const path='/'+key;return `<div class="share-link-row"><label class="field"><span>${esc(label)}</span><input readonly value="${esc(location.origin+S.href(path))}" aria-label="${esc(label)} 이용 링크"></label>${button('링크 복사','copy-role-link','small',`data-id="${key}"`)}</div>`;}).join('')}</div>`,button('닫기','close','primary'));
  }
  function taskInfo(c){
    const actionable=role==='hospital'?[0,4,6].includes(c.stage):role==='patient'?(c.stage===1&&!c.consent||c.stage===3):c.stage===2&&!c.response||c.stage===5&&c.selected===facility;
    const done=c.stage===7||role==='facility'&&c.stage>=4&&c.selected!==facility;
    return {actionable,done,label:done?'완료':actionable?'처리 필요':'응답 대기'};
  }
  function tasksPage(){
    const rows=taskRows||[],visible=rows.filter(c=>taskFilter==='all'?true:taskFilter==='done'?taskInfo(c).done:taskFilter==='todo'?taskInfo(c).actionable:!taskInfo(c).done);
    return pageHead('내 할 일','내 역할에서 확인하거나 처리할 회송 건을 모아 봅니다.')+`<section class="panel"><div class="panel-head"><h2>회송 업무 목록</h2>${button('새로고침','tasks-refresh','small')}</div><div class="row">${[['active','진행 중'],['todo','처리 필요'],['done','완료'],['all','전체']].map(([id,label])=>button(label,'task-filter',taskFilter===id?'selected small':'small',`data-id="${id}" aria-pressed="${taskFilter===id}"`)).join('')}</div><p class="tiny">${role==='hospital'?'현재 환자 목록의 최근 50건과 이 브라우저의 이용 링크':'이 브라우저에서 이용 링크로 연결한 회송 건'} · ${rows.filter(c=>taskInfo(c).actionable).length}건 처리 필요 · 15초마다 갱신</p>${tasksLoading?'<p role="status">업무 목록을 불러오고 있습니다…</p>':tasksError?`<p class="notice amber" role="alert">${esc(tasksError)}</p>`:!visible.length?'<p class="empty-patient">해당하는 회송 건이 없습니다. 환자는 검색·등록한 뒤 새 회송을 시작하고, 환자·수용기관은 전달받은 이용 링크로 연결해 주세요.</p>':visible.map(c=>{const info=taskInfo(c);return `<article class="task-list-row"><div><strong>${esc(c.case_number)}</strong><p>${esc(c.name||'비식별 의뢰 대상자')} ${esc(c.number||'')}</p><span>${esc(M.stages[c.stage])}</span></div><div class="row">${badge(info.label,info.done?'green':info.actionable?'navy':'amber')}${role==='hospital'&&c.patient_id?button(info.done?'기록 보기':'이어서 처리','patient-history-open','small',`data-id="${c.id}" data-patient="${c.patient_id}"`):`<a class="route-link small" href="${esc(c.href)}">${info.done?'기록 보기':'회송 열기'}</a>`}</div></article>`;}).join('')}</section>${role==='hospital'?button('환자 검색·등록','patients','primary'):''}`;
  }
  async function loadTasks(){if(tasksLoading)return;tasksLoading=true;tasksError='';render();try{if(role==='hospital'){const [registered,linked]=await Promise.all([P.tasks(),S.tasks(role,facility)]);taskRows=[...registered.cases,...linked.filter(c=>!registered.cases.some(r=>r.id===c.id))];}else taskRows=await S.tasks(role,facility);}catch(e){tasksError=e.message;}finally{tasksLoading=false;if(view==='tasks')render();}}
  function transferPlanSummary(){const p=state.transferPlan;return !p?'<p class="notice amber">방문 일정 확인 중입니다. 확정된 안내가 등록되면 이 화면에 표시됩니다.</p>':`<section class="visit-guide" aria-label="방문 일정과 안내"><h3>수용기관과 확인한 방문 안내</h3>${dl([['방문 일시',esc(p.when.replace('T',' '))+' (한국 시간)'],['방문 장소',esc(p.venue)],['주소',esc(p.address)],['기관 연락처',esc(p.contact||'추가 확인 필요')],['이동 방법',esc(p.transport||'별도 안내')],['준비물·안내',esc(p.notes||'별도 안내')]])}<p class="tiny">담당자가 수용기관과 확인하여 기록한 안내입니다. 변경 시 의뢰기관에 확인해 주세요.</p></section>`;}
  function transferPlanForm(){const p=state.transferPlan||{};return `<section class="visit-plan"><h3>방문 일정과 환자 안내</h3><form id="transfer-plan-form"><div class="patient-registration-grid">${[['when','방문 일시 (한국 시간)','datetime-local'],['venue','방문 장소','text'],['address','방문 주소','text'],['contact','기관 연락처','tel'],['transport','이동 방법','text'],['notes','준비물·추가 안내','text']].map(([k,label,type])=>`<label class="field"><span>${label}${['when','venue','address'].includes(k)?' · 필수':''}</span><input id="plan-${k}" type="${type}" value="${esc(p[k]||'')}" maxlength="${k==='notes'?1000:240}" ${['when','venue','address'].includes(k)?'required':''}></label>`).join('')}</div><label class="check"><input id="plan-confirmed" type="checkbox" ${p.confirmed?'checked':''} required><span>수용기관과 방문 일시·장소를 확인했습니다.</span></label><button type="submit">방문 안내 저장</button></form><p class="tiny">저장하면 환자·보호자와 선택한 수용기관에 안내가 표시됩니다. 변경 후 일정·안내 체크를 다시 확인합니다.</p>${p.updatedAt?`<p class="badge green">방문 안내 저장됨 · ${when(p.updatedAt)}</p>`:''}</section>`;}
  function handoffModal(target){const path=rolePath(target),href=S.href(path);if(!href){toast('해당 역할의 이용 링크가 필요합니다.',true);return;}modal(target==='patient'?'환자·보호자에게 요청':'수용기관에 회신 요청',`${handoffProgress(target)}<p>이 링크를 해당 담당자에게 전달해 주세요. 전달 후에는 내 할 일에서 응답 상태를 확인할 수 있습니다.</p><label class="field"><span>요청 링크</span><input readonly value="${esc(location.origin+href)}" id="handoff-link"></label><p class="tiny">외부 문자·알림은 자동 발송되지 않습니다. 링크 복사 기록과 상대방의 실제 응답은 구분해 표시합니다.</p>`,button('닫기','close')+button('링크 복사하고 요청 기록','copy-handoff','primary',`data-id="${target}"`));}
  function patientsPage(){
    const selected=patientDetail?.patient;
    const canAttach=S.active&&state.stage===0&&!state.parsed&&!state.doctorApproved;
    return pageHead('환자 검색·등록','등록된 환자를 찾아 정보를 확인한 뒤 회송 대상자로 불러옵니다.')+
      `<section class="panel patient-search-panel"><div class="patient-search-head"><h2>환자 찾기</h2><div class="row">${button('환자 신규 등록','patient-register','primary')}${button('환자 목록 이용 링크','patient-directory-link','small')}</div></div><form id="patient-search-form" class="patient-search-form"><label class="field"><span>이름 또는 환자번호</span><input id="patient-query" type="search" maxlength="80" placeholder="예: 김하늘 또는 CB-P1001" value="${esc(patientQuery)}" autocomplete="off"></label><button type="submit" class="primary">검색</button>${patientQuery?button('검색 초기화','patient-search-clear','small'):''}</form><p class="tiny">환자번호는 병원 등록번호입니다. 실제 환자 정보를 입력하지 마세요.</p></section>`+
      (patientsError?`<div class="notice amber" role="alert">${esc(patientsError)} ${button('다시 불러오기','patient-search','small')}</div>`:'')+
      (patientRows===null&&!patientsLoading?`<section class="panel empty-patient"><h2>이름 또는 환자번호로 검색해 주세요.</h2><p>검색한 환자만 표시됩니다.</p></section>`:`<div class="patient-directory-layout"><section class="panel patient-results"><div class="panel-head"><h2>검색 결과 ${patientRows?.length??0}명</h2><span class="tiny">최대 30명</span></div>${patientsLoading?'<p role="status" class="pending">환자 목록을 불러오고 있습니다…</p>':patientRows?.length?`<div class="patient-table-scroll"><table class="patient-table"><thead><tr><th>이름</th><th>환자번호</th><th>연령대</th><th>회송 이력</th><th>확인</th></tr></thead><tbody>${patientRows.map(p=>`<tr class="${selected?.id===p.id?'selected-patient':''}"><td><strong>${esc(p.name)}</strong></td><td>${esc(p.number)}</td><td>${esc(p.age)}</td><td>${p.case_count||0}건</td><td>${button('정보 보기','patient-detail','small',`data-id="${p.id}" aria-label="${esc(p.name)} ${esc(p.number)} 정보 보기"`)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-patient"><h3>${patientQuery?'검색 결과가 없습니다.':'등록된 환자가 없습니다.'}</h3><p>이름·환자번호를 확인하거나 새로운 환자를 등록해 주세요.</p>${button('환자 신규 등록','patient-register','small')}</div>`}</section>
      <section class="panel patient-details" aria-label="선택한 환자 정보">${selected?`<p class="eyebrow">선택한 환자</p><h2>${esc(selected.name)}</h2>${dl([['환자번호',esc(selected.number)],['연령대',esc(selected.age)],['연락처',esc(selected.contact||'미등록')]])}<p class="notice">이름과 환자번호가 회송 대상자와 일치하는지 확인해 주세요. 회송서와 처방은 불러온 뒤 별도로 확인합니다.</p><div class="patient-detail-actions">${canAttach?button('회송 대상자로 선택','patient-attach','primary',`data-id="${selected.id}"`):''}${canAttach?`<details class="patient-new-options"><summary>다른 회송 건 만들기</summary><p class="tiny">현재 건을 유지하고 별도의 새 회송을 만듭니다.</p>${button('이 환자로 새 회송 시작','patient-new-case','small',`data-id="${selected.id}"`)}</details>`:button('이 환자로 새 회송 시작','patient-new-case','primary',`data-id="${selected.id}"`)}</div>${canAttach?`<p class="tiny">현재 회송: ${esc(state.caseId)}</p>`:''}<details class="support-details patient-case-history"><summary>이 환자의 회송 이력 ${patientDetail.cases.length}건</summary>${patientDetail.cases.length?patientDetail.cases.map(c=>`<div class="patient-history-row"><strong>${esc(c.case_number)}</strong><span>${esc(M.stages[c.stage])}</span>${button(c.stage===7?'기록 보기':'이어서 처리','patient-history-open','small',`data-id="${c.id}" data-patient="${selected.id}"`)}</div>`).join(''):'<p class="tiny">아직 연결된 회송 이력이 없습니다.</p>'}</details>`:'<div class="empty-patient"><h2>환자를 선택해 주세요.</h2><p>검색 결과에서 ‘정보 보기’를 누르면 환자 정보와 회송 이력을 확인할 수 있습니다.</p></div>'}</section></div>`);
  }
  function resetPatientSearch(){patientSearchId++;patientQuery='';patientRows=null;patientDetail=null;patientsLoading=false;patientsError='';}
  async function loadPatients(query=patientQuery){
    if(patientsLoading)return;patientQuery=query.trim();
    if(!patientQuery){resetPatientSearch();render();$('#patient-query')?.focus();return;}
    const searchId=++patientSearchId;patientsLoading=true;patientsError='';patientRows=[];patientDetail=null;render();
    try{const data=await P.search(patientQuery);if(searchId!==patientSearchId)return;patientRows=data.patients;}
    catch(e){if(searchId!==patientSearchId)return;patientsError=e.message;patientRows=[];}
    finally{if(searchId===patientSearchId){patientsLoading=false;if(view==='patients')render();}}
  }

  function patientRegisterModal(){
    modal('환자 신규 등록',`<p class="sub">한 번 등록한 환자는 이름·환자번호로 다시 불러올 수 있습니다.</p><form id="patient-register-form"><div class="patient-registration-grid"><label class="field"><span>환자 이름 <b class="required">필수</b></span><input id="patient-name" required minlength="2" maxlength="40" autocomplete="off" placeholder="예: 홍길동"></label><label class="field"><span>환자번호 · 병원 등록번호 <b class="required">필수</b></span><input id="patient-number" required minlength="3" maxlength="24" pattern="[A-Za-z0-9-]{3,24}" autocomplete="off" placeholder="예: CB-P1004"><small>영문·숫자·하이픈 3~24자</small></label><label class="field"><span>연령대 <b class="required">필수</b></span><select id="patient-age">${M.ageGroups.map(age=>`<option ${age==='70대'?'selected':''}>${age}</option>`).join('')}</select></label><label class="field"><span>연락처 <small>선택</small></span><input id="patient-contact" type="tel" inputmode="tel" maxlength="13" autocomplete="off" placeholder="예: 010-0000-0000"></label></div><p class="tiny">예시 환자만 등록해 주세요. 환자 기본 정보는 회송서 분석과 별도로 저장됩니다.</p></form>`,button('취소','close')+button('환자 등록','patient-save','primary'));
  }
  async function usePatient(id,newCase=false){
    if(working)return;setBusy(true,'환자 정보를 불러오고 있습니다…');
    try{
      const selection=P.selection(id),newReferral=newCase||!S.active,result=newReferral?await S.create('normal',selection):await S.assignPatient(selection);
      if(result.conflict){state=result.state;toast('회송 상태가 변경되었습니다. 대상자를 다시 확인해 주세요.',true);render();return;}
      generation++;state=result.state;if(newReferral){autoEnabled=true;basicMode=false;}sourceEditMode=false;sourceDirty=false;aiError='';agentError='';sharedError='';consentDraft=false;compare.clear();role='hospital';view='case';save();writeRoute('/hospital');setBusy(false);render();window.scrollTo(0,0);toast('환자 정보를 불러왔습니다. 회송 내용을 확인해 주세요.');
    }catch(e){toast(e.message,true);}finally{setBusy(false);}
  }
  async function kickAutomation(){
    if(sharedLoading||sharedError)return;
    if(view==='home'||view==='not-found')return;
    if(!autoEnabled||autoRunning||working||!apiChecked)return;
    if(!(state.stage===1&&state.consent||state.stage===2&&state.consent))return;
    if(agentError)return;
    if(S.active){if(role==='facility'||!sharedCanAdvance())return;await sharedAdvance();return;}
    autoRunning=true;const epoch=generation,runId=++autoRunId;
    try{
      if(state.stage===1){
        liveMessage=basicMode?'기본 점검 후 문의 준비':'Matching Agent · 환자 조건과 기관 근거 분석';render();
        if(!basicMode&&!await runAgent())return;
        if(!autoEnabled||epoch!==generation||!state.consent||state.stage!==1)return;
        if(!basicMode&&state.lastAgent?.nextAction!=='send_inquiries'){liveMessage='조건에 맞는 기관 없음 · 담당자 예외 처리 필요';render();return;}
        if(!await act({type:'send'},'hospital'))return;
      }
      const round=state.round,pending=state.inquiries.filter(id=>!state.responses[id]);
      if(pending.length){
        const inquiryReady=state.inquiryDraft&&['treatment','period','isolation'].every(k=>state.inquiryDraft.includes(M.fields[k]+': '+state.data[k]));
        if(!basicMode&&!inquiryReady){liveMessage='문의 초안을 작성·검증한 뒤 기관에 전달합니다.';render();if(!await runAgent())return;}
        if(!autoEnabled||epoch!==generation||state.stage!==2||!state.consent)return;
        liveMessage=pending.length+'개 기관의 수용 여부를 확인하고 있습니다.';render();
        if(basicMode){for(const id of pending){if(!autoEnabled||epoch!==generation||state.stage!==2)return;await act({type:'demoResponse',id},'simulation');}}
        else{
          const results=await Promise.all(pending.map(id=>facilityReceipt(id,JSON.parse(JSON.stringify(state)))));
          for(const result of results){if(!autoEnabled||epoch!==generation||state.stage!==2||!state.consent||state.round!==round)return;if(state.responses[result.id]||result.requestError)continue;await act(result.error?{type:'timeout',id:result.id}:{type:'receipt',receipt:result.receipt},'simulation');}
          const failed=results.find(r=>r.requestError);if(failed){agentError=M.facilities.find(f=>f.id===failed.id).name+': '+failed.message;liveMessage='기관 문의 요청 확인 필요 · 무응답으로 처리하지 않았습니다.';render();return;}
        }
      }
      if(!autoEnabled||epoch!==generation||state.stage!==2||!state.consent)return;
      if(!basicMode){liveMessage='AI가 기관 회신을 분석하고 다음 작업을 확인합니다.';render();if(!await runAgent())return;}
      if(autoEnabled&&epoch===generation&&state.stage===2&&M.accepted(state).length&&(basicMode||state.lastAgent?.nextAction==='present_candidates')){liveMessage='수용 확인된 후보 공개 · 환자 선택 대기';await act({type:'publish'},'hospital');toast('기관 회신과 추천 근거를 비교 화면에 반영했습니다.');}
      else if(state.stage===2){liveMessage='기관 회신 분석 완료 · 보완 요청 또는 재탐색이 필요합니다.';render();}
    }finally{if(runId===autoRunId)autoRunning=false;}
  }
  function allAnsweredWithoutAcceptance(){return state.stage===2&&state.inquiries.length>0&&state.inquiries.every(id=>state.responses[id])&&!M.accepted(state).length;}
  function nextRole(){return state.stage===0?'hospital':state.stage===1&&!state.consent?'patient':state.stage===2?(allAnsweredWithoutAcceptance()?'hospital':'facility'):state.stage===3?'patient':state.stage===5?'facility':'hospital';}
  function connectionPanel(){
    const status=state.stage>=3?['환자·보호자가 병원을 선택할 차례입니다.','서류·이동 일정·환자 안내를 확인합니다.','수용기관의 첫 진료 회신을 기다립니다.','의뢰기관의 최종 확인을 기다립니다.','첫 진료 이행과 의뢰기관 확인을 마쳤습니다.'][state.stage-3]:liveMessage;
    return `<section class="panel automation-panel"><h2>문의 진행 상황</h2><div class="automation-live" role="status"><span class="connection-dot ${autoEnabled?'on':''}"></span>${esc(autoEnabled?status:'자동 진행 일시 정지 · 진행 설정에서 다시 켤 수 있습니다.')}</div>${state.lastAgent?`<p class="tiny">${esc(state.lastAgent.actionLabel)}</p>${button('추천 근거·문의·회신 보기','agent-detail','small')}`:''}${agentError?`<div class="notice amber" role="alert">${esc(serviceText(agentError))}<div class="row">${button('다시 시도','retry-agent','small')}${button('기본 점검으로 계속','basic-demo','small')}</div></div>`:''}${basicMode?'<p class="tiny">기본 모드</p>':''}</section>`;
  }

  function photo(f,small=false){return `<figure class="facility-photo ${small?'compact':''}"><img src="assets/${f.id==='saebom'?'facility-lounge':f.id}.jpg" alt="${f.name}의 가상 시설 환경 예시 · AI 생성" width="1100" height="733" loading="lazy"></figure>`;}
  function goRole(r){navigateRoute(rolePath(r));}
  function pageHead(title,sub){
    if(view==='case'){
      const names={hospital:['회송 정보 확인','환자 동의 확인','기관 회신 확인','환자 선택 대기','전원 준비','첫 진료 회신 대기','회신 확인·마무리','연계 완료'],patient:['병원에서 정보를 확인하고 있어요','희망 조건과 문의 동의','병원의 답변을 기다리고 있어요','병원 비교·선택','선택한 병원과 연결 중이에요','첫 진료 안내','진료 결과 확인 중이에요','연계가 완료됐어요'],facility:['수용 문의','수용 문의','수용 여부 응답','환자 선택 대기','전원 준비 대기','첫 진료 이행 회신','의뢰기관 확인 대기','연계 완료']};
      return `<div class="page-heading focused-heading"><div><div class="eyebrow">${esc(state.caseId)} · ${roles[role]}</div><h1>${names[role][state.stage]}</h1></div>${badge(M.stages[state.stage],state.stage===7?'green':'navy')}</div>`;
    }
    return `<div class="page-heading"><div><h1>${title}</h1><p class="sub">${sub}</p></div></div>`;
  }

  function caseSummary(){return `<section class="case-summary" aria-label="회송 건 요약"><div><div class="caption">대상자 · 가상 데이터</div><div class="value">${role==='facility'&&(!state.shareConsent||state.selected!==facility)?'비식별 의뢰 대상자':esc(state.patient)} <span class="muted">/ ${state.age}</span></div><div class="small-text">${state.caseId} · 비응급 회송</div></div><div><div class="caption">필요 처치</div><div class="value">정맥 항생제 치료 지속</div><div class="small-text">의료적 적합성은 담당 의료진·수용기관이 판단</div></div><div><div class="caption">현재 담당</div><div class="value">${state.stage===0?'의뢰기관 · 정보 확인':state.stage===1?'환자 동의 / 의뢰기관 문의':state.stage===2?'수용기관 · 응답':state.stage===3?'환자·보호자 · 기관 선택':state.stage===4?'의뢰기관 · 전원 준비':state.stage===5?'수용기관 · 첫 진료 회신':state.stage===6?'의뢰기관 · 회신 확인':'의뢰기관 확인 완료'}</div><div class="small-text">${state.selected?esc(selected().name):'선택 기관 없음'}</div></div></section>`;}
  function steps(){return `<ol class="steps" aria-label="회송 진행 단계">${M.stages.map((x,i)=>`<li class="${i===state.stage?'current':i<state.stage?'done':''}" ${i===state.stage?'aria-current="step"':''}><span class="dot">${i<state.stage?'✓':i+1}</span>${x}</li>`).join('')}</ol>`;}
  const responseNames={accepted:['수용 가능','green'],rejected:['수용 불가','red'],more:['추가 정보 필요','amber'],withdrawn:['문의 종료',''],timeout:['응답 기한 초과','amber']};
  const responseBadge=f=>f.response?badge(...responseNames[f.response.status]):badge('응답 대기');
  function activity(limit=5){return state.events.length?`<ol class="activity">${state.events.slice(0,limit).map(e=>`<li><span class="actor">${roles[e.actor]}</span><time>${when(e.time)}</time><p>${esc(serviceText(e.detail))}</p></li>`).join('')}</ol>`:`<p class="muted">회송 정보를 확인하면 처리 기록이 이곳에 남습니다.</p>`;}
  function auditPanel(){return `<section class="panel"><div class="panel-head"><h2>최근 처리 기록</h2>${button('전체 보기','history','quiet small')}</div>${activity()}</section>`;}
  function clinicalPanel(){return `<section class="panel"><div class="panel-head"><h2>구조화된 회송 정보</h2>${badge(state.parsed?(M.missing(state).length?'보완 필요':'필수 항목 입력됨'):'구조화 전',state.parsed&&M.missing(state).length?'amber':'')}</div>${state.extraction?`<div class="notice green"><b>AI 분석 · 원문 대조 완료</b><br>${when(state.extraction.at)} 분석${state.extraction.cached?' · 확인된 분석 결과':''}</div>`:''}${state.parsed?dl(Object.entries(M.fields).map(([k,v])=>[v,state.data[k]?displayFact(state.data[k]):'<span class="missing-text">미기재 · 담당의 확인 필요</span>'])):`<div class="pending">회송서의 기재 항목을 추출하고, 누락 여부를 점검합니다. 문서에 없는 처치·용량·투여 간격은 추정하지 않습니다.</div>`}<p class="tiny" style="margin-top:12px">입력 여부 점검만 수행합니다. 처방의 적절성·임상 안전성을 검증하는 기능은 아닙니다.</p></section>`;}
  function facilityCard(f,patient=false){
    const status=statusBadge(U.facilityStatus(f,state)),extra=state.lastAgent?.recommendations?.find(r=>r.id===f.id);
    if(!patient)return `<article class="facility staff-facility staff-row ${!f.eligible?'excluded':''}">${photo(f,true)}<div class="facility-main"><div class="facility-title"><div><h3>${esc(f.name)}</h3><span class="type">${facilityType(f)} · ${esc(f.area)}</span></div><div class="response-context"><span class="fact-caption">이번 문의에 대한 기관 회신</span>${status}</div></div><div class="staff-facts"><span><small class="fact-caption">등록된 처치 역량</small>${capability('정맥 투여',f.iv)}</span><span>이동${f.estimatedTravel?' (추정)':''} <b>${f.minutes}분</b> · ${f.km}km</span><span>하루 <b>${money(f.cost)}</b></span>${!f.fresh?badge('등록 정보 재확인','amber'):''}</div><p class="response-note">${f.response?.reason?'<b>회신</b> '+displayFact(f.response.reason):!f.eligible?'<b>제외 사유</b> '+esc(f.reasons.join(' · ')):'수용 여부는 기관의 회신으로 확인합니다.'}</p></div><div class="facility-bottom"><span>정보 갱신 ${esc(f.updated)}</span><div class="row">${button('기관 상세','detail','small',`data-id="${f.id}"`)}</div></div></article>`;
    return `<article class="facility patient-facility choice-column" aria-label="${esc(f.name)} 비교">${photo(f,true)}<div class="facility-main"><div class="facility-title"><div><h3>${esc(f.name)}</h3><div class="type">${facilityType(f)} · ${esc(f.area)}</div></div></div><div class="response-context"><span class="fact-caption">이번 문의에 대한 기관 회신</span>${status}</div><dl class="choice-facts"><div><dt>예상 이동</dt><dd>${f.minutes}<small>분</small></dd></div><div><dt>하루 예상 비용</dt><dd>${money(f.cost)}</dd></div></dl><span class="fact-caption">등록된 처치 역량</span><p class="choice-treatment">${capability('정맥 투여',f.iv)}${state.data.isolation&&state.data.isolation!=='해당 없음'?capability('격리 처치',f.isolation):''}</p><p class="tiny">${f.estimatedTravel?esc(f.travelOrigin)+' 기준 추정 거리':'예시 기준 거리'} ${f.km}km${f.estimatedTravel?' · 도로·교통 미반영':''}</p><details class="choice-evidence"><summary>기관 회신·추천 이유</summary><p>${displayFact(f.response?.reason||'기관의 별도 확인 필요')}</p>${extra?`<ul>${extra.basis.slice(0,3).map(x=>`<li>${displayFact(x)}</li>`).join('')}</ul>`:''}</details></div><div class="facility-bottom"><div class="row">${button('기관 상세','detail','small',`data-id="${f.id}"`)}${button('이 기관 선택','choose','primary',`data-id="${f.id}"`)}</div></div></article>`;
  }

  function highlightedText(text,clean=false,supplements=null){
    return U.sourceSegments(text).map(line=>{
      if(line.kind==='text')return `<p class="referral-note">${(clean?displayFact(line.text):esc(serviceText(line.text)))||'&nbsp;'}</p>`;
      let value;
      if(line.missing&&supplements?.[line.key])value=`<div class="supplemented-field"><span class="source-origin">원문 미기재</span><mark class="referral-token token-${line.kind}">${esc(serviceText(supplements[line.key]))}</mark><span class="supplement-label">담당의 보완 회신</span></div>`;
      else value=`<mark class="referral-token token-${line.missing?'missing':line.kind}">${line.missing?'<span aria-hidden="true">!</span> 미기재 · 보완 필요':(clean?displayFact(line.value):esc(serviceText(line.value)))}</mark>`;
      return `<div class="referral-tag-row"><span class="referral-field-name">${esc(line.label)}</span>${value}</div>`;
    }).join('');
  }
  function highlightedSource(){return highlightedText(state.source,false,state.parsed?state.data:null);}
  function referralDocument(){
    return `<section class="referral-document" aria-labelledby="referral-document-title"><div class="referral-document-toolbar"><h3 id="referral-document-title">회송서 원문</h3><div class="referral-view-switch" role="group" aria-label="회송서 보기 방식">${button('항목 강조','source-preview',!sourceEditMode?'selected':'',`aria-pressed="${!sourceEditMode}"`)}${button('원문 편집','source-edit',sourceEditMode?'selected':'',`aria-pressed="${sourceEditMode}"`)}</div></div><div class="tagged-referral" id="referral-highlight" role="document" tabindex="0" aria-label="원문 항목 강조" ${sourceEditMode?'hidden':''}>${highlightedSource()}</div><div class="field" id="referral-editor" ${!sourceEditMode?'hidden':''}><label class="referral-editor-label" for="referral-source">자유서술 회송서 편집</label><textarea id="referral-source" rows="12" spellcheck="false">${esc(state.source)}</textarea><p class="tiny">편집한 내용은 ‘항목 강조’에서 바로 확인할 수 있습니다.</p></div></section>`;
  }
  function setSourceView(edit){
    sourceEditMode=edit;const preview=$('#referral-highlight'),editor=$('#referral-editor');if(!preview||!editor)return;
    preview.innerHTML=highlightedSource();preview.hidden=edit;editor.hidden=!edit;
    for(const b of document.querySelectorAll('.referral-view-switch button')){const active=(b.dataset.action==='source-edit')===edit;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));}
    if(edit)$('#referral-source')?.focus({preventScroll:true});
  }
  function hospital(){
    let out=pageHead('회송 진행 관리','')+caseSummary()+steps();
    if(state.stage===0&&!state.patientRecord&&S.active)return out+`<section class="panel patient-start"><p class="eyebrow">회송 대상자 확인</p><h2>먼저 환자를 검색하거나 등록해 주세요.</h2><p>이름 또는 병원 등록번호로 환자 정보를 불러온 뒤 회송서를 확인합니다.</p>${button('환자 검색·등록','patients','primary')}</section>`;
    if(state.stage===0){
      const source=`<section class="panel referral-work"><h2>회송서 확인</h2>${referralDocument()}${checks('attest','담당의가 비응급 전원·회송을 결정했음을 확인했습니다.',state.doctorApproved)}${!state.parsed?`<div class="work-actions">${button(apiChecked?'회송 정보 확인':'분석 준비 중…','review-referral','primary',!apiChecked?'disabled':'')}</div><p class="tiny">기재된 항목을 정리합니다. 문서에 없는 처방은 채우지 않습니다.</p>`:button('회송 정보 다시 확인','review-referral','quiet small')}${aiError?`<div class="notice amber" role="alert">${esc(serviceText(aiError))}<div class="row">${button('분석 다시 시도','review-referral','small')}${button('기본 항목 점검으로 계속','parse','small')}</div></div>`:''}</section>`;
      if(!state.parsed)out+=`<div class="focus-work">${source}</div>`;
      else out+=`<div class="focus-work">${clinicalPanel()}${M.missing(state).length?`<section class="panel missing-work"><h2>담당의 보완이 필요합니다</h2><p>${M.missing(state).map(k=>M.fields[k]).join(', ')} 정보가 없습니다.</p>${button('담당의 보완 회신 입력','supplement','primary')}</section>`:`<section class="work-actions">${button('확인하고 기관 문의 준비','ready','primary')}</section>`}<details class="support-details"><summary>회송서 원문과 비교하기</summary>${source}</details></div>`;
    }else if(state.stage===1){
      const fs=M.candidates(state),eligible=fs.filter(f=>f.eligible);
      out+=`<div class="focus-work"><section class="panel waiting-work"><h2>${state.consent?'동의를 확인했습니다':'환자·보호자의 동의를 기다립니다'}</h2><p>${state.consent?'희망 조건에 맞는 기관에 문의를 준비하고 있습니다.':'의뢰기관의 정보 점검은 끝났습니다. 환자·보호자가 희망 조건을 정하고 기관 문의에 동의하면 탐색을 시작합니다.'}</p>${!state.consent?button('환자·보호자 화면으로 이동','go-patient','primary'):!autoEnabled?button('수용 문의 보내기','send','primary'):''}</section><details class="support-details"><summary>문의 대상 미리보기 · ${eligible.length}곳</summary><div class="list">${eligible.map(f=>facilityCard(f)).join('')}</div><details><summary>제외된 기관과 사유 · ${fs.length-eligible.length}곳</summary><div class="list">${fs.filter(f=>!f.eligible).map(f=>facilityCard(f)).join('')}</div></details></details></div>`;
    }else if(state.stage===2){
      const fs=M.candidates(state).filter(f=>state.inquiries.includes(f.id)),n=M.accepted(state).length;
      out+=`<div class="focus-work"><div class="toolbar"><h2>문의한 기관 ${fs.length}곳</h2><div class="row">${badge('수용 가능 '+n+'곳','green')}${badge('응답 대기 '+fs.filter(f=>!f.response).length+'곳')}</div></div><div class="list">${fs.map(f=>facilityCard(f)).join('')}</div>${!autoEnabled?`<section class="panel manual-work"><h2>직접 진행</h2><p class="tiny">자동 진행이 꺼져 있습니다. 기관 응답을 기록한 뒤 수용 가능한 후보만 안내합니다.</p><div class="row">${button('수용기관 응답 화면으로 이동','go-facility','small')}${n?button('수용 확인 후보 안내','publish','primary'):''}</div></section>`:''}</div>`;
    }else if(state.stage===3){
      out+=`<div class="focus-work"><section class="panel waiting-work"><h2>수용 가능한 ${M.accepted(state).length}곳을 안내했습니다</h2><p>환자·보호자가 이동 시간과 비용을 비교해 직접 선택합니다.</p>${button('환자·보호자 화면으로 이동','go-patient','primary')}</section><details class="support-details"><summary>안내한 기관 보기</summary><div class="list">${M.accepted(state).map(f=>facilityCard(f)).join('')}</div></details></div>`;
    }else if(state.stage===4){
      out+=`<div class="focus-work"><section class="panel"><div class="panel-head"><h2>전원 준비 확인</h2>${badge(selected().name,'navy')}</div><p class="sub">환자가 선택한 기관에 한정해 준비합니다. 확인한 항목만 체크해 주세요.</p>${transferPlanForm()}${checks('prep-documents','기존 절차에 따른 회송 서류와 원 처방 정보를 확인했습니다.',state.prep.documents)}${checks('prep-transport','수용기관과 이동·입원 일정을 확인했습니다.',state.prep.transport)}${checks('prep-guidance','환자·보호자에게 기존 의료진의 안내를 전달했습니다.',state.prep.guidance)}<div class="work-actions">${button('준비 완료하고 전달하기','handoff','primary')}</div><p class="tiny">전달 기록을 남긴 뒤 첫 진료 회신을 기다립니다.</p></section></div>`;
    }else if(state.stage===5){
      out+=`<div class="focus-work"><section class="panel waiting-work"><h2>${esc(selected().name)}의 첫 진료 회신을 기다립니다</h2><p>전원 준비와 전달 기록을 마쳤습니다. 첫 진료 이행 회신 후 의뢰기관이 확인해야 연계가 완료됩니다.</p>${button('수용기관 화면으로 이동','go-facility','primary')}</section></div>`;
    }else if(state.stage===6){
      out+=`<div class="focus-work"><section class="panel"><div class="panel-head"><h2>도착한 첫 진료 회신</h2>${badge(state.visit.result==='done'?'진료 이행':'진료 미이행',state.visit.result==='done'?'green':'red')}</div>${dl([['회신 기관',selected().name],['첫 진료',state.visit.result==='done'?'진료 이행':'진료 미이행'],['회신 시각',when(state.visit.at)],['추가 메모',esc(state.visit.note||'별도 메모 없음')]])}<p class="notice ${state.visit.result==='done'?'green':'amber'}">${state.visit.result==='done'?'회신을 읽고 의뢰기관 담당자가 최종 확인해 주세요.':'첫 진료가 이루어지지 않았습니다. 사유를 확인하고 다시 연계합니다.'}</p>${state.visit.result==='done'?button('회신 확인하고 연계 완료','ack','primary'):button('사유 확인 후 재연계','relink','primary')}</section></div>`;
    }else out+=completion();
    return out;
  }

  function completion(){return `<section class="panel complete"><div class="symbol">✓</div><h1>의뢰기관의 확인까지 마쳤습니다.</h1><p class="sub" style="margin:auto">수용기관의 첫 진료 이행 회신과 의뢰기관 담당자의 확인 기록이 모두 남았습니다.</p><div class="cards-inline" style="justify-content:center"><div><strong>${selected().name}</strong><span>선택한 수용기관</span></div><div><strong>첫 진료 이행</strong><span>수용기관 회신</span></div><div><strong>확인 완료</strong><span>의뢰기관 담당자</span></div></div><div class="row" style="justify-content:center">${button('처리 기록 보기','history','primary')}${button('진행 기록 내려받기','export')}${button('처음부터 시작','reset')}</div><p class="tiny" style="margin-top:18px">시나리오의 완료 상태입니다. 실제 환자 연계나 임상 성과를 나타내지 않습니다.</p></section>${auditPanel()}`;}
  function customPreferenceForm(){const c=state.preferences.custom||{},p=M.profile(state);return `<details class="custom-preferences" ${state.preferences.custom?'open':''}><summary>지역·거리·비용 조건 직접 입력</summary><form id="custom-preferences-form"><div class="patient-registration-grid"><label class="field"><span>기준 지역</span><select id="pref-location">${Object.entries(M.locations).map(([id,x])=>`<option value="${id}" ${c.location===id?'selected':''}>${esc(x.label)}</option>`).join('')}</select></label>${[['maxKm','허용 거리 (km)',1,100,c.maxKm??p.maxKm],['maxCost','하루 예산 (원 · 0은 제한 없음)',0,1000000,c.maxCost??p.maxCost],['maxMinutes','이동시간 (분 · 0은 제한 없음)',0,240,c.maxMinutes??p.maxMinutes]].map(([k,label,min,max,value])=>`<label class="field"><span>${label}</span><input id="pref-${k}" type="number" required min="${min}" max="${max}" value="${value}"></label>`).join('')}</div><p class="tiny">선택한 지역 중심과 예시 기관 좌표로 거리를 추정합니다. 도로 경로·실시간 교통은 반영하지 않습니다.</p><button type="submit">입력한 조건 적용</button></form></details>`;}
  function patientPreferences(){
    const currentProfile=M.profile(state),radius=currentProfile.maxKm;
    let consent=state.stage===0?'<p class="notice">의뢰기관에서 회송 정보를 확인한 뒤 기관 문의에 동의할 수 있습니다.</p>':state.consent?checks('consent','기관 문의 동의가 기록되었습니다.',true,'체크를 해제하면 진행 중인 문의를 중단하고 동의 단계로 돌아갑니다.'):checks('consent-draft','비식별 정보를 이용한 기관 문의에 동의합니다.',consentDraft,'제공 범위: 처치 요약·연령대·희망 조건. 이름·연락처·상세 처방은 기관 선택 후 별도 동의로 전달합니다.')+button('동의하고 기관 찾기','consent-start','primary',consentDraft?'':'disabled')+'<p class="tiny">동의 항목을 체크한 뒤 시작 버튼을 눌러 주세요.</p>';
    const form=`<section class="panel preference-panel" id="patient-preferences"><div class="panel-head"><h2>희망 조건과 기관 문의 동의</h2>${badge('의료 판단과 별도로 반영')}</div><p class="sub">가족이 방문하기 편한 곳이나 하루 비용 등, 우선할 조건을 골라주세요.</p><div class="profile-options">${Object.entries(M.profiles).map(([id,p])=>button(p.label,'select-profile',!state.preferences.custom&&state.preferences.profile===id?'selected':'',`data-id="${id}" aria-pressed="${!state.preferences.custom&&(state.preferences.profile||'balanced')===id}"`)).join('')}</div><p class="profile-quote">“${esc(currentProfile.text)}”</p><p class="tiny">탐색 범위 ${radius}km${currentProfile.maxCost?' · 하루 '+money(currentProfile.maxCost)+' 이하':''}${currentProfile.maxMinutes?' · 이동 '+currentProfile.maxMinutes+'분 이내':''} · 조건을 바꾸면 문의 동의를 다시 확인합니다.</p>${customPreferenceForm()}${consent}</section>`;
    return state.stage===3?`<details class="preferences-summary"><summary><span>희망 조건: ${currentProfile.label} · ${radius}km 이내</span>${statusBadge({label:'문의 동의 완료',tone:'green',icon:'✓'})}<span class="preferences-edit">조건 수정 / 동의 철회</span></summary>${form}</details>`:form;
  }
  function patient(){
    let out=pageHead('병원 비교·선택','')+caseSummary()+steps();
    if(state.stage===1&&!state.consent)out+=patientPreferences();
    else if(state.stage<3){
      const emptyConditions=state.stage===1&&state.consent&&!M.candidates(state).some(f=>f.eligible);
      out+=`<section class="panel waiting-work"><h2>${emptyConditions?'희망 조건에 맞는 병원이 없어요':state.stage===0?'병원에서 회송 정보를 확인하고 있어요':allAnsweredWithoutAcceptance()?'담당자가 수용 조건을 다시 확인하고 있어요':'병원의 답변을 기다리고 있어요'}</h2><p>${emptyConditions?'아직 기관에 문의하지 않았습니다. 아래에서 희망 조건을 바꾼 뒤 다시 문의에 동의해 주세요.':state.stage===0?'정보 확인이 끝나면 희망 조건과 문의 동의를 확인합니다.':allAnsweredWithoutAcceptance()?'현재 문의 기관 중 수용이 확인된 곳이 없습니다. 추가 정보나 이동 범위를 확인한 뒤 다시 안내합니다.':'수용 가능한 병원이 확인되면 이 화면에서 이동 시간과 비용을 비교할 수 있어요.'}</p>${state.stage===0||allAnsweredWithoutAcceptance()?button('의뢰기관 화면으로 이동','go-hospital','small'):''}</section>${state.stage>0?`<details class="support-details"><summary>희망 조건 확인·동의 철회</summary>${patientPreferences()}</details>`:''}`;
    }else if(state.stage===3){
      const fs=M.accepted(state);
      out+=`<section class="decision-work" aria-label="수용 가능한 기관 비교"><div class="decision-intro"><h2 id="task-title" tabindex="-1">수용 가능한 병원 ${fs.length}곳을 찾았어요</h2><p>필요한 처치에 대해 수용 가능하다고 회신한 곳이에요. 이동 시간과 비용을 비교해 선택해 주세요.</p>${fs.length>1?`<div class="mobile-compare-entry">${button('병원 조건 한눈에 비교','open-compare','small')}</div>`:''}</div><div class="patient-grid decision-board" id="candidate-comparison">${fs.map(f=>facilityCard(f,true)).join('')}</div><div class="decision-tools">${fs.length>1?button('상세 조건 비교','open-compare','small'):''}${button('맞는 기관이 없어요 · 조건 다시 찾기','reject-candidates','quiet small')}</div><p class="tiny">기관을 선택한 뒤, 해당 기관에 정보를 제공할지 별도로 동의합니다.</p></section>${patientPreferences()}`;
    }else{
      out+=`<section class="panel patient-followup"><div class="panel-head"><h2>${esc(selected().name)}을 선택했어요</h2>${badge(state.stage===7?'연계 완료':state.stage>=6?'첫 진료 회신 도착':'연계 진행 중',state.stage===7?'green':'navy')}</div>${transferPlanSummary()}${dl([['이동 안내',selected().area+' · 이동 '+selected().minutes+'분'],['정보 전달','선택한 기관에 한정하여 동의 기록'],['현재 상태',M.stages[state.stage]]])}<div class="notice">${state.stage===4?'병원에서 서류·이동 일정·안내 사항을 준비하고 있어요.':state.stage===5?'선택한 병원의 안내에 따라 방문해 주세요. 병원에서 첫 진료 이행 여부를 회신할 예정이에요.':state.stage===6&&state.visit?.result==='missed'?'첫 진료가 이루어지지 않아 담당자가 재연계를 확인하고 있어요.':state.stage===6?'의뢰기관에서 첫 진료 회신을 확인하고 있어요.':'의뢰기관의 첫 진료 회신 확인까지 마쳤어요.'}</div></section>`;
    }
    return `<div class="patient-layout">${out}</div>`;
  }

  function facilityView(){
    const f=M.candidates(state).find(f=>f.id===facility),sum=M.summary(state,facility),received=state.inquiries.includes(f.id),r=state.responses[f.id];
    let out=pageHead('수용 문의와 진료 이행 회신','기관의 처치 가능 여부와 실제 수용 조건은 수용기관 담당자가 판단합니다.');
    out+=`<div class="facility-context"><strong>${esc(f.name)}</strong><span>${facilityType(f)} · ${esc(f.area)}</span>${!f.fresh?badge('등록 정보 재확인 필요','amber'):''}</div>`;
    out+=`<details class="provider-settings panel"><summary>기관 처치 역량·병상 등록</summary><p class="tiny">등록 정보는 같은 의뢰기관의 환자 목록에 연결된 회송 건에 공통 반영됩니다. 환자별 수용 응답과 병상 예약 확정은 별도입니다.</p><label class="field"><span>등록 병상 수</span><input id="provider-beds" type="number" min="0" max="20" value="${f.beds}"></label><label class="check"><input type="checkbox" id="provider-iv" ${f.iv?'checked':''}><span>정맥 투여 처치 가능</span></label><label class="check"><input type="checkbox" id="provider-isolation" ${f.isolation?'checked':''}><span>격리 처치 가능</span></label>${button('기관 등록 정보 저장','provider-save','',state.stage>=4?'disabled':'')}<p class="tiny">기관 선택 전까지 예시 정보를 바꿀 수 있습니다.</p></details>`;
    if(!received){return out+`<section class="empty-hint"><h2>현재 이 기관에 생성된 문의가 없습니다.</h2><p class="sub">의뢰기관에서 처치 조건을 확인한 뒤 문의 대상 기관에 비식별 요약을 생성합니다.</p>${button('의뢰기관 화면으로 이동','go-hospital','primary')}</section>`;}
    if(r?.status==='withdrawn'){return out+`<section class="panel"><h2>문의가 종료되었습니다.</h2><p class="sub">환자가 다른 기관을 선택했습니다. 이 기관에는 환자의 상세 정보가 공개되지 않습니다.</p>${badge('추가 정보 접근 없음')}</section>`;}
    out+=`<div class="grid"><div><section class="panel"><div class="panel-head"><h2>${sum.shared?'선택 기관 한정 회송 정보':'비식별 수용 문의 요약'}</h2>${badge(sum.shared?'정보 전달 동의 기록':'개인식별정보 미포함','navy')}</div>${sum.shared?transferPlanSummary():''}${dl([['문의 번호',state.caseId],['연령대',sum.age],['필요 처치',esc(sum.treatment)],['치료 기간',esc(sum.period)],['격리 여부',esc(sum.isolation)],...(sum.shared?[['대상자',esc(sum.patient)],['환자번호',esc(sum.patientNumber||'미등록')],['연락처',esc(sum.contact||'미등록')],['약제',esc(sum.drug)],['용량',esc(sum.dose)],['투여 간격',esc(sum.interval)]]:[])])}${!sum.shared?'<div class="locked">환자 이름·연락처·상세 처방은 기관 선택과 정보 제공 동의 전에는 공개하지 않습니다.</div>':''}</section></div><div>`;
    if(state.stage===2){out+=`<section class="panel"><h2>수용 여부 응답</h2><p class="sub">처치 역량과 희망 일정의 실제 수용 가능성을 함께 확인해 주세요.</p><label class="field"><span>응답</span><select id="response-status"><option value="" disabled ${!r?'selected':''}>수용 여부를 선택해 주세요</option><option value="accepted" ${r?.status==='accepted'?'selected':''}>수용 가능</option><option value="more" ${r?.status==='more'?'selected':''}>추가 정보 필요</option><option value="rejected" ${r?.status==='rejected'?'selected':''}>수용 불가</option></select></label><label class="field"><span>조건 또는 사유</span><textarea id="response-reason" style="min-height:90px" placeholder="수용 조건, 추가로 필요한 정보, 수용 불가 사유">${esc(r?.reason||'')}</textarea></label>${button('수용 응답 보내기','response','primary')}<p class="tiny" style="margin-top:12px">실제 병상 예약이나 임상적 수용 결정이 아닌 가상 응답 기록입니다.</p></section>`;}
    else if(state.selected===facility&&state.stage===5){out+=`<section class="panel"><h2>첫 진료 이행 회신</h2><label class="field"><span>진료 이행 여부</span><select id="visit-result"><option value="" disabled selected>이행 여부를 선택해 주세요</option><option value="done">첫 진료 이행</option><option value="missed">첫 진료 미이행</option></select></label><label class="field"><span>추가 확인 사항</span><textarea id="visit-note" style="min-height:90px" placeholder="미이행 시 확인된 사유 등을 기록합니다."></textarea></label>${button('첫 진료 회신 보내기','visit','primary')}<div class="notice">회신 후 의뢰기관 담당자의 확인을 기다립니다. 이 화면에서 연계를 최종 완료하지 않습니다.</div></section>`;}
    else{out+=`<section class="panel"><h2>${state.stage===7?'의뢰기관 확인 완료':state.stage===6?'의뢰기관 확인 대기':state.selected===facility?'전원 준비 중':'환자 선택 대기'}</h2><p class="sub">${state.stage===4?'의뢰기관에서 기존 회송 절차에 따른 전원 준비를 진행합니다.':state.stage>=6?'첫 진료 회신은 의뢰기관에서 확인합니다.':'응답을 기록했습니다. 수용이 확인된 기관 중 환자가 직접 선택합니다.'}</p>${button('의뢰기관 화면으로 이동','go-hospital','small')}</section>`;}return out+'</div></div>';
  }
  const flow=[['회송 정보','담당의 회송 결정을 확인하고 문서의 필수 항목을 점검합니다. 누락된 내용은 담당의 보완 회신으로만 채웁니다.','의뢰기관·의사'],['기관 문의','환자 동의를 확인한 뒤 처치 조건에 맞는 기관에 비식별 요약 문의를 생성합니다.','환자·의뢰기관'],['수용 응답','수용기관이 가능·불가·추가 확인을 회신합니다. 불가·무응답이면 범위를 조정합니다.','수용기관'],['환자 선택','수용 확인된 기관만 비교합니다. 환자가 선택하고 해당 기관에 대한 정보 제공에 동의합니다.','환자·보호자'],['전원 준비','선택 기관에 한정해 정보를 전달하고 기존 회송 업무의 준비 사항을 확인합니다.','의뢰기관'],['첫 진료 회신','수용기관에서 첫 진료 이행 또는 미이행을 회신합니다.','수용기관'],['의뢰기관 확인','회신 내용을 담당자가 확인합니다. 미이행이면 완료 처리 대신 재연계합니다.','의뢰기관'],['연계 완료','수용기관의 진료 이행과 의뢰기관의 회신 확인이 모두 기록된 상태입니다.','의뢰기관']];
  function flowPage(){return pageHead('서비스 흐름','하나의 회송 건을 세 역할의 화면에서 이어서 확인합니다.')+`<section class="panel">${flow.map(([title,desc,owner],i)=>`<div class="flow-row ${i===state.stage?'active':''}"><span class="flow-num">${i+1}</span><div><h3>${title}</h3><p>${desc}</p></div><span class="owner">${owner}</span></div>`).join('')}</section><div class="notice">자동화 대상은 정보 정리와 문의·회신의 상태 관리입니다. 진단·처방·의료적 수용 판단은 자동화하지 않습니다.</div>`;}
  function historyPage(){return pageHead('회송 처리 기록','역할별 작업과 예외 처리 흐름을 확인하고, 진행 기록을 내려받을 수 있습니다.')+`<section class="panel"><div class="row space"><h2>${state.caseId}</h2>${button('진행 기록 내려받기','export','primary')}</div><div class="cards-inline"><div><strong>${state.events.length}건</strong><span>이 브라우저의 기록된 작업</span></div><div><strong>${state.metrics.errors}회</strong><span>진행 조건 미충족 시도</span></div><div><strong>${M.stages[state.stage]}</strong><span>현재 단계</span></div></div><p class="tiny">위 수치는 합성 예시의 조작 기록입니다. 실제 업무 절감량·효과 지표가 아닙니다.</p>${activity(300)}</section>`;}
  function guide(){return pageHead('프로토타입 안내','설계된 업무 흐름과 가상 상태 전환을 검증하는 1차 예시 버전입니다.')+`<section class="panel readme"><h2>정상 시나리오 · 약 3분</h2><ol><li>의뢰기관: 담당의 회송 결정 확인 → 회송 정보 구조화 → 기관 문의 준비</li><li>환자·보호자: 선호 조건 선택 → 비식별 문의 동의</li><li>의뢰기관: 비식별 수용 문의 생성 → 가상 응답 불러오기 → 후보 공개</li><li>환자·보호자: 기관 상세 확인·나란히 비교 → 기관 선택 및 정보 전달 동의</li><li>의뢰기관: 전원 준비 확인 → 공식 회송 전달 기록 생성 (예시)</li><li>수용기관: 선택 기관에서 첫 진료 이행 회신</li><li>의뢰기관: 회신 확인 → 연계 완료</li></ol><h2>예외 시나리오</h2><p>‘정보 누락’은 투여 간격이 비어 있어 문의로 넘어갈 수 없습니다. 담당의 보완 회신을 입력해야 합니다. ‘수용 불가’는 첫 문의의 모든 기관이 거절하여 재탐색이 필요합니다. 첫 진료 회신에서 ‘미이행’을 선택하면 완료 대신 재연계합니다.</p><h2>현재 구현된 것과 모의 기능</h2>${dl([['동작하는 기능','역할별 화면, 규칙 기반 필수 항목 점검, 후보 필터·정렬, 기관 응답, 비교·선택, 전달 범위, 단계별 진행 조건, 처리 기록·JSON 내보내기'],['모의 기능','의료기관 응답·병상·금액, EMR/FHIR·HIRA 공식 전달 기록, 알림톡·문자 전송'],['데이터','모든 환자·기관·가격·처방·응답은 합성 예시 데이터'],['저장','환자 기본 정보·회송 건·문의·회신·동의·처리 기록을 DB에 저장하며, 권한 링크로 기기 간 같은 기록에 연결합니다.'],['인증','회송 건별 역할 권한과 환자 목록 권한을 분리합니다. 기관 계정 로그인·본인 인증은 아직 제공하지 않습니다.'],['제외 범위','응급 전원, 자택 귀가, 임상 적합성 판단, 수가·청구 계산, 첫 진료 이후 장기 추적']])}</section>`;}
  function renderBase(){
    if(view==='home'){ $('#app').innerHTML=portalMarkup();return;}
    if(view==='not-found'){ $('#app').innerHTML='<main id="main" class="portal-main"><h1>페이지를 찾을 수 없습니다</h1><p>주소를 확인하거나 첫 화면에서 이용할 화면을 선택해 주세요.</p><a class="route-link primary" href="/" data-route="/">첫 화면으로</a></main>';return;}
    $('#app').innerHTML=`<div class="demo-strip"><span><strong>서비스 프로토타입</strong> · 회송 사례·기관 응답은 가상입니다. 실제 환자 정보를 입력하지 마세요.</span><span>수용 응답은 모의 데이터</span></div><header><a class="brand" href="/" data-action="home" aria-label="케어브릿지 첫 화면으로"><div class="brand-mark" aria-hidden="true">cb</div><div><strong>케어브릿지</strong><span>CAREBRIDGE</span></div></a><span class="current-workspace">${roles[role]} 화면</span><details class="demo-controls" id="demo-controls"><summary>진행 설정</summary><div class="demo-popover">${role==='facility'?`<label class="field"><span>확인할 기관</span><select id="facility-select">${M.facilities.map(x=>`<option value="${x.id}" ${x.id===facility?'selected':''}>${x.name}</option>`).join('')}</select></label>`:''}<h2>발표자용 화면 전환</h2><div class="row">${['hospital','patient','facility'].filter(r=>!S.active||S.can(rolePath(r))).map(r=>button(roles[r],'preview-role','small',`data-id="${r}"`)).join('')}</div><p class="tiny">역할별 화면을 확인하는 기능이며 실제 로그인은 아닙니다.</p><a class="route-link small" href="/" data-route="/">다른 이용 화면 선택</a><label class="field"><span>시나리오</span><select id="scenario-select"><option value="normal" ${state.scenario==='normal'?'selected':''}>정상 연계</option><option value="missing" ${state.scenario==='missing'?'selected':''}>회송 정보 누락</option><option value="unavailable" ${state.scenario==='unavailable'?'selected':''}>수용 불가·재탐색</option></select></label><div class="row">${button(autoEnabled?'자동 진행 켜짐':'자동 진행 꺼짐','toggle-auto',autoEnabled?'selected small':'small',`aria-pressed="${autoEnabled}"`)}${button('처음부터','reset','quiet small')}</div>${role==='hospital'&&state.stage===2?`<div class="row">${button('가상 응답 불러오기','demo','quiet small')}${button('무응답 예외 처리','timeout-demo','quiet small')}</div>`:''}${button('이용 안내','guide','quiet small')}</div></details></header><div class="workspace"><aside class="sidebar"><div class="side-label">${roles[role]}</div><nav class="side-nav" aria-label="작업 메뉴">${button('내 할 일','tasks',view==='tasks'?'active':'')}${button('회송 업무','case',view==='case'?'active':'')}${role==='hospital'?button('환자 검색·등록','patients',view==='patients'?'active':''):''}${button('처리 기록 <span class="number">'+state.events.length+'</span>','history',view==='history'?'active':'')}</nav><details class="reference-nav"><summary>참고 자료</summary><nav class="side-nav" aria-label="참고 자료">${button('서비스 흐름','flow',view==='flow'?'active':'')}${button('공개 기관 정보 조회','hospitals',view==='hospitals'?'active':'')}${button('기능 안내','integration','')}${button('이용 안내','guide',view==='guide'?'active':'')}</nav></details></aside><main id="main" tabindex="-1">${view==='tasks'?tasksPage():view==='patients'?patientsPage():view==='hospitals'?hospitalsPage():view==='flow'?flowPage():view==='history'?historyPage():view==='guide'?guide():role==='hospital'?hospital():role==='patient'?patient():facilityView()}<footer class="app-footer">서울대학교 산업공학과 · 헬스케어 서비스 혁신 프로젝트 / CareBridge</footer></main></div>`;
  }

  function render(){
    const workspace=['home','not-found'].includes(view)?'home':role;
    document.body.dataset.workspace=workspace;
    document.title=workspace==='home'?'케어브릿지 · 전원·회송 연계':roles[role]+' · 케어브릿지';
    if(sharedLoading){$('#app').innerHTML='<main id="main" class="portal-main"><h1>진행 기록을 불러오고 있어요</h1><p role="status">잠시만 기다려 주세요.</p></main>';return;}
    if(sharedError){$('#app').innerHTML=`<main id="main" class="portal-main"><h1>진행 기록 확인이 필요합니다</h1><p class="notice amber">${esc(sharedError)}</p>${button('다시 불러오기','shared-refresh','primary')}${button('새 회송 시작','reset','small')}</main>`;return;}
    const scope=role+':'+view+':'+state.caseId,opened=renderedScope===scope?[...document.querySelectorAll('#app details[open]')].map(d=>d.id||d.className+'|'+d.querySelector('summary')?.textContent):[];renderedScope=scope;renderBase();enhance();enhanceUX();enhanceShared();for(const d of document.querySelectorAll('#app details'))if(opened.includes(d.id||d.className+'|'+d.querySelector('summary')?.textContent))d.open=true;const skip=$('.skip');if(skip&&location.protocol!=='file:')skip.href=location.pathname+location.hash;if(working)setBusy(true);
  }
  function modal(title,content,actions=''){const d=$('#dialog');d.classList.toggle('wide',title==='병원 상세 비교');d.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2>${button('닫기','close','quiet small','aria-label="대화상자 닫기"')}</div><div class="dialog-body">${content}</div>${actions?`<div class="dialog-actions">${actions}</div>`:''}`;if(!d.open)d.showModal();enhance();updateFormReadiness();}
  function close(){if($('#dialog').open)$('#dialog').close();}
  function detail(id){const f=M.candidates(state).find(x=>x.id===id);modal(f.name,`<p class="sub">${facilityType(f)} · ${f.area}</p>${dl([['필요 처치',capability('정맥 투여',f.iv)],['격리 역량',capability('격리 처치',f.isolation)],['이동 거리',f.km+'km · '+f.minutes+'분'],['예상 비용',money(f.cost)+' / 1일'],['기관 평가·응답 이력',f.quality+'/100 · 응답률 '+f.responseRate+'% · 불일치 '+f.mismatchRate+'%'],['기관 등록 병상',f.beds+'개'],['정보 갱신',f.updated],['수용 응답',f.response?displayFact(responseNames[f.response.status][0]+' · '+(f.response.reason||'')):'수용기관의 별도 확인 필요'],['후보 포함 근거',f.eligible?'처치 조건과 이동 범위 충족. 수용 여부는 별도 응답으로 확인.':esc(f.reasons.join(', '))]])}<div class="notice">기관 등록 역량·현재 수용 응답·환자 선택은 서로 다른 단계입니다. 비용과 품질을 임상적 적합성의 근거로 대신하지 않습니다.</div>`);}
  async function dispatch(event){
    if(event.target.closest('a.skip')){event.preventDefault();$('#main')?.focus();return;}
    const link=event.target.closest('a[data-route]');if(link){if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();navigateRoute(link.dataset.route);return;}
    const el=event.target.closest('[data-action]');if(!el||el.disabled)return;const a=el.dataset.action,id=el.dataset.id;
    if(a==='tasks-refresh'){await loadTasks();return;}
    if(a==='task-filter'){taskFilter=id;render();return;}
    if(a==='preview-role'){navigateRoute(rolePath(id));return;}
    if(a==='request-handoff'){handoffModal(id);return;}
    if(a==='copy-handoff'){try{await navigator.clipboard.writeText($('#handoff-link').value);if(await act({type:'handoffRequest',target:id})){close();toast('요청 링크를 복사하고 기록했습니다. 상대방에게 전달해 주세요.');}}catch(e){toast(e.message||'링크 복사를 확인해 주세요.',true);}return;}
    if(a==='patient-history-open'){if(working)return;setBusy(true,'회송 기록을 불러오고 있습니다…');try{await P.ensure();const result=await S.reopen(id,P.selection(el.dataset.patient));generation++;state=result.state;sharedError='';agentError='';sourceDirty=false;sourceEditMode=false;role='hospital';view='case';save();writeRoute('/hospital');setBusy(false);render();window.scrollTo(0,0);}catch(e){toast(e.message,true);}finally{setBusy(false);}return;}
    if(a==='patients'){navigateRoute('/hospital/patients');return;}
    if(a==='patient-search'){await loadPatients($('#patient-query')?.value||patientQuery);return;}
    if(a==='patient-search-clear'){resetPatientSearch();render();$('#patient-query')?.focus();return;}
    if(a==='patient-register'){patientRegisterModal();return;}
    if(a==='patient-directory-link'){try{await P.ensure();await navigator.clipboard.writeText(location.origin+P.href());toast('의뢰기관용 환자 목록 이용 링크를 복사했습니다.');}catch(e){toast(e.message||'링크를 복사하지 못했습니다.',true);}return;}
    if(a==='patient-detail'){if(working)return;setBusy(true);try{patientDetail=await P.detail(id);setBusy(false);render();$('.patient-details')?.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(e){toast(e.message,true);}finally{setBusy(false);}return;}
    if(a==='patient-save'){
      const form=$('#patient-register-form');if(!form.reportValidity()||working)return;const patient={name:$('#patient-name').value,number:$('#patient-number').value,age:$('#patient-age').value,contact:$('#patient-contact').value};setBusy(true,'환자를 등록하고 있습니다…');
      try{const result=await P.create(patient);patientDetail=await P.detail(result.patient.id);setBusy(false);close();await loadPatients(result.patient.number);toast('환자를 등록했습니다. 정보를 확인한 뒤 회송에 불러와 주세요.');}catch(e){toast(e.message,true);}finally{setBusy(false);}return;
    }
    if(a==='patient-attach'||a==='patient-new-case'){await usePatient(id,a==='patient-new-case');return;}
    if(a==='share-links'){shareLinks();return;}
    if(a==='copy-role-link'){try{await navigator.clipboard.writeText(location.origin+S.href('/'+id));toast('이용 링크를 복사했습니다.');}catch{toast('위 이용 링크를 직접 복사해 주세요.',true);}return;}
    if(a==='shared-refresh'){sharedLoading=true;sharedError='';render();try{const result=await S.refresh();state=result.state;}catch(e){sharedError=e.message;}finally{sharedLoading=false;render();}return;}
    if(a==='restore-local'){try{const previous=JSON.parse(localStorage.getItem(KEY+'-archives')||'[]')[Number(id)];if(!previous?.state)throw Error();generation++;S.forget();state=previous.state;sharedError='';sourceDirty=false;role='hospital';view='case';save();writeRoute('/hospital');render();toast('이전 브라우저 기록을 열었습니다.');}catch{toast('기록을 불러오지 못했습니다.',true);}return;}
    if(a==='source-edit'||a==='source-preview'){setSourceView(a==='source-edit');return;}
    if(a==='home'){event.preventDefault();navigateRoute('/');return;}
    if(a==='close'){close();return;}
    if(a.startsWith('focus-')){const selectors={'focus-attest':'[data-change="attest"]','focus-consent':'[data-change="consent-draft"]','focus-candidates':'.patient-grid','focus-preferences':'#patient-preferences','focus-response':'#response-status','focus-visit':'#visit-result','focus-prep':'[data-change^="prep-"]:not(:checked)','focus-plan':'#plan-when'};const target=$(selectors[a]||'#main');if(target){for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;(target.closest('.panel')||target).scrollIntoView({behavior:'smooth',block:'center'});(a==='focus-candidates'?target.querySelector('button'):target)?.focus?.({preventScroll:true});}return;}
    if(a==='reject-candidates'){modal('후보가 맞지 않는 이유',`<p class="sub">선택한 사유를 다음 탐색의 필수 조건과 가중치에 반영합니다. 새 조건으로 문의하기 전에 동의를 다시 확인합니다.</p><label class="field"><span>다시 찾는 이유 (가상)</span><select id="reject-reason"><option value="distance">보호자가 더 가까운 곳에 방문해야 해요</option><option value="cost">하루 비용을 4만원 이내로 줄이고 싶어요</option><option value="time">이동 시간이 30분 이내여야 해요</option></select></label>`,button('취소','close')+button('사유 반영하고 다시 찾기','confirm-reject','primary'));return;}
    if(a==='confirm-reject'){compare.clear();consentDraft=false;agentError='';if(await act({type:'rejectCandidates',reason:$('#reject-reason').value},'patient'))close();return;}
    if(a==='select-profile'){compare.clear();consentDraft=false;agentError='';await act({type:'profile',profile:id},'patient');return;}
    if(a==='retry-agent'){agentError='';if(autoEnabled&&(state.stage===1||state.stage===2))kickAutomation();else await runAgent();return;}
    if(a==='basic-demo'){basicMode=true;agentError='';autoEnabled=true;save();render();kickAutomation();return;}
    if(a==='provider-save'){await act({type:'facilityUpdate',id:facility,beds:Number($('#provider-beds').value),iv:$('#provider-iv').checked,isolation:$('#provider-isolation').checked},'facility');return;}
    if(a==='agent-detail'){agentDetail();return;}
    if(a==='agent-workflow'){close();goRole(nextRole());return;}
    if(a==='timeout-demo'){autoEnabled=false;save();const next=state.inquiries.find(id=>!state.responses[id]);if(next){await act({type:'timeout',id:next},'simulation');toast('무응답 예외를 기록했습니다. 자동 진행을 다시 켜면 나머지 문의를 처리합니다.');}return;}
    if(a==='consent-start'){if(!consentDraft){toast('먼저 기관 문의 동의를 확인해 주세요.',true);return;}if(await act({type:'consent',value:true},'patient'))consentDraft=false;return;}
    if(a==='clear-compare'){compare.clear();render();return;}

    if(a==='next-role'){goRole(nextRole());return;}
    if(a==='toggle-auto'){autoEnabled=!autoEnabled;if(autoEnabled)agentError='';if(!autoEnabled){generation++;autoRunId++;autoRunning=false;}liveMessage='자동 진행 준비';save();render();if(autoEnabled)kickAutomation();return;}
    if(a==='integration'){integrationModal();return;}
    if(a==='retry-api'){await checkApi();integrationModal();return;}
    if(a==='route'){await loadRoute(id);return;}
    if(a==='more-info'){modal('추가 정보 회신',`<p class="sub">${esc(M.facilities.find(f=>f.id===id).name)}의 요청: ${esc(state.responses[id].reason)}</p><label class="field"><span>담당의가 확인한 보완 내용 (가상)</span><textarea id="inquiry-note" placeholder="담당의의 보완 회신을 입력해 주세요."></textarea></label><label class="check"><input type="checkbox" id="inquiry-attest"><span>담당의가 확인한 정보임을 확인합니다. (예시)</span></label>`,button('취소','close')+button('보완 회신 전달','send-info','primary',`data-id="${id}"`));return;}
    if(a==='send-info'){if(await act({type:'provideInfo',id,note:$('#inquiry-note').value,confirmed:$('#inquiry-attest').checked})){close();toast('보완 내용을 전달했습니다. 기관 재응답을 기다립니다.');}return;}
    if(a==='role'){goRole(el.dataset.role);return;}
    if(a.startsWith('go-')){goRole(a.slice(3));return;}
    if(['case','history','flow','guide'].includes(a)){navigateRoute(rolePath(role,a));return;}
    if(a==='review-referral'){
      if(working)return;if(!state.doctorApproved){toast('담당의의 회송 결정을 먼저 확인해 주세요.',true);return;}
      if(aiAvailable&&state.source===M.initial(state.scenario).source){await analyzeAI();return;}
      state.extraction=null;aiError='';const value=$('#referral-source')?.value||state.source;if((sourceDirty||value!==state.source)&&!await act({type:'source',value}))return;sourceDirty=false;await act({type:'parse'});return;
    }
    if(a==='references'){modal('참고 자료',button('서비스 흐름','flow')+button('공개 기관 정보 조회','hospitals')+button('기능 안내','integration')+button('이용 안내','guide'));return;}
    if(a==='ai-parse'){await analyzeAI();return;}
    if(a==='hospitals'){navigateRoute(rolePath(role,'hospitals'));return;}
    if(a==='hospital-map'){hospitalFocus=hospitalResults?.items.find(f=>f.id===id)||null;render();document.querySelector('.directory-map')?.scrollIntoView({behavior:'smooth',block:'center'});return;}
    if(a==='hospital-search'){await loadHospitals();return;}
    if(a==='parse'){state.extraction=null;aiError='';const val=$('#referral-source').value;if(val!==state.source&&!await act({type:'source',value:val}))return;await act({type:'parse'});return;}
    if(['ready','send','publish','expand','handoff','ack','relink'].includes(a)){if(await act({type:a})){toast(a==='ack'?'의뢰기관 확인까지 완료했습니다.':a==='send'?'가상 수용 문의를 생성했습니다.':'진행 상태를 반영했습니다.');}return;}
    if(a==='demo'){if(await act({type:'demoResponses'},'simulation'))toast('미리 준비한 가상 기관 응답을 불러왔습니다.');return;}
    if(a==='priority-distance'||a==='priority-cost'){await act({type:'preferences',priority:a.split('-')[1]});return;}
    if(a==='response'){await act({type:'response',id:facility,status:$('#response-status').value,reason:$('#response-reason').value});return;}
    if(a==='visit'){await act({type:'visit',id:facility,result:$('#visit-result').value,note:$('#visit-note').value});return;}
    if(a==='detail'){detail(id);return;}
    if(a==='compare'){compare.has(id)?compare.delete(id):compare.add(id);render();return;}
    if(a==='open-compare'){
      const fs=M.accepted(state);if(fs.length<2){toast('두 기관 이상을 비교에 담아 주세요.');return;}
      modal('병원 상세 비교',`<p class="comparison-hint tiny">표를 좌우로 밀면 다른 병원의 조건도 볼 수 있어요.</p><div class="table-scroll" tabindex="0" role="region" aria-label="병원 조건 비교 표"><table class="comparison-table"><thead><tr><th>비교 항목</th>${fs.map(f=>`<th>${f.name}</th>`).join('')}</tr></thead><tbody>${[['시설 예시',f=>photo(f,true)],['기관 유형',f=>facilityType(f)],['이동 거리',f=>f.km+'km'],['예상 이동',f=>f.minutes+'분'],['1일 예상 비용',f=>money(f.cost)],['정맥 투여',f=>capability('정맥 투여',f.iv)],['격리 처치',f=>capability('격리 처치',f.isolation)],['수용 응답',f=>statusBadge(U.facilityStatus(f,state))],['기관 회신',f=>displayFact(f.response.reason)]].map(([k,fn])=>`<tr><th>${k}</th>${fs.map(f=>`<td>${fn(f)}</td>`).join('')}</tr>`).join('')}<tr><th>기관 선택</th>${fs.map(f=>`<td>${button('이 기관 선택','choose','primary small',`data-id="${f.id}"`)}</td>`).join('')}</tr></tbody></table></div><p class="tiny" style="margin-top:15px">기관 회신과 이동·비용 조건을 함께 비교해 주세요.</p>`);return;
    }
    if(a==='choose'){const f=M.candidates(state).find(f=>f.id===id);modal('선택한 기관 확인',`<h3>${f.name}</h3><p class="sub">${f.area} · 이동 ${f.minutes}분 · 예상 비용 ${money(f.cost)}/일</p><div class="notice">선택한 기관에만 회송 정보가 전달되도록 동의합니다. 다른 기관의 문의는 종료됩니다. 실제 전원·진료 확정은 아닙니다.</div><label class="check"><input type="checkbox" id="share-consent"><span>선택한 기관에 회송 정보를 제공하는 데 동의합니다.<small>범위: 이름·환자번호·연락처·필요 처치·회송서에 기재된 상세 처방. 목적: 전원 준비와 첫 진료 연계. 정보는 선택한 수용기관에만 공개됩니다.</small></span></label>`,button('취소','close')+button('동의하고 기관 선택','confirm-choice','primary',`data-id="${id}"`));return;}
    if(a==='confirm-choice'){if(await act({type:'choose',id,consent:$('#share-consent').checked})){compare.clear();close();toast('기관 선택을 기록했습니다. 의뢰기관에서 전원을 준비합니다.');}return;}
    if(a==='supplement'){modal('담당의 보완 회신 입력 (예시)',`<p class="sub">문서에 없는 처방을 추정하지 않습니다. 이 입력은 담당의가 보완한 정보를 전달받는 상황을 반영합니다.</p>${M.missing(state).map(k=>`<label class="field"><span>${M.fields[k]}</span><input id="supp-${k}" value="" placeholder="담당의 보완 회신 내용 (가상)"></label>`).join('')}<label class="check"><input type="checkbox" id="doctor-replied"><span>담당의의 보완 회신을 받은 상황임을 확인합니다. (예시)</span></label>`,button('취소','close')+button('보완 회신 반영','confirm-supplement','primary'));return;}
    if(a==='confirm-supplement'){const values=Object.fromEntries(M.missing(state).map(k=>[k,$('#supp-'+k).value]));if(await act({type:'supplement',values,confirmed:$('#doctor-replied').checked})){close();toast('담당의 보완 회신을 반영했습니다.');}return;}
    if(a==='reset'){resetModal('normal');return;}
    if(a==='confirm-reset'){
      if(working)return;const scenario=$('#reset-scenario')?.value||'normal';generation++;autoRunId++;autoRunning=false;setBusy(true,'새 회송 건을 만들고 있습니다…');
      try{
        const old=JSON.parse(localStorage.getItem(KEY+'-archives')||'[]');if(!S.active&&state.events.length){old.unshift({state,at:new Date().toISOString()});localStorage.setItem(KEY+'-archives',JSON.stringify(old.slice(0,10)));}
        const result=S.available?await S.create(scenario):null;
        if(!result)S.forget();state=result?.state||M.initial(scenario);aiError='';agentError='';sharedError='';basicMode=false;sourceEditMode=false;sourceDirty=false;consentDraft=false;autoEnabled=true;compare.clear();role='hospital';facility='saebom';view='case';liveMessage='회송 정보 점검 대기';save();close();writeRoute('/hospital');setBusy(false);render();window.scrollTo(0,0);toast('새 회송 건을 시작했습니다. 기존 회송 기록은 유지됩니다.');
      }catch(e){toast(e.message||'새 회송 건을 만들지 못했습니다.',true);}finally{setBusy(false);}return;
    }
    if(a==='export'){
      const data={prototype:'CareBridge v7',synthetic:true,scope:'비응급 회송 결정 이후부터 의뢰기관의 첫 진료 이행 회신 확인까지',scenario:state.scenario,stage:M.stages[state.stage],completed:state.ack,metrics:state.metrics,events:state.events,apiMode:apiReady,apiCalls};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='carebridge-demo-record.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('진행 기록을 내려받았습니다.');return;
    }
  }
  function resetModal(scenario){modal('처음부터 시작',`<p><strong>선택·동의·기관 응답이 없는 첫 단계에서 새 회송 건을 시작합니다.</strong></p><p>기존 회송 건은 삭제하지 않습니다. 공유 회송은 이전 이용 링크나 첫 화면의 기록 목록에서 다시 열 수 있습니다.</p><label class="field"><span>시작할 시나리오</span><select id="reset-scenario"><option value="normal" ${scenario==='normal'?'selected':''}>정상 연계</option><option value="missing" ${scenario==='missing'?'selected':''}>회송 정보 누락</option><option value="unavailable" ${scenario==='unavailable'?'selected':''}>수용 불가·재탐색</option></select></label>${!S.available?'<p class="notice amber">현재는 이 브라우저 안에서 시작합니다. 공유 저장소 연결 후 새 건을 만들면 기기 간 연결을 이용할 수 있습니다.</p>':''}`,button('취소','close')+button('새 회송으로 시작','confirm-reset','primary'));}
  async function checkApi(){
    try{if(location.protocol==='file:')throw Error('offline');const r=await fetch('/api/health',{signal:AbortSignal.timeout(3500)});const result=await r.json();apiReady=r.ok&&result.version===2;aiAvailable=apiReady&&result.aiAnalysisAvailable===true;}catch{apiReady=false;}
    apiChecked=true;liveMessage=state.stage===0?'회송 정보 점검 대기':'동의와 진행 상태 확인';render();kickAutomation();
  }
  function integrationModal(){
    modal('기능 안내',`<div class="notice ${apiReady?'green':'amber'}">${apiReady?'서비스를 이용할 수 있습니다.':'기본 모드입니다. AI 분석과 지도 조회는 웹사이트에서 이용해 주세요.'}</div>${dl([['AI 분석',aiAvailable?'회송서 항목 정리, 기관 추천 근거, 문의 초안 작성, 기관 회신 분석과 다음 작업 안내를 지원합니다.':'현재 AI 분석을 사용할 수 없습니다. 기본 항목 점검으로 진행할 수 있습니다.'],['기관 정보','공개 지도에서 기관의 기본 정보를 조회합니다. 실제 병상·처치 역량·수용 가능 여부는 제공하지 않습니다.'],['이동 경로','선택한 기준 지역 중심에서 예시 기관까지 경로를 확인합니다. 환자의 상세 주소는 사용하지 않습니다.'],['기관 문의·회신','모의 응답으로 업무 흐름을 확인할 수 있습니다. 실제 병원 연락·병상 예약은 하지 않습니다.'],['직접 확인할 작업','환자 동의·기관 선택, 서류·일정 확인, 첫 진료 회신, 의뢰기관 최종 확인'],['진행 상태 저장',S.active?'회송 건과 문의·회신·동의·처리 기록을 공유 저장소에 보관합니다. 역할별 이용 링크로 같은 건에 연결하며, 계정 로그인 방식은 아닙니다.':'현재 기록은 이 브라우저에 저장됩니다. 처음부터 시작해 새 공유 회송을 만들면 역할별 이용 링크를 사용할 수 있습니다.']])}`,button('상태 다시 확인','retry-api')+button('닫기','close','primary'));
  }

  async function loadRoute(id){
    const target=$('#route-result');if(!target)return;target.innerHTML='<p role="status">이동 경로를 불러오고 있습니다…</p>';
    if(!apiReady){target.innerHTML='<p class="notice amber">이동 경로를 불러올 수 없습니다. 웹사이트에서 다시 확인해 주세요.</p>';return;}
    try{const started=performance.now(),r=await fetch('/api/route?facility='+encodeURIComponent(id)+(state.preferences.custom?'&origin='+encodeURIComponent(state.preferences.custom.location):''),{signal:AbortSignal.timeout(8500)}),data=await r.json();apiCalls.unshift({action:'OSRM route',status:r.status,ms:Math.round(performance.now()-started),time:new Date().toISOString()});if(!r.ok)throw Error(data.error);routeResults[id]=data;if(!$('#route-result')||$('#route-result').dataset.id!==id)return;
      const coords=data.coordinates,xs=coords.map(c=>c[0]),ys=coords.map(c=>c[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      const points=coords.map(c=>[24+(c[0]-minX)/(maxX-minX||1)*452,196-(c[1]-minY)/(maxY-minY||1)*172]);
      target.innerHTML=mapFrame(data.coordinates.at(-1)[1],data.coordinates.at(-1)[0],'가상 목적지의 실제 지도 위치')+`<div class="notice green"><b>${data.km}km · 약 ${data.minutes}분</b><br>지도에서 조회한 경로 · 예시 위치 기준 · 실시간 교통 미반영</div><svg viewBox="0 0 500 220" class="route-chart" role="img" aria-label="조회한 이동 경로"><polyline points="${points.map(c=>c.join(',')).join(' ')}" fill="none" stroke="#29357d" stroke-width="4" stroke-linejoin="round"/><circle cx="${points[0][0]}" cy="${points[0][1]}" r="6" fill="#19765f"/><circle cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="6" fill="#29357d"/></svg><p class="tiny">© OpenStreetMap contributors / OSRM · 위 지도는 가상 목적지, 선은 조회한 이동 경로입니다.<br>실제 병원 위치·환자 주소가 아닌 가상 출발지와 목적지입니다. 카드의 거리는 지역 기준 추정값이며, 이 도로 조회 결과를 매칭 점수로 대신 사용하지 않습니다.</p>`;
    }catch(e){if($('#route-result')?.dataset.id===id)target.innerHTML=`<p class="notice amber">${esc(e.message||'이동 경로를 불러오지 못했습니다.')} 경로 조회 실패 시 추정 거리와 실제 조회 결과를 혼동하지 않도록 별도로 표시합니다.</p>`;}
  }
  function mapFrame(lat,lon,title){return `<iframe class="map-frame" title="${esc(title)}" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${lon-.025}%2C${lat-.016}%2C${lon+.025}%2C${lat+.016}&layer=mapnik&marker=${lat}%2C${lon}"></iframe>`;}
  function hospitalsPage(){
    const names={gwanak:'서울 관악·서초',dongjak:'서울 동작·영등포',anyang:'경기 안양'},data=hospitalResults,focus=hospitalFocus||data?.center;
    return pageHead('실제 의료기관 검색','공개 지도에서 의료기관 기본 정보를 조회합니다. 예시 수용 문의와는 별도 화면입니다.')+`<section class="panel"><div class="directory-toolbar"><label class="field"><span>검색 지역 · 주변 지도 영역</span><select id="hospital-area">${Object.entries(names).map(([k,v])=>`<option value="${k}" ${k===hospitalArea?'selected':''}>${v}</option>`).join('')}</select></label>${button(hospitalLoading?'공개 정보 조회 중…':'공개 기관 정보 조회','hospital-search','primary',hospitalLoading?'disabled':'')}</div><p class="tiny">실제 기관명·위치: OpenStreetMap / Nominatim 공개 정보 · 병상, 현재 수용 여부, 처치 역량은 제공하지 않습니다.</p>${hospitalError?`<div class="notice amber" role="alert">${esc(hospitalError)}</div>`:''}${hospitalLoading?'<div class="pending" role="status">공개 지도에서 기관 정보를 불러오고 있습니다…</div>':''}${data?`<div class="row">${badge('기관 정보 조회 완료','green')}${badge(data.items.length+'개 기관')}<span class="tiny">조회 ${when(data.at)}${data.cached?' · 최근 조회 결과 재사용':''}</span></div>`:''}</section>${data?`<div class="directory-layout"><div class="directory-list">${data.items.length?data.items.map(f=>`<article class="panel directory-item"><span class="tiny">공개 지도 등록 기관</span><h2>${esc(f.name)}</h2><p class="sub">${esc(f.address||'주소 상세 미등록 · 지도에서 위치를 확인해 주세요.')}</p>${f.phone?`<p class="tiny">등록 전화 ${esc(f.phone)}</p>`:''}<div class="row">${button('지도에서 보기','hospital-map','small',`data-id="${esc(f.id)}"`)}<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">원본 정보 ↗</a>${f.website?`<a href="${esc(f.website)}" target="_blank" rel="noopener noreferrer">등록 홈페이지 ↗</a>`:''}</div></article>`).join(''):'<section class="panel">이 지역에서 등록 정보를 찾지 못했습니다. 다른 지역을 선택해 주세요.</section>'}</div><section class="panel directory-map"><h2>${esc(focus.name||names[data.area]+' 검색 중심')}</h2>${mapFrame(focus.lat,focus.lon,'실제 기관 검색 지역 지도')}<p class="tiny">© OpenStreetMap contributors · 지도와 기관 정보의 최신성·완전성을 보장하지 않습니다. <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noopener noreferrer">지도 이용 정책</a> · 소규모 예시용, 6시간 캐시·연속 호출 제한 적용.</p><div class="notice">여기에 표시된 실제 기관에 문의·예약을 전송하지 않습니다. 회송 예시는 별도의 가상 기관으로 진행합니다.</div></section></div>`:''}`;
  }
  async function loadHospitals(){
    if(hospitalLoading)return;hospitalArea=$('#hospital-area')?.value||hospitalArea;hospitalLoading=true;hospitalError='';hospitalResults=null;hospitalFocus=null;render();
    try{const start=performance.now(),r=await fetch('/api/hospitals?area='+hospitalArea,{signal:AbortSignal.timeout(20000)}),data=await r.json();apiCalls.unshift({action:'공개 의료기관 검색',status:r.status,ms:Math.round(performance.now()-start),time:new Date().toISOString()});if(!r.ok)throw Error(data.error);hospitalResults=data;}
    catch(e){hospitalError=e.message||'기관 정보를 불러오지 못했습니다.';}finally{hospitalLoading=false;if(view==='hospitals')render();}
  }
  function enhance(){
    const footer=$('.app-footer');if(footer)footer.textContent='서울대학교 산업공학과 · 헬스케어 서비스 혁신 프로젝트 / CareBridge v7';
    const strip=$('.demo-strip span:nth-child(2)');if(strip)strip.textContent=apiReady?'수용 응답은 모의 데이터':'기본 모드 · 수용 응답은 모의 데이터';
    const next=$('.walkthrough');if(next&&nextRole()!==role&&!next.querySelector('[data-action="next-role"]'))next.insertAdjacentHTML('beforeend',button(roles[nextRole()]+' 화면으로','next-role','small'));
    if(next&&autoEnabled&&(state.stage===1&&state.consent||state.stage===2)&&!allAnsweredWithoutAcceptance()){next.querySelector('span').textContent='기관 문의와 회신을 확인하고 있어요. 환자 선택과 최종 확인은 직접 진행합니다.';next.querySelector('[data-action="next-role"]')?.remove();}
    if(next&&allAnsweredWithoutAcceptance())next.querySelector('span').textContent='수용 가능한 기관이 없습니다. 의뢰기관에서 추가 정보 요청 또는 탐색 범위를 확인해 주세요.';
    if(view==='case'){
      if(role==='facility'&&state.inquiryNotes?.[facility]&&!$('#inquiry-note-summary')){$('.grid > div:first-child .panel')?.insertAdjacentHTML('beforeend',`<section id="inquiry-note-summary" class="notice"><h3>의뢰기관의 보완 회신</h3><p>${esc(state.inquiryNotes[facility])}</p><small>담당의 확인 내용 전달 · 예시</small></section>`);}
      if(role==='hospital'&&!$('.automation-panel')){$('.grid > div:last-child')?.insertAdjacentHTML('afterbegin',connectionPanel());}
      if(role==='hospital'&&state.stage===2&&state.inquiries.some(id=>!state.responses[id])&&!$('[data-action="timeout-demo"]'))$('.grid > div:last-child .panel')?.insertAdjacentHTML('beforeend',button('무응답 예외 처리','timeout-demo','quiet small'));
      if(role==='hospital'&&state.stage===2&&!Object.keys(state.responses).length&&!$('[data-action="expand"]')){$('.grid > div:last-child .panel:nth-child(2)')?.insertAdjacentHTML('beforeend',button('무응답 시 범위 조정·재문의','expand','small'));}
      if(role==='patient'&&state.stage<3&&!$('.automation-panel')){$('.empty-hint')?.insertAdjacentHTML('afterbegin',connectionPanel());}
      if(role==='patient'&&allAnsweredWithoutAcceptance()){const title=$('.empty-hint > h2');if(title)title.textContent='담당자가 수용 조건을 다시 확인해야 해요.';const sub=$('.empty-hint > p');if(sub)sub.textContent='현재 문의 기관 중 수용이 확인된 곳이 없습니다. 의뢰기관에서 추가 정보 요청이나 이동 범위를 확인한 뒤 다시 안내합니다.';}
      for(const card of document.querySelectorAll('.facility')){
        const name=card.querySelector('h3')?.textContent,f=M.facilities.find(x=>x.name===name);
        if(f&&state.responses[f.id]?.status==='more'&&role==='hospital'&&state.stage===2&&!card.querySelector('[data-action="more-info"]'))card.querySelector('.facility-bottom .row')?.insertAdjacentHTML('beforeend',button('추가 정보 회신','more-info','primary small',`data-id="${f.id}"`));
      }
      const value=$('.case-summary > div:nth-child(2) .value');if(value)value.textContent=state.data.treatment||'회송서 점검 전';
      if(state.stage===1&&!state.consent){const live=$('.automation-live');if(live)live.innerHTML='<span class="connection-dot"></span>환자 동의 대기 · 문의 생성을 보류하고 있습니다.';}
      if(state.stage===6&&state.visit?.result==='missed'){const live=$('.automation-live');if(live)live.innerHTML='<span class="connection-dot"></span>첫 진료 미이행 · 담당자의 사유 확인과 재연계 필요';}
      if(state.stage===7){const old=$('.complete h1');if(old){const h=document.createElement('h2');h.textContent=old.textContent;old.replaceWith(h);}}
    }
    if(view==='guide'){$('.readme').innerHTML=`<h2>이용 순서</h2><ol><li>의뢰기관: 담당의 결정 확인 → 정보 구조화 → 기관 문의 준비</li><li>환자·보호자: 희망 조건 선택 → 비식별 기관 문의 동의 확인 → 동의하고 기관 찾기</li><li>자동 진행: 문의 생성 → 기관별 모의 수용 응답 → 수용 확인 후보 공개</li><li>환자·보호자: 사진·거리·비용·기관 회신 비교 → 기관 선택과 별도 정보 제공 동의</li><li>의뢰기관: 서류·이동 일정·환자 안내 확인 → 전달 기록 생성</li><li>수용기관: 첫 진료 이행 또는 미이행 회신</li><li>의뢰기관: 이행 회신 확인 후 완료. 미이행은 재연계.</li></ol><h2>AI가 도와주는 업무</h2><p>회송서의 항목을 정리하고, 환자 조건에 맞는 기관의 추천 근거와 문의 초안을 작성합니다. 기관 회신을 분석해 다음 작업을 안내합니다. 처치 가능 여부나 수용 결정은 의료진·기관이 판단하고, 기관은 환자·보호자가 선택합니다.</p><p>환자의 거리·비용·방문 시간 조건은 후보 탐색에 반영됩니다. 기관 정보·평가·응답 이력·등록 병상은 예시값입니다. 기관이 등록 정보를 변경하거나 환자가 후보를 거절하면 탐색 조건을 다시 확인하고 문의 동의를 받습니다.</p><p>공개 지도에서 실제 의료기관의 기본 정보와 예시 위치의 이동 경로를 조회할 수 있습니다. 회송 예시의 기관 문의·수용 응답은 모의 데이터이며, 실제 병원 연락·병상 예약·문자 전송은 하지 않습니다.</p><h2>예외 경로</h2><p>정보 누락: 담당의 보완 회신 전 진행 차단. 수용 불가: 40km로 범위 확장 후 동의 재확인. 무응답: 자동 진행을 끄고 담당자가 범위 조정. 추가 정보 요청: 자동 진행을 끈 뒤 기관의 요청에 담당의 확인 내용을 회신. 첫 진료 미이행: 완료 차단 후 재연계.</p><h2>저장과 사진</h2><p>환자·회송 정보와 처리 기록은 DB에 저장됩니다. 역할별 이용 링크로 같은 회송 건에 연결합니다. 기관 계정 로그인 방식은 아닙니다. 내려받은 HTML을 직접 열면 서버 기능 없이 브라우저 모드로 동작합니다.</p><p>각 기관의 시설 사진은 서로 다른 AI 생성 예시이며 실제 기관의 시설이나 품질을 나타내지 않습니다. 기관·거리·금액·처방도 모두 예시 데이터입니다.</p>${button('기능 안내','integration','primary')}`;}
    const dialog=$('#dialog');if(dialog.open&&dialog.querySelector('h2')?.textContent&&M.facilities.some(f=>f.name===dialog.querySelector('h2').textContent)&&!dialog.querySelector('.facility-photo')){
      const f=M.facilities.find(f=>f.name===dialog.querySelector('h2').textContent);dialog.querySelector('.dialog-body').insertAdjacentHTML('afterbegin',photo(f));dialog.querySelector('.dialog-body').insertAdjacentHTML('beforeend',`<h3>이동 경로 참고</h3><p class="tiny">공개 지도에서 이동 경로 확인 · 예시 위치 기준</p>${button('이동 경로 확인','route','',`data-id="${f.id}"`)}<div id="route-result" data-id="${f.id}"></div>`);
    }
  }
  function replyQuote(text,status){
    const expressions={accepted:/수용이 가능합니다|수용 가능합니다|수용 가능|희망 일정 수용/g,rejected:/수용할 수 없습니다|수용 불가|수용이 불가|수용할 수 없음/g,more:/보완이 필요합니다|보완이 필요|정보 보완|판단 전|아직 수용 가능 응답이 아닙니다/g,timeout:/응답 기한|확인하지 못했습니다/g};
    const pattern=expressions[status];if(!pattern)return esc(text);let out='',from=0;
    for(const match of String(text).matchAll(pattern)){out+=esc(String(text).slice(from,match.index))+`<mark class="reply-emphasis">${esc(match[0])}</mark>`;from=match.index+match[0].length;}
    return out+esc(String(text).slice(from));
  }
  function agentDetail(){
    const a=state.lastAgent;if(!a){toast('문의 동의 후 AI 분석이 진행됩니다.');return;}
    const replies=a.interpretations||[],count=status=>replies.filter(r=>r.status===status).length,n=count('accepted'),tone=n?'green':!replies.length?'pending':count('rejected')===replies.length?'red':'amber';
    const title=n?`수용 가능한 기관 ${n}곳을 확인했습니다.`:count('more')?'추가 정보를 확인해야 수용 여부를 판단할 수 있습니다.':count('timeout')?'기관의 수용 응답을 확인하지 못했습니다.':replies.length?'현재 수용 가능한 기관이 없습니다.':'기관의 수용 응답을 기다립니다.';
    const summary=`<section class="reply-overview overview-${tone}" aria-label="회신 분석 요약"><strong>${esc(title)}</strong><div class="row">${['accepted','rejected','more','timeout'].filter(status=>count(status)).map(status=>statusBadge({...U.responsePresentation(status),label:U.responsePresentation(status).label+' '+count(status)+'곳'})).join('')}</div><p>다음 작업: <b>${esc(a.actionLabel)}</b></p></section>`;
    modal('AI 추천·문의·회신 근거',`<p class="tiny">${when(a.at)} AI 분석${a.cached?' · 검증 결과 재사용':''}</p>${summary}<h3>환자 희망 조건</h3><p>${esc(M.profile(state).text)}</p>${a.recommendations.length?`<h3>매칭 점수와 AI 추천 근거</h3><p class="tiny">처치·거리·비용 상한을 검사한 뒤 다기준 점수로 정렬합니다. 점수는 임상적 적합성 평가가 아닙니다.</p>${a.recommendations.map(r=>`<section class="agent-evidence"><div class="row space"><h3>${esc(M.facilities.find(f=>f.id===r.id).name)}</h3><span class="evidence-score">조건 적합 점수 <b>${r.score}</b>/100</span></div><ul>${r.basis.map(x=>`<li>${displayFact(x)}</li>`).join('')}</ul></section>`).join('')}`:''}<h3>비식별 문의 초안</h3><div class="tagged-referral inquiry-highlight" aria-label="문의 초안 핵심 항목">${highlightedText(state.inquiryDraft||'문의 초안 작성 전',true)}</div><h3>기관 회신 분석</h3>${replies.length?replies.map(r=>{const presentation=U.responsePresentation(r.status);return `<article class="reply-card reply-${presentation.tone}" aria-label="${esc(M.facilities.find(f=>f.id===r.id).name+' '+presentation.label)}"><div class="reply-card-head"><h4>${esc(M.facilities.find(f=>f.id===r.id).name)}</h4>${statusBadge(presentation)}</div><p class="reply-quote">${replyQuote(r.quote,r.status)}</p><p class="reply-next">${esc(presentation.hint)}</p></article>`;}).join(''):'<p class="tiny">기관 응답을 받은 뒤 원문 근거와 해석을 보여줍니다.</p>'}<details class="agent-history"><summary>최근 AI 작업 기록</summary><ol>${(state.agentRuns||[]).map(r=>`<li>${when(r.at)} · ${esc(r.action)}</li>`).join('')}</ol></details><p class="tiny">실제 병원 연락·예약은 하지 않습니다. 기관 문의·회신은 모의 데이터이며 수용 결정·환자 선택·최종 확인은 별도 단계입니다.</p>`,button('닫기','close')+button(state.stage===3?'후보 비교·선택으로':'다음 작업 확인','agent-workflow','primary'));
  }
  function renderTaskPanel(){
    if(view!=='case'||role==='patient'&&state.stage===3)return;
    const t=role==='hospital'&&state.stage===0&&!state.patientRecord&&S.active?{owner:'의뢰기관',title:'회송 대상 환자를 먼저 확인해 주세요.',description:'환자 정보를 검색하거나 신규 등록한 뒤 이 회송 건에 불러옵니다.',tone:'navy',action:'patients',label:'환자 검색·등록'}:U.nextTask(state,role,{canAI:aiAvailable&&state.source===M.initial(state.scenario).source,missing:M.missing(state).map(k=>M.fields[k]),auto:autoEnabled,consentDraft,facility,agentError,noCandidates:!M.candidates(state).some(f=>f.eligible),acceptedCount:M.accepted(state).length,compareCount:compare.size});
    const offer=t.action&&!t.action.startsWith('go-');
    if(offer)for(const b of document.querySelectorAll(`main [data-action="${t.action}"]`)){b.classList.remove('primary');b.classList.add('task-secondary');}
    const markup=`<section class="task-panel task-${t.tone} focused-task" aria-labelledby="task-title"><div><div class="task-kicker">현재 ${state.stage+1} / ${M.stages.length} · ${esc(t.owner)}</div><h2 id="task-title" tabindex="-1">${esc(t.title)}</h2><p>${esc(t.description)}</p></div>${offer?`<div class="task-action">${button(esc(t.label),t.action,'primary',t.id?`data-id="${esc(t.id)}"`:'')}</div>`:!t.action?'<span class="task-wait" role="status">응답 대기</span>':''}</section>`;
    const old=$('.task-panel');if(old)old.outerHTML=markup;else $('.page-heading')?.insertAdjacentHTML('afterend',markup);
  }

  function handoffProgress(target){
    const h=U.handoffStatus(state,target),copy=h.copied?'링크 복사 완료':'링크 복사 전';
    return `<section class="handoff-progress" aria-label="요청과 응답 상태"><h3>${target==='patient'?'환자·보호자':'수용기관'} 요청 현황</h3><ol><li class="done"><span aria-hidden="true">✓</span>요청 링크 준비됨</li><li class="${h.copied?'done':'pending'}"><span aria-hidden="true">${h.copied?'✓':'2'}</span>${copy}${h.at?`<small>${when(h.at)}</small>`:''}</li><li class="${h.response?'done':'pending'}"><span aria-hidden="true">${h.response?'✓':'3'}</span>${h.response?h.complete:h.waiting}</li></ol><p class="tiny">링크 복사는 발송·읽음 확인이 아닙니다. ${h.response?'상대방이 기록한 응답을 확인했습니다.':'상대방이 응답해야 다음 단계로 진행됩니다.'}</p></section>`;
  }
  function renderJourney(){
    if(view!=='case')return;
    $('.page-heading')?.insertAdjacentHTML('afterend',`<ol class="journey-strip" aria-label="전체 연계 진행">${U.journey(state.stage).map((step,i)=>`<li class="${step.status}" ${step.status==='current'?'aria-current="step"':''}><span aria-hidden="true">${step.status==='done'?'✓':i+1}</span>${step.label}<span class="sr-only">${step.status==='done'?' 완료':step.status==='current'?' 진행 중':' 예정'}</span></li>`).join('')}</ol>`);
    if(role==='hospital'&&[1,2,3,5].includes(state.stage))$('.task-panel')?.insertAdjacentHTML('afterend',handoffProgress([1,3].includes(state.stage)?'patient':'facility'));
  }

  function updateFormReadiness(){
    if(working)return;
    const gate=(action,ok)=>{document.querySelectorAll(`[data-action="${action}"]`).forEach(b=>b.disabled=!ok);};
    if($('#share-consent'))gate('confirm-choice',$('#share-consent').checked);
    if($('#doctor-replied'))gate('confirm-supplement',$('#doctor-replied').checked&&M.missing(state).every(k=>$('#supp-'+k)?.value.trim()));
    if($('#inquiry-attest'))gate('send-info',$('#inquiry-attest').checked&&!!$('#inquiry-note')?.value.trim());
    if(state.stage===0){gate('review-referral',state.doctorApproved&&apiChecked);gate('parse',state.doctorApproved);gate('ai-parse',state.doctorApproved&&apiReady&&aiAvailable&&state.source===M.initial(state.scenario).source);}
    if(state.stage===4)gate('handoff',Object.values(state.prep).every(Boolean)&&(!state.requiresSchedule||M.scheduleValid(state)));
    if($('#response-status')){const value=$('#response-status').value,required=['more','rejected'].includes(value);$('#response-reason').setAttribute('aria-required',String(required));$('#response-reason').closest('label').querySelector('span').textContent=value==='rejected'?'수용 불가 사유 (필수)':value==='more'?'추가 정보 요청 내용 (필수)':'수용 조건 또는 참고 사항 (선택)';const ready=['accepted','more','rejected'].includes(value)&&(!required||!!$('#response-reason').value.trim());gate('response',ready);}
    if($('#visit-result')){const value=$('#visit-result').value,required=value==='missed';$('#visit-note').setAttribute('aria-required',String(required));$('#visit-note').closest('label').querySelector('span').textContent=required?'미이행 사유 (필수)':'추가 확인 사항 (선택)';const ready=['done','missed'].includes(value)&&(!required||!!$('#visit-note').value.trim());gate('visit',ready);}
  }
  function focusLayout(){
    if(view!=='case')return;
    const main=$('#main'),summary=$('.case-summary'),progress=$('.steps');
    if(!$('.automation-panel')&&(role==='hospital'&&state.stage<4||role==='patient'&&state.stage===2))main.insertBefore(Object.assign(document.createElement('div'),{innerHTML:connectionPanel()}).firstElementChild,$('.app-footer'));
    if(summary&&!$('.case-context')){
      const d=document.createElement('details');d.className='case-context support-details';d.innerHTML='<summary>회송 정보·전체 진행 보기</summary>';
      d.append(summary);if(progress)d.append(progress);main.insertBefore(d,$('.app-footer'));
    }
    document.querySelectorAll('.automation-panel').forEach(panel=>{
      if(panel.closest('.progress-details'))return;
      const d=document.createElement('details');d.className='support-details progress-details';d.innerHTML='<summary>문의 진행·분석 근거 보기</summary>';
      if(agentError||state.stage===2&&!M.accepted(state).length&&!Object.keys(state.responses).length)d.open=true;
      panel.replaceWith(d);d.append(panel);main.insertBefore(d,$('.case-context')||$('.app-footer'));
    });
    if(!$('.recent-history')&&state.events.length&&role!=='patient'){
      const d=document.createElement('details');d.className='support-details recent-history';d.innerHTML='<summary>최근 처리 기록 보기</summary>'+activity();main.insertBefore(d,$('.app-footer'));
    }
    if(role==='facility'){
      const settings=$('.provider-settings');if(settings)main.insertBefore(settings,$('.app-footer'));
      const grid=$('.grid');if(grid&&!grid.classList.contains('facility-task-grid')){
        grid.classList.add('facility-task-grid');const summaryColumn=grid.firstElementChild,form=grid.lastElementChild;
        const facts=document.createElement('div');facts.className='intake-facts';facts.innerHTML=`<b>필요 처치</b> ${esc(state.data.treatment||'확인 전')} <span>·</span> ${esc(state.data.period||'기간 확인 전')} <span>·</span> 격리 ${esc(state.data.isolation||'확인 전')}`;
        grid.before(facts);grid.prepend(form);const d=document.createElement('details');d.className='support-details';d.innerHTML='<summary>전달받은 회송 정보 보기</summary>';summaryColumn.replaceWith(d);d.append(summaryColumn);
      }
    }
  }

  function enhanceUX(){
    if(view==='home'||view==='not-found')return;
    const header=document.querySelector('header');
    if(header&&!$('.mobile-nav'))header.insertAdjacentHTML('afterend',`<nav class="mobile-nav" aria-label="모바일 작업 메뉴">${button('내 할 일','tasks',view==='tasks'?'active':'')}${button('회송 업무','case',view==='case'?'active':'')}${role==='hospital'?button('환자','patients',view==='patients'?'active':''):''}${button('처리 기록','history',view==='history'?'active':'')}${button('참고 자료','references',view==='guide'?'active':'')}</nav>`);
    if(view==='case'){
      renderTaskPanel();focusLayout();renderJourney();
      const formPrimary=state.stage===0?'review-referral':state.stage===4?'handoff':null;
      if(formPrimary)document.querySelector(`[data-action="${formPrimary}"]`)?.classList.add('primary');
    }
    updateFormReadiness();
  }

  document.addEventListener('input',updateFormReadiness);
  document.addEventListener('change',updateFormReadiness);
  document.addEventListener('click',dispatch);
  document.addEventListener('submit',async e=>{if(e.target.id==='patient-search-form'){e.preventDefault();await loadPatients($('#patient-query').value);}if(e.target.id==='patient-register-form'){e.preventDefault();$('[data-action="patient-save"]')?.click();}if(e.target.id==='transfer-plan-form'){e.preventDefault();if(!e.target.reportValidity())return;const values=Object.fromEntries(['when','venue','address','contact','transport','notes'].map(k=>[k,$('#plan-'+k).value]));values.confirmed=$('#plan-confirmed').checked;if(await act({type:'transferPlan',values})){const remaining=Object.values(state.prep).filter(v=>!v).length;toast('방문 안내 저장 완료'+(remaining?' · 준비 확인 '+remaining+'개가 남았습니다.':''));const next=$('[data-change^="prep-"]:not(:checked)');next?.closest('label')?.scrollIntoView({behavior:'smooth',block:'center'});next?.focus({preventScroll:true});}}if(e.target.id==='custom-preferences-form'){e.preventDefault();if(!e.target.reportValidity())return;const values={location:$('#pref-location').value,priority:state.preferences.priority,...Object.fromEntries(['maxKm','maxCost','maxMinutes'].map(k=>[k,Number($('#pref-'+k).value)]))};agentError='';compare.clear();if(await act({type:'customPreferences',values})){consentDraft=false;toast('희망 조건을 적용했습니다. 문의 동의를 다시 확인해 주세요.');}}});
  document.addEventListener('input',e=>{if(e.target.id==='patient-query'&&!e.target.value.trim()){resetPatientSearch();render();$('#patient-query')?.focus();return;}if(e.target.id==='referral-source'&&state.stage===0){sourceDirty=true;state.source=e.target.value;state.parsed=false;state.data={};state.extraction=null;const aiButton=$('[data-action="ai-parse"]');if(aiButton)aiButton.disabled=state.source!==M.initial(state.scenario).source||!apiReady||!aiAvailable;$('[data-action="ready"]')?.closest('.work-actions')?.remove();const panel=[...document.querySelectorAll('.panel')].find(p=>p.querySelector('h2')?.textContent==='구조화된 회송 정보');if(panel)panel.innerHTML='<h2>구조화된 회송 정보</h2><p class="notice amber">문서가 수정되었습니다. 회송 정보를 다시 구조화해 주세요.</p>';save();const highlight=$('#referral-highlight');if(highlight)highlight.innerHTML=highlightedSource();renderTaskPanel();updateFormReadiness();}});
  document.addEventListener('change',async e=>{
    const t=e.target;
    if(t.id==='scenario-select'){resetModal(t.value);return;}
    if(t.id==='facility-select'){navigateRoute(rolePath('facility',view,t.value));return;}
    if(t.id==='referral-source'){return;}
    if(t.dataset.change==='attest')await act({type:'attest',value:t.checked});
    if(t.dataset.change==='consent-draft'){consentDraft=t.checked;render();$('[data-change="consent-draft"]')?.focus({preventScroll:true});return;}
    if(t.dataset.change==='consent'){if(!t.checked){compare.clear();consentDraft=false;}await act({type:'consent',value:t.checked});}
    if(t.dataset.change?.startsWith('prep-'))await act({type:'prep',key:t.dataset.change.slice(5),value:t.checked});
  });
  if(initialRoute.role==='facility'&&!initialRoute.facility){facility=state.selected||state.inquiries[0]||'saebom';writeRoute(rolePath('facility',view,facility),true);}
  if(role==='facility'&&state.stage===2&&autoEnabled){autoEnabled=false;save();}
  window.addEventListener('popstate',()=>navigateRoute(routeLocation(),{pop:true}));
  render();
  initializeSharing();
  setInterval(refreshShared,4000);
  setInterval(()=>{if(view==='tasks'&&!document.hidden&&!tasksLoading&&!working)loadTasks();},15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshShared();});
})();
