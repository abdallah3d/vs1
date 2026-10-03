import type { Session } from '@supabase/supabase-js';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../components/ui';
import { track } from '../lib/activity';
import { isConfigured, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Log every time the app comes to the foreground.
  useEffect(() => {
    if (!session) return;
    track('app_open');
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') track('app_open');
    });
    return () => sub.remove();
  }, [session?.user.id]);

  if (!isConfigured) return <SetupNeeded />;

  if (session === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
          headerBackTitle: 'رجوع',
        }}
      >
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="project/[id]" options={{ title: 'المشروع' }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}

function SetupNeeded() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
          <T bold size={22}>أهلاً 👋 باقي خطوة</T>
          <T>التطبيق يحتاج ربط مع Supabase عشان يحفظ مشاريعك في السحابة ويشغّل الأجينت.</T>
          <T bold>الخطوات:</T>
          <T>1. سوّ مشروع مجاني في supabase.com</T>
          <T>2. انسخ ملف mobile/.env.example إلى mobile/.env</T>
          <T>3. حط فيه رابط المشروع والمفتاح العام (Project Settings → API)</T>
          <T>4. أعد تشغيل: npx expo start</T>
          <T muted>التفاصيل الكاملة في ملف README.md في المستودع.</T>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
