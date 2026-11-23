import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
let passed = 0;
function check(condition, label) { assert.ok(condition, label); console.log('PASS ' + label); passed++; }
const html = await readFile('index.html', 'utf8');
const links = [...html.matchAll(/<a[^>]*href="\.\/(?:student|teacherMonitor)\.html"[^>]*>/g)];
check(links.length === 4 && links.every(([tag]) => tag.includes(' hidden')), 'All activity links are hidden in source HTML');
const mockApp = `export const getApps=()=>[];
export const initializeApp=config=>{window.__configReceived=config;return {name:'[DEFAULT]'};};`;
const mockAuth = `const t = window.__authTest;
const user={uid:'test-uid',displayName:'<img src=x onerror="window.__xss=true">',email:'student@example.test'};
export class GoogleAuthProvider {setCustomParameters(parameters){t.parameters=parameters;}}
export const getAuth=()=>({languageCode:'en'});
export function onAuthStateChanged(auth,callback,onError){
  t.observer=callback;t.failObserver=onError;
  t.release=()=>callback(null);
  if(location.search.includes('restore'))queueMicrotask(()=>callback(user));
  return ()=>{};
}
export async function signInWithPopup(auth,provider){
  t.calls++;await new Promise(resolve=>setTimeout(resolve,20));
  if(t.nextError){const code=t.nextError;t.nextError=null;throw {code};}
  if(!t.skipObserver)t.observer(user);return {user};
}
export async function signOut(){
  if(t.logoutError){t.logoutError=false;throw {code:'auth/network-request-failed'};}
  t.observer(null);
}`;
const testPlugin = {
  name:'mock-firebase-auth',enforce:'pre',
  resolveId(id){if(['firebase/app','firebase/auth','firebase/firestore','firebase/storage'].includes(id))return '\0auth-test:'+id;},
  load(id){if(id==='\0auth-test:firebase/app')return mockApp;if(id==='\0auth-test:firebase/auth')return mockAuth;if(id==='\0auth-test:firebase/firestore')return 'export const getFirestore=()=>({});export const collection=()=>({});export const getDocsFromServer=async()=>({docs:[]});export const doc=()=>({});export const deleteDoc=async()=>{};';if(id==='\0auth-test:firebase/storage')return 'export const getStorage=()=>({});export const ref=()=>({});export const getBlob=async()=>new Blob();export const deleteObject=async()=>{};';},
};
const settings={API_KEY:'test-only-key',AUTH_DOMAIN:'test.firebaseapp.com',PROJECT_ID:'test-project',APP_ID:'test-app',
  STORAGE_BUCKET:'test-bucket',MESSAGING_SENDER_ID:'test-sender',MEASUREMENT_ID:''};
const defines={...Object.fromEntries(Object.entries(settings).map(([key,value])=>['import.meta.env.VITE_FIREBASE_'+key,JSON.stringify(value)])), 'import.meta.env.VITE_ADMIN_UIDS':JSON.stringify('test-uid, second-admin;test-uid')};
const profile = await mkdtemp(path.join(tmpdir(), 'maeum-browser-test-'));
const server = await createServer({ configFile:false, plugins:[testPlugin], define:defines, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const origin = server.resolvedUrls.local[0];
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
let sequence = 0, buffer = '';
const pending = new Map();
chrome.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\0')) !== -1) {
    const packet = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!packet) continue;
    const data = JSON.parse(packet);
    if (data.id && pending.has(data.id)) {
      const task = pending.get(data.id); pending.delete(data.id);
      clearTimeout(task.timer);
      data.error ? task.reject(new Error(JSON.stringify(data.error))) : task.resolve(data.result);
    }
  }
});
function call(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
let session;
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting: ' + expression);
}
const mock = "window.__authTest={calls:0,nextError:null,logoutError:false};window.__unhandled=[];addEventListener('unhandledrejection',e=>window.__unhandled.push(String(e.reason)));";
let emptyServer, noAdminServer;
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  session = (await call('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await call('Page.enable', {}, session);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: mock }, session);
  await call('Page.navigate', { url: origin }, session);
  await until("Boolean(window.__authTest?.release)");
  check(await evaluate("[...document.querySelectorAll('[data-requires-auth]')].every(link=>link.hidden && getComputedStyle(link).display==='none') && document.getElementById('google-login').disabled"), 'Auth restoration waits without flashing links');
  check(await evaluate("window.__configReceived.projectId==='test-project' && window.__configReceived.authDomain==='test.firebaseapp.com' && window.__authTest.parameters.prompt==='select_account'"), 'Environment settings reach shared Firebase module');
  await evaluate("window.__authTest.release()");
  await until("!document.getElementById('google-login').disabled");
  check(await evaluate("!document.getElementById('google-login').hidden && document.getElementById('user-session').hidden"), 'Signed-out UI offers Google sign-in');
  await evaluate("window.__authTest.nextError='auth/popup-closed-by-user';document.getElementById('google-login').click()");
  await until("!document.getElementById('google-login').disabled");
  check(await evaluate("document.getElementById('auth-status').textContent.includes('닫혔') && [...document.querySelectorAll('[data-requires-auth]')].every(link=>link.hidden)"), 'Closing popup preserves signed-out state and allows retry');
  await evaluate("window.__authTest.nextError='auth/popup-blocked';document.getElementById('google-login').click()");
  await until("!document.getElementById('google-login').disabled");
  check(await evaluate("document.getElementById('auth-status').textContent.includes('차단')"), 'Blocked popup explains how to retry');
  await evaluate("window.__authTest.nextError='auth/unauthorized-domain';document.getElementById('google-login').click()");
  await until("!document.getElementById('google-login').disabled");
  check(await evaluate("document.getElementById('auth-status').textContent.includes('승인된 도메인')"), 'Unauthorized domain error is actionable');
  await evaluate("window.__authTest.skipObserver=true");
  const count=await evaluate("window.__authTest.calls");
  await evaluate("document.getElementById('google-login').dispatchEvent(new MouseEvent('click'));document.getElementById('google-login').dispatchEvent(new MouseEvent('click'))");
  await until("!document.getElementById('google-logout').disabled && !document.getElementById('user-session').hidden");
  check(await evaluate("window.__authTest.calls")==count+1, 'Duplicate sign-in clicks launch one popup');
  check(await evaluate("[...document.querySelectorAll('[data-requires-auth]')].every(link=>!link.hidden && getComputedStyle(link).display!=='none')"), 'Google sign-in reveals all four student and teacher links');
  check(await evaluate("!document.getElementById('student-entry').hidden && !document.getElementById('teacher-entry').hidden && document.getElementById('student-entry').textContent.includes('학생용') && document.getElementById('teacher-entry').textContent.includes('교사용')"), 'Student and teacher buttons have explicit labels together');
  check(await evaluate("!window.__xss && !document.querySelector('#user-name img') && document.getElementById('user-name').textContent.includes('<img')"), 'Account name is safely rendered as text');
  check(await evaluate("(async()=>{const m=await import('/src/accessControl.js');return JSON.stringify(m.parseAdminUids(' a, b; a  c '))===JSON.stringify(['a','b','c'])})()"), 'UID list trims and deduplicates multiple values');
  await evaluate("window.__authTest.observer({uid:'ordinary-student',displayName:'학생'})");
  check(await evaluate("!document.getElementById('student-entry').hidden && [...document.querySelectorAll('[data-requires-admin]')].every(link=>link.hidden)"), 'Ordinary student sees only student activity');
  check(await evaluate("!document.getElementById('auth-status').textContent.includes('교사')"), 'Ordinary student is not prompted to open teacher space');
  await evaluate("window.__authTest.observer({uid:'second-admin',displayName:'두 번째 관리자'})");
  check(await evaluate("[...document.querySelectorAll('[data-requires-admin]')].every(link=>!link.hidden)"), 'Second configured administrator can see teacher links');
  await evaluate("window.__authTest.observer({uid:'test-uid-extra',displayName:'비관리자'})");
  check(await evaluate("[...document.querySelectorAll('[data-requires-admin]')].every(link=>link.hidden)"), 'UID comparison requires exact match');
  await evaluate("window.__authTest.observer({uid:'test-uid',displayName:'관리자'})");
  await evaluate("window.__authTest.logoutError=true;document.getElementById('google-logout').click()");
  await until("!document.getElementById('google-logout').disabled");
  check(await evaluate("!document.getElementById('user-session').hidden && document.getElementById('auth-status').textContent.includes('로그아웃하지 못')"), 'Failed logout preserves signed-in UI and offers retry');
  await evaluate("document.getElementById('google-logout').click()");
  await until("!document.getElementById('google-login').hidden");
  check(await evaluate("[...document.querySelectorAll('[data-requires-auth]')].every(link=>link.hidden) && document.getElementById('user-name').textContent===''"), 'Logout hides every protected link and clears account name');
  await call('Page.navigate',{url:origin+'?restore=1'},session);
  await until("document.getElementById('user-session') && !document.getElementById('user-session').hidden");
  check(await evaluate("[...document.querySelectorAll('[data-requires-auth]')].every(link=>!link.hidden)"), 'Restored Firebase session reveals links on page load');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},session);
  check(await evaluate("document.documentElement.scrollWidth<=innerWidth"), 'Login controls fit a mobile screen');
  await evaluate("window.__authTest.failObserver({code:'auth/network-request-failed'})");
  check(await evaluate("[...document.querySelectorAll('[data-requires-auth]')].every(link=>link.hidden) && document.getElementById('google-login').disabled"), 'Auth observer error hides navigation');
  check(await evaluate("window.__unhandled.length===0"), 'No unhandled authentication errors');
  await call('Page.navigate',{url:origin+'teacherMonitor.html'},session);
  await until("Boolean(window.__authTest?.release) && Boolean(document.getElementById('teacher-content'))");
  check(await evaluate("document.getElementById('teacher-content').hidden && getComputedStyle(document.getElementById('teacher-content')).display==='none'"), 'Teacher content is hidden while session is restoring');
  await evaluate("window.__authTest.release()");
  await until("location.pathname.endsWith('/index.html')");
  check(true, 'Signed-out direct teacher visit redirects to main');
  await call('Page.navigate',{url:origin+'teacherMonitor.html?restore=1'},session);
  await until("document.getElementById('teacher-content') && !document.getElementById('teacher-content').hidden");
  check(await evaluate("document.getElementById('admin-access-status').hidden"), 'Configured administrator can open teacher page');
  await evaluate("window.__authTest.observer({uid:'ordinary-student'})");
  await until("location.pathname.endsWith('/index.html')");
  check(true, 'Switching from admin to student redirects away from teacher page');
  await call('Page.navigate',{url:origin+'teacherMonitor.html'},session);
  await until("Boolean(window.__authTest?.release) && Boolean(document.getElementById('teacher-content'))");
  await evaluate("window.__authTest.observer({uid:'ordinary-student'})");
  await until("location.pathname.endsWith('/index.html')");
  check(true, 'Signed-in nonadministrator direct visit redirects to main');
  await call('Page.navigate',{url:origin+'teacherMonitor.html'},session);
  await until("Boolean(window.__authTest?.release) && Boolean(document.getElementById('teacher-content'))");
  await evaluate("window.__authTest.observer({uid:'second-admin'})");
  check(await evaluate("!document.getElementById('teacher-content').hidden"), 'Second administrator can enter teacher page');
  await evaluate("window.__authTest.observer(null)");
  await until("location.pathname.endsWith('/index.html')");
  check(true, 'Logging out on teacher page redirects to main');
  await call('Page.navigate',{url:origin+'teacherMonitor.html'},session);
  await until("Boolean(window.__authTest?.release) && Boolean(document.getElementById('teacher-content'))");
  await evaluate("window.__authTest.failObserver({code:'auth/network-request-failed'})");
  await until("location.pathname.endsWith('/index.html')");
  check(true, 'Teacher auth observer errors redirect to main');
  noAdminServer=await createServer({configFile:false,plugins:[testPlugin],
    define:{...defines,'import.meta.env.VITE_ADMIN_UIDS':JSON.stringify('')},
    server:{host:'127.0.0.1',port:0},logLevel:'error'});
  await noAdminServer.listen();
  await call('Page.navigate',{url:noAdminServer.resolvedUrls.local[0]+'?restore=1'},session);
  await until("document.getElementById('user-session') && !document.getElementById('user-session').hidden");
  check(await evaluate("!document.getElementById('student-entry').hidden && [...document.querySelectorAll('[data-requires-admin]')].every(link=>link.hidden)"), 'Empty admin list denies teacher links and keeps student access');
  await call('Page.navigate',{url:noAdminServer.resolvedUrls.local[0]+'teacherMonitor.html?restore=1'},session);
  await until("location.pathname.endsWith('/index.html')");
  check(true, 'Empty admin list redirects every teacher visitor');
  emptyServer=await createServer({configFile:false,plugins:[testPlugin],
    define:Object.fromEntries(Object.keys(defines).map(key=>[key,JSON.stringify('')])),
    server:{host:'127.0.0.1',port:0},logLevel:'error'});
  await emptyServer.listen();
  await call('Page.navigate',{url:emptyServer.resolvedUrls.local[0]},session);
  await until("document.getElementById('auth-status')?.textContent.includes('준비되지')");
  check(await evaluate("document.getElementById('google-login').disabled && [...document.querySelectorAll('[data-requires-auth]')].every(link=>link.hidden) && !window.__configReceived"), 'Missing env values are handled without initializing Firebase or revealing links');
  check(await evaluate("window.__unhandled.length===0"), 'Missing configuration creates no unhandled errors');
  await call('Page.navigate',{url:emptyServer.resolvedUrls.local[0]+'teacherMonitor.html'},session);
  await until("location.pathname.endsWith('/index.html')");
  check(true, 'Missing Firebase setup redirects teacher visitor to main');
  console.log('SUCCESS: '+passed+' checks. Google/Firebase authentication mocked; no real accounts used.');
} finally {
  await call('Browser.close').catch(() => {});
  if (chrome.exitCode === null) await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
  if (chrome.exitCode === null) chrome.kill();
  await server.close();
  await emptyServer?.close();
  await noAdminServer?.close();
  const absolute = path.resolve(profile), intendedParent = path.resolve(tmpdir());
  if (path.dirname(absolute) !== intendedParent || !path.basename(absolute).startsWith('maeum-browser-test-')) throw new Error('Unexpected cleanup directory');
  await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
