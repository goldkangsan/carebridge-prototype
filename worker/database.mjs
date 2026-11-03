import {neon} from '@neondatabase/serverless';
import {schema} from './schema.mjs';

let productionStore;
export function databaseConfigured(){return !!process.env.DATABASE_URL;}
export function getDatabase(){
 if(!databaseConfigured())throw Error('DB_NOT_CONFIGURED');
 if(!productionStore){const sql=neon(process.env.DATABASE_URL);productionStore=createStore({query:(q,p=[])=>sql.query(q,p),batch:qs=>sql.transaction(qs.map(q=>sql.query(q,[])))});}
 return productionStore;
}
export function createStore(driver){
 let ready;
 const init=()=>ready||(ready=driver.batch(schema).catch(e=>{ready=null;throw e;}));
 const query=async(q,p=[])=>{try{await init();return await driver.query(q,p);}catch{const e=Error('STORAGE_UNAVAILABLE');e.storageFailure=true;throw e;}};
 return {
  init,
  async create(id,state,grants){
   await query(`WITH created AS (INSERT INTO cb_cases(id,state) VALUES($1,$2::jsonb) RETURNING id)
    INSERT INTO cb_access(case_id,token_hash,role,facility)
    SELECT created.id,g->>'hash',g->>'role',g->>'facility' FROM created,jsonb_array_elements($3::jsonb) g`,[id,JSON.stringify(state),JSON.stringify(grants)]);
   return {id,state,revision:0};
  },
  async read(id,hash){
   const rows=await query(`SELECT c.id,c.state,c.revision,c.updated_at,a.role,a.facility FROM cb_cases c
    JOIN cb_access a ON a.case_id=c.id WHERE c.id=$1 AND a.token_hash=$2`,[id,hash]);return rows[0]||null;
  },
  async replay(id,requestId){return (await query('SELECT revision FROM cb_requests WHERE case_id=$1 AND request_id=$2',[id,requestId]))[0]||null;},
  async commit(row,next,requestId){
   const added=next.events.slice(0,Math.max(0,next.events.length-row.state.events.length));
   const inquiries=next.inquiries.map(f=>({facility:f,status:next.responses[f]?.status||'pending',response:next.responses[f]||null}));
   const rows=await query(`WITH changed AS (
    UPDATE cb_cases SET state=$3::jsonb,revision=revision+1,updated_at=now()
    WHERE id=$1 AND revision=$2 RETURNING id,state,revision,updated_at
   ), events AS (
    INSERT INTO cb_events(case_id,revision,event_index,body)
    SELECT c.id,c.revision,(e.ordinality-1)::int,e.value FROM changed c,jsonb_array_elements($4::jsonb) WITH ORDINALITY e
   ), inquiries AS (
    INSERT INTO cb_inquiries(case_id,round,facility,status,response)
    SELECT c.id,($3::jsonb->>'round')::int,i->>'facility',i->>'status',i->'response'
    FROM changed c,jsonb_array_elements($5::jsonb) i
    ON CONFLICT(case_id,round,facility) DO UPDATE SET status=EXCLUDED.status,response=EXCLUDED.response,updated_at=now()
   ), consents AS (
    INSERT INTO cb_consents(case_id,revision,kind,granted,facility)
    SELECT c.id,c.revision,v.kind,v.granted,v.facility FROM changed c,
    (VALUES('inquiry',($3::jsonb->>'consent')::boolean,NULL::text),
    ('selected-facility',($3::jsonb->>'shareConsent')::boolean,$3::jsonb->>'selected')) v(kind,granted,facility)
    WHERE (($6::jsonb->>CASE WHEN v.kind='inquiry' THEN 'consent' ELSE 'shareConsent' END)::boolean IS DISTINCT FROM v.granted)
   ), request AS (
    INSERT INTO cb_requests(case_id,request_id,revision) SELECT id,$7,revision FROM changed
   ) SELECT * FROM changed`,[row.id,row.revision,JSON.stringify(next),JSON.stringify(added),JSON.stringify(inquiries),JSON.stringify(row.state),requestId]);
   return rows[0]||null;
  },
  async claim(id,lease){return !!(await query(`UPDATE cb_cases SET lease_id=$2,lease_until=now()+interval '45 seconds'
   WHERE id=$1 AND (lease_until IS NULL OR lease_until<now()) RETURNING id`,[id,lease])).length;},
  async release(id,lease){await query('UPDATE cb_cases SET lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2',[id,lease]);}
 };
}
