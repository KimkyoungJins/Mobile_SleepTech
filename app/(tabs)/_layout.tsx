import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#161B22',
          borderTopColor: '#21262D',
          borderTopWidth: 1,
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
