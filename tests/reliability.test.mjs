import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const migrations=await Promise.all(['0000_salty_cannonball','0001_slippery_spot','0002_secure_ownership','0003_reliable_recording','0004_versioned_corrections','0005_validated_proposals','0006_pending_clarifications'].map(n=>readFile(new URL(`../drizzle/${n}.sql`,import.meta.url),'utf8')));
const source=await readFile(new URL('../app/api/assistant/route.ts',import.meta.url),'utf8');
const helperSource=await readFile(new URL('../app/api/assistant/reliability.ts',import.meta.url),'utf8');
const correctionSource=await readFile(new URL('../app/api/assistant/corrections.ts',import.meta.url),'utf8');
const correctionJS=ts.transpileModule(correctionSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const correctionURL=`data:text/javascript;base64,${Buffer.from(correctionJS).toString('base64')}`;
const helperJS=ts.transpileModule(helperSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const helperURL=`data:text/javascript;base64,${Buffer.from(helperJS).toString('base64')}`;
const validationSource=await readFile(new URL('../app/api/assistant/validation.ts',import.meta.url),'utf8');
const validationURL=`data:text/javascript;base64,${Buffer.from(ts.transpileModule(validationSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`;
const clarificationsURL=`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL('../app/api/assistant/clarifications.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`;
const js=ts.transpileModule(source.replace('from "./validation"',`from "${validationURL}"`).replace('from "./reliability"',`from "${helperURL}"`).replace('from "./corrections"',`from "${correctionURL}"`).replace('from "./clarifications"',`from "${clarificationsURL}"`).replace('import { env } from "cloudflare:workers";','const env=globalThis.__reliabilityEnv;'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const env={};globalThis.__reliabilityEnv=env;
const api=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const cat=(id=null)=>({ref:id||'new',existingId:id,name:id?null:'Milo',sex:null,ageClass:null,appearance:null,distinguishingCharacteristics:null,healthObservations:null,reproductiveSignificance:null,origin:'Jefferson',currentStatus:'foster',currentLocation:null,microchipNumber:null});
const plan=()=>({intent:'record',message:'Saved.',clarification:null,confidence:1,cats:[cat()],people:[{ref:'donor',existingId:null,name:'Sarah',type:'donor',generalLocation:null,contact:null}],events:[{catRef:'new',eventType:'foster',occurredAt:null,location:null,personName:'Sarah',notes:'Fostered'}],transactions:[{transactionType:'cash_donation',direction:'inflow',date:null,amount:100,currency:'USD',personName:'Sarah',category:'donation',description:'Donation',item:null,quantity:null,unit:null,estimatedValue:null,relatedCatRef:'new'}],query:{kind:'none'},socialDraft:null});
const photo='data:image/jpeg;base64,/9j/2Q==';
const request=(body,method='POST',owner='A')=>new Request('https://rescue.test/api/assistant',{method,headers:{'x-catnr-user-id':owner,'x-catnr-user-email':`${owner}@test`},body:JSON.stringify(body)});
function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const sql of migrations)db.exec(sql);
 const state={fail:null,loseResponse:false,failReceipt:false,calls:0,plan:plan(),beforeAI:null,beforeBatch:null};
 let batchTail=Promise.resolve();env.DB={prepare(query){let values=[];return{bind(...v){values=v.map(x=>x===undefined?null:x);return this},async first(){if(state.failReceipt&&query.includes("FROM write_requests"))throw new Error("Receipt unavailable");return db.prepare(query).get(...values)||null},async all(){return {results:db.prepare(query).all(...values)}},async run(){if(state.fail?.(query))throw new Error('Injected database failure');return db.prepare(query).run(...values)}}},async batch(statements){const previous=batchTail;let release;batchTail=new Promise(r=>release=r);await previous;try{if(state.beforeBatch){const action=state.beforeBatch;state.beforeBatch=null;await action()}db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');if(state.loseResponse){state.loseResponse=false;if(state.failReceiptAfterCommit)state.failReceipt=true;throw new Error('Lost response after commit')}return result}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e}}finally{release()}}};
 env.OPENROUTER_API_KEY='test';
 globalThis.fetch=async()=>{state.calls++;if(state.beforeAI)await state.beforeAI();return Response.json({choices:[{message:{content:JSON.stringify(state.plan)}}]})};
 env.PHOTOS={async put(){throw new Error('New uploads must not use nontransactional storage')},async get(){throw new Error('Unexpected bucket read')}};
 const counts=()=>Object.fromEntries(['cats','people','colonies','events','transactions','photos','ai_inputs','write_requests','write_guards'].map(t=>[t,db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
 return {db,state,counts};
}

test('complete cat + adoption + person + finance + photo success commits audit and receipt together',async()=>{
 const {db,state,counts}=setup();const r=await api.POST(request({input:'Milo adopted; Sarah donated $100',photoDataUrl:photo,requestKey:'success'}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.outcome,'committed');assert.equal(data.photoSaved,true);
 assert.deepEqual(counts(),{cats:1,people:1,colonies:1,events:1,transactions:1,photos:1,ai_inputs:1,write_requests:1,write_guards:0});assert.equal(db.prepare('SELECT current_status FROM cats').get().current_status,'foster');assert.equal(state.calls,1);
 const p=db.prepare('SELECT * FROM photos').get();assert.ok(p.cat_id&&p.event_id);assert.equal(p.storage_location,photo);const audit=db.prepare('SELECT * FROM ai_inputs').get();assert.ok(JSON.parse(audit.records_created).includes(`photo:${p.id}`));
 const image=await api.GET(new Request(`https://rescue.test/api/assistant?photoId=${p.id}`,{headers:{'x-catnr-user-id':'A','x-catnr-user-email':'a@test'}}));assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),Uint8Array.from([255,216,255,217]));
 db.close();
});
test('database failure at every batch statement restores the previous database',async()=>{
 for(const fragment of ['INSERT INTO write_requests','INSERT INTO write_guards','INSERT INTO ai_inputs','INSERT INTO colonies','INSERT INTO people','INSERT INTO cats','INSERT INTO events','INSERT INTO transactions','INSERT INTO photos','UPDATE ai_inputs','DELETE FROM write_guards']){
  const {db,state,counts}=setup();const before=counts();state.fail=q=>q.startsWith(fragment);const r=await api.POST(request({input:'record',photoDataUrl:photo,requestKey:'failed'}));assert.equal(r.status,503,fragment);assert.deepEqual(counts(),before,fragment);assert.equal(db.prepare('SELECT count(*) n FROM rescue_revisions').get().n,0);state.fail=null;assert.equal((await api.POST(request({input:'record',photoDataUrl:photo,requestKey:'failed'}))).status,200);db.close();
 }
});
test('bad photos and photo processing/provider failures leave no records or files',async()=>{
 const {db,state,counts}=setup();const before=counts();
 for(const value of ['data:image/jpeg;base64,aGVsbG8=','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,%%%','x'.repeat(1800001)])assert.equal((await api.POST(request({input:'record',photoDataUrl:value}))).status,400);
 assert.equal(state.calls,0);assert.deepEqual(counts(),before);
 globalThis.fetch=async()=>{throw new Error('Image processing failed')};assert.equal((await api.POST(request({input:'record',photoDataUrl:photo}))).status,503);assert.deepEqual(counts(),before);db.close();
});
test('identical retries and lost network response replay without rerunning AI or duplicating records',async()=>{
 const {db,state,counts}=setup();state.loseResponse=true;const body={input:'record',photoDataUrl:photo,requestKey:'network'};const first=await api.POST(request(body));assert.equal(first.status,200);assert.equal((await first.json()).replayed,true);const after=counts();
 for(let i=0;i<3;i++){const r=await api.POST(request(body));assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);assert.deepEqual(counts(),after)}assert.equal(state.calls,1);
 assert.equal((await api.POST(request({...body,input:'different'}))).status,409);assert.deepEqual(counts(),after);
 assert.equal((await api.POST(request(body,'POST','B'))).status,200);assert.equal(db.prepare('SELECT count(*) n FROM cats').get().n,2);db.close();
});
test('legacy requests without explicit keys also deduplicate identical payloads',async()=>{
 const {db,counts}=setup();assert.equal((await api.POST(request({input:'same'}))).status,200);const after=counts();assert.equal((await api.POST(request({input:'same'}))).status,200);assert.deepEqual(counts(),after);db.close();
});
test('simultaneous identical requests commit exactly once',async()=>{
 const {db,state,counts}=setup();let arrivals=0,release;const gate=new Promise(r=>release=r);state.beforeAI=async()=>{if(++arrivals===2)release();await gate};
 const body={input:'same',photoDataUrl:photo,requestKey:'same'};const results=await Promise.all([api.POST(request(body)),api.POST(request(body))]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(counts().cats,1);assert.equal(counts().events,1);assert.equal(counts().transactions,1);assert.equal(counts().photos,1);assert.equal(counts().write_requests,1);db.close();
});
test('simultaneous distinct adoption edits reject stale plan instead of overwriting',async()=>{
 const {db,state}=setup();db.exec("INSERT INTO cats(id,owner_id,name,current_status,created_at,updated_at) VALUES('milo','A','Milo','observed','now','now')");state.plan=plan();state.plan.cats=[cat('milo')];state.plan.events[0].catRef='milo';state.plan.transactions[0].relatedCatRef='milo';let arrivals=0,release;const gate=new Promise(r=>release=r);state.beforeAI=async()=>{if(++arrivals===2)release();await gate};
 const results=await Promise.all([api.POST(request({input:'adopt',requestKey:'one'})),api.POST(request({input:'adopt',requestKey:'two'}))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(db.prepare('SELECT count(*) n FROM events').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM transactions').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM ai_inputs').get().n,1);db.close();
});
test('late invalid AI operation and foreign relationship leave all records unchanged',async()=>{
 const {db,state,counts}=setup();const before=counts();state.plan.transactions[0].amount=-5;assert.equal((await api.POST(request({input:'bad'}))).status,422);assert.deepEqual(counts(),before);
 state.plan=plan();state.plan.transactions[0].relatedCatRef='unknown';assert.equal((await api.POST(request({input:'bad ref'}))).status,422);assert.deepEqual(counts(),before);db.close();
});
test('stale UI correction version is rejected before interpreting or changing anything',async()=>{
 const {db,state,counts}=setup();await api.POST(request({input:'record'}));const e=db.prepare('SELECT * FROM events').get();db.prepare("UPDATE events SET notes='newer' WHERE id=?").run(e.id);const before=counts(),calls=state.calls;
 const r=await api.PATCH(request({id:e.id,recordType:'event',correction:'stale',version:e.version},'PATCH'));assert.equal(r.status,409);assert.deepEqual(counts(),before);assert.equal(state.calls,calls);assert.equal(db.prepare('SELECT notes FROM events').get().notes,'newer');db.close();
});
test('query/social/clarification plans cannot apply AI mutations or save a photo',async()=>{
 for(const intent of ['query','social','clarify']){const {db,state,counts}=setup();state.plan={...plan(),intent,cats:[],events:[],people:[],transactions:[],clarification:'Which cat?',socialDraft:'Draft',query:{kind:intent==='query'?'impact':'none'}};assert.equal((await api.POST(request({input:'read',photoDataUrl:photo,requestKey:intent}))).status,200);assert.equal(counts().cats,0);assert.equal(counts().events,0);assert.equal(counts().transactions,0);assert.equal(counts().photos,0);db.close()}
 const {db,counts}=setup();assert.equal((await api.POST(request({input:'question',mode:'ask'}))).status,422);assert.equal(counts().cats,0);db.close();
});

test('lost commit acknowledgement plus unavailable receipt reports unknown status and later recovers',async()=>{
 const {db,state,counts}=setup();state.loseResponse=true;state.failReceiptAfterCommit=true;
 const body={input:'record',requestKey:'unknown-status'};const r=await api.POST(request(body));assert.equal(r.status,503);const result=await r.json();assert.equal(result.outcome,'uncertain');assert.doesNotMatch(result.message,/Nothing.*changed/);assert.equal(counts().cats,1);
 state.failReceipt=false;assert.equal((await api.POST(request(body))).status,200);assert.equal(counts().cats,1);assert.equal(state.calls,1);db.close();
});
test('partial failure after changing an existing cat restores its previous status and revision',async()=>{
 const {db,state,counts}=setup();db.exec("INSERT INTO cats(id,owner_id,name,current_status,created_at,updated_at) VALUES('milo','A','Milo','observed','now','now')");state.plan.cats=[cat('milo')];state.plan.events[0].catRef='milo';state.plan.transactions[0].relatedCatRef='milo';
 const before=counts(),revision=db.prepare('SELECT version FROM rescue_revisions').get().version;state.fail=q=>q.startsWith('INSERT INTO transactions');
 assert.equal((await api.POST(request({input:'adopt'}))).status,503);assert.deepEqual(counts(),before);const c=db.prepare("SELECT * FROM cats WHERE id='milo'").get();assert.equal(c.current_status,'observed');assert.equal(c.version,0);assert.equal(db.prepare('SELECT version FROM rescue_revisions').get().version,revision);db.close();
});
