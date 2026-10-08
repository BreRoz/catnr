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
 // A replay is the safe, expected result of a retry; it is counted so a runaway retry loop shows up in the ops report.
 try{await db.prepare("INSERT INTO ops_events(id,kind,owner_hash,route) VALUES(?,?,?,?)").bind(`ops_${crypto.randomUUID().replace(/-/g,"").slice(0,20)}`,"retry_replay",(await digest(`catnr-ops:${owner}`)).slice(0,12),"replay").run()}catch{/* monitoring never blocks a retry */}
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
/** The AI provider could not be reached or answered with an error. Nothing was written. */
export class AiUnavailable extends Error {}
/** The assistant was not called on purpose (a usage limit, a pause after failures, or the emergency switch). Nothing was written. */
export class AiLimited extends Error { constructor(message:string,public status:number){super(message)} }

/** Calls the AI provider with a time limit so a stalled request ends in a clear message, not an endless spinner. */
export async function providerFetch(url:string,init:RequestInit,label:string){
 let response:Response;
 try{response=await fetch(url,{...init,signal:AbortSignal.timeout(45000)})}catch{throw new AiUnavailable(`${label} did not respond`)}
 if(!response.ok)throw new AiUnavailable(`${label} error ${response.status}`);
 return response;
}

export function writeFailure(error:unknown,uncertain=false){
 if(error instanceof AiLimited)return Response.json({outcome:"ai_unavailable",message:error.message},{status:error.status});
 if(error instanceof AiUnavailable)return Response.json({outcome:"ai_unavailable",message:"The assistant couldn’t be reached, so nothing was saved. Your words and photo are still here. Try again in a minute, or add this under Records, which works without the assistant."},{status:503});
 const conflict=String(error).includes("Concurrent edit");
 return Response.json({outcome:conflict?"conflict":uncertain?"uncertain":"retryable",message:conflict?"Another update changed these records. Refresh and review your update before saving again.":uncertain?"I can’t confirm whether the update saved. Retry this same update to check safely without duplicates.":"Nothing was silently changed. The update could not be committed. Your words and photo are still here; retry the same update."},{status:conflict?409:503});
}
