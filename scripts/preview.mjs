import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import M from '../web/model.js';
import {createApi} from '../worker/api.mjs';
import {createIntegrations} from '../worker/integrations.mjs';
import {createAgentApi,createFacilityApi} from '../worker/agents.mjs';
const integrations=createIntegrations(M),agent=createAgentApi(M),facility=createFacilityApi(M);
const api=createApi(M),root=resolve(import.meta.dirname,'../web');
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',jpg:'image/jpeg'};
createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1:4175');
  if(url.pathname.startsWith('/api/')){
    const chunks=[];for await(const c of req)chunks.push(c);
    const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const result=await agent(request)||await facility(request)||await integrations(request)||await api(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  const isAppRoute=/^\/(hospital|patient|facility)(\/|$)/.test(url.pathname);
  const path=resolve(root,'.'+(url.pathname==='/'||isAppRoute?'/index.html':decodeURIComponent(url.pathname)));
  if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  const bytes=await readFile(path);res.writeHead(200,{'Content-Type':types[path.split('.').pop()]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}}).listen(4175,'127.0.0.1',()=>console.log('CareBridge: http://127.0.0.1:4175'));
