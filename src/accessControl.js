// .env.local: VITE_ADMIN_UIDS=첫번째_UID,두번째_UID
// Vite 환경 변수는 빌드 시 브라우저 코드에 포함됩니다.
// 실제 데이터 권한은 Firebase Security Rules에서도 별도로 검증해야 합니다.
export function parseAdminUids(value = '') {
  return [...new Set(value.split(/[,;\s]+/).map(uid => uid.trim()).filter(Boolean))];
}
const adminUids = new Set(parseAdminUids(import.meta.env.VITE_ADMIN_UIDS || ''));
export function isAdmin(user) {
  return Boolean(user && typeof user.uid === 'string' && adminUids.has(user.uid));
}
