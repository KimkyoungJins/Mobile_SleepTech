/**
 * 서버 업로드 서비스
 *
 * [역할]
 * 30초마다 새로운 오디오 데이터를 서버로 전송
 * 녹음 종료 시 /finish 호출하여 WAV 변환
 *
 * [API]
 * POST /upload - 오디오 청크 업로드
 * POST /finish - 녹음 종료 및 WAV 변환
 */

import RNFS from 'react-native-fs';
import { getTimestamp } from '../utils/helpers';
import {
  getFilePath,
  getSessionId,
  getLastSentOffset,
  updateLastSentOffset,
  getChunkIndex,
  incrementChunkIndex,
  addUploadLog,
} from './fileStorage';

// ===================== 수면 분석 결과 타입 =====================

/**
 * 수면 단계별 시간 (분 단위).
 *
 * 현재 백엔드 모델(ResNet22)은 **2-class(WAKE/SLEEP)** 분류기이며
 * 수면으로 분류된 모든 시간은 `nrem_minutes` 키로 응답된다.
 * `rem_minutes`는 항상 0이다 (향후 EOG 모델 통합 시 REM 분리 예정).
 */
export interface SleepStages {
  nrem_minutes: number;
  rem_minutes: number;  // 현재 항상 0 (2-class 모델)
  wake_minutes: number;
}

/** 타임라인 항목 */
export interface TimelineEntry {
  time: string;
  stage: 'NREM' | 'REM' | 'WAKE';
}

/** 수면 분석 결과 응답 */
export interface SleepResultResponse {
  session_id: string;
  total_sleep_minutes: number;
  sleep_start: string;
  sleep_end: string;
  stages: SleepStages;
  timeline: TimelineEntry[];
}

// ===================== 상수 =====================

/** 서버 Base URL — Azure VM (Korea Central) */
const BASE_URL = 'http://20.196.65.173:8000';

/** 노이즈 필터 강도 (0.0 ~ 1.0) */
const NOISE_LEVEL = '0.8';

/** 필터 사용 여부 */
const FILTER_OPTION = 'true';

// ===================== 서버 연결 테스트 =====================

/**
 * 서버 연결 상태 확인 (단순 ping)
 * @returns { reachable, latencyMs, error? }
 */
export const pingServer = async (): Promise<{
  reachable: boolean;
  latencyMs: number;
  error?: string;
}> => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${BASE_URL}/`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    return { reachable: true, latencyMs };
  } catch (error: any) {
    const latencyMs = Date.now() - start;
    return { reachable: false, latencyMs, error: error.message };
  }
};

// ===================== 세션 ID 생성 =====================

/**
 * 세션 ID 생성 (YYYYMMDD_HHmmss 형식)
 */
export const generateSessionId = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

// ===================== 업로드 함수 =====================

/**
 * 새 데이터 청크를 서버에 업로드
 * @returns 성공 여부
 */
export const uploadChunk = async (): Promise<boolean> => {
  const sessionId = getSessionId();

  if (!sessionId) {
    console.log(`[${getTimestamp()}] 업로드 스킵: 세션 ID 없음`);
    return false;
  }

  try {
    const filePath = getFilePath();

    // 파일 존재 확인
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      console.log(`[${getTimestamp()}] 업로드 스킵: 파일 없음`);
      return false;
    }

    // 파일 크기 확인
    const stat = await RNFS.stat(filePath);
    const fileSize = Number(stat.size);
    const lastOffset = getLastSentOffset();

    // 새 데이터 없으면 스킵
    if (fileSize <= lastOffset) {
      console.log(`[${getTimestamp()}] 업로드 스킵: 새 데이터 없음`);
      return true;
    }

    // 새 데이터 읽기 (base64로 읽은 후 전송)
    const newDataLength = fileSize - lastOffset;
    const newDataBase64 = await RNFS.read(filePath, newDataLength, lastOffset, 'base64');

    const chunkIndex = getChunkIndex();
    console.log(`[${getTimestamp()}] 업로드 시작: ${newDataLength} bytes (chunk_index: ${chunkIndex})`);

    // FormData 생성
    const formData = new FormData();
    formData.append('file', {
      uri: `data:application/octet-stream;base64,${newDataBase64}`,
      type: 'application/octet-stream',
      name: `${sessionId}.bin`,
    } as any);
    formData.append('session_id', sessionId);
    formData.append('chunk_index', String(chunkIndex));
    formData.append('noise_level', NOISE_LEVEL);
    formData.append('filter_option', FILTER_OPTION);

    // 서버 전송
    const response = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    // 디버깅: 응답 텍스트 먼저 확인
    const responseText = await response.text();
    console.log(`[${getTimestamp()}] 서버 응답 (status=${response.status}): ${responseText.substring(0, 300)}`);

    // JSON 파싱
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.log(`[${getTimestamp()}] JSON 파싱 실패`);
      return false;
    }

    if (response.ok && result.status === 'success') {
      updateLastSentOffset(fileSize);
      incrementChunkIndex();
      const msg = `서버 전송 성공: ${(newDataLength / 1024).toFixed(1)}KB (chunk #${chunkIndex})`;
      console.log(`[${getTimestamp()}] ${msg}`);
      addUploadLog(msg, true);
      return true;
    } else {
      const msg = `서버 전송 실패: ${result.message || 'Unknown error'}`;
      console.log(`[${getTimestamp()}] ${msg}`);
      addUploadLog(msg, false);
      return false;
    }

  } catch (error: any) {
    const msg = `서버 연결 에러: ${error.message}`;
    console.log(`[${getTimestamp()}] ${msg}`);
    addUploadLog(msg, false);
    return false;
  }
};

// ===================== 세션 종료 =====================

/**
 * 녹음 종료 및 WAV 변환 요청
 * 서버에서 임시 .bin 파일을 .wav로 변환
 *
 * @returns 성공 여부
 */
export const finishSession = async (): Promise<boolean> => {
  const sessionId = getSessionId();

  if (!sessionId) {
    console.log(`[${getTimestamp()}] 세션 종료 스킵: 세션 ID 없음`);
    return false;
  }

  try {
    console.log(`[${getTimestamp()}] 세션 종료 요청: ${sessionId}`);

    const formData = new FormData();
    formData.append('session_id', sessionId);

    const response = await fetch(`${BASE_URL}/finish`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (response.ok && result.status === 'success') {
      console.log(`[${getTimestamp()}] WAV 변환 완료: ${result.filename}`);
      console.log(`[${getTimestamp()}] 녹음 길이: ${result.message}`);
      addUploadLog(`세션 종료 완료: ${result.message}`, true);
      return true;
    } else {
      const msg = `세션 종료 실패: ${result.message || 'Unknown error'}`;
      console.log(`[${getTimestamp()}] ${msg}`);
      addUploadLog(msg, false);
      return false;
    }

  } catch (error: any) {
    const msg = `세션 종료 에러: ${error.message}`;
    console.log(`[${getTimestamp()}] ${msg}`);
    addUploadLog(msg, false);
    return false;
  }
};

// ===================== 수면 분석 결과 조회 =====================

/**
 * 서버에서 수면 분석 결과를 조회
 * @param sessionId 조회할 세션 ID
 * @returns 분석 결과 또는 null (미완료/에러)
 */
export const fetchSleepResult = async (sessionId: string): Promise<SleepResultResponse | null> => {
  try {
    console.log(`[${getTimestamp()}] 수면 분석 결과 조회: ${sessionId}`);

    const response = await fetch(`${BASE_URL}/api/result/${sessionId}`);
    const responseText = await response.text();

    console.log(`[${getTimestamp()}] 분석 결과 응답 (status=${response.status}): ${responseText.substring(0, 300)}`);

    if (!response.ok) {
      console.log(`[${getTimestamp()}] 분석 결과 조회 실패: status=${response.status}`);
      return null;
    }

    const result = JSON.parse(responseText);

    // 분석이 아직 완료되지 않은 경우
    if (result.status === 'pending') {
      console.log(`[${getTimestamp()}] 분석 진행 중: ${result.message}`);
      addUploadLog(`분석 진행 중...`, true);
      return null;
    }

    // 필수 필드 검증
    if (!result.stages || !result.timeline || !result.total_sleep_minutes) {
      console.log(`[${getTimestamp()}] 분석 결과 형식 오류: stages/timeline/total_sleep_minutes 누락`);
      addUploadLog(`분석 결과 형식이 올바르지 않습니다`, false);
      return null;
    }

    addUploadLog(`수면 분석 결과 수신 완료`, true);
    return result as SleepResultResponse;

  } catch (error: any) {
    const msg = `분석 결과 조회 에러: ${error.message}`;
    console.log(`[${getTimestamp()}] ${msg}`);
    addUploadLog(msg, false);
    return null;
  }
};
