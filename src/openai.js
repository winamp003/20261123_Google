export const MODEL = 'gpt-5-mini';
export const ENDPOINT = 'https://api.openai.com/v1/responses';

// API Key는 호출 인자로만 전달하며, 저장하거나 로그에 남기지 않습니다.
export async function requestReply(key, input, instructions, { timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key.trim() },
      body: JSON.stringify({
        model: MODEL, instructions, input, store: false,
        reasoning: { effort: 'minimal' }, text: { verbosity: 'low' }, max_output_tokens: 1500,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const messages = {
        400: '요청을 처리하지 못했어요. 모델 설정과 API 프로젝트를 확인해 주세요.',
        401: 'API Key가 유효하지 않아요. 키를 다시 확인해 주세요.',
        403: '이 키로 모델을 사용할 권한이 없어요. API 프로젝트 권한을 확인해 주세요.',
        404: 'GPT-5 mini를 사용할 수 없어요. 프로젝트의 모델 접근 권한을 확인해 주세요.',
        429: data?.error?.code === 'insufficient_quota'
          ? 'API 사용 잔액 또는 한도가 부족해요. OpenAI 결제 설정을 확인해 주세요.'
          : '요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.',
      };
      throw new Error(messages[response.status] || 'OpenAI 연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.');
    }
    if (data?.status !== 'completed') throw new Error('답변이 끝까지 생성되지 않았어요. 다시 시도해 주세요.');
    const parts = (data.output || []).filter(item => item.type === 'message')
      .flatMap(item => item.content || []);
    const reply = parts.map(item => item.type === 'output_text' ? item.text : item.type === 'refusal' ? item.refusal : '')
      .filter(Boolean).join('\n').trim();
    if (!reply) throw new Error('답변을 받지 못했어요. 다시 시도해 주세요.');
    return reply;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('응답 시간이 길어 연결을 멈췄어요. 다시 시도해 주세요.');
    if (error instanceof TypeError) throw new Error('네트워크 연결을 확인해 주세요. 브라우저에서 OpenAI 연결이 차단되었을 수도 있어요.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
