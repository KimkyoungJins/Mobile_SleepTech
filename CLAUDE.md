# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BLE Sleep Data Recorder - A React Native/Expo app that connects to Nordic UART BLE devices to capture sensor data with background recording support. Optimized for long-duration (8+ hours) recording on Samsung Android devices. The UI is in Korean.

## Development Commands

```bash
npm install           # Install dependencies
npm start             # Start Expo dev server (expo start)
npm run android       # Build and run on Android (expo run:android)
npm run ios           # Build and run on iOS (expo run:ios)
npm run web           # Run web version (expo start --web)
npm run lint          # Run ESLint
```

For native builds, Android requires Gradle and iOS requires CocoaPods (`cd ios && pod install`).

## Architecture

### Core Stack
- **Expo 54** with Expo Router (file-based routing)
- **React Native 0.81** with New Architecture enabled
- **TypeScript** (strict mode disabled, paths alias `@/*` → `./*`)

### Key Libraries
- `react-native-ble-plx` - BLE communication
- `react-native-background-actions` - Background service for continuous recording
- `react-native-fs` (RNFS) - File system access for data storage
- `expo-sharing` - File export functionality

### BLE Configuration
The app connects to Nordic UART Service devices:
- **Service UUID:** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **TX Characteristic:** `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- **Device filter:** `Nordic_UART_S`

### Data Flow
1. App scans for BLE devices matching `Nordic_UART_S`
2. Connects and monitors TX characteristic for incoming data
3. Data buffered in memory, flushed to `Documents/data.raw` every 5 seconds (batch writes for efficiency)
4. Background service keeps recording active when app is minimized
5. Auto-reconnect on disconnection (up to 10 attempts when recording)
6. File can be shared via OS share dialog

### Platform-Specific Notes
- **Android:** Requests MTU of 247 bytes; requires runtime permissions for BLE and notifications; prompts user to disable battery optimization for reliable 8+ hour recording
- **iOS:** Bluetooth permissions configured in app.json infoPlist
- **Bundle ID:** `com.yourname.bleapp` (both platforms)

### State Management Pattern
Uses `useRef` for state values needed in BLE callbacks (ensures latest values in background contexts):
- `isRecordingRef` - tracks recording state for background writes
- `timeRef` - throttles UI log updates (10-second interval)
- `writeBufferRef` - accumulates data between flush intervals

### Key Files
- `hooks/useBLE.ts` - Core BLE logic: scanning, connection, monitoring, auto-reconnect
- `services/fileStorage.ts` - Global state for file buffer and flush operations (uses globals for HeadlessJS compatibility)
- `services/backgroundService.ts` - Background task that runs the flush loop every 5 seconds
- `constants/ble.ts` - Nordic UART UUIDs and connection parameters

### Important Implementation Details
- **Global Variables in fileStorage.ts:** Required for HeadlessJS background service to access state outside React context
- **Custom Patch:** `patches/react-native-background-actions+4.0.1.patch` fixes Android 10+ foregroundServiceType compatibility
- **Data Encoding:** BLE data arrives as Base64, decoded and concatenated before writing to `data.raw`
- **Deep Link Scheme:** `blereact://` configured for notification tap-to-resume
