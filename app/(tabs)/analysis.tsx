/**
 * 수면 분석 탭
 *
 * 녹음 종료 후 서버에서 수면 분석 결과를 조회하여
 * 수면 점수, 단계 비율, 하이프노그램을 표시
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Animated,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';

import { useBLEContext } from '../../contexts/BLEContext';
import {
  fetchSleepResult,
  SleepResultResponse,
  SleepStages,
} from '../../services/uploadService';
import {
  loadHistory,
  saveHistoryEntry,
  deleteHistoryEntry,
  HistoryEntry,
} from '../../services/historyStorage';
import {
  computeSleepMetrics,
  assessMetric,
  SleepMetrics,
} from '../../services/sleepMetrics';

// ===================== 수면 단계 정의 =====================
//
// 백엔드는 ResNet22 기반 2-class(WAKE/SLEEP) 분류기를 사용한다.
// API 응답의 `nrem_minutes`는 "잠든 시간"으로 해석하며, `rem_minutes`는 항상 0.
//
// UI에서는 2단계만 표시한다:
//   - SLEEP : 수면 (NREM)
//   - WAKE  : 각성

const SLEEP_STAGES = {
  WAKE:  { label: '각성', color: '#FF6B6B', level: 2 },
  SLEEP: { label: '수면', color: '#8B5CF6', level: 1 },
} as const;

type StageKey = keyof typeof SLEEP_STAGES;

// ===================== 도넛 차트 (RN-only) =====================
//
// percent (0~100)만큼을 `primary` 색으로, 나머지를 `secondary` 색으로 채운 ring.
// SVG 없이 반원 마스킹 + transform: rotate 패턴으로 그린다.
//
const DonutChart: React.FC<{
  percent: number;
  primary: string;
  secondary: string;
  size?: number;
  thickness?: number;
  centerBg?: string;
  children?: React.ReactNode;
}> = ({ percent, primary, secondary, size = 168, thickness = 22, centerBg = '#161B22', children }) => {
  const clamped = Math.max(0, Math.min(100, percent));
  const angle = (clamped / 100) * 360;
  const half = size / 2;
  const inner = size - thickness * 2;

  // 회전 중심을 원 중심(반원의 짧은 변)으로 옮기는 트릭:
  // translateX(±half/2) ↔ rotate(...) ↔ translateX(∓half/2)
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* 전체 base = secondary 색 (WAKE) */}
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: half, backgroundColor: secondary }} />

      {/* primary wedge (0 ~ min(180°, angle)) — 오른쪽 반원에 그림 */}
      {angle > 0 && (
        <View style={{ position: 'absolute', width: half, height: size, left: half, overflow: 'hidden' }}>
          <View style={{
            position: 'absolute',
            width: size,
            height: size,
            left: -half,
            borderRadius: half,
            backgroundColor: primary,
            transform: [
              { translateX: -half / 2 },
              { rotate: `${Math.min(180, angle) - 180}deg` },
              { translateX: half / 2 },
            ],
          }} />
        </View>
      )}

      {/* primary wedge 두 번째 반 (180° ~ angle) — 왼쪽 반원에 그림 */}
      {angle > 180 && (
        <View style={{ position: 'absolute', width: half, height: size, left: 0, overflow: 'hidden' }}>
          <View style={{
            position: 'absolute',
            width: size,
            height: size,
            left: 0,
            borderRadius: half,
            backgroundColor: primary,
            transform: [
              { translateX: half / 2 },
              { rotate: `${angle - 360}deg` },
              { translateX: -half / 2 },
            ],
          }} />
        </View>
      )}

      {/* 가운데 hole */}
      <View style={{
        width: inner,
        height: inner,
        borderRadius: inner / 2,
        backgroundColor: centerBg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {children}
      </View>
    </View>
  );
};

// ===================== Spark Bars (최근 점수 추세) =====================
const SparkBars: React.FC<{ entries: HistoryEntry[] }> = ({ entries }) => {
  // 최신 7개, 시간순(왼쪽=과거, 오른쪽=최신)
  const recent = entries.slice(0, 7).slice().reverse();
  if (recent.length < 2) return null;

  const data = recent.map((e) => {
    const m = computeSleepMetrics(e.result);
    return { score: m.quality_score, color: m.grade.color };
  });
  const avg = Math.round(data.reduce((s, d) => s + d.score, 0) / data.length);
  const latest = data[data.length - 1].score;
  const previous = data[data.length - 2].score;
  const trend = latest - previous;
  const trendColor = trend > 0 ? '#7EE787' : trend < 0 ? '#FF6B6B' : '#8B949E';
  const trendArrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '·';

  return (
    <View style={styles.sparkCard}>
      <View style={styles.sparkHeader}>
        <Text style={styles.sparkTitle}>최근 {data.length}회 추세</Text>
        <View style={styles.sparkStats}>
          <Text style={styles.sparkAvg}>평균 {avg}점</Text>
          <Text style={[styles.sparkTrend, { color: trendColor }]}>
            {trendArrow} {Math.abs(trend)}
          </Text>
        </View>
      </View>
      <View style={styles.sparkBars}>
        {data.map((d, i) => (
          <View key={i} style={styles.sparkColumn}>
            <View
              style={[
                styles.sparkBar,
                { height: `${Math.max(6, d.score)}%`, backgroundColor: d.color },
              ]}
            />
          </View>
        ))}
      </View>
    </View>
  );
};

// ===================== 수면 점수 계산 (2-class) =====================

const calculateScore = (stages: SleepStages, totalMinutes: number): number => {
  if (totalMinutes <= 0) return 0;

  const sleepMinutes = stages.nrem_minutes + stages.rem_minutes;  // rem은 항상 0
  const wakeRatio = stages.wake_minutes / totalMinutes;
  const sleepEfficiency = sleepMinutes / totalMinutes;            // 수면 효율

  let score = 50;

  // 수면 효율 (이상적: 90% 이상)
  if (sleepEfficiency >= 0.90)      score += 30;
  else if (sleepEfficiency >= 0.85) score += 20;
  else if (sleepEfficiency >= 0.75) score += 10;

  // 총 수면시간 보너스 (성인 권장 7~9시간)
  if (totalMinutes >= 420 && totalMinutes <= 540) score += 15;
  else if (totalMinutes >= 360 && totalMinutes < 420) score += 8;

  // 중간 각성 패널티
  score -= Math.round(wakeRatio * 50);

  return Math.max(0, Math.min(100, score));
};

const getScoreGrade = (score: number) => {
  if (score >= 85) return { label: '매우 좋음', color: '#7EE787', message: '푹 잤어요!' };
  if (score >= 70) return { label: '좋음', color: '#58A6FF', message: '양호한 수면이에요' };
  if (score >= 50) return { label: '보통', color: '#D29922', message: '조금 아쉬운 수면이에요' };
  return { label: '나쁨', color: '#FF6B6B', message: '수면 개선이 필요해요' };
};

// ===================== 유틸 =====================

const formatMinutes = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
};

// ===================== 컴포넌트 =====================

export default function AnalysisScreen() {
  const { isRecording, lastSessionId } = useBLEContext();
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // 현재 모드 데이터 (서버 폴링)
  const [result, setResult] = useState<SleepResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 모드 토글 + 기록 데이터
  const [mode, setMode] = useState<'current' | 'history'>('current');
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<HistoryEntry | null>(null);

  // 녹음 중 애니메이션
  useEffect(() => {
    if (isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 1500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // 녹음 중에도 lastSessionId가 설정되어 있으면 30초마다 폴링
  useEffect(() => {
    if (!lastSessionId) return;

    // 즉시 1회
    loadResult(lastSessionId, /*silent*/ false);

    // 폴링: 녹음 중이거나 아직 분석 진행 중이면 30초마다
    const interval = setInterval(() => {
      loadResult(lastSessionId, /*silent*/ true);
    }, 30000);

    return () => clearInterval(interval);
  }, [isRecording, lastSessionId]);

  // 최종 결과 도착 시 로컬 히스토리에 자동 저장 (in_progress는 무시)
  useEffect(() => {
    if (result && result.status !== 'in_progress') {
      saveHistoryEntry(result);
    }
  }, [result]);

  // 기록 모드 진입 시 list 로드 + 선택 초기화
  useEffect(() => {
    if (mode === 'history') {
      loadHistory().then(setHistoryList);
      setSelectedHistory(null);
    }
  }, [mode]);

  const refreshHistory = async () => {
    const updated = await loadHistory();
    setHistoryList(updated);
  };

  const loadResult = async (sessionId: string, silent: boolean = false) => {
    if (!silent) setLoading(true);
    setError(null);

    const data = await fetchSleepResult(sessionId);
    if (data) {
      setResult(data);
    } else if (!silent) {
      // partial도 없으면 (분석 시작 전) 안내만, 폴링 중엔 조용히 무시
      setError('서버에서 분석이 시작되기를 기다리는 중...');
    }
    if (!silent) setLoading(false);
  };

  const handleRetry = () => {
    if (lastSessionId) {
      loadResult(lastSessionId);
    }
  };

  // 목업 데이터로 미리보기 (2-class: SLEEP/WAKE + 무호흡 분석)
  const loadMockData = () => {
    setResult({
      session_id: 'MOCK_PREVIEW',
      total_sleep_minutes: 420,
      sleep_start: '2026-05-13T23:15',
      sleep_end: '2026-05-14T06:15',
      stages: {
        nrem_minutes: 375,  // 수면 시간
        rem_minutes: 0,     // 2-class 모델: 항상 0
        wake_minutes: 45,
      },
      timeline: [
        { time: '23:15', stage: 'WAKE' },
        { time: '23:30', stage: 'NREM' },
        { time: '23:45', stage: 'NREM' },
        { time: '00:00', stage: 'NREM' },
        { time: '00:15', stage: 'NREM' },
        { time: '00:30', stage: 'NREM' },
        { time: '00:45', stage: 'NREM' },
        { time: '01:00', stage: 'NREM' },
        { time: '01:15', stage: 'NREM' },
        { time: '01:30', stage: 'NREM' },
        { time: '01:45', stage: 'NREM' },
        { time: '02:00', stage: 'NREM' },
        { time: '02:15', stage: 'NREM' },
        { time: '02:30', stage: 'NREM' },
        { time: '02:45', stage: 'WAKE' },
        { time: '03:00', stage: 'NREM' },
        { time: '03:15', stage: 'NREM' },
        { time: '03:30', stage: 'NREM' },
        { time: '03:45', stage: 'NREM' },
        { time: '04:00', stage: 'NREM' },
        { time: '04:15', stage: 'NREM' },
        { time: '04:30', stage: 'NREM' },
        { time: '04:45', stage: 'NREM' },
        { time: '05:00', stage: 'WAKE' },
        { time: '05:15', stage: 'NREM' },
        { time: '05:30', stage: 'NREM' },
        { time: '05:45', stage: 'NREM' },
        { time: '06:00', stage: 'WAKE' },
      ],
      // 무호흡 분석 샘플 — Mild 수준 (AHI 11.4)
      apnea_analysis: {
        total_apnea_events: 92,
        apnea_events_during_sleep: 80,
        estimated_AHI: 11.4,
        severity: 'Mild',
        severity_categories: {
          normal: false,
          mild: true,
          moderate: false,
          severe: false,
        },
        clinically_significant: false,
        recommendation:
          '경도 수면 무호흡 의심 — 옆으로 누워 자는 자세 교정과 체중 관리가 도움될 수 있습니다. 증상이 지속되면 수면 클리닉 상담을 권합니다.',
      },
      combined_insights: {
        fragmentation_attributable_to_apnea_percent: 62,
        sleep_quality_impact:
          '각성의 약 62%가 무호흡 이벤트 전후에 발생 — 수면 단편화의 주요 원인입니다.',
      },
    });
  };

  // 표시할 결과 — 기록 모드면 선택된 항목, 아니면 폴링된 result
  const displayResult = mode === 'history' && selectedHistory
    ? selectedHistory.result
    : result;

  // 공통 토글 헤더
  const renderToggle = () => (
    <View style={styles.modeToggle}>
      <TouchableOpacity
        style={[styles.modeBtn, mode === 'current' && styles.modeBtnActive]}
        onPress={() => { setMode('current'); setSelectedHistory(null); }}
      >
        <Text style={[styles.modeBtnText, mode === 'current' && styles.modeBtnTextActive]}>
          현재
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.modeBtn, mode === 'history' && styles.modeBtnActive]}
        onPress={() => setMode('history')}
      >
        <Text style={[styles.modeBtnText, mode === 'history' && styles.modeBtnTextActive]}>
          기록{historyList.length > 0 ? ` (${historyList.length})` : ''}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // 기록 카드 한 줄 — 새 임상 점수 알고리즘 사용
  const renderHistoryItem = (entry: HistoryEntry) => {
    const m = computeSleepMetrics(entry.result);
    const sScore = m.quality_score;
    const sGrade = m.grade;
    const date = entry.result.sleep_start.split('T')[0] || entry.session_id;
    const startTime = entry.result.sleep_start.split('T')[1] ?? '';
    const endTime = entry.result.sleep_end.split('T')[1] ?? '';
    return (
      <TouchableOpacity
        key={entry.session_id}
        style={styles.historyCard}
        onPress={() => setSelectedHistory(entry)}
        onLongPress={() => {
          Alert.alert(
            '기록 삭제',
            `${date} 기록을 삭제하시겠습니까?`,
            [
              { text: '취소', style: 'cancel' },
              {
                text: '삭제',
                style: 'destructive',
                onPress: async () => {
                  await deleteHistoryEntry(entry.session_id);
                  await refreshHistory();
                },
              },
            ],
          );
        }}
      >
        <View style={styles.historyCardLeft}>
          <Text style={styles.historyDate}>{date}</Text>
          <Text style={styles.historyTime}>{startTime} ~ {endTime}</Text>
          <Text style={styles.historyDuration}>
            {formatMinutes(entry.result.total_sleep_minutes)}
          </Text>
          <View style={styles.historyMicroRow}>
            <Text style={styles.historyMicroKey}>효율</Text>
            <Text style={styles.historyMicroVal}>{m.sleep_efficiency.toFixed(0)}%</Text>
            <Text style={styles.historyMicroDot}>·</Text>
            <Text style={styles.historyMicroKey}>WASO</Text>
            <Text style={styles.historyMicroVal}>{Math.round(m.waso_minutes)}분</Text>
            <Text style={styles.historyMicroDot}>·</Text>
            <Text style={styles.historyMicroKey}>깸</Text>
            <Text style={styles.historyMicroVal}>{m.awakenings}회</Text>
          </View>
        </View>
        <View style={[styles.historyScore, { borderColor: sGrade.color }]}>
          <Text style={[styles.historyScoreNum, { color: sGrade.color }]}>{sScore}</Text>
          <Text style={[styles.historyScoreLabel, { color: sGrade.color }]}>{sGrade.label}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ── 기록 모드, 항목 미선택: 리스트 화면 ──
  if (mode === 'history' && !selectedHistory) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        {renderToggle()}
        {historyList.length === 0 ? (
          <View style={styles.offBanner}>
            <Text style={styles.offText}>
              아직 저장된 기록이 없습니다.{"\n"}녹음을 완료하면 결과가 여기에 자동 저장됩니다.
            </Text>
          </View>
        ) : (
          <>
            <SparkBars entries={historyList} />
            <Text style={styles.historyHint}>
              항목을 탭하면 상세 보기 · 길게 누르면 삭제
            </Text>
            {historyList.map(renderHistoryItem)}
          </>
        )}
      </ScrollView>
    );
  }

  // ── 현재 모드: 녹음 중 + 결과 아직 없음 ──
  if (mode === 'current' && isRecording && !displayResult) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        {renderToggle()}
        <Animated.View style={[styles.liveBanner, { opacity: pulseAnim }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>
            데이터 수집 중... 첫 분석까지 약 60초 (30초 측정 + 추론)
          </Text>
        </Animated.View>
        {loading && (
          <ActivityIndicator size="small" color="#58A6FF" style={{ marginTop: 16 }} />
        )}
      </ScrollView>
    );
  }

  // ── 현재 모드: 녹음 전 (한 번도 녹음 안 함) ──
  if (mode === 'current' && !lastSessionId && !displayResult) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        {renderToggle()}
        <View style={styles.offBanner}>
          <Text style={styles.offText}>
            녹음을 완료하면 수면 분석 결과가 표시됩니다
          </Text>
        </View>
        <TouchableOpacity style={styles.previewBtn} onPress={loadMockData}>
          <Text style={styles.previewBtnText}>미리보기 (샘플 데이터)</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── 현재 모드: 로딩 ──
  if (mode === 'current' && loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        {renderToggle()}
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color="#58A6FF" />
          <Text style={styles.loadingText}>서버에서 분석 결과를 가져오는 중...</Text>
        </View>
      </ScrollView>
    );
  }

  // ── 결과 없음 (현재 모드만 도달, 에러 또는 빈 상태) ──
  if (!displayResult) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        {renderToggle()}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
              <Text style={styles.retryBtnText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.offBanner}>
            <Text style={styles.offText}>
              분석 결과를 불러올 수 없습니다
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── 결과 형식 오류 ──
  if (!displayResult.stages || !displayResult.total_sleep_minutes) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        {renderToggle()}
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>분석 결과 형식이 올바르지 않습니다</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              if (mode === 'history' && selectedHistory) {
                setSelectedHistory(null);
              } else {
                setResult(null);
              }
            }}
          >
            <Text style={styles.retryBtnText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ── 결과 표시 (현재 모드의 폴링 결과 또는 기록 모드의 선택된 항목) ──
  const metrics = computeSleepMetrics(displayResult);
  const score = metrics.quality_score;
  const grade = metrics.grade;
  const { stages, timeline, total_sleep_minutes } = displayResult;

  // X축 라벨 생성
  const xLabels = (() => {
    if (timeline.length === 0) return [];
    const labels: string[] = [];
    const firstHour = parseInt(timeline[0].time.split(':')[0], 10);
    const lastHour = parseInt(timeline[timeline.length - 1].time.split(':')[0], 10);

    let h = firstHour;
    labels.push(timeline[0].time);
    while (true) {
      h = (h + 1) % 24;
      labels.push(`${String(h).padStart(2, '0')}:00`);
      if (h === lastHour) break;
      if (labels.length > 24) break;
    }
    if (labels.length > 5) {
      const step = Math.ceil(labels.length / 5);
      return labels.filter((_, i) => i % step === 0).slice(0, 5);
    }
    return labels;
  })();

  const isInProgress = displayResult.status === 'in_progress';
  const epochsAnalyzed = displayResult.epochs_analyzed ?? 0;
  const isViewingHistory = mode === 'history' && !!selectedHistory;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 헤더 */}
      <Text style={styles.title}>수면 분석</Text>
      {renderToggle()}

      {/* 기록 보기 중일 때 안내 */}
      {isViewingHistory && (
        <View style={styles.historyViewBadge}>
          <Text style={styles.historyViewText}>
            저장된 기록 · {selectedHistory!.saved_at.split('T')[0]}
          </Text>
        </View>
      )}

      {/* 실시간 분석 진행 중 뱃지 (현재 모드에서 폴링 중일 때만) */}
      {!isViewingHistory && isInProgress && (
        <Animated.View style={[styles.liveBanner, { opacity: pulseAnim }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>
            실시간 분석 중 · {epochsAnalyzed} 에포크 ({formatMinutes(total_sleep_minutes)})
          </Text>
        </Animated.View>
      )}

      {/* 수면 시간 요약 */}
      <View style={styles.timeBanner}>
        <Text style={styles.timeLabel}>
          {displayResult.sleep_start.split('T')[1]} ~ {displayResult.sleep_end.split('T')[1]}
        </Text>
        <Text style={styles.timeSub}>
          {!isViewingHistory && isInProgress ? '측정 중' : '총 수면'} {formatMinutes(total_sleep_minutes)}
        </Text>
      </View>

      {/* 수면 점수 카드 — hero 레이아웃 */}
      <View style={[styles.scoreCard, { borderColor: grade.color + '55' }]}>
        <View style={[styles.scoreAccent, { backgroundColor: grade.color }]} />

        <Text style={styles.scoreHeading}>수면 점수</Text>

        <View style={styles.scoreHeroRow}>
          <Text style={[styles.scoreHero, { color: grade.color }]}>{score}</Text>
          <Text style={styles.scoreHeroUnit}>/ 100</Text>
        </View>

        <View style={[styles.scorePill, { backgroundColor: grade.color }]}>
          <Text style={styles.scorePillText}>{grade.label}</Text>
        </View>

        <Text style={styles.scoreMessage}>{grade.message}</Text>

        <View style={styles.scoreProgressTrack}>
          <View style={[styles.scoreProgressFill, { width: `${Math.max(2, score)}%`, backgroundColor: grade.color }]} />
        </View>

        <View style={styles.scoreStatsRow}>
          <View style={styles.scoreStat}>
            <Text style={styles.scoreStatValue}>{formatMinutes(total_sleep_minutes)}</Text>
            <Text style={styles.scoreStatLabel}>총 수면</Text>
          </View>
          <View style={styles.scoreStatDivider} />
          <View style={styles.scoreStat}>
            <Text style={styles.scoreStatValue}>{metrics.sleep_efficiency.toFixed(1)}%</Text>
            <Text style={styles.scoreStatLabel}>수면 효율</Text>
          </View>
          <View style={styles.scoreStatDivider} />
          <View style={styles.scoreStat}>
            <Text style={styles.scoreStatValue}>{metrics.awakenings}회</Text>
            <Text style={styles.scoreStatLabel}>깬 횟수</Text>
          </View>
        </View>
      </View>

      {/* 무호흡 분석 카드 — apnea_analysis가 있을 때만 */}
      {displayResult.apnea_analysis && (() => {
        const a = displayResult.apnea_analysis;
        const ci = displayResult.combined_insights;
        const sevColor =
          a.severity === 'Severe'   ? '#FF6B6B' :
          a.severity === 'Moderate' ? '#D29922' :
          a.severity === 'Mild'     ? '#58A6FF' :
                                       '#7EE787';
        const sevLabel =
          a.severity === 'Severe'   ? '중증' :
          a.severity === 'Moderate' ? '중등도' :
          a.severity === 'Mild'     ? '경도' :
                                       '정상';
        return (
          <View style={[styles.apneaCard, { borderColor: sevColor + '55' }]}>
            <View style={[styles.apneaAccent, { backgroundColor: sevColor }]} />

            <Text style={styles.apneaHeading}>무호흡 지수 (AHI)</Text>

            <View style={styles.apneaHeroRow}>
              <Text style={[styles.apneaHero, { color: sevColor }]}>
                {a.estimated_AHI.toFixed(1)}
              </Text>
              <Text style={styles.apneaHeroUnit}>events/hr</Text>
              <View style={[styles.apneaPill, { backgroundColor: sevColor }]}>
                <Text style={styles.apneaPillText}>{sevLabel}</Text>
              </View>
            </View>

            <View style={[styles.apneaRecBox, { borderLeftColor: sevColor }]}>
              <Text style={styles.apneaRecText}>{a.recommendation}</Text>
            </View>

            <View style={styles.apneaStatsRow}>
              <View style={styles.apneaStat}>
                <Text style={styles.apneaStatValue}>{a.total_apnea_events}</Text>
                <Text style={styles.apneaStatLabel}>총 events</Text>
              </View>
              <View style={styles.apneaStatDivider} />
              <View style={styles.apneaStat}>
                <Text style={styles.apneaStatValue}>{a.apnea_events_during_sleep}</Text>
                <Text style={styles.apneaStatLabel}>수면 중</Text>
              </View>
              <View style={styles.apneaStatDivider} />
              <View style={styles.apneaStat}>
                <Text style={styles.apneaStatValue}>
                  {ci ? `${ci.fragmentation_attributable_to_apnea_percent.toFixed(0)}%` : '—'}
                </Text>
                <Text style={styles.apneaStatLabel}>각성 기여</Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* 임상 지표 (W/S 기반: SE/SOL/WASO/awakenings/longest/fragmentation) */}
      <View style={styles.section}>
        <View style={styles.metricsHeader}>
          <Text style={styles.sectionTitle}>임상 지표</Text>
          {metrics.approximated && (
            <Text style={styles.approxBadge}>15분 근사 (구버전 데이터)</Text>
          )}
        </View>

        {/* SE 와이드 카드 (최우선 지표) */}
        {(() => {
          const a = assessMetric('sleep_efficiency', metrics.sleep_efficiency);
          return (
            <View style={styles.metricWide}>
              <View style={styles.metricWideHead}>
                <Text style={styles.metricWideLabel}>수면 효율 (SE)</Text>
                <View style={[styles.metricBadge, { borderColor: a.color }]}>
                  <Text style={[styles.metricBadgeText, { color: a.color }]}>{a.label}</Text>
                </View>
              </View>
              <View style={styles.metricWideValueRow}>
                <Text style={[styles.metricWideValue, { color: a.color }]}>
                  {metrics.sleep_efficiency.toFixed(1)}
                </Text>
                <Text style={styles.metricWideUnit}>%</Text>
              </View>
              <View style={styles.metricGaugeTrack}>
                <View style={[
                  styles.metricGaugeFill,
                  { width: `${Math.min(100, Math.max(2, metrics.sleep_efficiency))}%`, backgroundColor: a.color },
                ]} />
              </View>
            </View>
          );
        })()}

        {/* 3열 컴팩트: SOL / WASO / 깬 횟수 */}
        <View style={[styles.metricsGrid3, { marginTop: 10 }]}>
          {/* SOL */}
          {(() => {
            const a = assessMetric('sol_minutes', metrics.sol_minutes);
            return (
              <View style={styles.metricCardSmall}>
                <Text style={styles.metricLabelSmall}>잠들기</Text>
                <View style={styles.metricValueRow}>
                  <Text style={styles.metricValueSmall}>{Math.round(metrics.sol_minutes)}</Text>
                  <Text style={styles.metricUnitSmall}>분</Text>
                </View>
                <View style={[styles.metricBadgeSmall, { borderColor: a.color }]}>
                  <Text style={[styles.metricBadgeText, { color: a.color }]}>{a.label}</Text>
                </View>
              </View>
            );
          })()}

          {/* WASO */}
          {(() => {
            const a = assessMetric('waso_minutes', metrics.waso_minutes);
            return (
              <View style={styles.metricCardSmall}>
                <Text style={styles.metricLabelSmall}>WASO</Text>
                <View style={styles.metricValueRow}>
                  <Text style={styles.metricValueSmall}>{Math.round(metrics.waso_minutes)}</Text>
                  <Text style={styles.metricUnitSmall}>분</Text>
                </View>
                <View style={[styles.metricBadgeSmall, { borderColor: a.color }]}>
                  <Text style={[styles.metricBadgeText, { color: a.color }]}>{a.label}</Text>
                </View>
              </View>
            );
          })()}

          {/* 깬 횟수 */}
          {(() => {
            const a = assessMetric('awakenings', metrics.awakenings);
            return (
              <View style={styles.metricCardSmall}>
                <Text style={styles.metricLabelSmall}>깬 횟수</Text>
                <View style={styles.metricValueRow}>
                  <Text style={styles.metricValueSmall}>{metrics.awakenings}</Text>
                  <Text style={styles.metricUnitSmall}>회</Text>
                </View>
                <View style={[styles.metricBadgeSmall, { borderColor: a.color }]}>
                  <Text style={[styles.metricBadgeText, { color: a.color }]}>{a.label}</Text>
                </View>
              </View>
            );
          })()}
        </View>

        {/* 2열: 최장 연속 수면 / 단편화 지수 */}
        <View style={[styles.metricsGrid, { marginTop: 10 }]}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>최장 연속 수면</Text>
            <View style={styles.metricValueRow}>
              <Text style={styles.metricValue}>{formatMinutes(Math.round(metrics.longest_sleep_minutes))}</Text>
            </View>
            <View style={[styles.metricBadge, { borderColor: '#6E7681' }]}>
              <Text style={[styles.metricBadgeText, { color: '#8B949E' }]}>
                {metrics.longest_sleep_minutes >= 90 ? '한 cycle+' : '짧음'}
              </Text>
            </View>
          </View>

          {(() => {
            const a = assessMetric('fragmentation_index', metrics.fragmentation_index);
            return (
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>단편화 지수</Text>
                <View style={styles.metricValueRow}>
                  <Text style={styles.metricValue}>{metrics.fragmentation_index.toFixed(1)}</Text>
                </View>
                <View style={[styles.metricBadge, { borderColor: a.color }]}>
                  <Text style={[styles.metricBadgeText, { color: a.color }]}>{a.label}</Text>
                </View>
              </View>
            );
          })()}
        </View>

        {/* 요약 텍스트 (TST/TIB) */}
        <View style={styles.metricsSummary}>
          <Text style={styles.metricsSummaryText}>
            총 수면 {formatMinutes(Math.round(metrics.tst_minutes))} / 침대 {formatMinutes(Math.round(metrics.tib_minutes))}
          </Text>
        </View>
      </View>

      {/* 수면 단계 비율 — donut 차트 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>수면 단계 비율</Text>
        <View style={styles.donutLayout}>
          <DonutChart
            percent={total_sleep_minutes > 0
              ? ((stages.nrem_minutes + stages.rem_minutes) / total_sleep_minutes) * 100
              : 0}
            primary={SLEEP_STAGES.SLEEP.color}
            secondary={SLEEP_STAGES.WAKE.color}
            size={168}
            thickness={22}
          >
            <Text style={styles.donutCenterValue}>
              {formatMinutes(stages.nrem_minutes + stages.rem_minutes)}
            </Text>
            <Text style={styles.donutCenterLabel}>총 수면</Text>
          </DonutChart>

          <View style={styles.donutLegend}>
            {([
              { key: 'SLEEP' as StageKey, minutes: stages.nrem_minutes + stages.rem_minutes },
              { key: 'WAKE'  as StageKey, minutes: stages.wake_minutes },
            ]).map(({ key, minutes }) => {
              const pct = total_sleep_minutes > 0
                ? Math.round((minutes / total_sleep_minutes) * 100)
                : 0;
              return (
                <View key={key} style={styles.donutLegendRow}>
                  <View style={[styles.donutLegendDot, { backgroundColor: SLEEP_STAGES[key].color }]} />
                  <View style={styles.donutLegendText}>
                    <Text style={styles.donutLegendLabel}>{SLEEP_STAGES[key].label}</Text>
                    <Text style={styles.donutLegendMins}>{formatMinutes(minutes)}</Text>
                  </View>
                  <Text style={[styles.donutLegendPercent, { color: SLEEP_STAGES[key].color }]}>{pct}%</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* 하이프노그램 (계단형, 2-class) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>수면 단계 타임라인</Text>
        {(['WAKE', 'SLEEP'] as StageKey[]).map((stageKey) => (
          <View key={stageKey} style={styles.hyRow}>
            <Text style={[styles.hyRowLabel, { color: SLEEP_STAGES[stageKey].color }]}>
              {SLEEP_STAGES[stageKey].label}
            </Text>
            <View style={styles.hyRowTrack}>
              {timeline.map((item, index) => {
                const isSleep = item.stage === 'NREM' || item.stage === 'REM';
                const isWake = item.stage === 'WAKE';
                const match = (stageKey === 'SLEEP' && isSleep) || (stageKey === 'WAKE' && isWake);
                return (
                  <View
                    key={index}
                    style={[
                      styles.hyBlock,
                      {
                        backgroundColor: match
                          ? SLEEP_STAGES[stageKey].color
                          : 'transparent',
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
        ))}
        <View style={styles.hyXAxis}>
          {xLabels.map((label, i) => (
            <Text key={i} style={styles.hyXLabel}>{label}</Text>
          ))}
        </View>
      </View>

      {/* 세션 정보 */}
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionText}>세션: {displayResult.session_id}</Text>
      </View>

      {/* 돌아가기 버튼 — 기록 보기 중이면 리스트로, 아니면 현재 결과 클리어 */}
      <TouchableOpacity
        style={styles.resetBtn}
        onPress={() => {
          if (isViewingHistory) {
            setSelectedHistory(null);
          } else {
            setResult(null);
          }
        }}
      >
        <Text style={styles.resetBtnText}>
          {isViewingHistory ? '← 기록으로 돌아가기' : '돌아가기'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },

  // 실시간 배너
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A2E1A',
    borderWidth: 1,
    borderColor: '#2D5A2D',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
    marginRight: 10,
  },
  liveText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7EE787',
    flex: 1,
  },
  offBanner: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  offText: {
    fontSize: 14,
    color: '#484F58',
    textAlign: 'center',
  },

  // 로딩
  loadingCard: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: '#8B949E',
  },

  // 에러
  errorCard: {
    backgroundColor: '#2E1A1A',
    borderWidth: 1,
    borderColor: '#5A2D2D',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#FF6B6B',
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    backgroundColor: '#1F6FEB',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // 미리보기 버튼
  previewBtn: {
    backgroundColor: '#21262D',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  previewBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8B949E',
  },

  // 시간 배너
  timeBanner: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  timeSub: {
    fontSize: 13,
    color: '#8B949E',
    marginTop: 4,
  },

  // 수면 점수 hero 카드
  scoreCard: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    marginBottom: 20,
    alignItems: 'center',
    overflow: 'hidden',
  },
  scoreAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  scoreHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8B949E',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  scoreHeroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  scoreHero: {
    fontSize: 72,
    fontWeight: '800',
    lineHeight: 76,
    fontVariant: ['tabular-nums'],
  },
  scoreHeroUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6E7681',
    marginLeft: 6,
    marginBottom: 12,
  },
  scorePill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 8,
  },
  scorePillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0D1117',
    letterSpacing: 0.2,
  },
  scoreMessage: {
    fontSize: 14,
    color: '#C9D1D9',
    marginBottom: 16,
  },
  scoreProgressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#21262D',
    overflow: 'hidden',
    marginBottom: 16,
  },
  scoreProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  scoreStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#21262D',
  },
  scoreStat: {
    flex: 1,
    alignItems: 'center',
  },
  scoreStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  scoreStatLabel: {
    fontSize: 11,
    color: '#8B949E',
    marginTop: 3,
  },
  scoreStatDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#21262D',
  },

  // 무호흡 분석 카드
  apneaCard: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    marginBottom: 20,
    overflow: 'hidden',
  },
  apneaAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  apneaHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8B949E',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  apneaHeroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  apneaHero: {
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 60,
    fontVariant: ['tabular-nums'],
  },
  apneaHeroUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6E7681',
    marginLeft: 8,
  },
  apneaPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 12,
  },
  apneaPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0D1117',
    letterSpacing: 0.3,
  },
  apneaRecBox: {
    backgroundColor: '#0D1117',
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  apneaRecText: {
    fontSize: 13,
    color: '#C9D1D9',
    lineHeight: 19,
  },
  apneaStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#21262D',
  },
  apneaStat: {
    flex: 1,
    alignItems: 'center',
  },
  apneaStatValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  apneaStatLabel: {
    fontSize: 11,
    color: '#8B949E',
    marginTop: 3,
  },
  apneaStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#21262D',
  },

  // 섹션
  section: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#C9D1D9',
    marginBottom: 14,
  },

  // 수면 단계 비율 — donut
  donutLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  donutCenterValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  donutCenterLabel: {
    fontSize: 11,
    color: '#8B949E',
    marginTop: 2,
    letterSpacing: 0.4,
  },
  donutLegend: {
    flex: 1,
    marginLeft: 18,
    gap: 14,
  },
  donutLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  donutLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  donutLegendText: {
    flex: 1,
  },
  donutLegendLabel: {
    fontSize: 13,
    color: '#C9D1D9',
    fontWeight: '600',
  },
  donutLegendMins: {
    fontSize: 11,
    color: '#8B949E',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  donutLegendPercent: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    fontVariant: ['tabular-nums'],
    width: 80,
    textAlign: 'right',
  },

  // 하이프노그램 (계단형)
  hyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  hyRowLabel: {
    width: 42,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
    marginRight: 8,
  },
  hyRowTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 28,
    backgroundColor: '#0D1117',
    borderRadius: 4,
    overflow: 'hidden',
  },
  hyBlock: {
    flex: 1,
  },
  hyXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 50,
    marginTop: 6,
  },
  hyXLabel: {
    fontSize: 10,
    color: '#484F58',
    fontVariant: ['tabular-nums'],
  },

  // 세션 정보
  sessionInfo: {
    alignItems: 'center',
    marginTop: 4,
  },
  sessionText: {
    fontSize: 11,
    color: '#30363D',
    fontFamily: 'monospace',
  },

  // 초기화 버튼
  resetBtn: {
    backgroundColor: '#21262D',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  resetBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8B949E',
  },

  // 모드 토글 (현재 / 기록)
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 7,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: '#1F6FEB',
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B949E',
  },
  modeBtnTextActive: {
    color: '#FFFFFF',
  },

  // Spark bars (점수 추세)
  sparkCard: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  sparkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sparkTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#C9D1D9',
  },
  sparkStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sparkAvg: {
    fontSize: 12,
    color: '#8B949E',
    fontWeight: '600',
    marginRight: 10,
  },
  sparkTrend: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sparkBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 56,
    gap: 6,
  },
  sparkColumn: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  sparkBar: {
    width: '100%',
    borderRadius: 4,
    minHeight: 4,
  },

  // 기록 안내 텍스트
  historyHint: {
    fontSize: 12,
    color: '#6E7681',
    marginBottom: 10,
    textAlign: 'center',
  },

  // 기록 카드 micro stats
  historyMicroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  historyMicroKey: {
    fontSize: 10,
    color: '#6E7681',
    fontWeight: '700',
    letterSpacing: 0.3,
    marginRight: 3,
  },
  historyMicroVal: {
    fontSize: 11,
    color: '#C9D1D9',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  historyMicroDot: {
    fontSize: 11,
    color: '#30363D',
    marginHorizontal: 6,
  },

  // 기록 카드
  historyCard: {
    flexDirection: 'row',
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  historyCardLeft: {
    flex: 1,
  },
  historyDate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  historyTime: {
    fontSize: 12,
    color: '#8B949E',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  historyDuration: {
    fontSize: 12,
    color: '#58A6FF',
    marginTop: 4,
    fontWeight: '600',
  },
  historyScore: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    backgroundColor: '#0D1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyScoreNum: {
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  historyScoreLabel: {
    fontSize: 9,
    marginTop: -2,
  },

  // 기록 보기 중 뱃지
  historyViewBadge: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
    alignItems: 'center',
  },
  historyViewText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
  },

  // 임상 지표 격자
  metricsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  approxBadge: {
    fontSize: 10,
    color: '#D29922',
    fontWeight: '600',
    backgroundColor: 'rgba(210, 153, 34, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  metricsGrid3: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 10,
    padding: 12,
    alignItems: 'flex-start',
  },

  // SE 와이드 카드
  metricWide: {
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 12,
    padding: 14,
  },
  metricWideHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  metricWideLabel: {
    fontSize: 12,
    color: '#8B949E',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  metricWideValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  metricWideValue: {
    fontSize: 36,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricWideUnit: {
    fontSize: 16,
    color: '#8B949E',
    fontWeight: '600',
    marginLeft: 4,
  },
  metricGaugeTrack: {
    height: 6,
    backgroundColor: '#21262D',
    borderRadius: 3,
    overflow: 'hidden',
  },
  metricGaugeFill: {
    height: '100%',
    borderRadius: 3,
  },

  // 3열 컴팩트 카드
  metricCardSmall: {
    flex: 1,
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'flex-start',
  },
  metricLabelSmall: {
    fontSize: 10,
    color: '#8B949E',
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  metricValueSmall: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  metricUnitSmall: {
    fontSize: 10,
    color: '#8B949E',
    fontWeight: '600',
    marginLeft: 1,
  },
  metricBadgeSmall: {
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  metricLabel: {
    fontSize: 11,
    color: '#8B949E',
    fontWeight: '600',
    marginBottom: 6,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    fontSize: 12,
    color: '#8B949E',
    fontWeight: '600',
    marginLeft: 2,
  },
  metricBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  metricBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  metricsSummary: {
    marginTop: 14,
    alignItems: 'center',
  },
  metricsSummaryText: {
    fontSize: 12,
    color: '#8B949E',
    fontWeight: '600',
  },
});
