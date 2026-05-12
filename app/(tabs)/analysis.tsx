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
} from 'react-native';

import { useBLEContext } from '../../contexts/BLEContext';
import {
  fetchSleepResult,
  SleepResultResponse,
  SleepStages,
} from '../../services/uploadService';

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

  const [result, setResult] = useState<SleepResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // 녹음 종료 후 자동으로 결과 조회
  useEffect(() => {
    if (!isRecording && lastSessionId) {
      loadResult(lastSessionId);
    }
  }, [isRecording, lastSessionId]);

  const loadResult = async (sessionId: string) => {
    setLoading(true);
    setError(null);

    const data = await fetchSleepResult(sessionId);
    if (data) {
      setResult(data);
    } else {
      setError('서버에서 수면 분석이 진행 중입니다.\n분석이 완료되면 아래 버튼을 눌러주세요.');
    }
    setLoading(false);
  };

  const handleRetry = () => {
    if (lastSessionId) {
      loadResult(lastSessionId);
    }
  };

  // 목업 데이터로 미리보기 (2-class: SLEEP/WAKE)
  const loadMockData = () => {
    setResult({
      session_id: 'MOCK_PREVIEW',
      total_sleep_minutes: 420,
      sleep_start: '2026-03-12T23:15',
      sleep_end: '2026-03-13T06:15',
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
    });
  };

  // ── 녹음 중 화면 ──
  if (isRecording) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        <Animated.View style={[styles.liveBanner, { opacity: pulseAnim }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>데이터 수집 중... 녹음을 종료하면 분석이 시작됩니다</Text>
        </Animated.View>
      </ScrollView>
    );
  }

  // ── 녹음 전 (한 번도 녹음하지 않은 상태) ──
  if (!lastSessionId && !result) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
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

  // ── 로딩 중 화면 ──
  if (loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color="#58A6FF" />
          <Text style={styles.loadingText}>서버에서 분석 결과를 가져오는 중...</Text>
        </View>
      </ScrollView>
    );
  }

  // ── 에러 / 결과 없음 화면 ──
  if (!result) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
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

  // ── 결과 표시 화면 ──
  if (!result.stages || !result.total_sleep_minutes) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>수면 분석</Text>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>분석 결과 형식이 올바르지 않습니다</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setResult(null)}>
            <Text style={styles.retryBtnText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  const score = calculateScore(result.stages, result.total_sleep_minutes);
  const grade = getScoreGrade(score);
  const { stages, timeline, total_sleep_minutes } = result;

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 헤더 */}
      <Text style={styles.title}>수면 분석</Text>

      {/* 수면 시간 요약 */}
      <View style={styles.timeBanner}>
        <Text style={styles.timeLabel}>
          {result.sleep_start.split('T')[1]} ~ {result.sleep_end.split('T')[1]}
        </Text>
        <Text style={styles.timeSub}>총 수면 {formatMinutes(total_sleep_minutes)}</Text>
      </View>

      {/* 수면 점수 카드 */}
      <View style={styles.scoreCard}>
        <View style={[styles.scoreCircle, { borderColor: grade.color }]}>
          <Text style={[styles.scoreNum, { color: grade.color }]}>{score}</Text>
          <Text style={[styles.scoreLabel, { color: grade.color }]}>점</Text>
        </View>
        <View style={styles.scoreInfo}>
          <Text style={styles.scoreTitle}>수면 품질</Text>
          <Text style={[styles.scoreDesc, { color: grade.color }]}>{grade.message}</Text>
          <Text style={styles.scoreSub}>{grade.label}</Text>
        </View>
      </View>

      {/* 수면 단계 비율 (2-class: SLEEP/WAKE) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>수면 단계 비율</Text>
        <View style={styles.stageBar}>
          <View style={[styles.stageSegment, { flex: stages.nrem_minutes + stages.rem_minutes, backgroundColor: SLEEP_STAGES.SLEEP.color }]} />
          <View style={[styles.stageSegment, { flex: stages.wake_minutes || 0.1, backgroundColor: SLEEP_STAGES.WAKE.color }]} />
        </View>
        <View style={styles.stageLegend}>
          {([
            { key: 'SLEEP' as StageKey, minutes: stages.nrem_minutes + stages.rem_minutes },
            { key: 'WAKE'  as StageKey, minutes: stages.wake_minutes },
          ]).map(({ key, minutes }) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: SLEEP_STAGES[key].color }]} />
              <Text style={styles.legendLabel}>{SLEEP_STAGES[key].label}</Text>
              <Text style={styles.legendPercent}>
                {Math.round((minutes / total_sleep_minutes) * 100)}%
              </Text>
              <Text style={styles.legendValue}>{formatMinutes(minutes)}</Text>
            </View>
          ))}
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
                // timeline의 stage는 'NREM' | 'REM' | 'WAKE'
                // SLEEP 행은 NREM/REM 둘 다 매칭, WAKE 행은 WAKE만 매칭
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
        <Text style={styles.sessionText}>세션: {result.session_id}</Text>
      </View>

      {/* 초기화 버튼 */}
      <TouchableOpacity style={styles.resetBtn} onPress={() => setResult(null)}>
        <Text style={styles.resetBtnText}>돌아가기</Text>
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

  // 수면 점수
  scoreCard: {
    flexDirection: 'row',
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  scoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#0D1117',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
  },
  scoreNum: {
    fontSize: 28,
    fontWeight: '800',
  },
  scoreLabel: {
    fontSize: 11,
    marginTop: -2,
  },
  scoreInfo: {
    flex: 1,
  },
  scoreTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scoreDesc: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600',
  },
  scoreSub: {
    fontSize: 12,
    color: '#8B949E',
    marginTop: 4,
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

  // 수면 단계 비율 바
  stageBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 14,
  },
  stageSegment: {
    height: '100%',
  },
  stageLegend: {
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  legendLabel: {
    fontSize: 13,
    color: '#C9D1D9',
    flex: 1,
  },
  legendPercent: {
    fontSize: 13,
    color: '#C9D1D9',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginRight: 12,
    width: 36,
    textAlign: 'right',
  },
  legendValue: {
    fontSize: 13,
    color: '#8B949E',
    fontWeight: '600',
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
});
