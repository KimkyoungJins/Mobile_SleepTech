/**
 * 수면 기록 - 사용자용 메인 화면
 *
 * 깔끔한 UI로 BLE 연결 → 녹음 → 종료 플로우를 제공
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Animated,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';

import { useBLEContext } from '../../contexts/BLEContext';
import { getFileInfo, FileInfo } from '../../services/fileStorage';
import { loadHistory, HistoryEntry } from '../../services/historyStorage';
import { computeSleepMetrics } from '../../services/sleepMetrics';

/**
 * 녹음 경과 시간을 HH:MM:SS 포맷으로 반환
 */
const formatElapsed = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** 총 수면(분) → "7시간 30분" / "45분" */
const formatSleepDuration = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
};

/** session_id(YYYYMMDD_HHmmss) → 사람 친화 라벨 */
const formatLastSleepLabel = (sessionId: string): string => {
  if (!sessionId || sessionId.length < 8) return '최근';
  const y = Number(sessionId.slice(0, 4));
  const mo = Number(sessionId.slice(4, 6));
  const d = Number(sessionId.slice(6, 8));
  if (!y || !mo || !d) return '최근';
  const sleepDate = new Date(y, mo - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - sleepDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return '오늘 수면';
  if (diffDays === 1) return '어제 수면';
  if (diffDays > 1 && diffDays <= 7) return `${diffDays}일 전 수면`;
  return `${mo}월 ${d}일 수면`;
};

export default function HomeScreen() {
  const {
    isConnected,
    isRecording,
    packetCount,
    scanAndConnect,
    disconnect,
    toggleRecording,
  } = useBLEContext();

  const router = useRouter();
  const [fileInfo, setFileInfo] = useState<FileInfo>({
    exists: false,
    name: 'data.raw',
    size: 0,
    sizeFormatted: '0 KB',
  });
  const [elapsed, setElapsed] = useState(0);
  const [lastEntry, setLastEntry] = useState<HistoryEntry | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // 탭 진입 시 최신 기록 1개 로드 (분석 탭에서 저장 후 돌아왔을 때도 갱신)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const items = await loadHistory();
        if (!cancelled) setLastEntry(items[0] ?? null);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // 녹음 경과 시간 카운터
  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [isRecording]);

  // 녹음 중 펄스 애니메이션
  useEffect(() => {
    if (isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // 파일 정보 갱신
  const refreshFileInfo = useCallback(async () => {
    const info = await getFileInfo();
    setFileInfo(info);
  }, []);

  useEffect(() => {
    refreshFileInfo();
    if (isRecording) {
      const interval = setInterval(refreshFileInfo, 10000);
      return () => clearInterval(interval);
    }
  }, [isRecording, refreshFileInfo]);

  // 연결 상태에 따른 단계
  const getStep = (): 1 | 2 | 3 => {
    if (!isConnected) return 1;
    if (!isRecording) return 2;
    return 3;
  };
  const step = getStep();

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.appName}>Sleep Recorder</Text>
        <Text style={styles.appDesc}>수면 중 소리를 기록합니다</Text>
      </View>

      {/* 최근 수면 미니카드 — idle 상태에서만 노출 */}
      {!isRecording && lastEntry && (() => {
        const m = computeSleepMetrics(lastEntry.result);
        return (
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.lastSleepCard, { borderColor: m.grade.color + '55' }]}
            onPress={() => router.push('/(tabs)/analysis')}
          >
            <View style={[styles.lastSleepAccent, { backgroundColor: m.grade.color }]} />
            <View style={styles.lastSleepMain}>
              <Text style={styles.lastSleepLabel}>{formatLastSleepLabel(lastEntry.session_id)}</Text>
              <View style={styles.lastSleepRow}>
                <Text style={[styles.lastSleepScore, { color: m.grade.color }]}>
                  {m.quality_score}
                </Text>
                <Text style={styles.lastSleepUnit}>점</Text>
                <View style={[styles.lastSleepPill, { backgroundColor: m.grade.color }]}>
                  <Text style={styles.lastSleepPillText}>{m.grade.label}</Text>
                </View>
              </View>
              <Text style={styles.lastSleepSub}>
                총 {formatSleepDuration(lastEntry.result.total_sleep_minutes)} · 효율 {m.sleep_efficiency.toFixed(0)}%
              </Text>
            </View>
            <Text style={styles.lastSleepChevron}>›</Text>
          </TouchableOpacity>
        );
      })()}

      {/* 연결 상태 카드 */}
      <View style={[styles.statusCard, isConnected ? styles.statusConnected : styles.statusDisconnected]}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? '#2A9F47' : '#B83A35' }]} />
          <Text style={styles.statusLabel}>
            {isConnected ? '장치 연결됨' : '장치 미연결'}
          </Text>
        </View>
        {isConnected && (
          <Text style={styles.statusDetail}>수신 패킷: {packetCount.toLocaleString()}</Text>
        )}
      </View>

      {/* 중앙 녹음 영역 */}
      <View style={styles.centerArea}>
        {isRecording ? (
          <>
            <Animated.View style={[styles.recordingCircle, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={styles.recordingDot}>REC</Text>
            </Animated.View>
            <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>
            <Text style={styles.timerSubText}>
              {fileInfo.exists ? fileInfo.sizeFormatted : '기록 중...'}
            </Text>
            <Text style={styles.bgHint}>앱을 닫아도 계속 기록됩니다</Text>
          </>
        ) : (
          <>
            <View style={styles.idleCircle}>
              <Text style={styles.idleIcon}>{isConnected ? 'Ready' : 'Off'}</Text>
            </View>
            <Text style={styles.idleText}>
              {step === 1
                ? '장치를 연결해주세요'
                : '녹음을 시작해주세요'}
            </Text>
          </>
        )}
      </View>

      {/* 단계별 가이드 */}
      <View style={styles.stepsRow}>
        <View style={[styles.stepBadge, step >= 1 && styles.stepActive]}>
          <Text style={[styles.stepNum, step >= 1 && styles.stepNumActive]}>1</Text>
          <Text style={[styles.stepLabel, step >= 1 && styles.stepLabelActive]}>연결</Text>
        </View>
        <View style={[styles.stepLine, step >= 2 && styles.stepLineActive]} />
        <View style={[styles.stepBadge, step >= 2 && styles.stepActive]}>
          <Text style={[styles.stepNum, step >= 2 && styles.stepNumActive]}>2</Text>
          <Text style={[styles.stepLabel, step >= 2 && styles.stepLabelActive]}>녹음</Text>
        </View>
        <View style={[styles.stepLine, step >= 3 && styles.stepLineActive]} />
        <View style={[styles.stepBadge, step >= 3 && styles.stepActive]}>
          <Text style={[styles.stepNum, step >= 3 && styles.stepNumActive]}>3</Text>
          <Text style={[styles.stepLabel, step >= 3 && styles.stepLabelActive]}>기록중</Text>
        </View>
      </View>

      {/* 메인 액션 버튼 */}
      <View style={styles.actionArea}>
        {!isConnected ? (
          <TouchableOpacity style={[styles.mainBtn, styles.connectBtn]} onPress={scanAndConnect}>
            <Text style={styles.mainBtnText}>장치 연결</Text>
          </TouchableOpacity>
        ) : !isRecording ? (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.mainBtn, styles.startBtn, { flex: 1, marginRight: 10 }]}
              onPress={toggleRecording}
            >
              <Text style={styles.mainBtnText}>수면 데이터 기록 시작</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subBtn, { flex: 0.5 }]}
              onPress={disconnect}
            >
              <Text style={styles.subBtnText}>연결 해제</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.mainBtn, styles.stopBtn]} onPress={toggleRecording}>
            <Text style={styles.mainBtnText}>녹음 중지</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
    paddingHorizontal: 24,
    paddingTop: 60,
  },

  // 헤더
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  appDesc: {
    fontSize: 14,
    color: '#8B949E',
    marginTop: 4,
  },

  // 최근 수면 미니 카드
  lastSleepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  lastSleepAccent: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 3,
  },
  lastSleepMain: {
    flex: 1,
  },
  lastSleepLabel: {
    fontSize: 11,
    color: '#8B949E',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  lastSleepRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  lastSleepScore: {
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  lastSleepUnit: {
    fontSize: 13,
    color: '#6E7681',
    marginLeft: 4,
    fontWeight: '600',
  },
  lastSleepPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginLeft: 10,
  },
  lastSleepPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D1117',
  },
  lastSleepSub: {
    fontSize: 12,
    color: '#8B949E',
    marginTop: 4,
  },
  lastSleepChevron: {
    fontSize: 28,
    color: '#6E7681',
    marginLeft: 12,
    marginTop: -2,
  },

  // 상태 카드
  statusCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  statusConnected: {
    backgroundColor: '#1A2E1A',
    borderWidth: 1,
    borderColor: '#2D5A2D',
  },
  statusDisconnected: {
    backgroundColor: '#2E1A1A',
    borderWidth: 1,
    borderColor: '#5A2D2D',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statusDetail: {
    fontSize: 13,
    color: '#8B949E',
    marginTop: 6,
    marginLeft: 20,
  },

  // 중앙 녹음 영역
  centerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    // 야간 친화: 채도/명도 낮춘 빨강 (구 #FF3B30은 잠들기 전 눈부심 유발)
    backgroundColor: '#B83A35',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B83A35',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  recordingDot: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  timerText: {
    fontSize: 48,
    fontWeight: '300',
    color: '#FFFFFF',
    marginTop: 24,
    fontVariant: ['tabular-nums'],
  },
  timerSubText: {
    fontSize: 14,
    color: '#8B949E',
    marginTop: 8,
  },
  bgHint: {
    fontSize: 12,
    color: '#58A6FF',
    marginTop: 16,
  },
  idleCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#21262D',
    borderWidth: 2,
    borderColor: '#30363D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleIcon: {
    fontSize: 20,
    fontWeight: '600',
    color: '#8B949E',
  },
  idleText: {
    fontSize: 16,
    color: '#8B949E',
    marginTop: 20,
  },

  // 단계 표시
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  stepBadge: {
    alignItems: 'center',
    opacity: 0.4,
  },
  stepActive: {
    opacity: 1,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#21262D',
    color: '#8B949E',
    textAlign: 'center',
    lineHeight: 28,
    fontSize: 14,
    fontWeight: '700',
    overflow: 'hidden',
  },
  stepNumActive: {
    backgroundColor: '#58A6FF',
    color: '#FFFFFF',
  },
  stepLabel: {
    fontSize: 11,
    color: '#8B949E',
    marginTop: 4,
  },
  stepLabelActive: {
    color: '#58A6FF',
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: '#21262D',
    marginHorizontal: 8,
    marginBottom: 16,
  },
  stepLineActive: {
    backgroundColor: '#58A6FF',
  },

  // 버튼
  actionArea: {
    marginBottom: 40,
  },
  btnRow: {
    flexDirection: 'row',
  },
  mainBtn: {
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  mainBtnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  connectBtn: {
    backgroundColor: '#1F6FEB',
  },
  startBtn: {
    backgroundColor: '#238636',
  },
  stopBtn: {
    backgroundColor: '#DA3633',
  },
  subBtn: {
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#21262D',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  subBtnText: {
    color: '#8B949E',
    fontSize: 16,
    fontWeight: '600',
  },
});
