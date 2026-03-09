/**
 * BLE 상태를 앱 전체에서 공유하는 Context
 *
 * useBLE 훅은 한 번만 호출되고, 모든 화면에서 동일한 상태를 참조
 */

import React, { createContext, useContext } from 'react';
import { useBLE, UseBLEReturn } from '../hooks/useBLE';

const BLEContext = createContext<UseBLEReturn | null>(null);

export const BLEProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ble = useBLE();
  return <BLEContext.Provider value={ble}>{children}</BLEContext.Provider>;
};

export const useBLEContext = (): UseBLEReturn => {
  const ctx = useContext(BLEContext);
  if (!ctx) {
    throw new Error('useBLEContext must be used within BLEProvider');
  }
  return ctx;
};
