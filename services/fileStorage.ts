/**
 * 파일 저장 시스템
 *
 * [데이터 흐름]
 * BLE 데이터 수신 → 버퍼에 추가 → 5초마다 파일에 저장
 *
 * [전역 변수 사용 이유]
 * 백그라운드 서비스(HeadlessJS)에서 접근하려면 전역 변수 필요
 * (React의 useState/useRef는 컴포넌트 외부에서 접근 불가)
 */

import { fromByteArray, toByteArray } from 'base64-js';
import RNFS from 'react-native-fs';
import { getTimestamp } from '../utils/helpers';

// ===================== 상수 =====================

/** 저장 파일 경로 */
export const FILE_PATH = `${RNFS.DocumentDirectoryPath}/data.raw`;

/** 버퍼 flush 간격 (5초) */
export const FLUSH_INTERVAL = 5000;

// ===================== 전역 상태 =====================

/** 쓰기 버퍼 - BLE 데이터를 임시 저장 */
export let globalWriteBuffer: string[] = [];

/** 파일 초기화 완료 여부 */
export let globalFileInitialized = false;

/** 현재 녹음 중 여부 */
export let globalIsRecording = false;

/** 녹음 상태 설정 */
export const setGlobalIsRecording = (value: boolean) => {
  globalIsRecording = value;
};

/** 현재 세션 ID (서버 업로드용) */
let globalSessionId: string | null = null;

/** 마지막으로 서버에 전송한 파일 위치 (바이트) */
let globalLastSentOffset: number = 0;

/** 세션 ID 설정 */
export const setSessionId = (id: string) => {
  globalSessionId = id;
};

/** 세션 ID 조회 */
export const getSessionId = (): string | null => {
  return globalSessionId;
};

/** 세션 ID 초기화 */
export const resetSessionId = () => {
  globalSessionId = null;
};

/** 마지막 전송 위치 조회 */
export const getLastSentOffset = (): number => {
  return globalLastSentOffset;
};

/** 마지막 전송 위치 업데이트 */
export const updateLastSentOffset = (offset: number) => {
  globalLastSentOffset = offset;
};

/** 업로드 상태 초기화 (녹음 시작 시 호출) */
export const resetUploadState = () => {
  globalLastSentOffset = 0;
};

// ===================== 데이터 처리 =====================

/**
 * 버퍼에 데이터 추가 (BLE 수신 시 호출)
 */
export const globalAppendData = (data: string) => {
  if (!data) return;
  globalWriteBuffer.push(data);
};

/**
 * 버퍼 데이터를 파일에 저장 (백그라운드에서 5초마다 호출)
 *
 * 처리 과정:
 * 1. 버퍼 복사 후 비움 (새 데이터 수신 준비)
 * 2. Base64 → 바이너리 변환
 * 3. 바이너리 합치기 → Base64 인코딩
 * 4. 파일에 append
 */
export const globalFlushBuffer = async () => {
  if (globalWriteBuffer.length === 0) return;

  // 버퍼 복사 후 초기화
  const chunksToWrite = [...globalWriteBuffer];
  globalWriteBuffer = [];

  try {
    // Base64 → 바이너리 변환
    const byteArrays = chunksToWrite
      .filter(chunk => chunk)
      .map(chunk => {
        try {
          return toByteArray(chunk);
        } catch (e) {
          console.log(`[${getTimestamp()}] base64 디코딩 에러`);
          return null;
        }
      })
      .filter(arr => arr !== null) as Uint8Array[];

    if (byteArrays.length === 0) return;

    // 바이너리 합치기
    const totalLength = byteArrays.reduce((sum, arr) => sum + arr.length, 0);
    const combinedArray = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of byteArrays) {
      combinedArray.set(arr, offset);
      offset += arr.length;
    }

    // Base64로 인코딩 후 파일에 쓰기
    const combinedBase64 = fromByteArray(combinedArray);

    if (!globalFileInitialized) {
      const exists = await RNFS.exists(FILE_PATH);
      if (exists) {
        await RNFS.appendFile(FILE_PATH, combinedBase64, 'base64');
      } else {
        await RNFS.writeFile(FILE_PATH, combinedBase64, 'base64');
      }
      globalFileInitialized = true;
    } else {
      await RNFS.appendFile(FILE_PATH, combinedBase64, 'base64');
    }

    console.log(`[${getTimestamp()}] 백그라운드 저장: ${chunksToWrite.length}개 청크 (${totalLength} bytes)`);

  } catch (err: any) {
    console.log(`[${getTimestamp()}] 파일 쓰기 에러:`, err.message);
    // 실패 시 데이터 복구
    globalWriteBuffer = [...chunksToWrite, ...globalWriteBuffer];
  }
};

/**
 * 파일 저장 시스템 초기화 (파일 삭제 시 호출)
 */
export const resetFileStorage = () => {
  globalFileInitialized = false;
  globalWriteBuffer = [];
};
