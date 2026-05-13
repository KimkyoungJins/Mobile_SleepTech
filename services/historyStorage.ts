/**
 * 수면 분석 결과 로컬 히스토리 저장소
 *
 * RNFS로 DocumentDirectoryPath에 JSON 파일 단일 저장.
 * 최대 50개 세션 유지 (오래된 것부터 삭제).
 * partial 결과(`status === 'in_progress'`)는 저장하지 않음 — 최종 결과만.
 */

import RNFS from 'react-native-fs';
import { SleepResultResponse } from './uploadService';

const HISTORY_PATH = `${RNFS.DocumentDirectoryPath}/sleep_history.json`;
const MAX_ENTRIES = 50;

export interface HistoryEntry {
  /** 세션 ID — 동일 ID로 재저장 시 교체됨 */
  session_id: string;
  /** 로컬 저장 시각 (ISO 문자열) */
  saved_at: string;
  /** 서버 최종 분석 결과 (그대로 보관) */
  result: SleepResultResponse;
}

/** 모든 기록 로드 (최신순) */
export const loadHistory = async (): Promise<HistoryEntry[]> => {
  try {
    const exists = await RNFS.exists(HISTORY_PATH);
    if (!exists) return [];
    const text = await RNFS.readFile(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e: any) {
    console.log('[history] load error:', e?.message ?? e);
    return [];
  }
};

/**
 * 결과를 히스토리에 저장 (또는 동일 session_id가 있으면 교체).
 * partial(status === 'in_progress')는 무시.
 */
export const saveHistoryEntry = async (result: SleepResultResponse): Promise<void> => {
  if (!result || result.status === 'in_progress') return;
  if (!result.session_id) return;

  try {
    const history = await loadHistory();
    const filtered = history.filter((h) => h.session_id !== result.session_id);
    const entry: HistoryEntry = {
      session_id: result.session_id,
      saved_at: new Date().toISOString(),
      result,
    };
    const updated = [entry, ...filtered].slice(0, MAX_ENTRIES);
    await RNFS.writeFile(HISTORY_PATH, JSON.stringify(updated), 'utf8');
    console.log(`[history] saved: ${result.session_id} (total=${updated.length})`);
  } catch (e: any) {
    console.log('[history] save error:', e?.message ?? e);
  }
};

/** 특정 세션 삭제 */
export const deleteHistoryEntry = async (sessionId: string): Promise<void> => {
  try {
    const history = await loadHistory();
    const filtered = history.filter((h) => h.session_id !== sessionId);
    await RNFS.writeFile(HISTORY_PATH, JSON.stringify(filtered), 'utf8');
    console.log(`[history] deleted: ${sessionId}`);
  } catch (e: any) {
    console.log('[history] delete error:', e?.message ?? e);
  }
};
