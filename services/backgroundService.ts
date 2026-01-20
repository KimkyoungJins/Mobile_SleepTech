/**
 * 백그라운드 서비스
 *
 * [역할]
 * 앱이 백그라운드에 있어도 5초마다 버퍼 → 파일 저장 수행
 *
 * [동작 원리]
 * Android Foreground Service로 실행 → 시스템이 앱 종료 안 함
 * HeadlessJS로 실행되어 React 컴포넌트 외부에서 동작
 */

import BackgroundService from 'react-native-background-actions';
import { sleep, getTimestamp } from '../utils/helpers';
import {
  globalIsRecording,
  globalFlushBuffer,
  globalWriteBuffer,
  FLUSH_INTERVAL
} from './fileStorage';
import { uploadChunk } from './uploadService';

/** 업로드 주기 (30초 = 6번의 flush 사이클) */
const UPLOAD_CYCLE = 6;

// ===================== 백그라운드 태스크 =====================

/**
 * 백그라운드에서 실행되는 메인 함수
 * - 무한 루프로 5초마다 실행
 * - 녹음 중이면 버퍼를 파일에 저장
 * - 30초마다 서버에 업로드
 */
export const backgroundTask = async (taskDataArguments: { delay: number }) => {
  const { delay } = taskDataArguments;
  let flushCount = 0;

  await new Promise<void>(async (resolve) => {
    for (let i = 0; BackgroundService.isRunning(); i++) {
      // 녹음 중이면 버퍼 → 파일 저장
      if (globalIsRecording) {
        await globalFlushBuffer();
        flushCount++;

        // 30초마다 서버 업로드 (6번의 flush 사이클)
        if (flushCount >= UPLOAD_CYCLE) {
          await uploadChunk();
          flushCount = 0;
        }
      }

      console.log(`[${getTimestamp()}] Background: cycle=${i}, recording=${globalIsRecording}, buffer=${globalWriteBuffer.length}, flushCount=${flushCount}`);
      await sleep(delay);
    }
  });
};

// ===================== 서비스 옵션 =====================

/** 백그라운드 서비스 설정 (알림바 표시 정보) */
export const backgroundOptions = {
  taskName: 'SleepStudyRecorder',
  taskTitle: '수면 데이터 기록 중',
  taskDesc: '백그라운드에서 센서 데이터를 수집하고 있습니다.',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#ff00ff',
  linkingURI: 'blereact:///',
  parameters: {
    delay: FLUSH_INTERVAL,
  },
};

// ===================== 서비스 제어 =====================

/** 백그라운드 서비스 시작 */
export const startBackgroundService = async (): Promise<boolean> => {
  if (!BackgroundService.isRunning()) {
    await BackgroundService.start(backgroundTask, backgroundOptions);
    await BackgroundService.updateNotification({ taskDesc: '수면 데이터 기록 중...' });
    return true;
  }
  return false;
};

/** 백그라운드 서비스 중지 */
export const stopBackgroundService = async (): Promise<boolean> => {
  if (BackgroundService.isRunning()) {
    await BackgroundService.stop();
    return true;
  }
  return false;
};
