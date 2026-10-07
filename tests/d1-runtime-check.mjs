import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
const mf=new Miniflare({modules:true,script:'export default { fetch(){ return new Response("ok") } }',d1Databases:['DB'],compatibilityDate:'2026-05-22'});
try{
 const db=await mf.getD1Database('DB');
 for(const name of ['0000_salty_cannonball','0001_slippery_spot','0002_secure_ownership','0003_reliable_recording']){
  const sql=await readFile(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8');
  for(const statement of sql.split('--> statement-breakpoint').filter(x=>x.trim()))await db.prepare(statement).run();
 }
 await db.prepare("INSERT INTO cats(id,owner_id,name,created_at,updated_at) VALUES('cat','A','Milo','now','now')").run();
 const before=await db.prepare("SELECT version FROM rescue_revisions WHERE owner_id='A'").first();
 try{await db.batch([db.prepare("UPDATE cats SET current_status='adopted' WHERE id='cat'"),db.prepare("INSERT INTO write_guards(owner_id,expected_version) VALUES('A',-1)")]);throw new Error('Expected batch failure')}catch(e){if(!String(e).includes('Concurrent edit'))throw e}
 const cat=await db.prepare("SELECT * FROM cats WHERE id='cat'").first();const after=await db.prepare("SELECT version FROM rescue_revisions WHERE owner_id='A'").first();
 if(cat.current_status!=='observed'||cat.version!==0||before.version!==after.version)throw new Error('Rollback failed');
 console.log('Actual D1: migrations, triggers, version guards, atomic rollback passed');
}finally{await mf.dispose()}
