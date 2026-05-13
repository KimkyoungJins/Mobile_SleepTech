/**
 * BLE 연결 및 데이터 수신 관리 훅
 *
 * BLE 디바이스 스캔, 연결, 데이터 모니터링, 재연결 로직을 담당
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, PermissionsAndroid, Linking, LogBox } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import BackgroundService from 'react-native-background-actions';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  NUS_SERVICE_UUID,
  NUS_TX_CHARACTERISTIC_UUID,
  DEVICE_NAME_FILTER,
  ANDROID_MTU_SIZE,
  RECONNECT_TIMEOUT_MS,
} from '../constants/ble';
import RNFS from 'react-native-fs';
import {
  globalIsRecording,
  setGlobalIsRecording,
  globalAppendData,
  globalFlushBuffer,
  resetFileStorage,
  setSessionId,
  getSessionId,
  resetSessionId,
  resetUploadState,
  getFilePath,
  setFileName,
} from '../services/fileStorage';
import { generateSessionId, uploadChunk, finishSession } from '../services/uploadService';
import { startBackgroundService, stopBackgroundService } from '../services/backgroundService';
import { decodeBase64 } from '../utils/helpers';

/**
 * BLE 매니저 인스턴스 (싱글톤)
 */
const manager = new BleManager();

/**
 * 로그 항목 타입
 */
export interface LogEntry {
  text: string;
  timestamp: string;
}

/**
 * useBLE 훅 반환 타입
 */
export interface UseBLEReturn {
  isConnected: boolean;
  device: Device | null;
  logs: LogEntry[];
  packetCount: number;
  isRecording: boolean;
  lastSessionId: string | null;
  scanAndConnect: () => void;
  disconnect: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  addLog: (msg: string) => void;
}

/**
 * BLE 연결 및 데이터 수신 관리 훅
 */
export const useBLE = (): UseBLEReturn => {
  // UI 상태
  const [isConnected, setIsConnected] = useState(false);
  const [device, setDevice] = useState<Device | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [packetCount, setPacketCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  // Refs
  const timeRef = useRef(0);
  const isAppActiveRef = useRef(true);
  const deviceRef = useRef<Device | null>(null);
  const monitorSubscriptionRef = useRef<Subscription | null>(null);
  const packetCountRef = useRef(0);
  const lastDeviceIdRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectStartTimeRef = useRef<number>(0);
  const disconnectionListenerRef = useRef<Subscription | null>(null);

  /**
   * UI 로그 리스트에 메시지 추가
   */
  const addLog = (msg: string) => {
    const logEntry: LogEntry = {
      text: msg,
      timestamp: new Date().toLocaleTimeString(),
    };
    setLogs((prev) => [logEntry, ...prev].slice(0, 50));
  };

  /**
   * isRecording 상태 변경 시 전역 상태 동기화
   */
  useEffect(() => {
    setGlobalIsRecording(isRecording);
    console.log(`녹음 상태 변경: ${isRecording}`);
  }, [isRecording]);

  /**
   * device 상태 변경 시 ref 동기화
   */
  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  /**
   * AppState 리스너 설정
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      isAppActiveRef.current = nextAppState === 'active';
      console.log(`앱 상태 변경: ${nextAppState}`);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  /**
   * 배터리 최적화 제외 요청
   */
  const requestBatteryOptimizationExclusion = async () => {
    if (Platform.OS !== 'android') return;

    try {
      Alert.alert(
        '배터리 최적화 제외 필요',
        '앱이 백그라운드에서 8시간 이상 안정적으로 동작하려면 배터리 최적화에서 제외해야 합니다.\n\n' +
          '설정 > 앱 > 이 앱 > 배터리 > \'제한 없음\' 선택\n\n' +
          '또는 설정 > 배터리 > 백그라운드 사용 제한 > 이 앱 제외',
        [
          { text: '나중에', style: 'cancel' },
          {
            text: '설정으로 이동',
            onPress: () => {
              Linking.openSettings();
            },
          },
        ]
      );
    } catch (err) {
      console.log('배터리 최적화 설정 에러:', err);
    }
  };

  /**
   * 초기화 및 정리
   */
  useEffect(() => {
    LogBox.ignoreLogs(['new NativeEventEmitter']);

    const requestPermissions = async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ]);

        requestBatteryOptimizationExclusion();
      }
    };
    requestPermissions();

    return () => {
      setGlobalIsRecording(false);
      globalFlushBuffer();

      manager.stopDeviceScan();

      if (disconnectionListenerRef.current) {
        disconnectionListenerRef.current.remove();
        disconnectionListenerRef.current = null;
      }

      if (monitorSubscriptionRef.current) {
        monitorSubscriptionRef.current.remove();
        monitorSubscriptionRef.current = null;
      }

      if (deviceRef.current) {
        deviceRef.current
          .cancelConnection()
          .catch((err: any) => console.log('연결 해제 에러:', err.message));
      }

      BackgroundService.stop();
    };
  }, []);

  /**
   * 재연결 실패 등 비정상 상황에서 녹음을 강제로 종료
   * (toggleRecording의 정상 중지 경로와 동일하지만, isRecording=true를 가정하지 않고 단방향 정리만 수행)
   */
  const stopRecordingForcefully = async (reason: string) => {
    try {
      await globalFlushBuffer();
      const uploaded = await uploadChunk();
      if (uploaded) addLog('마지막 데이터 업로드 완료');

      const currentSessionId = getSessionId();
      const finished = await finishSession();
      if (finished) addLog('서버 WAV 변환 완료');

      await stopBackgroundService();
      deactivateKeepAwake('recording');

      if (currentSessionId) setLastSessionId(currentSessionId);
      resetSessionId();

      setIsRecording(false);
      setGlobalIsRecording(false);
      addLog(`세션 종료 (${reason})`);
    } catch (e: any) {
      console.log('강제 종료 에러:', e?.message ?? e);
    }
  };

  /**
   * BLE 재연결 시도
   */
  const attemptReconnect = async () => {
    if (!lastDeviceIdRef.current || !globalIsRecording) {
      console.log(`재연결 조건 미충족 (녹음중: ${globalIsRecording})`);
      return;
    }

    const elapsed = Date.now() - reconnectStartTimeRef.current;
    if (elapsed > RECONNECT_TIMEOUT_MS) {
      console.log(`재연결 타임아웃 (${Math.round(elapsed / 60000)}분 경과)`);
      addLog('재연결 실패: 타임아웃');

      // 앱이 foreground이면 사용자에게 선택권을 주고, background이면 데이터 보호를 위해 자동 종료
      if (isAppActiveRef.current) {
        const elapsedMin = Math.round(RECONNECT_TIMEOUT_MS / 60000);
        Alert.alert(
          '장치 연결 끊김',
          `${elapsedMin}분 동안 재연결을 시도했지만 실패했습니다.\n\n` +
            '장치 전원과 가까운 거리를 확인하세요.',
          [
            {
              text: '녹음 중지',
              style: 'destructive',
              onPress: () => {
                stopRecordingForcefully('재연결 실패');
              },
            },
            {
              text: '재연결',
              onPress: () => {
                addLog('재연결 재시도 요청');
                reconnectStartTimeRef.current = Date.now();
                reconnectAttemptRef.current = 0;
                attemptReconnect();
              },
            },
          ],
          { cancelable: false }
        );
      } else {
        addLog('백그라운드 자동 종료');
        stopRecordingForcefully('백그라운드 자동 종료');
      }
      return;
    }

    reconnectAttemptRef.current += 1;
    const backoff = Math.min(5000 * reconnectAttemptRef.current, 30000);
    console.log(`재연결 시도 #${reconnectAttemptRef.current} (${Math.round(elapsed / 1000)}초 경과)`);

    try {
      const devices = await manager.devices([lastDeviceIdRef.current]);

      if (devices.length > 0) {
        await connectToDevice(devices[0]);
        reconnectAttemptRef.current = 0;
        reconnectStartTimeRef.current = 0;
        console.log('재연결 성공');
      } else {
        console.log('디바이스 재스캔 시작');
        scanAndConnect();
      }
    } catch (err: any) {
      console.log('재연결 실패:', err.message);
      setTimeout(() => attemptReconnect(), backoff);
    }
  };

  /**
   * BLE 연결 끊김 리스너 설정
   */
  const setupDisconnectionListener = (connectedDevice: Device) => {
    if (disconnectionListenerRef.current) {
      disconnectionListenerRef.current.remove();
    }

    disconnectionListenerRef.current = manager.onDeviceDisconnected(
      connectedDevice.id,
      (error, device) => {
        console.log('BLE 연결 끊김 감지');

        setIsConnected(false);
        setDevice(null);

        if (globalIsRecording) {
          addLog('연결 끊김 - 재연결 시도 중...');
          reconnectStartTimeRef.current = Date.now();
          reconnectAttemptRef.current = 0;
          setTimeout(() => attemptReconnect(), 2000);
        } else {
          addLog('연결이 끊어졌습니다');
        }
      }
    );
  };

  /**
   * BLE 디바이스에 연결하고 데이터 수신 시작
   */
  const connectToDevice = async (deviceToConnect: Device) => {
    try {
      const connectedDevice = await deviceToConnect.connect();
      await connectedDevice.discoverAllServicesAndCharacteristics();

      lastDeviceIdRef.current = connectedDevice.id;

      setDevice(connectedDevice);
      setIsConnected(true);
      addLog('연결 성공! 수신 대기 중...');

      if (Platform.OS === 'android') {
        await connectedDevice.requestMTU(ANDROID_MTU_SIZE);
        addLog('MTU 요청 완료');
      }

      setupDisconnectionListener(connectedDevice);

      monitorSubscriptionRef.current = connectedDevice.monitorCharacteristicForService(
        NUS_SERVICE_UUID,
        NUS_TX_CHARACTERISTIC_UUID,
        async (error, characteristic) => {
          if (error) {
            console.log(`모니터링 에러: ${error.message}`);
            return;
          }

          if (characteristic?.value) {
            if (globalIsRecording) {
              globalAppendData(characteristic.value);
            }

            packetCountRef.current += 1;

            if (!isAppActiveRef.current) {
              return;
            }

            const now = Date.now();
            if (now - timeRef.current > 10000) {
              setPacketCount(packetCountRef.current);

              const converted = decodeBase64(characteristic.value);
              const logEntry: LogEntry = {
                text: converted,
                timestamp: new Date().toLocaleTimeString(),
              };
              setLogs((prev) => [logEntry, ...prev].slice(0, 50));

              timeRef.current = now;
            }
          }
        }
      );
    } catch (error: any) {
      addLog(`연결 실패: ${error.message}`);
      setIsConnected(false);
    }
  };

  /**
   * BLE 디바이스 스캔 및 자동 연결
   */
  const scanAndConnect = () => {
    addLog('스캔 시작...');

    manager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) {
        addLog(`스캔 에러: ${error.message}`);
        return;
      }

      if (scannedDevice?.name && scannedDevice.name.includes(DEVICE_NAME_FILTER)) {
        manager.stopDeviceScan();
        addLog(`타겟 발견: ${scannedDevice.name}`);
        connectToDevice(scannedDevice);
      }
    });
  };

  /**
   * BLE 연결 수동 해제
   */
  const disconnect = async () => {
    setGlobalIsRecording(false);
    await globalFlushBuffer();

    await stopBackgroundService();

    if (disconnectionListenerRef.current) {
      disconnectionListenerRef.current.remove();
      disconnectionListenerRef.current = null;
    }

    if (monitorSubscriptionRef.current) {
      monitorSubscriptionRef.current.remove();
      monitorSubscriptionRef.current = null;
    }

    lastDeviceIdRef.current = null;
    reconnectAttemptRef.current = 0;

    if (device) {
      await device.cancelConnection();
      setDevice(null);
      setIsConnected(false);
      setIsRecording(false);
      addLog('연결 해제됨');
    }
  };

  /**
   * 녹음 시작/중지 토글
   */
  const toggleRecording = async () => {
    if (!isConnected) {
      Alert.alert('오류', '먼저 장치를 연결해주세요.');
      return;
    }

    const nextState = !isRecording;

    setIsRecording(nextState);
    setGlobalIsRecording(nextState);

    if (nextState) {
      // 녹음 시작
      try {
        // 세션 ID 생성 및 파일명 설정
        const newSessionId = generateSessionId();
        setSessionId(newSessionId);
        setFileName(newSessionId);  // 파일명: {세션ID}.raw
        // lastSessionId도 즉시 갱신 — 분석 탭에서 실시간 partial 결과 폴링용
        setLastSessionId(newSessionId);
        resetUploadState();
        resetFileStorage();

        await activateKeepAwakeAsync('recording');

        console.log(`[세션 시작] session_id: ${newSessionId}, 파일: ${newSessionId}.raw`);
        addLog(`세션 시작: ${newSessionId}`);

        const started = await startBackgroundService();
        if (started) {
          addLog('백그라운드 서비스 시작됨');
        }
        addLog('녹음 시작 (30초마다 서버 업로드)');
      } catch (e) {
        console.log('백그라운드 서비스 시작 실패', e);
        setGlobalIsRecording(false);
        setIsRecording(false);
        resetSessionId();
      }
    } else {
      // 녹음 중지
      try {
        // 남은 버퍼 데이터 저장
        await globalFlushBuffer();
        addLog('버퍼 데이터 저장 완료');

        // 남은 데이터 서버 업로드
        const uploaded = await uploadChunk();
        if (uploaded) {
          addLog('마지막 데이터 업로드 완료');
        }

        // 서버에 WAV 변환 요청
        const currentSessionId = getSessionId();
        const finished = await finishSession();
        if (finished) {
          addLog('서버 WAV 변환 완료');
        } else {
          addLog('서버 WAV 변환 실패');
        }

        const stopped = await stopBackgroundService();
        if (stopped) {
          addLog('백그라운드 서비스 중지됨');
        }

        deactivateKeepAwake('recording');

        // 세션 ID 보존 (수면 분석 결과 조회용) 후 정리
        if (currentSessionId) {
          setLastSessionId(currentSessionId);
        }
        resetSessionId();
        addLog('세션 종료');
      } catch (e) {
        console.log('백그라운드 서비스 중지 실패', e);
      }
    }
  };

  return {
    isConnected,
    device,
    logs,
    packetCount,
    isRecording,
    lastSessionId,
    scanAndConnect,
    disconnect,
    toggleRecording,
    addLog,
  };
};
