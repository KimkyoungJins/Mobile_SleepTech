/**
 * 유틸리티 함수 모음
 */

/**
 * 지정된 시간(밀리초) 동안 대기하는 Promise 반환
 * @param time - 대기 시간 (밀리초)
 */
export const sleep = (time: number): Promise<void> =>
  new Promise((resolve) => setTimeout(() => resolve(), time));

/**
 * 현재 시간을 한국어 형식의 문자열로 반환
 * @returns "HH:MM:SS" 형식의 시간 문자열
 */
export const getTimestamp = (): string => {
  const now = new Date();
  return now.toLocaleString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

/**
 * Base64 문자열을 일반 문자열로 디코딩
 * @param base64String - Base64 인코딩된 문자열
 * @returns 디코딩된 문자열 (실패 시 빈 문자열)
 */
export const decodeBase64 = (base64String: string): string => {
  try {
    return atob(base64String);
  } catch (e) {
    return "";
  }
};
