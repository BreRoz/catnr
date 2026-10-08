import { migrations as allMigrations } from './helpers/migrations.mjs';
import { loadRoute } from './helpers/assistant.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const migrations=allMigrations;
const env={};
const api=await loadRoute(env);
const cat=(id=null)=>({ref:id||'new',existingId:id,name:id?null:'Milo',sex:null,ageClass:null,appearance:null,distinguishingCharacteristics:null,healthObservations:null,reproductiveSignificance:null,origin:'Jefferson',currentStatus:'adopted',currentLocation:null,microchipNumber:null});
const plan=()=>({intent:'record',message:'Saved.',clarification:null,confidence:1,cats:[cat()],people:[{ref:'donor',existingId:null,name:'Sarah',type:'donor',generalLocation:null,contact:null}],events:[{catRef:'new',eventType:'adoption',occurredAt:null,location:null,personName:'Sarah',notes:'Adopted'}],transactions:[{transactionType:'cash_donation',direction:'inflow',date:null,amount:100,currency:'USD',personName:'Sarah',category:'donation',description:'Donation',item:null,quantity:null,unit:null,estimatedValue:null,relatedCatRef:'new'}],query:{kind:'none'},socialDraft:null});
const photo='data:image/jpeg;base64,/9j/2Q==';
const request=(body,method='POST',owner='A')=>new Request('https://rescue.test/api/assistant',{method,headers:{'x-catnr-user-id':owner,'x-catnr-user-email':`${owner}@test`},body:JSON.stringify(body)});
function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const sql of migrations)db.exec(sql);
 const state={fail:null,loseResponse:false,failReceipt:false,calls:0,plan:plan(),beforeAI:null,beforeBatch:null};
 let batchTail=Promise.resolve();env.DB={prepare(query){let values=[];return{bind(...v){values=v.map(x=>x===undefined?null:x);return this},async first(){if(state.failReceipt&&query.includes("FROM write_requests"))throw new Error("Receipt unavailable");return db.prepare(query).get(...values)||null},async all(){return {results:db.prepare(query).all(...values)}},async run(){if(state.fail?.(query))throw new Error('Injected database failure');const r=db.prepare(query).run(...values);return {...r,meta:{changes:Number(r.changes)}}}}},async batch(statements){const previous=batchTail;let release;batchTail=new Promise(r=>release=r);await previous;try{if(state.beforeBatch){const action=state.beforeBatch;state.beforeBatch=null;await action()}db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');if(state.loseResponse){state.loseResponse=false;if(state.failReceiptAfterCommit)state.failReceipt=true;throw new Error('Lost response after commit')}return result}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e}}finally{release()}}};
 env.OPENROUTER_API_KEY='test';
 globalThis.fetch=async()=>{state.calls++;if(state.beforeAI)await state.beforeAI();return Response.json({choices:[{message:{content:JSON.stringify(state.plan)}}]})};
 env.PHOTOS={async put(){throw new Error('New uploads must not use nontransactional storage')},async get(){throw new Error('Unexpected bucket read')}};
 const counts=()=>Object.fromEntries(['cats','people','colonies','events','transactions','photos','ai_inputs','write_requests','write_guards'].map(t=>[t,db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
 return {db,state,counts};
}

const T0='2026-01-01T00:00:00.000Z';
const base=()=>({intent:'record',message:'Saved.',clarification:null,confidence:1,cats:[],events:[],people:[],transactions:[],query:{kind:'none'},socialDraft:null});
const catDraft=(id,status=null)=>({...cat(id),ref:id,currentStatus:status,origin:null});
const eventPlan=(type,{status,cats,catRef='milo',occurredAt=null}={})=>({...base(),cats:cats||(status?[catDraft('milo',status)]:[]),events:[{catRef,eventType:type,occurredAt,location:null,personName:null,notes:`corrected to ${type}`}]});
const moneyPlan=amount=>({...base(),transactions:[{transactionType:'cash_donation',direction:'inflow',date:null,amount,currency:'USD',personName:null,category:'donation',description:'Donation',item:null,quantity:null,unit:null,estimatedValue:null,relatedCatRef:null}]});
function seed(db,status='adopted'){
 db.exec(`INSERT INTO cats(id,owner_id,name,current_status,created_at,updated_at) VALUES('milo','A','Milo','${status}','${T0}','${T0}');
 INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,notes,created_at) VALUES('e1','A','milo','adoption','${T0}','Adopted by Sam','${T0}');
 INSERT INTO photos(id,owner_id,cat_id,event_id,storage_location,taken_at) VALUES('p1','A','milo','e1','${photo}','${T0}');
 INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount_minor,description,related_event_id,related_cat_id,created_at) VALUES('t1','A','cash_donation','inflow','${T0}',10000,'Adoption fee','e1','milo','${T0}')`);
}
const ver=(db,table,id)=>db.prepare(`SELECT version FROM ${table} WHERE id=?`).get(id).version;
const correct=(db,id,key,extra={})=>api.PATCH(request({id,recordType:'event',version:ver(db,'events',id),correction:`fix ${key}`,requestKey:key,...extra},'PATCH'));
const undo=(correctionId,key,owner='A')=>api.DELETE(request({correctionId,requestKey:key},'DELETE',owner));
const get=(query,owner='A')=>api.GET(new Request(`https://rescue.test/api/assistant${query}`,{headers:{'x-catnr-user-id':owner,'x-catnr-user-email':`${owner}@test`}}));
const status=db=>db.prepare("SELECT current_status s FROM cats WHERE id='milo'").get().s;
const activeEvents=db=>JSON.parse(JSON.stringify(db.prepare('SELECT id,event_type FROM active_events ORDER BY id').all()));
const snapshotAll=db=>JSON.stringify(['cats','events','transactions','photos','corrections','ai_inputs'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));

test('correction supersedes instead of deleting and keeps who/when/why/source',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});
 const before=db.prepare("SELECT * FROM events WHERE id='e1'").get();
 const r=await correct(db,'e1','c1');assert.equal(r.status,200);const out=await r.json();assert.equal(out.outcome,'committed');assert.ok(out.correctionId);
 assert.equal(db.prepare('SELECT count(*) n FROM events').get().n,2);
 const original=db.prepare("SELECT * FROM events WHERE id='e1'").get();assert.ok(original.superseded_at);assert.equal(original.superseded_by,out.correctionId);assert.equal(original.event_type,'adoption');assert.equal(original.notes,before.notes);
 const rows=activeEvents(db);assert.equal(rows.length,1);assert.equal(rows[0].event_type,'foster');
 const c=db.prepare('SELECT * FROM corrections').get();assert.equal(c.kind,'correction');assert.equal(c.made_by,'assistant');assert.equal(c.actor_id,'A');assert.equal(c.reason,'fix c1');assert.ok(c.created_at);assert.equal(c.original_id,'e1');assert.equal(c.replacement_id,rows[0].id);
 assert.equal(JSON.parse(c.original_snapshot).notes,'Adopted by Sam');
 const input=db.prepare('SELECT * FROM ai_inputs WHERE id=?').get(c.source_input_id);assert.equal(input.input_type,'correction');assert.equal(input.transcription,'fix c1');assert.ok(JSON.parse(input.interpretation).events.length);
 assert.ok(JSON.parse(input.records_updated).includes('superseded:event:e1'));
 db.close();
});

test('correcting a cat event repairs status derived from it, and undo restores it',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('vet_visit');
 const out=await (await correct(db,'e1','c1')).json();
 assert.equal(status(db),'observed');
 const c=JSON.parse(db.prepare('SELECT cat_changes FROM corrections').get().cat_changes);assert.deepEqual(c[0].changes,[{field:'current_status',from:'adopted',to:'observed'}]);
 const u=await undo(out.correctionId,'u1');assert.equal(u.status,200);assert.equal((await u.json()).outcome,'undone');
 assert.equal(status(db),'adopted');assert.deepEqual(activeEvents(db),[{id:'e1',event_type:'adoption'}]);
 db.close();
});

test('explicit status in a correction is applied and is undone to the previous value',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});
 const out=await (await correct(db,'e1','c1')).json();assert.equal(status(db),'foster');
 assert.equal((await undo(out.correctionId,'u1')).status,200);assert.equal(status(db),'adopted');
 db.close();
});

test('a newer status from a later event is not overwritten by correcting an older event',async()=>{
 const {db,state}=setup();seed(db,'foster');db.exec(`INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('e2','A','milo','foster','2026-03-01T00:00:00.000Z','2026-03-01T00:00:00.000Z')`);
 state.plan=eventPlan('vet_visit');assert.equal((await correct(db,'e1','c1')).status,200);assert.equal(status(db),'foster');
 db.close();
});

test('photos and linked money follow the corrected event; undo returns them; new photo attaches to the replacement',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});
 const out=await (await correct(db,'e1','c1',{photoDataUrl:photo})).json();assert.equal(out.photoSaved,true);
 const repl=db.prepare('SELECT replacement_id r FROM corrections').get().r;
 assert.equal(db.prepare("SELECT event_id FROM photos WHERE id='p1'").get().event_id,repl);assert.equal(db.prepare("SELECT related_event_id FROM transactions WHERE id='t1'").get().related_event_id,repl);
 const added=db.prepare("SELECT * FROM photos WHERE id<>'p1'").get();assert.equal(added.event_id,repl);assert.equal(added.cat_id,'milo');
 assert.deepEqual(JSON.parse(db.prepare('SELECT relinked FROM corrections').get().relinked),{photos:['p1'],transactions:['t1']});
 assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n,2);
 assert.equal((await undo(out.correctionId,'u1')).status,200);
 assert.equal(db.prepare("SELECT event_id FROM photos WHERE id='p1'").get().event_id,'e1');assert.equal(db.prepare("SELECT related_event_id FROM transactions WHERE id='t1'").get().related_event_id,'e1');
 assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n,2);
 // The photo's image is still served after correction and undo.
 assert.equal((await get('?photoId=p1')).status,200);
 db.close();
});

test('correction followed by correction keeps a chain; undo must unwind newest first',async()=>{
 const {db,state}=setup();seed(db);
 state.plan=eventPlan('foster',{status:'foster'});const one=await (await correct(db,'e1','c1')).json();const b=db.prepare('SELECT replacement_id r FROM corrections').get().r;
 state.plan=eventPlan('returned_to_colony',{status:'returned to colony'});const two=await (await correct(db,b,'c2')).json();const c=db.prepare('SELECT replacement_id r FROM corrections WHERE original_id=?').get(b).r;
 assert.equal(status(db),'returned to colony');assert.deepEqual(activeEvents(db).map(e=>e.id),[c]);
 const history=(await (await get(`?corrections=1&recordId=${c}`)).json()).corrections;assert.deepEqual(history.map(h=>[h.originalId,h.replacementId]),[['e1',b],[b,c]]);
 // The very first activity is still fully reconstructable.
 assert.equal(history[0].original.event_type,'adoption');assert.equal(history[0].original.notes,'Adopted by Sam');
 const tooEarly=await undo(one.correctionId,'u0');assert.equal(tooEarly.status,409);assert.match((await tooEarly.json()).message,/newer correction/);assert.equal(status(db),'returned to colony');
 assert.equal((await undo(two.correctionId,'u2')).status,200);assert.equal(status(db),'foster');assert.deepEqual(activeEvents(db).map(e=>e.id),[b]);
 assert.equal((await undo(one.correctionId,'u1')).status,200);assert.equal(status(db),'adopted');assert.deepEqual(activeEvents(db).map(e=>e.id),['e1']);
 assert.equal(db.prepare('SELECT count(*) n FROM events').get().n,3);
 const all=(await (await get('?corrections=1')).json()).corrections;assert.equal(all.length,4);assert.deepEqual(all.map(a=>a.kind),['correction','correction','undo','undo']);
 db.close();
});

test('undo is refused, and changes nothing, when it would contradict later records',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});const out=await (await correct(db,'e1','c1')).json();
 db.exec("UPDATE cats SET current_status='lost' WHERE id='milo'");const before=snapshotAll(db);
 const r=await undo(out.correctionId,'u1');assert.equal(r.status,409);assert.match((await r.json()).message,/inconsistent/);assert.equal(snapshotAll(db),before);
 db.close();
});

test('unrelated later cat changes do not block an undo and are preserved',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});const out=await (await correct(db,'e1','c1')).json();
 db.exec("UPDATE cats SET current_location='Porch' WHERE id='milo'");assert.equal((await undo(out.correctionId,'u1')).status,200);
 const c=db.prepare("SELECT * FROM cats WHERE id='milo'").get();assert.equal(c.current_status,'adopted');assert.equal(c.current_location,'Porch');
 db.close();
});

test('undo is idempotent for a retry and rejected for a second distinct request',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});const out=await (await correct(db,'e1','c1')).json();
 assert.equal((await undo(out.correctionId,'u1')).status,200);const afterFirst=snapshotAll(db);
 const replay=await undo(out.correctionId,'u1');assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);assert.equal(snapshotAll(db),afterFirst);
 const second=await undo(out.correctionId,'u2');assert.equal(second.status,409);assert.equal(snapshotAll(db),afterFirst);
 db.close();
});

test('reload after correction and after undo shows only the current activity with undo handle',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});const out=await (await correct(db,'e1','c1')).json();
 let data=await (await get('')).json();const events=data.memories.filter(m=>m.recordType==='event');assert.equal(events.length,1);assert.equal(events[0].kind,'foster');assert.equal(events[0].correctionId,out.correctionId);assert.equal(data.cats[0].status,'foster');assert.equal(data.cats[0].events,1);
 let cat=await (await get('?catId=milo')).json();assert.equal(cat.events.length,1);assert.equal(cat.events[0].event_type,'foster');assert.equal(cat.photos.length,1);
 await undo(out.correctionId,'u1');
 data=await (await get('')).json();const after=data.memories.filter(m=>m.recordType==='event');assert.equal(after.length,1);assert.equal(after[0].id,'e1');assert.equal(after[0].correctionId,null);assert.equal(data.cats[0].status,'adopted');
 cat=await (await get('?catId=milo')).json();assert.equal(cat.events[0].event_type,'adoption');
 db.close();
});

test('financial correction supersedes, changes totals, and undo restores them',async()=>{
 const {db,state}=setup();seed(db);state.plan=moneyPlan(50);
 const r=await api.PATCH(request({id:'t1',recordType:'transaction',version:ver(db,'transactions','t1'),correction:'it was $50',requestKey:'m1'},'PATCH'));assert.equal(r.status,200);const proposed=await r.json();
 assert.equal(proposed.outcome,'needs_confirmation');assert.equal(db.prepare("SELECT count(*) n FROM transactions").get().n,1);
 const confirmed=await api.POST(request({confirmProposalId:proposed.proposalId,requestKey:'m1c'}));assert.equal(confirmed.status,200);const out=await confirmed.json();assert.equal(out.outcome,'committed');
 assert.deepEqual((await (await get('')).json()).stats.cashIn,[{currency:'USD',minor:5000}]);assert.equal(db.prepare("SELECT amount_minor FROM transactions WHERE id='t1'").get().amount_minor,10000);assert.equal(db.prepare('SELECT count(*) n FROM active_transactions').get().n,1);
 assert.equal(db.prepare("SELECT date FROM active_transactions").get().date,T0);
 assert.equal((await undo(out.correctionId,'um')).status,200);assert.deepEqual((await (await get('')).json()).stats.cashIn,[{currency:'USD',minor:10000}]);
 db.close();
});

test('failure at any correction/undo statement leaves everything exactly as it was',async()=>{
 for(const fragment of ['INSERT INTO events','UPDATE photos','UPDATE transactions','UPDATE events SET superseded_at','INSERT INTO corrections','UPDATE cats','UPDATE ai_inputs']){
  const {db,state}=setup();seed(db);state.plan=eventPlan('vet_visit');const before=snapshotAll(db);state.fail=q=>q.startsWith(fragment);
  assert.equal((await correct(db,'e1','c1')).status,503,fragment);assert.equal(snapshotAll(db),before,fragment);db.close();
 }
 for(const fragment of ['UPDATE cats','UPDATE photos','UPDATE events SET superseded_at=NULL','UPDATE events SET superseded_at=?','INSERT INTO corrections','UPDATE corrections']){
  const {db,state}=setup();seed(db);state.plan=eventPlan('vet_visit');const out=await (await correct(db,'e1','c1')).json();const before=snapshotAll(db);state.fail=q=>q.startsWith(fragment);
  assert.equal((await undo(out.correctionId,'u1')).status,503,fragment);assert.equal(snapshotAll(db),before,fragment);db.close();
 }
});

test('unsafe replacement plans are rejected before anything is written',async()=>{
 const bad={
  'two events':{...eventPlan('foster'),events:[eventPlan('foster').events[0],eventPlan('lost').events[0]]},
  'extra transaction':{...eventPlan('foster'),transactions:moneyPlan(5).transactions},
  'new cat':{...eventPlan('foster'),cats:[{...cat(),ref:'brand-new'}]},
  'other cat updated':{...eventPlan('foster'),cats:[catDraft('stranger','lost')]},
  'colony change':{...eventPlan('foster'),cats:[{...catDraft('milo','foster'),origin:'Elsewhere'}]},
  'detached from cat':{...eventPlan('foster'),events:[{...eventPlan('foster').events[0],catRef:null}]},
  'clarify':{...eventPlan('foster'),intent:'clarify',clarification:'Which cat?'},
  'query':{...eventPlan('foster'),intent:'query'},
 };
 for(const [name,plan] of Object.entries(bad)){
  const {db,state}=setup();seed(db);db.exec("INSERT INTO cats(id,owner_id,name,current_status,created_at,updated_at) VALUES('stranger','A','Other','observed','t','t')");state.plan=plan;const before=snapshotAll(db);
  const r=await correct(db,'e1','c1');assert.ok([409,422].includes(r.status),name);assert.equal(snapshotAll(db),before,name);db.close();
 }
 const {db,state}=setup();seed(db);state.plan={...moneyPlan(5),cats:[catDraft('milo','lost')]};const before=snapshotAll(db);
 assert.equal((await api.PATCH(request({id:'t1',recordType:'transaction',version:0,correction:'x',requestKey:'k'},'PATCH'))).status,409);assert.equal(snapshotAll(db),before);db.close();
});

test('omitted date keeps the original occurrence time',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster');await correct(db,'e1','c1');
 assert.equal(db.prepare('SELECT occurred_at o FROM active_events').get().o,T0);db.close();
});

test('an already-corrected activity cannot be corrected twice or from a stale view',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster');const staleVersion=ver(db,'events','e1');await correct(db,'e1','c1');
 const r=await api.PATCH(request({id:'e1',recordType:'event',version:staleVersion,correction:'again',requestKey:'c2'},'PATCH'));assert.equal(r.status,409);assert.equal(db.prepare('SELECT count(*) n FROM corrections').get().n,1);
 const r2=await api.PATCH(request({id:'e1',recordType:'event',version:ver(db,'events','e1'),correction:'again',requestKey:'c3'},'PATCH'));assert.equal(r2.status,409);assert.match((await r2.json()).message,/already corrected/);
 db.close();
});

test('database refuses to delete or rewrite corrected history',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});const out=await (await correct(db,'e1','c1')).json();const repl=db.prepare('SELECT replacement_id r FROM corrections').get().r;
 assert.throws(()=>db.exec("DELETE FROM events WHERE id='e1'"),/preserved/);assert.throws(()=>db.exec(`DELETE FROM events WHERE id='${repl}'`),/preserved/);
 assert.throws(()=>db.exec("UPDATE events SET notes='rewritten' WHERE id='e1'"),/frozen/);
 assert.throws(()=>db.exec('DELETE FROM corrections'),/immutable/);assert.throws(()=>db.exec("UPDATE corrections SET reason='x'"),/immutable/);assert.throws(()=>db.exec("UPDATE corrections SET original_snapshot='{}'"),/immutable/);
 await undo(out.correctionId,'u1');assert.throws(()=>db.exec("UPDATE corrections SET status='applied' WHERE id='"+out.correctionId+"'"),/immutable/);
 db.close();
});

test('corrections cannot cross owners and each owner only reads their own history',async()=>{
 const {db,state}=setup();seed(db);state.plan=eventPlan('foster',{status:'foster'});const out=await (await correct(db,'e1','c1')).json();const before=snapshotAll(db);
 assert.equal((await undo(out.correctionId,'x','B')).status,404);assert.equal(snapshotAll(db),before);
 assert.deepEqual((await (await get('?corrections=1','B')).json()).corrections,[]);
 const r=await api.PATCH(request({id:'e1',recordType:'event',version:0,correction:'steal',requestKey:'b1'},'PATCH','B'));assert.equal(r.status,404);
 assert.equal((await api.DELETE(new Request('https://rescue.test/api/assistant',{method:'DELETE',body:'{}'}))).status,401);
 db.close();
});
