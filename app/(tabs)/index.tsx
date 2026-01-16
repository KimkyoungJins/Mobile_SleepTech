import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Linking,
  LogBox,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import * as Sharing from 'expo-sharing';
import BackgroundService from 'react-native-background-actions';
import { fromByteArray, toByteArray } from 'base64-js';
import { BleManager } from 'react-native-ble-plx';
import RNFS from 'react-native-fs';

// --- 전역 변수 및 헬퍼 함수 정의 ---
const manager = new BleManager();
const NUS_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_TX_CHARACTERISTIC_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
const DEVICE_NAME_FILTER = 'Nordic_UART_S';

// 지정된 시간 만큼 대기 할 수 있도록 하는 것.
const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

const getTimestamp = () => {
  const now = new Date();
  return now.toLocaleString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const backgroundTask = async (taskDataArguments) => {
    const { delay } = taskDataArguments;
    await new Promise(async (resolve) => {
        for (let i = 0; BackgroundService.isRunning(); i++) {
            console.log(`[${getTimestamp()}] Background service is alive: ${i}`);
            await sleep(delay);
        }
    });
};

// [백그라운드 옵션 설정]
const backgroundOptions = {
    taskName: 'SleepStudyRecorder',
    taskTitle: '수면 데이터 기록 중',
    taskDesc: '백그라운드에서 센서 데이터를 수집하고 있습니다.',
    taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
    },
    color: '#ff00ff',
    linkingURI: 'blereact:///', // 앱의 딥링크 스킴 — 루트 열기 (홈으로 이동)
    parameters: {
        delay: 5000, // 루프 딜레이 1초
    },
};

export default function HomeScreen() {

  const [isConnected, setIsConnected] = useState(false);

  const [device, setDevice] = useState(null);

  const [logs, setLogs] = useState([]);

  const [packetCount, setPacketCount] = useState(0);

  const [isRecording, setIsRecording] = useState(false);

  // useRef를 통해 이벤트 리스너 내부에서도 최신 상태값 참조
  const timeRef = useRef(0);
  const isRecordingRef = useRef(false);
  const isAppActiveRef = useRef(true); // 앱이 포그라운드인지 추적
  const deviceRef = useRef(null); // cleanup에서 device 접근용
  const monitorSubscriptionRef = useRef(null); // BLE 모니터링 subscription
  const packetCountRef = useRef(0); // 패킷 카운트 (UI 업데이트 최적화용)

  // 파일 쓰기 버퍼링 관련
  const writeBufferRef = useRef([]); // 데이터 버퍼
  const flushIntervalRef = useRef(null); // 주기적 flush 타이머
  const fileInitializedRef = useRef(false); // 파일 초기화 여부
  const FLUSH_INTERVAL = 5000; // 5초마다 버퍼 flush

  // BLE 재연결 관련
  const lastDeviceIdRef = useRef(null); // 마지막 연결 디바이스 ID
  const reconnectAttemptRef = useRef(0); // 재연결 시도 횟수
  const MAX_RECONNECT_ATTEMPTS = 10; // 최대 재연결 시도 횟수
  const disconnectionListenerRef = useRef(null); // 연결 끊김 리스너

  // 파일네임 하드코딩
  const fileName = 'data.raw';

  // 파일의 경로는 자동으로 정해지도록
  const filePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

  // 녹음 상태가 변할 때 ref 업데이트
  // 리코딩에 관한 상태가 변경될 때마다 특정 작업을 수행할 수 있도록한다.
  useEffect(() => {
    isRecordingRef.current = isRecording;
    console.log(`녹음 상태 변경: ${isRecording}`);
  }, [isRecording]);

  // device 상태가 변할 때 ref 업데이트 (cleanup에서 사용)
  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  // AppState 리스너: 백그라운드/포그라운드 상태 추적
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      isAppActiveRef.current = nextAppState === 'active';
      console.log(`앱 상태 변경: ${nextAppState}`);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // 배터리 최적화 제외 요청 (삼성폰 필수)
  const requestBatteryOptimizationExclusion = async () => {
    if (Platform.OS !== 'android') return;

    try {
      // 배터리 최적화 설정 화면으로 이동하도록 안내
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
              // 앱의 배터리 설정 화면으로 이동
              Linking.openSettings();
            }
          }
        ]
      );
    } catch (err) {
      console.log('배터리 최적화 설정 에러:', err);
    }
  };

  useEffect(() => {
    LogBox.ignoreLogs(['new NativeEventEmitter']);

    const requestPermissions = async () => {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          // 안드로이드 13 이상에서 알림 권한 필요 (백그라운드 서비스 알림용)
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ]);

        // 첫 실행 시 배터리 최적화 제외 안내
        requestBatteryOptimizationExclusion();
      }
    };
    requestPermissions();

    // 컴포넌트 언마운트 시 리소스 정리
    return () => {
      // 파일 쓰기 타이머 정지
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = null;
      }
      // 남은 버퍼 flush 시도
      flushBuffer();

      // BLE 스캔 중지
      manager.stopDeviceScan();

      // BLE 연결 끊김 리스너 제거
      if (disconnectionListenerRef.current) {
        disconnectionListenerRef.current.remove();
        disconnectionListenerRef.current = null;
      }

      // BLE 모니터링 subscription 제거
      if (monitorSubscriptionRef.current) {
        monitorSubscriptionRef.current.remove();
        monitorSubscriptionRef.current = null;
      }

      // 연결된 디바이스가 있으면 연결 해제
      if (deviceRef.current) {
        deviceRef.current.cancelConnection()
          .catch((err) => console.log('연결 해제 에러:', err.message));
      }

      // 백그라운드 서비스 정지
      BackgroundService.stop();

      // BLE 매니저 리소스 정리
      manager.destroy();
    };
  }, []);

  const addLog = (msg) => {
    const logEntry = {
      text: msg,
      timestamp: new Date().toLocaleTimeString()
    };
    setLogs((prev) => [logEntry, ...prev].slice(0, 50));
  };

  const scanAndConnect = () => {
    addLog('스캔 시작...');
    manager.startDeviceScan(null, null, (error, scannedDevice) => {

      if (error) {
        addLog(`스캔 에러: ${error.message}`);
        return;
      }

      if (scannedDevice.name && scannedDevice.name.includes(DEVICE_NAME_FILTER)) {
        manager.stopDeviceScan();
        addLog(`타겟 발견: ${scannedDevice.name}`);
        connectToDevice(scannedDevice);
      }

    });
  };

  const decodeBase64 = (base64String) => {
    try {
      return atob(base64String);
    } catch (e) {
      return "";
    }
  };

  // 버퍼에 데이터 추가 (매 패킷마다 호출)
  const appendData = (data) => {
    if (!data) return;
    writeBufferRef.current.push(data);
  };

  // 버퍼를 파일에 flush (주기적으로 호출)
  const flushBuffer = async () => {
    if (writeBufferRef.current.length === 0) return;

    // 버퍼 복사 후 초기화 (새 데이터가 들어올 수 있으므로)
    const chunksToWrite = [...writeBufferRef.current];
    writeBufferRef.current = [];

    try {
      // 모든 base64 청크를 바이너리로 디코딩하여 합치기
      const byteArrays = chunksToWrite
        .filter(chunk => chunk) // null/undefined 필터
        .map(chunk => {
          try {
            return toByteArray(chunk);
          } catch (e) {
            console.log(`[${getTimestamp()}] base64 디코딩 에러`);
            return null;
          }
        })
        .filter(arr => arr !== null);

      if (byteArrays.length === 0) return;

      // 총 바이트 수 계산
      const totalLength = byteArrays.reduce((sum, arr) => sum + arr.length, 0);

      // 하나의 Uint8Array로 합치기
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const arr of byteArrays) {
        combinedArray.set(arr, offset);
        offset += arr.length;
      }

      // 다시 base64로 인코딩
      const combinedBase64 = fromByteArray(combinedArray);

      // 한 번의 파일 쓰기로 저장
      if (!fileInitializedRef.current) {
        const exists = await RNFS.exists(filePath);
        if (exists) {
          await RNFS.appendFile(filePath, combinedBase64, 'base64');
        } else {
          await RNFS.writeFile(filePath, combinedBase64, 'base64');
        }
        fileInitializedRef.current = true;
      } else {
        await RNFS.appendFile(filePath, combinedBase64, 'base64');
      }

      console.log(`[${getTimestamp()}] ${chunksToWrite.length}개 청크 저장 완료 (${totalLength} bytes)`);

    } catch (err) {
      console.log(`[${getTimestamp()}] 파일 쓰기 에러:`, err.message);
      // 실패한 데이터 다시 버퍼에 추가 (데이터 손실 방지)
      writeBufferRef.current = [...chunksToWrite, ...writeBufferRef.current];
    }
  };

  // flush 타이머 시작
  const startFlushTimer = () => {
    if (flushIntervalRef.current) return;
    flushIntervalRef.current = setInterval(() => {
      flushBuffer();
    }, FLUSH_INTERVAL);
    console.log(`[${getTimestamp()}] 파일 쓰기 타이머 시작 (${FLUSH_INTERVAL}ms 간격)`);
  };

  // flush 타이머 정지 및 남은 버퍼 저장
  const stopFlushTimer = async () => {
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    // 남은 버퍼 flush
    await flushBuffer();
    console.log(`[${getTimestamp()}] 파일 쓰기 타이머 정지, 버퍼 flush 완료`);
  };

  // BLE 자동 재연결 함수
  const attemptReconnect = async () => {
    if (!lastDeviceIdRef.current || !isRecordingRef.current) {
      console.log(`[${getTimestamp()}] 재연결 조건 미충족 (녹음중: ${isRecordingRef.current})`);
      return;
    }

    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[${getTimestamp()}] 최대 재연결 시도 횟수 초과`);
      addLog('재연결 실패: 최대 시도 횟수 초과');
      return;
    }

    reconnectAttemptRef.current += 1;
    console.log(`[${getTimestamp()}] 재연결 시도 ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS}`);

    try {
      // 이전 디바이스 ID로 재연결 시도
      const devices = await manager.devices([lastDeviceIdRef.current]);
      if (devices.length > 0) {
        await connectToDevice(devices[0]);
        reconnectAttemptRef.current = 0; // 성공 시 카운터 리셋
        console.log(`[${getTimestamp()}] 재연결 성공`);
      } else {
        // 디바이스를 찾을 수 없으면 스캔 시작
        console.log(`[${getTimestamp()}] 디바이스 재스캔 시작`);
        scanAndConnect();
      }
    } catch (err) {
      console.log(`[${getTimestamp()}] 재연결 실패:`, err.message);
      // 5초 후 재시도
      setTimeout(() => attemptReconnect(), 5000);
    }
  };

  // 연결 끊김 리스너 설정
  const setupDisconnectionListener = (connectedDevice) => {
    // 기존 리스너 제거
    if (disconnectionListenerRef.current) {
      disconnectionListenerRef.current.remove();
    }

    // 연결 끊김 감지
    disconnectionListenerRef.current = manager.onDeviceDisconnected(
      connectedDevice.id,
      (error, device) => {
        console.log(`[${getTimestamp()}] BLE 연결 끊김 감지`);
        setIsConnected(false);
        setDevice(null);

        // 녹음 중이었다면 자동 재연결 시도
        if (isRecordingRef.current) {
          addLog('연결 끊김 - 재연결 시도 중...');
          setTimeout(() => attemptReconnect(), 2000);
        } else {
          addLog('연결이 끊어졌습니다');
        }
      }
    );
  };

  const connectToDevice = async (deviceToConnect) => {

    try {
      const connectedDevice = await deviceToConnect.connect();
      await connectedDevice.discoverAllServicesAndCharacteristics();

      // 재연결용 디바이스 ID 저장
      lastDeviceIdRef.current = connectedDevice.id;

      setDevice(connectedDevice);
      setIsConnected(true);
      addLog('연결 성공! 수신 대기 중...');

      if (Platform.OS === 'android') {
        await connectedDevice.requestMTU(247);
        addLog('MTU 요청 완료');
      }

      // 연결 끊김 리스너 설정
      setupDisconnectionListener(connectedDevice);

      // BLE 데이터 모니터링 (백그라운드 서비스가 켜져 있으면, 앱이 내려가도 이 콜백은 계속 실행됨)
      monitorSubscriptionRef.current = connectedDevice.monitorCharacteristicForService(
        NUS_SERVICE_UUID,
        NUS_TX_CHARACTERISTIC_UUID,
        async (error, characteristic) => {
          if (error) {
            console.log(`모니터링 에러: ${error.message}`);
            // 연결이 끊겼거나 에러 발생 시 처리 로직 추가 가능
            return;
          }
          if (characteristic?.value) {
            // [중요] 녹음 중이라면 파일에 저장
            // 백그라운드에서도 isRecordingRef.current가 true라면 파일 쓰기가 동작함
            if (isRecordingRef.current) {
              await appendData(characteristic.value);
            }

            // 패킷 카운트는 ref로 즉시 증가 (리렌더링 없음)
            packetCountRef.current += 1;

            // 앱이 백그라운드일 때는 UI 업데이트 건너뛰기
            if (!isAppActiveRef.current) {
              return;
            }

            // UI 업데이트 (10초마다 한 번만)
            const now = Date.now();
            if (now - timeRef.current > 10000) {
              // 패킷 카운트 UI 동기화
              setPacketCount(packetCountRef.current);

              // 로그 추가
              const converted = decodeBase64(characteristic.value);
              const logEntry = {
                text: converted,
                timestamp: new Date().toLocaleTimeString()
              };
              setLogs((prev) => [logEntry, ...prev].slice(0, 50));
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

  const disconnect = async () => {
    // 파일 쓰기 타이머 정지 및 버퍼 flush
    await stopFlushTimer();

    // 연결 해제 시 백그라운드 서비스도 종료
    if (BackgroundService.isRunning()) {
        await BackgroundService.stop();
    }

    // BLE 연결 끊김 리스너 제거 (수동 해제 시 자동 재연결 방지)
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

    if (device) {
      await device.cancelConnection();
      setDevice(null);
      setIsConnected(false);
      setIsRecording(false);
      addLog('연결 해제됨');
    }
  };

  const deleteFile = async () => {
    try {
      const exists = await RNFS.exists(filePath);
      if (exists) {
        await RNFS.unlink(filePath);
        addLog('파일 삭제 완료');
        Alert.alert("알림", "저장된 데이터 파일이 삭제되었습니다.");
        packetCountRef.current = 0;
        setPacketCount(0);
        fileInitializedRef.current = false; // 파일 삭제 후 초기화 상태 리셋
        writeBufferRef.current = []; // 버퍼도 비우기
      } else {
        Alert.alert("알림", "삭제할 파일이 없습니다.");
      }
    } catch (e) {
      addLog(`삭제 실패: ${e.message}`);
    }
  };

  // [수정됨] 녹음 버튼 핸들러 + 백그라운드 서비스 제어
  const toggleRecording = async () => {

    if (!isConnected) {
      Alert.alert("오류", "먼저 장치를 연결해주세요.");
      return;
    }

    const nextState = !isRecording;

    setIsRecording(nextState); // 상태 업데이트

    if (nextState) {
        // 녹음 시작 -> 백그라운드 서비스 시작 + 파일 쓰기 타이머 시작
        try {
            if (!BackgroundService.isRunning()) {
                await BackgroundService.start(backgroundTask, backgroundOptions);
                await BackgroundService.updateNotification({taskDesc: '수면 데이터 기록 중...'});
                addLog('백그라운드 서비스 시작됨');
            }
            startFlushTimer();
        } catch (e) {
            console.log('백그라운드 서비스 시작 실패', e);
        }

    } else {
        // 녹음 중지 -> 파일 쓰기 타이머 정지 + 백그라운드 서비스 중지
        try {
            await stopFlushTimer(); // 남은 버퍼 저장
            if (BackgroundService.isRunning()) {
                await BackgroundService.stop();
                addLog('백그라운드 서비스 중지됨');
            }
        } catch (e) {
            console.log('백그라운드 서비스 중지 실패', e);
        }
    }
  };

  const shareFile = async () => {
    try {
      const exists = await RNFS.exists(filePath);
      if (!exists) {
        Alert.alert("알림", "공유할 녹음 파일이 없습니다.");
        return;
      }

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("알림", "공유 기능을 사용할 수 없습니다.");
        return;
      }

      const fileUri = 'file://' + filePath;
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/octet-stream',
        dialogTitle: '녹음 데이터 공유',
        UTI: 'public.data',
      });

    } catch (error) {
      Alert.alert("에러", `파일 공유 실패: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sleep Recorder</Text>

      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          상태: {isConnected ? '연결됨 ✅' : '연결 안 됨 ❌'}
        </Text>
        <Text style={{ marginTop: 5 }}>수신 패킷: {packetCount}</Text>
        {isRecording && (
          <View style={{alignItems: 'center'}}>
             <Text style={{ color: 'red', fontWeight: 'bold', marginTop: 5, fontSize: 16 }}>
            ● REC (파일 저장 중)
            </Text>
            <Text style={{fontSize: 12, color: '#555'}}>(앱을 내려도 계속 저장됩니다)</Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
        <TouchableOpacity
          style={[styles.button, { flex: 0.48 }, isConnected ? styles.disconnectBtn : styles.connectBtn]}
          onPress={isConnected ? disconnect : scanAndConnect}
        >
          <Text style={styles.btnText}>{isConnected ? '연결 해제' : '장치 연결'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            { flex: 0.48, backgroundColor: isConnected ? (isRecording ? '#FF3B30' : '#28A745') : '#ccc' }
          ]}
          onPress={toggleRecording}
          disabled={!isConnected}
        >
          <Text style={styles.btnText}>{isRecording ? '저장 중지' : '저장 시작'}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginBottom: 20, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>경로: .../Documents/{fileName}</Text>

        <View style={{ flexDirection: 'row', gap: 20 }}>
          <TouchableOpacity onPress={shareFile} style={[styles.actionBtn, { backgroundColor: '#5856D6' }]}>
            <Text style={styles.actionBtnText}>📤 내보내기</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={deleteFile} style={[styles.actionBtn, { backgroundColor: '#FF3B30' }]}>
            <Text style={styles.actionBtnText}>🗑 삭제</Text>
          </TouchableOpacity>
        </View>
      </View>

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
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f5f5f5', paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  statusContainer: { marginBottom: 20, alignItems: 'center' },
  statusText: { fontSize: 18 },
  button: { padding: 15, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  connectBtn: { backgroundColor: '#007AFF' },
  disconnectBtn: { backgroundColor: '#555' },
  btnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 8 },
  actionBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  logTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  logList: { flex: 1, backgroundColor: 'white', borderRadius: 10, padding: 10 },
  logItem: { borderBottomWidth: 1, borderBottomColor: '#eee', paddingVertical: 5 },
  logTime: { fontSize: 11, color: '#999' },
  logText: { fontSize: 13, color: '#333' },
});