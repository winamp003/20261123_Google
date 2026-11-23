import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { requestReply } from '../src/openai.js';

const originalFetch = globalThis.fetch;
let passed = 0;
function check(condition, label) { assert.ok(condition, label); console.log('PASS ' + label); passed++; }
const complete = text => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  check(body.model === 'gpt-5-mini' && body.store === false && !('temperature' in body), 'GPT-5 mini request and store:false');
  return { ok: true, json: async () => complete('reply') };
};
assert.equal(await requestReply('test-only-key', [{ role: 'user', content: 'hello' }], 'prompt'), 'reply');
for (const [http, code, expected] of [[401, '', '유효하지'], [403, '', '권한'], [429, 'insufficient_quota', '잔액'], [500, '', '연결']]) {
  globalThis.fetch = async () => ({ ok: false, status: http, json: async () => ({ error: { code } }) });
  await assert.rejects(requestReply('test-only-key', [], ''), error => error.message.includes(expected));
  console.log('PASS HTTP ' + http); passed++;
}
globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'incomplete', output: [] }) });
await assert.rejects(requestReply('test-only-key', [], ''), /끝까지/);
check(true, 'Incomplete response is not committed');
globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
});
await assert.rejects(requestReply('test-only-key', [], '', { timeoutMs: 10 }), /응답 시간/);
check(true, 'Timeout handled');
globalThis.fetch = originalFetch;


const firebaseAppMock = 'export const getApps=()=>[];export const initializeApp=()=>({name:"[DEFAULT]"});';
const firebaseAuthMock = `const t=window.__firebase;
export class GoogleAuthProvider {setCustomParameters(){}}
export const getAuth=()=>t.auth;
export function onAuthStateChanged(auth,callback){
  t.setUser=user=>{auth.currentUser=user;callback(user);};
  queueMicrotask(()=>t.setUser(auth.currentUser));return ()=>{};
}`;
const firestoreMock = `const t=window.__firebase;
export const getFirestore=()=>({});
export const collection=(_db,name)=>({name});
export const doc=collection=>({id:'submission-'+(++t.docCount),collection:collection.name});
export const serverTimestamp=()=>({__serverTimestamp:true});
export async function setDoc(reference,data){
  t.attempts.push({reference,record:structuredClone(data)});
  await new Promise(resolve=>setTimeout(resolve,35));
  if(t.failFirestore){t.failFirestore--;throw {code:'permission-denied'};}
  t.saved[reference.id]=structuredClone(data);
}`;
const storageMock = `const t=window.__firebase;
export const getStorage=()=>({});
export const ref=(_storage,path)=>({fullPath:path});
export async function uploadBytes(reference,blob,metadata){
  t.uploads.push({path:reference.fullPath,type:blob.type,bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),metadata});
  await new Promise(resolve=>setTimeout(resolve,35));
  window.__clock+=10000;
  if(t.failStorage){t.failStorage--;throw {code:'storage/unauthorized'};}
  if(t.signOutDuringUpload)t.setUser(null);
  return {ref:reference};
}`;
const mockSources={'firebase/app':firebaseAppMock,'firebase/auth':firebaseAuthMock,'firebase/firestore':firestoreMock,'firebase/storage':storageMock};
const testPlugin={name:'mock-student-firebase',enforce:'pre',
resolveId(id){if(id in mockSources)return '\0student-test:'+id;},
load(id){if(id.startsWith('\0student-test:'))return mockSources[id.slice('\0student-test:'.length)];}};
const settings={API_KEY:'test-key',AUTH_DOMAIN:'test.firebaseapp.com',PROJECT_ID:'test-project',APP_ID:'test-app',STORAGE_BUCKET:'test-bucket'};
const defines=Object.fromEntries(Object.entries(settings).map(([name,value])=>['import.meta.env.VITE_FIREBASE_'+name,JSON.stringify(value)]));

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
const mock = `window.__clock=100;
Object.defineProperty(performance,'now',{value:()=>window.__clock});
const googleUser={uid:'student-uid',displayName:'Firebase profile',email:'other@example.test',providerData:[{providerId:'google.com',displayName:'학생 <img src=x onerror="window.__xss=true">',email:'student@example.test'}]};
window.__firebase={auth:{currentUser:location.search.includes('signedout')?null:googleUser},user:googleUser,docCount:0,uploads:[],attempts:[],saved:{},failFirestore:0,failStorage:0};
window.__requests = []; window.__nextError = 0;
window.__unhandled = [];
addEventListener('unhandledrejection', e => window.__unhandled.push(String(e.reason)));
window.confirm = () => true;
window.fetch = async (url, options) => {
  if (url !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected endpoint ' + url);
  const body = JSON.parse(options.body);
  window.__requests.push(body);
  const code = window.__nextError; window.__nextError = 0;
  if (code) return { ok: false, status: code, json: async () => ({ error: {} }) };
  return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '함께 돌아보자. <img src=x onerror="window.__xss=true">' }] }] }) };
};`;
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  session = (await call('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await call('Page.enable', {}, session);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: mock }, session);
  await call('Page.navigate', { url: origin + 'student.html' }, session);
  await until("document.getElementById('palette')?.children.length === 8");
  await until("!document.getElementById('student-workspace').hidden");
  check(await evaluate("document.getElementById('student-name').textContent.startsWith('학생') && document.getElementById('student-email').textContent==='student@example.test' && !document.querySelector('#student-name img')"), 'Header displays safe Google identity');
  check(await evaluate("document.getElementById('activity').hidden && document.getElementById('drawing-panel').hidden"), 'API gate hides chat and drawing');
  await evaluate("window.__nextError=401; document.getElementById('api-key').value='test-only-key'; document.getElementById('key-form').requestSubmit()");
  await until("!document.getElementById('connect').disabled");
  check(await evaluate("document.getElementById('activity').hidden && document.getElementById('key-status').textContent.includes('유효하지')"), 'Invalid key keeps activity locked');
  await evaluate("document.getElementById('key-form').requestSubmit()");
  await until("!document.getElementById('activity').hidden");
  check(await evaluate("document.getElementById('api-key').value === '' && document.getElementById('finish-chat').disabled"), 'Key input cleared; minimum three exchanges enforced');
  check(await evaluate("!window.__xss && !document.querySelector('#chat-log img')"), 'Model text is rendered without executing HTML');
  for (let turn = 1; turn <= 3; turn++) {
    await evaluate('window.__clock='+turn*1000);
    await evaluate("document.getElementById('message').value='오늘의 이야기'; document.getElementById('chat-form').requestSubmit()");
    await until("!document.getElementById('send').disabled");
    check(await evaluate("document.getElementById('turn-count').textContent.includes('" + turn + " / 7')"), 'Successful exchange ' + turn);
  }
  check(await evaluate("!document.getElementById('finish-chat').disabled && document.getElementById('drawing-panel').hidden"), 'Three turns enable manual finish without opening drawing');
  await evaluate("window.__nextError=429; document.getElementById('message').value='다시 시도할 이야기'; document.getElementById('chat-form').requestSubmit()");
  await until("!document.getElementById('send').disabled");
  check(await evaluate("document.getElementById('turn-count').textContent.includes('3 / 7') && document.getElementById('message').value==='다시 시도할 이야기'"), 'Failed request preserves draft and turn count');
  for (let turn = 4; turn <= 7; turn++) {
    await evaluate("document.getElementById('message').value='오늘의 이야기'; document.getElementById('chat-form').requestSubmit()");
    await until("document.getElementById('turn-count').textContent.includes('" + turn + " / 7')");
  }
  check(await evaluate("document.getElementById('send').disabled && document.getElementById('message').disabled && !document.getElementById('finish-chat').disabled"), 'Seven turns stop extra messages and retain finish button');
  const count = await evaluate('window.__requests.length');
  await evaluate("document.getElementById('chat-form').dispatchEvent(new Event('submit',{cancelable:true}))");
  check(await evaluate('window.__requests.length') === count, 'Hard guard prevents eighth API call');
  check(await evaluate("window.__requests.at(-1).input.length===14 && window.__requests.at(-1).instructions.includes('새 질문 없이')"), 'Conversation context and final-turn prompt sent');
  await evaluate("window.__clock=15000; document.getElementById('finish-chat').click()");
  await until("!document.getElementById('drawing-panel').hidden");
  check(await evaluate("document.getElementById('chat-panel').hidden && document.querySelectorAll('#review-log .message').length === 15 && document.getElementById('submit-drawing').disabled"), 'Manual finish opens blank drawing with conversation review');
  check(await evaluate("Array.from(document.getElementById('drawing-canvas').getContext('2d').getImageData(200,200,1,1).data).every(v=>v===255)"), 'Canvas starts opaque white');
  await evaluate("document.getElementById('eraser').click()");
  async function stroke(x, y, endX = x + 80) {
    const { x: left, y: top, width, height } = await evaluate("(()=>{const r=document.getElementById('drawing-canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
    const px = left + x / 1000 * width, py = top + y / 700 * height;
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 }, session);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: left + endX / 1000 * width, y: py, button: 'left', buttons: 1 }, session);
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: left + endX / 1000 * width, y: py, button: 'left', clickCount: 1 }, session);
  }
  await evaluate("document.getElementById('drawing-canvas').scrollIntoView({block:'center',behavior:'instant'})");
  await stroke(100, 100);
  check(await evaluate("document.getElementById('submit-drawing').disabled"), 'Eraser on blank canvas does not count as drawing');
  await evaluate("document.getElementById('pen').click(); document.getElementById('opacity').value=50; document.getElementById('opacity').dispatchEvent(new Event('input'))");
  await stroke(200, 200);
  check(await evaluate("!document.getElementById('submit-drawing').disabled && !document.getElementById('undo').disabled"), 'Pointer stroke enables submission and undo');
  check(await evaluate("(()=>{const p=document.getElementById('drawing-canvas').getContext('2d').getImageData(240,200,1,1).data;return p[0]>140&&p[0]<180&&p[3]===255})()"), 'Stroke opacity blends onto white');
  await evaluate("document.getElementById('undo').click()");
  check(await evaluate("document.getElementById('submit-drawing').disabled"), 'Undo restores blank canvas');
  await evaluate("document.getElementById('brightness').value=0; document.getElementById('brightness').dispatchEvent(new Event('input')); document.getElementById('opacity').value=100; document.getElementById('opacity').dispatchEvent(new Event('input'))");
  await stroke(200, 200);
  check(await evaluate("document.getElementById('drawing-canvas').getContext('2d').getImageData(240,200,1,1).data[0]===0"), 'Brightness control reaches black');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
  check(await evaluate("document.getElementById('drawing-canvas').getContext('2d').getImageData(240,200,1,1).data[0]===0 && document.documentElement.scrollWidth<=innerWidth"), 'Mobile layout preserves canvas without horizontal overflow');
  await evaluate("window.__firebase.failStorage=1; window.__clock=18000; document.getElementById('submit-drawing').click()");
  await until("!document.getElementById('submit-drawing').disabled");
  check(await evaluate("window.__firebase.uploads.length===1 && window.__firebase.attempts.length===0 && document.getElementById('drawing-status').textContent.includes('권한')"), 'Storage failure prevents Firestore write and allows retry');
  await evaluate("window.__firebase.failFirestore=1; window.__clock=20000; document.getElementById('submit-drawing').dispatchEvent(new MouseEvent('click')); document.getElementById('submit-drawing').dispatchEvent(new MouseEvent('click'))");
  check(await evaluate("document.getElementById('submit-drawing').disabled && document.getElementById('drawing-controls').disabled && document.getElementById('drawing-canvas').getAttribute('aria-disabled')==='true'"), 'Saving locks drawing and duplicate clicks');
  await until("!document.getElementById('submit-drawing').disabled");
  check(await evaluate("window.__firebase.uploads.length===2 && window.__firebase.attempts.length===1 && Object.keys(window.__firebase.saved).length===0"), 'Firestore failure is not reported as complete');
  check(await evaluate("window.__firebase.attempts[0].record.chatDurationMs===14000 && window.__firebase.attempts[0].record.drawingDurationMs===5000"), 'Timers capture first send, finish click and submit click without upload wait');
  check(await evaluate("document.getElementById('drawing-status').textContent.includes('권한') && !document.getElementById('drawing-controls').disabled"), 'Failed submission preserves editable artwork and helpful error');
  check(await evaluate("new Promise(resolve=>document.getElementById('drawing-canvas').toBlob(b=>resolve(b.type==='image/png'&&b.size>0)))"), 'PNG export creates an image');
  await evaluate("document.getElementById('clear-canvas').click()");
  check(await evaluate("document.getElementById('submit-drawing').disabled"), 'Clear returns canvas to blank');
  await evaluate("document.getElementById('undo').click()");
  check(await evaluate("!document.getElementById('submit-drawing').disabled"), 'Clear can be undone');
  check(await evaluate("localStorage.length === 0 && sessionStorage.length === 0 && window.__unhandled.length === 0"), 'No stored credentials or unhandled promise errors');
  await evaluate("document.getElementById('change-key').click(); document.getElementById('api-key').value='replacement-test-key'; document.getElementById('key-form').requestSubmit()");
  await until("!document.getElementById('activity').hidden");
  check(await evaluate("!document.getElementById('drawing-panel').hidden && !document.getElementById('submit-drawing').disabled"), 'Changing API key preserves drawing');
  await evaluate("window.__clock=35000;document.getElementById('submit-drawing').click()");
  await until("document.getElementById('submit-drawing').textContent==='제출 완료'");
  check(await evaluate("window.__firebase.docCount===1 && Object.keys(window.__firebase.saved).length===1 && window.__firebase.uploads.every(u=>u.path==='studentDrawings/student-uid/submission-1.png')"), 'All retries reuse one document and PNG path');
  check(await evaluate("(()=>{const d=window.__firebase.saved['submission-1'];return d.studentUid==='student-uid' && d.studentName.startsWith('학생') && d.googleEmail==='student@example.test' && d.messages.length===15 && d.turnCount===7 && d.messages[0].role==='assistant' && d.messages[1].role==='user' && d.messages.at(-1).role==='assistant'})()"), 'Firestore saves Google identity and entire ordered conversation');
  check(await evaluate("(()=>{const d=window.__firebase.saved['submission-1'];return d.chatDurationMs===14000 && d.drawingDurationMs===20000 && d.chatStartedAt instanceof Date && d.chatEndedAt instanceof Date && d.submittedAtClient instanceof Date && d.submittedAt.__serverTimestamp})()"), 'Firestore stores precise durations, client boundaries and server timestamp');
  check(await evaluate("(()=>{const u=window.__firebase.uploads.at(-1),d=window.__firebase.saved['submission-1'];return u.type==='image/png'&&u.metadata.contentType==='image/png'&&JSON.stringify(u.bytes.slice(0,8))==='[137,80,78,71,13,10,26,10]'&&d.drawing.storagePath===u.path&&d.drawing.width===1000&&d.drawing.height===700&&d.drawing.sizeBytes===u.bytes.length})()"), 'Storage receives real PNG bytes and Firestore stores image reference');
  check(await evaluate("!JSON.stringify(window.__firebase.saved).includes('replacement-test-key') && !JSON.stringify(window.__firebase.saved).includes('test-only-key')"), 'No OpenAI API key is stored with submission');
  await evaluate("document.getElementById('submit-drawing').dispatchEvent(new MouseEvent('click'))");
  check(await evaluate("window.__firebase.uploads.length===3 && document.getElementById('drawing-controls').disabled && !document.getElementById('drawing-status').textContent.includes('Firebase 연결 전')"), 'Successful submission is locked against duplicate upload');
  await call('Page.navigate',{url:origin+'student.html?signedout=1'},session);
  await until("document.getElementById('student-auth-status')?.textContent.includes('로그인해')");
  check(await evaluate("document.getElementById('student-workspace').hidden && document.getElementById('student-workspace').disabled && !document.getElementById('student-login-link').hidden"), 'Signed-out visitors cannot start or submit student activity');
  await evaluate("window.__firebase.setUser(window.__firebase.user)");
  await until("!document.getElementById('student-workspace').hidden");
  await evaluate("window.__firebase.setUser({...window.__firebase.user,uid:'different-uid'})");
  check(await evaluate("document.getElementById('student-workspace').hidden && document.getElementById('student-auth-status').textContent.includes('계정이 바뀌')"), 'Changing account locks existing session to prevent mixed submissions');
  check(await evaluate("window.__unhandled.length===0"), 'Authentication changes create no unhandled error');
  console.log('SUCCESS: ' + passed + ' checks. OpenAI and Firebase mocked; no paid API calls or real student records.');
} finally {
  await call('Browser.close').catch(() => {});
  if (chrome.exitCode === null) await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
  if (chrome.exitCode === null) chrome.kill();
  await server.close();
  const absolute = path.resolve(profile), intendedParent = path.resolve(tmpdir());
  if (path.dirname(absolute) !== intendedParent || !path.basename(absolute).startsWith('maeum-browser-test-')) throw new Error('Unexpected cleanup directory');
  await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
