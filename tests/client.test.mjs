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
