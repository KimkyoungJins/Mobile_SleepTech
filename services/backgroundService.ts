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
import RNFS from 'react-native-fs';
import { sleep, getTimestamp } from '../utils/helpers';
import {
  globalIsRecording,
  globalFlushBuffer,
  globalWriteBuffer,
  getFilePath,
  getLastSentOffset,
  FLUSH_INTERVAL,
  CHUNK_SIZE_30SEC,
  MAX_BUFFER_SIZE,
} from './fileStorage';
import { uploadChunk } from './uploadService';

// ===================== 백그라운드 태스크 =====================

/**
 * 백그라운드에서 실행되는 메인 함수
 * - 무한 루프로 5초마다 실행
 * - 녹음 중이면 버퍼를 파일에 저장
 * - 30초 분량 데이터(960KB)가 모이면 서버에 업로드
 */
export const backgroundTask = async (taskDataArguments: { delay: number }) => {
  const { delay } = taskDataArguments;

  await new Promise<void>(async (resolve) => {
    for (let i = 0; BackgroundService.isRunning(); i++) {
      // 녹음 중이면 버퍼 → 파일 저장
      if (globalIsRecording) {
        // 버퍼 크기 제한 (OOM 방지) - flush 실패가 반복되면 오래된 데이터 버림
        if (globalWriteBuffer.length > MAX_BUFFER_SIZE) {
          const dropped = globalWriteBuffer.length - MAX_BUFFER_SIZE;
          globalWriteBuffer.splice(0, dropped);
          console.log(`[${getTimestamp()}] 버퍼 초과: ${dropped}개 청크 제거`);
        }

        await globalFlushBuffer();

        // 30초 분량 데이터가 모이면 서버 업로드 (실패 시 1회 재시도)
        try {
          const filePath = getFilePath();
          const exists = await RNFS.exists(filePath);
          if (exists) {
            const stat = await RNFS.stat(filePath);
            const fileSize = Number(stat.size);
            const lastOffset = getLastSentOffset();
            const newDataSize = fileSize - lastOffset;

            if (newDataSize >= CHUNK_SIZE_30SEC) {
              console.log(`[${getTimestamp()}] 30초 분량 도달: ${newDataSize} bytes >= ${CHUNK_SIZE_30SEC} bytes`);
              const success = await uploadChunk();
              if (!success) {
                console.log(`[${getTimestamp()}] 업로드 실패, 5초 후 재시도`);
                await sleep(5000);
                await uploadChunk();
              }
            }
          }
        } catch (err: any) {
          console.log(`[${getTimestamp()}] 파일 크기 확인 에러: ${err.message}`);
        }
      }

      console.log(`[${getTimestamp()}] Background: cycle=${i}, recording=${globalIsRecording}, buffer=${globalWriteBuffer.length}`);
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
