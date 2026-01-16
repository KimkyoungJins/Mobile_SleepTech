import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
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
import { BleManager } from 'react-native-ble-plx';
import RNFS from 'react-native-fs';

// --- 전역 변수 및 헬퍼 함수 정의 ---
const manager = new BleManager();
const NUS_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_TX_CHARACTERISTIC_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
const DEVICE_NAME_FILTER = 'Nordic_UART_S';

// 지정된 시간 만큼 대기 할 수 있도록 하는 것.
const sleep = (time) => new Promise((resolve) => setTimeout(() => resolve(), time));

const backgroundTask = async (taskDataArguments) => {
    const { delay } = taskDataArguments;
    await new Promise(async (resolve) => {      
        for (let i = 0; BackgroundService.isRunning(); i++) {                    
            console.log("Background service is alive:", i);
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
      }
    };
    requestPermissions();

    // 컴포넌트 언마운트 시 리소스 정리
    return () => {
      // BLE 스캔 중지
      manager.stopDeviceScan();

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
      hex: '',
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

  const convertToHex = (msg) => {
    return msg
      .split('')
      .map(char => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
  };

  const appendData = async (data) => {
    if (!data) return;
    try {
      const exists = await RNFS.exists(filePath);
      if (exists) {
        await RNFS.appendFile(filePath, data, 'base64');
      } else {
        await RNFS.writeFile(filePath, data, 'base64');
      }
    } catch (err) {
      console.log('파일 쓰기 에러:', err.message);
    }
  };

  const connectToDevice = async (deviceToConnect) => {

    try {
      const connectedDevice = await deviceToConnect.connect();
      await connectedDevice.discoverAllServicesAndCharacteristics();

      setDevice(connectedDevice);
      setIsConnected(true);
      addLog('연결 성공! 수신 대기 중...');

      if (Platform.OS === 'android') {
        await connectedDevice.requestMTU(247);
        addLog('MTU 요청 완료');
      }

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

            // 앱이 백그라운드일 때는 UI 업데이트 건너뛰기
            if (!isAppActiveRef.current) {
              return;
            }

            setPacketCount((prev) => prev + 1);

            // UI 업데이트용 로그 (너무 자주 업데이트하면 성능 저하되므로 10초 제한)
            const now = Date.now();
            if (now - timeRef.current > 10000) {
              const converted = decodeBase64(characteristic.value);
              const finalHex = convertToHex(converted);
              const logEntry = {
                text: converted,
                hex: finalHex,
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
    // 연결 해제 시 백그라운드 서비스도 종료
    if (BackgroundService.isRunning()) {
        await BackgroundService.stop();
    }

    // BLE 모니터링 subscription 제거
    if (monitorSubscriptionRef.current) {
      monitorSubscriptionRef.current.remove();
      monitorSubscriptionRef.current = null;
    }

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
        setPacketCount(0);
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
        // 녹음 시작 -> 백그라운드 서비스 시작
        try {
            if (!BackgroundService.isRunning()) {
                await BackgroundService.start(backgroundTask, backgroundOptions);
                await BackgroundService.updateNotification({taskDesc: 'New ExampleTask description'}); // Only Android, iOS will ignore this call
                addLog('백그라운드 서비스 시작됨');
            }
        } catch (e) {
            console.log('백그라운드 서비스 시작 실패', e);
        }

    } else {
        // 녹음 중지 -> 백그라운드 서비스 중지
        try {
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