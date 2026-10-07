// Provider/LLM output is untrusted input. Nothing here touches the database except the
// read-only reference check; every function either returns a fully validated plan or throws PlanRejected.
import type { AgentPlan } from "./route";
type D1 = D1Database;

export class PlanRejected extends Error { constructor(message:string){super(message);this.name="PlanRejected"} }

export const INTENTS=["record","query","clarify","social"] as const;
export const EVENT_TYPES=["first_seen","captured","intake","transport","vet_visit","spay","neuter","vaccination","testing","medication","illness","injury","observation","foster","adoption_interest","application","meet_and_greet","adoption","returned_to_colony","lost","deceased","other"] as const;
export const TRANSACTION_TYPES=["cash_donation","cash_inflow","cash_outflow","in_kind_donation","fundraiser_income","merchandise_income","operating_expense","supply_purchase","other"] as const;
export const QUERY_KINDS=["none","cats_by_status","cat_history","impact","income_expenses","transactions","cats_by_colony","cats_needing_surgery"] as const;
export const SEXES=["male","female","unknown"] as const;
export const AGE_CLASSES=["kitten","juvenile","adult","senior","unknown"] as const;
export const PERSON_TYPES=["donor","adopter","foster","volunteer","veterinarian","other"] as const;
export const CURRENCIES=["USD","CAD","EUR","GBP","MXN","AUD"] as const;
const INFLOW_TYPES=new Set(["cash_donation","cash_inflow","in_kind_donation","fundraiser_income","merchandise_income"]);
const OUTFLOW_TYPES=new Set(["cash_outflow","operating_expense","supply_purchase"]);
const MEDICAL=new Set(["vet_visit","spay","neuter","vaccination","testing","medication","illness","injury"]);
const CONSEQUENTIAL_EVENTS=new Set(["deceased","adoption","lost"]);
const MAX_ITEMS=25, MAX_TEXT=2000, MAX_MONEY=1_000_000, MAX_QTY=100_000;
const ID=/^[A-Za-z0-9_.:-]{1,120}$/;

const KEYS={
 plan:["intent","message","clarification","confidence","cats","events","people","transactions","query","socialDraft"],
 cat:["ref","existingId","name","sex","ageClass","appearance","distinguishingCharacteristics","healthObservations","reproductiveSignificance","origin","currentStatus","currentLocation","microchipNumber"],
 event:["catRef","eventType","occurredAt","location","personName","notes"],
 person:["ref","existingId","name","type","generalLocation","contact"],
 transaction:["transactionType","direction","date","amount","currency","personName","category","description","item","quantity","unit","estimatedValue","relatedCatRef"],
 query:["kind","catId","status","year","search"]
};
const isObject=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
function exact(v:unknown,keys:string[],where:string):Record<string,unknown>{
 if(!isObject(v))throw new PlanRejected(`${where} must be an object`);
 for(const k of Object.keys(v))if(!keys.includes(k))throw new PlanRejected(`${where} has unexpected field "${k}"`);
 // Missing optional fields are treated as null; required identity fields are checked by the caller.
 return v;
}
function str(v:unknown,where:string,{max=MAX_TEXT,required=false}={}):string|null{
 if(v==null){if(required)throw new PlanRejected(`${where} is required`);return null}
 if(typeof v!=="string")throw new PlanRejected(`${where} must be text`);
 const t=v.trim();if(required&&!t)throw new PlanRejected(`${where} is required`);
 // eslint-disable-next-line no-control-regex -- control characters are exactly what is being rejected
 if(v.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v))throw new PlanRejected(`${where} is invalid`);
 return t||null;
}
function oneOf<T extends string>(v:unknown,list:readonly T[],where:string,required=false):T|null{
 if(v==null){if(required)throw new PlanRejected(`${where} is required`);return null}
 // Case differences are harmless; anything else outside the list is rejected.
 const hit=typeof v==="string"?list.find(x=>x===v.trim()||x.toLowerCase()===v.trim().toLowerCase()):undefined;
 if(!hit)throw new PlanRejected(`${where} is not an allowed value`);
 return hit;
}
function id(v:unknown,where:string,required=false):string|null{
 if(v==null||v===""){if(required)throw new PlanRejected(`${where} is required`);return null}
 if(typeof v!=="string"||!ID.test(v))throw new PlanRejected(`${where} is not a valid ID`);
 return v;
}
// Accepts YYYY-MM-DD or a full ISO timestamp; must be a real calendar date, not before 1990, not more than a day ahead.
export function validDate(v:unknown,where:string,nowMs=Date.now()):string|null{
 if(v==null)return null;
 if(typeof v!=="string")throw new PlanRejected(`${where} must be a date`);
 const m=v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/);
 if(!m)throw new PlanRejected(`${where} is not a valid date`);
 const [y,mo,d]=[+m[1],+m[2],+m[3]],probe=new Date(Date.UTC(y,mo-1,d));
 if(probe.getUTCFullYear()!==y||probe.getUTCMonth()!==mo-1||probe.getUTCDate()!==d)throw new PlanRejected(`${where} is not a real date`);
 if(m[4]!==undefined&&(+m[4]>23||+m[5]>59||(m[6]!==undefined&&+m[6]>59)))throw new PlanRejected(`${where} has an invalid time`);
 const t=Date.parse(v);
 if(!Number.isFinite(t)||y<1990||t>nowMs+86_400_000)throw new PlanRejected(`${where} is out of range`);
 return v;
}
function money(v:unknown,where:string,max:number):number|null{
 if(v==null)return null;
 if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>max)throw new PlanRejected(`${where} must be a number between 0 and ${max}`);
 if(Math.abs(v*100-Math.round(v*100))>1e-6)throw new PlanRejected(`${where} has more than two decimal places`);
 return v;
}

/** Parse provider text as JSON; anything else is rejected before schema validation. */
export function parseProviderJson(text:unknown):unknown{
 if(typeof text!=="string"||!text.trim()||text.length>200_000)throw new PlanRejected("The interpreter returned an unreadable response");
 try{return JSON.parse(text)}catch{throw new PlanRejected("The interpreter returned malformed JSON")}
}

/**
 * Strictly validate an untrusted plan. Returns a NEW normalised plan (unknown fields never survive).
 * Throws PlanRejected for anything malformed — a plan is never partially accepted.
 */
export function validateProviderPlan(raw:unknown,opts:{statuses:Set<string>;mode?:string;nowMs?:number}):AgentPlan{
 const nowMs=opts.nowMs??Date.now(),p=exact(raw,KEYS.plan,"plan");
 const intent=oneOf(p.intent,INTENTS,"intent",true)!;
 const message=str(p.message,"message",{required:true})!;
 const clarification=str(p.clarification,"clarification");
 const socialDraft=str(p.socialDraft,"socialDraft",{max:5000});
 if(typeof p.confidence!=="number"||!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1)throw new PlanRejected("confidence must be between 0 and 1");
 for(const k of ["cats","events","people","transactions"])if(!Array.isArray(p[k])||(p[k] as unknown[]).length>MAX_ITEMS)throw new PlanRejected(`${k} must be a short list`);
 const refs=new Set<string>(),existing=new Set<string>();
 const people=(p.people as unknown[]).map((x,i)=>{const o=exact(x,KEYS.person,`people[${i}]`);return{
  ref:id(o.ref,`people[${i}].ref`,true)!,existingId:id(o.existingId,`people[${i}].existingId`),name:str(o.name,`people[${i}].name`,{max:200,required:true})!,
  type:oneOf(o.type,PERSON_TYPES,`people[${i}].type`),generalLocation:str(o.generalLocation,`people[${i}].generalLocation`,{max:300}),contact:str(o.contact,`people[${i}].contact`,{max:300})}});
 const cats=(p.cats as unknown[]).map((x,i)=>{const w=`cats[${i}]`,o=exact(x,KEYS.cat,w);
  const c={ref:id(o.ref,`${w}.ref`,true)!,existingId:id(o.existingId,`${w}.existingId`),name:str(o.name,`${w}.name`,{max:100}),sex:oneOf(o.sex,SEXES,`${w}.sex`),ageClass:oneOf(o.ageClass,AGE_CLASSES,`${w}.ageClass`),
   appearance:str(o.appearance,`${w}.appearance`,{max:500}),distinguishingCharacteristics:str(o.distinguishingCharacteristics,`${w}.distinguishingCharacteristics`,{max:500}),healthObservations:str(o.healthObservations,`${w}.healthObservations`),
   reproductiveSignificance:str(o.reproductiveSignificance,`${w}.reproductiveSignificance`,{max:500}),origin:str(o.origin,`${w}.origin`,{max:200}),currentStatus:str(o.currentStatus,`${w}.currentStatus`,{max:60}),
   currentLocation:str(o.currentLocation,`${w}.currentLocation`,{max:300}),microchipNumber:str(o.microchipNumber,`${w}.microchipNumber`,{max:40})};
  if(c.currentStatus&&!opts.statuses.has(c.currentStatus))throw new PlanRejected(`${w}.currentStatus is not an allowed status`);
  if(c.microchipNumber&&!/^[0-9A-Za-z]{9,15}$/.test(c.microchipNumber))throw new PlanRejected(`${w}.microchipNumber is invalid`);
  if(refs.has(c.ref)||(c.existingId&&existing.has(c.existingId)))throw new PlanRejected("The same cat appears twice in one plan");
  refs.add(c.ref);if(c.existingId)existing.add(c.existingId);return c});
 const catRef=(v:unknown,w:string)=>{const r=id(v,w);return r};
 const events=(p.events as unknown[]).map((x,i)=>{const w=`events[${i}]`,o=exact(x,KEYS.event,w);
  const raw=str(o.eventType,`${w}.eventType`,{max:100,required:true})!,base=raw.split(":")[0].trim().toLowerCase();
  if(!(EVENT_TYPES as readonly string[]).includes(base))throw new PlanRejected(`${w}.eventType is not an allowed event type`);
  return{catRef:catRef(o.catRef,`${w}.catRef`),eventType:raw,occurredAt:validDate(o.occurredAt,`${w}.occurredAt`,nowMs),location:str(o.location,`${w}.location`,{max:300}),personName:str(o.personName,`${w}.personName`,{max:200}),notes:str(o.notes,`${w}.notes`)}});
 const transactions=(p.transactions as unknown[]).map((x,i)=>{const w=`transactions[${i}]`,o=exact(x,KEYS.transaction,w);
  const type=oneOf(o.transactionType,TRANSACTION_TYPES,`${w}.transactionType`,true)!,direction=oneOf(o.direction,["inflow","outflow"] as const,`${w}.direction`,true)!;
  if(INFLOW_TYPES.has(type)&&direction!=="inflow"||OUTFLOW_TYPES.has(type)&&direction!=="outflow")throw new PlanRejected(`${w}.direction contradicts its type`);
  const amount=money(o.amount,`${w}.amount`,MAX_MONEY),estimatedValue=money(o.estimatedValue,`${w}.estimatedValue`,MAX_MONEY),quantity=money(o.quantity,`${w}.quantity`,MAX_QTY);
  const currency=o.currency==null?null:oneOf(o.currency,CURRENCIES,`${w}.currency`);
  if(amount==null&&type!=="in_kind_donation"&&type!=="other")throw new PlanRejected(`${w}.amount is required for a money transaction`);
  if(amount!=null&&amount<=0)throw new PlanRejected(`${w}.amount must be greater than zero`);
  return{transactionType:type,direction,date:validDate(o.date,`${w}.date`,nowMs),amount,currency,personName:str(o.personName,`${w}.personName`,{max:200}),category:str(o.category,`${w}.category`,{max:100}),
   description:str(o.description,`${w}.description`,{max:500,required:true})!,item:str(o.item,`${w}.item`,{max:200}),quantity,unit:str(o.unit,`${w}.unit`,{max:40}),estimatedValue,relatedCatRef:catRef(o.relatedCatRef,`${w}.relatedCatRef`)}});
 const q=exact(p.query,KEYS.query,"query");
 const year=q.year==null?null:q.year;if(year!==null&&(!Number.isInteger(year)||(year as number)<1990||(year as number)>new Date(nowMs).getUTCFullYear()+1))throw new PlanRejected("query.year is out of range");
 const qStatus=str(q.status,"query.status",{max:60});if(qStatus&&!opts.statuses.has(qStatus))throw new PlanRejected("query.status is not an allowed status");
 const query={kind:oneOf(q.kind,QUERY_KINDS,"query.kind",true)!,catId:id(q.catId,"query.catId"),status:qStatus,year:year as number|null,search:str(q.search,"query.search",{max:200})};

 // Cross-field rules: the intent decides what a plan is allowed to contain.
 const hasRecords=cats.length+events.length+people.length+transactions.length>0;
 if(intent==="record"){
  if(!hasRecords)throw new PlanRejected("A record plan must contain something to record");
  if(query.kind!=="none")throw new PlanRejected("A record plan cannot also be a query");
  if(opts.mode==="ask")throw new PlanRejected("Questions cannot record updates");
 }else{
  if(hasRecords)throw new PlanRejected(`A ${intent} response cannot contain records to change`);
  if(intent==="clarify"&&!clarification)throw new PlanRejected("A clarification must contain a question");
  if(intent==="query"&&query.kind==="none")throw new PlanRejected("A query must say what it is asking");
  if(intent==="query"&&query.kind==="cat_history"&&!query.catId)throw new PlanRejected("A cat history question needs a cat");
 }
 if(intent!=="query"&&query.kind!=="none")throw new PlanRejected("Only a query can carry a query");
 if(opts.mode==="ask"&&intent==="social")throw new PlanRejected("Questions cannot draft social posts");
 // Every cat reference must be a declared cat or a bare stored ID (verified against the owner below).
 return{intent,message,clarification,confidence:p.confidence,cats,events,people,transactions,query,socialDraft} as AgentPlan;
}

/** Verify every record reference belongs to this owner. Read-only. */
export async function checkReferences(db:D1,owner:string,plan:AgentPlan){
 const declared=new Set(plan.cats.filter(c=>!c.existingId).map(c=>c.ref));
 const aliases=new Map(plan.cats.filter(c=>c.existingId).map(c=>[c.ref,c.existingId!]));
 const owned=async(table:"cats"|"people",rid:string)=>!!await db.prepare(`SELECT id FROM ${table} WHERE id=? AND owner_id=?`).bind(rid,owner).first();
 for(const p of plan.people)if(p.existingId&&!await owned("people",p.existingId))throw new PlanRejected("The plan refers to a person who doesn't exist");
 const ids=[...plan.cats.map(c=>c.existingId),...plan.events.map(e=>e.catRef),...plan.transactions.map(t=>t.relatedCatRef),plan.query.catId];
 for(const ref of ids){if(!ref||declared.has(ref))continue;if(!await owned("cats",aliases.get(ref)||ref))throw new PlanRejected("The plan refers to a cat that doesn't exist")}
}

export type StoredCat={id:string;name:string|null};
const baseType=(t:string)=>t.split(":")[0].trim().toLowerCase();
/**
 * Hard stop: the plan is plausible but identity is not certain enough to write anything.
 * Returns the question to ask Ari, or null.
 */
export function ambiguity(plan:AgentPlan,cats:StoredCat[]):string|null{
 if(plan.intent!=="record")return null;
 const risky=(t:string)=>MEDICAL.has(baseType(t))||CONSEQUENTIAL_EVENTS.has(baseType(t));
 if(plan.confidence<0.5)return "I'm not confident I understood that. Could you say it again with a little more detail?";
 const declaredNew=new Map(plan.cats.filter(c=>!c.existingId).map(c=>[c.ref,c]));
 const nameOf=(id:string)=>cats.find(c=>c.id===id)?.name||"that cat";
 for(const e of plan.events){
  if(!risky(e.eventType))continue;
  if(!e.catRef)return `Which cat is this ${baseType(e.eventType).replace(/_/g," ")} for? I haven't changed anything yet.`;
  const fresh=declaredNew.get(e.catRef);
  if(!fresh){if(plan.confidence<0.7)return `I'm not sure ${nameOf(plan.cats.find(c=>c.ref===e.catRef)?.existingId||e.catRef)} is the right cat. Can you confirm which cat you mean? I haven't changed anything yet.`;continue}
  const twin=fresh.name&&cats.find(c=>c.name?.toLowerCase()===fresh.name!.toLowerCase());
  if(twin)return `You already have a cat named ${twin.name}. Is this the same cat, or a different one? I haven't changed anything yet.`;
  if(cats.length&&CONSEQUENTIAL_EVENTS.has(baseType(e.eventType)))return `I can't tell which cat you mean by this ${baseType(e.eventType)}. Please name the cat. I haven't changed anything yet.`;
 }
 return null;
}

/** Reasons a valid, unambiguous plan still needs Ari's explicit approval before anything is written. */
export function consequences(plan:AgentPlan,opts:{correctionOf?:"event"|"transaction"|null}={}):string[]{
 if(plan.intent!=="record")return [];
 const out:string[]=[];
 for(const e of plan.events){const t=baseType(e.eventType);if(t==="deceased")out.push("Mark a cat as deceased");else if(t==="adoption")out.push("Record an adoption");else if(t==="lost")out.push("Record a cat as lost")}
 for(const c of plan.cats){if(!c.currentStatus||!c.existingId)continue;if(c.currentStatus==="deceased")out.push("Mark a cat as deceased");else if(c.currentStatus==="adopted")out.push("Mark a cat as adopted");else if(c.currentStatus==="lost")out.push("Mark a cat as lost")}
 for(const c of plan.cats)if(c.existingId&&c.name)out.push("Rename an existing cat");
 if(opts.correctionOf==="transaction")out.push("Correct a financial record");
 else if(opts.correctionOf==="event")out.push("Correct a recorded activity");
 for(const t of plan.transactions)if((t.amount??0)>=1000)out.push("Record a large amount of money");
 return [...new Set(out)];
}
