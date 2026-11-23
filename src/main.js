import './styles.css';
import './student.css';
import { requestReply } from './openai.js';
import { BASE_PROMPT, turnPrompt } from './prompts.js';
import { createDrawing } from './drawing.js';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firebaseSetupError } from './firebaseConfig.js';
import { createSubmission, googleIdentity, submissionErrorMessage } from './submissions.js';
import { createActivityTimer } from './activityTimer.js';

const $ = id => document.getElementById(id);
let apiKey = '', turns = 0, busy = false, stage = 'chat', drawing = null;
let messages = [];
let dirty = false;
const MIN_TURNS = 3, MAX_TURNS = 7;
const activityTimer = createActivityTimer();
let currentStudent = null, ownerUid = null, submitting = false, submitted = false, submission = null;

function hasStudent() {
  return Boolean(currentStudent && auth?.currentUser?.uid === ownerUid);
}
function updateDrawingControls() {
  const locked = !hasStudent() || submitting || submitted;
  $('drawing-controls').disabled = locked;
  drawing?.setEnabled(!locked);
  $('submit-drawing').disabled = locked || !drawing?.hasDrawing;
  $('submit-drawing').textContent = submitted ? '제출 완료' : submitting ? '저장 중…' : '제출하기';
  $('change-key').disabled = busy || submitting || submitted;
}
function showStudent(user) {
  const identity = googleIdentity(user);
  currentStudent = identity && (!ownerUid || ownerUid === user.uid) ? user : null;
  if (currentStudent && !ownerUid) ownerUid = user.uid;
  $('student-name').textContent = identity?.studentName || '';
  $('student-email').textContent = identity?.googleEmail || '';
  $('student-profile').hidden = !identity;
  $('student-workspace').hidden = !currentStudent;
  $('student-workspace').disabled = !currentStudent;
  $('student-login-link').hidden = Boolean(currentStudent);
  status('student-auth-status', currentStudent ? 'Google 계정으로 접속했어요.'
    : identity ? '활동 중 계정이 바뀌었어요. 첫 화면으로 돌아가 새 활동을 시작해 주세요.'
    : '학생 활동을 하려면 첫 화면에서 Google로 로그인해 주세요.', !currentStudent);
  updateDrawingControls();
}
if (auth && !firebaseSetupError) {
  onAuthStateChanged(auth, showStudent, () => {
    showStudent(null);
    status('student-auth-status', '로그인 상태를 확인하지 못했어요. 첫 화면에서 다시 로그인해 주세요.', true);
  });
} else {
  status('student-auth-status', 'Firebase 로그인 설정을 확인해 주세요.', true);
  $('student-login-link').hidden = false;
}

function status(id, text, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
}
function setStep(step) {
  for (const name of ['key', 'chat', 'draw']) {
    $('step-' + name).removeAttribute('aria-current');
    if (name === step) $('step-' + name).setAttribute('aria-current', 'step');
  }
}
function addMessage(role, text, target = $('chat-log')) {
  const bubble = document.createElement('div');
  bubble.className = 'message ' + (role === 'user' ? 'from-user' : 'from-friend');
  const label = document.createElement('strong');
  label.textContent = role === 'user' ? '나' : '마음 친구';
  const content = document.createElement('p');
  content.textContent = text; // 모델 답변과 학생 입력을 HTML로 실행하지 않습니다.
  bubble.append(label, content); target.append(bubble);
  target.scrollTop = target.scrollHeight;
}
function refreshChat() {
  $('turn-count').textContent = '대화 ' + turns + ' / ' + MAX_TURNS + '회';
  $('send').disabled = busy || turns >= MAX_TURNS;
  $('message').disabled = busy || turns >= MAX_TURNS;
  $('finish-chat').disabled = busy || turns < MIN_TURNS;
  $('change-key').disabled = busy || submitting || submitted;
  $('chat-log').setAttribute('aria-busy', String(busy));
  $('send').textContent = busy ? '답변 기다리는 중…' : '보내기';
  $('turn-help').textContent = turns >= MAX_TURNS ? '7번의 이야기를 모두 나눴어. 대화 끝내기 버튼을 누르면 그림을 그릴 수 있어.'
    : turns >= MIN_TURNS ? '이제 대화를 마칠 수 있어. 조금 더 이야기해도 좋아.'
    : '그림으로 넘어가려면 ' + (MIN_TURNS - turns) + '번 더 이야기를 나눠줘.';
}
function showActivity() {
  $('key-panel').hidden = true; $('activity').hidden = false;
  setStep(stage === 'chat' ? 'chat' : 'draw');
  (stage === 'chat' ? $('chat-title') : $('drawing-title')).focus();
}
$('key-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!hasStudent() || busy || submitting || submitted) return;
  const key = $('api-key').value.trim();
  if (!key) { status('key-status', 'API Key를 입력해 주세요.', true); return; }
  busy = true; $('connect').disabled = true; $('api-key').disabled = true; $('cancel-key').disabled = true;
  status('key-status', '마음 친구와 연결하고 있어요…');
  try {
    // 모델 호출 성공 여부로 키와 해당 모델 사용 가능 여부를 함께 확인합니다.
    const opening = await requestReply(key, [{ role: 'user', content: '대화를 시작하려고 해. 오늘 학교 공부는 어땠는지 물으며 짧게 인사해 줘.' }], BASE_PROMPT);
    if (!hasStudent()) throw new Error('로그인 상태가 바뀌었어요. 같은 계정으로 다시 로그인해 주세요.');
    apiKey = key; $('api-key').value = '';
    if (!messages.length) { messages = [{ role: 'assistant', content: opening }]; addMessage('assistant', opening); }
    status('key-status', ''); showActivity();
  } catch (error) { status('key-status', error.message, true); }
  finally {
    busy = false; $('connect').disabled = false; $('api-key').disabled = false; $('cancel-key').disabled = false; refreshChat();
  }
});
$('change-key').addEventListener('click', () => {
  if (!hasStudent() || busy || submitting || submitted) return;
  $('key-panel').hidden = false; $('activity').hidden = true;
  $('cancel-key').hidden = false; status('key-status', ''); setStep('key'); $('api-key').focus();
});
$('cancel-key').addEventListener('click', () => { if (!busy) showActivity(); });

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!hasStudent() || !apiKey || busy || stage !== 'chat' || turns >= MAX_TURNS) return;
  const text = $('message').value.trim();
  if (!text || text.length > 1500) { status('chat-status', '1~1,500자 안에서 이야기를 적어줘.', true); return; }
  activityTimer.startChat(); // 첫 학생 메시지 전송 시각. 실패 후 재시도해도 초기화하지 않습니다.
  busy = true; refreshChat(); status('chat-status', '마음 친구가 이야기를 읽고 있어…');
  const candidate = [...messages, { role: 'user', content: text }];
  try {
    const reply = await requestReply(apiKey, candidate, turnPrompt(turns + 1));
    if (!hasStudent()) throw new Error('로그인 상태가 바뀌었어요. 같은 계정으로 다시 로그인해 주세요.');
    messages = [...candidate, { role: 'assistant', content: reply }];
    addMessage('user', text); addMessage('assistant', reply);
    turns++; dirty = true; $('message').value = '';
    status('chat-status', '');
  } catch (error) {
    // 실패한 메시지와 횟수는 확정하지 않아 같은 입력으로 다시 시도할 수 있습니다.
    status('chat-status', error.message + ' 입력한 이야기는 그대로 남겨뒀어.', true);
  } finally {
    busy = false; refreshChat();
    if (turns < MAX_TURNS) $('message').focus(); else $('finish-chat').focus();
  }
});
$('message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); $('chat-form').requestSubmit();
  }
});

$('finish-chat').addEventListener('click', () => {
  if (!hasStudent() || !apiKey || busy || stage !== 'chat' || turns < MIN_TURNS) return;
  activityTimer.endChat(); // 대화 종료 버튼을 누른 순간부터 그림 시간을 셉니다.
  try {
    if (!drawing) drawing = createDrawing($('drawing-canvas'), ({ hasDrawing, canUndo }) => {
      $('undo').disabled = !canUndo; $('clear-canvas').disabled = !hasDrawing;
      if (hasDrawing && !submitted) dirty = true;
      $('submit-drawing').disabled = !hasDrawing || submitting || submitted || !hasStudent();
      if (!submitting && !submitted) status('drawing-status', '그림을 다 그렸다면 제출해 줘. 이야기와 그림, 활동 시간이 저장돼.');
    });
    updateBrush();
  } catch (error) { status('chat-status', error.message, true); return; }
  stage = 'draw';
  $('review-log').replaceChildren();
  for (const message of messages) addMessage(message.role, message.content, $('review-log'));
  $('chat-panel').hidden = true; $('drawing-panel').hidden = false;
  setStep('draw'); updateDrawingControls(); $('drawing-title').focus();
});
const colors = [
  ['숲 초록', '#42644c'], ['살구', '#df9979'], ['햇살 노랑', '#e5b746'], ['하늘 파랑', '#649aba'],
  ['라벤더', '#9b83b3'], ['분홍', '#d27e9c'], ['갈색', '#926b51'], ['검정', '#333333'],
];
for (const [name, color] of colors) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'swatch'; button.style.backgroundColor = color;
  button.dataset.color = color; button.setAttribute('aria-label', name);
  button.setAttribute('aria-pressed', String(color === $('custom-color').value));
  button.addEventListener('click', () => {
    $('custom-color').value = color; selectTool(false); updateBrush();
  });
  $('palette').append(button);
}
function selectTool(eraser) {
  $('eraser').setAttribute('aria-pressed', String(eraser)); $('pen').setAttribute('aria-pressed', String(!eraser));
}
function updateBrush() {
  const color = $('custom-color').value;
  const options = { color, brightness: Number($('brightness').value), opacity: Number($('opacity').value) / 100,
    size: Number($('brush-size').value), eraser: $('eraser').getAttribute('aria-pressed') === 'true' };
  for (const [id, value] of [['brightness', options.brightness + '%'], ['opacity', Math.round(options.opacity * 100) + '%'], ['brush-size', options.size + ' px']]) $(id + '-value').textContent = value;
  for (const swatch of $('palette').children) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === color));
  const preview = drawing?.configure(options);
  if (preview) {
    Object.assign($('brush-preview-dot').style, { backgroundColor: options.eraser ? '#fff' : preview.color, opacity: preview.opacity,
      width: Math.min(48, preview.size) + 'px', height: Math.min(48, preview.size) + 'px' });
  }
}
for (const id of ['custom-color', 'brightness', 'opacity', 'brush-size']) $(id).addEventListener('input', () => {
  if (id === 'custom-color') selectTool(false);
  updateBrush();
});
$('pen').addEventListener('click', () => { selectTool(false); updateBrush(); });
$('eraser').addEventListener('click', () => { selectTool(true); updateBrush(); });
$('undo').addEventListener('click', () => drawing?.undo());
$('clear-canvas').addEventListener('click', () => {
  if (drawing?.hasDrawing && window.confirm('그림을 모두 지울까? 실행 취소로 되돌릴 수 있어.')) drawing.clear();
});
$('download').addEventListener('click', async () => {
  if (!drawing) return;
  try {
    const blob = await drawing.toBlob(), url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = '오늘의-마음.png'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status('drawing-status', '그림 PNG 저장을 요청했어. 다운로드 폴더를 확인해 줘. 제출 여부와 관계없이 이 파일은 기기에 저장돼.');
  } catch (error) { status('drawing-status', error.message, true); }
});
$('submit-drawing').addEventListener('click', async () => {
  if (!hasStudent() || stage !== 'draw' || !drawing?.hasDrawing || submitting || submitted) return;
  // PNG 변환·네트워크 대기 이전, 실제 제출 버튼을 누른 시각에 측정을 끝냅니다.
  const timing = activityTimer.atSubmission();
  submitting = true;
  updateDrawingControls();
  status('drawing-status', '그림을 준비하고 있어…');
  try {
    if (!submission) submission = createSubmission(currentStudent);
    const blob = await drawing.toBlob();
    await submission.save({
      blob, messages, turnCount: turns, timing,
      onProgress: text => status('drawing-status', text),
    });
    submitted = true; dirty = false;
    status('drawing-status', '제출이 완료됐어. 오늘의 이야기와 그림을 잘 보관했어.');
  } catch (error) {
    status('drawing-status', submissionErrorMessage(error) + ' 그림과 대화는 남아 있어. 다시 제출해 줘.', true);
  } finally {
    submitting = false; updateDrawingControls();
  }
});
window.addEventListener('beforeunload', event => {
  if (dirty) { event.preventDefault(); event.returnValue = ''; }
});
refreshChat();
