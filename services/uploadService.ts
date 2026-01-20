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
} from './fileStorage';

// ===================== 상수 =====================

/** 서버 Base URL */
const BASE_URL = 'http://52.64.123.5:8000';

/** 노이즈 필터 강도 (0.0 ~ 1.0) */
const NOISE_LEVEL = '0.8';

/** 필터 사용 여부 */
const FILTER_OPTION = 'true';

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

    console.log(`[${getTimestamp()}] 업로드 시작: ${newDataLength} bytes`);

    // FormData 생성
    const formData = new FormData();
    formData.append('file', {
      uri: `data:application/octet-stream;base64,${newDataBase64}`,
      type: 'application/octet-stream',
      name: `${sessionId}.bin`,
    } as any);
    formData.append('session_id', sessionId);
    formData.append('noise_level', NOISE_LEVEL);
    formData.append('filter_option', FILTER_OPTION);

    // 서버 전송
    const response = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (response.ok && result.status === 'success') {
      updateLastSentOffset(fileSize);
      console.log(`[${getTimestamp()}] 업로드 성공: ${newDataLength} bytes 전송됨`);
      return true;
    } else {
      console.log(`[${getTimestamp()}] 업로드 실패: ${result.message || 'Unknown error'}`);
      return false;
    }

  } catch (error: any) {
    console.log(`[${getTimestamp()}] 업로드 에러: ${error.message}`);
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
      return true;
    } else {
      console.log(`[${getTimestamp()}] 세션 종료 실패: ${result.message || 'Unknown error'}`);
      return false;
    }

  } catch (error: any) {
    console.log(`[${getTimestamp()}] 세션 종료 에러: ${error.message}`);
    return false;
  }
};
