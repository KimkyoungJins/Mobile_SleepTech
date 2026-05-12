import { Tabs } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // 시스템 네비게이션 바 높이만큼 탭바 하단 패딩 확보
  const bottomPadding = Math.max(insets.bottom, 10) + 12;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#161B22',
          borderTopColor: '#30363D',
          borderTopWidth: 1,
          height: 56 + bottomPadding,
          paddingTop: 6,
          paddingBottom: bottomPadding,
        },
        tabBarActiveTintColor: '#58A6FF',
        tabBarInactiveTintColor: '#484F58',
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '수면 기록',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="moon.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="analysis"
        options={{
          title: '수면 분석',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="chart.bar.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: '개발자 도구',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="wrench.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
