(function(root){
  'use strict';
  const roles=['hospital','patient','facility'],views=['case','history','flow','guide','hospitals'];
  const facilities=['saebom','solbit','daon','bom','haeon'];
  function path({role,view='case',facility='saebom'}={}){
    if(!roles.includes(role))return '/';
    if(!views.includes(view)||role==='facility'&&!facilities.includes(facility))return '/';
    return '/'+role+(role==='facility'?'/'+facility:'')+(view==='case'?'':'/'+view);
  }
  function parse(input){
    const p=String(input||'/').split(/[?#]/)[0].replace(/\/+$/,'')||'/';
    if(p==='/'||p==='/index.html')return {view:'home',role:null,facility:null};
    const parts=p.split('/').filter(Boolean),role=parts.shift();
    if(!roles.includes(role))return {view:'not-found',role:null,facility:null};
    let facility=null;
    if(role==='facility'&&parts.length&&!views.includes(parts[0])){facility=parts.shift();if(!facilities.includes(facility))return {view:'not-found',role:null,facility:null};}
    const view=parts.shift()||'case';
    if(parts.length||!views.includes(view))return {view:'not-found',role:null,facility:null};
    return {view,role,facility};
  }
  const api={path,parse,facilities};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CareBridgeRoutes=api;
})(typeof globalThis!=='undefined'?globalThis:this);
