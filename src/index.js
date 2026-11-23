import './styles.css';
import './auth.css';
import { isAdmin } from './accessControl.js';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider, firebaseSetupError } from './firebaseConfig.js';

const loginButton = document.getElementById('google-login');
const logoutButton = document.getElementById('google-logout');
const sessionPanel = document.getElementById('user-session');
const userName = document.getElementById('user-name');
const status = document.getElementById('auth-status');
const activityLinks = [...document.querySelectorAll('[data-requires-auth]')];
let currentUser = null, ready = false, pending = false;

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('auth-error', isError);
}
function updateControls() {
  loginButton.disabled = !ready || pending;
  logoutButton.disabled = !ready || pending;
  loginButton.textContent = pending && !currentUser ? 'Google 연결 중…' : 'Google로 로그인';
  logoutButton.textContent = pending && currentUser ? '로그아웃 중…' : '로그아웃';
}
function showUser(user) {
  currentUser = user;
  const signedIn = Boolean(user);
  for (const link of activityLinks) {
    link.hidden = !signedIn || (link.hasAttribute('data-requires-admin') && !isAdmin(user));
  }
  loginButton.hidden = signedIn;
  sessionPanel.hidden = !signedIn;
  userName.textContent = user ? (user.displayName?.trim() || user.email || '마음쉼 사용자') : '';
  updateControls();
}
function errorMessage(error) {
  const messages = {
    'auth/popup-closed-by-user': '로그인 창이 닫혔어요. 다시 눌러 로그인할 수 있어요.',
    'auth/cancelled-popup-request': '로그인 요청이 취소되었어요. 다시 시도해 주세요.',
    'auth/popup-blocked': '로그인 창이 차단되었어요. 브라우저에서 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.',
    'auth/unauthorized-domain': '현재 주소에서는 로그인이 허용되지 않아요. Firebase 인증의 승인된 도메인 설정을 확인해 주세요.',
    'auth/operation-not-allowed': 'Google 로그인이 활성화되지 않았어요. Firebase 인증 설정을 확인해 주세요.',
    'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    'auth/invalid-api-key': 'Firebase 연결 설정을 확인해 주세요.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Firebase 연결 설정을 확인해 주세요.',
    'auth/account-exists-with-different-credential': '이 이메일은 다른 로그인 방식으로 등록되어 있어요. 관리자에게 문의해 주세요.',
    'auth/web-storage-unsupported': '브라우저의 사이트 저장소를 사용할 수 없어요. 브라우저 설정을 확인해 주세요.',
    'auth/operation-not-supported-in-this-environment': '이 브라우저 환경에서는 로그인할 수 없어요. 일반 브라우저에서 다시 열어 주세요.',
  };
  return messages[error?.code] || '로그인 연결에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}
showUser(null);
if (firebaseSetupError || !auth) {
  showStatus('로그인 연결 설정이 아직 준비되지 않았어요. 관리자에게 문의해 주세요.', true);
} else {
  try {
    onAuthStateChanged(auth, user => {
      ready = true; showUser(user);
      showStatus(user ? (isAdmin(user) ? '로그인되었어요. 학생 활동 또는 교사 모니터링을 선택해 주세요.' : '로그인되었어요. 학생용 활동 시작 버튼을 눌러 주세요.') : 'Google로 로그인하면 학생 활동을 시작할 수 있어요.');
    }, error => {
      ready = false; showUser(null); showStatus(errorMessage(error), true);
    });
  } catch (error) { showStatus(errorMessage(error), true); }
}
loginButton.addEventListener('click', async () => {
  if (!auth || !ready || pending || currentUser) return;
  pending = true; updateControls(); showStatus('Google 로그인 창에서 계정을 선택해 주세요.');
  try {
    const { user } = await signInWithPopup(auth, googleProvider);
    // 인증 완료 결과를 즉시 반영하고, 세션 복원·로그아웃은 관찰자로 동기화합니다.
    ready = true;
    showUser(user);
    showStatus(isAdmin(user) ? '로그인되었어요. 학생용 활동 시작 또는 교사 모니터링을 선택해 주세요.' : '로그인되었어요. 학생용 활동 시작 버튼을 눌러 주세요.');
  } catch (error) {
    showStatus(errorMessage(error), !['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error?.code));
  } finally { pending = false; updateControls(); }
});
logoutButton.addEventListener('click', async () => {
  if (!auth || !ready || pending || !currentUser) return;
  pending = true; updateControls(); showStatus('로그아웃하고 있어요.');
  try { await signOut(auth); }
  catch (error) { showStatus('로그아웃하지 못했어요. ' + errorMessage(error), true); }
  finally { pending = false; updateControls(); }
});
// 교사 페이지에서도 같은 관리자 목록으로 접근을 검사합니다.
// 실제 Firestore·Storage 데이터 권한은 Firebase Security Rules에서 제한해야 합니다.
