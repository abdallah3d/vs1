import { useState } from 'react';
import { Alert, ScrollView, Switch } from 'react-native';
import { Button, Card, Chip, ErrorNote, Row, SectionTitle, T } from '../components/ui';
import { registerForPush, unregisterPush, type PushStatus } from '../lib/push';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useLoader } from '../lib/useLoader';

type Settings = { time_zone: string; brief_hour: number; briefs_enabled: boolean; notify_monitors: boolean };

const HOURS = [5, 6, 7, 8, 9, 10, 11, 12];

const PUSH_MESSAGE: Record<PushStatus, string> = {
  registered: 'الإشعارات مفعّلة على هذا الجوال ✅',
  denied: 'رفضت الإشعارات. فعّلها من إعدادات الجوال ← مشاريعي.',
  simulator: 'الإشعارات تشتغل على جوال حقيقي بس، مو على المحاكي.',
  'no-project-id': 'باقي ربط التطبيق بـ EAS عشان تشتغل الإشعارات (شوف README).',
  error: 'صار خطأ في تفعيل الإشعارات، جرب مرة ثانية.',
};

export default function SettingsScreen() {
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, setData } = useLoader(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const res = await supabase.from('user_settings').select('time_zone, brief_hour, briefs_enabled, notify_monitors').maybeSingle();
    if (res.error) throw new Error(res.error.message);
    const row = res.data as Settings | null;
    return {
      email: auth.user?.email ?? '',
      settings: row ?? { time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, brief_hour: 8, briefs_enabled: true, notify_monitors: true },
    };
  });

  async function save(patch: Partial<Settings>) {
    if (!data) return;
    const next = { ...data.settings, ...patch };
    setData({ ...data, settings: next });
    const { error: err } = await supabase.from('user_settings').upsert(next, { onConflict: 'user_id' });
    if (err) Alert.alert('ما انحفظ', err.message);
  }

  async function enablePush() {
    setBusy(true);
    setPushStatus(await registerForPush());
    setBusy(false);
  }

  async function signOut() {
    await unregisterPush();
    await supabase.auth.signOut();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <ErrorNote message={error} />
      {data ? (
        <>
          <SectionTitle>الإشعارات</SectionTitle>
          <Card style={{ gap: 12 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T>تنبيه لما رابط يوقف أو يرجع</T>
              <Switch value={data.settings.notify_monitors} onValueChange={(v) => save({ notify_monitors: v })} trackColor={{ true: colors.primary }} />
            </Row>
            <Button title="فعّل الإشعارات على هذا الجوال" variant="secondary" onPress={enablePush} loading={busy} />
            {pushStatus ? <T muted size={13}>{PUSH_MESSAGE[pushStatus]}</T> : null}
          </Card>

          <SectionTitle>الملخص الصباحي ☀️</SectionTitle>
          <Card style={{ gap: 12 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T>أرسل لي ملخص يومي من الأجينت</T>
              <Switch value={data.settings.briefs_enabled} onValueChange={(v) => save({ briefs_enabled: v })} trackColor={{ true: colors.primary }} />
            </Row>
            {data.settings.briefs_enabled ? (
              <>
                <T muted size={13}>الساعة (بتوقيت {data.settings.time_zone}):</T>
                <Row style={{ flexWrap: 'wrap' }}>
                  {HOURS.map((h) => (
                    <Chip key={h} label={`${h}:00`} active={data.settings.brief_hour === h} onPress={() => save({ brief_hour: h })} />
                  ))}
                </Row>
              </>
            ) : null}
          </Card>

          <SectionTitle>الحساب</SectionTitle>
          <Card style={{ gap: 12 }}>
            <T muted>{data.email}</T>
            <Button title="تسجيل خروج" variant="danger" onPress={signOut} />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
