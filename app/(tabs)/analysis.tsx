/**
 * 실시간 수면 상태 분석 탭
 *
 * 서버에서 수면 분석 데이터를 받아 시각화
 * (현재는 목업 데이터, 추후 서버 연동 예정)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Animated,
} from 'react-native';

import { useBLEContext } from '../../contexts/BLEContext';

// 수면 단계 정의
const SLEEP_STAGES = {
  AWAKE: { label: '각성', color: '#FF6B6B', level: 4 },
  REM: { label: 'REM', color: '#58A6FF', level: 3 },
  LIGHT: { label: '얕은 수면', color: '#7EE787', level: 2 },
  DEEP: { label: '깊은 수면', color: '#8B5CF6', level: 1 },
} as const;

type StageKey = keyof typeof SLEEP_STAGES;

// 목업: 수면 단계 타임라인 데이터
const MOCK_TIMELINE: { time: string; stage: StageKey }[] = [
  { time: '23:00', stage: 'AWAKE' },
  { time: '23:15', stage: 'LIGHT' },
  { time: '23:30', stage: 'LIGHT' },
  { time: '23:45', stage: 'DEEP' },
  { time: '00:00', stage: 'DEEP' },
  { time: '00:15', stage: 'DEEP' },
  { time: '00:30', stage: 'LIGHT' },
  { time: '00:45', stage: 'REM' },
  { time: '01:00', stage: 'REM' },
  { time: '01:15', stage: 'LIGHT' },
  { time: '01:30', stage: 'DEEP' },
  { time: '01:45', stage: 'DEEP' },
  { time: '02:00', stage: 'DEEP' },
  { time: '02:15', stage: 'LIGHT' },
  { time: '02:30', stage: 'REM' },
  { time: '02:45', stage: 'REM' },
  { time: '03:00', stage: 'LIGHT' },
];

// 목업: 수면 통계
const MOCK_STATS = {
  score: 82,
  totalSleep: '4h 00m',
  deepSleep: '1h 30m',
  remSleep: '1h 00m',
  lightSleep: '1h 15m',
  awake: '15m',
};

export default function AnalysisScreen() {
  const { isRecording } = useBLEContext();
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // 녹음 중일 때 분석 중 애니메이션
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 헤더 */}
      <Text style={styles.title}>수면 분석</Text>

      {/* 현재 상태 배너 */}
      {isRecording ? (
        <Animated.View style={[styles.liveBanner, { opacity: pulseAnim }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>실시간 분석 중...</Text>
        </Animated.View>
      ) : (
        <View style={styles.offBanner}>
          <Text style={styles.offText}>녹음을 시작하면 실시간 분석이 시작됩니다</Text>
        </View>
      )}

      {/* 수면 점수 카드 */}
      <View style={styles.scoreCard}>
        <View style={styles.scoreCircle}>
          <Text style={styles.scoreNum}>{MOCK_STATS.score}</Text>
          <Text style={styles.scoreLabel}>점</Text>
        </View>
        <View style={styles.scoreInfo}>
          <Text style={styles.scoreTitle}>수면 품질</Text>
          <Text style={styles.scoreDesc}>
            {MOCK_STATS.score >= 80 ? '양호한 수면입니다' :
             MOCK_STATS.score >= 60 ? '보통 수준의 수면입니다' :
             '수면 개선이 필요합니다'}
          </Text>
          <Text style={styles.scoreSub}>총 수면: {MOCK_STATS.totalSleep}</Text>
        </View>
      </View>

      {/* 수면 단계 비율 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>수면 단계 비율</Text>
        <View style={styles.stageBar}>
          <View style={[styles.stageSegment, { flex: 3, backgroundColor: SLEEP_STAGES.DEEP.color }]} />
          <View style={[styles.stageSegment, { flex: 2.5, backgroundColor: SLEEP_STAGES.LIGHT.color }]} />
          <View style={[styles.stageSegment, { flex: 2, backgroundColor: SLEEP_STAGES.REM.color }]} />
          <View style={[styles.stageSegment, { flex: 0.5, backgroundColor: SLEEP_STAGES.AWAKE.color }]} />
        </View>
        <View style={styles.stageLegend}>
          {(Object.keys(SLEEP_STAGES) as StageKey[]).reverse().map((key) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: SLEEP_STAGES[key].color }]} />
              <Text style={styles.legendLabel}>{SLEEP_STAGES[key].label}</Text>
              <Text style={styles.legendValue}>
                {key === 'DEEP' ? MOCK_STATS.deepSleep :
                 key === 'LIGHT' ? MOCK_STATS.lightSleep :
                 key === 'REM' ? MOCK_STATS.remSleep :
                 MOCK_STATS.awake}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* 수면 단계 타임라인 (하이프노그램) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>수면 단계 타임라인</Text>
        <View style={styles.hypnogram}>
          {/* Y축 라벨 */}
          <View style={styles.yAxis}>
            <Text style={styles.yLabel}>각성</Text>
            <Text style={styles.yLabel}>REM</Text>
            <Text style={styles.yLabel}>얕은</Text>
            <Text style={styles.yLabel}>깊은</Text>
          </View>
          {/* 그래프 영역 */}
          <View style={styles.graphArea}>
            {/* 가로 그리드 라인 */}
            <View style={[styles.gridLine, { top: '0%' }]} />
            <View style={[styles.gridLine, { top: '33%' }]} />
            <View style={[styles.gridLine, { top: '66%' }]} />
            <View style={[styles.gridLine, { top: '100%' }]} />
            {/* 데이터 바 */}
            <View style={styles.barsContainer}>
              {MOCK_TIMELINE.map((item, index) => {
                const stage = SLEEP_STAGES[item.stage];
                const heightPercent = ((4 - stage.level + 1) / 4) * 100;
                return (
                  <View key={index} style={styles.barWrapper}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: `${heightPercent}%`,
                          backgroundColor: stage.color,
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
          </View>
        </View>
        {/* X축 시간 라벨 */}
        <View style={styles.xAxis}>
          <Text style={styles.xLabel}>23:00</Text>
          <Text style={styles.xLabel}>00:00</Text>
          <Text style={styles.xLabel}>01:00</Text>
          <Text style={styles.xLabel}>02:00</Text>
          <Text style={styles.xLabel}>03:00</Text>
        </View>
      </View>

      {/* 안내 문구 */}
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          * 현재 표시된 데이터는 예시입니다.{'\n'}
          서버 연동 후 실제 분석 결과가 표시됩니다.
        </Text>
      </View>
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
  },
  offBanner: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  offText: {
    fontSize: 13,
    color: '#484F58',
    textAlign: 'center',
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
    borderColor: '#58A6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
  },
  scoreNum: {
    fontSize: 28,
    fontWeight: '800',
    color: '#58A6FF',
  },
  scoreLabel: {
    fontSize: 11,
    color: '#58A6FF',
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
    fontSize: 13,
    color: '#7EE787',
    marginTop: 4,
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
  legendValue: {
    fontSize: 13,
    color: '#8B949E',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // 하이프노그램
  hypnogram: {
    flexDirection: 'row',
    height: 160,
  },
  yAxis: {
    width: 36,
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  yLabel: {
    fontSize: 9,
    color: '#484F58',
    textAlign: 'right',
  },
  graphArea: {
    flex: 1,
    marginLeft: 8,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#21262D',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barWrapper: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 2,
    minHeight: 4,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 44,
    marginTop: 6,
  },
  xLabel: {
    fontSize: 10,
    color: '#484F58',
  },

  // 안내
  notice: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#21262D',
    borderRadius: 12,
    padding: 14,
  },
  noticeText: {
    fontSize: 12,
    color: '#484F58',
    textAlign: 'center',
    lineHeight: 18,
  },
});
