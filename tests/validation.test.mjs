import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile=src=>ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const url=js=>`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
const read=n=>readFile(new URL(`../app/api/assistant/${n}.ts`,import.meta.url),'utf8');
const migrations=await Promise.all(['0000_salty_cannonball','0001_slippery_spot','0002_secure_ownership','0003_reliable_recording','0004_versioned_corrections','0005_validated_proposals','0006_pending_clarifications'].map(n=>readFile(new URL(`../drizzle/${n}.sql`,import.meta.url),'utf8')));
const validationURL=url(compile(await read('validation')));
const v=await import(validationURL);
const correctionURL=url(compile(await read('corrections')));
const helperURL=url(compile(await read('reliability')));
const env={};globalThis.__validationEnv=env;
const clarificationsURL=`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL('../app/api/assistant/clarifications.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`;
const api=await import(url(compile((await read('route')).replace('from "./validation"',`from "${validationURL}"`).replace('from "./reliability"',`from "${helperURL}"`).replace('from "./corrections"',`from "${correctionURL}"`).replace('from "./clarifications"',`from "${clarificationsURL}"`).replace('import { env } from "cloudflare:workers";','const env=globalThis.__validationEnv;'))));

const statuses=new Set(["observed","captured","awaiting vet","recovering","foster","available for adoption","adoption pending","adopted","returned to colony","lost","deceased"]);
const T0='2026-01-01T00:00:00.000Z';
const query={kind:'none',catId:null,status:null,year:null,search:null};
const base=()=>({intent:'record',message:'Saved.',clarification:null,confidence:0.95,cats:[],events:[],people:[],transactions:[],query:{...query},socialDraft:null});
const catDraft=(o={})=>({ref:'new',existingId:null,name:null,sex:null,ageClass:null,appearance:null,distinguishingCharacteristics:null,healthObservations:null,reproductiveSignificance:null,origin:null,currentStatus:null,currentLocation:null,microchipNumber:null,...o});
const eventDraft=(o={})=>({catRef:'milo',eventType:'observation',occurredAt:null,location:null,personName:null,notes:'seen',...o});
const txn=(o={})=>({transactionType:'cash_donation',direction:'inflow',date:null,amount:20,currency:'USD',personName:null,category:'donation',description:'Donation',item:null,quantity:null,unit:null,estimatedValue:null,relatedCatRef:null,...o});
const planWith=o=>({...base(),...o});
const ok=p=>v.validateProviderPlan(p,{statuses});
const bad=(p,msg)=>assert.throws(()=>ok(p),e=>e instanceof v.PlanRejected,msg);

const request=(body,method='POST',owner='A')=>new Request('https://rescue.test/api/assistant',{method,headers:{'x-catnr-user-id':owner,'x-catnr-user-email':`${owner}@test`},body:JSON.stringify(body)});
function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const sql of migrations)db.exec(sql);
 db.exec(`INSERT INTO cats(id,owner_id,name,current_status,created_at,updated_at) VALUES('milo','A','Milo','foster','${T0}','${T0}'),('luna','A','Luna','foster','${T0}','${T0}'),('bcat','B','Secret','foster','${T0}','${T0}')`);
 const state={calls:0,raw:base()};
 env.DB={prepare(query){let values=[];return{bind(...x){values=x.map(y=>y===undefined?null:y);return this},async first(){return db.prepare(query).get(...values)||null},async all(){return{results:db.prepare(query).all(...values)}},async run(){return db.prepare(query).run(...values)}}},async batch(statements){db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT')}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e}}};
 env.OPENROUTER_API_KEY='test';
 // `content` is exactly what the provider returned; it may be any string, valid JSON or not.
 globalThis.fetch=async()=>{state.calls++;return Response.json({choices:[{message:{content:typeof state.raw==='string'?state.raw:JSON.stringify(state.raw)}}]})};
 const domain=()=>JSON.stringify(['cats','people','colonies','events','transactions','photos','corrections'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));
 return{db,state,domain};
}
const post=(body)=>api.POST(request(body));

// ---------- schema-level validation ----------
test('malformed provider JSON is rejected, never partially parsed',async()=>{
 for(const [name,raw] of Object.entries({text:'Sure! Here you go: {"intent":"record"}',truncated:'{"intent":"record","message":"x"',empty:'',array:'[]',nul:'null',number:'42'})){
  const {db,state,domain}=setup();state.raw=raw;const before=domain();
  const r=await post({input:'Milo was seen',requestKey:name});assert.equal(r.status,422,name);assert.equal((await r.json()).outcome,'rejected');assert.equal(domain(),before,name);
  assert.equal(db.prepare('SELECT count(*) n FROM ai_inputs').get().n,0,name);db.close();
 }
 assert.throws(()=>v.parseProviderJson('{"a":'),v.PlanRejected);assert.throws(()=>v.parseProviderJson(null),v.PlanRejected);
});
test('unknown, missing or mistyped plan fields are rejected',()=>{
 bad({...base(),delete:'milo'},'unknown top-level field');bad({...base(),mergeCats:['a','b']},'merge is not an operation');bad({...base(),owner_id:'B'},'ownership field');
 bad({...base(),intent:'delete_everything'});bad({...base(),intent:undefined});bad({...base(),message:5});bad({...base(),confidence:'high'});bad({...base(),confidence:1.5});bad({...base(),confidence:-0.1});bad({...base(),cats:{}});bad(null);bad('record');
 bad(planWith({cats:[catDraft({ownerId:'B'})]}),'unknown nested field');bad(planWith({events:[eventDraft({eventType:'drop_table'})]}),'event type');bad(planWith({events:[eventDraft({eventType:5})]}));
 bad(planWith({cats:[catDraft({sex:'robot'})]}));bad(planWith({cats:[catDraft({ageClass:'ancient'})]}));bad(planWith({cats:[catDraft({currentStatus:'flying'})]}));bad(planWith({cats:[catDraft({microchipNumber:'12'})]}));
 bad(planWith({cats:[catDraft({name:'x'.repeat(5000)})]}),'oversized string');bad(planWith({cats:[catDraft({name:'a\u0000b'})]}),'control chars');
 bad(planWith({cats:Array.from({length:60},(_,i)=>catDraft({ref:`c${i}`}))}),'too many items');bad(planWith({cats:[catDraft(),catDraft()]}),'duplicate ref');
 bad({...base(),intent:'query',query:{...query,kind:'drop_everything'}});bad({...base(),intent:'query',query:{...query,kind:'impact',year:1800}});bad({...base(),intent:'query',query:{...query,kind:'impact',year:'2026'}});bad({...base(),intent:'query',query:{...query,kind:'cats_by_status',status:'flying'}});
 bad(planWith({events:[eventDraft()],query:{kind:'impact'}}),'record carrying a query');
 assert.ok(ok(planWith({cats:[catDraft({sex:'FEMALE',name:'Pepper'})],events:[eventDraft({catRef:'new',eventType:'vaccination: rabies'})]})),'valid plan is accepted');
});
test('invalid dates and timestamps are rejected',async()=>{
 for(const d of ['yesterday','2026-13-01','2026-02-30','2026-00-10','2026/01/05','01-05-2026','2026-01-05T25:00:00Z','2026-01-05T10:61:00Z','1850-01-01','2999-01-01','','2026-1-5',20260105,{}]){
  bad(planWith({events:[eventDraft({occurredAt:d})]}),`event date ${String(d)}`);bad(planWith({transactions:[txn({date:d})]}),`txn date ${String(d)}`);
 }
 for(const d of ['2026-01-05','2026-01-05T10:00:00Z','2026-01-05T10:00:00.123Z','2024-02-29','2026-01-05T10:00:00-05:00'])ok(planWith({events:[eventDraft({occurredAt:d})]}));
 const {db,state,domain}=setup();const before=domain();state.raw=planWith({events:[eventDraft({occurredAt:'2026-02-31'})]});
 assert.equal((await post({input:'x'})).status,422);assert.equal(domain(),before);db.close();
});
test('invalid amounts, quantities and currencies are rejected',async()=>{
 for(const a of [-5,0,NaN,Infinity,'20','twenty',1e12,10.123,{},[]])bad(planWith({transactions:[txn({amount:a})]}),`amount ${String(a)}`);
 bad(planWith({transactions:[txn({amount:null})]}),'cash transaction without amount');
 bad(planWith({transactions:[txn({quantity:-1,amount:5})]}));bad(planWith({transactions:[txn({estimatedValue:-1,amount:5})]}));bad(planWith({transactions:[txn({currency:'DOGE'})]}));bad(planWith({transactions:[txn({currency:'usd$'})]}));
 bad(planWith({transactions:[txn({transactionType:'wire_transfer'})]}));bad(planWith({transactions:[txn({direction:'sideways'})]}));
 bad(planWith({transactions:[txn({transactionType:'cash_donation',direction:'outflow'})]}),'donation as outflow');bad(planWith({transactions:[txn({transactionType:'operating_expense',direction:'inflow'})]}),'expense as inflow');
 bad(planWith({transactions:[txn({description:''})]}));
 ok(planWith({transactions:[txn({amount:129.5}),txn({transactionType:'in_kind_donation',amount:null,item:'Friskies',quantity:2,unit:'bag'})]}));
 const {db,state,domain}=setup();const before=domain();state.raw=planWith({transactions:[txn({amount:-5})]});assert.equal((await post({input:'x'})).status,422);assert.equal(domain(),before);db.close();
});
test('invalid IDs and references (unknown, foreign owner, injection) are rejected',async()=>{
 for(const id of ["milo'; DROP TABLE cats;--",'a b','../x','x'.repeat(500),5,{}]){bad(planWith({events:[eventDraft({catRef:id})]}),`catRef ${String(id)}`);bad(planWith({cats:[catDraft({existingId:id,ref:'r'})]}),`existingId ${String(id)}`)}
 const reference={ 'unknown event cat':planWith({events:[eventDraft({catRef:'ghost'})]}),'other owner event cat':planWith({events:[eventDraft({catRef:'bcat'})]}),'other owner cat update':planWith({cats:[catDraft({ref:'bcat',existingId:'bcat',name:'Stolen'})]}),
  'unknown person':planWith({people:[{ref:'p',existingId:'nobody',name:'X',type:null,generalLocation:null,contact:null}]}),'unknown txn cat':planWith({transactions:[txn({relatedCatRef:'ghost'})]}),'query other owner cat':{...base(),intent:'query',query:{...query,kind:'cat_history',catId:'bcat'}}};
 for(const [name,raw] of Object.entries(reference)){const {db,state,domain}=setup();const before=domain();state.raw=raw;const r=await post({input:'x',requestKey:name});assert.equal(r.status,422,name);assert.equal(domain(),before,name);assert.equal(db.prepare("SELECT name FROM cats WHERE id='bcat'").get().name,'Secret');db.close()}
});
test('invalid operations are rejected: nothing is partially applied',async()=>{
 // one valid event followed by one invalid transaction: the whole plan must be refused
 const {db,state,domain}=setup();const before=domain();
 state.raw=planWith({events:[eventDraft({catRef:'milo'})],transactions:[txn({amount:20}),txn({amount:-1})]});
 assert.equal((await post({input:'x'})).status,422);assert.equal(domain(),before);
 for(const raw of [planWith({}),{...base(),intent:'record',events:[eventDraft({catRef:'milo'}),eventDraft({catRef:'milo',eventType:'explode'})]}]){state.raw=raw;assert.equal((await post({input:'y'})).status,422);assert.equal(domain(),before)}
 db.close();
});

// ---------- questions never mutate ----------
test('questions create zero mutations, even when the provider tries to sneak in records',async()=>{
 const sneaky=planWith({intent:'query',query:{...query,kind:'impact',year:2026},cats:[catDraft({ref:'x',name:'Ghost'})],events:[eventDraft()],transactions:[txn()]});
 for(const [name,raw,body] of [['honest query',{...base(),intent:'query',query:{...query,kind:'impact',year:2026}},{input:'how many cats did we help?',mode:'ask'}],['sneaky query',sneaky,{input:'how many cats did we help?',mode:'ask'}],['record in ask mode',planWith({events:[eventDraft()]}),{input:'milo is sick',mode:'ask'}],['social with records',planWith({intent:'social',socialDraft:'hi',events:[eventDraft()]}),{input:'write a post'}],['clarify with records',planWith({intent:'clarify',clarification:'which?',events:[eventDraft()]}),{input:'x'}]]){
  const {db,state,domain}=setup();const before=domain();state.raw=raw;const r=await post({...body,photoDataUrl:'data:image/jpeg;base64,/9j/2Q==',requestKey:name});
  assert.equal(domain(),before,`${name} touched records`);assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n,0,name);
  if(name==='honest query'){assert.equal(r.status,200);assert.equal((await r.json()).outcome,'answered')}else assert.equal(r.status,422,name);
  assert.equal(db.prepare('SELECT count(*) n FROM proposed_actions').get().n,0);db.close();
 }
});

// ---------- ambiguity ----------
test('ambiguous cat identity does not mutate records',async()=>{
 const cases={
  'medical event with no cat':planWith({events:[eventDraft({catRef:null,eventType:'spay'})]}),
  'death with no cat':planWith({events:[eventDraft({catRef:null,eventType:'deceased'})]}),
  'adoption of an unnamed new cat when cats exist':planWith({cats:[catDraft({ref:'n',appearance:'gray tabby'})],events:[eventDraft({catRef:'n',eventType:'adoption'})]}),
  'new cat sharing an existing name gets a medical event':planWith({cats:[catDraft({ref:'n',name:'milo'})],events:[eventDraft({catRef:'n',eventType:'vet_visit'})]}),
  'low-confidence match on medical event':planWith({confidence:0.6,cats:[catDraft({ref:'milo',existingId:'milo'})],events:[eventDraft({catRef:'milo',eventType:'medication'})]}),
  'very low confidence':planWith({confidence:0.2,events:[eventDraft({eventType:'observation'})]}),
 };
 for(const [name,raw] of Object.entries(cases)){
  const {db,state,domain}=setup();const before=domain();state.raw=raw;const r=await post({input:'something happened',requestKey:name});const out=await r.json();
  assert.equal(out.outcome,'clarification',name);assert.ok(out.clarification,name);assert.deepEqual(out.created,[]);assert.deepEqual(out.updated,[]);
  assert.equal(domain(),before,`${name} mutated records`);assert.equal(db.prepare('SELECT count(*) n FROM proposed_actions').get().n,0,name);
  const audit=db.prepare('SELECT interpretation FROM ai_inputs').get();assert.ok(audit,'original words and interpretation are kept');db.close();
 }
});

// ---------- consequential changes need approval ----------
const consequential={
 'mark deceased (event)':planWith({events:[eventDraft({catRef:'milo',eventType:'deceased'})]}),
 'mark deceased (status)':planWith({cats:[catDraft({ref:'milo',existingId:'milo',currentStatus:'deceased'})],events:[eventDraft({catRef:'milo',eventType:'observation'})]}),
 'adoption':planWith({cats:[catDraft({ref:'milo',existingId:'milo',currentStatus:'adopted'})],events:[eventDraft({catRef:'milo',eventType:'adoption'})]}),
 'lost':planWith({events:[eventDraft({catRef:'milo',eventType:'lost'})]}),
 'rename an existing cat':planWith({cats:[catDraft({ref:'milo',existingId:'milo',name:'Felix'})],events:[eventDraft({catRef:'milo'})]}),
 'large financial amount':planWith({transactions:[txn({amount:5000})]}),
};
test('consequential changes are only proposed: nothing is written until Ari approves',async()=>{
 for(const [name,raw] of Object.entries(consequential)){
  const {db,state,domain}=setup();const before=domain();state.raw=raw;
  const r=await post({input:'a big change',requestKey:name});const out=await r.json();
  assert.equal(r.status,200,name);assert.equal(out.outcome,'needs_confirmation',name);assert.ok(out.proposalId);assert.ok(out.reasons.length,name);assert.deepEqual(out.created,[]);
  assert.equal(domain(),before,`${name} changed records before approval`);
  const p=db.prepare('SELECT * FROM proposed_actions').get();assert.equal(p.status,'proposed');assert.equal(p.owner_id,'A');assert.ok(p.input_id);
  assert.equal(db.prepare("SELECT current_status s FROM cats WHERE id='milo'").get().s,'foster');db.close();
 }
});
test('approval executes the stored plan once; the AI is not asked again',async()=>{
 const {db,state}=setup();state.raw=consequential['adoption'];
 const out=await (await post({input:'Milo got adopted by Sam',requestKey:'p1'})).json();assert.equal(state.calls,1);
 // a different, hostile provider answer afterwards must not matter
 state.raw=planWith({events:[eventDraft({catRef:'luna',eventType:'deceased'})]});
 const done=await post({confirmProposalId:out.proposalId,requestKey:'a1'});const res=await done.json();
 assert.equal(done.status,200);assert.equal(res.outcome,'committed');assert.equal(res.confirmed,true);assert.equal(state.calls,1,'approval must not re-run the interpreter');
 assert.equal(db.prepare("SELECT current_status s FROM cats WHERE id='milo'").get().s,'adopted');assert.equal(db.prepare("SELECT current_status s FROM cats WHERE id='luna'").get().s,'foster');
 const e=db.prepare("SELECT * FROM events WHERE event_type='adoption'").get();assert.equal(e.source_input_id,out.proposalId&&db.prepare('SELECT input_id FROM proposed_actions').get().input_id,'event links back to Ari\'s original words');
 const p=db.prepare('SELECT * FROM proposed_actions').get();assert.equal(p.status,'executed');assert.ok(p.decided_at);assert.equal(p.decided_by,'A');assert.equal(db.prepare('SELECT count(*) n FROM proposal_executions').get().n,1);
 // approving again (new retry key) cannot double-apply
 const again=await post({confirmProposalId:out.proposalId,requestKey:'a2'});assert.equal(again.status,409);assert.equal(db.prepare("SELECT count(*) n FROM events WHERE event_type='adoption'").get().n,1);
 // same retry key replays the original answer
 assert.equal((await (await post({confirmProposalId:out.proposalId,requestKey:'a1'})).json()).replayed,true);db.close();
});
test('a proposal can be dismissed; dismissed, foreign and expired proposals cannot be approved',async()=>{
 const {db,state,domain}=setup();const before=domain();state.raw=consequential['mark deceased (event)'];
 const out=await (await post({input:'Milo died',requestKey:'d1'})).json();
 // another owner cannot see or approve it
 assert.equal((await api.POST(request({confirmProposalId:out.proposalId,requestKey:'x'},'POST','B'))).status,404);assert.equal((await api.DELETE(request({rejectProposalId:out.proposalId},'DELETE','B'))).status,409);
 assert.equal(db.prepare('SELECT status FROM proposed_actions').get().status,'proposed');
 const dismissed=await api.DELETE(request({rejectProposalId:out.proposalId},'DELETE'));assert.equal((await dismissed.json()).outcome,'dismissed');
 assert.equal((await post({confirmProposalId:out.proposalId,requestKey:'late'})).status,409);assert.equal(domain(),before);
 state.raw=consequential['lost'];const second=await (await post({input:'lost',requestKey:'d2'})).json();
 db.prepare("UPDATE proposed_actions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(second.proposalId);
 assert.equal((await post({confirmProposalId:second.proposalId,requestKey:'exp'})).status,409);assert.equal(domain(),before);
 assert.equal((await post({confirmProposalId:'proposal-nope',requestKey:'nope'})).status,404);db.close();
});
test('a stored proposal cannot be tampered with or approved against changed records',async()=>{
 const {db,state,domain}=setup();state.raw=consequential['adoption'];const out=await (await post({input:'adopted',requestKey:'t1'})).json();
 assert.throws(()=>db.prepare("UPDATE proposed_actions SET plan='{}' WHERE id=?").run(out.proposalId),/cannot be edited/);
 // the plan on disk is re-validated at approval time: corrupt it behind the triggers and it is refused
 db.exec('DROP TRIGGER proposed_actions_immutable_plan');
 const stored=JSON.parse(db.prepare('SELECT plan FROM proposed_actions').get().plan);stored.events[0].catRef='bcat';
 db.prepare('UPDATE proposed_actions SET plan=?').run(JSON.stringify(stored));const before=domain();
 assert.equal((await post({confirmProposalId:out.proposalId,requestKey:'t2'})).status,422);assert.equal(domain(),before);
 stored.events[0].catRef='milo';stored.events[0].occurredAt='2026-02-31';db.prepare('UPDATE proposed_actions SET plan=?').run(JSON.stringify(stored));
 assert.equal((await post({confirmProposalId:out.proposalId,requestKey:'t3'})).status,422);assert.equal(domain(),before);db.close();
});
test('a photo on a proposed change is only saved after approval, and must be the same photo',async()=>{
 const {db,state}=setup();state.raw=consequential['adoption'];const photo='data:image/jpeg;base64,/9j/2Q==',other='data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
 const out=await (await post({input:'adopted',photoDataUrl:photo,requestKey:'ph1'})).json();assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n,0);
 assert.equal((await post({confirmProposalId:out.proposalId,requestKey:'ph2'})).status,400);assert.equal((await post({confirmProposalId:out.proposalId,photoDataUrl:other,requestKey:'ph3'})).status,400);assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n,0);
 assert.equal((await post({confirmProposalId:out.proposalId,photoDataUrl:photo,requestKey:'ph4'})).status,200);assert.equal(db.prepare('SELECT count(*) n FROM photos').get().n,1);db.close();
});
test('financial corrections require approval; unsupported operations (delete, merge, ownership) cannot be expressed',async()=>{
 const {db,state,domain}=setup();
 db.exec(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount,description,created_at) VALUES('t1','A','cash_donation','inflow','${T0}',100,'Donation','${T0}')`);
 const before=domain();state.raw=planWith({transactions:[txn({amount:50})]});
 const r=await api.PATCH(request({id:'t1',recordType:'transaction',version:db.prepare("SELECT version v FROM transactions").get().v,correction:'it was 50',requestKey:'f1'},'PATCH'));
 assert.equal((await r.json()).outcome,'needs_confirmation');assert.equal(domain(),before);
 for(const raw of [{...base(),operations:[{type:'delete_cat',id:'milo'}]},{...base(),merge:{keep:'milo',remove:'luna'}},planWith({cats:[catDraft({ref:'milo',existingId:'milo',ownerId:'B'})]}),planWith({cats:[catDraft({ref:'milo',existingId:'milo'})],people:[{ref:'p',existingId:null,name:'X',type:'owner',generalLocation:null,contact:null}]})]){
  state.raw=raw;assert.equal((await post({input:'merge milo and luna',requestKey:`m${Math.random()}`})).status,422);assert.equal(domain(),before);
 }
 db.close();
});
test('non-consequential, unambiguous updates still apply immediately',async()=>{
 const {db,state}=setup();state.raw=planWith({cats:[catDraft({ref:'milo',existingId:'milo',currentStatus:'recovering'})],events:[eventDraft({catRef:'milo',eventType:'vet_visit'})],transactions:[txn({amount:45.5,transactionType:'operating_expense',direction:'outflow'})]});
 const out=await (await post({input:'Milo went to the vet, I spent $45.50',requestKey:'ok'})).json();assert.equal(out.outcome,'committed');
 assert.equal(db.prepare("SELECT current_status s FROM cats WHERE id='milo'").get().s,'recovering');assert.equal(db.prepare('SELECT count(*) n FROM proposed_actions').get().n,0);db.close();
});
