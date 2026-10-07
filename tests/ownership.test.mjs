import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const sql = await Promise.all(['0000_salty_cannonball','0001_slippery_spot','0002_secure_ownership','0003_reliable_recording'].map(n=>readFile(new URL(`../drizzle/${n}.sql`,import.meta.url),'utf8')));
const source=await readFile(new URL('../app/api/assistant/route.ts',import.meta.url),'utf8');
const helperSource=await readFile(new URL('../app/api/assistant/reliability.ts',import.meta.url),'utf8');
const helperJS=ts.transpileModule(helperSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const helperURL=`data:text/javascript;base64,${Buffer.from(helperJS).toString('base64')}`;
const js=ts.transpileModule(source.replace('from "./reliability"',`from "${helperURL}"`).replace('import { env } from "cloudflare:workers";','const env=globalThis.__ownershipEnv;'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const db=new DatabaseSync(':memory:');db.exec(sql[0]);db.exec(sql[1]);
db.exec("INSERT INTO cats(id,name,created_at,updated_at) VALUES('legacy','Legacy','now','now'); INSERT INTO people(id,owner_id,name,created_at) VALUES('local','local-owner','Legacy person','now')");
db.exec(sql[2]);db.exec(sql[3]);
const binding={async batch(statements){db.exec('BEGIN');try{const r=[];for(const statement of statements)r.push(await statement.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}},prepare(query){let values=[];return {bind(...v){values=v.map(x=>x===undefined?null:x);return this},async first(){return db.prepare(query).get(...values)||null},async all(){return {results:db.prepare(query).all(...values)}},async run(){return db.prepare(query).run(...values)}}}};
let photoReads=0;
globalThis.__ownershipEnv={DB:binding,PHOTOS:{async get(){photoReads++;return {body:'photo',httpMetadata:{contentType:'image/jpeg'}}}}};
const api=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const req=(owner,method='GET',path='',body)=>new Request(`https://rescue.test/api/assistant${path}`,{method,headers:owner?{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@test`}: {},...(body&&method!=='GET'?{body:JSON.stringify(body)}:{})});
db.exec("INSERT INTO cats(id,owner_id,name,created_at,updated_at) VALUES('b-cat','B','Secret cat','now','now'); INSERT INTO people(id,owner_id,name,created_at) VALUES('b-person','B','Secret person','now'); INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('b-event','B','b-cat','observation','now','now'); INSERT INTO photos(id,owner_id,cat_id,storage_location,taken_at) VALUES('b-photo','B','b-cat','cats/B/test.jpg','now')");
test('anonymous and reserved identities cannot access any API method',async()=>{for(const method of ['GET','POST','PATCH'])for(const owner of [null,'local-owner','legacy:quarantine'])assert.equal((await api[method](req(owner,method,'',{input:'x'}))).status,401);assert.equal((await api.GET(new Request('https://rescue.test/api/assistant',{headers:{'oai-authenticated-user-id':'A'}}))).status,401)});
test('legacy remains quarantined after requests',async()=>{await api.GET(req('A'));assert.equal(db.prepare("SELECT owner_id FROM cats WHERE id='legacy'").get().owner_id,'legacy:quarantine');assert.equal(db.prepare("SELECT owner_id FROM people WHERE id='local'").get().owner_id,'legacy:quarantine')});
test('cross-user reads and photos denied; owner can read',async()=>{assert.equal((await api.GET(req('A','GET','?catId=b-cat'))).status,404);assert.equal((await api.GET(req('A','GET','?photoId=b-photo'))).status,404);assert.equal(photoReads,0);assert.equal((await api.GET(req('B','GET','?photoId=b-photo'))).status,200);const data=await (await api.GET(req('A'))).text();assert.ok(!data.includes('Secret'));assert.equal((await api.GET(req('B','GET','?catId=b-cat'))).status,200)});
test('cross-user corrections denied before recording input',async()=>{const r=await api.PATCH(req('A','PATCH','',{id:'b-event',recordType:'event',correction:'changed',owner_id:'B'}));assert.equal(r.status,404);assert.equal(db.prepare('SELECT count(*) n FROM ai_inputs').get().n,0)});
test('body ownership cannot override authenticated identity',async()=>{await api.POST(req('A','POST','',{input:'unknown update',owner_id:'B',ownerId:'B'}));assert.equal(db.prepare('SELECT owner_id FROM ai_inputs').get().owner_id,'A')});
test('database rejects missing owners, reassignment and all foreign relationships',()=>{
 db.exec("INSERT INTO colonies(id,owner_id,name,created_at) VALUES('b-colony','B','Colony','now'); INSERT INTO transactions(id,owner_id,transaction_type,direction,date,description,created_at) VALUES('b-txn','B','cash','inflow','now','x','now')");
 for(const table of ['cats','colonies','people','ai_inputs','events','transactions','photos']){assert.throws(()=>db.exec(`UPDATE ${table} SET owner_id=NULL`));assert.throws(()=>db.exec(`UPDATE ${table} SET owner_id='C'`));}
 db.exec("INSERT INTO cats(id,owner_id,created_at,updated_at) VALUES('a-cat','A','now','now'); INSERT INTO events(id,owner_id,event_type,occurred_at,created_at) VALUES('a-event','A','x','now','now'); INSERT INTO photos(id,owner_id,storage_location,taken_at) VALUES('a-photo','A','cats/A/x','now'); INSERT INTO transactions(id,owner_id,transaction_type,direction,date,description,created_at) VALUES('a-txn','A','cash','inflow','now','x','now')");
 const links={cats:{origin_colony_id:'b-colony'},events:{cat_id:'b-cat',person_id:'b-person',source_input_id:db.prepare('SELECT id FROM ai_inputs').get().id},photos:{cat_id:'b-cat',event_id:'b-event'},transactions:{person_id:'b-person',related_cat_id:'b-cat',related_event_id:'b-event',related_colony_id:'b-colony',source_input_id:db.prepare('SELECT id FROM ai_inputs').get().id}};
 for(const [table,columns] of Object.entries(links))for(const [column,id] of Object.entries(columns)){const owner=column==='source_input_id'?'B':'A';assert.throws(()=>db.prepare(`UPDATE ${table} SET ${column}=? WHERE owner_id=?`).run(id,owner));}

 assert.throws(()=>db.exec("UPDATE cats SET owner_id='A' WHERE id='b-cat'"));
 assert.throws(()=>db.exec("INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('bad','A','b-cat','x','now','now')"));
 assert.throws(()=>db.exec("INSERT INTO photos(id,owner_id,event_id,storage_location,taken_at) VALUES('bad','A','b-event','cats/A/x','now')"));
 assert.throws(()=>db.exec("INSERT INTO transactions(id,owner_id,person_id,transaction_type,direction,date,description,created_at) VALUES('bad','A','b-person','cash','inflow','now','x','now')"));
 assert.throws(()=>db.exec("INSERT INTO cats(id,name,created_at,updated_at) VALUES('ownerless','x','now','now')"));
});
test('AI cannot attach a transaction to another user cat or update their records',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.__ownershipEnv.OPENROUTER_API_KEY='test-only';
 let plan={intent:'record',message:'saved',clarification:null,confidence:1,cats:[],people:[],events:[],transactions:[{relatedCatRef:'b-cat',transactionType:'cash',direction:'inflow',amount:10,description:'unsafe'}],query:{kind:'none'},socialDraft:null};
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify(plan)}}]});
 try{
  const before=db.prepare('SELECT count(*) n FROM transactions').get().n;
  assert.equal((await api.POST(req('A','POST','',{input:'attach'}))).status,503);
  assert.equal(db.prepare('SELECT count(*) n FROM transactions').get().n,before);
  plan={...plan,transactions:[],cats:[{existingId:'b-cat',ref:'b-cat',name:'Stolen'}]};
  assert.equal((await api.POST(req('A','POST','',{input:'change'}))).status,503);
  assert.equal(db.prepare("SELECT name FROM cats WHERE id='b-cat'").get().name,'Secret cat');
 }finally{globalThis.fetch=originalFetch;delete globalThis.__ownershipEnv.OPENROUTER_API_KEY;}
});
