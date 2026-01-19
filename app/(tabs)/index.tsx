/**
 * =============================================================================
 * Sleep Recorder - 수면 데이터 기록 앱 (메인 화면)
 * =============================================================================
 *
 * BLE 연결, 데이터 수신, 파일 저장 기능의 UI를 담당합니다.
 *
 * 모듈 구조:
 * - hooks/useBLE.ts: BLE 연결 및 데이터 수신 로직
 * - services/fileStorage.ts: 파일 저장 시스템
 * - services/backgroundService.ts: 백그라운드 서비스 설정
 * - constants/ble.ts: BLE 관련 상수
 * - utils/helpers.ts: 유틸리티 함수
 * =============================================================================
 */

import React from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import RNFS from 'react-native-fs';

import { useBLE, LogEntry } from '../../hooks/useBLE';
import { FILE_PATH, resetFileStorage } from '../../services/fileStorage';

/**
 * HomeScreen - 앱의 메인 화면 컴포넌트
 */
export default function HomeScreen() {
  // BLE 훅에서 모든 상태와 함수 가져오기
  const {
    isConnected,
    logs,
    packetCount,
    isRecording,
    scanAndConnect,
    disconnect,
    toggleRecording,
    addLog,
  } = useBLE();

  /**
   * 저장된 데이터 파일 삭제
   */
  const deleteFile = async () => {
    try {
      const exists = await RNFS.exists(FILE_PATH);
      if (exists) {
        await RNFS.unlink(FILE_PATH);
        addLog('파일 삭제 완료');
        Alert.alert('알림', '저장된 데이터 파일이 삭제되었습니다.');
        resetFileStorage();
      } else {
        Alert.alert('알림', '삭제할 파일이 없습니다.');
      }
    } catch (e: any) {
      addLog(`삭제 실패: ${e.message}`);
    }
  };

  /**
   * 저장된 파일 공유 (내보내기)
   */
  const shareFile = async () => {
    try {
      const exists = await RNFS.exists(FILE_PATH);
      if (!exists) {
        Alert.alert('알림', '공유할 녹음 파일이 없습니다.');
        return;
      }

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('알림', '공유 기능을 사용할 수 없습니다.');
        return;
      }

      const fileUri = 'file://' + FILE_PATH;
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/octet-stream',
        dialogTitle: '녹음 데이터 공유',
        UTI: 'public.data',
      });
    } catch (error: any) {
      Alert.alert('에러', `파일 공유 실패: ${error.message}`);
    }
  };

  /**
   * 로그 아이템 렌더링
   */
  const renderLogItem = ({ item }: { item: LogEntry }) => (
    <View style={styles.logItem}>
      <Text style={styles.logTime}>[{item.timestamp}]</Text>
      <Text style={styles.logText}>Data: {item.text}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* 앱 제목 */}
      <Text style={styles.title}>Sleep Recorder</Text>

      {/* 상태 표시 영역 */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          상태: {isConnected ? '연결됨 ✅' : '연결 안 됨 ❌'}
        </Text>
        <Text style={{ marginTop: 5 }}>수신 패킷: {packetCount}</Text>
        {isRecording && (
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.recordingText}>● REC (파일 저장 중)</Text>
            <Text style={styles.recordingSubText}>
              (앱을 내려도 계속 저장됩니다)
            </Text>
          </View>
        )}
      </View>

      {/* 연결/녹음 버튼 영역 */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[
            styles.button,
            styles.buttonHalf,
            isConnected ? styles.disconnectBtn : styles.connectBtn,
          ]}
          onPress={isConnected ? disconnect : scanAndConnect}
        >
          <Text style={styles.btnText}>
            {isConnected ? '연결 해제' : '장치 연결'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.buttonHalf,
            {
              backgroundColor: isConnected
                ? isRecording
                  ? '#FF3B30'
                  : '#28A745'
                : '#ccc',
            },
          ]}
          onPress={toggleRecording}
          disabled={!isConnected}
        >
          <Text style={styles.btnText}>
            {isRecording ? '저장 중지' : '저장 시작'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 파일 관리 영역 */}
      <View style={styles.fileSection}>
        <Text style={styles.filePath}>경로: .../Documents/data.raw</Text>
        <View style={styles.actionButtonRow}>
          <TouchableOpacity
            onPress={shareFile}
            style={[styles.actionBtn, { backgroundColor: '#5856D6' }]}
          >
            <Text style={styles.actionBtnText}>📤 내보내기</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={deleteFile}
            style={[styles.actionBtn, { backgroundColor: '#FF3B30' }]}
          >
            <Text style={styles.actionBtnText}>🗑 삭제</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 실시간 로그 영역 */}
      <Text style={styles.logTitle}>실시간 로그:</Text>
      <FlatList
        data={logs}
        keyExtractor={(item, index) => index.toString()}
        renderItem={renderLogItem}
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
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  statusContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 18,
  },
  recordingText: {
    color: 'red',
    fontWeight: 'bold',
    marginTop: 5,
    fontSize: 16,
  },
  recordingSubText: {
    fontSize: 12,
    color: '#555',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  button: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonHalf: {
    flex: 0.48,
  },
  connectBtn: {
    backgroundColor: '#007AFF',
  },
  disconnectBtn: {
    backgroundColor: '#555',
  },
  btnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  fileSection: {
    marginBottom: 20,
    alignItems: 'center',
  },
  filePath: {
    fontSize: 12,
    color: '#999',
    marginBottom: 10,
  },
  actionButtonRow: {
    flexDirection: 'row',
    gap: 20,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  actionBtnText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  logTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  logList: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 10,
  },
  logItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 5,
  },
  logTime: {
    fontSize: 11,
    color: '#999',
  },
  logText: {
    fontSize: 13,
    color: '#333',
  },
});
