import { Tabs } from 'expo-router/js-tabs';
import { Text } from 'react-native';
import { colors } from '../../lib/theme';

const icon = (emoji: string) => ({ focused }: { focused: boolean }) => (
  <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Declared right-to-left reading order is reversed visually, so the first tab sits on the right. */}
      <Tabs.Screen name="activity" options={{ title: 'نشاطي', tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="monitors" options={{ title: 'المراقبة', tabBarIcon: icon('📡') }} />
      <Tabs.Screen name="agent" options={{ title: 'الأجينت', tabBarIcon: icon('🤖') }} />
      <Tabs.Screen name="index" options={{ title: 'مشاريعي', tabBarIcon: icon('📁') }} />
    </Tabs>
  );
}
