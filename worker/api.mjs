// Synthetic, stateless demo API. Never persists or logs submitted clinical text.
export function createApi(M, upstreamFetch = fetch) {
  const routeCache = new Map();
  const points = { saebom:[126.952,37.480], solbit:[126.941,37.507], daon:[126.962,37.394], bom:[126.900,37.463], haeon:[126.968,37.344] };
  const origin = [126.976,37.491]; // Fixed fictional caregiver origin, never device geolocation.
  const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return async function api(request) {
    const url = new URL(request.url), path=url.pathname;
    if(path==='/api/health' && request.method==='GET') return json({version:2,release:3,mode:'stateless-demo-api',medicalIntegration:false,routeProvider:'OSRM',hospitalDirectory:'OpenStreetMap / Nominatim',aiAnalysisAvailable:process.env.AI_ANALYSIS_ENABLED==='true',synthetic:true});
    if(path==='/api/route' && request.method==='GET') {
      const id=url.searchParams.get('facility');
      if(!points[id]) return json({error:'유효한 시연 기관을 선택해 주세요.'},400);
      if(routeCache.has(id)) return json({...routeCache.get(id),cached:true});
      try {
        const coords=origin.join(',')+';'+points[id].join(',');
        let r;
        const servers=['https://routing.openstreetmap.de/routed-car/route/v1/driving/','https://router.project-osrm.org/route/v1/driving/'];
        for(const server of servers){
          try{
            const res=await upstreamFetch(server+coords+'?overview=simplified&geometries=geojson&steps=false',{signal:AbortSignal.timeout(3200),headers:{'User-Agent':'CareBridgeAcademicDemo/2.0','Referer':'https://carebridge-prototype-20261027.kangsanmt.chatgpt.site/'}});
            if(!res.ok)throw Error('HTTP '+res.status);
            const data=await res.json(), route=data.routes?.[0];
            if(data.code!=='Ok'||!Number.isFinite(route?.distance)||!Number.isFinite(route?.duration)||!route.geometry?.coordinates?.length)throw Error('InvalidRoute');
            r=route;break;
          }catch(e){console.warn('Route provider unavailable',{server:new URL(server).hostname,reason:e.name+': '+e.message});}
        }
        if(!r)throw Error('RouteUnavailable');
        const result={provider:'OSRM / OpenStreetMap',mode:'live',syntheticEndpoints:true,traffic:false,km:Math.round(r.distance/100)/10,minutes:Math.max(1,Math.round(r.duration/60)),coordinates:r.geometry.coordinates,at:new Date().toISOString()};
        routeCache.set(id,result); return json(result);
      } catch { return json({error:'공개 경로 API에 연결하지 못했습니다. 카드의 시연용 거리와 구분해 주세요.',mode:'unavailable'},503); }
    }
    if(path==='/api/transition' && request.method==='POST') {
      try {
        if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
        const text=await request.text();if(text.length>80000)return json({error:'시연 입력이 너무 큽니다.'},413);
        const {state,action,actor}=JSON.parse(text);
        if(!state||state.version!==1||!Number.isInteger(state.stage)||state.stage<0||state.stage>7||!['normal','missing','unavailable'].includes(state.scenario)||!Array.isArray(state.events)||!action||!['hospital','patient','facility','simulation'].includes(actor))return json({error:'시연 상태 형식을 확인해 주세요.'},400);
        const next=M.transition(state,action,actor);
        return json({state:next,engine:'CareBridge demo API',synthetic:true,requestId:crypto.randomUUID()});
      } catch(e) { return json({error:e instanceof SyntaxError?'요청 형식을 확인해 주세요.':e.message||'상태를 처리하지 못했습니다.'},422); }
    }
    return json({error:'지원하지 않는 API 요청입니다.'},404);
  };
}
