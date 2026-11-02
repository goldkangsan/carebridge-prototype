import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.mjs';
import transition from '../api/transition.mjs';
import M from '../web/model.js';
test('Vercel health entry point preserves HTTP contract',async()=>{const r=await health.fetch(new Request('https://demo.test/api/health'));assert.equal(r.status,200);assert.equal((await r.json()).version,2);});
test('Vercel transition entry point supports JSON POST',async()=>{const r=await transition.fetch(new Request('https://demo.test/api/transition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:M.initial(),action:{type:'attest',value:true},actor:'hospital'})}));assert.equal(r.status,200);assert.equal((await r.json()).state.doctorApproved,true);});
