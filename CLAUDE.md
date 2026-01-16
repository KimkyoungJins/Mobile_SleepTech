# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BLE Sleep Data Recorder - A React Native/Expo app that connects to Nordic UART BLE devices to capture sensor data with background recording support. The UI is in Korean.

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
- **TypeScript** (strict mode disabled)

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

### Directory Structure
```
app/                  # Expo Router screens (file-based routing)
  (tabs)/             # Tab navigation group
    index.tsx         # Main BLE connection & recording screen
    explore.tsx       # Documentation/info screen
components/           # Reusable UI components
  ui/                 # Platform-specific UI primitives
hooks/                # Custom React hooks (theme, color scheme)
constants/            # Theme colors and fonts (theme.ts)
```

### Data Flow
1. App scans for BLE devices matching `Nordic_UART_S`
2. Connects and monitors TX characteristic for incoming data
3. Data is decoded from base64 and written to `Documents/data.raw`
4. Background service keeps recording active when app is minimized
5. File can be shared via OS share dialog

### Platform-Specific Notes
- **Android:** Requests MTU of 247 bytes; requires runtime permissions for BLE and notifications
- **iOS:** Bluetooth permissions configured in app.json infoPlist
- **Bundle ID:** `com.yourname.bleapp` (both platforms)

### State Management Pattern
Uses `useRef` for state values needed in BLE callbacks (ensures latest values in background contexts):
- `isRecordingRef` - tracks recording state for background writes
- `timeRef` - throttles UI log updates (10-second interval)
