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

/** 저장 디렉토리 */
export const STORAGE_DIR = RNFS.DocumentDirectoryPath;

/** 버퍼 flush 간격 (5초) */
export const FLUSH_INTERVAL = 5000;

/** 30초 분량 오디오 데이터 크기 (16kHz, 16bit, 모노) */
export const CHUNK_SIZE_30SEC = 960000; // 16000 * 2 * 1 * 30 = 960,000 bytes

/** 버퍼 최대 크기 (flush 실패 시 OOM 방지) - 약 60초 분량 */
export const MAX_BUFFER_SIZE = 2000;

/** 현재 파일명 (세션 ID 기반) */
let globalFileName: string = 'data.raw';

/** 파일명 설정 (녹음 시작 시 호출) */
export const setFileName = (sessionId: string) => {
  globalFileName = `${sessionId}.raw`;
};

/** 현재 파일 경로 조회 */
export const getFilePath = (): string => {
  return `${STORAGE_DIR}/${globalFileName}`;
};

/** 현재 파일명 조회 */
export const getFileName = (): string => {
  return globalFileName;
};

/** 파일명 초기화 */
export const resetFileName = () => {
  globalFileName = 'data.raw';
};

// 하위 호환성을 위한 FILE_PATH (현재 파일 경로 반환)
export const FILE_PATH = `${STORAGE_DIR}/data.raw`;

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

/** 현재 청크 인덱스 (업로드 순서) */
let globalChunkIndex: number = 0;

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
  globalChunkIndex = 0;
};

/** 청크 인덱스 조회 */
export const getChunkIndex = (): number => {
  return globalChunkIndex;
};

/** 청크 인덱스 증가 (업로드 성공 시 호출) */
export const incrementChunkIndex = (): void => {
  globalChunkIndex++;
};

// ===================== 업로드 로그 (UI 표시용) =====================

export interface UploadLogEntry {
  timestamp: string;
  text: string;
  success: boolean;
}

/** 업로드 로그 배열 (최근 500개까지 유지) */
const MAX_UPLOAD_LOGS = 500;
let globalUploadLogs: UploadLogEntry[] = [];

/** 업로드 로그 추가 */
export const addUploadLog = (text: string, success: boolean) => {
  const now = new Date();
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  globalUploadLogs.unshift({ timestamp, text, success });
  if (globalUploadLogs.length > MAX_UPLOAD_LOGS) {
    globalUploadLogs = globalUploadLogs.slice(0, MAX_UPLOAD_LOGS);
  }
};

/** 업로드 로그 조회 */
export const getUploadLogs = (): UploadLogEntry[] => {
  return globalUploadLogs;
};

/** 업로드 로그 초기화 */
export const clearUploadLogs = () => {
  globalUploadLogs = [];
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

    const filePath = getFilePath();
    if (!globalFileInitialized) {
      const exists = await RNFS.exists(filePath);
      if (exists) {
        await RNFS.appendFile(filePath, combinedBase64, 'base64');
      } else {
        await RNFS.writeFile(filePath, combinedBase64, 'base64');
      }
      globalFileInitialized = true;
    } else {
      await RNFS.appendFile(filePath, combinedBase64, 'base64');
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

// ===================== 파일 관리 =====================

/** 파일 정보 타입 */
export interface FileInfo {
  exists: boolean;
  name: string;
  size: number;
  sizeFormatted: string;
}

/**
 * 저장된 파일 정보 조회
 */
export const getFileInfo = async (): Promise<FileInfo> => {
  const filePath = getFilePath();
  const fileName = getFileName();

  try {
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      return {
        exists: false,
        name: fileName,
        size: 0,
        sizeFormatted: '0 KB',
      };
    }

    const stat = await RNFS.stat(filePath);
    const size = Number(stat.size);

    // 크기 포맷팅
    let sizeFormatted: string;
    if (size < 1024) {
      sizeFormatted = `${size} B`;
    } else if (size < 1024 * 1024) {
      sizeFormatted = `${(size / 1024).toFixed(1)} KB`;
    } else {
      sizeFormatted = `${(size / (1024 * 1024)).toFixed(2)} MB`;
    }

    return {
      exists: true,
      name: fileName,
      size,
      sizeFormatted,
    };
  } catch (error) {
    return {
      exists: false,
      name: fileName,
      size: 0,
      sizeFormatted: '0 KB',
    };
  }
};

/**
 * 저장된 파일 삭제
 */
export const deleteLocalFile = async (): Promise<boolean> => {
  const filePath = getFilePath();
  try {
    const exists = await RNFS.exists(filePath);
    if (exists) {
      await RNFS.unlink(filePath);
      resetFileStorage();
      resetUploadState();
      console.log(`[${getTimestamp()}] 로컬 파일 삭제됨: ${getFileName()}`);
      return true;
    }
    return false;
  } catch (error: any) {
    console.log(`[${getTimestamp()}] 파일 삭제 에러:`, error.message);
    return false;
  }
};
