import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {databaseConfigured,getDatabase} from './database.mjs';
import M from '../web/model.js';
export const patientAges=M.ageGroups;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function patientFromRegister(db,selection){
 if(!uuid(selection?.registerId)||!token(selection?.access)||!uuid(selection?.patientId)||!await db.registerAccess(selection.registerId,hash(selection.access)))return null;
 return db.readPatient(selection.registerId,selection.patientId);
}
export function patientSnapshot(p){return {id:p.id,registerId:p.register_id,number:p.number,name:p.name,age:p.age,contact:p.contact,savedAt:new Date().toISOString()};}
export function validatePatient(input){
 const name=String(input?.name||'').normalize('NFKC').trim(),number=String(input?.number||'').trim().toUpperCase(),age=input?.age,contact=String(input?.contact||'').trim();
 if(!/^[\p{L}\p{M} .'-]{2,40}$/u.test(name))throw Error('환자 이름을 2~40자로 입력해 주세요.');
 if(!/^[A-Z0-9-]{3,24}$/.test(number))throw Error('환자번호는 영문·숫자·하이픈 3~24자로 입력해 주세요.');
 if(!patientAges.includes(age))throw Error('연령대를 선택해 주세요.');
 if(contact&&!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(contact))throw Error('연락처 형식을 확인해 주세요.');
 return {id:randomUUID(),name,number,age,contact};
}
export function createPatientsApi({store,configured=()=>databaseConfigured()}={}){
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 return async request=>{
  const url=new URL(request.url);if(url.pathname!=='/api/patients')return null;
  if(!configured())return json({error:'환자 목록 저장소에 연결하지 못했습니다.'},503);
  if(request.method!=='POST')return json({error:'지원하지 않는 요청입니다.'},405);
  try{
   if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
   if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'허용되지 않은 요청입니다.'},403);
   const raw=await request.text();if(raw.length>5000)return json({error:'입력 크기를 줄여 주세요.'},413);const body=JSON.parse(raw),db=store||getDatabase();
   if(body.operation==='create-register'){
    const id=randomUUID(),access=randomBytes(32).toString('base64url');
    const samples=[['CB-P1001','김하늘','70대'],['CB-P1002','박서준','60대'],['CB-P1003','이수진','80대']].map(([number,name,age])=>({id:randomUUID(),number,name,age,contact:''}));
    await db.createRegister(id,hash(access),samples);return json({register:{id,access},syntheticOnly:true});
   }
   const registerId=url.searchParams.get('register'),access=request.headers.get('authorization')?.replace(/^Bearer /,'');
   if(!uuid(registerId)||!token(access))return json({error:'환자 목록의 이용 권한이 필요합니다.'},401);
   if(!await db.registerAccess(registerId,hash(access)))return json({error:'환자 목록의 이용 링크를 확인해 주세요.'},403);
   if(body.operation==='search'){
    if(typeof body.query!=='string'||body.query.length>80)return json({error:'검색어를 80자 이내로 입력해 주세요.'},400);
    return json({patients:await db.searchPatients(registerId,body.query.trim()),limit:30,syntheticOnly:true});
   }
   if(body.operation==='detail'){
    if(!uuid(body.patientId))return json({error:'환자를 확인해 주세요.'},400);
    const p=await db.readPatient(registerId,body.patientId);if(!p)return json({error:'등록된 환자를 찾을 수 없습니다.'},404);
    return json({patient:{id:p.id,number:p.number,name:p.name,age:p.age,contact:p.contact},cases:await db.patientHistory(registerId,p.id),syntheticOnly:true});
   }
   if(body.operation==='register'){
    const p=validatePatient(body.patient),saved=await db.insertPatient(registerId,p);
    if(!saved)return json({error:'이미 등록된 환자번호입니다. 이름이나 환자번호로 기존 환자를 검색해 주세요.',duplicate:true},409);
    return json({patient:saved,syntheticOnly:true},201);
   }
   return json({error:'지원하지 않는 요청입니다.'},400);
  }catch(e){if(e instanceof SyntaxError)return json({error:'요청 형식을 확인해 주세요.'},400);if(e.storageFailure||e instanceof TypeError)return json({error:'환자 정보를 저장하지 못했습니다. 다시 시도해 주세요.'},503);return json({error:e.message||'입력을 확인해 주세요.'},422);}
 };
}
