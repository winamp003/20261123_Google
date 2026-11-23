import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
let passed=0;
function check(value,label){assert.ok(value,label);console.log('PASS '+label);passed++;}
const appMock='export const getApps=()=>[];export const initializeApp=()=>({name:"[DEFAULT]"});';
const authMock=`const t=window.__monitor;export class GoogleAuthProvider{setCustomParameters(){}}
export const getAuth=()=>t.auth;
export const signInWithPopup=async()=>({user:t.auth.currentUser});export const signOut=async()=>{t.setUser(null);};
export function onAuthStateChanged(auth,callback){t.setUser=user=>{auth.currentUser=user;callback(user);};queueMicrotask(()=>callback(auth.currentUser));return ()=>{};}`;
const firestoreMock=`const t=window.__monitor;
export const getFirestore=()=>({});
export const collection=(_db,name)=>({name});
export const doc=(_db,collection,id)=>({id,collection});
export async function getDocsFromServer(){t.loads++;if(t.loadError)throw {code:'permission-denied'};return {docs:t.rows.map(row=>({id:row.id,data:()=>row.data}))};}
export async function deleteDoc(reference){
 t.docDeletes.push(reference.id);await new Promise(resolve=>setTimeout(resolve,10));
 if(t.docDeleteError){t.docDeleteError=false;throw {code:'permission-denied'};}
 t.rows=t.rows.filter(row=>row.id!==reference.id);
}`;
const storageMock=`const t=window.__monitor;
export const getStorage=()=>({});
export const ref=(_storage,path)=>({fullPath:path});
export async function getBlob(reference){
 t.pictureLoads.push(reference.fullPath);
 const slow=t.slowPicture && reference.fullPath.includes('/one.png');
 if(slow)await new Promise(resolve=>setTimeout(resolve,120));
 if(t.imageError)throw {code:'storage/object-not-found'};
 const raw=atob(t.imageUrl.split(',')[1]);return new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'image/png'});
}
export async function deleteObject(reference){
 t.objectDeletes.push(reference.fullPath);
 await new Promise(resolve=>setTimeout(resolve,10));
 if(t.objectDeleteError){t.objectDeleteError=false;throw {code:'storage/unauthorized'};}
 if(t.deletedObjects.includes(reference.fullPath))throw {code:'storage/object-not-found'};
 t.deletedObjects.push(reference.fullPath);
}`;
const mockSources={'firebase/app':appMock,'firebase/auth':authMock,'firebase/firestore':firestoreMock,'firebase/storage':storageMock};
const testPlugin={name:'mock-teacher-data',enforce:'pre',resolveId(id){if(id in mockSources)return '\0monitor-test:'+id;},
load(id){if(id.startsWith('\0monitor-test:'))return mockSources[id.slice('\0monitor-test:'.length)];}};
const defines={
'import.meta.env.VITE_FIREBASE_API_KEY':JSON.stringify('test-key'),
'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN':JSON.stringify('test.firebaseapp.com'),
'import.meta.env.VITE_FIREBASE_PROJECT_ID':JSON.stringify('test-project'),
'import.meta.env.VITE_FIREBASE_APP_ID':JSON.stringify('test-app'),
'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET':JSON.stringify('test-bucket'),
'import.meta.env.VITE_ADMIN_UIDS':JSON.stringify('teacher-uid'),
};
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

const mock=`window.__unhandled=[];addEventListener('unhandledrejection',e=>window.__unhandled.push(String(e.reason)));
const imageCanvas=document.createElement('canvas');imageCanvas.width=10;imageCanvas.height=7;
const make=(id,name,date)=>({id,data:{studentUid:'student-uid',studentName:name,googleEmail:name+'@example.test',submittedAtClient:date,submittedAt:'2026-11-25T00:00:00Z',
messages:[{role:'assistant',content:'학교 공부는 어땠니?'},{role:'user',content:'<img src=x onerror="window.__xss=true"> 재밌었어요.'}],chatDurationMs:65000,drawingDurationMs:90000,turnCount:3,
drawing:{storagePath:'studentDrawings/student-uid/'+id+'.png'}}});
window.__monitor={auth:{currentUser:{uid:'teacher-uid',displayName:'선생님',email:'teacher@example.test'}},
rows:[make('one','가학생','2026-11-22T15:30:00Z'),make('two','나학생','2026-11-23T02:00:00Z'),make('three','가학생','2026-11-22T02:00:00Z')],
loads:0,pictureLoads:[],docDeletes:[],objectDeletes:[],deletedObjects:[],imageUrl:imageCanvas.toDataURL('image/png'),loadError:false,imageError:false,slowPicture:false};
window.__confirm=true;window.confirm=()=>window.__confirm;
`;
try{
const {targetId}=await call('Target.createTarget',{url:'about:blank'});
session=(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId;
await call('Page.enable',{},session);
await call('Page.addScriptToEvaluateOnNewDocument',{source:mock},session);
await call('Page.navigate',{url:origin+'teacherMonitor.html'},session);
await until("document.getElementById('record-count')?.textContent==='2건'");
check(await evaluate("document.getElementById('teacher-name').textContent==='선생님' && document.getElementById('teacher-email').textContent==='teacher@example.test'"),'Header displays authenticated teacher');
check(await evaluate("[...document.querySelectorAll('#date-options input')].map(i=>i.value).join(',')==='2026-11-23,2026-11-22'"),'All dates use Korean timezone and submission-click time');
check(await evaluate("document.querySelectorAll('#date-options input:checked').length===1 && document.querySelector('#date-options input:checked').value==='2026-11-23'"),'Latest date selected initially');
check(await evaluate("document.querySelectorAll('.record-item').length===2 && document.querySelector('.record-open').textContent==='나학생 (2026-11-23, 11:00:00)'"),'Each submission is listed as name, date and time');
await evaluate("document.querySelector('[data-record-id=one] .record-open').click()");
await until("!document.getElementById('student-picture').hidden");
check(await evaluate("document.querySelectorAll('.monitor-message').length===2 && document.getElementById('conversation-title').textContent==='가학생' && document.getElementById('selected-email').textContent==='가학생@example.test'"),'Record selection shows full conversation and identity');
check(await evaluate("document.getElementById('chat-duration').textContent==='1분 5초' && document.getElementById('drawing-duration').textContent==='1분 30초'"),'Detail shows chat and drawing durations');
check(await evaluate("document.getElementById('student-picture').src.startsWith('blob:')"),'Image is displayed from authenticated bytes, not a token URL');
check(await evaluate("!window.__xss && !document.querySelector('#conversation-log img')"),'Conversation text cannot execute HTML');
check(await evaluate("window.__monitor.pictureLoads.at(-1)==='studentDrawings/student-uid/one.png' && document.getElementById('student-picture').alt.includes('가학생')"),'Correct Storage PNG is displayed');
await evaluate("document.querySelector('#date-options input[value=\"2026-11-22\"]').click()");
check(await evaluate("document.querySelectorAll('.record-item').length===3"),'Date checkboxes support multiple dates');
await evaluate("document.getElementById('record-search').value='가학생';document.getElementById('record-search').dispatchEvent(new Event('input'))");
check(await evaluate("document.querySelectorAll('.record-item').length===2"),'Same student submissions remain separate and searchable');
await evaluate("document.getElementById('record-search').value='나학생@example.test';document.getElementById('record-search').dispatchEvent(new Event('input'))");
check(await evaluate("document.querySelectorAll('.record-item').length===1 && document.getElementById('conversation-title').textContent.includes('선택') && document.getElementById('student-picture').hidden"),'Email filter clears a detail no longer visible');
await evaluate("document.getElementById('record-search').value='';document.getElementById('record-search').dispatchEvent(new Event('input'));document.getElementById('clear-dates').click()");
check(await evaluate("document.getElementById('record-count').textContent==='0건' && document.getElementById('record-list').textContent.includes('날짜를 선택')"),'No selected dates shows a clear empty state');
await evaluate("document.getElementById('select-all-dates').click()");
await evaluate("window.__monitor.slowPicture=true;document.querySelector('[data-record-id=one] .record-open').click();document.querySelector('[data-record-id=two] .record-open').click()");
await until("!document.getElementById('student-picture').hidden");
await new Promise(resolve=>setTimeout(resolve,150));
check(await evaluate("document.getElementById('student-picture').alt.includes('나학생')"),'Slow previous image cannot replace current selection');
await evaluate("window.__monitor.imageError=true;document.querySelector('[data-record-id=three] .record-open').click()");
await until("!document.getElementById('retry-picture').hidden");
check(await evaluate("document.getElementById('picture-status').textContent.includes('찾을 수') && document.querySelectorAll('.monitor-message').length===2"),'Missing picture keeps conversation visible and allows retry');
await evaluate("window.__monitor.imageError=false;document.getElementById('retry-picture').click()");
await until("!document.getElementById('student-picture').hidden");
check(true,'Picture retry succeeds');
await evaluate("window.__confirm=false;document.querySelector('[data-record-id=three] .record-delete').click()");
check(await evaluate("window.__monitor.objectDeletes.length===0 && window.__monitor.docDeletes.length===0"),'Canceling deletion performs no writes');
await evaluate("window.__confirm=true;window.__monitor.objectDeleteError=true;document.querySelector('[data-record-id=three] .record-delete').click()");
await until("document.getElementById('monitor-status').textContent.includes('접근 권한')");
check(await evaluate("window.__monitor.docDeletes.length===0 && document.querySelector('[data-record-id=three]')!==null"),'Storage failure preserves Firestore document and list entry');
await evaluate("window.__monitor.docDeleteError=true;document.querySelector('[data-record-id=three] .record-delete').click()");
await until("document.getElementById('monitor-status').textContent.includes('그림 삭제 단계')");
check(await evaluate("document.querySelector('[data-record-id=three]')!==null && window.__monitor.docDeletes.length===1"),'Partial deletion is clearly reported and retry remains possible');
await evaluate("document.querySelector('[data-record-id=three] .record-delete').click();document.querySelector('[data-record-id=one] .record-delete').dispatchEvent(new MouseEvent('click'))");
await until("document.querySelector('[data-record-id=three]')===null");
check(await evaluate("window.__monitor.docDeletes.length===2 && window.__monitor.rows.length===2"),'Deletion retry tolerates missing PNG and blocks concurrent delete');
check(await evaluate("document.querySelector('#date-options input[value=\"2026-11-22\"]')===null && document.getElementById('student-picture').hidden && document.getElementById('conversation-title').textContent.includes('선택')"),'Deleting last record for a date removes date and selected detail');
await evaluate("document.getElementById('refresh-records').click()");
await until("!document.getElementById('refresh-records').disabled");
check(await evaluate("document.querySelectorAll('.record-item').length===2 && window.__monitor.loads===2"),'Refresh reflects server records');
await evaluate("window.__monitor.loadError=true;document.getElementById('refresh-records').click()");
await until("document.getElementById('monitor-status').textContent.includes('접근 권한')");
check(await evaluate("document.querySelectorAll('.record-item').length===0 && document.getElementById('student-picture').hidden"),'Read failure clears stale records and shows permission error');
await evaluate("window.__monitor.loadError=false;document.getElementById('refresh-records').click()");
await until("!document.getElementById('refresh-records').disabled");
await evaluate("document.getElementById('select-all-dates').click()");
check(await evaluate("document.querySelectorAll('.record-item').length===2"),'Refresh recovers after read failure');
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},session);
check(await evaluate("document.documentElement.scrollWidth<=innerWidth"),'Mobile monitor layout has no horizontal overflow');
await evaluate("window.__monitor.rows=[];document.getElementById('refresh-records').click()");
await until("document.getElementById('monitor-status').textContent.includes('전체 0건')");
check(await evaluate("document.getElementById('record-list').textContent.includes('아직 제출')"),'Empty database has explicit empty state');
check(await evaluate("window.__unhandled.length===0"),'No unhandled errors during filtering, loading or deletion');
await evaluate("window.__monitor.setUser(null)");
await until("location.pathname.endsWith('/index.html')");
check(true,'Revoked administrator session redirects to main');
console.log('SUCCESS: '+passed+' checks. Firestore and Storage mocked; no real records deleted.');
} finally {
  await call('Browser.close').catch(() => {});
  if (chrome.exitCode === null) await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
  if (chrome.exitCode === null) chrome.kill();
  await server.close();


  const absolute = path.resolve(profile), intendedParent = path.resolve(tmpdir());
  if (path.dirname(absolute) !== intendedParent || !path.basename(absolute).startsWith('maeum-browser-test-')) throw new Error('Unexpected cleanup directory');
  await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
