import { migrations as allMigrations } from './helpers/migrations.mjs';
import { linkMoney } from './helpers/money.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile=src=>ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const url=js=>`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
const read=n=>readFile(new URL(`../app/api/assistant/${n}.ts`,import.meta.url),'utf8');
const migrations=allMigrations;
const validationURL=url(compile(linkMoney(await read('validation'))));
const correctionURL=url(compile(await read('corrections')));
const helperURL=url(compile(await read('reliability')));
const clarURL=url(compile(await read('clarifications')));
const env={};globalThis.__clarEnv=env;
const api=await import(url(compile(linkMoney(await read('route')).replace('from "./validation"',`from "${validationURL}"`).replace('from "./reliability"',`from "${helperURL}"`).replace('from "./corrections"',`from "${correctionURL}"`).replace('from "./clarifications"',`from "${clarURL}"`).replace('import { env } from "cloudflare:workers";','const env=globalThis.__clarEnv;'))));

const T0='2026-01-01T00:00:00.000Z';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const query={kind:'none',catId:null,status:null,year:null,search:null};
const base=()=>({intent:'record',message:'Saved.',clarification:null,confidence:0.95,cats:[],events:[],people:[],transactions:[],query:{...query},socialDraft:null});
const catRef=id=>({ref:id,existingId:id,name:null,sex:null,ageClass:null,appearance:null,distinguishingCharacteristics:null,healthObservations:null,reproductiveSignificance:null,origin:null,currentStatus:null,currentLocation:null,microchipNumber:null});
const ev=(catRef,eventType,notes='x')=>({catRef,eventType,occurredAt:null,location:null,personName:null,notes});
// The model is unsure which black kitten Ari meant: low confidence on a risky event.
const unsurePlan=(eventType,ids=['ink','shade'],target=ids[0])=>({...base(),confidence:0.6,cats:ids.map(catRef),events:[ev(target,eventType)]});
const answerPlan=(eventType,id,extra={})=>({...base(),confidence:0.95,cats:[catRef(id)],events:[ev(id,eventType)],...extra});
const clarifyPlan=q=>({...base(),intent:'clarify',confidence:0.9,message:q,clarification:q});

const request=(body,method='POST',owner='A')=>new Request('https://rescue.test/api/assistant',{method,headers:{'x-catnr-user-id':owner,'x-catnr-user-email':`${owner}@test`},body:JSON.stringify(body)});
const get=(qs,owner='A')=>api.GET(new Request(`https://rescue.test/api/assistant?${qs}`,{headers:{'x-catnr-user-id':owner,'x-catnr-user-email':`${owner}@test`}}));
const RealDate=Date;
function travel(ms){globalThis.Date=class extends RealDate{constructor(...a){if(a.length)super(...a);else super(RealDate.now()+ms)}static now(){return RealDate.now()+ms}};return()=>{globalThis.Date=RealDate}}

function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const sql of migrations)db.exec(sql);
 db.exec(`INSERT INTO cats(id,owner_id,name,appearance,current_status,created_at,updated_at) VALUES
  ('ink','A',NULL,'thin black kitten from Jefferson','foster','${T0}','${T0}'),('shade','A',NULL,'chunky black kitten from Jefferson','foster','${T0}','${T0}'),
  ('milo','A','Milo',NULL,'foster','${T0}','${T0}'),('luna','A','Luna',NULL,'foster','${T0}','${T0}'),('bcat','B','Secret',NULL,'foster','${T0}','${T0}')`);
 const state={raw:base(),prompts:[]};
 env.DB={prepare(query){let values=[];return{bind(...x){values=x.map(y=>y===undefined?null:y);return this},async first(){return db.prepare(query).get(...values)||null},async all(){return{results:db.prepare(query).all(...values)}},async run(){const r=db.prepare(query).run(...values);return {...r,meta:{changes:Number(r.changes)}}}}},async batch(statements){db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT')}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e}}};
 env.OPENROUTER_API_KEY='test';
 globalThis.fetch=async(_u,init)=>{state.prompts.push(JSON.parse(init.body).messages[1].content[0].text);return Response.json({choices:[{message:{content:JSON.stringify(state.raw)}}]})};
 const records=()=>JSON.stringify(['cats','people','colonies','events','transactions','photos'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));
 const ask=async(raw,body,owner='A')=>{state.raw=raw;const r=await api.POST(request(body,'POST',owner));return{status:r.status,body:await r.json()}};
 const cell=(sql,...v)=>db.prepare(sql).get(...v);
 return{db,state,records,ask,cell};
}
const ORIGINAL='The black kitten got adopted.';

test('one pending clarification keeps the original update and resolves from a short answer',async()=>{
 const {db,state,records,ask,cell}=setup();const before=records();
 const first=await ask(unsurePlan('adoption'),{input:ORIGINAL,mode:'text',sessionId:'sess-1',requestKey:'k1'});
 assert.equal(first.body.outcome,'clarification');assert.ok(first.body.clarificationId);assert.equal(records(),before,'asking changes nothing');
 const row=cell('SELECT * FROM clarifications');
 assert.equal(row.owner_id,'A');assert.equal(row.status,'pending');assert.equal(row.original_text,ORIGINAL);assert.equal(row.session_id,'sess-1');assert.ok(row.question);assert.ok(row.expires_at>row.created_at);
 assert.deepEqual(JSON.parse(row.candidates).map(c=>c.id).sort(),['ink','shade']);assert.equal(JSON.parse(row.proposed_plan).events[0].eventType,'adoption');
 assert.equal(cell('SELECT transcription t FROM ai_inputs WHERE id=?',row.input_id).t,ORIGINAL);
 const listed=await (await get('clarifications=1')).json();assert.equal(listed.clarifications.length,1);assert.equal(listed.clarifications[0].originalText,ORIGINAL);assert.deepEqual(listed.clarifications[0].candidates.length,2);
 // Ari answers without repeating herself.
 const answered=await ask(answerPlan('adoption','ink',{cats:[{...catRef('ink'),currentStatus:'adopted'}]}),{clarificationId:row.id,input:'The thinner one.',requestKey:'a1'});
 assert.match(state.prompts.at(-1),new RegExp(ORIGINAL.replace('.','\\.')),'the interpreter sees the original update');assert.match(state.prompts.at(-1),/thinner one/);
 // Adoption is consequential, so it becomes a proposal for Ari's OK — still nothing applied.
 assert.equal(answered.body.outcome,'needs_confirmation');assert.equal(answered.body.answeredClarification,row.id);assert.equal(records(),before);
 assert.equal(cell('SELECT status FROM clarifications').status,'resolved');
 const ok=await ask(base(),{confirmProposalId:answered.body.proposalId,requestKey:'c1'});assert.equal(ok.body.outcome,'committed');
 assert.equal(cell("SELECT current_status s FROM cats WHERE id='ink'").s,'adopted');assert.equal(cell("SELECT current_status s FROM cats WHERE id='shade'").s,'foster');
 assert.equal(cell("SELECT source_input_id s FROM events WHERE event_type='adoption'").s,row.input_id,'the event links to Ari\'s original words');
 const trail=cell('SELECT * FROM clarification_answers');assert.equal(trail.answer,'The thinner one.');assert.equal(trail.outcome,'resolved');assert.equal(trail.question,row.question);
 assert.equal((await (await get('clarifications=1')).json()).clarifications.length,0);db.close();
});

test('a non-consequential answer applies the original update immediately and exactly once',async()=>{
 const {db,ask,cell}=setup();
 const first=await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',requestKey:'k1'});
 const done=await ask(answerPlan('neuter','shade'),{clarificationId:first.body.clarificationId,input:'the chunky one',requestKey:'a1'});
 assert.equal(done.body.outcome,'committed');assert.equal(cell("SELECT count(*) n FROM events WHERE event_type='neuter' AND cat_id='shade'").n,1);assert.equal(cell("SELECT count(*) n FROM events WHERE cat_id='ink'").n,0);
 // retrying the same request replays; answering again under a new key is refused and writes nothing
 assert.equal((await ask(answerPlan('neuter','shade'),{clarificationId:first.body.clarificationId,input:'the chunky one',requestKey:'a1'})).body.replayed,true);
 const again=await ask(answerPlan('neuter','ink'),{clarificationId:first.body.clarificationId,input:'actually the thin one',requestKey:'a2'});
 assert.equal(again.status,409);assert.equal(cell("SELECT count(*) n FROM events WHERE event_type='neuter'").n,1);db.close();
});

test('multiple pending clarifications stay separate and an answer only resolves the one it is addressed to',async()=>{
 const {db,records,ask,cell}=setup();
 const a=(await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',requestKey:'ka'})).body.clarificationId;
 const b=(await ask(unsurePlan('spay',['milo','luna'],'milo'),{input:'She got spayed.',requestKey:'kb'})).body.clarificationId;
 assert.ok(a&&b&&a!==b);assert.equal((await (await get('clarifications=1')).json()).clarifications.length,2);
 // Another owner cannot see, answer or cancel either one.
 assert.equal((await (await get('clarifications=1','B')).json()).clarifications.length,0);
 assert.equal((await ask(answerPlan('neuter','ink'),{clarificationId:a,input:'thin one',requestKey:'x'},'B')).status,404);
 assert.equal((await api.DELETE(request({cancelClarificationId:a},'DELETE','B'))).status,409);
 // Answer B only.
 const done=await ask(answerPlan('spay','luna'),{clarificationId:b,input:'Luna',requestKey:'ab'});assert.equal(done.body.outcome,'committed');
 assert.equal(cell('SELECT status FROM clarifications WHERE id=?',a).status,'pending');assert.equal(cell('SELECT status FROM clarifications WHERE id=?',b).status,'resolved');
 assert.equal(cell("SELECT count(*) n FROM events WHERE cat_id='luna' AND event_type='spay'").n,1);assert.equal(cell("SELECT count(*) n FROM events WHERE event_type='neuter'").n,0);
 // An answer with no clarification id is a fresh update, never guessed onto a pending question.
 const before=records();await ask(clarifyPlan('Which cat?'),{input:'the thin one',requestKey:'free'});
 assert.equal(records(),before);assert.equal(cell('SELECT status FROM clarifications WHERE id=?',a).status,'pending');assert.equal(cell('SELECT count(*) n FROM clarification_answers WHERE clarification_id=?',a).n,0);
 // An answer cannot be redirected at a cat the question was not about.
 const wrong=await ask(answerPlan('neuter','milo'),{clarificationId:a,input:'Milo',requestKey:'wrong'});
 assert.equal(wrong.body.outcome,'clarification');assert.equal(cell("SELECT count(*) n FROM events WHERE cat_id='milo'").n,0);assert.equal(cell('SELECT status FROM clarifications WHERE id=?',a).status,'pending');db.close();
});

test('a photo attached to the pending update is kept and saved when the update is resolved',async()=>{
 const {db,ask,cell}=setup();
 const first=await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',photoName:'kitten.png',photoDataUrl:PNG,requestKey:'p1'});
 assert.equal(cell('SELECT count(*) n FROM photos').n,0,'no photo is attached to a guessed cat');
 const row=cell('SELECT * FROM clarifications');assert.equal(row.photo_data,PNG);assert.equal(row.photo_name,'kitten.png');
 assert.equal((await (await get('clarifications=1')).json()).clarifications[0].hasPhoto,true);
 // The answer carries no photo, and a different photo sent with it is ignored.
 const done=await ask(answerPlan('neuter','ink'),{clarificationId:first.body.clarificationId,input:'thin one',photoDataUrl:'data:image/png;base64,AAAA',requestKey:'p2'});
 assert.equal(done.body.outcome,'committed');assert.equal(done.body.photoSaved,true);
 const photo=cell('SELECT * FROM photos');assert.equal(photo.cat_id,'ink');assert.equal(photo.storage_location,PNG);assert.ok(photo.event_id);db.close();
});

test('a photo on a clarified update that needs approval does not have to be re-added',async()=>{
 const {db,ask,cell}=setup();
 const first=await ask(unsurePlan('adoption'),{input:ORIGINAL,photoDataUrl:PNG,requestKey:'q1'});
 const proposed=await ask(answerPlan('adoption','ink'),{clarificationId:first.body.clarificationId,input:'thin one',requestKey:'q2'});
 assert.equal(proposed.body.outcome,'needs_confirmation');assert.equal(cell('SELECT count(*) n FROM photos').n,0);
 const ok=await ask(base(),{confirmProposalId:proposed.body.proposalId,requestKey:'q3'});
 assert.equal(ok.body.outcome,'committed');assert.equal(cell('SELECT cat_id c FROM photos').c,'ink');db.close();
});

test('a clarification survives an app reload and a delay',async()=>{
 const {db,ask,cell}=setup();
 const first=await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',sessionId:'before-reload',requestKey:'r1'});
 // Reload: the client holds nothing; the open question comes back from the server, whatever the session.
 const listed=(await (await get('clarifications=1')).json()).clarifications;assert.equal(listed[0].id,first.body.clarificationId);assert.equal(listed[0].sessionId,'before-reload');
 const back=travel(2*24*60*60*1000);
 try{
  assert.equal((await (await get('clarifications=1')).json()).clarifications.length,1,'still open two days later');
  const done=await ask(answerPlan('neuter','ink'),{clarificationId:first.body.clarificationId,input:'thin one',sessionId:'after-reload',requestKey:'r2'});
  assert.equal(done.body.outcome,'committed');
 }finally{back()}
 assert.equal(cell("SELECT count(*) n FROM events WHERE cat_id='ink' AND event_type='neuter'").n,1);db.close();
});

test('a cancelled clarification can no longer be answered and changes nothing',async()=>{
 const {db,records,ask,cell}=setup();
 const id=(await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',requestKey:'c1'})).body.clarificationId;const before=records();
 const gone=await api.DELETE(request({cancelClarificationId:id},'DELETE'));assert.equal((await gone.json()).outcome,'cancelled');
 const row=cell('SELECT * FROM clarifications');assert.equal(row.status,'cancelled');assert.ok(row.decided_at);assert.equal(row.original_text,'The black kitten got neutered.','audit trail kept');
 const late=await ask(answerPlan('neuter','ink'),{clarificationId:id,input:'thin one',requestKey:'c2'});assert.equal(late.status,409);assert.match(late.body.message,/cancelled/);
 assert.equal(records(),before);assert.equal((await api.DELETE(request({cancelClarificationId:id},'DELETE'))).status,409);
 assert.equal((await (await get('clarifications=1')).json()).clarifications.length,0);db.close();
});

test('an expired clarification is closed, not applied',async()=>{
 const {db,records,ask,cell}=setup();
 const id=(await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',requestKey:'e1'})).body.clarificationId;const before=records();
 const back=travel(4*24*60*60*1000);
 try{
  assert.equal((await (await get('clarifications=1')).json()).clarifications.length,0,'expired questions are not listed');
  const late=await ask(answerPlan('neuter','ink'),{clarificationId:id,input:'thin one',requestKey:'e2'});assert.equal(late.status,409);assert.match(late.body.message,/expired/);
 }finally{back()}
 assert.equal(cell('SELECT status FROM clarifications').status,'expired');assert.equal(records(),before);
 // Expired by answering first, before any list call.
 const second=(await ask(unsurePlan('neuter'),{input:'Again, the black kitten got neutered.',requestKey:'e3'})).body.clarificationId;
 const back2=travel(4*24*60*60*1000);try{assert.equal((await ask(answerPlan('neuter','ink'),{clarificationId:second,input:'thin',requestKey:'e4'})).status,409)}finally{back2()}
 assert.equal(cell('SELECT status FROM clarifications WHERE id=?',second).status,'expired');db.close();
});

test('a clarification whose cats changed meanwhile is stale and is not applied',async()=>{
 const {db,records,ask,cell}=setup();
 const id=(await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',requestKey:'s1'})).body.clarificationId;
 db.exec("UPDATE cats SET current_location='Vet' WHERE id='ink'");const before=records();
 const late=await ask(answerPlan('neuter','ink'),{clarificationId:id,input:'thin one',requestKey:'s2'});
 assert.equal(late.status,409);assert.match(late.body.message,/changed/);assert.equal(cell('SELECT status FROM clarifications').status,'stale');assert.equal(records(),before);db.close();
});

test('an ambiguous answer keeps the same pending question open and changes nothing',async()=>{
 const {db,records,ask,cell}=setup();
 const id=(await ask(unsurePlan('neuter'),{input:'The black kitten got neutered.',requestKey:'m1'})).body.clarificationId;const before=records();
 // The answer still fits both kittens: the interpreter asks again.
 const again=await ask(clarifyPlan('Both are black. Which one has the thinner build?'),{clarificationId:id,input:'the black one',requestKey:'m2'});
 assert.equal(again.body.outcome,'clarification');assert.equal(again.body.clarificationId,id);assert.equal(records(),before);
 let row=cell('SELECT * FROM clarifications');assert.equal(row.status,'pending');assert.equal(row.attempts,1);assert.equal(row.question,'Both are black. Which one has the thinner build?');assert.equal(row.original_text,'The black kitten got neutered.');
 // An unsure interpretation of the answer is also not accepted.
 const unsure=await ask({...answerPlan('neuter','ink'),confidence:0.6},{clarificationId:id,input:'maybe that one',requestKey:'m3'});
 assert.equal(unsure.body.outcome,'clarification');assert.equal(records(),before);assert.equal(cell('SELECT attempts a FROM clarifications').a,2);
 assert.deepEqual(db.prepare('SELECT outcome FROM clarification_answers ORDER BY created_at,rowid').all().map(r=>r.outcome),['still_ambiguous','still_ambiguous']);
 // A clear answer then resolves the very same question.
 const done=await ask(answerPlan('neuter','ink'),{clarificationId:id,input:'the thin one',requestKey:'m4'});assert.equal(done.body.outcome,'committed');
 assert.equal(cell('SELECT status FROM clarifications').status,'resolved');assert.equal(cell("SELECT count(*) n FROM events WHERE event_type='neuter'").n,1);db.close();
});

test('clarification rows are owner-bound and cannot be rewritten or reopened',()=>{
 const {db}=setup();
 db.exec(`INSERT INTO ai_inputs(id,owner_id,transcription,input_type,created_at) VALUES('in1','A','x','text','${T0}')`);
 const insert=(owner)=>db.prepare("INSERT INTO clarifications(id,owner_id,input_id,mode,original_text,question,proposed_plan,created_at,updated_at,expires_at) VALUES(?,?,'in1','text','x','q','{}',?,?,?)").run('c-'+owner,owner,T0,T0,T0);
 assert.throws(()=>insert('B'),/ownership/);insert('A');
 assert.throws(()=>db.exec("UPDATE clarifications SET original_text='changed'"),/cannot be edited/);
 assert.throws(()=>db.exec("UPDATE clarifications SET owner_id='B'"),/cannot be edited/);
 db.exec("UPDATE clarifications SET status='cancelled'");assert.throws(()=>db.exec("UPDATE clarifications SET status='pending'"),/reopened/);
 assert.throws(()=>db.prepare("INSERT INTO clarification_resolutions(clarification_id,owner_id,resolved_at) VALUES('c-A','A',?)").run(T0),/ownership/,'a closed question cannot be resolved');db.close();
});

test('without an AI interpreter no pending question is stored for an update that was never interpreted',async()=>{
 const {db,ask,cell}=setup();delete env.OPENROUTER_API_KEY;
 const r=await ask(base(),{input:'something vague',requestKey:'n1'});
 assert.equal(cell('SELECT count(*) n FROM clarifications').n,0);assert.equal(r.body.clarificationId,undefined);db.close();
});
