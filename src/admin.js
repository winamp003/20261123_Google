import './styles.css';
import './monitor.css';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firebaseSetupError } from './firebaseConfig.js';
import { isAdmin } from './accessControl.js';
import { loadRecords, loadPicture, deleteRecord, formatDuration, monitorError } from './monitorData.js';

const $ = id => document.getElementById(id);
let records = [], selectedDates = new Set(), selectedId = null, filterInitialized = false;
let loading = false, deletingId = null, pictureRequest = 0, loadRequest = 0, authorizedUid = null;
let pictureObjectUrl = null;

function authorized() { return isAdmin(auth?.currentUser) && auth.currentUser.uid === authorizedUid; }
function setStatus(text, error = false) {
  $('monitor-status').textContent = text;
  $('monitor-status').classList.toggle('error', error);
}
function returnHome() {
  authorizedUid = null; pictureRequest++; loadRequest++;
  records = []; selectedId = null; clearDetail();
  $('record-list').replaceChildren(); $('date-options').replaceChildren();
  $('teacher-content').hidden = true;
  $('admin-access-status').hidden = false;
  $('admin-access-status').textContent = '메인 화면으로 돌아가고 있어요…';
  window.location.replace('./index.html');
}
function empty(target, text) {
  const p = document.createElement('p'); p.className = 'empty-note'; p.textContent = text;
  target.replaceChildren(p);
}
function releasePicture() {
  $('student-picture').removeAttribute('src');
  if (pictureObjectUrl) { URL.revokeObjectURL(pictureObjectUrl); pictureObjectUrl = null; }
}
window.addEventListener('pagehide', () => { pictureRequest++; releasePicture(); });
function clearDetail() {
  pictureRequest++;
  $('conversation-title').textContent = '이야기를 선택해 주세요.';
  $('selected-email').textContent = ''; $('selected-time').textContent = '';
  $('activity-metrics').hidden = true;
  empty($('conversation-log'), '왼쪽에서 학생 기록을 선택하면 대화가 여기에 표시돼요.');
  $('student-picture').hidden = true; releasePicture();
  $('student-picture').onload = $('student-picture').onerror = null;
  $('picture-status').hidden = false; $('picture-status').textContent = '선택한 학생의 그림이 여기에 표시돼요.';
  $('retry-picture').hidden = true;
}
function dateBuckets() {
  const dates = new Map();
  for (const record of records) dates.set(record.dateKey, (dates.get(record.dateKey) || 0) + 1);
  return [...dates].sort(([a], [b]) => a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a));
}
function renderDates() {
  $('date-options').replaceChildren();
  const dates = dateBuckets();
  if (!dates.length) { empty($('date-options'), '아직 제출된 기록이 없어요.'); return; }
  for (const [key, count] of dates) {
    const label = document.createElement('label'); label.className = 'date-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = key; input.checked = selectedDates.has(key);
    input.addEventListener('change', () => {
      if (input.checked) selectedDates.add(key); else selectedDates.delete(key);
      renderList();
    });
    const text = document.createElement('span'); text.textContent = key === 'unknown' ? '날짜 미상' : key.replaceAll('-', '.');
    const total = document.createElement('span'); total.className = 'date-total'; total.textContent = count + '건';
    label.append(input, text, total); $('date-options').append(label);
  }
}
function visibleRecords() {
  const search = $('record-search').value.trim().toLocaleLowerCase('ko');
  return records.filter(record => selectedDates.has(record.dateKey) &&
    (record.name + ' ' + (record.googleEmail || '')).toLocaleLowerCase('ko').includes(search));
}
function renderList() {
  const visible = visibleRecords();
  $('record-count').textContent = visible.length + '건';
  $('record-list').replaceChildren();
  for (const record of visible) {
    const row = document.createElement('div'); row.className = 'record-item'; row.dataset.recordId = record.id;
    const open = document.createElement('button'); open.type = 'button'; open.className = 'record-open';
    open.setAttribute('aria-pressed', String(selectedId === record.id)); open.textContent = record.title;
    open.addEventListener('click', () => selectRecord(record));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'record-delete'; remove.textContent = deletingId === record.id ? '삭제 중…' : '삭제';
    remove.setAttribute('aria-label', record.title + ' 삭제'); remove.disabled = Boolean(deletingId) || loading;
    remove.addEventListener('click', () => removeRecord(record));
    row.append(open, remove); $('record-list').append(row);
  }
  if (!visible.length) empty($('record-list'), !records.length ? '아직 제출된 기록이 없어요.' : !selectedDates.size ? '확인할 날짜를 선택해 주세요.' : '조건에 맞는 학생 기록이 없어요.');
  if (selectedId && !visible.some(record => record.id === selectedId)) { selectedId = null; clearDetail(); }
}
async function showPicture(record) {
  const ticket = ++pictureRequest;
  const image = $('student-picture');
  image.hidden = true; releasePicture(); image.onload = image.onerror = null;
  $('picture-status').hidden = false; $('picture-status').textContent = '그림을 불러오고 있어요…';
  $('retry-picture').hidden = true;
  try {
    const blob = await loadPicture(record);
    if (ticket !== pictureRequest || selectedId !== record.id || !authorized()) return;
    image.alt = record.name + ' 학생이 그린 오늘의 마음 그림';
    image.onload = () => {
      if (ticket !== pictureRequest) return;
      image.hidden = false; $('picture-status').hidden = true;
    };
    image.onerror = () => {
      if (ticket !== pictureRequest) return;
      image.hidden = true; $('picture-status').hidden = false;
      $('picture-status').textContent = '그림을 표시하지 못했어요. 다시 불러와 주세요.';
      $('retry-picture').hidden = false;
    };
    pictureObjectUrl = URL.createObjectURL(blob);
    image.src = pictureObjectUrl;
  } catch (error) {
    if (ticket !== pictureRequest || !authorized()) return;
    $('picture-status').textContent = monitorError(error); $('retry-picture').hidden = false;
  }
}
function selectRecord(record) {
  if (!authorized()) { returnHome(); return; }
  selectedId = record.id;
  $('conversation-title').textContent = record.name;
  $('selected-email').textContent = record.googleEmail || '이메일 기록 없음';
  $('selected-time').textContent = (record.dateKey === 'unknown' ? '날짜 미상' : record.dateKey) + ' ' + record.time + ' · 한국 시간';
  $('chat-duration').textContent = formatDuration(record.chatDurationMs);
  $('drawing-duration').textContent = formatDuration(record.drawingDurationMs);
  $('selected-turns').textContent = Number.isFinite(record.turnCount) ? record.turnCount + '회' : '기록 없음';
  $('activity-metrics').hidden = false;
  $('conversation-log').replaceChildren();
  const messages = Array.isArray(record.messages) ? record.messages : [];
  for (const message of messages) {
    const bubble = document.createElement('article'); bubble.className = 'monitor-message ' + (message.role === 'user' ? 'student-message' : 'friend-message');
    const name = document.createElement('strong'); name.textContent = message.role === 'user' ? record.name : '마음 친구';
    const text = document.createElement('p'); text.textContent = typeof message.content === 'string' ? message.content : '';
    bubble.append(name, text); $('conversation-log').append(bubble);
  }
  if (!messages.length) empty($('conversation-log'), '저장된 대화가 없어요.');
  $('conversation-log').scrollTop = 0;
  renderList(); showPicture(record);
}
async function refresh() {
  if (!authorized() || loading || deletingId) return;
  const ticket = ++loadRequest;
  loading = true; $('refresh-records').disabled = true;
  setStatus('학생들의 제출 기록을 불러오고 있어요…');
  try {
    const next = await loadRecords();
    if (ticket !== loadRequest || !authorized()) return;
    records = next;
    const available = new Set(dateBuckets().map(([date]) => date));
    if (!filterInitialized) { selectedDates = new Set(available.size ? [available.values().next().value] : []); filterInitialized = true; }
    else selectedDates = new Set([...selectedDates].filter(date => available.has(date)));
    renderDates(); renderList();
    const current = records.find(record => record.id === selectedId);
    if (current) selectRecord(current);
    setStatus('전체 ' + records.length + '건의 기록 · 데이터가 있는 날짜 ' + available.size + '개');
  } catch (error) {
    if (ticket !== loadRequest || !authorized()) return;
    records = []; selectedId = null; clearDetail(); renderDates(); renderList();
    setStatus(monitorError(error), true);
  } finally {
    if (ticket === loadRequest) { loading = false; $('refresh-records').disabled = false; renderList(); }
  }
}
async function removeRecord(record) {
  if (!authorized() || deletingId || loading) return;
  if (!window.confirm(record.title + '\n이 제출의 전체 대화와 그림을 삭제할까요? 삭제한 자료는 되돌릴 수 없어요.')) return;
  deletingId = record.id; $('refresh-records').disabled = true; renderList();
  setStatus('선택한 기록과 그림을 삭제하고 있어요…');
  try {
    await deleteRecord(record);
    if (!authorized()) return;
    records = records.filter(item => item.id !== record.id);
    if (selectedId === record.id) { selectedId = null; clearDetail(); }
    const available = new Set(dateBuckets().map(([key]) => key));
    selectedDates = new Set([...selectedDates].filter(date => available.has(date)));
    renderDates(); setStatus('선택한 대화 기록과 그림을 삭제했어요.');
  } catch (error) {
    if (!authorized()) return;
    setStatus(monitorError(error), true);
    if (selectedId === record.id) showPicture(record);
  } finally {
    deletingId = null;
    if (authorized()) { $('refresh-records').disabled = false; renderList(); }
  }
}
$('refresh-records').addEventListener('click', refresh);
$('record-search').addEventListener('input', renderList);
$('select-all-dates').addEventListener('click', () => { selectedDates = new Set(dateBuckets().map(([key]) => key)); renderDates(); renderList(); });
$('clear-dates').addEventListener('click', () => { selectedDates.clear(); renderDates(); renderList(); });
$('retry-picture').addEventListener('click', () => { const record = records.find(item => item.id === selectedId); if (record) showPicture(record); });
if (firebaseSetupError || !auth) returnHome();
else {
  try {
    onAuthStateChanged(auth, user => {
      if (!isAdmin(user)) { returnHome(); return; }
      const changed = authorizedUid !== user.uid;
      authorizedUid = user.uid;
      $('teacher-name').textContent = user.displayName || '관리자';
      $('teacher-email').textContent = user.email || '';
      $('admin-access-status').hidden = true; $('teacher-content').hidden = false;
      if (changed) refresh();
    }, returnHome);
  } catch { returnHome(); }
}
