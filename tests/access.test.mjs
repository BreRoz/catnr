import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../worker/access.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const { verifyAccessJwt }=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const team='catnr.cloudflareaccess.com',aud='catnr-aud';
const {publicKey,privateKey}=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const other=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',publicKey),kid:'k1'};
globalThis.fetch=async url=>{assert.equal(url,`https://${team}/cdn-cgi/access/certs`);return Response.json({keys:[jwk]})};

const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
async function token(claims={},{key=privateKey,kid='k1',alg='RS256'}={}){
 const now=Math.floor(Date.now()/1000);
 const body=`${b64({alg,kid})}.${b64({aud:[aud],iss:`https://${team}`,exp:now+600,sub:'u1',email:'Ari@Example.com',...claims})}`;
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(body));
 return `${body}.${Buffer.from(sig).toString('base64url')}`;
}

test('valid Access token yields a normalized email identity',async()=>{
 assert.deepEqual(await verifyAccessJwt(await token(),team,aud),{userId:'ari@example.com',email:'ari@example.com'});
});

test('missing, malformed, forged, or mis-scoped tokens are rejected',async()=>{
 const now=Math.floor(Date.now()/1000);
 assert.equal(await verifyAccessJwt(null,team,aud),null);
 assert.equal(await verifyAccessJwt('not.a.jwt',team,aud),null);
 assert.equal(await verifyAccessJwt(await token({},{key:other.privateKey}),team,aud),null);
 assert.equal(await verifyAccessJwt(await token({},{alg:'none'}),team,aud),null);
 assert.equal(await verifyAccessJwt(await token({},{kid:'unknown'}),team,aud),null);
 assert.equal(await verifyAccessJwt(await token({aud:['someone-else']}),team,aud),null);
 assert.equal(await verifyAccessJwt(await token({iss:'https://evil.cloudflareaccess.com'}),team,aud),null);
 assert.equal(await verifyAccessJwt(await token({exp:now-1}),team,aud),null);
 assert.equal(await verifyAccessJwt(await token({email:undefined}),team,aud),null);
 const t=await token();const [h,p,s]=t.split('.');
 assert.equal(await verifyAccessJwt(`${h}.${b64({...JSON.parse(Buffer.from(p,'base64url')),email:'mallory@example.com'})}.${s}`,team,aud),null);
});
