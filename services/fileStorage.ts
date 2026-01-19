/**
 * =============================================================================
 * 파일 저장 시스템 (fileStorage.ts)
 * =============================================================================
 *
 * [개요]
 * BLE로 수신한 데이터를 파일에 저장하는 시스템입니다.
 * 백그라운드에서도 접근 가능하도록 전역 변수와 함수로 구성되어 있습니다.
 *
 * [왜 전역 변수를 사용하는가?]
 * - React의 useState/useRef는 컴포넌트 내부에서만 접근 가능
 * - 백그라운드 서비스(HeadlessJS)는 컴포넌트 외부에서 실행됨
 * - 따라서 백그라운드에서 버퍼에 접근하려면 전역 변수가 필요
 *
 * [데이터 흐름]
 * 1. BLE 데이터 수신 → globalAppendData()로 버퍼에 추가
 * 2. 백그라운드 서비스가 5초마다 globalFlushBuffer() 호출
 * 3. 버퍼의 데이터를 파일에 저장하고 버퍼 비움
 *
 * [버퍼링을 하는 이유]
 * - BLE 데이터는 초당 수십~수백 번 들어올 수 있음
 * - 매번 파일에 쓰면 I/O 오버헤드가 크고 배터리 소모 심함
 * - 버퍼에 모았다가 한 번에 쓰면 효율적 (배치 처리)
 *
 * =============================================================================
 */

import { fromByteArray, toByteArray } from 'base64-js';
// fromByteArray: Uint8Array(바이너리) → Base64 문자열로 인코딩
// toByteArray: Base64 문자열 → Uint8Array(바이너리)로 디코딩

import RNFS from 'react-native-fs';
// React Native 파일 시스템 라이브러리
// - RNFS.DocumentDirectoryPath: 앱 전용 문서 폴더 경로
// - RNFS.writeFile: 새 파일 생성
// - RNFS.appendFile: 기존 파일에 데이터 추가
// - RNFS.exists: 파일 존재 여부 확인

import { getTimestamp } from '../utils/helpers';

// =============================================================================
// 상수 정의
// =============================================================================

/**
 * 저장할 파일의 전체 경로
 *
 * 예시: /data/user/0/com.yourapp/files/data.raw
 *
 * DocumentDirectoryPath를 사용하는 이유:
 * - 앱 전용 공간이라 다른 앱이 접근 불가 (보안)
 * - 앱 삭제 시 자동으로 함께 삭제됨
 * - 별도 권한 요청 없이 읽기/쓰기 가능
 */
export const FILE_PATH = `${RNFS.DocumentDirectoryPath}/data.raw`;

/**
 * 버퍼를 파일에 저장하는 간격 (밀리초)
 *
 * 5000ms = 5초마다 버퍼 → 파일 저장
 *
 * 값이 너무 작으면: 파일 I/O가 자주 발생해 배터리 소모 증가
 * 값이 너무 크면: 앱 강제 종료 시 손실되는 데이터 양 증가
 */
export const FLUSH_INTERVAL = 5000;

// =============================================================================
// 전역 상태 변수
// =============================================================================

/**
 * 전역 쓰기 버퍼 (메모리에 임시 저장)
 *
 * [구조]
 * - Base64로 인코딩된 문자열들의 배열
 * - 예: ["SGVsbG8=", "V29ybGQ=", ...]
 *
 * [동작]
 * - BLE 데이터 수신 시 → push()로 추가
 * - 5초마다 → 전체를 파일에 쓰고 비움
 *
 * [왜 Base64인가?]
 * - BLE에서 받는 데이터가 이미 Base64로 인코딩되어 있음
 * - react-native-ble-plx가 characteristic.value를 Base64로 제공
 */
export let globalWriteBuffer: string[] = [];

/**
 * 파일 초기화 완료 여부
 *
 * [용도]
 * - 첫 번째 쓰기인지 판단하는 플래그
 *
 * [동작]
 * - false: 파일 존재 여부 확인 후 writeFile 또는 appendFile 선택
 * - true: 무조건 appendFile 사용 (파일이 이미 있음을 알고 있으므로)
 *
 * [최적화 효과]
 * - 매번 RNFS.exists() 호출하는 오버헤드 제거
 */
export let globalFileInitialized = false;

/**
 * 현재 녹음(저장) 중인지 여부
 *
 * [용도]
 * - 백그라운드 서비스에서 저장 여부 판단
 * - BLE 콜백에서 버퍼에 추가할지 판단
 *
 * [동작]
 * - true: 수신 데이터를 버퍼에 저장, 백그라운드에서 파일로 flush
 * - false: 수신 데이터 무시, 파일 저장 안 함
 */
export let globalIsRecording = false;

// =============================================================================
// 상태 변경 함수
// =============================================================================

/**
 * 녹음 상태 설정 함수
 *
 * [왜 setter 함수가 필요한가?]
 * - export let 변수는 외부에서 직접 수정 불가 (ES6 모듈 규칙)
 * - 값을 변경하려면 같은 모듈 내의 함수를 통해야 함
 *
 * @param value - true: 녹음 시작, false: 녹음 중지
 */
export const setGlobalIsRecording = (value: boolean) => {
  globalIsRecording = value;
};

// =============================================================================
// 데이터 처리 함수
// =============================================================================

/**
 * 전역 버퍼에 데이터 추가
 *
 * [호출 시점]
 * - BLE 모니터링 콜백에서 데이터 수신 시 호출
 *
 * [동작]
 * - 유효한 데이터만 버퍼 배열에 push
 * - 파일에는 쓰지 않음 (나중에 flush 시 일괄 처리)
 *
 * @param data - Base64로 인코딩된 BLE 수신 데이터
 *
 * @example
 * // BLE 콜백에서 사용
 * if (globalIsRecording) {
 *   globalAppendData(characteristic.value);  // "SGVsbG8gV29ybGQ="
 * }
 */
export const globalAppendData = (data: string) => {
  // 빈 데이터는 무시 (null, undefined, 빈 문자열)
  if (!data) return;

  // 버퍼 배열 끝에 추가
  globalWriteBuffer.push(data);
};

/**
 * 전역 버퍼의 모든 데이터를 파일에 저장 (핵심 함수)
 *
 * [호출 시점]
 * - 백그라운드 서비스에서 5초마다 호출
 * - 녹음 중지 시 잔여 데이터 저장을 위해 호출
 * - 앱 종료 시 cleanup에서 호출
 *
 * [처리 과정]
 * 1. 버퍼 복사 후 즉시 비움 (새 데이터 수신 준비)
 * 2. 각 Base64 청크를 바이너리(Uint8Array)로 변환
 * 3. 모든 바이너리를 하나로 합침
 * 4. 합친 바이너리를 다시 Base64로 인코딩
 * 5. 파일에 append (기존 내용 뒤에 추가)
 *
 * [왜 Base64 → 바이너리 → Base64 변환을 하는가?]
 * - 여러 개의 Base64 문자열을 단순 연결하면 유효하지 않은 Base64가 됨
 * - 예: "SGVs" + "bG8=" → "SGVsbG8=" (X, 잘못된 방식)
 * - 올바른 방식: 각각 디코딩 → 바이너리 합치기 → 다시 인코딩
 *
 * [에러 처리]
 * - 파일 쓰기 실패 시 데이터를 버퍼에 복구 (데이터 손실 방지)
 */
export const globalFlushBuffer = async () => {
  // -----------------------------------------
  // Step 0: 버퍼가 비어있으면 아무것도 안 함
  // -----------------------------------------
  if (globalWriteBuffer.length === 0) return;

  // -----------------------------------------
  // Step 1: 버퍼 복사 후 즉시 초기화
  // -----------------------------------------
  // 왜 복사하는가?
  // - flush 중에도 BLE 데이터가 계속 들어올 수 있음
  // - 복사 후 원본을 비워야 새 데이터를 받을 수 있음
  // - 복사본으로 파일 쓰기를 진행
  const chunksToWrite = [...globalWriteBuffer];
  globalWriteBuffer = [];  // 원본 버퍼 비움

  try {
    // -----------------------------------------
    // Step 2: Base64 → 바이너리 변환
    // -----------------------------------------
    // 각 청크(Base64 문자열)를 Uint8Array로 변환
    // 변환 실패한 청크는 null로 처리 후 필터링
    const byteArrays = chunksToWrite
      .filter(chunk => chunk)  // 빈 값 제거
      .map(chunk => {
        try {
          // Base64 문자열 → Uint8Array
          // 예: "SGVsbG8=" → Uint8Array([72, 101, 108, 108, 111])
          return toByteArray(chunk);
        } catch (e) {
          // 잘못된 Base64 형식인 경우
          console.log(`[${getTimestamp()}] base64 디코딩 에러`);
          return null;
        }
      })
      .filter(arr => arr !== null) as Uint8Array[];  // null 제거

    // 유효한 데이터가 없으면 종료
    if (byteArrays.length === 0) return;

    // -----------------------------------------
    // Step 3: 바이너리 배열들을 하나로 합치기
    // -----------------------------------------
    // 전체 바이트 수 계산
    // 예: [5바이트, 3바이트, 4바이트] → 총 12바이트
    const totalLength = byteArrays.reduce((sum, arr) => sum + arr.length, 0);

    // 합칠 공간 확보
    const combinedArray = new Uint8Array(totalLength);

    // 각 배열을 순서대로 복사
    // offset: 다음에 복사할 시작 위치
    let offset = 0;
    for (const arr of byteArrays) {
      combinedArray.set(arr, offset);  // arr을 offset 위치에 복사
      offset += arr.length;            // 다음 위치로 이동
    }
    // 결과: [배열1의 데이터, 배열2의 데이터, 배열3의 데이터, ...]

    // -----------------------------------------
    // Step 4: 합쳐진 바이너리 → Base64 인코딩
    // -----------------------------------------
    // 파일에 쓰기 위해 다시 Base64로 변환
    // RNFS.appendFile의 'base64' 옵션은 Base64 문자열을 기대함
    const combinedBase64 = fromByteArray(combinedArray);

    // -----------------------------------------
    // Step 5: 파일에 쓰기
    // -----------------------------------------
    if (!globalFileInitialized) {
      // 첫 번째 쓰기: 파일 존재 여부 확인 필요
      const exists = await RNFS.exists(FILE_PATH);
      if (exists) {
        // 파일이 이미 있으면 뒤에 추가
        await RNFS.appendFile(FILE_PATH, combinedBase64, 'base64');
      } else {
        // 파일이 없으면 새로 생성
        await RNFS.writeFile(FILE_PATH, combinedBase64, 'base64');
      }
      // 이후부터는 exists 체크 생략
      globalFileInitialized = true;
    } else {
      // 두 번째 이후: 무조건 append (파일이 있음을 알고 있음)
      await RNFS.appendFile(FILE_PATH, combinedBase64, 'base64');
    }

    // 저장 완료 로그
    console.log(`[${getTimestamp()}] 백그라운드 저장: ${chunksToWrite.length}개 청크 (${totalLength} bytes)`);

  } catch (err: any) {
    // -----------------------------------------
    // 에러 처리: 데이터 복구
    // -----------------------------------------
    console.log(`[${getTimestamp()}] 파일 쓰기 에러:`, err.message);

    // 실패한 데이터를 버퍼 앞에 다시 넣음
    // 다음 flush 때 다시 시도하게 됨
    // [...실패한 데이터, ...새로 들어온 데이터]
    globalWriteBuffer = [...chunksToWrite, ...globalWriteBuffer];
  }
};

/**
 * 파일 저장 시스템 초기화 (리셋)
 *
 * [호출 시점]
 * - 사용자가 파일 삭제 버튼을 눌렀을 때
 *
 * [동작]
 * - 파일 초기화 플래그 리셋 → 다음 쓰기 시 파일 존재 여부 다시 확인
 * - 버퍼 비움 → 메모리에 남은 데이터 제거
 *
 * [주의]
 * - 이 함수는 파일 자체를 삭제하지 않음
 * - 파일 삭제는 RNFS.unlink()로 별도 수행해야 함
 */
export const resetFileStorage = () => {
  globalFileInitialized = false;  // 다음 쓰기 시 파일 존재 확인하도록
  globalWriteBuffer = [];         // 버퍼 비움
};
