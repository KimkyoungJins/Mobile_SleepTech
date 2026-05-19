# BLE 수면 데이터 녹음 앱 (BLE Sleep Data Recorder)

## 한 줄 소개

블루투스(BLE) 센서 디바이스로 **수면 중 데이터를 밤새 녹음**하고, 서버 AI 분석을 통해 **수면 단계·무호흡·수면 품질 점수**를 보여주는 React Native / Expo 모바일 앱입니다.

## 무엇을 하는가

1. **녹음** — Nordic UART BLE 디바이스(`Nordic_UART_S`)에 연결해 수면 중 센서/오디오 데이터를 수집합니다.
2. **백그라운드 유지** — 앱이 최소화되어도 8시간 이상 끊김 없이 녹음하며, 연결이 끊기면 자동 재연결합니다.
3. **서버 업로드** — 30초마다 데이터 청크를 Azure 서버로 전송하고, 종료 시 WAV로 변환합니다.
4. **AI 분석** — 서버의 딥러닝 모델(PANNs ResNet22)이 수면/각성 구간과 무호흡(AHI)을 판정합니다.
5. **결과 제공** — 총 수면시간(TST), 수면효율(SE), 잠들기까지 걸린 시간(SOL), 각성 횟수, 수면 품질 점수(0~100) 등 임상 수준 지표를 시각화합니다.

## 화면 구성 (3개 탭)

| 탭 | 역할 |
|---|---|
| 🌙 **수면 기록** | 사용자용 메인 화면 — BLE 연결 → 녹음 시작/종료 플로우 |
| 📊 **수면 분석** | 서버 분석 결과 — 수면 단계 타임라인, 무호흡 분석, 품질 점수 |
| 🔧 **개발자 도구** | 로그 확인, 파일 관리, 서버 연결 테스트 등 디버그 기능 |

## 기술 스택

- **프레임워크:** Expo 54, React Native 0.81 (New Architecture), Expo Router (파일 기반 라우팅)
- **언어:** TypeScript
- **BLE 통신:** `react-native-ble-plx` (Nordic UART Service)
- **백그라운드 녹음:** `react-native-background-actions`
- **파일 저장:** `react-native-fs` — `Documents/data.raw`에 5초마다 배치 저장
- **서버:** Azure VM (Korea Central), `POST /upload` · `/finish` · `GET /api/result/{id}`

## 데이터 흐름

```
BLE 디바이스 ──(Base64 센서 데이터)──▶ 앱
   └─ 메모리 버퍼 → 5초마다 data.raw 저장
        └─ 30초마다 서버로 청크 업로드
             └─ 서버 AI 분석 (수면단계 + 무호흡)
                  └─ 앱이 결과 조회 → 임상 지표 계산 → 화면 표시
```

## 주요 특징

- **장시간 안정성:** 삼성 안드로이드 8시간 이상 녹음에 최적화, 배터리 최적화 해제 안내
- **HeadlessJS 호환:** 백그라운드 서비스가 React 컨텍스트 밖에서도 동작하도록 전역 상태 사용 (`services/fileStorage.ts`)
- **자동 재연결:** 녹음 중 연결 끊김 시 최대 10분간 재연결 시도
- **임상 지표 계산:** 서버의 30초 단위 epoch 시퀀스로 TST·SE·SOL·WASO·단편화 지수 등을 앱에서 직접 산출 (`services/sleepMetrics.ts`)
- **UI 언어:** 한국어

## 핵심 파일

| 파일 | 설명 |
|---|---|
| `hooks/useBLE.ts` | BLE 스캔·연결·모니터링·자동 재연결 핵심 로직 |
| `services/backgroundService.ts` | 백그라운드 플러시 루프 (5초 주기) |
| `services/fileStorage.ts` | 파일 버퍼 및 전역 상태 관리 |
| `services/uploadService.ts` | 서버 업로드 / 세션 종료 / 결과 조회 |
| `services/sleepMetrics.ts` | 임상 수준 수면 지표 계산 |
| `constants/ble.ts` | Nordic UART UUID 및 연결 파라미터 |

## 실행 방법

```bash
npm install        # 의존성 설치
npm start          # Expo 개발 서버 시작
npm run android    # 안드로이드 빌드/실행
npm run ios        # iOS 빌드/실행
```
