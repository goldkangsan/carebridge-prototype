(function(root){
  'use strict';
  const owners={hospital:'의뢰기관',patient:'환자·보호자',facility:'수용기관'};
  function facilityStatus(f,s){
    if(f.eligible===false)return {label:'문의 대상 제외',tone:'neutral',icon:'—'};
    const status=f.response?.status;
    if(status==='accepted')return {label:'수용 가능 응답',tone:'green',icon:'✓'};
    if(status==='rejected')return {label:'수용 불가 응답',tone:'red',icon:'×'};
    if(status==='more')return {label:'추가 정보 필요',tone:'amber',icon:'!'};
    if(status==='withdrawn')return {label:'문의 종료',tone:'neutral',icon:'—'};
    return s.inquiries.includes(f.id)?{label:'기관 응답 대기',tone:'pending',icon:'◷'}:{label:'수용 확인 전',tone:'amber',icon:'!'};
  }
  function nextTask(s,role,o={}){
    const make=(title,description,action,label,owner=role,tone='navy',id)=>({title,description,action,label,owner:owners[owner],tone,id});
    const switchTo=(owner,title,description)=>make(title,description,'go-'+owner,owners[owner]+' 화면으로',owner);
    if(s.stage===0){
      if(role!=='hospital')return switchTo('hospital','의뢰기관의 회송 정보 확인이 필요합니다.','시연에서는 의뢰기관 화면으로 이동해 회송서 확인을 진행합니다.');
      if(!s.doctorApproved)return make('먼저 담당의의 회송 결정을 확인해 주세요.','아래 회송서를 읽고, 담당의가 비응급 회송을 결정했는지 직접 확인합니다.','focus-attest','회송 결정 확인하기');
      if(!s.parsed)return make('회송서에서 필요한 정보를 정리해 주세요.','분석 결과를 원문과 비교합니다. 문서에 없는 처방 정보는 임의로 채우지 않습니다.',o.canAI?'ai-parse':'parse',o.canAI?'AI로 회송서 분석하기':'회송 정보 점검하기');
      if(o.missing?.length)return make('누락된 정보를 먼저 보완해 주세요.','누락 항목: '+o.missing.join(', ')+'. 담당의의 보완 회신을 받은 뒤 다음 단계로 이동합니다.','supplement','보완 회신 입력하기','hospital','amber');
      return make('회송 정보가 정리됐습니다.','처치 조건과 이동 범위에 맞는 후보 기관을 확인합니다. 수용 여부는 기관 응답으로 별도 확인합니다.','ready','후보 기관 확인하기');
    }
    if(s.stage===1&&!s.consent){
      if(role!=='patient')return switchTo('patient','기관 문의에 앞서 환자 동의가 필요합니다.','시연에서는 환자·보호자 화면에서 희망 조건과 문의 동의를 확인합니다.');
      return make('희망 조건을 확인하고 기관 탐색을 시작해 주세요.','동의 항목을 체크한 뒤 시작 버튼을 누르면 문의와 모의 응답 수집이 자동으로 진행됩니다.',o.consentDraft?'consent-start':'focus-consent',o.consentDraft?'동의하고 기관 찾기':'문의 동의 확인하기');
    }
    if(s.stage===1){
      if(o.auto)return make('조건에 맞는 기관에 문의를 준비하고 있습니다.','환자 동의를 확인했습니다. 자동 문의가 시작될 때까지 기다려 주세요.',null,null,'hospital','pending');
      return role==='hospital'?make('환자 동의를 확인했습니다.','비식별 요약을 조건에 맞는 기관에 보냅니다.','send','수용 문의 보내기'):switchTo('hospital','기관 문의를 시작할 수 있습니다.','의뢰기관에서 비식별 요약을 문의 대상 기관에 보냅니다.');
    }
    if(s.stage===2){
      const answered=s.inquiries.filter(id=>s.responses[id]).length,accepted=s.inquiries.filter(id=>s.responses[id]?.status==='accepted').length;
      if(role==='facility')return !o.facility||s.inquiries.includes(o.facility)?make('이 기관의 수용 여부를 응답해 주세요.','수용 불가 또는 추가 정보 필요를 선택하면 사유를 함께 입력합니다.','response','수용 응답 보내기'):make('문의가 도착한 기관을 선택해 주세요.','현재 선택한 기관에는 문의가 없습니다. 시연할 기관을 문의 대상 기관으로 바꿉니다.','go-facility','문의 대상 기관으로 이동','facility','amber');
      if(answered===s.inquiries.length&&s.inquiries.length&&!accepted){
        const id=s.inquiries.find(id=>s.responses[id]?.status==='more');
        if(role!=='hospital')return switchTo('hospital','의뢰기관의 추가 확인이 필요합니다.','현재 수용이 확인된 기관이 없습니다. 추가 정보 요청 또는 탐색 범위를 확인합니다.');
        return id?make('기관이 요청한 정보를 확인해 주세요.','담당의가 확인한 보완 내용을 회신하면 해당 기관이 다시 응답할 수 있습니다.','more-info','추가 정보 요청 확인하기','hospital','amber',id):make('현재 범위에서 수용 가능한 기관이 없습니다.','이동 범위를 넓힌 뒤 환자 동의를 다시 받아 재문의합니다.','expand','범위 넓혀 다시 찾기','hospital','amber');
      }
      if(o.auto)return make('기관 응답을 모으고 있습니다.','응답 '+answered+'/'+s.inquiries.length+'곳 · 수용 가능 '+accepted+'곳. 응답 수집 후 비교 가능한 후보를 자동으로 안내합니다.',null,null,'facility','pending');
      if(role==='hospital'&&accepted)return make('수용 가능한 기관을 환자에게 안내해 주세요.','수용 가능 응답이 있는 기관만 환자 비교 화면에 공개합니다.','publish','환자에게 후보 안내하기');
      return switchTo('facility','수용기관의 응답을 기다리고 있습니다.','시연에서는 수용기관 화면으로 이동해 응답을 입력할 수 있습니다.');
    }
    if(s.stage===3){
      if(role!=='patient')return switchTo('patient','환자·보호자가 기관을 선택할 차례입니다.','수용이 확인된 기관의 거리·비용·처치 정보를 비교한 뒤 직접 선택합니다.');
      return make('수용이 확인된 기관을 비교하고 선택해 주세요.','두 곳 이상을 비교에 담거나, 원하는 기관의 선택 버튼을 눌러 상세 동의를 확인합니다.',o.compareCount>=2?'open-compare':'focus-candidates',o.compareCount>=2?'담은 기관 비교하기':'기관 목록 살펴보기');
    }
    if(s.stage===4){
      if(role!=='hospital')return switchTo('hospital','의뢰기관에서 전원 준비를 진행합니다.','서류·이동 일정·환자 안내를 확인한 뒤 기존 절차에 따라 전달합니다.');
      const n=Object.values(s.prep).filter(Boolean).length;
      return n===3?make('전원 준비 확인을 마쳤습니다.','기존 공식 회송 절차의 전달 기록을 생성하고 첫 진료 회신을 기다립니다.','handoff','준비 완료하고 전달하기'):make('전원에 필요한 준비를 확인해 주세요.','준비 확인 '+n+'/3개. 실제 확인이 끝난 항목만 체크합니다.','focus-prep','준비 체크리스트로 이동');
    }
    if(s.stage===5){
      if(role==='facility')return !o.facility||o.facility===s.selected?make('첫 진료 이행 여부를 회신해 주세요.','미이행이면 확인된 사유를 기록합니다. 회신 후에는 의뢰기관의 최종 확인을 기다립니다.','visit','첫 진료 회신 보내기'):make('선택된 수용기관의 회신이 필요합니다.','환자가 선택한 기관에서 첫 진료 이행 여부를 회신합니다.','go-facility','선택된 기관으로 이동','facility','amber');
      return switchTo('facility','수용기관의 첫 진료 회신을 기다리고 있습니다.','시연에서는 수용기관 화면에서 이행 여부를 회신합니다. 아직 연계 완료 상태는 아닙니다.');
    }
    if(s.stage===6){
      if(role!=='hospital')return switchTo('hospital','의뢰기관의 회신 확인이 남았습니다.','의뢰기관에서 첫 진료 회신을 확인해야 연계가 완료됩니다.');
      return s.visit?.result==='done'?make('첫 진료 회신을 확인하고 연계를 마무리해 주세요.','수용기관의 이행 회신을 읽고 의뢰기관 담당자가 최종 확인합니다.','ack','회신 확인하고 연계 완료'):make('첫 진료가 이루어지지 않았습니다.','미이행 사유를 확인한 뒤 동의와 기관 선택을 다시 진행합니다.','relink','사유 확인 후 재연계','hospital','amber');
    }
    return make('의뢰기관 확인까지 완료했습니다.','연계 과정과 역할별 처리 기록을 확인할 수 있습니다.','history','처리 기록 보기','hospital','green');
  }
  const api={facilityStatus,nextTask};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CareBridgeUX=api;
})(typeof globalThis!=='undefined'?globalThis:this);
