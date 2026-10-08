import { env } from "cloudflare:workers";
import { DEFAULT_CURRENCY, formatMoney, formatTotals, toMinorUnits } from "../../money";
import { answerPrompt, candidatesFor, cancel as cancelClarification, listPending, loadForAnswer, queueClarification, queueResolved, queueStillAmbiguous, referencedCats, type Candidate, type ClarificationRow } from "./clarifications";
import { checkCorrectionPlan, checkUndo, listCorrections, queueCorrection, queueUndo } from "./corrections";
import { pendingWrites, digest, receipt, revision, validatedPhoto, commit, writeFailure, providerFetch, AiUnavailable, AiLimited } from "./reliability";
import { recordEvent, finishEvent } from "../../ops/log";
import { checkAi, photoRefusal } from "../../ops/limits";
import { buildReport, reportSentences, surgeryStatus } from "../../reports/queries";
import { yearPeriod } from "../../reports/definitions";
import { PlanRejected, ambiguity, checkReferences, consequences, parseProviderJson, validateProviderPlan, TRANSACTION_TYPES, SEXES, AGE_CLASSES, PERSON_TYPES, CURRENCIES, type StoredCat } from "./validation";

type D1 = D1Database;
type CatRow = { id: string; name: string | null; sex: string | null; age_class: string | null; appearance: string | null; distinguishing_characteristics: string | null; current_status: string | null; origin: string | null; origin_colony_id: string | null; [column: string]: string | number | null | undefined };
type ProposalRow = { id: string; input_id: string; kind: string; plan: string; correction_target: string | null; photo_digest: string | null; status: string; expires_at: string };
type EventOrTxnRow = { date?: string; occurred_at?: string; superseded_at: string | null; version: number; [column: string]: string | number | null | undefined };
// Untrusted JSON from the client: every field is optional and checked before use.
type RequestBody = { input: string; mode?: string; sessionId?: string; requestKey?: string; photoDataUrl?: string; photoName?: string; confirmProposalId?: string; rejectProposalId?: string; clarificationId?: string; cancelClarificationId?: string; correction?: string; correctionId?: string; id?: string; recordType?: "event" | "transaction"; version: number };
type TxnRow = { transaction_type: string; direction: string; currency: string; amount_minor: number | null; estimated_value_minor: number | null };
type Snapshot = { cats: CatRow[]; people: Record<string, unknown>[]; recentEvents: Record<string, unknown>[] };
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
const display=(c:Partial<CatRow>)=>String(c.name||[c.distinguishing_characteristics,c.appearance,c.sex,c.age_class].filter(Boolean).join(" ")||"Unnamed cat");
async function snapshot(db:D1,owner:string):Promise<Snapshot>{const [cats,people,recentEvents]=await Promise.all([db.prepare("SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND c.archived_at IS NULL ORDER BY c.updated_at DESC LIMIT 150").bind(owner).all<CatRow>(),db.prepare("SELECT id,name,type,general_location,contact FROM people WHERE owner_id=? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 100").bind(owner).all(),db.prepare("SELECT id,cat_id,event_type,occurred_at,location,notes FROM active_events WHERE owner_id=? ORDER BY occurred_at DESC LIMIT 120").bind(owner).all()]);return{cats:cats.results,people:people.results,recentEvents:recentEvents.results}}

const nullableString={type:["string","null"]};
const planSchema:Record<string,unknown>={type:"object",additionalProperties:false,required:["intent","message","clarification","confidence","cats","events","people","transactions","query","socialDraft"],properties:{
 intent:{type:"string",enum:["record","query","clarify","social"]},message:{type:"string"},clarification:nullableString,confidence:{type:"number"},
 cats:{type:"array",items:{type:"object",additionalProperties:false,required:["ref","existingId","name","sex","ageClass","appearance","distinguishingCharacteristics","healthObservations","reproductiveSignificance","origin","currentStatus","currentLocation","microchipNumber"],properties:{ref:{type:"string"},existingId:nullableString,name:nullableString,sex:nullableString,ageClass:nullableString,appearance:nullableString,distinguishingCharacteristics:nullableString,healthObservations:nullableString,reproductiveSignificance:nullableString,origin:nullableString,currentStatus:nullableString,currentLocation:nullableString,microchipNumber:nullableString}}},
 events:{type:"array",items:{type:"object",additionalProperties:false,required:["catRef","eventType","occurredAt","location","personName","notes"],properties:{catRef:nullableString,eventType:{type:"string"},occurredAt:nullableString,location:nullableString,personName:nullableString,notes:nullableString}}},
 people:{type:"array",items:{type:"object",additionalProperties:false,required:["ref","existingId","name","type","generalLocation","contact"],properties:{ref:{type:"string"},existingId:nullableString,name:{type:"string"},type:nullableString,generalLocation:nullableString,contact:nullableString}}},
 transactions:{type:"array",items:{type:"object",additionalProperties:false,required:["transactionType","direction","date","amount","currency","personName","category","description","item","quantity","unit","estimatedValue","relatedCatRef"],properties:{transactionType:{type:"string",enum:[...TRANSACTION_TYPES]},direction:{type:"string",enum:["inflow","outflow"]},date:nullableString,amount:{type:["number","null"]},currency:nullableString,personName:nullableString,category:nullableString,description:{type:"string"},item:nullableString,quantity:{type:["number","null"]},unit:nullableString,estimatedValue:{type:["number","null"]},relatedCatRef:nullableString}}},
 query:{type:"object",additionalProperties:false,required:["kind","catId","status","year","search"],properties:{kind:{type:"string",enum:["none","cats_by_status","cat_history","impact","income_expenses","transactions","cats_by_colony","cats_needing_surgery"]},catId:nullableString,status:nullableString,year:{type:["integer","null"]},search:nullableString}},socialDraft:nullableString
}};

async function callAgent(input:string,mode:string,data:Snapshot,photo?:string):Promise<unknown>{
 const openRouterKey=env.OPENROUTER_API_KEY as string|undefined,openAIKey=env.OPENAI_API_KEY as string|undefined;if(!openRouterKey&&!openAIKey)return fallbackPlan(input,mode,data);
 const instructions=`You are Ari's careful cat TNR/rescue record assistant. Convert natural language into the provided action-plan schema. Today is ${now().slice(0,10)}. Use existing IDs only when clues strongly identify exactly one stored record. If multiple cats plausibly match for medical, adoption, disappearance, death, or disposition changes, return intent=clarify, a concise question, and no mutations. Never invent facts, names, amounts, dates, medical procedures, or relationships. Never infer surgery status: record surgery_needed only when told the cat still needs spay/neuter, previously_sterilized only when told it is already fixed (e.g. ear-tipped), and spay/neuter only for surgery that happened; if surgery history is not stated, record nothing about it. Preserve changing conditions as events; use cat fields for stable/current attributes. A single input may create multiple cats, events, people, and transactions. Give each new cat a temporary ref and point its events to that ref. For an existing cat use its stored ID as ref and existingId. For questions choose a query kind and exact cat ID when needed; never create records. For social requests draft only from stored facts. Normalize event types (first_seen, captured, intake, transport, vet_visit, spay, neuter, vaccination, testing, medication, surgery_needed, previously_sterilized, illness, injury, observation, foster, adoption_interest, application, meet_and_greet, adoption, returned_to_colony, lost, deceased, other). Allowed values (anything else is rejected): sex ${SEXES.join("/")}; ageClass ${AGE_CLASSES.join("/")}; transactionType ${TRANSACTION_TYPES.join("/")}; person type ${PERSON_TYPES.join("/")}; currency ${CURRENCIES.join("/")}; dates must be real ISO dates (YYYY-MM-DD) or null; amounts positive with at most two decimals. Never include fields outside the schema. For deleting, merging cats, or changing ownership, return intent=clarify (these are not supported). Valid statuses: ${[...statuses].join(", ")}.`;
 if(openRouterKey){const userContent:Record<string,unknown>[]= [{type:"text",text:`Mode: ${mode}\nUser input: ${input}\nStored records: ${JSON.stringify(data)}`}];if(photo)userContent.push({type:"image_url",image_url:{url:photo}});const response=await providerFetch(env.ENVIRONMENT==="e2e"&&env.AI_TEST_BASE_URL?env.AI_TEST_BASE_URL:"https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":"https://github.com/BreRoz/catnr","X-OpenRouter-Title":"TNR Assistant"},body:JSON.stringify({model:env.OPENROUTER_MODEL||"openai/gpt-5-mini",messages:[{role:"system",content:instructions},{role:"user",content:userContent}],response_format:{type:"json_schema",json_schema:{name:"rescue_action_plan",strict:true,schema:planSchema}},provider:{require_parameters:true}})},"OpenRouter");const result=await response.json() as {choices?:{message?:{content?:string}}[]};const text=result.choices?.[0]?.message?.content;return parseProviderJson(text)}
 const content:Record<string,unknown>[]=[{type:"input_text",text:`Mode: ${mode}\nUser input: ${input}\nStored records: ${JSON.stringify(data)}`}];if(photo)content.push({type:"input_image",image_url:photo,detail:"low"});const response=await providerFetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${openAIKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:env.OPENAI_MODEL||"gpt-5-mini",instructions,input:[{role:"user",content}],text:{format:{type:"json_schema",name:"rescue_action_plan",strict:true,schema:planSchema}}})},"OpenAI");const result=await response.json() as {output?:{content?:{type:string;text?:string}[]}[]};const text=result.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;return parseProviderJson(text);
}
// Every provider call goes through here: it enforces the usage limits and the emergency switch, records the attempt
// BEFORE calling (so a crash or a loop is still counted), and records how it ended. No rescue content is logged.
async function monitoredAgent(db:D1,owner:string,input:string,mode:string,data:Parameters<typeof callAgent>[2],photo?:string):Promise<unknown>{
 const vars=env as unknown as Record<string,string|undefined>,configured=!!(vars.OPENROUTER_API_KEY||vars.OPENAI_API_KEY);
 const gate=await checkAi(db,owner,vars.AI_DISABLED);
 if(!gate.ok){
  await recordEvent(db,{kind:"limit_hit",owner,route:"/api/assistant",status:gate.status,detail:gate.detail});
  // Switched off on purpose: behave exactly as when no provider is configured (simple text and questions still work).
  if(gate.kind==="disabled")return fallbackPlan(input,mode,data);
  throw new AiLimited(gate.message,gate.status);
 }
 if(!configured)return callAgent(input,mode,data,photo);
 const id=await recordEvent(db,{kind:"ai_call",owner,route:"/api/assistant",detail:photo?"text+photo":"text"}),started=Date.now();
 try{const plan=await callAgent(input,mode,data,photo);await finishEvent(db,id,Date.now()-started,200);return plan}
 catch(error){
  const unreachable=error instanceof AiUnavailable;
  await finishEvent(db,id,Date.now()-started,unreachable?502:422);
  // An answer that fails validation is recorded once, by the request's own error handler.
  if(error instanceof PlanRejected)throw error;
  await recordEvent(db,{kind:unreachable?"ai_failure":"ai_invalid",owner,route:"/api/assistant",durationMs:Date.now()-started,detail:error});
  throw error;
 }
}
function blank():AgentPlan{return{intent:"record",message:"Recorded your update.",clarification:null,confidence:.7,cats:[],events:[],people:[],transactions:[],query:{kind:"none",catId:null,status:null,year:null,search:null},socialDraft:null}}
function fallbackPlan(input:string,mode:string,data:Snapshot):AgentPlan{const p=blank(),l=input.toLowerCase();if(mode==="ask"||/^(which|what|how many|show|give me|where)/i.test(input)){p.intent="query";if(/waiting for adoption|available for adoption/.test(l)){p.query.kind="cats_by_status";p.query.status="available for adoption";return p}if(/income|expenses|money came|money spent/.test(l)){p.query.kind="income_expenses";p.query.year=Number(l.match(/20\d{2}/)?.[0]||new Date().getUTCFullYear());return p}if(/how many cats|impact/.test(l)){p.query.kind="impact";p.query.year=Number(l.match(/20\d{2}/)?.[0]||new Date().getUTCFullYear());return p}if(/need.*(surgery|spay|neuter)/.test(l)){p.query.kind="cats_needing_surgery";return p}}
 const matches=data.cats.filter(c=>[c.name,c.appearance,c.sex,c.age_class,c.distinguishing_characteristics,c.origin].filter(Boolean).some(v=>l.includes(String(v).toLowerCase())));if(matches.length===1){const c=matches[0],types=[["spay","spay"],["neuter","neuter"],["rabies","vaccination: rabies"],["fvrcp","vaccination: FVRCP"],["adopt","adoption"],["foster","foster"],["vet","vet_visit"],["sick","illness"],["injur","injury"]].filter(([n])=>l.includes(n)).map(([,t])=>t);p.events=(types.length?types:["observation"]).map(eventType=>({catRef:c.id,eventType,occurredAt:null,location:null,personName:null,notes:input}));p.cats=[{ref:c.id,existingId:c.id,name:null,sex:null,ageClass:null,appearance:null,distinguishingCharacteristics:null,healthObservations:null,reproductiveSignificance:null,origin:null,currentStatus:l.includes("adopt")?"adopted":l.includes("foster")?"foster":null,currentLocation:null,microchipNumber:null}];return p}
 return{...p,intent:"clarify",confidence:.2,clarification:matches.length>1?`I found ${matches.length} possible cats. Which one do you mean: ${matches.slice(0,4).map(display).join(", ")}?`:"I preserved your words, but I need the AI interpreter connected before I can safely structure this update."}}

// A name that now belongs to an archived, merged-away record resolves to the record it was merged into,
// so the assistant never recreates a duplicate or attaches new work to an archived record.
async function mergedSurvivor(db:D1,owner:string,table:"colonies"|"people",type:"colony"|"person",name:string){const row=await db.prepare(`SELECT m.survivor_id id FROM merges m JOIN ${table} r ON r.id=m.merged_id AND r.owner_id=m.owner_id WHERE m.owner_id=? AND m.record_type=? AND LOWER(r.name)=LOWER(?) ORDER BY m.created_at DESC LIMIT 1`).bind(owner,type,name).first<{id:string}>();return row?.id??null}
async function colony(db:D1,owner:string,name:string,created:string[]){const found=await db.prepare("SELECT id FROM colonies WHERE owner_id=? AND LOWER(name)=LOWER(?) AND archived_at IS NULL LIMIT 1").bind(owner,name).first<{id:string}>();if(found)return found.id;const folded=await mergedSurvivor(db,owner,"colonies","colony",name);if(folded)return folded;const id=makeId("colony");await db.prepare("INSERT INTO colonies(id,owner_id,name,general_location,status,created_at) VALUES(?,?,?,?,?,?)").bind(id,owner,name,name,"active",now()).run();created.push(`colony:${id}`);return id}
async function person(db:D1,owner:string,draft:PersonDraft|null,name:string|null,created:string[],updated:string[]){if(!draft&&!name)return null;if(draft?.existingId){const valid=await db.prepare("SELECT id FROM people WHERE id=? AND owner_id=? AND archived_at IS NULL").bind(draft.existingId,owner).first();if(!valid)throw new Error("Unknown person");await db.prepare("UPDATE people SET name=COALESCE(?,name),type=COALESCE(?,type),general_location=COALESCE(?,general_location),contact=COALESCE(?,contact) WHERE id=? AND owner_id=?").bind(draft.name,draft.type,draft.generalLocation,draft.contact,draft.existingId,owner).run();updated.push(`person:${draft.existingId}`);return draft.existingId}const personName=draft?.name||name!;const found=await db.prepare("SELECT id FROM people WHERE owner_id=? AND LOWER(name)=LOWER(?) AND archived_at IS NULL LIMIT 1").bind(owner,personName).first<{id:string}>();if(found)return found.id;const folded=await mergedSurvivor(db,owner,"people","person",personName);if(folded)return folded;const id=makeId("person");await db.prepare("INSERT INTO people(id,owner_id,name,type,general_location,contact,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,owner,personName,draft?.type??null,draft?.generalLocation??null,draft?.contact??null,now()).run();created.push(`person:${id}`);return id}
async function execute(db:D1,owner:string,inputId:string,source:string,plan:AgentPlan){const created:string[]=[],updated:string[]=[],refs=new Map<string,string>();if(plan.intent==="clarify")return{created,updated,message:plan.message,clarification:plan.clarification};await checkReferences(db,owner,plan);for(const x of plan.people)await person(db,owner,x,null,created,updated);for(const c of plan.cats){if(c.existingId){const valid=await db.prepare("SELECT id FROM cats WHERE id=? AND owner_id=?").bind(c.existingId,owner).first();if(!valid)throw new Error("Unknown cat");const col=c.origin?await colony(db,owner,c.origin,created):null,status=c.currentStatus&&statuses.has(c.currentStatus)?c.currentStatus:null;await db.prepare("UPDATE cats SET name=COALESCE(?,name),sex=COALESCE(?,sex),age_class=COALESCE(?,age_class),appearance=COALESCE(?,appearance),distinguishing_characteristics=COALESCE(?,distinguishing_characteristics),health_observations=COALESCE(?,health_observations),reproductive_significance=COALESCE(?,reproductive_significance),origin_colony_id=COALESCE(?,origin_colony_id),current_status=COALESCE(?,current_status),current_location=COALESCE(?,current_location),microchip_number=COALESCE(?,microchip_number),updated_at=? WHERE id=? AND owner_id=?").bind(c.name,c.sex,c.ageClass,c.appearance,c.distinguishingCharacteristics,c.healthObservations,c.reproductiveSignificance,col,status,c.currentLocation,c.microchipNumber,now(),c.existingId,owner).run();refs.set(c.ref,c.existingId);refs.set(c.existingId,c.existingId);updated.push(`cat:${c.existingId}`)}else{const id=makeId("cat"),col=c.origin?await colony(db,owner,c.origin,created):null,status=c.currentStatus&&statuses.has(c.currentStatus)?c.currentStatus:"observed";await db.prepare("INSERT INTO cats(id,owner_id,name,sex,age_class,appearance,distinguishing_characteristics,health_observations,reproductive_significance,origin_colony_id,current_status,current_location,microchip_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,owner,c.name,c.sex,c.ageClass,c.appearance,c.distinguishingCharacteristics,c.healthObservations,c.reproductiveSignificance,col,status,c.currentLocation,c.microchipNumber,now(),now()).run();refs.set(c.ref,id);created.push(`cat:${id}`)}}
 for(const e of plan.events){const catId=e.catRef?(refs.get(e.catRef)||e.catRef):null;if(catId&&!await db.prepare("SELECT id FROM cats WHERE id=? AND owner_id=?").bind(catId,owner).first())throw new Error("Unknown event cat");const personId=e.personName?await person(db,owner,null,e.personName,created,updated):null,id=makeId("event");await db.prepare("INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,location,person_id,notes,source_input_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,owner,catId,e.eventType,e.occurredAt||now(),e.location,personId,e.notes||source,inputId,now()).run();created.push(`event:${id}`)}
 for(const t of plan.transactions){const currency=t.currency||DEFAULT_CURRENCY,amountMinor=t.amount==null?null:toMinorUnits(t.amount,currency),estimatedMinor=t.estimatedValue==null?null:toMinorUnits(t.estimatedValue,currency);const personId=t.personName?await person(db,owner,null,t.personName,created,updated):null,catId=t.relatedCatRef?(refs.get(t.relatedCatRef)||t.relatedCatRef):null,id=makeId("txn");await db.prepare("INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount_minor,currency,person_id,category,description,item,quantity,unit,estimated_value_minor,related_cat_id,source_input_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,owner,t.transactionType,t.direction,t.date||now(),amountMinor,currency,personId,t.category,t.description,t.item,t.quantity,t.unit,estimatedMinor,catId,inputId,now()).run();created.push(`transaction:${id}`)}return{created,updated,message:plan.socialDraft||plan.message,clarification:plan.clarification}}

async function answer(db:D1,owner:string,q:QueryDraft){const year=q.year||new Date().getUTCFullYear();if(q.kind==="cats_by_status"){const rows=await db.prepare("SELECT * FROM cats WHERE owner_id=? AND archived_at IS NULL AND current_status=? ORDER BY updated_at DESC").bind(owner,q.status||"available for adoption").all<CatRow>();return rows.results.length?`${rows.results.length} cat${rows.results.length===1?" is":"s are"} ${q.status||"available for adoption"}: ${rows.results.map(display).join(", ")}.`:`No cats are currently marked ${q.status||"available for adoption"}.`}if(q.kind==="cat_history"&&q.catId){const c=await db.prepare("SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.id=? AND c.owner_id=?").bind(q.catId,owner).first<CatRow>();if(!c)return"I couldn’t find that cat.";const events=await db.prepare("SELECT event_type,occurred_at,notes FROM active_events WHERE owner_id=? AND cat_id=? ORDER BY occurred_at").bind(owner,q.catId).all<{event_type:string;occurred_at:string;notes:string|null}>();return`${display(c)} is currently ${c.current_status}.\n${events.results.map(e=>`${e.occurred_at.slice(0,10)}: ${e.event_type}${e.notes?` — ${e.notes}`:""}`).join("\n")||"No events recorded yet."}`}if(q.kind==="income_expenses"||q.kind==="impact"){const sentences=reportSentences(await buildReport(db,owner,yearPeriod(year)),String(year));return q.kind==="impact"?sentences.impact:sentences.money}if(q.kind==="cats_needing_surgery"){const s=await surgeryStatus(db,owner),shown=s.needsSurgeryCatIds.slice(0,25),rows=shown.length?await db.prepare(`SELECT * FROM cats WHERE owner_id=? AND id IN (${shown.map(()=>"?").join(",")})`).bind(owner,...shown).all<CatRow>():{results:[]},unknown=s.unknown?` ${s.unknown} more ${s.unknown===1?"has":"have"} unknown surgery history, which is not the same as needing surgery.`:"";return s.needsSurgery?`${s.needsSurgery} cat${s.needsSurgery===1?" has":"s have"} a confirmed need for surgery: ${rows.results.map(display).join(", ")}${s.needsSurgery>shown.length?` and ${s.needsSurgery-shown.length} more`:""}.${unknown}`:`No cats have a recorded need for surgery.${unknown}`}if(q.kind==="cats_by_colony"){const x=`%${q.search||""}%`,rows=await db.prepare("SELECT c.* FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND c.archived_at IS NULL AND LOWER(co.name) LIKE LOWER(?)").bind(owner,x).all<CatRow>();return`${rows.results.length} cats found: ${rows.results.map(display).join(", ")||"none"}.`}if(q.kind==="transactions"){const x=`%${q.search||""}%`,rows=await db.prepare("SELECT t.*,p.name person_name FROM active_transactions t LEFT JOIN people p ON p.id=t.person_id AND p.owner_id=t.owner_id WHERE t.owner_id=? AND (LOWER(t.description) LIKE LOWER(?) OR LOWER(COALESCE(t.category,'')) LIKE LOWER(?) OR LOWER(COALESCE(p.name,'')) LIKE LOWER(?)) ORDER BY t.date DESC LIMIT 50").bind(owner,x,x,x).all<TxnRow>();const cash=new Map<string,number>(),estimated=new Map<string,number>();for(const r of rows.results){if(r.transaction_type==="in_kind_donation"){if(r.estimated_value_minor!=null)estimated.set(r.currency,(estimated.get(r.currency)||0)+Number(r.estimated_value_minor))}else if(r.amount_minor!=null){const sign=r.direction==="outflow"?-1:1;cash.set(r.currency,(cash.get(r.currency)||0)+sign*Number(r.amount_minor))}}const totals=(m:Map<string,number>)=>formatTotals([...m].map(([currency,minor])=>({currency,minor})));return`${rows.results.length} matching resource records. Net cash ${totals(cash)}${estimated.size?`; in-kind estimated value ${totals(estimated)} (not cash)`:""}.`}return"I couldn’t turn that into a database question yet."}

// Money reaches the client as exact integer minor units plus display text; nothing is floating point.
const shapeMemory=<M extends {amountMinor?:number|null;currency?:string|null;detail?:string|null}>(m:M):M=>m.amountMinor==null?m:{...m,detail:`${formatMoney(m.amountMinor,m.currency||undefined)} · ${m.detail||""}`};
export async function GET(req:Request){const owner=ownerFrom(req);if(!owner)return unauthorized();const db=env.DB;const url=new URL(req.url),photoId=url.searchParams.get("photoId");if(photoId){const photo=await db.prepare("SELECT storage_location FROM photos WHERE id=? AND owner_id=?").bind(photoId,owner).first<{storage_location:string}>();if(!photo)return new Response("Not found",{status:404});if(photo.storage_location.startsWith("data:image/")){const [header,data]=photo.storage_location.split(",");return new Response(Uint8Array.from(atob(data),c=>c.charCodeAt(0)),{headers:{"content-type":header.slice(5).split(";")[0],"cache-control":"private, no-store"}})}if(!photo.storage_location.startsWith(`cats/${encodeURIComponent(owner)}/`))return new Response("Not found",{status:404});const bucket=env.PHOTOS;if(!bucket)return new Response("Not found",{status:404});const object=await bucket.get(photo.storage_location);if(!object)return new Response("Not found",{status:404});return new Response(object.body,{headers:{"content-type":object.httpMetadata?.contentType||"image/jpeg","cache-control":"private, no-store"}})}if(url.searchParams.has("clarifications"))return Response.json({clarifications:await listPending(db,owner)},{headers:{"cache-control":"no-store"}});if(url.searchParams.has("corrections"))return Response.json({corrections:await listCorrections(db,owner,url.searchParams.get("recordId"))},{headers:{"cache-control":"no-store"}});const catId=url.searchParams.get("catId");if(catId){const cat=await db.prepare("SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.id=? AND c.owner_id=?").bind(catId,owner).first<CatRow>();if(!cat)return Response.json({message:"Cat not found."},{status:404});const [events,photos]=await Promise.all([db.prepare("SELECT e.*,p.name person_name FROM active_events e LEFT JOIN people p ON p.id=e.person_id AND p.owner_id=e.owner_id WHERE e.owner_id=? AND e.cat_id=? ORDER BY e.occurred_at DESC").bind(owner,catId).all(),db.prepare("SELECT id,taken_at,caption FROM photos WHERE owner_id=? AND cat_id=? ORDER BY taken_at DESC").bind(owner,catId).all()]);return Response.json({cat:{...cat,displayName:display(cat)},events:events.results,photos:photos.results})}const [cats,memories,stats,cash]=await Promise.all([db.prepare("SELECT c.*,co.name origin,(SELECT COUNT(*) FROM active_events e WHERE e.cat_id=c.id AND e.owner_id=c.owner_id) events,(SELECT id FROM photos p WHERE p.cat_id=c.id AND p.owner_id=c.owner_id ORDER BY taken_at DESC LIMIT 1) photo_id FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND c.archived_at IS NULL ORDER BY c.updated_at DESC").bind(owner).all<CatRow&{events:number;photo_id:string|null}>(),db.prepare("SELECT id,'event' recordType,event_type kind,COALESCE((SELECT name FROM cats WHERE id=cat_id AND cats.owner_id=active_events.owner_id),event_type) title,notes detail,created_at createdAt,version,NULL amountMinor,NULL currency,(SELECT id FROM corrections c WHERE c.owner_id=active_events.owner_id AND c.replacement_id=active_events.id AND c.kind='correction' AND c.status='applied') correctionId FROM active_events WHERE owner_id=? UNION ALL SELECT id,'transaction',CASE WHEN transaction_type='in_kind_donation' THEN 'in-kind' WHEN direction='inflow' THEN 'income' ELSE 'expense' END,description,CASE WHEN amount_minor IS NOT NULL THEN COALESCE(category,'') ELSE COALESCE(CAST(quantity AS TEXT)||' '||unit||' · '||item,'Resource') END,created_at,version,amount_minor amountMinor,currency,(SELECT id FROM corrections c WHERE c.owner_id=active_transactions.owner_id AND c.replacement_id=active_transactions.id AND c.kind='correction' AND c.status='applied') correctionId FROM active_transactions WHERE owner_id=? ORDER BY createdAt DESC LIMIT 50").bind(owner,owner).all(),db.prepare("SELECT COUNT(*) catsRecorded FROM cats WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.owner_id=cats.owner_id AND m.record_type='cat' AND m.merged_id=cats.id)").bind(owner).first<{catsRecorded:number}>(),buildReport(db,owner)]);return Response.json({revision:await revision(db,owner),cats:cats.results.map(c=>({id:c.id,displayName:c.name||"",description:[c.appearance,c.sex,c.age_class,c.origin].filter(Boolean).join(" · "),status:c.current_status,origin:c.origin,events:c.events,photoId:c.photo_id})),memories:memories.results.map(shapeMemory),stats:{catsRecorded:stats?.catsRecorded||0,catsFoundHomes:cash.cats.adopted,spayedNeutered:cash.cats.sterilized,vaccinated:cash.cats.vaccinated,cashIn:cash.money.cashIn,cashOut:cash.money.cashOut,cashInText:cash.money.cashInText,cashOutText:cash.money.cashOutText}})}
const PROPOSAL_TTL_MS=24*60*60*1000;
const rejectedPlan=()=>Response.json({outcome:"rejected",message:"I couldn’t safely turn that into an update, so nothing was changed. Your words are still here — try rewording it or adding detail."},{status:422,headers:{"cache-control":"no-store"}});
const refuse=(message:string,status:number,outcome="rejected")=>Response.json({outcome,message},{status,headers:{"cache-control":"no-store"}});
type Correction={recordType:"event"|"transaction";id:string;version:number;reason:string};
// Four separate states: question (read-only) → proposed action (stored, inert) → approved action (Ari confirms) → executed action (one atomic batch).
async function write(req:Request,patch:boolean){
 const owner=ownerFrom(req);if(!owner)return unauthorized();const db=env.DB;
 let key="",hash="",commitAttempted=false;
 try{
  const body=await req.json() as RequestBody;
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
  let proposal:ProposalRow|null=null,corr:Correction|null=null;
  if(confirmId){
   proposal=await db.prepare("SELECT * FROM proposed_actions WHERE id=? AND owner_id=?").bind(confirmId,owner).first<ProposalRow>();
   if(!proposal)return refuse("I couldn’t find that pending change.",404);
   if(proposal.status!=="proposed")return refuse("That change was already handled.",409,"conflict");
   if(proposal.expires_at<now())return refuse("That change expired. Tell me again and I’ll re-check it.",409,"conflict");
   if(proposal.kind==="correction")corr=JSON.parse(proposal.correction_target as string);
  }else if(patch){
   if(!body.id||typeof body.id!=="string"||typeof body.correction!=="string"||!body.correction.trim()||(body.recordType!=="event"&&body.recordType!=="transaction"))return Response.json({message:"Correction details are required."},{status:400});
   corr={recordType:body.recordType,id:body.id,version:body.version,reason:body.correction.trim()};
  }
  // An answer is bound to exactly one pending question by its id; it is never matched by guessing.
  let clar:ClarificationRow|null=null,clarCands:Candidate[]=[];
  if(clarifyId){
   if(typeof body.input!=="string"||!body.input.trim()||body.input.length>2000)return refuse("Tell me your answer first.",400);
   const loaded=await loadForAnswer(db,owner,clarifyId);
   if("error" in loaded)return refuse(loaded.error,loaded.status,loaded.outcome);
   clar=loaded.row;clarCands=loaded.candidates;
  }
  let original:EventOrTxnRow|null=null;
  if(corr){
   original=await db.prepare(`SELECT * FROM ${corr.recordType==="event"?"events":"transactions"} WHERE id=? AND owner_id=?`).bind(corr.id,owner).first<EventOrTxnRow>();
   if(!original)return Response.json({message:"Activity record not found."},{status:404});
   if(original.superseded_at)return Response.json({outcome:"conflict",message:"This activity was already corrected. Refresh to correct the latest version."},{status:409});
   if(corr.version!==original.version)return Response.json({outcome:"conflict",message:"This activity changed. Refresh and review the latest version before correcting it."},{status:409});
  }else if(!confirmId&&!body.input?.trim()&&!body.photoDataUrl)return Response.json({message:"Tell me what happened or add a photo first."},{status:400});
  let photo:string|null;
  try{photo=clarifyId?null:validatedPhoto(body.photoDataUrl)}catch(e){await recordEvent(db,{kind:"upload_rejected",owner,route:"/api/assistant",status:400,detail:e});return Response.json({outcome:"rejected",message:(e as Error).message},{status:400})}
  if(photo&&!clarifyId){const refusal=await photoRefusal(db,owner);if(refusal){await recordEvent(db,{kind:"limit_hit",owner,route:"/api/assistant",status:refusal.status,detail:refusal.detail});return Response.json({outcome:"rejected",message:refusal.message},{status:refusal.status})}}
  // The photo belongs to the pending question, not to this request.
  if(clar)photo=clar.photo_data;
  if(proposal&&proposal.photo_digest&&!photo){
   // A photo that arrived with a clarified update is kept with that update, so Ari need not re-add it.
   const kept=await db.prepare("SELECT photo_data FROM clarifications WHERE input_id=? AND owner_id=? AND photo_data IS NOT NULL").bind(proposal.input_id,owner).first<{photo_data:string}>();
   if(kept)photo=kept.photo_data;
  }
  if(proposal){
   if(proposal.photo_digest&&(!photo||await digest(photo)!==proposal.photo_digest))return refuse("Add the same photo again to confirm this change.",400);
   if(!proposal.photo_digest)photo=null;
  }
  let inputRow:{transcription:string}|null=null;
  if(proposal){inputRow=await db.prepare("SELECT transcription FROM ai_inputs WHERE id=? AND owner_id=?").bind(proposal.input_id,owner).first<{transcription:string}>();if(!inputRow)return refuse("The original words for this change are missing.",409,"conflict")}
  const source=corr?`Correct this ${corr.recordType}. Original record: ${JSON.stringify(original)}. Complete corrected version from Ari: ${corr.reason}`:proposal?inputRow!.transcription:clar?clar.original_text:body.input?.trim()||`Photo added: ${body.photoName||"cat photo"}`;
  const data=await snapshot(db,owner);
  // Detect any changes made while collecting the interpreter's snapshot.
  if(await revision(db,owner)!==base)throw new Error("Concurrent edit");
  const statusSet=statuses,mode=corr?"correction":clar?clar.mode:body.mode||"text",agentInput=clar?answerPrompt(clar,clarCands,body.input.trim()):source;
  // A stored proposal is re-validated exactly like fresh provider output; it is never trusted because it was stored.
  const interpreted=validateProviderPlan(proposal?JSON.parse(proposal.plan):await monitoredAgent(db,owner,agentInput,mode,data,photo||undefined),{statuses:statusSet,mode:clar?clar.mode:body.mode});
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
  let correctionCats=new Map<string,Record<string,unknown>>();
  if(corr){
   // The replacement must be a faithful one-for-one swap; keep the original date when the interpreter omits one.
   const checked=await checkCorrectionPlan(db,owner,corr.recordType,original!,plan);
   if("error" in checked)return Response.json({outcome:"clarification",message:checked.error,clarification:checked.error},{status:checked.status});
   correctionCats=checked.cats;
   if(corr.recordType==="event")plan.events[0].occurredAt||=original!.occurred_at??null;else plan.transactions[0].date||=original!.date??null;
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
  if(plan.intent==="clarify"&&!corr&&!proposal&&!clar&&(env.OPENROUTER_API_KEY||env.OPENAI_API_KEY)){
   // Keep everything needed to finish this update once Ari answers.
   clarificationId=makeId("clarify");
   await queueClarification(queued,{id:clarificationId,owner,inputId,sessionId,mode,original:source,question:plan.clarification||plan.message,candidates:candidatesFor(interpreted,data.cats,display),plan:interpreted,photoName:body.photoName||null,photo,createdAt});
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
   const queuedCorrection=await queueCorrection(db,queued,{owner,recordType:corr.recordType,original:original!,plan,inputId,replacementId,reason:corr.reason,cats:correctionCats,now:createdAt});
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
  if(error instanceof PlanRejected){await recordEvent(db,{kind:"ai_invalid",owner,route:"/api/assistant",detail:"plan rejected by validation"});return rejectedPlan()}
  if(!(error instanceof AiUnavailable||error instanceof AiLimited)&&!String(error).includes("Concurrent edit"))await recordEvent(db,{kind:"db_error",owner,route:"/api/assistant",detail:error});
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
  const body=await req.json() as RequestBody;
  if(body?.rejectProposalId!=null){
   // Dismissing a proposal changes no rescue records; it only closes the pending change.
   if(typeof body.rejectProposalId!=="string")return Response.json({message:"Invalid request."},{status:400});
   const closed=await db.prepare("UPDATE proposed_actions SET status='rejected',decided_at=?,decided_by=? WHERE id=? AND owner_id=? AND status='proposed'").bind(now(),owner,body.rejectProposalId,owner).run();
   return closed.meta.changes===0?Response.json({outcome:"conflict",message:"That change was already handled."},{status:409}):Response.json({outcome:"dismissed",message:"Okay, I didn’t make that change."});
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
