/**
 * 디자인 토큰 — 색·간격·radius 단일 진실 공급원.
 *
 * 신규 UI 코드는 인라인 hex(#161B22 등) 대신 여기서 import해서 쓴다.
 * 기존 파일은 점진적으로 교체 (한 번에 안 바꿈 — diff 최소화).
 *
 * 라이트 모드/리브랜딩 시에는 colors만 갈아끼우면 된다.
 */

export const colors = {
  // 배경 위계
  bg: '#0D1117',          // 화면 배경 (가장 어두움)
  surface: '#161B22',     // 카드 배경
  surfaceAlt: '#0D1117',  // 카드 안의 카드(이중 nesting)
  border: '#21262D',      // 카드 테두리 / 구분선
  borderStrong: '#30363D',// 더 두드러진 구분선

  // 텍스트 위계
  text: '#FFFFFF',         // primary
  textSecondary: '#C9D1D9',// 본문
  textMuted: '#8B949E',    // 보조 라벨
  textDim: '#6E7681',      // 매우 흐릿한 텍스트

  // 액션
  primary: '#58A6FF',      // 기본 액션 (파란)
  recordRest: '#B83A35',   // 야간 친화 녹화 색 (idle/disconnected)
  connected: '#2A9F47',    // 연결됨

  // 등급/상태 (sleep medicine 임상 등급)
  good: '#7EE787',         // 정상/좋음
  okay: '#58A6FF',         // 양호
  warn: '#D29922',         // 경계/주의
  bad: '#FF6B6B',          // 비정상

  // 수면 단계
  sleep: '#8B5CF6',        // SLEEP/NREM
  wake: '#FF6B6B',         // WAKE
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const fontSizes = {
  micro: 10,
  caption: 11,
  small: 12,
  body: 13,
  bodyLg: 14,
  h3: 15,
  h2: 18,
  h1: 22,
  hero: 36,
  display: 72,
} as const;

export type ColorToken = keyof typeof colors;
