/**
 * =============================================================================
 * 백그라운드 서비스 (backgroundService.ts)
 * =============================================================================
 *
 * [개요]
 * 앱이 백그라운드에 있어도 계속 실행되는 서비스를 관리합니다.
 * Android의 Foreground Service를 활용하여 시스템이 앱을 종료하지 않도록 합니다.
 *
 * [왜 백그라운드 서비스가 필요한가?]
 * - 일반적으로 앱이 백그라운드로 가면 Android가 리소스 절약을 위해 앱을 일시정지/종료
 * - 수면 데이터 기록은 8시간 이상 연속 실행이 필요
 * - Foreground Service로 실행하면 시스템이 앱을 종료하지 않음
 * - 대신 알림바에 "앱이 실행 중"임을 사용자에게 표시해야 함
 *
 * [HeadlessJS란?]
 * - React Native에서 UI 없이 JavaScript 코드를 실행하는 방식
 * - 백그라운드 서비스의 태스크 함수가 HeadlessJS로 실행됨
 * - React 컴포넌트의 state/ref에 접근 불가 → 전역 변수 사용 필요
 *
 * [핵심 역할]
 * 1. 5초마다 globalFlushBuffer() 호출 → 버퍼 데이터를 파일에 저장
 * 2. 알림바에 서비스 상태 표시 → 사용자가 녹음 중임을 인지
 * 3. 앱이 백그라운드에 있어도 BLE 데이터 수신 및 저장 유지
 *
 * =============================================================================
 */

import BackgroundService from 'react-native-background-actions';
// react-native-background-actions 라이브러리
// - Android Foreground Service를 쉽게 구현하도록 도와주는 라이브러리
// - start(): 백그라운드 서비스 시작 (알림 표시)
// - stop(): 백그라운드 서비스 종료
// - isRunning(): 현재 서비스 실행 중인지 확인
// - updateNotification(): 알림 내용 업데이트

import { sleep, getTimestamp } from '../utils/helpers';
import {
  globalIsRecording,
  globalFlushBuffer,
  globalWriteBuffer,
  FLUSH_INTERVAL
} from './fileStorage';

// =============================================================================
// 백그라운드 태스크 함수
// =============================================================================

/**
 * 백그라운드에서 실행되는 메인 태스크 함수
 *
 * [실행 환경]
 * - HeadlessJS 환경에서 실행 (UI 스레드와 분리)
 * - React 컴포넌트의 state, ref에 접근 불가
 * - 전역 변수(globalWriteBuffer 등)를 통해 데이터 접근
 *
 * [동작 방식]
 * - 무한 루프로 계속 실행
 * - 매 루프마다:
 *   1. 녹음 중이면 버퍼 → 파일 저장 (globalFlushBuffer)
 *   2. 디버깅용 로그 출력
 *   3. 지정된 시간(5초) 대기
 * - BackgroundService.stop() 호출 시 루프 종료
 *
 * [왜 무한 루프인가?]
 * - 백그라운드 서비스는 한 번 시작하면 계속 실행되어야 함
 * - for 루프의 조건이 BackgroundService.isRunning()
 * - stop() 호출 시 isRunning()이 false가 되어 루프 종료
 *
 * @param taskDataArguments - backgroundOptions.parameters에서 전달된 값
 * @param taskDataArguments.delay - 루프 반복 간격 (밀리초)
 */
export const backgroundTask = async (taskDataArguments: { delay: number }) => {
  // parameters에서 delay 값 추출 (기본값: FLUSH_INTERVAL = 5000ms)
  const { delay } = taskDataArguments;

  // -----------------------------------------
  // 무한 루프 시작
  // -----------------------------------------
  // Promise로 감싸는 이유:
  // - BackgroundService가 Promise가 resolve되면 태스크 종료로 인식
  // - resolve()를 호출하지 않으면 계속 실행
  await new Promise<void>(async (resolve) => {

    // i: 루프 카운터 (디버깅용)
    // BackgroundService.isRunning(): true면 계속 실행
    for (let i = 0; BackgroundService.isRunning(); i++) {

      // -----------------------------------------
      // [핵심] 녹음 중이면 버퍼를 파일에 저장
      // -----------------------------------------
      // globalIsRecording: fileStorage.ts의 전역 변수
      // - true일 때만 파일 저장 수행
      // - false면 저장 안 함 (버퍼에 데이터도 안 쌓임)
      if (globalIsRecording) {
        await globalFlushBuffer();
      }

      // -----------------------------------------
      // 서비스 생존 확인 로그 (디버깅용)
      // -----------------------------------------
      // 출력 예시: [14:30:25] Background service alive: 10, recording: true, buffer: 5
      // - i: 몇 번째 루프인지
      // - recording: 현재 녹음 상태
      // - buffer: 현재 버퍼에 쌓인 데이터 수
      console.log(`[${getTimestamp()}] Background service alive: ${i}, recording: ${globalIsRecording}, buffer: ${globalWriteBuffer.length}`);

      // -----------------------------------------
      // 다음 루프까지 대기
      // -----------------------------------------
      // delay(5000ms) 동안 대기 후 다음 루프 실행
      // sleep()은 utils/helpers.ts의 Promise 기반 대기 함수
      await sleep(delay);
    }

    // 루프 종료 시 (stop() 호출됨)
    // resolve()를 호출해도 되지만, 실제로는 서비스가 중지되므로 도달 안 함
  });
};

// =============================================================================
// 백그라운드 서비스 옵션
// =============================================================================

/**
 * 백그라운드 서비스 설정 객체
 *
 * [역할]
 * - Android Foreground Service의 알림(Notification) 설정
 * - 태스크 함수에 전달할 파라미터 정의
 *
 * [Android Foreground Service 알림이 필요한 이유]
 * - Android 8.0(Oreo) 이상에서는 백그라운드 실행 제한
 * - Foreground Service는 알림바에 표시되어야 함 (사용자 인지)
 * - 알림이 있어야 시스템이 앱을 종료하지 않음
 */
export const backgroundOptions = {
  // -----------------------------------------
  // 태스크 식별 정보
  // -----------------------------------------

  /**
   * 태스크 이름 (내부 식별용)
   * - 시스템에서 이 서비스를 구분하는 데 사용
   * - 사용자에게는 보이지 않음
   */
  taskName: 'SleepStudyRecorder',

  // -----------------------------------------
  // 알림 표시 정보
  // -----------------------------------------

  /**
   * 알림 제목
   * - 알림바에서 큰 글씨로 표시됨
   * - 예: "수면 데이터 기록 중"
   */
  taskTitle: '수면 데이터 기록 중',

  /**
   * 알림 설명
   * - 알림바에서 작은 글씨로 표시됨
   * - updateNotification()으로 동적 변경 가능
   */
  taskDesc: '백그라운드에서 센서 데이터를 수집하고 있습니다.',

  /**
   * 알림 아이콘 설정
   * - name: android/app/src/main/res/mipmap-xxhdpi 등에 있는 아이콘 이름
   * - type: 리소스 타입 (mipmap, drawable 등)
   */
  taskIcon: {
    name: 'ic_launcher',  // 앱 아이콘 사용
    type: 'mipmap',
  },

  /**
   * 알림 강조 색상
   * - 알림의 액센트 컬러
   * - 일부 기기에서 알림 아이콘 배경색으로 사용
   */
  color: '#ff00ff',

  // -----------------------------------------
  // 앱 연결 설정
  // -----------------------------------------

  /**
   * 딥링크 URI
   * - 알림을 터치했을 때 앱의 이 경로로 이동
   * - app.json의 scheme과 일치해야 함
   * - 예: 'blereact:///' → 앱 메인 화면으로 이동
   */
  linkingURI: 'blereact:///',

  // -----------------------------------------
  // 태스크 함수 파라미터
  // -----------------------------------------

  /**
   * backgroundTask 함수에 전달될 파라미터
   * - delay: 루프 반복 간격 (밀리초)
   * - FLUSH_INTERVAL(5000ms)을 사용하여 5초마다 파일 저장
   */
  parameters: {
    delay: FLUSH_INTERVAL,  // 5000ms = 5초
  },
};

// =============================================================================
// 서비스 제어 함수
// =============================================================================

/**
 * 백그라운드 서비스 시작
 *
 * [호출 시점]
 * - 사용자가 "저장 시작" 버튼을 눌렀을 때
 *
 * [동작]
 * 1. 이미 실행 중인지 확인 (중복 시작 방지)
 * 2. backgroundTask를 backgroundOptions 설정으로 시작
 * 3. 알림 내용 업데이트 (선택적)
 *
 * [결과]
 * - 알림바에 "수면 데이터 기록 중" 알림 표시
 * - backgroundTask 함수가 HeadlessJS로 실행 시작
 * - 5초마다 버퍼 → 파일 저장이 수행됨
 *
 * @returns {Promise<boolean>} - 서비스가 새로 시작되었으면 true, 이미 실행 중이면 false
 */
export const startBackgroundService = async (): Promise<boolean> => {
  // 이미 실행 중이면 중복 시작하지 않음
  if (!BackgroundService.isRunning()) {
    // 백그라운드 서비스 시작
    // - backgroundTask: 실행할 함수
    // - backgroundOptions: 알림 설정 및 파라미터
    await BackgroundService.start(backgroundTask, backgroundOptions);

    // 알림 내용 업데이트 (선택적)
    // - 시작 후 더 구체적인 메시지로 변경
    await BackgroundService.updateNotification({ taskDesc: '수면 데이터 기록 중...' });

    return true;  // 새로 시작됨
  }
  return false;  // 이미 실행 중
};

/**
 * 백그라운드 서비스 중지
 *
 * [호출 시점]
 * - 사용자가 "저장 중지" 버튼을 눌렀을 때
 * - 사용자가 "연결 해제" 버튼을 눌렀을 때
 * - 앱이 완전히 종료될 때 (cleanup)
 *
 * [동작]
 * 1. 실행 중인지 확인
 * 2. BackgroundService.stop() 호출
 * 3. backgroundTask의 루프가 종료됨 (isRunning() === false)
 *
 * [결과]
 * - 알림바에서 알림 제거
 * - backgroundTask 함수 실행 종료
 * - 더 이상 자동 파일 저장 안 됨
 *
 * [주의]
 * - stop() 전에 globalFlushBuffer()를 호출해야 남은 데이터 저장됨
 * - 이 함수는 버퍼 flush를 자동으로 하지 않음 (호출자가 처리)
 *
 * @returns {Promise<boolean>} - 서비스가 중지되었으면 true, 이미 중지 상태면 false
 */
export const stopBackgroundService = async (): Promise<boolean> => {
  // 실행 중일 때만 중지
  if (BackgroundService.isRunning()) {
    // 백그라운드 서비스 중지
    // - backgroundTask의 for 루프 조건이 false가 됨
    // - 알림이 제거됨
    await BackgroundService.stop();

    return true;  // 중지됨
  }
  return false;  // 이미 중지 상태
};
