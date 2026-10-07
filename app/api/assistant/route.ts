import { env } from "cloudflare:workers";
import { answerPrompt, candidatesFor, cancel as cancelClarification, listPending, loadForAnswer, queueClarification, queueResolved, queueStillAmbiguous, referencedCats, type Candidate } from "./clarifications";
import { checkCorrectionPlan, checkUndo, listCorrections, queueCorrection, queueUndo } from "./corrections";
import { pendingWrites, digest, receipt, revision, validatedPhoto, commit, writeFailure } from "./reliability";
import { PlanRejected, ambiguity, checkReferences, consequences, parseProviderJson, validateProviderPlan, TRANSACTION_TYPES, SEXES, AGE_CLASSES, PERSON_TYPES, CURRENCIES, type StoredCat } from "./validation";

type D1 = D1Database;
type CatDraft = { ref:string; existingId:string|null; name:string|null; sex:string|null; ageClass:string|null; appearance:string|null; distinguishingCharacteristics:string|null; healthObservations:string|null; reproductiveSignificance:string|null; origin:string|null; currentStatus:string|null; currentLocation:string|null; microchipNumber:string|null };
type EventDraft = { catRef:string|null; eventType:string; occurredAt:string|null; location:string|null; personName:string|null; notes:string|null };
type PersonDraft = { ref:string; existingId:string|null; name:string; type:string|null; generalLocation:string|null; contact:string|null };
type TransactionDraft = { transactionType:string; direction:"inflow"|"outflow"; date:string|null; amount:number|null; currency:string|null; personName:string|null; category:string|null; description:string; item:string|null; quantity:number|null; unit:string|null; estimatedValue:number|null; relatedCatRef:string|null };
type QueryDraft = { kind:"none"|"cats_by_status"|"cat_history"|"impact"|"income_expenses"|"transactions"|"cats_by_colony"|"cats_needing_surgery"; catId:string|null; status:string|null; year:number|null; search:string|null };
export type AgentPlan = { intent:"record"|"query"|"clarify"|"social"; message:string; clarification:string|null; confidence:number; cats:CatDraft[]; events:EventDraft[]; people:PersonDraft[]; transactions:TransactionDraft[]; query:QueryDraft; socialDraft:string|null };

const now=()=>new Date().toISOString();
const makeId=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
const statuses=new Set(["observed","captured","awaiting vet","recovering","foster","available for adoption","adoption pending","adopted","returned to colony","lost","deceased"]);

// Identity headers are set only by worker/index.ts after verifying Cloudflare Access.
export function ownerFrom(req:Request):string|null {
 const owner=req.headers.get("x-catnr-user-id");
 return owner && req.headers.get("x-catnr-user-email") && owner.trim() && owner!=="local-owner" && !owner.startsWith("legacy:") ? owner : null;
}
const unauthorized=()=>Response.json({message:"Sign in to access rescue records."},{status:401,headers:{"cache-control":"no-store"}});
const display=(c:any)=>String(c.name||[c.distinguishing_characteristics,c.appearance,c.sex,c.age_class].filter(Boolean).join(" ")||"Unnamed cat");
async function snapshot(db:D1,owner:string){const [cats,people,recentEvents]=await Promise.all([db.prepare("SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? ORDER BY c.updated_at DESC LIMIT 150").bind(owner).all(),db.prepare("SELECT id,name,type,general_location,contact FROM people WHERE owner_id=? ORDER BY created_at DESC LIMIT 100").bind(owner).all(),db.prepare("SELECT id,cat_id,event_type,occurred_at,location,notes FROM active_events WHERE owner_id=? ORDER BY occurred_at DESC LIMIT 120").bind(owner).all()]);return{cats:cats.results,people:people.results,recentEvents:recentEvents.results}}

const nullableString={type:["string","null"]};
const planSchema:any={type:"object",additionalProperties:false,required:["intent","message","clarification","confidence","cats","events","people","transactions","query","socialDraft"],properties:{
 intent:{type:"string",enum:["record","query","clarify","social"]},message:{type:"string"},clarification:nullableString,confidence:{type:"number"},
 cats:{type:"array",items:{type:"object",additionalProperties:false,required:["ref","existingId","name","sex","ageClass","appearance","distinguishingCharacteristics","healthObservations","reproductiveSignificance","origin","currentStatus","currentLocation","microchipNumber"],properties:{ref:{type:"string"},existingId:nullableString,name:nullableString,sex:nullableString,ageClass:nullableString,appearance:nullableString,distinguishingCharacteristics:nullableString,healthObservations:nullableString,reproductiveSignificance:nullableString,origin:nullableString,currentStatus:nullableString,currentLocation:nullableString,microchipNumber:nullableString}}},
 events:{type:"array",items:{type:"object",additionalProperties:false,required:["catRef","eventType","occurredAt","location","personName","notes"],properties:{catRef:nullableString,eventType:{type:"string"},occurredAt:nullableString,location:nullableString,personName:nullableString,notes:nullableString}}},
 people:{type:"array",items:{type:"object",additionalProperties:false,required:["ref","existingId","name","type","generalLocation","contact"],properties:{ref:{type:"string"},existingId:nullableString,name:{type:"string"},type:nullableString,generalLocation:nullableString,contact:nullableString}}},
 transactions:{type:"array",items:{type:"object",additionalProperties:false,required:["transactionType","direction","date","amount","currency","personName","category","description","item","quantity","unit","estimatedValue","relatedCatRef"],properties:{transactionType:{type:"string",enum:[...TRANSACTION_TYPES]},direction:{type:"string",enum:["inflow","outflow"]},date:nullableString,amount:{type:["number","null"]},currency:nullableString,personName:nullableString,category:nullableString,description:{type:"string"},item:nullableString,quantity:{type:["number","null"]},unit:nullableString,estimatedValue:{type:["number","null"]},relatedCatRef:nullableString}}},
 query:{type:"object",additionalProperties:false,required:["kind","catId","status","year","search"],properties:{kind:{type:"string",enum:["none","cats_by_status","cat_history","impact","income_expenses","transactions","cats_by_colony","cats_needing_surgery"]},catId:nullableString,status:nullableString,year:{type:["integer","null"]},search:nullableString}},socialDraft:nullableString
}};

async function callAgent(input:string,mode:string,data:any,photo?:string):Promise<unknown>{
 const openRouterKey=(env as any).OPENROUTER_API_KEY as string|undefined,openAIKey=(env as any).OPENAI_API_KEY as string|undefined;if(!openRouterKey&&!openAIKey)return fallbackPlan(input,mode,data);
 const instructions=`You are Ari's careful cat TNR/rescue record assistant. Convert natural language into the provided action-plan schema. Today is ${now().slice(0,10)}. Use existing IDs only when clues strongly identify exactly one stored record. If multiple cats plausibly match for medical, adoption, disappearance, death, or disposition changes, return intent=clarify, a concise question, and no mutations. Never invent facts, names, amounts, dates, medical procedures, or relationships. Preserve changing conditions as events; use cat fields for stable/current attributes. A single input may create multiple cats, events, people, and transactions. Give each new cat a temporary ref and point its events to that ref. For an existing cat use its stored ID as ref and existingId. For questions choose a query kind and exact cat ID when needed; never create records. For social requests draft only from stored facts. Normalize event types (first_seen, captured, intake, transport, vet_visit, spay, neuter, vaccination, testing, medication, illness, injury, observation, foster, adoption_interest, application, meet_and_greet, adoption, returned_to_colony, lost, deceased, other). Allowed values (anything else is rejected): sex ${SEXES.join("/")}; ageClass ${AGE_CLASSES.join("/")}; transactionType ${TRANSACTION_TYPES.join("/")}; person type ${PERSON_TYPES.join("/")}; currency ${CURRENCIES.join("/")}; dates must be real ISO dates (YYYY-MM-DD) or null; amounts positive with at most two decimals. Never include fields outside the schema. For deleting, merging cats, or changing ownership, return intent=clarify (these are not supported). Valid statuses: ${[...statuses].join(", ")}.`;
 if(openRouterKey){const userContent:any[]= [{type:"text",text:`Mode: ${mode}\nUser input: ${input}\nStored records: ${JSON.stringify(data)}`}];if(photo)userContent.push({type:"image_url",image_url:{url:photo}});const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":"https://github.com/BreRoz/catnr","X-OpenRouter-Title":"TNR Assistant"},body:JSON.stringify({model:(env as any).OPENROUTER_MODEL||"openai/gpt-5-mini",messages:[{role:"system",content:instructions},{role:"user",content:userContent}],response_format:{type:"json_schema",json_schema:{name:"rescue_action_plan",strict:true,schema:planSchema}},provider:{require_parameters:true}})});if(!response.ok)throw new Error(`OpenRouter error ${response.status}`);const result:any=await response.json();const text=result.choices?.[0]?.message?.content;return parseProviderJson(text)}
 const content:any[]=[{type:"input_text",text:`Mode: ${mode}\nUser input: ${input}\nStored records: ${JSON.stringify(data)}`}];if(photo)content.push({type:"input_image",image_url:photo,detail:"low"});const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${openAIKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:(env as any).OPENAI_MODEL||"gpt-5-mini",instructions,input:[{role:"user",content}],text:{format:{type:"json_schema",name:"rescue_action_plan",strict:true,schema:planSchema}}})});if(!response.ok)throw new Error(`OpenAI error ${response.status}`);const result:any=await response.json();const text=result.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==="output_text")?.text;return parseProviderJson(text);
}
function blank():AgentPlan{return{intent:"record",message:"Recorded your update.",clarification:null,confidence:.7,cats:[],events:[],people:[],transactions:[],query:{kind:"none",catId:null,status:null,year:null,search:null},socialDraft:null}}
function fallbackPlan(input:string,mode:string,data:any):AgentPlan{const p=blank(),l=input.toLowerCase();if(mode==="ask"||/^(which|what|how many|show|give me|where)/i.test(input)){p.intent="query";if(/waiting for adoption|available for adoption/.test(l)){p.query.kind="cats_by_status";p.query.status="available for adoption";return p}if(/income|expenses|money came|money spent/.test(l)){p.query.kind="income_expenses";p.query.year=Number(l.match(/20\d{2}/)?.[0]||new Date().getUTCFullYear());return p}if(/how many cats|impact/.test(l)){p.query.kind="impact";p.query.year=Number(l.match(/20\d{2}/)?.[0]||new Date().getUTCFullYear());return p}if(/need.*(surgery|spay|neuter)/.test(l)){p.query.kind="cats_needing_surgery";return p}}
 const matches=data.cats.filter((c:any)=>[c.name,c.appearance,c.sex,c.age_class,c.distinguishing_characteristics,c.origin].filter(Boolean).some(v=>l.includes(String(v).toLowerCase())));if(matches.length===1){const c=matches[0],types=[["spay","spay"],["neuter","neuter"],["rabies","vaccination: rabies"],["fvrcp","vaccination: FVRCP"],["adopt","adoption"],["foster","foster"],["vet","vet_visit"],["sick","illness"],["injur","injury"]].filter(([n])=>l.includes(n)).map(([,t])=>t);p.events=(types.length?types:["observation"]).map(eventType=>({catRef:c.id,eventType,occurredAt:null,location:null,personName:null,notes:input}));p.cats=[{ref:c.id,existingId:c.id,name:null,sex:null,ageClass:null,appearance:null,distinguishingCharacteristics:null,healthObservations:null,reproductiveSignificance:null,origin:null,currentStatus:l.includes("adopt")?"adopted":l.includes("foster")?"foster":null,currentLocation:null,microchipNumber:null}];return p}
 return{...p,intent:"clarify",confidence:.2,clarification:matches.length>1?`I found ${matches.length} possible cats. Which one do you mean: ${matches.slice(0,4).map(display).join(", ")}?`:"I preserved your words, but I need the AI interpreter connected before I can safely structure this update."}}

async function colony(db:D1,owner:string,name:string,created:string[]){const found=await db.prepare("SELECT id FROM colonies WHERE owner_id=? AND LOWER(name)=LOWER(?) LIMIT 1").bind(owner,name).first<any>();if(found)return found.id;const id=makeId("colony");await db.prepare("INSERT INTO colonies(id,owner_id,name,general_location,status,created_at) VALUES(?,?,?,?,?,?)").bind(id,owner,name,name,"active",now()).run();created.push(`colony:${id}`);return id}
async function person(db:D1,owner:string,draft:PersonDraft|null,name:string|null,created:string[],updated:string[]){if(!draft&&!name)return null;if(draft?.existingId){const valid=await db.prepare("SELECT id FROM people WHERE id=? AND owner_id=?").bind(draft.existingId,owner).first();if(!valid)throw new Error("Unknown person");await db.prepare("UPDATE people SET name=COALESCE(?,name),type=COALESCE(?,type),general_location=COALESCE(?,general_location),contact=COALESCE(?,contact) WHERE id=? AND owner_id=?").bind(draft.name,draft.type,draft.generalLocation,draft.contact,draft.existingId,owner).run();updated.push(`person:${draft.existingId}`);return draft.existingId}const personName=draft?.name||name!;const found=await db.prepare("SELECT id FROM people WHERE owner_id=? AND LOWER(name)=LOWER(?) LIMIT 1").bind(owner,personName).first<any>();if(found)return found.id;const id=makeId("person");await db.prepare("INSERT INTO people(id,owner_id,name,type,general_location,contact,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,owner,personName,draft?.type,draft?.generalLocation,draft?.contact,now()).run();created.push(`person:${id}`);return id}
async function execute(db:D1,owner:string,inputId:string,source:string,plan:AgentPlan){const created:string[]=[],updated:string[]=[],refs=new Map<string,string>();if(plan.intent==="clarify")return{created,updated,message:plan.message,clarification:plan.clarification};await checkReferences(db,owner,plan);for(const x of plan.people)await person(db,owner,x,null,created,updated);for(const c of plan.cats){if(c.existingId){const valid=await db.prepare("SELECT id FROM cats WHERE id=? AND owner_id=?").bind(c.existingId,owner).first();if(!valid)throw new Error("Unknown cat");const col=c.origin?await colony(db,owner,c.origin,created):null,status=c.currentStatus&&statuses.has(c.currentStatus)?c.currentStatus:null;await db.prepare("UPDATE cats SET name=COALESCE(?,name),sex=COALESCE(?,sex),age_class=COALESCE(?,age_class),appearance=COALESCE(?,appearance),distinguishing_characteristics=COALESCE(?,distinguishing_characteristics),health_observations=COALESCE(?,health_observations),reproductive_significance=COALESCE(?,reproductive_significance),origin_colony_id=COALESCE(?,origin_colony_id),current_status=COALESCE(?,current_status),current_location=COALESCE(?,current_location),microchip_number=COALESCE(?,microchip_number),updated_at=? WHERE id=? AND owner_id=?").bind(c.name,c.sex,c.ageClass,c.appearance,c.distinguishingCharacteristics,c.healthObservations,c.reproductiveSignificance,col,status,c.currentLocation,c.microchipNumber,now(),c.existingId,owner).run();refs.set(c.ref,c.existingId);refs.set(c.existingId,c.existingId);updated.push(`cat:${c.existingId}`)}else{const id=makeId("cat"),col=c.origin?await colony(db,owner,c.origin,created):null,status=c.currentStatus&&statuses.has(c.currentStatus)?c.currentStatus:"observed";await db.prepare("INSERT INTO cats(id,owner_id,name,sex,age_class,appearance,distinguishing_characteristics,health_observations,reproductive_significance,origin_colony_id,current_status,current_location,microchip_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,owner,c.name,c.sex,c.ageClass,c.appearance,c.distinguishingCharacteristics,c.healthObservations,c.reproductiveSignificance,col,status,c.currentLocation,c.microchipNumber,now(),now()).run();refs.set(c.ref,id);created.push(`cat:${id}`)}}
 for(const e of plan.events){const catId=e.catRef?(refs.get(e.catRef)||e.catRef):null;if(catId&&!await db.prepare("SELECT id FROM cats WHERE id=? AND owner_id=?").bind(catId,owner).first())throw new Error("Unknown event cat");const personId=e.personName?await person(db,owner,null,e.personName,created,updated):null,id=makeId("event");await db.prepare("INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,location,person_id,notes,source_input_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,owner,catId,e.eventType,e.occurredAt||now(),e.location,personId,e.notes||source,inputId,now()).run();created.push(`event:${id}`)}
 for(const t of plan.transactions){if(t.amount!=null&&(!Number.isFinite(t.amount)||t.amount<0))throw new Error("Invalid amount");const personId=t.personName?await person(db,owner,null,t.personName,created,updated):null,catId=t.relatedCatRef?(refs.get(t.relatedCatRef)||t.relatedCatRef):null,id=makeId("txn");await db.prepare("INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount,currency,person_id,category,description,item,quantity,unit,estimated_value,related_cat_id,source_input_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,owner,t.transactionType,t.direction,t.date||now(),t.amount,t.currency||"USD",personId,t.category,t.description,t.item,t.quantity,t.unit,t.estimatedValue,catId,inputId,now()).run();created.push(`transaction:${id}`)}return{created,updated,message:plan.socialDraft||plan.message,clarification:plan.clarification}}

async function answer(db:D1,owner:string,q:QueryDraft){const year=q.year||new Date().getUTCFullYear();if(q.kind==="cats_by_status"){const rows=await db.prepare("SELECT * FROM cats WHERE owner_id=? AND current_status=? ORDER BY updated_at DESC").bind(owner,q.status||"available for adoption").all();return rows.results.length?`${rows.results.length} cat${rows.results.length===1?" is":"s are"} ${q.status||"available for adoption"}: ${rows.results.map(display).join(", ")}.`:`No cats are currently marked ${q.status||"available for adoption"}.`}if(q.kind==="cat_history"&&q.catId){const c=await db.prepare("SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.id=? AND c.owner_id=?").bind(q.catId,owner).first<any>();if(!c)return"I couldn’t find that cat.";const events=await db.prepare("SELECT event_type,occurred_at,notes FROM active_events WHERE owner_id=? AND cat_id=? ORDER BY occurred_at").bind(owner,q.catId).all<any>();return`${display(c)} is currently ${c.current_status}.\n${events.results.map((e:any)=>`${e.occurred_at.slice(0,10)}: ${e.event_type}${e.notes?` — ${e.notes}`:""}`).join("\n")||"No events recorded yet."}`}if(q.kind==="income_expenses"){const rows=await db.prepare("SELECT direction,SUM(amount) total FROM active_transactions WHERE owner_id=? AND amount IS NOT NULL AND substr(date,1,4)=? GROUP BY direction").bind(owner,String(year)).all<any>();const v=Object.fromEntries(rows.results.map((r:any)=>[r.direction,Number(r.total||0)]));return`${year}: $${(v.inflow||0).toFixed(2)} cash in, $${(v.outflow||0).toFixed(2)} cash out, net $${((v.inflow||0)-(v.outflow||0)).toFixed(2)}. Recorded operational data, not audited accounting.`}if(q.kind==="impact"){const s=await db.prepare("SELECT (SELECT COUNT(DISTINCT cat_id) FROM active_events WHERE owner_id=? AND substr(occurred_at,1,4)=? AND cat_id IS NOT NULL) helped,(SELECT COUNT(DISTINCT cat_id) FROM active_events WHERE owner_id=? AND substr(occurred_at,1,4)=? AND (LOWER(event_type) LIKE '%spay%' OR LOWER(event_type) LIKE '%neuter%')) sterilized,(SELECT COUNT(DISTINCT cat_id) FROM active_events WHERE owner_id=? AND substr(occurred_at,1,4)=? AND LOWER(event_type) LIKE '%vaccin%') vaccinated,(SELECT COUNT(DISTINCT cat_id) FROM active_events WHERE owner_id=? AND substr(occurred_at,1,4)=? AND LOWER(event_type) IN ('adoption','adopted')) adopted").bind(owner,String(year),owner,String(year),owner,String(year),owner,String(year)).first<any>();return`${year} recorded impact: ${s?.helped||0} cats with activity, ${s?.sterilized||0} sterilized, ${s?.vaccinated||0} vaccinated, ${s?.adopted||0} adopted.`}if(q.kind==="cats_needing_surgery"){const rows=await db.prepare("SELECT c.* FROM cats c WHERE c.owner_id=? AND c.current_status NOT IN ('adopted','returned to colony','deceased') AND NOT EXISTS(SELECT 1 FROM active_events e WHERE e.cat_id=c.id AND e.owner_id=c.owner_id AND (LOWER(e.event_type) LIKE '%spay%' OR LOWER(e.event_type) LIKE '%neuter%'))").bind(owner).all();return rows.results.length?`${rows.results.length} cats have no recorded spay/neuter event: ${rows.results.map(display).join(", ")}.`:"Every active cat has a recorded spay/neuter event."}if(q.kind==="cats_by_colony"){const x=`%${q.search||""}%`,rows=await db.prepare("SELECT c.* FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND LOWER(co.name) LIKE LOWER(?)").bind(owner,x).all();return`${rows.results.length} cats found: ${rows.results.map(display).join(", ")||"none"}.`}if(q.kind==="transactions"){const x=`%${q.search||""}%`,rows=await db.prepare("SELECT t.*,p.name person_name FROM active_transactions t LEFT JOIN people p ON p.id=t.person_id AND p.owner_id=t.owner_id WHERE t.owner_id=? AND (LOWER(t.description) LIKE LOWER(?) OR LOWER(COALESCE(t.category,'')) LIKE LOWER(?) OR LOWER(COALESCE(p.name,'')) LIKE LOWER(?)) ORDER BY t.date DESC LIMIT 50").bind(owner,x,x,x).all<any>();return`${rows.results.length} matching resource records totaling $${rows.results.reduce((sum:number,r:any)=>sum+Number(r.amount||r.estimated_value||0),0).toFixed(2)}.`}return"I couldn’t turn that into a database question yet."}

export async function GET(req:Request){const owner=ownerFrom(req);if(!owner)return unauthorized();const db=env.DB;const url=new URL(req.url),photoId=url.searchParams.get("photoId");if(photoId){const photo=await db.prepare("SELECT storage_location FROM photos WHERE id=? AND owner_id=?").bind(photoId,owner).first<any>();if(!photo)return new Response("Not found",{status:404});if(photo.storage_location.startsWith("data:image/")){const [header,data]=photo.storage_location.split(",");return new Response(Uint8Array.from(atob(data),c=>c.charCodeAt(0)),{headers:{"content-type":header.slice(5).split(";")[0],"cache-control":"private, no-store"}})}if(!photo.storage_location.startsWith(`cats/${encodeURIComponent(owner)}/`))return new Response("Not found",{status:404});const bucket=(env as any).PHOTOS;if(!bucket)return new Response("Not found",{status:404});const object=await bucket.get(photo.storage_location);if(!object)return new Response("Not found",{status:404});return new Response(object.body,{headers:{"content-type":object.httpMetadata?.contentType||"image/jpeg","cache-control":"private, no-store"}})}if(url.searchParams.has("clarifications"))return Response.json({clarifications:await listPending(db,owner)},{headers:{"cache-control":"no-store"}});if(url.searchParams.has("corrections"))return Response.json({corrections:await listCorrections(db,owner,url.searchParams.get("recordId"))},{headers:{"cache-control":"no-store"}});const catId=url.searchParams.get("catId");if(catId){const cat=await db.prepare("SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.id=? AND c.owner_id=?").bind(catId,owner).first<any>();if(!cat)return Response.json({message:"Cat not found."},{status:404});const [events,photos]=await Promise.all([db.prepare("SELECT e.*,p.name person_name FROM active_events e LEFT JOIN people p ON p.id=e.person_id AND p.owner_id=e.owner_id WHERE e.owner_id=? AND e.cat_id=? ORDER BY e.occurred_at DESC").bind(owner,catId).all(),db.prepare("SELECT id,taken_at,caption FROM photos WHERE owner_id=? AND cat_id=? ORDER BY taken_at DESC").bind(owner,catId).all()]);return Response.json({cat:{...cat,displayName:display(cat)},events:events.results,photos:photos.results})}const [cats,memories,stats]=await Promise.all([db.prepare("SELECT c.*,co.name origin,(SELECT COUNT(*) FROM active_events e WHERE e.cat_id=c.id AND e.owner_id=c.owner_id) events,(SELECT id FROM photos p WHERE p.cat_id=c.id AND p.owner_id=c.owner_id ORDER BY taken_at DESC LIMIT 1) photo_id FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? ORDER BY c.updated_at DESC").bind(owner).all<any>(),db.prepare("SELECT id,'event' recordType,event_type kind,COALESCE((SELECT name FROM cats WHERE id=cat_id AND cats.owner_id=active_events.owner_id),event_type) title,notes detail,created_at createdAt,version,(SELECT id FROM corrections c WHERE c.owner_id=active_events.owner_id AND c.replacement_id=active_events.id AND c.kind='correction' AND c.status='applied') correctionId FROM active_events WHERE owner_id=? UNION ALL SELECT id,'transaction',CASE WHEN transaction_type='in_kind_donation' THEN 'in-kind' WHEN direction='inflow' THEN 'income' ELSE 'expense' END,description,CASE WHEN amount IS NOT NULL THEN '$'||printf('%.2f',amount)||' · '||COALESCE(category,'') ELSE COALESCE(CAST(quantity AS TEXT)||' '||unit||' · '||item,'Resource') END,created_at,version,(SELECT id FROM corrections c WHERE c.owner_id=active_transactions.owner_id AND c.replacement_id=active_transactions.id AND c.kind='correction' AND c.status='applied') correctionId FROM active_transactions WHERE owner_id=? ORDER BY createdAt DESC LIMIT 50").bind(owner,owner).all(),db.prepare("SELECT (SELECT COUNT(*) FROM cats WHERE owner_id=?) catsRecorded,(SELECT COUNT(*) FROM cats WHERE owner_id=? AND current_status='adopted') catsFoundHomes,(SELECT COUNT(DISTINCT cat_id) FROM active_events WHERE owner_id=? AND cat_id IS NOT NULL AND (LOWER(event_type) LIKE '%spay%' OR LOWER(event_type) LIKE '%neuter%')) spayedNeutered,(SELECT COUNT(DISTINCT cat_id) FROM active_events WHERE owner_id=? AND cat_id IS NOT NULL AND LOWER(event_type) LIKE '%vaccin%') vaccinated,(SELECT COALESCE(SUM(amount),0) FROM active_transactions WHERE owner_id=? AND direction='inflow') cashIn,(SELECT COALESCE(SUM(amount),0) FROM active_transactions WHERE owner_id=? AND direction='outflow') cashOut").bind(owner,owner,owner,owner,owner,owner).first()]);return Response.json({revision:await revision(db,owner),cats:cats.results.map((c:any)=>({id:c.id,displayName:c.name||"",description:[c.appearance,c.sex,c.age_class,c.origin].filter(Boolean).join(" · "),status:c.current_status,origin:c.origin,events:c.events,photoId:c.photo_id})),memories:memories.results,stats})}
const PROPOSAL_TTL_MS=24*60*60*1000;
const rejectedPlan=()=>Response.json({outcome:"rejected",message:"I couldn’t safely turn that into an update, so nothing was changed. Your words are still here — try rewording it or adding detail."},{status:422,headers:{"cache-control":"no-store"}});
const refuse=(message:string,status:number,outcome="rejected")=>Response.json({outcome,message},{status,headers:{"cache-control":"no-store"}});
type Correction={recordType:"event"|"transaction";id:string;version:number;reason:string};
// Four separate states: question (read-only) → proposed action (stored, inert) → approved action (Ari confirms) → executed action (one atomic batch).
async function write(req:Request,patch:boolean){
 const owner=ownerFrom(req);if(!owner)return unauthorized();const db=env.DB;
 let key="",hash="",commitAttempted=false;
 try{
  const body=await req.json() as any;
  if(!body||typeof body!=="object"||Array.isArray(body))return refuse("Invalid request.",400);
  const confirmId=!patch&&body.confirmProposalId!=null?body.confirmProposalId:null;
  if(confirmId!==null&&(typeof confirmId!=="string"||!confirmId))return refuse("Invalid confirmation.",400);
  const clarifyId=!patch&&body.clarificationId!=null?body.clarificationId:null;
  if(clarifyId!==null&&(typeof clarifyId!=="string"||!clarifyId||confirmId))return refuse("Invalid answer.",400);
  const sessionId=typeof body.sessionId==="string"&&body.sessionId.length<=100?body.sessionId:null;
  const content=JSON.stringify({method:patch?"PATCH":"POST",input:body.input,mode:body.mode,photoName:body.photoName,photoDataUrl:body.photoDataUrl,id:body.id,recordType:body.recordType,correction:body.correction,version:body.version,confirmProposalId:confirmId,clarificationId:clarifyId});
  hash=await digest(content);key=body.requestKey||hash;
  if(typeof key!=="string"||key.length>200)return Response.json({message:"Invalid retry key."},{status:400});
  const saved=await receipt(db,owner,key,hash);if(saved)return saved;
  const base=await revision(db,owner);
  let proposal:any=null,corr:Correction|null=null;
  if(confirmId){
   proposal=await db.prepare("SELECT * FROM proposed_actions WHERE id=? AND owner_id=?").bind(confirmId,owner).first<any>();
   if(!proposal)return refuse("I couldn’t find that pending change.",404);
   if(proposal.status!=="proposed")return refuse("That change was already handled.",409,"conflict");
   if(proposal.expires_at<now())return refuse("That change expired. Tell me again and I’ll re-check it.",409,"conflict");
   if(proposal.kind==="correction")corr=JSON.parse(proposal.correction_target);
  }else if(patch){
   if(!body.id||typeof body.id!=="string"||typeof body.correction!=="string"||!body.correction.trim()||!["event","transaction"].includes(body.recordType))return Response.json({message:"Correction details are required."},{status:400});
   corr={recordType:body.recordType,id:body.id,version:body.version,reason:body.correction.trim()};
  }
  // An answer is bound to exactly one pending question by its id; it is never matched by guessing.
  let clar:any=null,clarCands:Candidate[]=[];
  if(clarifyId){
   if(typeof body.input!=="string"||!body.input.trim()||body.input.length>2000)return refuse("Tell me your answer first.",400);
   const loaded=await loadForAnswer(db,owner,clarifyId);
   if("error" in loaded)return refuse(loaded.error,loaded.status,loaded.outcome);
   clar=loaded.row;clarCands=loaded.candidates;
  }
  let original:any=null;
  if(corr){
   original=await db.prepare(`SELECT * FROM ${corr.recordType==="event"?"events":"transactions"} WHERE id=? AND owner_id=?`).bind(corr.id,owner).first<any>();
   if(!original)return Response.json({message:"Activity record not found."},{status:404});
   if(original.superseded_at)return Response.json({outcome:"conflict",message:"This activity was already corrected. Refresh to correct the latest version."},{status:409});
   if(corr.version!==original.version)return Response.json({outcome:"conflict",message:"This activity changed. Refresh and review the latest version before correcting it."},{status:409});
  }else if(!confirmId&&!body.input?.trim()&&!body.photoDataUrl)return Response.json({message:"Tell me what happened or add a photo first."},{status:400});
  let photo:string|null;
  try{photo=clarifyId?null:validatedPhoto(body.photoDataUrl)}catch(e){return Response.json({outcome:"rejected",message:(e as Error).message},{status:400})}
  // The photo belongs to the pending question, not to this request.
  if(clar)photo=clar.photo_data;
  if(proposal&&proposal.photo_digest&&!photo){
   // A photo that arrived with a clarified update is kept with that update, so Ari need not re-add it.
   const kept=await db.prepare("SELECT photo_data FROM clarifications WHERE input_id=? AND owner_id=? AND photo_data IS NOT NULL").bind(proposal.input_id,owner).first<any>();
   if(kept)photo=kept.photo_data;
  }
  if(proposal){
   if(proposal.photo_digest&&(!photo||await digest(photo)!==proposal.photo_digest))return refuse("Add the same photo again to confirm this change.",400);
   if(!proposal.photo_digest)photo=null;
  }
  let inputRow:any=null;
  if(proposal){inputRow=await db.prepare("SELECT transcription FROM ai_inputs WHERE id=? AND owner_id=?").bind(proposal.input_id,owner).first<any>();if(!inputRow)return refuse("The original words for this change are missing.",409,"conflict")}
  const source=corr?`Correct this ${corr.recordType}. Original record: ${JSON.stringify(original)}. Complete corrected version from Ari: ${corr.reason}`:proposal?inputRow.transcription:clar?clar.original_text:body.input?.trim()||`Photo added: ${body.photoName||"cat photo"}`;
  const data=await snapshot(db,owner);
  // Detect any changes made while collecting the interpreter's snapshot.
  if(await revision(db,owner)!==base)throw new Error("Concurrent edit");
  const statusSet=statuses,mode=corr?"correction":clar?clar.mode:body.mode||"text",agentInput=clar?answerPrompt(clar,clarCands,body.input.trim()):source;
  // A stored proposal is re-validated exactly like fresh provider output; it is never trusted because it was stored.
  const interpreted=validateProviderPlan(proposal?JSON.parse(proposal.plan):await callAgent(agentInput,mode,data,photo||undefined),{statuses:statusSet,mode:clar?clar.mode:body.mode});
  await checkReferences(db,owner,interpreted);
  let plan=interpreted;
  // Identity is uncertain: ask, and change nothing.
  let unsure=corr?null:ambiguity(interpreted,data.cats as StoredCat[]);
  if(!unsure&&clar&&clarCands.length&&interpreted.intent==="record"){
   // The answer must pick among the cats the question was about.
   const picked=referencedCats(interpreted);
   if(!picked.length||picked.some(id=>!clarCands.some(c=>c.id===id)))unsure=`That doesn’t match the cats I asked about (${clarCands.map(c=>c.label).join("; ")}). Which one did you mean? I haven't changed anything yet.`;
  }
  if(unsure)plan={...interpreted,intent:"clarify",message:unsure,clarification:unsure,cats:[],events:[],people:[],transactions:[]};
  if(corr&&(plan.intent!=="record"||!(corr.recordType==="event"?plan.events.length:plan.transactions.length)))return Response.json({outcome:"clarification",message:plan.message,clarification:plan.clarification||"Please describe the corrected activity."},{status:409});
  let correctionCats=new Map<string,any>();
  if(corr){
   // The replacement must be a faithful one-for-one swap; keep the original date when the interpreter omits one.
   const checked=await checkCorrectionPlan(db,owner,corr.recordType,original,plan);
   if("error" in checked)return Response.json({outcome:"clarification",message:checked.error,clarification:checked.error},{status:checked.status});
   correctionCats=checked.cats;
   if(corr.recordType==="event")plan.events[0].occurredAt||=original.occurred_at;else plan.transactions[0].date||=original.date;
  }
  // Consequential changes are only proposed until Ari approves them.
  const reasons=proposal?[]:consequences(plan,{correctionOf:corr?.recordType==="transaction"?"transaction":null});
  const proposing=reasons.length>0,executing=!proposing&&plan.intent==="record";
  const inputId=proposal?proposal.input_id:clar?clar.input_id:makeId("input"),createdAt=now(),pending=pendingWrites(db),queued=pending.db;
  if(!proposal&&!clar)await queued.prepare("INSERT INTO ai_inputs(id,owner_id,transcription,input_type,interpretation,confidence,correction,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(inputId,owner,corr?corr.reason:source,mode,JSON.stringify(interpreted),interpreted.confidence,original?JSON.stringify(original):null,createdAt).run();
  let result={created:[] as string[],updated:[] as string[],message:plan.message,clarification:plan.clarification};
  const answerInputId=clar?makeId("input"):null;
  if(clar)await queued.prepare("INSERT INTO ai_inputs(id,owner_id,transcription,input_type,interpretation,confidence,created_at) VALUES(?,?,?,?,?,?,?)").bind(answerInputId,owner,body.input.trim(),"clarification_answer",JSON.stringify(interpreted),interpreted.confidence,createdAt).run();
  let proposalId:string|undefined,clarificationId:string|undefined;
  if(proposing){
   proposalId=makeId("proposal");
   await queued.prepare("INSERT INTO proposed_actions(id,owner_id,input_id,kind,plan,reasons,correction_target,photo_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(proposalId,owner,inputId,corr?"correction":"record",JSON.stringify(plan),JSON.stringify(reasons),corr?JSON.stringify(corr):null,photo?await digest(photo):null,createdAt,new Date(Date.parse(createdAt)+PROPOSAL_TTL_MS).toISOString()).run();
   result.message=`${plan.message} I haven’t saved anything yet — this needs your OK: ${reasons.join("; ")}.`;
  }
  else if(plan.intent==="query")result.message=await answer(db,owner,plan.query);
  else if(executing)result=await execute(queued,owner,inputId,source,plan);
  else if(plan.intent==="social")result.message=plan.socialDraft||plan.message;
  if(plan.intent==="clarify"&&!corr&&!proposal&&!clar&&((env as any).OPENROUTER_API_KEY||(env as any).OPENAI_API_KEY)){
   // Keep everything needed to finish this update once Ari answers.
   clarificationId=makeId("clarify");
   await queueClarification(queued,{id:clarificationId,owner,inputId,sessionId,mode,original:source,question:plan.clarification||plan.message,candidates:candidatesFor(interpreted,data.cats as any[],display),plan:interpreted,photoName:body.photoName||null,photo,createdAt});
  }
  if(clar){
   const link={clarificationId:clar.id,owner,answerInputId:answerInputId!,question:clar.question,answer:body.input.trim(),createdAt,answerId:makeId("answer")};
   if(plan.intent==="clarify")for(const q of queueStillAmbiguous(queued,{...link,newQuestion:plan.clarification||plan.message}))await q;
   else for(const q of queueResolved(queued,link))await q;
  }
  let photoSaved=false;
  if(photo&&executing){
   const event=result.created.find(x=>x.startsWith("event:"))?.slice(6)||null,cat=(result.created.find(x=>x.startsWith("cat:"))||result.updated.find(x=>x.startsWith("cat:")))?.slice(4)||(corr&&event&&plan.events[0].catRef?plan.cats.find(c=>c.ref===plan.events[0].catRef)?.existingId||plan.events[0].catRef:null)||null;
   if(!cat&&!event)throw new Error("Photo has no record association");
   const id=makeId("photo");
   await queued.prepare("INSERT INTO photos(id,owner_id,cat_id,event_id,storage_location,taken_at,caption) VALUES(?,?,?,?,?,?,?)").bind(id,owner,cat,event,photo,createdAt,source).run();result.created.push(`photo:${id}`);photoSaved=true;
  }
  let correctionId:string|undefined;
  if(corr&&executing){
   // Nothing is deleted: the original is superseded, linked to its replacement and kept in the audit trail.
   const replacementId=result.created.find(x=>x.startsWith(`${corr.recordType}:`))!.slice(corr.recordType.length+1);
   const queuedCorrection=await queueCorrection(db,queued,{owner,recordType:corr.recordType,original,plan,inputId,replacementId,reason:corr.reason,cats:correctionCats,now:createdAt});
   correctionId=queuedCorrection.correctionId;
   result.updated.push(`superseded:${corr.recordType}:${corr.id}`,`correction:${correctionId}`);
  }
  if(proposal){
   // The unique execution row makes a second approval of the same proposal fail the whole batch.
   await queued.prepare("INSERT INTO proposal_executions(proposal_id,owner_id,executed_at) VALUES(?,?,?)").bind(proposal.id,owner,createdAt).run();
   await queued.prepare("UPDATE proposed_actions SET status='executed',decided_at=?,decided_by=? WHERE id=? AND owner_id=?").bind(createdAt,owner,proposal.id,owner).run();
  }
  await queued.prepare("UPDATE ai_inputs SET clarification=?,records_created=?,records_updated=? WHERE id=? AND owner_id=?").bind(result.clarification,JSON.stringify(result.created),JSON.stringify(result.updated),inputId,owner).run();
  const response={...result,correctionId,photoSaved,proposalId,clarificationId:clarificationId||(clar&&plan.intent==="clarify"?clar.id:undefined),answeredClarification:clar&&plan.intent!=="clarify"?clar.id:undefined,reasons:proposing?reasons:undefined,confirmed:proposal?true:undefined,outcome:proposing?"needs_confirmation":plan.intent==="record"?"committed":plan.intent==="clarify"?"clarification":"answered"};
  commitAttempted=true;
  await commit(db,owner,key,hash,base,pending.statements,response);
  return Response.json(response);
 }catch(error){
  if(error instanceof PlanRejected)return rejectedPlan();
  // A lost response or competing retry may have committed this same request.
  if(key&&hash)try{const saved=await receipt(db,owner,key,hash);if(saved)return saved}catch{/* The receipt lookup is unavailable; retain the retry key and input. */}
  return writeFailure(error,commitAttempted);
 }
}
export async function POST(req:Request){return write(req,false)}
export async function PATCH(req:Request){return write(req,true)}
// Undo a correction: restores the original activity and the cat fields the correction changed.
export async function DELETE(req:Request){
 const owner=ownerFrom(req);if(!owner)return unauthorized();const db=env.DB;
 let key="",hash="",commitAttempted=false;
 try{
  const body=await req.json() as any;
  if(body?.rejectProposalId!=null){
   // Dismissing a proposal changes no rescue records; it only closes the pending change.
   if(typeof body.rejectProposalId!=="string")return Response.json({message:"Invalid request."},{status:400});
   const closed=await db.prepare("UPDATE proposed_actions SET status='rejected',decided_at=?,decided_by=? WHERE id=? AND owner_id=? AND status='proposed'").bind(now(),owner,body.rejectProposalId,owner).run();
   return (closed as any).meta?.changes===0||(closed as any).changes===0?Response.json({outcome:"conflict",message:"That change was already handled."},{status:409}):Response.json({outcome:"dismissed",message:"Okay, I didn’t make that change."});
  }
  if(body?.cancelClarificationId!=null){
   // Cancelling closes the question only; the original words stay in the audit trail and nothing else changes.
   if(typeof body.cancelClarificationId!=="string")return Response.json({message:"Invalid request."},{status:400});
   return await cancelClarification(db,owner,body.cancelClarificationId)?Response.json({outcome:"cancelled",message:"Okay, I dropped that question and didn’t change anything."}):Response.json({outcome:"conflict",message:"That question was already closed."},{status:409});
  }
  if(typeof body.correctionId!=="string"||!body.correctionId)return Response.json({message:"Choose a correction to undo."},{status:400});
  hash=await digest(JSON.stringify({method:"DELETE",correctionId:body.correctionId}));key=body.requestKey||hash;
  if(typeof key!=="string"||key.length>200)return Response.json({message:"Invalid retry key."},{status:400});
  const saved=await receipt(db,owner,key,hash);if(saved)return saved;
  const base=await revision(db,owner),checked=await checkUndo(db,owner,body.correctionId);
  if("error" in checked)return Response.json({outcome:"rejected",message:checked.error},{status:checked.status});
  if(await revision(db,owner)!==base)throw new Error("Concurrent edit");
  const pending=pendingWrites(db),undone=await queueUndo(db,pending.db,owner,checked,now());
  const response={outcome:"undone",correctionId:undone.undoId,revertedCorrectionId:body.correctionId,message:"Correction undone. The original activity is back."};
  commitAttempted=true;
  await commit(db,owner,key,hash,base,pending.statements,response);
  return Response.json(response);
 }catch(error){
  if(key&&hash)try{const saved=await receipt(db,owner,key,hash);if(saved)return saved}catch{/* Retain the retry key. */}
  return writeFailure(error,commitAttempted);
 }
}
