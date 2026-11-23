import { collection, getDocsFromServer, doc, deleteDoc } from 'firebase/firestore';
import { ref, getBlob, deleteObject } from 'firebase/storage';
import { auth, db, storage } from './firebaseConfig.js';
import { isAdmin } from './accessControl.js';

const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function asDate(value) {
  if (value == null) return null;
  try {
    const date = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value
      : typeof value.seconds === 'number' ? new Date(value.seconds * 1000) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch { return null; }
}
export function normalizeRecord(id, data) {
  const date = [data.submittedAtClient, data.submittedAt, data.chatEndedAt, data.chatStartedAt].map(asDate).find(Boolean);
  const name = typeof data.studentName === 'string' && data.studentName.trim() ? data.studentName : '이름 없음';
  const dateKey = date ? dateFormatter.format(date) : 'unknown';
  const time = date ? timeFormatter.format(date) : '시간 미상';
  return { ...data, id, name, dateKey, time, epoch: date?.getTime() || 0,
    title: name + ' (' + (dateKey === 'unknown' ? '날짜 미상' : dateKey) + ', ' + time + ')' };
}
export function formatDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '기록 없음';
  const seconds = Math.round(value / 1000);
  return seconds < 60 ? seconds + '초' : Math.floor(seconds / 60) + '분 ' + seconds % 60 + '초';
}
function requireAdmin() {
  if (!isAdmin(auth?.currentUser)) throw Object.assign(new Error('관리자 권한을 다시 확인해 주세요.'), { code: 'monitor/not-admin' });
}
export async function loadRecords() {
  requireAdmin();
  if (!db) throw new Error('Firestore 연결 설정을 확인해 주세요.');
  const snapshot = await getDocsFromServer(collection(db, 'studentActivities'));
  requireAdmin();
  return snapshot.docs.map(item => normalizeRecord(item.id, item.data())).sort((a, b) => b.epoch - a.epoch || a.id.localeCompare(b.id));
}
function imageRef(record) {
  if (!storage) throw new Error('Storage 연결 설정을 확인해 주세요.');
  const expected = 'studentDrawings/' + record.studentUid + '/' + record.id + '.png';
  if (record.drawing?.storagePath !== expected) throw new Error('이 기록의 그림 경로를 확인할 수 없어요.');
  return ref(storage, expected);
}
export async function loadPicture(record) {
  requireAdmin();
  const blob = await getBlob(imageRef(record), 5 * 1024 * 1024);
  requireAdmin();
  return blob;
}
export async function deleteRecord(record) {
  requireAdmin();
  if (!db) throw new Error('Firestore 연결 설정을 확인해 주세요.');
  // 그림 삭제가 실패하면 대화 기록을 남겨 재시도할 수 있게 합니다.
  if (record.drawing?.storagePath) {
    try { await deleteObject(imageRef(record)); }
    catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
  }
  requireAdmin();
  try { await deleteDoc(doc(db, 'studentActivities', record.id)); }
  catch (error) {
    throw Object.assign(new Error('그림 삭제 단계는 끝났지만 대화 기록을 삭제하지 못했어요. 다시 삭제해 주세요.'), { code: error.code, partialImageDeleted: true });
  }
}
export function monitorError(error) {
  if (error?.partialImageDeleted) return error.message + ' 저장 권한과 네트워크를 확인해 주세요.';
  if (['permission-denied', 'storage/unauthorized'].includes(error?.code)) return '접근 권한이 없어요. 관리자 계정의 Firestore·Storage 보안 규칙을 확인해 주세요.';
  if (error?.code === 'storage/object-not-found') return '저장된 그림을 찾을 수 없어요.';
  if (['unavailable', 'storage/retry-limit-exceeded'].includes(error?.code)) return '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.';
  return error?.message || '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
