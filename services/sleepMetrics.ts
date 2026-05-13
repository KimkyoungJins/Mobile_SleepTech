/**
 * 임상 수준 수면 지표 계산 (Wake/Sleep 2-class 기반)
 *
 * 백엔드 응답의 `epoch_sequence`(30초 단위 stage 배열)를 입력으로 받아
 * 표준 sleep medicine 지표(TST, TIB, SE, SOL, WASO, awakenings,
 * fragmentation index, longest continuous sleep)와 종합 점수를 산출한다.
 *
 * `epoch_sequence`가 없는 응답(구버전 / 일부 partial)은 `timeline`(15분 다수결)
 * 기반 근사값으로 폴백한다 — 정밀도가 떨어지며 `approximated: true`로 표시된다.
 */

import { SleepResultResponse, TimelineEntry } from './uploadService';

/** SLEEP으로 간주할 epoch stage (백엔드는 NREM만 내보내지만 REM도 sleep) */
const SLEEP_STAGES = new Set<string>(['NREM', 'REM', 'SLEEP']);

export interface SleepMetrics {
  /** 총 수면 시간 (분, TST) */
  tst_minutes: number;
  /** 침대에 있던 시간 (분, TIB) */
  tib_minutes: number;
  /** 수면 효율 (%, SE = TST/TIB × 100) */
  sleep_efficiency: number;
  /** 잠들기까지 (분, SOL = 처음 SLEEP까지의 WAKE 시간) */
  sol_minutes: number;
  /** 잠든 후 깬 시간 합 (분, WASO) */
  waso_minutes: number;
  /** 깬 횟수 (SLEEP→WAKE 전환) */
  awakenings: number;
  /** 수면 단편화 지수 (전환/시간) */
  fragmentation_index: number;
  /** 가장 긴 연속 수면 (분) */
  longest_sleep_minutes: number;
  /** 0~100 종합 점수 */
  quality_score: number;
  /** 점수 등급 + 메시지 */
  grade: { label: string; color: string; message: string };
  /** epoch_sequence 없이 timeline으로 근사한 경우 true */
  approximated: boolean;
  /** 사용된 epoch 길이 (초) — 없으면 30 가정 */
  epoch_sec: number;
}

/** 한 줄 짜리 시퀀스 → SLEEP 여부 boolean[]로 정규화 */
const toSleepFlags = (sequence: string[]): boolean[] =>
  sequence.map((s) => SLEEP_STAGES.has(s));

/**
 * 점수 등급 (calculateScore 결과 → label/color/message)
 */
const getGrade = (score: number) => {
  if (score >= 85) return { label: '매우 좋음', color: '#7EE787', message: '푹 잤어요!' };
  if (score >= 70) return { label: '좋음',      color: '#58A6FF', message: '양호한 수면이에요' };
  if (score >= 50) return { label: '보통',      color: '#D29922', message: '조금 아쉬운 수면이에요' };
  return                    { label: '나쁨',    color: '#FF6B6B', message: '수면 개선이 필요해요' };
};

/**
 * Wake/Sleep epoch 시퀀스 → 모든 임상 지표
 */
const computeFromSequence = (sequence: string[], epochSec: number): Omit<SleepMetrics, 'approximated' | 'epoch_sec' | 'quality_score' | 'grade'> => {
  const flags = toSleepFlags(sequence);
  const n = flags.length;

  if (n === 0) {
    return {
      tst_minutes: 0,
      tib_minutes: 0,
      sleep_efficiency: 0,
      sol_minutes: 0,
      waso_minutes: 0,
      awakenings: 0,
      fragmentation_index: 0,
      longest_sleep_minutes: 0,
    };
  }

  const epochMin = epochSec / 60;
  const tib_minutes = n * epochMin;

  // TST: SLEEP epoch 수
  const sleepEpochs = flags.filter((f) => f).length;
  const tst_minutes = sleepEpochs * epochMin;

  // Sleep efficiency
  const sleep_efficiency = tib_minutes > 0 ? (tst_minutes / tib_minutes) * 100 : 0;

  // SOL: 첫 SLEEP epoch까지의 WAKE epoch 수
  const firstSleepIdx = flags.findIndex((f) => f);
  const sol_minutes = firstSleepIdx < 0 ? tib_minutes : firstSleepIdx * epochMin;

  // WASO: 첫 SLEEP 이후 마지막 SLEEP까지의 WAKE epoch 수
  // (sleep onset 이전과 final wake는 제외 — 표준 정의)
  let waso_minutes = 0;
  let awakenings = 0;
  if (firstSleepIdx >= 0) {
    // 마지막 SLEEP 위치
    let lastSleepIdx = firstSleepIdx;
    for (let i = n - 1; i > firstSleepIdx; i--) {
      if (flags[i]) {
        lastSleepIdx = i;
        break;
      }
    }
    // [firstSleepIdx, lastSleepIdx] 범위 안의 WAKE
    let inWakeBlock = false;
    for (let i = firstSleepIdx; i <= lastSleepIdx; i++) {
      if (!flags[i]) {
        waso_minutes += epochMin;
        if (!inWakeBlock) {
          // SLEEP → WAKE 전환 진입
          awakenings += 1;
          inWakeBlock = true;
        }
      } else {
        inWakeBlock = false;
      }
    }
  }

  // Fragmentation index: (SLEEP↔WAKE 전환 횟수) / TST(hours)
  let transitions = 0;
  for (let i = 1; i < n; i++) {
    if (flags[i] !== flags[i - 1]) transitions += 1;
  }
  const tstHours = tst_minutes / 60;
  const fragmentation_index = tstHours > 0 ? transitions / tstHours : 0;

  // 가장 긴 연속 SLEEP 구간
  let longestSleepEpochs = 0;
  let currentRun = 0;
  for (const f of flags) {
    if (f) {
      currentRun += 1;
      if (currentRun > longestSleepEpochs) longestSleepEpochs = currentRun;
    } else {
      currentRun = 0;
    }
  }
  const longest_sleep_minutes = longestSleepEpochs * epochMin;

  return {
    tst_minutes,
    tib_minutes,
    sleep_efficiency,
    sol_minutes,
    waso_minutes,
    awakenings,
    fragmentation_index,
    longest_sleep_minutes,
  };
};

/**
 * Sleep quality score (0~100) — SE/WASO/SOL/awakenings/TST 가중
 * (사용자가 제시한 임상 가중 알고리즘과 동일)
 */
const calculateQualityScore = (m: {
  tst_minutes: number;
  sleep_efficiency: number;
  sol_minutes: number;
  waso_minutes: number;
  awakenings: number;
}): number => {
  let score = 0;

  // Sleep efficiency (40%)
  if (m.sleep_efficiency >= 90)      score += 40;
  else if (m.sleep_efficiency >= 85) score += 35;
  else if (m.sleep_efficiency >= 80) score += 28;
  else if (m.sleep_efficiency >= 75) score += 20;
  else                                score += 10;

  // WASO (20%)
  if (m.waso_minutes < 20)      score += 20;
  else if (m.waso_minutes < 45) score += 12;
  else                          score += 5;

  // SOL (15%)
  if (m.sol_minutes < 15)      score += 15;
  else if (m.sol_minutes < 30) score += 10;
  else                         score += 4;

  // Awakenings (15%)
  if (m.awakenings <= 2)      score += 15;
  else if (m.awakenings <= 4) score += 8;
  else                        score += 3;

  // TST (10%)
  const tstHours = m.tst_minutes / 60;
  if (tstHours >= 7 && tstHours <= 9)        score += 10;
  else if (tstHours >= 6 && tstHours < 7)    score += 7;
  else                                       score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
};

/**
 * timeline(15분 다수결) → 근사 sequence
 * 각 timeline entry를 (보통 30개) 같은 stage epoch로 반복 확장한다.
 * 정밀도는 떨어지지만 SE/TST 같은 큰 지표는 비슷한 결과가 나온다.
 */
const approximateSequenceFromTimeline = (
  timeline: TimelineEntry[],
  totalSleepMinutes: number,
): string[] => {
  if (timeline.length === 0) return [];
  // timeline 항목 하나가 대표하는 분 = total / count
  const minutesPerEntry = totalSleepMinutes / timeline.length;
  const epochsPerEntry = Math.max(1, Math.round((minutesPerEntry * 60) / 30));
  const sequence: string[] = [];
  for (const entry of timeline) {
    const stage = entry.stage === 'WAKE' ? 'WAKE' : 'NREM';
    for (let i = 0; i < epochsPerEntry; i++) sequence.push(stage);
  }
  return sequence;
};

/**
 * 결과 객체 → 임상 지표 + 종합 점수 + 등급
 */
export const computeSleepMetrics = (result: SleepResultResponse): SleepMetrics => {
  const epochSec = result.epoch_sec ?? 30;
  let sequence: string[];
  let approximated: boolean;

  if (Array.isArray(result.epoch_sequence) && result.epoch_sequence.length > 0) {
    sequence = result.epoch_sequence;
    approximated = false;
  } else {
    sequence = approximateSequenceFromTimeline(result.timeline, result.total_sleep_minutes);
    approximated = true;
  }

  const core = computeFromSequence(sequence, epochSec);
  const quality_score = calculateQualityScore({
    tst_minutes: core.tst_minutes,
    sleep_efficiency: core.sleep_efficiency,
    sol_minutes: core.sol_minutes,
    waso_minutes: core.waso_minutes,
    awakenings: core.awakenings,
  });
  const grade = getGrade(quality_score);

  return {
    ...core,
    quality_score,
    grade,
    approximated,
    epoch_sec: epochSec,
  };
};

/**
 * 지표별 정상 범위 판정 (UI 배지/색상용)
 */
export const assessMetric = (
  key: 'sleep_efficiency' | 'sol_minutes' | 'waso_minutes' | 'awakenings' | 'fragmentation_index',
  value: number,
): { label: string; color: string } => {
  switch (key) {
    case 'sleep_efficiency':
      if (value >= 85) return { label: '정상', color: '#7EE787' };
      if (value >= 75) return { label: '경계', color: '#D29922' };
      return { label: '저효율', color: '#FF6B6B' };
    case 'sol_minutes':
      if (value < 20) return { label: '정상', color: '#7EE787' };
      if (value < 30) return { label: '주의', color: '#D29922' };
      return { label: '불면 의심', color: '#FF6B6B' };
    case 'waso_minutes':
      if (value < 30) return { label: '정상', color: '#7EE787' };
      if (value < 45) return { label: '경계', color: '#D29922' };
      return { label: '단편화', color: '#FF6B6B' };
    case 'awakenings':
      if (value <= 2) return { label: '정상', color: '#7EE787' };
      if (value <= 4) return { label: '경계', color: '#D29922' };
      return { label: '주의', color: '#FF6B6B' };
    case 'fragmentation_index':
      if (value < 10) return { label: '정상', color: '#7EE787' };
      if (value < 15) return { label: '경계', color: '#D29922' };
      return { label: '단편화', color: '#FF6B6B' };
  }
};
