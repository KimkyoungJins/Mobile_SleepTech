/**
 * BLE 관련 상수 정의
 */

/**
 * Nordic UART Service (NUS) UUID
 * Nordic Semiconductor의 표준 UART over BLE 프로토콜
 */
export const NUS_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';

/**
 * TX Characteristic UUID - 디바이스가 데이터를 보내는 채널
 * (TX는 디바이스 기준, 앱에서는 수신용)
 */
export const NUS_TX_CHARACTERISTIC_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';

/**
 * BLE 디바이스 이름 필터
 * 스캔 중 이 문자열이 포함된 디바이스만 연결 대상으로 인식
 */
export const DEVICE_NAME_FILTER = 'Nordic_UART_S';

/**
 * 재연결 타임아웃 (10분) - 이 시간 동안 재연결 계속 시도
 */
export const RECONNECT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Android MTU 요청 크기 (바이트)
 */
export const ANDROID_MTU_SIZE = 247;
