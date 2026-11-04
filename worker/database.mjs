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
  async create(id,state,grants,patient=null){
   await query(`WITH created AS (INSERT INTO cb_cases(id,state,register_id,patient_id) VALUES($1,$2::jsonb,$4,$5) RETURNING id)
    INSERT INTO cb_access(case_id,token_hash,role,facility)
    SELECT created.id,g->>'hash',g->>'role',g->>'facility' FROM created,jsonb_array_elements($3::jsonb) g`,[id,JSON.stringify(state),JSON.stringify(grants),patient?.register_id||null,patient?.id||null]);
   return {id,state,revision:0};
  },
  async read(id,hash){
   const rows=await query(`SELECT c.id,c.state,c.revision,c.updated_at,a.role,a.facility FROM cb_cases c
    JOIN cb_access a ON a.case_id=c.id WHERE c.id=$1 AND a.token_hash=$2`,[id,hash]);const row=rows[0];if(row){const profiles=await query('SELECT facility,body,updated_at FROM cb_facility_profiles WHERE scope_id=COALESCE((SELECT register_id FROM cb_cases WHERE id=$1),$1)',[id]);row.profileRevision=profiles.map(p=>p.facility+':'+new Date(p.updated_at).toISOString()).sort().join('|');if(row.state.stage<4)row.state.facilityUpdates={...row.state.facilityUpdates,...Object.fromEntries(profiles.map(p=>[p.facility,{...p.body,fresh:Date.now()-new Date(p.updated_at).getTime()<86400000,updated:new Date(p.updated_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}]))};}return row||null;
  },
  async replay(id,requestId){return (await query('SELECT revision FROM cb_requests WHERE case_id=$1 AND request_id=$2',[id,requestId]))[0]||null;},
  async commit(row,next,requestId,profileUpdate=null){
   const added=next.events.slice(0,Math.max(0,next.events.length-row.state.events.length));
   const inquiries=next.inquiries.map(f=>({facility:f,status:next.responses[f]?.status||'pending',response:next.responses[f]||null}));
   const rows=await query(`WITH changed AS (
    UPDATE cb_cases SET state=$3::jsonb,revision=revision+1,updated_at=now(),
    register_id=COALESCE(($3::jsonb->'patientRecord'->>'registerId')::uuid,register_id),
    patient_id=COALESCE(($3::jsonb->'patientRecord'->>'id')::uuid,patient_id)
    WHERE id=$1 AND revision=$2 RETURNING id,state,revision,updated_at
   ), profile_update AS (
    INSERT INTO cb_facility_profiles(scope_id,facility,body)
    SELECT COALESCE((SELECT register_id FROM cb_cases WHERE id=c.id),c.id),$8,$9::jsonb FROM changed c WHERE $8::text IS NOT NULL
    ON CONFLICT(scope_id,facility) DO UPDATE SET body=EXCLUDED.body,updated_at=now()
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
   ) SELECT * FROM changed`,[row.id,row.revision,JSON.stringify(next),JSON.stringify(added),JSON.stringify(inquiries),JSON.stringify(row.state),requestId,profileUpdate?.id||null,JSON.stringify(profileUpdate?.body||{})]);
   return rows[0]||null;
  },
  async claim(id,lease){return !!(await query(`UPDATE cb_cases SET lease_id=$2,lease_until=now()+interval '45 seconds'
   WHERE id=$1 AND (lease_until IS NULL OR lease_until<now()) RETURNING id`,[id,lease])).length;},
  async release(id,lease){await query('UPDATE cb_cases SET lease_id=NULL,lease_until=NULL WHERE id=$1 AND lease_id=$2',[id,lease]);}
  ,async createRegister(id,hash,patients){
   await query(`WITH created AS (INSERT INTO cb_patient_registers(id,access_hash) VALUES($1,$2) RETURNING id)
    INSERT INTO cb_patients(id,register_id,number,name,age_group,contact)
    SELECT (p->>'id')::uuid,c.id,p->>'number',p->>'name',p->>'age',p->>'contact'
    FROM created c,jsonb_array_elements($3::jsonb) p`,[id,hash,JSON.stringify(patients)]);
  },
  async registerAccess(id,hash){return !!(await query('SELECT id FROM cb_patient_registers WHERE id=$1 AND access_hash=$2',[id,hash])).length;},
  async searchPatients(registerId,q){return query(`SELECT p.id,p.number,p.name,p.age_group AS age,p.contact,p.updated_at,
    (SELECT count(*)::int FROM cb_cases c WHERE c.register_id=p.register_id AND c.patient_id=p.id) AS case_count
    FROM cb_patients p WHERE p.register_id=$1 AND $2<>'' AND (position(lower($2) in lower(p.name))>0 OR position(lower($2) in lower(p.number))>0)
    ORDER BY p.updated_at DESC,p.number LIMIT 30`,[registerId,q]);},
  async readPatient(registerId,id){return (await query('SELECT id,register_id,number,name,age_group AS age,contact,updated_at FROM cb_patients WHERE register_id=$1 AND id=$2',[registerId,id]))[0]||null;},
  async insertPatient(registerId,p){return (await query(`INSERT INTO cb_patients(id,register_id,number,name,age_group,contact)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(register_id,number) DO NOTHING RETURNING id,number,name,age_group AS age,contact,updated_at`,[p.id,registerId,p.number,p.name,p.age,p.contact]))[0]||null;},
  async registerTasks(registerId){return query(`SELECT c.id,c.patient_id,p.name,p.number,c.state->>'caseId' AS case_number,(c.state->>'stage')::int AS stage,c.state->>'selected' AS selected,c.state->'visit'->>'result' AS visit_result,(c.state->>'consent')::boolean AS consent,c.state->'responses' AS responses,c.state->'inquiries' AS inquiries,c.state->>'stageSince' AS stage_since,c.updated_at FROM cb_cases c JOIN cb_patients p ON p.id=c.patient_id WHERE c.register_id=$1 ORDER BY c.updated_at DESC LIMIT 50`,[registerId]);},
  async reopenPatientCase(id,registerId,patientId,grants){const rows=await query(`WITH allowed AS (SELECT id FROM cb_cases WHERE id=$1 AND register_id=$2 AND patient_id=$3), added AS (INSERT INTO cb_access(case_id,token_hash,role,facility) SELECT a.id,g->>'hash',g->>'role',g->>'facility' FROM allowed a,jsonb_array_elements($4::jsonb) g ON CONFLICT DO NOTHING) SELECT id FROM allowed`,[id,registerId,patientId,JSON.stringify(grants)]);return !!rows.length;},
  async patientHistory(registerId,id){return query(`SELECT id,state->>'caseId' AS case_number,(state->>'stage')::int AS stage,created_at
    FROM cb_cases WHERE register_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 10`,[registerId,id]);}
 };
}
