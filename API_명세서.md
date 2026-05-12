# API 명세서

> BLE 수면 데이터 레코더 — 모바일 ↔ 서버 통신 규격
> 최종 수정: 2026-03-13

---

## 서버 정보

| 항목 | 값 |
|------|-----|
| Base URL | `http://52.64.123.5:8000` |
| 프로토콜 | HTTP (REST) |
| 인코딩 | UTF-8 |
| 데이터 형식 | 요청: `multipart/form-data` / 응답: `application/json` |

---

## 세션 ID 규칙

모든 API에서 세션 식별에 사용되는 고유 키이다.

| 항목 | 설명 |
|------|------|
| 형식 | `YYYYMMDD_HHmmss` |
| 생성 시점 | 기록 시작 시 모바일에서 생성 |
| 예시 | `20260312_231500` |

---

## API 목록

| # | 메서드 | 엔드포인트 | 설명 | 호출 시점 | 모바일 구현 |
|---|--------|------------|------|-----------|-------------|
| 1 | POST | `/upload` | 오디오 청크 업로드 | 기록 중 30초 분량 데이터 축적 시 | 완료 |
| 2 | POST | `/finish` | 녹음 종료 및 WAV 변환 요청 | 기록 중지 시 | 완료 |
| 3 | GET | `/api/result/{session_id}` | 수면 분석 결과 조회 | 사용자가 분석 요청 시 | 완료 |

---

## 1. 오디오 청크 업로드

기록 중 30초 분량(960,000 bytes)의 오디오 데이터가 축적되면 서버로 전송한다.
백그라운드 서비스에서 5초 주기로 데이터 축적량을 확인하며, 기준에 도달 시 자동 호출된다.

### 요청

```
POST /upload
Content-Type: multipart/form-data
```

| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|----------|------|------|------|------|
| `file` | binary | O | 오디오 바이너리 데이터 (PCM raw) | `20260312_231500.bin` |
| `session_id` | string | O | 세션 식별자 | `20260312_231500` |
| `chunk_index` | string | O | 청크 순서 번호 (0부터 시작, 업로드 성공 시 +1) | `0`, `1`, `2` |
| `noise_level` | string | O | 노이즈 필터 강도 (0.0 ~ 1.0) | `0.8` |
| `filter_option` | string | O | 필터 적용 여부 | `true` |

#### 오디오 데이터 사양

| 항목 | 값 |
|------|-----|
| 샘플레이트 | 16,000 Hz |
| 비트 깊이 | 16 bit |
| 채널 | 모노 (1ch) |
| 30초 분량 크기 | 960,000 bytes (16000 × 2 × 1 × 30) |
| 전송 인코딩 | Base64 → binary (FormData에 `data:application/octet-stream;base64,...` URI로 첨부) |

#### 업로드 로직

```
1. 로컬 파일({session_id}.raw)에서 마지막 전송 위치(lastSentOffset) 이후의 새 데이터를 읽음
2. 새 데이터가 960,000 bytes 이상이면 업로드 시작
3. Base64로 읽어 FormData에 첨부하여 전송
4. 성공 시 lastSentOffset을 현재 파일 크기로 갱신, chunkIndex +1
5. 실패 시 5초 후 1회 재시도
```

### 응답

#### 성공 (200)

```json
{
  "status": "success",
  "message": "Upload successful"
}
```

#### 실패 (4xx / 5xx)

```json
{
  "status": "error",
  "message": "에러 원인 설명"
}
```

---

## 2. 녹음 종료 및 WAV 변환

기록을 중지할 때 서버에 세션 종료를 알리고, 서버는 수신한 .bin 청크들을 하나의 .wav 파일로 변환한다.

### 요청

```
POST /finish
Content-Type: multipart/form-data
```

| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|----------|------|------|------|------|
| `session_id` | string | O | 종료할 세션 식별자 | `20260312_231500` |

### 응답

#### 성공 (200)

```json
{
  "status": "success",
  "filename": "20260312_231500.wav",
  "message": "녹음 길이: 7시간 15분"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `status` | string | `"success"` |
| `filename` | string | 변환된 WAV 파일명 |
| `message` | string | 녹음 길이 등 부가 정보 |

#### 실패 (4xx / 5xx)

```json
{
  "status": "error",
  "message": "에러 원인 설명"
}
```

---

## 3. 수면 분석 결과 조회

서버의 딥러닝 모델이 WAV 파일을 분석한 결과를 조회한다. 모바일에서 이 데이터를 기반으로 수면 점수 계산 및 시각화를 수행한다.

수면 단계는 **NREM, REM, WAKE** 3단계로 분류한다.

### 요청

```
GET /api/result/{session_id}
```

| 파라미터 | 위치 | 타입 | 필수 | 설명 | 예시 |
|----------|------|------|------|------|------|
| `session_id` | path | string | O | 분석 대상 세션 식별자 | `20260312_231500` |

### 응답

#### 성공 (200)

```json
{
  "session_id": "20260312_231500",
  "total_sleep_minutes": 420,
  "sleep_start": "2026-03-12T23:15",
  "sleep_end": "2026-03-13T07:15",
  "stages": {
    "nrem_minutes": 270,
    "rem_minutes": 105,
    "wake_minutes": 45
  },
  "timeline": [
    { "time": "23:15", "stage": "NREM" },
    { "time": "23:30", "stage": "NREM" },
    { "time": "23:45", "stage": "REM" },
    { "time": "00:00", "stage": "NREM" },
    { "time": "00:15", "stage": "WAKE" }
  ]
}
```

#### 응답 필드 상세

| 필드 | 타입 | 단위 | 설명 |
|------|------|------|------|
| `session_id` | string | - | 세션 식별자 (YYYYMMDD_HHmmss) |
| `total_sleep_minutes` | number | 분 | 전체 수면 시간 |
| `sleep_start` | string | ISO 8601 | 취침 시각 |
| `sleep_end` | string | ISO 8601 | 기상 시각 |
| `stages.nrem_minutes` | number | 분 | NREM 수면 시간 (N1+N2+N3) |
| `stages.rem_minutes` | number | 분 | REM 수면 시간 |
| `stages.wake_minutes` | number | 분 | 중간 각성 시간 |
| `timeline` | array | - | 15분 간격 수면 단계 배열 (하이프노그램용) |
| `timeline[].time` | string | HH:mm | 해당 구간의 시작 시각 |
| `timeline[].stage` | string | - | 수면 단계 (`NREM`, `REM`, `WAKE`) |

#### 수면 단계(stage) 값 정의

| 값 | 설명 | 대응 수면 단계 |
|----|------|----------------|
| `NREM` | 비렘 수면 | NREM (N1+N2+N3) |
| `REM` | 렘 수면 | REM |
| `WAKE` | 각성 | 중간에 깬 상태 |

#### 분석 미완료 (202 또는 404)

```json
{
  "status": "pending",
  "message": "분석이 아직 완료되지 않았습니다."
}
```

#### 실패 (4xx / 5xx)

```json
{
  "status": "error",
  "message": "에러 원인 설명"
}
```

---

## 전체 데이터 흐름

```
┌─────────────────────────────────────────────────────────────────────┐
│                      기록 단계 (Recording)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  BLE 디바이스 ──(Nordic UART)──→ 모바일 앱                           │
│                                    │                                │
│                    Base64 디코딩 → 버퍼에 저장                       │
│                                    │                                │
│                    5초마다 버퍼 → 로컬 파일({session_id}.raw) 저장    │
│                                    │                                │
│                    30초 분량(960KB) 축적 시                          │
│                                    │                                │
│                          POST /upload  ──→  서버                    │
│                     (chunk_index 순서대로)      │                    │
│                                                 │                    │
│                                          .bin 청크 저장              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        종료 단계 (Finish)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  사용자가 기록 중지                                                  │
│        │                                                            │
│  남은 버퍼 flush + 마지막 청크 업로드                                │
│        │                                                            │
│  POST /finish  ──→  서버                                            │
│                       │                                             │
│                .bin 청크 병합 → .wav 변환                             │
│                       │                                             │
│                딥러닝 수면 단계 분석 시작 (NREM / REM / WAKE)         │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                      분석 결과 조회 (Result)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  사용자가 수면 분석 탭에서 조회                                      │
│        │                                                            │
│  GET /api/result/{session_id}  ──→  서버                            │
│                                       │                             │
│          ←── 수면 단계, 시간, 타임라인 응답                           │
│        │                                                            │
│  모바일에서 수면 점수 계산 (클라이언트 연산)                           │
│  모바일에서 계단형 하이프노그램 / 비율바 렌더링                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 모바일 클라이언트 연산: 수면 품질 점수

서버 응답의 `stages` 데이터를 기반으로 모바일에서 계산한다. 서버에 점수 계산을 요청하지 않는다.

### 점수 산출 공식 (100점 만점)

```typescript
const calculateScore = (stages: SleepStages, totalMinutes: number): number => {
  const nremRatio = stages.nrem_minutes / totalMinutes;
  const remRatio  = stages.rem_minutes  / totalMinutes;
  const wakeRatio = stages.wake_minutes / totalMinutes;

  let score = 50; // 기본 점수

  // NREM 수면 비율 (이상적: 70~80%)
  if (nremRatio >= 0.70 && nremRatio <= 0.80) score += 20;
  else if (nremRatio >= 0.60)                 score += 10;

  // REM 수면 비율 (이상적: 20~25%)
  if (remRatio >= 0.20 && remRatio <= 0.25) score += 20;
  else if (remRatio >= 0.15)                score += 10;

  // 총 수면시간 보너스 (7~9시간)
  if (totalMinutes >= 420 && totalMinutes <= 540) score += 10;

  // 중간 각성 패널티
  score -= Math.round(wakeRatio * 40);

  return Math.max(0, Math.min(100, score));
};
```

### 점수 기준 근거

| 항목 | 이상적 범위 | 배점 | 근거 |
|------|-------------|------|------|
| NREM 수면 비율 | 70~80% | +20점 | 정상 성인 NREM 비율 (N1+N2+N3), 신체 회복 구간 |
| REM 수면 비율 | 20~25% | +20점 | 수면의학 표준 REM 비율, 기억 공고화·감정 처리 기능 |
| 총 수면 시간 | 7~9시간 (420~540분) | +10점 | NSF/CDC 성인 권장 수면시간 |
| 중간 각성 | 낮을수록 좋음 | 최대 -40점 | 수면 분절이 수면 질 저하의 주요 지표 |

### 점수별 등급

| 점수 | 등급 | 색상 | UI 문구 |
|------|------|------|---------|
| 85~100 | 매우 좋음 | `#7EE787` (초록) | "푹 잤어요!" |
| 70~84 | 좋음 | `#58A6FF` (파랑) | "양호한 수면이에요" |
| 50~69 | 보통 | `#D29922` (노랑) | "조금 아쉬운 수면이에요" |
| 0~49 | 나쁨 | `#FF6B6B` (빨강) | "수면 개선이 필요해요" |

---

## 모바일 시각화

### 수면 단계 비율 바

가로 막대에 각 수면 단계를 비율대로 표시한다.

| 단계 | 색상 | 의미 |
|------|------|------|
| NREM | `#8B5CF6` (보라) | 비렘 수면 (N1+N2+N3) |
| REM | `#58A6FF` (파랑) | 렘 수면, 기억 강화 |
| WAKE | `#FF6B6B` (빨강) | 중간에 깬 시간 |

### 수면 단계 타임라인 (계단형 하이프노그램)

3개 행(WAKE / REM / NREM)에 각 시간대의 해당 단계를 색상 블록으로 표시한다.

```
WAKE  |        ██                    ██
REM   |  ████      ████        ████
NREM  |██    ██████    ████████
      └──────────────────────────────────
       23:00  00:00  01:00  02:00  03:00
```

- X축: 시간 (15분 간격)
- Y축: 수면 단계 (NREM / REM / WAKE)
- 각 행에서 해당 단계인 시간대만 색상 블록으로 채워짐

---

## 에러 처리 정책

### 모바일 → 서버 (업로드)

| 상황 | 처리 |
|------|------|
| 서버 연결 실패 | 5초 후 1회 재시도, 이후 다음 주기에 재시도 |
| 업로드 실패 (서버 응답 에러) | 5초 후 1회 재시도 |
| 세션 ID 없음 | 업로드 스킵 |
| 새 데이터 없음 | 업로드 스킵 (성공 반환) |
| 로컬 파일 없음 | 업로드 스킵 |

### 모바일 ← 서버 (결과 조회)

| 상황 | 처리 |
|------|------|
| 분석 미완료 | 202 또는 404 응답, 모바일에서 "다시 시도" 버튼 제공 |
| 세션 ID 미존재 | 404 응답 |
| 서버 내부 에러 | 500 응답 |

---

## 부록: 타입 정의 (TypeScript)

```typescript
/** 업로드 응답 */
interface UploadResponse {
  status: 'success' | 'error';
  message?: string;
}

/** 세션 종료 응답 */
interface FinishResponse {
  status: 'success' | 'error';
  filename?: string;
  message?: string;
}

/** 수면 단계 시간 */
interface SleepStages {
  nrem_minutes: number;
  rem_minutes: number;
  wake_minutes: number;
}

/** 타임라인 항목 */
interface TimelineEntry {
  time: string;    // "HH:mm"
  stage: 'NREM' | 'REM' | 'WAKE';
}

/** 수면 분석 결과 응답 */
interface SleepResultResponse {
  session_id: string;
  total_sleep_minutes: number;
  sleep_start: string;   // ISO 8601
  sleep_end: string;     // ISO 8601
  stages: SleepStages;
  timeline: TimelineEntry[];
}

/** 분석 대기 응답 */
interface PendingResponse {
  status: 'pending';
  message: string;
}
```
