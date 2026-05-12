/**
 * 개발자 도구 - 로그, 파일 관리, 디버그 정보
 */

import React, { useState, useEffect, useCallback } from 'react';
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

import { useBLEContext } from '../../contexts/BLEContext';
import { LogEntry } from '../../hooks/useBLE';
import {
  getFilePath,
  getFileInfo,
  deleteLocalFile,
  FileInfo,
  getUploadLogs,
  clearUploadLogs,
  UploadLogEntry,
} from '../../services/fileStorage';
import { pingServer } from '../../services/uploadService';

export default function DevScreen() {
  const {
    isConnected,
    logs,
    packetCount,
    isRecording,
    addLog,
  } = useBLEContext();

  const [fileInfo, setFileInfo] = useState<FileInfo>({
    exists: false,
    name: 'data.raw',
    size: 0,
    sizeFormatted: '0 KB',
  });
  const [uploadLogs, setUploadLogs] = useState<UploadLogEntry[]>([]);
  const [pingResult, setPingResult] = useState<{
    status: 'idle' | 'testing' | 'success' | 'fail';
    latencyMs?: number;
    error?: string;
  }>({ status: 'idle' });

  const testServerConnection = async () => {
    setPingResult({ status: 'testing' });
    const result = await pingServer();
    if (result.reachable) {
      setPingResult({ status: 'success', latencyMs: result.latencyMs });
    } else {
      setPingResult({ status: 'fail', latencyMs: result.latencyMs, error: result.error });
    }
  };

  const refreshFileInfo = useCallback(async () => {
    const info = await getFileInfo();
    setFileInfo(info);
  }, []);

  useEffect(() => {
    refreshFileInfo();
    if (isRecording) {
      const interval = setInterval(() => {
        refreshFileInfo();
        setUploadLogs(getUploadLogs());
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isRecording, refreshFileInfo]);

  // 업로드 로그 주기적 갱신
  useEffect(() => {
    const interval = setInterval(() => {
      setUploadLogs(getUploadLogs());
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const deleteFile = async () => {
    if (!fileInfo.exists) {
      Alert.alert('알림', '삭제할 파일이 없습니다.');
      return;
    }
    Alert.alert(
      '파일 삭제',
      `${fileInfo.name} (${fileInfo.sizeFormatted})을(를) 삭제하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            const deleted = await deleteLocalFile();
            if (deleted) {
              addLog('파일 삭제 완료');
              refreshFileInfo();
            }
          },
        },
      ]
    );
  };

  const shareFile = async () => {
    try {
      const filePath = getFilePath();
      const exists = await RNFS.exists(filePath);
      if (!exists) {
        Alert.alert('알림', '공유할 파일이 없습니다.');
        return;
      }
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('알림', '공유 기능을 사용할 수 없습니다.');
        return;
      }
      await Sharing.shareAsync('file://' + filePath, {
        mimeType: 'application/octet-stream',
        dialogTitle: '녹음 데이터 공유',
        UTI: 'public.data',
      });
    } catch (error: any) {
      Alert.alert('에러', `파일 공유 실패: ${error.message}`);
    }
  };

  const renderLogItem = ({ item }: { item: LogEntry }) => (
    <View style={styles.logItem}>
      <Text style={styles.logTime}>{item.timestamp}</Text>
      <Text style={styles.logText}>{item.text}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>개발자 도구</Text>

      {/* 상태 요약 */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{isConnected ? 'ON' : 'OFF'}</Text>
          <Text style={styles.statLabel}>연결</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{isRecording ? 'REC' : '-'}</Text>
          <Text style={styles.statLabel}>녹음</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{packetCount.toLocaleString()}</Text>
          <Text style={styles.statLabel}>패킷</Text>
        </View>
      </View>

      {/* 서버 연결 테스트 */}
      <View style={styles.serverCard}>
        <View style={styles.fileHeader}>
          <Text style={styles.fileTitle}>서버 연결 테스트</Text>
          <Text style={styles.serverUrl}>20.196.65.173:8000</Text>
        </View>
        <View style={styles.serverBody}>
          <View style={styles.serverStatus}>
            <View style={[
              styles.serverDot,
              pingResult.status === 'success' && { backgroundColor: '#34C759' },
              pingResult.status === 'fail' && { backgroundColor: '#FF3B30' },
              pingResult.status === 'testing' && { backgroundColor: '#F0C000' },
            ]} />
            <Text style={styles.serverStatusText}>
              {pingResult.status === 'idle' && '테스트 전'}
              {pingResult.status === 'testing' && '연결 중...'}
              {pingResult.status === 'success' && `연결 성공 (${pingResult.latencyMs}ms)`}
              {pingResult.status === 'fail' && `연결 실패`}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.pingBtn, pingResult.status === 'testing' && styles.fileBtnDisabled]}
            onPress={testServerConnection}
            disabled={pingResult.status === 'testing'}
          >
            <Text style={styles.pingBtnText}>Ping</Text>
          </TouchableOpacity>
        </View>
        {pingResult.status === 'fail' && pingResult.error && (
          <Text style={styles.serverError}>{pingResult.error}</Text>
        )}
      </View>

      {/* 파일 관리 */}
      <View style={styles.fileCard}>
        <View style={styles.fileHeader}>
          <Text style={styles.fileTitle}>로컬 파일</Text>
          <TouchableOpacity onPress={refreshFileInfo}>
            <Text style={styles.refreshBtn}>새로고침</Text>
          </TouchableOpacity>
        </View>
        {fileInfo.exists ? (
          <View style={styles.fileInfo}>
            <Text style={styles.fileName}>{fileInfo.name}</Text>
            <Text style={styles.fileSize}>{fileInfo.sizeFormatted}</Text>
          </View>
        ) : (
          <Text style={styles.noFile}>저장된 파일 없음</Text>
        )}
        <View style={styles.fileBtnRow}>
          <TouchableOpacity
            style={[styles.fileBtn, !fileInfo.exists && styles.fileBtnDisabled]}
            onPress={shareFile}
            disabled={!fileInfo.exists}
          >
            <Text style={styles.fileBtnText}>내보내기</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.fileBtn, styles.fileBtnDanger, !fileInfo.exists && styles.fileBtnDisabled]}
            onPress={deleteFile}
            disabled={!fileInfo.exists}
          >
            <Text style={styles.fileBtnText}>삭제</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 서버 업로드 로그 (스크롤 가능) */}
      <View style={styles.uploadSection}>
        <View style={styles.uploadHeader}>
          <Text style={styles.logTitle}>
            서버 전송 로그
            {uploadLogs.length > 0 && (
              <Text style={styles.logCount}> ({uploadLogs.length})</Text>
            )}
          </Text>
          {uploadLogs.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                clearUploadLogs();
                setUploadLogs([]);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.refreshBtn}>지우기</Text>
            </TouchableOpacity>
          )}
        </View>
        {uploadLogs.length === 0 ? (
          <Text style={styles.noFile}>전송 기록 없음</Text>
        ) : (
          <FlatList
            data={uploadLogs}
            keyExtractor={(_, index) => `upload-${index}`}
            style={styles.uploadList}
            contentContainerStyle={styles.uploadListContent}
            showsVerticalScrollIndicator={true}
            removeClippedSubviews={true}
            maxToRenderPerBatch={20}
            windowSize={10}
            initialNumToRender={20}
            renderItem={({ item }) => (
              <View style={styles.uploadItem}>
                <View style={[styles.uploadDot, { backgroundColor: item.success ? '#34C759' : '#FF3B30' }]} />
                <Text style={styles.logTime}>{item.timestamp}</Text>
                <Text
                  style={[styles.uploadText, { color: item.success ? '#7EE787' : '#FF6B6B' }]}
                  numberOfLines={2}
                >
                  {item.text}
                </Text>
              </View>
            )}
          />
        )}
      </View>

      {/* 실시간 로그 */}
      <View style={styles.logSection}>
        <Text style={styles.logTitle}>실시간 로그</Text>
        <FlatList
          data={logs}
          keyExtractor={(_, index) => index.toString()}
          renderItem={renderLogItem}
          style={styles.logList}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },

  // 상태 요약
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#21262D',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#58A6FF',
  },
  statLabel: {
    fontSize: 11,
    color: '#8B949E',
    marginTop: 4,
  },

  // 서버 연결 테스트
  serverCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#21262D',
  },
  serverUrl: {
    fontSize: 11,
    color: '#484F58',
    fontFamily: 'monospace',
  },
  serverBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serverStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serverDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#484F58',
    marginRight: 8,
  },
  serverStatusText: {
    fontSize: 14,
    color: '#C9D1D9',
    fontWeight: '500',
  },
  pingBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1F6FEB',
  },
  pingBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  serverError: {
    fontSize: 11,
    color: '#FF6B6B',
    fontFamily: 'monospace',
    marginTop: 8,
  },

  // 파일 관리
  fileCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#21262D',
  },
  fileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  fileTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C9D1D9',
  },
  refreshBtn: {
    fontSize: 13,
    color: '#58A6FF',
  },
  fileInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  fileName: {
    fontSize: 15,
    color: '#58A6FF',
    fontWeight: '500',
  },
  fileSize: {
    fontSize: 14,
    color: '#8B949E',
    fontWeight: '600',
  },
  noFile: {
    fontSize: 13,
    color: '#484F58',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  fileBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fileBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#21262D',
  },
  fileBtnDanger: {
    backgroundColor: '#3D1A1A',
  },
  fileBtnDisabled: {
    opacity: 0.3,
  },
  fileBtnText: {
    color: '#C9D1D9',
    fontSize: 13,
    fontWeight: '600',
  },

  // 서버 업로드 로그
  uploadSection: {
    marginBottom: 16,
  },
  uploadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  logCount: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8B949E',
  },
  uploadList: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#21262D',
    maxHeight: 240,            // 스크롤 영역 (약 10~12줄 정도)
  },
  uploadListContent: {
    padding: 12,
  },
  uploadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2128',
  },
  uploadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  uploadText: {
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 1,
    marginLeft: 6,
  },

  // 로그
  logSection: {
    flex: 1,
  },
  logTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C9D1D9',
    marginBottom: 8,
  },
  logList: {
    flex: 1,
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#21262D',
  },
  logItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
    paddingVertical: 6,
  },
  logTime: {
    fontSize: 10,
    color: '#484F58',
    fontFamily: 'monospace',
  },
  logText: {
    fontSize: 12,
    color: '#C9D1D9',
    fontFamily: 'monospace',
  },
});
