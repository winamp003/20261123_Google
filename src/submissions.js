import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage, firebaseSetupError } from './firebaseConfig.js';
import { MODEL } from './openai.js';

export function googleIdentity(user) {
  const google = user?.providerData?.find(provider => provider.providerId === 'google.com');
  if (!user?.uid || !google?.email) return null;
  return {
    studentUid: user.uid,
    studentName: google.displayName?.trim() || user.displayName?.trim() || '이름 없음',
    googleEmail: google.email,
  };
}
export function submissionErrorMessage(error) {
  const code = error?.code || '';
  if (['permission-denied', 'storage/unauthorized'].includes(code)) return '저장 권한이 없어요. Firebase의 Firestore·Storage 보안 규칙을 확인해 주세요.';
  if (['unauthenticated', 'storage/unauthenticated', 'student/auth-changed'].includes(code)) return '로그인 상태가 바뀌었어요. 같은 Google 계정으로 다시 로그인한 뒤 제출해 주세요.';
  if (['unavailable', 'storage/retry-limit-exceeded', 'storage/unknown'].includes(code)) return '저장 서버에 연결하지 못했어요. 네트워크를 확인하고 다시 제출해 주세요.';
  if (code === 'storage/quota-exceeded') return '그림 저장 용량을 초과했어요. 관리자에게 문의해 주세요.';
  return error?.message || '저장하지 못했어요. 잠시 후 다시 제출해 주세요.';
}

// 한 활동에서 재시도할 때 같은 문서 ID와 PNG 경로를 사용해 중복 생성을 방지합니다.
export function createSubmission(user) {
  const identity = googleIdentity(user);
  if (!identity) throw new Error('Google 계정으로 로그인해 주세요.');
  if (firebaseSetupError || !db || !storage) throw new Error('Firebase 저장 설정이 필요해요. 환경 변수의 Storage 버킷 설정을 확인해 주세요.');
  const documentRef = doc(collection(db, 'studentActivities'));
  const storagePath = 'studentDrawings/' + identity.studentUid + '/' + documentRef.id + '.png';
  function requireOwner() {
    if (auth?.currentUser?.uid !== identity.studentUid || !googleIdentity(auth.currentUser)) {
      throw Object.assign(new Error('로그인 상태가 바뀌었어요.'), { code: 'student/auth-changed' });
    }
  }
  return {
    id: documentRef.id,
    async save({ blob, messages, turnCount, timing, onProgress = () => {} }) {
      requireOwner();
      if (!(blob instanceof Blob) || blob.type !== 'image/png' || !blob.size) throw new Error('PNG 그림 파일을 만들지 못했어요.');
      onProgress('그림을 저장하고 있어…');
      await uploadBytes(ref(storage, storagePath), blob, {
        contentType: 'image/png',
        customMetadata: { studentUid: identity.studentUid, submissionId: documentRef.id },
      });
      requireOwner();
      onProgress('이야기와 활동 시간을 저장하고 있어…');
      await setDoc(documentRef, {
        schemaVersion: 1,
        ...identity,
        messages: messages.map(({ role, content }) => ({ role, content })),
        turnCount, model: MODEL, ...timing,
        submittedAt: serverTimestamp(),
        drawing: { storagePath, contentType: 'image/png', width: 1000, height: 700, sizeBytes: blob.size },
        status: 'submitted',
      });
      // Firestore 응답이 유실된 경우에도 같은 ID로 재시도합니다.
      // 두 서비스 사이에 원자적 트랜잭션이 없어 실패 시 업로드된 PNG를 지우지 않습니다.
      return { id: documentRef.id, storagePath };
    },
  };
}
