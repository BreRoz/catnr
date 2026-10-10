import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(name) {
  const source = await readFile(new URL(`../worker/${name}.ts`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return js;
}
const toModule = (js) => `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
const google = await import(toModule(await load('google')));
const session = await import(toModule(await load('session')));
// signin.ts imports its two siblings; point those imports at the loaded copies.
const signinJs = (await load('signin')).replace('"./google"', `"${toModule(await load('google'))}"`).replace('"./session"', `"${toModule(await load('session'))}"`);
const signin = await import(toModule(signinJs));

const clientId = 'catnr-test.apps.googleusercontent.com', secret = 'test-session-secret';
const rsa = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const { publicKey, privateKey } = await rsa();
const other = await rsa();
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'g1' };
globalThis.fetch = async (url) => { assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs'); return Response.json({ keys: [jwk] }); };

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
async function idToken(claims = {}, { key = privateKey, kid = 'g1', alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg, kid })}.${b64({ aud: clientId, iss: 'https://accounts.google.com', exp: now + 600, sub: 'g-1', email: 'Ari@Example.com', email_verified: true, ...claims })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(sig).toString('base64url')}`;
}

test('a valid Google token yields a normalized email identity', async () => {
  assert.deepEqual(await google.verifyGoogleIdToken(await idToken(), clientId), { userId: 'ari@example.com', email: 'ari@example.com' });
  assert.ok(await google.verifyGoogleIdToken(await idToken({ iss: 'accounts.google.com' }), clientId));
});

test('missing, forged, mis-scoped, expired or unverified Google tokens are rejected', async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await google.verifyGoogleIdToken(null, clientId), null);
  assert.equal(await google.verifyGoogleIdToken('not.a.jwt', clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({}, { key: other.privateKey }), clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({}, { alg: 'none' }), clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({}, { kid: 'unknown' }), clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({ aud: 'another-app' }), clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({ iss: 'https://evil.example' }), clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({ exp: now - 1 }), clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({ email: undefined }), clientId), null);
  assert.equal(await google.verifyGoogleIdToken(await idToken({ email_verified: false }), clientId), null);
  const [h, p, s] = (await idToken()).split('.');
  assert.equal(await google.verifyGoogleIdToken(`${h}.${b64({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'mallory@example.com' })}.${s}`, clientId), null);
});

test('a session cookie round-trips and cannot be forged, edited or reused after expiry', async () => {
  const value = await session.createSession('ari@example.com', secret);
  const cookie = `x=1; ${session.SESSION_COOKIE}=${value}; y=2`;
  assert.equal(await session.readSession(cookie, secret), 'ari@example.com');
  assert.equal(await session.readSession(cookie, 'a-different-secret'), null);
  assert.equal(await session.readSession(null, secret), null);
  assert.equal(await session.readSession('', secret), null);
  assert.equal(await session.readSession(`${session.SESSION_COOKIE}=garbage`, secret), null);
  const [body, sig] = value.split('.');
  const edited = b64({ ...JSON.parse(Buffer.from(body, 'base64url')), email: 'mallory@example.com' });
  assert.equal(await session.readSession(`${session.SESSION_COOKIE}=${edited}.${sig}`, secret), null);
  const later = Date.now() + (session.SESSION_SECONDS + 5) * 1000;
  assert.equal(await session.readSession(cookie, secret, later), null);
  assert.match(session.sessionCookie('v', true), /HttpOnly; SameSite=Lax; Secure/);
});

test('POST /auth/google signs a verified Google user in and refuses everything else', async () => {
  const env = { GOOGLE_CLIENT_ID: clientId, SESSION_SECRET: secret };
  const post = (credential, headers = {}) =>
    signin.handleAuthRoute(new Request('https://catnr.example/auth/google', { method: 'POST', body: JSON.stringify({ credential }), headers: { origin: 'https://catnr.example', ...headers } }), env);
  const ok = await post(await idToken());
  assert.equal(ok.status, 204);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
  assert.equal(await session.readSession(cookie.split(';')[0], secret), 'ari@example.com');
  assert.equal((await post('x.y.z')).status, 401);
  assert.equal((await post(await idToken({ aud: 'someone-else' }))).status, 401);
  assert.equal((await post(await idToken(), { origin: 'https://evil.example' })).status, 403);
  const unconfigured = await signin.handleAuthRoute(new Request('https://catnr.example/auth/google', { method: 'POST', body: '{}' }), {});
  assert.equal(unconfigured.status, 503);
  assert.equal((await signin.handleAuthRoute(new Request('https://catnr.example/auth/signout', { method: 'POST' }), env)).headers.get('set-cookie').includes('Max-Age=0'), true);
  assert.equal(await signin.handleAuthRoute(new Request('https://catnr.example/api/assistant'), env), null, 'only the sign-in routes work signed out');
});

test('the sign-in page embeds the client ID safely', async () => {
  const page = await signin.signInPage('abc.apps.googleusercontent.com</script><script>alert(1)').text();
  assert.equal(page.includes('</script><script>alert(1)'), false);
});
