/**
 * =============================================================================
 * Sleep Recorder - 수면 데이터 기록 앱
 * =============================================================================
 *
 * 이 앱은 BLE(Bluetooth Low Energy)를 통해 수면 센서로부터 데이터를 수신하고,
 * 백그라운드에서도 안정적으로 파일에 저장하는 기능을 제공합니다.
 *
 * 주요 기능:
 * 1. BLE 디바이스 스캔 및 연결 (Nordic UART Service 사용)
 * 2. 백그라운드 서비스를 통한 장시간(8시간+) 데이터 수집
 * 3. 효율적인 버퍼링 시스템으로 파일 저장 (5초 간격 배치 쓰기)
 * 4. BLE 연결 끊김 시 자동 재연결 (최대 10회 시도)
 * 5. 저장된 데이터 파일 공유 기능
 *
 * 대상 플랫폼: Android (삼성폰 최적화)
 * =============================================================================
 */

// =============================================================================
// 라이브러리 임포트
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
// React 핵심 훅들:
// - useEffect: 컴포넌트 생명주기 관리 (마운트/언마운트/업데이트 시 실행)
// - useRef: 리렌더링 없이 값을 유지하는 참조 객체 생성
// - useState: 컴포넌트 상태 관리 (값 변경 시 리렌더링 발생)

import {
  Alert,          // 시스템 알림 다이얼로그 표시
  AppState,       // 앱의 포그라운드/백그라운드 상태 감지
  FlatList,       // 효율적인 스크롤 리스트 (가상화 지원)
  Linking,        // 외부 URL/앱 설정 화면 열기
  LogBox,         // 개발 중 불필요한 경고 숨기기
  PermissionsAndroid, // 안드로이드 권한 요청
  Platform,       // 플랫폼(iOS/Android) 구분
  StyleSheet,     // 스타일 객체 생성
  Text,           // 텍스트 표시 컴포넌트
  TouchableOpacity, // 터치 가능한 버튼 컴포넌트
  View            // 레이아웃 컨테이너 컴포넌트
} from 'react-native';

import * as Sharing from 'expo-sharing';
// 파일 공유 기능 제공 (다른 앱으로 파일 전송)

import BackgroundService from 'react-native-background-actions';
// 안드로이드 백그라운드 서비스 관리
// - 앱이 백그라운드에 있어도 포그라운드 서비스로 실행 유지
// - 알림바에 서비스 실행 중임을 표시

import { fromByteArray, toByteArray } from 'base64-js';
// Base64 인코딩/디코딩 라이브러리
// - toByteArray: Base64 문자열 -> Uint8Array (바이너리 데이터)
// - fromByteArray: Uint8Array -> Base64 문자열

import { BleManager } from 'react-native-ble-plx';
// BLE(Bluetooth Low Energy) 통신 라이브러리
// - 디바이스 스캔, 연결, 데이터 송수신 기능 제공

import RNFS from 'react-native-fs';
// 파일 시스템 접근 라이브러리
// - 파일 읽기/쓰기/삭제
// - 앱 문서 디렉토리 경로 제공

// =============================================================================
// 전역 상수 정의
// =============================================================================

/**
 * BLE 매니저 인스턴스
 * 앱 전체에서 하나의 인스턴스만 사용 (싱글톤 패턴)
 * 컴포넌트 외부에 선언하여 리렌더링 시에도 동일 인스턴스 유지
 */
const manager = new BleManager();

/**
 * Nordic UART Service (NUS) UUID 정의
 * Nordic Semiconductor의 표준 UART over BLE 프로토콜
 *
 * NUS_SERVICE_UUID: 서비스 식별자 - 이 UUID를 가진 서비스를 찾아 연결
 * NUS_TX_CHARACTERISTIC_UUID: TX 특성 - 디바이스가 데이터를 보내는 채널
 *                              (TX는 디바이스 기준, 앱에서는 수신용)
 *
 * 참고: RX 특성(6E400002)은 앱에서 디바이스로 데이터를 보낼 때 사용
 */
const NUS_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_TX_CHARACTERISTIC_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';

/**
 * BLE 디바이스 이름 필터
 * 스캔 중 이 문자열이 포함된 디바이스만 연결 대상으로 인식
 */
const DEVICE_NAME_FILTER = 'Nordic_UART_S';

// =============================================================================
// 유틸리티 함수
// =============================================================================

/**
 * 지정된 시간(밀리초) 동안 대기하는 Promise 반환
 * 백그라운드 태스크의 루프 딜레이에 사용
 *
 * @param {number} time - 대기 시간 (밀리초)
 * @returns {Promise} - 지정 시간 후 resolve되는 Promise
 *
 * 사용 예: await sleep(1000); // 1초 대기
 */
const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

/**
 * 현재 시간을 한국어 형식의 문자열로 반환
 * 로그 출력 시 타임스탬프로 사용
 *
 * @returns {string} - "HH:MM:SS" 형식의 시간 문자열
 *
 * 예: "14:30:25"
 */
const getTimestamp = () => {
  const now = new Date();
  return now.toLocaleString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false  // 24시간 형식 사용
  });
};

// =============================================================================
// 백그라운드 서비스 설정
// =============================================================================

/**
 * 백그라운드에서 실행되는 메인 태스크 함수
 *
 * 이 함수는 BackgroundService.start()로 시작되며,
 * 앱이 백그라운드에 있어도 계속 실행됩니다.
 *
 * 주요 역할:
 * 1. 서비스가 살아있음을 주기적으로 로그로 출력 (디버깅용)
 * 2. 무한 루프를 통해 서비스 유지
 *
 * 실제 BLE 데이터 수신은 별도의 모니터링 콜백에서 처리됨
 * 이 태스크는 서비스 유지를 위한 "심장박동" 역할
 *
 * @param {Object} taskDataArguments - 백그라운드 옵션에서 전달된 parameters
 * @param {number} taskDataArguments.delay - 루프 반복 간격 (밀리초)
 */
const backgroundTask = async (taskDataArguments) => {
    const { delay } = taskDataArguments;

    // 무한 루프: BackgroundService.isRunning()이 true인 동안 계속 실행
    await new Promise(async (resolve) => {
        for (let i = 0; BackgroundService.isRunning(); i++) {
            // 서비스 생존 확인 로그 (타임스탬프 포함)
            console.log(`[${getTimestamp()}] Background service is alive: ${i}`);
            await sleep(delay);  // 지정된 시간만큼 대기
        }
    });
};

/**
 * 백그라운드 서비스 옵션 설정
 *
 * 안드로이드 포그라운드 서비스의 알림 설정 및 동작 방식 정의
 * 이 설정은 시스템이 앱을 강제 종료하지 않도록 하는 데 중요
 */
const backgroundOptions = {
    // 태스크 식별 이름 (내부 식별용)
    taskName: 'SleepStudyRecorder',

    // 알림바에 표시되는 제목
    taskTitle: '수면 데이터 기록 중',

    // 알림바에 표시되는 설명 텍스트
    taskDesc: '백그라운드에서 센서 데이터를 수집하고 있습니다.',

    // 알림에 표시될 아이콘 설정
    taskIcon: {
        name: 'ic_launcher',  // 아이콘 파일명
        type: 'mipmap',       // 리소스 타입 (mipmap 폴더에서 가져옴)
    },

    // 알림 강조 색상
    color: '#ff00ff',

    // 딥링크 URI: 알림 터치 시 앱의 이 경로로 이동
    // app.json의 scheme과 일치해야 함
    linkingURI: 'blereact:///',

    // backgroundTask 함수에 전달될 파라미터
    parameters: {
        delay: 5000,  // 5초마다 로그 출력
    },
};

// =============================================================================
// 메인 컴포넌트
// =============================================================================

/**
 * HomeScreen - 앱의 메인 화면 컴포넌트
 *
 * BLE 연결, 데이터 수신, 파일 저장, UI 표시를 모두 담당하는 핵심 컴포넌트
 * Expo Router의 탭 내비게이션에서 첫 번째 탭으로 표시됨
 */
export default function HomeScreen() {

  // ===========================================================================
  // useState - UI에 표시되는 상태 관리
  // 이 값들이 변경되면 컴포넌트가 리렌더링됨
  // ===========================================================================

  /**
   * BLE 연결 상태
   * true: 디바이스와 연결됨, false: 연결 안 됨
   * UI에서 버튼 텍스트 및 상태 표시에 사용
   */
  const [isConnected, setIsConnected] = useState(false);

  /**
   * 현재 연결된 BLE 디바이스 객체
   * 연결 해제, MTU 요청 등에 사용
   * null이면 연결된 디바이스 없음
   */
  const [device, setDevice] = useState(null);

  /**
   * UI에 표시되는 로그 메시지 배열
   * 최대 50개까지만 유지 (메모리 절약)
   * 각 항목: { text: string, timestamp: string }
   */
  const [logs, setLogs] = useState([]);

  /**
   * UI에 표시되는 수신 패킷 수
   * 실제 카운트는 packetCountRef에서 관리하고, 주기적으로 동기화
   */
  const [packetCount, setPacketCount] = useState(0);

  /**
   * 녹음(파일 저장) 상태
   * true: 수신 데이터를 파일에 저장 중
   * false: 데이터 수신만 하고 저장 안 함
   */
  const [isRecording, setIsRecording] = useState(false);

  // ===========================================================================
  // useRef - 리렌더링 없이 값을 유지하는 참조 변수들
  // 콜백 함수 내에서 최신 값에 접근하거나, 빈번한 업데이트가 필요할 때 사용
  // ===========================================================================

  /**
   * UI 업데이트 쓰로틀링을 위한 마지막 업데이트 시간
   * 너무 빈번한 UI 업데이트를 방지 (10초에 1번만 업데이트)
   */
  const timeRef = useRef(0);

  /**
   * 녹음 상태의 ref 버전
   * BLE 콜백 내에서 최신 녹음 상태를 확인하기 위해 필요
   * (useState의 값은 콜백 생성 시점의 값으로 고정됨 - 클로저 문제)
   */
  const isRecordingRef = useRef(false);

  /**
   * 앱이 포그라운드(활성) 상태인지 추적
   * 백그라운드에서는 UI 업데이트를 건너뛰어 리소스 절약
   */
  const isAppActiveRef = useRef(true);

  /**
   * 디바이스 객체의 ref 버전
   * 컴포넌트 언마운트 시 cleanup에서 연결 해제할 때 사용
   */
  const deviceRef = useRef(null);

  /**
   * BLE 모니터링 subscription 객체
   * 연결 해제 시 모니터링을 중지하기 위해 저장
   */
  const monitorSubscriptionRef = useRef(null);

  /**
   * 실제 수신 패킷 카운트
   * 매 패킷마다 증가시키되, UI 업데이트는 주기적으로만 수행
   * (빈번한 setState 호출로 인한 성능 저하 방지)
   */
  const packetCountRef = useRef(0);

  // ---------------------------------------------------------------------------
  // 파일 쓰기 버퍼링 관련 ref
  // 매 패킷마다 파일 쓰기 대신, 버퍼에 모아서 주기적으로 일괄 저장
  // ---------------------------------------------------------------------------

  /**
   * 파일에 쓸 데이터를 임시 저장하는 버퍼
   * Base64 인코딩된 문자열 배열
   */
  const writeBufferRef = useRef([]);

  /**
   * 주기적 버퍼 flush를 위한 setInterval ID
   * 타이머 정지 시 clearInterval에 사용
   */
  const flushIntervalRef = useRef(null);

  /**
   * 파일 초기화(생성) 여부
   * 첫 쓰기 시 파일 존재 여부 확인 후 true로 설정
   * 이후에는 appendFile만 사용
   */
  const fileInitializedRef = useRef(false);

  /**
   * 버퍼 flush 간격 (밀리초)
   * 5000ms = 5초마다 버퍼에 쌓인 데이터를 파일에 저장
   * 너무 짧으면 I/O 부하 증가, 너무 길면 데이터 손실 위험
   */
  const FLUSH_INTERVAL = 5000;

  // ---------------------------------------------------------------------------
  // BLE 자동 재연결 관련 ref
  // 연결이 끊어졌을 때 자동으로 재연결 시도
  // ---------------------------------------------------------------------------

  /**
   * 마지막으로 연결했던 디바이스 ID
   * 재연결 시도 시 동일 디바이스를 찾기 위해 저장
   */
  const lastDeviceIdRef = useRef(null);

  /**
   * 현재 재연결 시도 횟수
   * 연속 실패 시 무한 재시도 방지
   */
  const reconnectAttemptRef = useRef(0);

  /**
   * 최대 재연결 시도 횟수
   * 이 횟수를 초과하면 재연결 포기
   */
  const MAX_RECONNECT_ATTEMPTS = 10;

  /**
   * BLE 연결 끊김 이벤트 리스너
   * 수동 해제 시 자동 재연결 방지를 위해 제거 가능하도록 저장
   */
  const disconnectionListenerRef = useRef(null);

  // ===========================================================================
  // 파일 경로 설정
  // ===========================================================================

  /**
   * 저장할 파일 이름
   * .raw 확장자: 가공되지 않은 바이너리 데이터임을 표시
   */
  const fileName = 'data.raw';

  /**
   * 파일의 전체 경로
   * RNFS.DocumentDirectoryPath: 앱 전용 문서 디렉토리
   * 안드로이드: /data/data/com.yourname.bleapp/files/
   * 이 디렉토리의 파일은 앱 삭제 시 함께 삭제됨
   */
  const filePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

  // ===========================================================================
  // useEffect 훅 - 생명주기 관리
  // ===========================================================================

  /**
   * isRecording 상태 변경 시 ref 동기화
   *
   * 필요한 이유:
   * BLE 모니터링 콜백은 컴포넌트 마운트 시 한 번만 생성됨
   * 콜백 내에서 isRecording을 직접 참조하면 생성 당시 값(false)만 보임
   * ref를 통해 항상 최신 값에 접근 가능
   */
  useEffect(() => {
    isRecordingRef.current = isRecording;
    console.log(`녹음 상태 변경: ${isRecording}`);
  }, [isRecording]);

  /**
   * device 상태 변경 시 ref 동기화
   *
   * 컴포넌트 cleanup에서 연결 해제 시 사용
   * useEffect의 cleanup 함수는 마운트 시점의 device 값을 캡처하므로
   * ref를 통해 최신 device 객체에 접근
   */
  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  /**
   * AppState 리스너 설정
   *
   * 앱이 백그라운드로 가거나 포그라운드로 돌아올 때 감지
   * 백그라운드에서는 불필요한 UI 업데이트를 건너뛰어 리소스 절약
   *
   * AppState 값:
   * - 'active': 앱이 포그라운드에서 실행 중
   * - 'background': 앱이 백그라운드에 있음
   * - 'inactive': 전환 중 (iOS에서 주로 발생)
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      isAppActiveRef.current = nextAppState === 'active';
      console.log(`앱 상태 변경: ${nextAppState}`);
    });

    // cleanup: 컴포넌트 언마운트 시 리스너 제거
    return () => {
      subscription.remove();
    };
  }, []);

  /**
   * 배터리 최적화 제외 요청 함수
   *
   * 삼성폰에서 장시간 백그라운드 실행을 위해 필수
   * 안드로이드는 배터리 절약을 위해 백그라운드 앱을 제한하는데,
   * 이 제한에서 제외되어야 8시간 이상 안정적으로 동작 가능
   *
   * 자동 제외는 불가능하고, 사용자가 직접 설정해야 함
   */
  const requestBatteryOptimizationExclusion = async () => {
    // iOS에서는 필요 없음
    if (Platform.OS !== 'android') return;

    try {
      // 사용자에게 설정 방법 안내
      Alert.alert(
        "배터리 최적화 제외 필요",
        "앱이 백그라운드에서 8시간 이상 안정적으로 동작하려면 배터리 최적화에서 제외해야 합니다.\n\n" +
        "설정 > 앱 > 이 앱 > 배터리 > '제한 없음' 선택\n\n" +
        "또는 설정 > 배터리 > 백그라운드 사용 제한 > 이 앱 제외",
        [
          { text: "나중에", style: "cancel" },
          {
            text: "설정으로 이동",
            onPress: () => {
              // 앱 설정 화면으로 이동 (배터리 설정은 직접 열 수 없음)
              Linking.openSettings();
            }
          }
        ]
      );
    } catch (err) {
      console.log('배터리 최적화 설정 에러:', err);
    }
  };

  /**
   * 컴포넌트 마운트 시 초기화 및 언마운트 시 정리
   *
   * 마운트 시:
   * 1. 불필요한 경고 로그 숨기기
   * 2. BLE 관련 권한 요청
   * 3. 배터리 최적화 제외 안내
   *
   * 언마운트 시 (cleanup):
   * 1. 파일 쓰기 타이머 정지
   * 2. 남은 버퍼 데이터 저장
   * 3. BLE 스캔 중지
   * 4. BLE 연결 해제
   * 5. 백그라운드 서비스 정지
   * 6. BLE 매니저 리소스 해제
   */
  useEffect(() => {
    // NativeEventEmitter 관련 경고 숨기기 (react-native-ble-plx에서 발생)
    LogBox.ignoreLogs(['new NativeEventEmitter']);

    /**
     * 안드로이드 권한 요청
     * BLE 사용에 필요한 모든 권한을 한 번에 요청
     */
    const requestPermissions = async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          // BLE 스캔 권한 (안드로이드 12+)
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          // BLE 연결 권한 (안드로이드 12+)
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          // 위치 권한 (BLE 스캔에 필요)
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          // 알림 권한 (안드로이드 13+, 백그라운드 서비스 알림용)
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ]);

        // 첫 실행 시 배터리 최적화 제외 안내
        requestBatteryOptimizationExclusion();
      }
    };
    requestPermissions();

    /**
     * Cleanup 함수
     * 컴포넌트 언마운트 시 모든 리소스 정리
     * 메모리 누수 및 예기치 않은 동작 방지
     */
    return () => {
      // 1. 파일 쓰기 타이머 정지
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = null;
      }

      // 2. 버퍼에 남은 데이터 저장 시도
      flushBuffer();

      // 3. BLE 스캔 중지
      manager.stopDeviceScan();

      // 4. BLE 연결 끊김 리스너 제거
      if (disconnectionListenerRef.current) {
        disconnectionListenerRef.current.remove();
        disconnectionListenerRef.current = null;
      }

      // 5. BLE 데이터 모니터링 중지
      if (monitorSubscriptionRef.current) {
        monitorSubscriptionRef.current.remove();
        monitorSubscriptionRef.current = null;
      }

      // 6. BLE 디바이스 연결 해제
      if (deviceRef.current) {
        deviceRef.current.cancelConnection()
          .catch((err) => console.log('연결 해제 에러:', err.message));
      }

      // 7. 백그라운드 서비스 정지
      BackgroundService.stop();

      // 8. BLE 매니저 리소스 해제
      manager.destroy();
    };
  }, []);

  // ===========================================================================
  // 로그 함수
  // ===========================================================================

  /**
   * UI 로그 리스트에 메시지 추가
   *
   * @param {string} msg - 표시할 메시지
   *
   * 최대 50개까지만 유지하여 메모리 사용량 제한
   * 새 메시지는 리스트 맨 앞에 추가 (최신 순)
   */
  const addLog = (msg) => {
    const logEntry = {
      text: msg,
      timestamp: new Date().toLocaleTimeString()
    };
    // 기존 로그 앞에 새 로그 추가, 50개 초과 시 오래된 것 제거
    setLogs((prev) => [logEntry, ...prev].slice(0, 50));
  };

  // ===========================================================================
  // BLE 스캔 및 연결 함수
  // ===========================================================================

  /**
   * BLE 디바이스 스캔 시작 및 자동 연결
   *
   * 1. 모든 BLE 디바이스 스캔
   * 2. DEVICE_NAME_FILTER에 해당하는 디바이스 발견 시 스캔 중지
   * 3. 해당 디바이스에 자동 연결
   */
  const scanAndConnect = () => {
    addLog('스캔 시작...');

    // 파라미터: (serviceUUIDs, options, callback)
    // null, null: 모든 디바이스 스캔 (필터 없음)
    manager.startDeviceScan(null, null, (error, scannedDevice) => {

      if (error) {
        addLog(`스캔 에러: ${error.message}`);
        return;
      }

      // 디바이스 이름에 필터 문자열이 포함되어 있는지 확인
      if (scannedDevice.name && scannedDevice.name.includes(DEVICE_NAME_FILTER)) {
        // 타겟 디바이스 발견 - 스캔 중지
        manager.stopDeviceScan();
        addLog(`타겟 발견: ${scannedDevice.name}`);
        // 연결 시도
        connectToDevice(scannedDevice);
      }

    });
  };

  /**
   * Base64 문자열을 일반 문자열로 디코딩
   * 로그 표시용으로 사용 (디버깅 목적)
   *
   * @param {string} base64String - Base64 인코딩된 문자열
   * @returns {string} - 디코딩된 문자열 (실패 시 빈 문자열)
   */
  const decodeBase64 = (base64String) => {
    try {
      return atob(base64String);  // 내장 Base64 디코더
    } catch (e) {
      return "";
    }
  };

  // ===========================================================================
  // 파일 쓰기 버퍼링 시스템
  // 매 패킷마다 파일 쓰기 대신 버퍼에 모아서 주기적으로 저장
  // I/O 작업 횟수를 크게 줄여 배터리 소모 감소 및 성능 향상
  // ===========================================================================

  /**
   * 버퍼에 데이터 추가
   * BLE 데이터 수신 시마다 호출됨
   *
   * @param {string} data - Base64 인코딩된 수신 데이터
   */
  const appendData = (data) => {
    if (!data) return;
    writeBufferRef.current.push(data);
  };

  /**
   * 버퍼의 데이터를 파일에 일괄 저장
   * FLUSH_INTERVAL(5초) 간격으로 자동 호출됨
   *
   * 처리 과정:
   * 1. 버퍼 복사 후 초기화 (새 데이터 수신 가능하도록)
   * 2. 모든 Base64 청크를 바이너리로 디코딩
   * 3. 하나의 Uint8Array로 합치기
   * 4. 다시 Base64로 인코딩
   * 5. 파일에 한 번에 쓰기
   *
   * 이 방식의 장점:
   * - 여러 개의 작은 쓰기 대신 하나의 큰 쓰기로 I/O 효율성 증가
   * - 10시간 기준 약 36만 회 → 7,200회로 쓰기 횟수 감소
   */
  const flushBuffer = async () => {
    // 버퍼가 비어있으면 아무것도 안 함
    if (writeBufferRef.current.length === 0) return;

    // 버퍼 복사 후 즉시 초기화
    // (flush 중에도 새 데이터가 들어올 수 있으므로)
    const chunksToWrite = [...writeBufferRef.current];
    writeBufferRef.current = [];

    try {
      // 1. 모든 Base64 청크를 바이너리 배열로 변환
      const byteArrays = chunksToWrite
        .filter(chunk => chunk) // null/undefined 제거
        .map(chunk => {
          try {
            return toByteArray(chunk);  // Base64 -> Uint8Array
          } catch (e) {
            console.log(`[${getTimestamp()}] base64 디코딩 에러`);
            return null;
          }
        })
        .filter(arr => arr !== null);  // 디코딩 실패한 것 제거

      if (byteArrays.length === 0) return;

      // 2. 전체 바이트 수 계산
      const totalLength = byteArrays.reduce((sum, arr) => sum + arr.length, 0);

      // 3. 하나의 Uint8Array로 합치기
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const arr of byteArrays) {
        combinedArray.set(arr, offset);
        offset += arr.length;
      }

      // 4. 합쳐진 배열을 다시 Base64로 인코딩
      // (RNFS.appendFile은 Base64 데이터를 바이너리로 저장)
      const combinedBase64 = fromByteArray(combinedArray);

      // 5. 파일에 쓰기
      if (!fileInitializedRef.current) {
        // 첫 쓰기: 파일 존재 여부 확인
        const exists = await RNFS.exists(filePath);
        if (exists) {
          // 기존 파일에 추가
          await RNFS.appendFile(filePath, combinedBase64, 'base64');
        } else {
          // 새 파일 생성
          await RNFS.writeFile(filePath, combinedBase64, 'base64');
        }
        fileInitializedRef.current = true;
      } else {
        // 이후 쓰기: 파일에 추가
        await RNFS.appendFile(filePath, combinedBase64, 'base64');
      }

      console.log(`[${getTimestamp()}] ${chunksToWrite.length}개 청크 저장 완료 (${totalLength} bytes)`);

    } catch (err) {
      console.log(`[${getTimestamp()}] 파일 쓰기 에러:`, err.message);
      // 실패 시 데이터 손실 방지: 실패한 청크를 버퍼 앞에 다시 추가
      writeBufferRef.current = [...chunksToWrite, ...writeBufferRef.current];
    }
  };

  /**
   * 주기적 버퍼 flush 타이머 시작
   * 녹음 시작 시 호출됨
   */
  const startFlushTimer = () => {
    // 이미 실행 중이면 무시
    if (flushIntervalRef.current) return;

    // FLUSH_INTERVAL(5초)마다 flushBuffer 호출
    flushIntervalRef.current = setInterval(() => {
      flushBuffer();
    }, FLUSH_INTERVAL);

    console.log(`[${getTimestamp()}] 파일 쓰기 타이머 시작 (${FLUSH_INTERVAL}ms 간격)`);
  };

  /**
   * 버퍼 flush 타이머 정지 및 잔여 데이터 저장
   * 녹음 중지 또는 연결 해제 시 호출됨
   */
  const stopFlushTimer = async () => {
    // 타이머 정지
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    // 버퍼에 남은 데이터 즉시 저장
    await flushBuffer();
    console.log(`[${getTimestamp()}] 파일 쓰기 타이머 정지, 버퍼 flush 완료`);
  };

  // ===========================================================================
  // BLE 자동 재연결 시스템
  // 연결이 끊어졌을 때 자동으로 재연결 시도
  // 녹음 중일 때만 활성화 (데이터 손실 최소화)
  // ===========================================================================

  /**
   * BLE 재연결 시도 함수
   * 연결이 끊어졌을 때 자동으로 호출됨
   *
   * 1. 녹음 중이 아니면 재연결 안 함
   * 2. 최대 시도 횟수 초과 시 포기
   * 3. 이전 디바이스 ID로 직접 연결 시도
   * 4. 실패 시 5초 후 재시도
   */
  const attemptReconnect = async () => {
    // 재연결 조건 확인
    if (!lastDeviceIdRef.current || !isRecordingRef.current) {
      console.log(`[${getTimestamp()}] 재연결 조건 미충족 (녹음중: ${isRecordingRef.current})`);
      return;
    }

    // 최대 시도 횟수 확인
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[${getTimestamp()}] 최대 재연결 시도 횟수 초과`);
      addLog('재연결 실패: 최대 시도 횟수 초과');
      return;
    }

    reconnectAttemptRef.current += 1;
    console.log(`[${getTimestamp()}] 재연결 시도 ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS}`);

    try {
      // 이전 디바이스 ID로 디바이스 객체 가져오기
      const devices = await manager.devices([lastDeviceIdRef.current]);

      if (devices.length > 0) {
        // 디바이스 발견 - 연결 시도
        await connectToDevice(devices[0]);
        reconnectAttemptRef.current = 0; // 성공 시 카운터 리셋
        console.log(`[${getTimestamp()}] 재연결 성공`);
      } else {
        // 디바이스를 찾을 수 없음 - 스캔으로 전환
        console.log(`[${getTimestamp()}] 디바이스 재스캔 시작`);
        scanAndConnect();
      }
    } catch (err) {
      console.log(`[${getTimestamp()}] 재연결 실패:`, err.message);
      // 5초 후 재시도
      setTimeout(() => attemptReconnect(), 5000);
    }
  };

  /**
   * BLE 연결 끊김 리스너 설정
   * 연결 성공 후 호출됨
   *
   * @param {Device} connectedDevice - 연결된 BLE 디바이스 객체
   *
   * 연결이 끊어지면:
   * 1. UI 상태 업데이트
   * 2. 녹음 중이었다면 자동 재연결 시도
   */
  const setupDisconnectionListener = (connectedDevice) => {
    // 기존 리스너가 있으면 제거 (중복 방지)
    if (disconnectionListenerRef.current) {
      disconnectionListenerRef.current.remove();
    }

    // 연결 끊김 이벤트 리스너 등록
    disconnectionListenerRef.current = manager.onDeviceDisconnected(
      connectedDevice.id,
      (error, device) => {
        console.log(`[${getTimestamp()}] BLE 연결 끊김 감지`);

        // UI 상태 업데이트
        setIsConnected(false);
        setDevice(null);

        // 녹음 중이었다면 자동 재연결 시도
        if (isRecordingRef.current) {
          addLog('연결 끊김 - 재연결 시도 중...');
          // 2초 대기 후 재연결 (BLE 스택 안정화 대기)
          setTimeout(() => attemptReconnect(), 2000);
        } else {
          addLog('연결이 끊어졌습니다');
        }
      }
    );
  };

  /**
   * BLE 디바이스에 연결하고 데이터 수신 시작
   *
   * @param {Device} deviceToConnect - 연결할 BLE 디바이스 객체
   *
   * 처리 과정:
   * 1. 디바이스 연결
   * 2. 서비스 및 특성 탐색
   * 3. MTU(Maximum Transmission Unit) 크기 요청
   * 4. 연결 끊김 리스너 설정
   * 5. 데이터 수신 모니터링 시작
   */
  const connectToDevice = async (deviceToConnect) => {

    try {
      // 1. BLE 연결
      const connectedDevice = await deviceToConnect.connect();

      // 2. 서비스 및 특성 탐색 (GATT 프로파일 검색)
      await connectedDevice.discoverAllServicesAndCharacteristics();

      // 재연결용 디바이스 ID 저장
      lastDeviceIdRef.current = connectedDevice.id;

      // UI 상태 업데이트
      setDevice(connectedDevice);
      setIsConnected(true);
      addLog('연결 성공! 수신 대기 중...');

      // 3. MTU 크기 요청 (안드로이드만)
      // 기본 20바이트 → 247바이트로 증가
      // 한 번에 더 많은 데이터를 받을 수 있어 효율성 증가
      if (Platform.OS === 'android') {
        await connectedDevice.requestMTU(247);
        addLog('MTU 요청 완료');
      }

      // 4. 연결 끊김 리스너 설정
      setupDisconnectionListener(connectedDevice);

      // 5. BLE 데이터 수신 모니터링 시작
      // Nordic UART TX 특성에서 데이터가 올 때마다 콜백 실행
      // 백그라운드 서비스가 실행 중이면 앱이 백그라운드에 있어도 계속 동작
      monitorSubscriptionRef.current = connectedDevice.monitorCharacteristicForService(
        NUS_SERVICE_UUID,            // 서비스 UUID
        NUS_TX_CHARACTERISTIC_UUID,  // 특성 UUID (TX = 디바이스 → 앱)
        async (error, characteristic) => {
          // 에러 처리
          if (error) {
            console.log(`모니터링 에러: ${error.message}`);
            return;
          }

          // 데이터 수신 처리
          if (characteristic?.value) {
            // [핵심] 녹음 중이면 데이터를 버퍼에 저장
            // isRecordingRef를 사용해야 최신 상태 확인 가능
            if (isRecordingRef.current) {
              await appendData(characteristic.value);
            }

            // 패킷 카운트 증가 (ref로 즉시 업데이트, UI 렌더링 없음)
            packetCountRef.current += 1;

            // 앱이 백그라운드일 때는 UI 업데이트 건너뛰기
            // CPU 및 배터리 절약
            if (!isAppActiveRef.current) {
              return;
            }

            // UI 업데이트 쓰로틀링 (10초에 1번만)
            const now = Date.now();
            if (now - timeRef.current > 10000) {
              // 패킷 카운트 UI 동기화
              setPacketCount(packetCountRef.current);

              // 수신 데이터 로그 추가 (디버깅용)
              const converted = decodeBase64(characteristic.value);
              const logEntry = {
                text: converted,
                timestamp: new Date().toLocaleTimeString()
              };
              setLogs((prev) => [logEntry, ...prev].slice(0, 50));

              // 마지막 업데이트 시간 기록
              timeRef.current = now;
            }
          }
        }
      );

    } catch (error) {
      addLog(`연결 실패: ${error.message}`);
      setIsConnected(false);
    }
  };

  // ===========================================================================
  // 연결 해제 및 파일 관리 함수
  // ===========================================================================

  /**
   * BLE 연결 수동 해제
   *
   * 사용자가 "연결 해제" 버튼을 눌렀을 때 호출
   * 자동 재연결을 방지하고 모든 리소스 정리
   */
  const disconnect = async () => {
    // 파일 쓰기 타이머 정지 및 버퍼 flush
    await stopFlushTimer();

    // 백그라운드 서비스 종료
    if (BackgroundService.isRunning()) {
        await BackgroundService.stop();
    }

    // 연결 끊김 리스너 제거 (자동 재연결 방지)
    if (disconnectionListenerRef.current) {
      disconnectionListenerRef.current.remove();
      disconnectionListenerRef.current = null;
    }

    // BLE 모니터링 subscription 제거
    if (monitorSubscriptionRef.current) {
      monitorSubscriptionRef.current.remove();
      monitorSubscriptionRef.current = null;
    }

    // 재연결 관련 상태 초기화
    lastDeviceIdRef.current = null;
    reconnectAttemptRef.current = 0;

    // 디바이스 연결 해제
    if (device) {
      await device.cancelConnection();
      setDevice(null);
      setIsConnected(false);
      setIsRecording(false);
      addLog('연결 해제됨');
    }
  };

  /**
   * 저장된 데이터 파일 삭제
   *
   * 파일 삭제 후 관련 상태 초기화
   */
  const deleteFile = async () => {
    try {
      const exists = await RNFS.exists(filePath);
      if (exists) {
        await RNFS.unlink(filePath);  // 파일 삭제
        addLog('파일 삭제 완료');
        Alert.alert("알림", "저장된 데이터 파일이 삭제되었습니다.");

        // 관련 상태 초기화
        packetCountRef.current = 0;
        setPacketCount(0);
        fileInitializedRef.current = false;
        writeBufferRef.current = [];
      } else {
        Alert.alert("알림", "삭제할 파일이 없습니다.");
      }
    } catch (e) {
      addLog(`삭제 실패: ${e.message}`);
    }
  };

  /**
   * 녹음(파일 저장) 시작/중지 토글
   *
   * "저장 시작"/"저장 중지" 버튼 핸들러
   *
   * 녹음 시작 시:
   * 1. 백그라운드 서비스 시작 (앱이 내려가도 계속 실행)
   * 2. 파일 쓰기 타이머 시작
   *
   * 녹음 중지 시:
   * 1. 파일 쓰기 타이머 정지 및 잔여 데이터 저장
   * 2. 백그라운드 서비스 중지
   */
  const toggleRecording = async () => {
    // 연결 확인
    if (!isConnected) {
      Alert.alert("오류", "먼저 장치를 연결해주세요.");
      return;
    }

    // 다음 상태 계산 (현재 상태의 반대)
    const nextState = !isRecording;

    setIsRecording(nextState);

    if (nextState) {
        // === 녹음 시작 ===
        try {
            // 백그라운드 서비스가 실행 중이 아니면 시작
            if (!BackgroundService.isRunning()) {
                await BackgroundService.start(backgroundTask, backgroundOptions);
                await BackgroundService.updateNotification({taskDesc: '수면 데이터 기록 중...'});
                addLog('백그라운드 서비스 시작됨');
            }
            // 파일 쓰기 타이머 시작
            startFlushTimer();
        } catch (e) {
            console.log('백그라운드 서비스 시작 실패', e);
        }

    } else {
        // === 녹음 중지 ===
        try {
            // 파일 쓰기 타이머 정지 및 잔여 데이터 저장
            await stopFlushTimer();

            // 백그라운드 서비스 중지
            if (BackgroundService.isRunning()) {
                await BackgroundService.stop();
                addLog('백그라운드 서비스 중지됨');
            }
        } catch (e) {
            console.log('백그라운드 서비스 중지 실패', e);
        }
    }
  };

  /**
   * 저장된 파일 공유 (내보내기)
   *
   * expo-sharing을 사용하여 시스템 공유 다이얼로그 표시
   * 이메일, 클라우드 저장소, 메신저 등으로 파일 전송 가능
   */
  const shareFile = async () => {
    try {
      // 파일 존재 확인
      const exists = await RNFS.exists(filePath);
      if (!exists) {
        Alert.alert("알림", "공유할 녹음 파일이 없습니다.");
        return;
      }

      // 공유 기능 사용 가능 여부 확인
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("알림", "공유 기능을 사용할 수 없습니다.");
        return;
      }

      // 파일 공유 다이얼로그 표시
      const fileUri = 'file://' + filePath;
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/octet-stream',  // 바이너리 파일
        dialogTitle: '녹음 데이터 공유',
        UTI: 'public.data',  // iOS용 파일 타입 식별자
      });

    } catch (error) {
      Alert.alert("에러", `파일 공유 실패: ${error.message}`);
    }
  };

  // ===========================================================================
  // UI 렌더링
  // ===========================================================================

  return (
    <View style={styles.container}>
      {/* 앱 제목 */}
      <Text style={styles.title}>Sleep Recorder</Text>

      {/* 상태 표시 영역 */}
      <View style={styles.statusContainer}>
        {/* BLE 연결 상태 */}
        <Text style={styles.statusText}>
          상태: {isConnected ? '연결됨 ✅' : '연결 안 됨 ❌'}
        </Text>

        {/* 수신 패킷 수 */}
        <Text style={{ marginTop: 5 }}>수신 패킷: {packetCount}</Text>

        {/* 녹음 중 표시 */}
        {isRecording && (
          <View style={{alignItems: 'center'}}>
             <Text style={{ color: 'red', fontWeight: 'bold', marginTop: 5, fontSize: 16 }}>
            ● REC (파일 저장 중)
            </Text>
            <Text style={{fontSize: 12, color: '#555'}}>(앱을 내려도 계속 저장됩니다)</Text>
          </View>
        )}
      </View>

      {/* 연결/녹음 버튼 영역 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
        {/* 연결/연결 해제 버튼 */}
        <TouchableOpacity
          style={[styles.button, { flex: 0.48 }, isConnected ? styles.disconnectBtn : styles.connectBtn]}
          onPress={isConnected ? disconnect : scanAndConnect}
        >
          <Text style={styles.btnText}>{isConnected ? '연결 해제' : '장치 연결'}</Text>
        </TouchableOpacity>

        {/* 녹음 시작/중지 버튼 */}
        <TouchableOpacity
          style={[
            styles.button,
            { flex: 0.48, backgroundColor: isConnected ? (isRecording ? '#FF3B30' : '#28A745') : '#ccc' }
          ]}
          onPress={toggleRecording}
          disabled={!isConnected}  // 연결되지 않으면 비활성화
        >
          <Text style={styles.btnText}>{isRecording ? '저장 중지' : '저장 시작'}</Text>
        </TouchableOpacity>
      </View>

      {/* 파일 관리 영역 */}
      <View style={{ marginBottom: 20, alignItems: 'center' }}>
        {/* 파일 경로 표시 */}
        <Text style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>경로: .../Documents/{fileName}</Text>

        {/* 내보내기/삭제 버튼 */}
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <TouchableOpacity onPress={shareFile} style={[styles.actionBtn, { backgroundColor: '#5856D6' }]}>
            <Text style={styles.actionBtnText}>📤 내보내기</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={deleteFile} style={[styles.actionBtn, { backgroundColor: '#FF3B30' }]}>
            <Text style={styles.actionBtnText}>🗑 삭제</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 실시간 로그 영역 */}
      <Text style={styles.logTitle}>실시간 로그:</Text>
      <FlatList
        data={logs}
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item }) => (
          <View style={styles.logItem}>
            <Text style={styles.logTime}>[{item.timestamp}]</Text>
            <Text style={styles.logText}>Data: {item.text}</Text>
          </View>
        )}
        style={styles.logList}
        // FlatList 성능 최적화 옵션들
        removeClippedSubviews={true}   // 화면 밖 아이템 언마운트
        maxToRenderPerBatch={10}       // 배치당 최대 렌더링 아이템 수
        windowSize={5}                  // 렌더링 윈도우 크기
        initialNumToRender={10}        // 초기 렌더링 아이템 수
      />
    </View>
  );
}

// =============================================================================
// 스타일 정의
// =============================================================================

const styles = StyleSheet.create({
  // 메인 컨테이너
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
    paddingTop: 60  // 상단 여백 (노치/상태바 고려)
  },

  // 앱 제목
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center'
  },

  // 상태 표시 컨테이너
  statusContainer: {
    marginBottom: 20,
    alignItems: 'center'
  },

  // 상태 텍스트
  statusText: {
    fontSize: 18
  },

  // 기본 버튼 스타일
  button: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },

  // 연결 버튼 (파란색)
  connectBtn: {
    backgroundColor: '#007AFF'
  },

  // 연결 해제 버튼 (회색)
  disconnectBtn: {
    backgroundColor: '#555'
  },

  // 버튼 텍스트
  btnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  },

  // 액션 버튼 (내보내기, 삭제)
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8
  },

  // 액션 버튼 텍스트
  actionBtnText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14
  },

  // 로그 영역 제목
  logTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10
  },

  // 로그 리스트 컨테이너
  logList: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 10
  },

  // 개별 로그 아이템
  logItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 5
  },

  // 로그 타임스탬프
  logTime: {
    fontSize: 11,
    color: '#999'
  },

  // 로그 텍스트
  logText: {
    fontSize: 13,
    color: '#333'
  },
});
