import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import M from '../web/model.js';
import {createApi} from '../worker/api.mjs';
import {createIntegrations} from '../worker/integrations.mjs';
import {createAgentApi,createFacilityApi} from '../worker/agents.mjs';
import {createCasesApi} from '../worker/cases.mjs';
import {createPatientsApi} from '../worker/patients.mjs';
const integrations=createIntegrations(M),agent=createAgentApi(M),facility=createFacilityApi(M);
const api=createApi(M),root=resolve(import.meta.dirname,'../web');
let localStore;
if(process.env.CAREBRIDGE_LOCAL_DB){
 const {PGlite}=await import('@electric-sql/pglite');const {createStore}=await import('../worker/database.mjs');
 const pg=new PGlite(process.env.CAREBRIDGE_LOCAL_DB);
 localStore=createStore({query:async(q,p)=>{const r=await pg.query(q,p);return r.rows;},batch:async qs=>pg.transaction(async tx=>{for(const q of qs)await tx.exec(q);})});
}
const cases=createCasesApi(M,{store:localStore,configured:()=>!!(localStore||process.env.DATABASE_URL)});
const patients=createPatientsApi({store:localStore,configured:()=>!!(localStore||process.env.DATABASE_URL)});
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',jpg:'image/jpeg'};
createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host);
  if(url.pathname.startsWith('/api/')){
    const chunks=[];for await(const c of req)chunks.push(c);
    const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const result=await patients(request)||await cases(request)||await agent(request)||await facility(request)||await integrations(request)||await api(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  const isAppRoute=/^\/(hospital|patient|facility)(\/|$)/.test(url.pathname);
  const path=resolve(root,'.'+(url.pathname==='/'||isAppRoute?'/index.html':decodeURIComponent(url.pathname)));
  if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  const bytes=await readFile(path);res.writeHead(200,{'Content-Type':types[path.split('.').pop()]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}}).listen(4175,'127.0.0.1',()=>console.log('CareBridge: http://127.0.0.1:4175'));
