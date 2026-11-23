// 소요 시간은 단조 증가 시계로 측정해 PC 시각 변경에 영향을 받지 않습니다.
export function createActivityTimer(now = () => performance.now(), wallNow = () => Date.now()) {
  let started = null, ended = null;
  const capture = () => ({ monotonic: now(), epoch: wallNow() });
  return {
    startChat() { if (!started) started = capture(); },
    endChat() {
      if (!started) throw new Error('대화 시작 시간이 없어요.');
      if (!ended) ended = capture();
    },
    atSubmission() {
      if (!started || !ended) throw new Error('대화를 마친 뒤 제출해 주세요.');
      const submitted = capture();
      return {
        chatStartedAt: new Date(started.epoch),
        chatEndedAt: new Date(ended.epoch),
        submittedAtClient: new Date(submitted.epoch),
        chatDurationMs: Math.max(0, Math.round(ended.monotonic - started.monotonic)),
        drawingDurationMs: Math.max(0, Math.round(submitted.monotonic - ended.monotonic)),
      };
    },
  };
}
