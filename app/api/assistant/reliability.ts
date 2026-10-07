type D1 = D1Database;
const now=()=>new Date().toISOString();

// D1 batch is the transaction boundary. Planning never writes to the database.
export function pendingWrites(db:D1){
 const statements:D1PreparedStatement[]=[], inserted:Record<string,unknown>[]=[];
 const queued={prepare(query:string){let values:(string|number|null)[]=[];return{
  bind(...v:(string|number|null|undefined)[]){values=v.map(x=>x===undefined?null:x);return this},
  async first(){
   const table=query.match(/FROM (cats|people|colonies) WHERE/)?.[1];
   const row=inserted.find(x=>x.table===table&&x.owner_id===values[1]&&x.id===values[0]) ||
    inserted.find(x=>x.table===table&&x.owner_id===values[0]&&String(x.name).toLowerCase()===String(values[1]).toLowerCase());
   return row||db.prepare(query).bind(...values).first();
  },
  async run(){
   const match=query.match(/INSERT INTO (\w+)\(([^)]+)\)/);
   if(match)inserted.push({table:match[1],...Object.fromEntries(match[2].split(',').map((c,i)=>[c,values[i]]))});
   statements.push(db.prepare(query).bind(...values));return {success:true};
  }
 }}};
 return{db:queued as unknown as D1,statements};
}
export async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,"0")).join("")}
export async function receipt(db:D1,owner:string,key:string,hash:string){
 const row=await db.prepare("SELECT request_hash,response FROM write_requests WHERE owner_id=? AND request_key=?").bind(owner,key).first<{request_hash:string;response:string}>();
 if(!row)return null;
 if(row.request_hash!==hash)return Response.json({outcome:"rejected",message:"This retry key was used for a different update. Start a new update."},{status:409});
 return Response.json({...JSON.parse(row.response),replayed:true});
}
export async function revision(db:D1,owner:string){return Number((await db.prepare("SELECT version FROM rescue_revisions WHERE owner_id=?").bind(owner).first<{version:number}>())?.version||0)}
export function validatedPhoto(value:unknown):string|null{
 if(value==null)return null;
 if(typeof value!=="string"||value.length>1_800_000)throw new Error("Photo must be smaller than 1.3 MB. Choose a smaller photo.");
 const m=value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!m)throw new Error("Unsupported photo. Choose a JPEG, PNG or WebP image.");
 const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));
 const valid=m[1]==="jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:m[1]==="png"?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
 if(!valid)throw new Error("The photo could not be read. Choose it again.");
 return value;
}
export async function commit(db:D1,owner:string,key:string,hash:string,base:number,statements:D1PreparedStatement[],result:unknown){
 // The unique receipt and revision assertion are inside the SAME atomic batch.
 await db.batch([
  db.prepare("INSERT INTO write_requests(owner_id,request_key,request_hash,response,created_at) VALUES(?,?,?,?,?)").bind(owner,key,hash,JSON.stringify(result),now()),
  db.prepare("INSERT INTO write_guards(owner_id,expected_version) VALUES(?,?)").bind(owner,base),
  ...statements,
  db.prepare("DELETE FROM write_guards WHERE owner_id=?").bind(owner)
 ]);
}
export function writeFailure(error:unknown,uncertain=false){
 const conflict=String(error).includes("Concurrent edit");
 return Response.json({outcome:conflict?"conflict":uncertain?"uncertain":"retryable",message:conflict?"Another update changed these records. Refresh and review your update before saving again.":uncertain?"I can’t confirm whether the update saved. Retry this same update to check safely without duplicates.":"Nothing was silently changed. The update could not be committed. Your words and photo are still here; retry the same update."},{status:conflict?409:503});
}

