import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import R from '../web/routes.js';
const source=await readFile(new URL('../web/shared.js',import.meta.url),'utf8');
test('새 회송으로 전환한 뒤 늦게 도착한 이전 조회가 새 건의 권한·상태를 덮어쓰지 않음',async()=>{
 let deferred,created=0;const a={id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',revision:0,credentials:{hospital:'A'.repeat(43)},state:{caseId:'CASE-A',stage:0}},b={id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',revision:0,credentials:{hospital:'B'.repeat(43)},state:{caseId:'CASE-B',stage:0}},data=new Map();
 const context={CareBridgeRoutes:R,location:{pathname:'/hospital',hash:'',protocol:'https:'},URLSearchParams,AbortSignal,crypto,localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},fetch:async(url,opts)=>{if(opts.method==='POST')return Response.json(++created===1?a:b);return new Promise(resolve=>{deferred=()=>resolve(Response.json({...a,role:'hospital'}));});}};
 vm.runInNewContext(source,context);const S=context.CareBridgeShared;await S.create('normal');const pending=S.refresh();await S.create('normal');deferred();await pending;assert.equal(S.session.id,b.id);assert.equal(S.session.credentials.hospital,b.credentials.hospital);assert.equal(S.session.caseId,b.state.caseId);assert.equal(JSON.parse(data.get('carebridge-shared-case-v1')).caseId,b.state.caseId);
});

test('초기 연결 확인이 늦어져도 입력 화면을 먼저 열었다 다시 그리지 않음',async()=>{
 const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
 const initialize=app.slice(app.indexOf('  async function initializeSharing(){'),app.indexOf('  async function refreshShared(){'));
 const health=app.slice(app.indexOf('  async function checkApi(){'),app.indexOf('  function integrationModal(){'));
 let finishHealth;const frames=[];
 const ctx={URLSearchParams,AbortSignal,location:{hash:'',protocol:'https:'},S:{init:async()=>({state:{stage:4}})},view:'case',sharedLoading:false,sharedError:'',state:{stage:0},sourceDirty:false,apiChecked:false,apiReady:false,aiAvailable:false,liveMessage:'',render:()=>frames.push({loading:ctx.sharedLoading,checked:ctx.apiChecked}),save(){},writeRoute(){},routeLocation:()=>'/hospital',kickAutomation(){},loadTasks(){},fetch:async url=>url.includes('health')?new Promise(resolve=>{finishHealth=()=>resolve(Response.json({version:2,aiAnalysisAvailable:true}));}):Response.json({available:true})};
 vm.runInNewContext(initialize+health+';this.pending=initializeSharing();',ctx);
 for(let n=0;n<20&&!finishHealth;n++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(finishHealth,'health request should start');
 const early=frames.some(f=>!f.loading&&!f.checked);finishHealth();await ctx.pending;
 assert.equal(early,false,'input must remain hidden until initial health status resolves');
 assert.deepEqual(frames.at(-1),{loading:false,checked:true});
});
