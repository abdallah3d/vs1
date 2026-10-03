import { useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView } from 'react-native';
import { Badge, Button, Card, Empty, ErrorNote, Input, Row, SectionTitle, T } from '../../components/ui';
import { track } from '../../lib/activity';
import { invoke, must, supabase } from '../../lib/supabase';
import { colors, timeAgo } from '../../lib/theme';
import type { MonitorLatest } from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

type CheckRow = { monitor_id: string; ok: boolean; latency_ms: number | null };

export default function Monitors() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const { data, error, refreshing, refresh, reload } = useLoader(async () => {
    track('screen_view', { meta: { screen: 'monitors' } });
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [latest, checks] = await Promise.all([
      supabase.from('monitor_latest').select('*').order('name'),
      supabase.from('monitor_checks').select('monitor_id, ok, latency_ms').gte('checked_at', since),
    ]);
    return { latest: must(latest) as MonitorLatest[], checks: must(checks) as CheckRow[] };
  });

  async function add() {
    const clean = url.trim();
    if (!name.trim() || !/^https?:\/\/.+\..+/i.test(clean)) {
      Alert.alert('تأكد من البيانات', 'اكتب اسم ورابط كامل يبدأ بـ https://');
      return;
    }
    setSaving(true);
    try {
      must(await supabase.from('monitors').insert({ name: name.trim(), url: clean }).select('id').single());
      track('monitor_added', { meta: { url: clean } });
      setName('');
      setUrl('https://');
      await checkNow();
    } catch (e) {
      Alert.alert('ما انحفظ', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      const res = await invoke<{ checked: number; down: number }>('monitor-check');
      if (res.down > 0) Alert.alert('تنبيه ⚠️', `${res.down} من ${res.checked} روابط ما ترد`);
      await reload();
    } catch (e) {
      Alert.alert('ما قدرت أفحص', e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  function remove(m: MonitorLatest) {
    Alert.alert('إيقاف مراقبة الرابط؟', m.url, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.from('monitors').delete().eq('id', m.monitor_id);
          if (err) Alert.alert('ما انحذف', err.message);
          else reload();
        },
      },
    ]);
  }

  const latest = data?.latest ?? [];
  const down = latest.filter((m) => m.ok === false).length;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <ErrorNote message={error} />

      {latest.length ? (
        <Card style={{ backgroundColor: down ? colors.dangerSoft : colors.successSoft, borderColor: 'transparent' }}>
          <T bold size={16} style={{ color: down ? colors.danger : colors.success }}>
            {down ? `⚠️ ${down} من ${latest.length} روابط واقفة` : `✅ كل الروابط شغالة (${latest.length})`}
          </T>
        </Card>
      ) : null}

      <Button title="افحص الآن" onPress={checkNow} loading={checking} variant="secondary" style={{ marginBottom: 12 }} />

      {data && latest.length === 0 ? (
        <Empty title="ما تراقب أي رابط" hint="أضف رابط تطبيقك أو موقعك أو API، والأجينت يتابع إذا وقف." />
      ) : null}

      {latest.map((m) => {
        const mine = (data?.checks ?? []).filter((c) => c.monitor_id === m.monitor_id);
        const uptime = mine.length ? Math.round((mine.filter((c) => c.ok).length / mine.length) * 1000) / 10 : null;
        return (
          <Card key={m.monitor_id} onPress={() => Linking.openURL(m.url)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T bold size={16}>{m.name}</T>
              <Badge label={m.ok === null ? 'لم يُفحص' : m.ok ? 'شغال' : 'واقف'} tone={m.ok === null ? 'neutral' : m.ok ? 'success' : 'danger'} />
            </Row>
            <T muted size={12} numberOfLines={1} style={{ marginTop: 4 }}>{m.url}</T>
            <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <T size={13}>{m.latency_ms !== null ? `${m.latency_ms} ms` : '—'}</T>
              <T size={13}>{uptime !== null ? `تشغيل 24س: ${uptime}%` : ''}</T>
              <T muted size={12}>{timeAgo(m.checked_at)}</T>
            </Row>
            {m.ok === false && m.error ? <T size={12} style={{ color: colors.danger, marginTop: 4 }}>{m.error}</T> : null}
            <T muted size={11} style={{ marginTop: 6 }} onPress={() => remove(m)}>حذف</T>
          </Card>
        );
      })}

      <SectionTitle>إضافة رابط للمراقبة</SectionTitle>
      <Card style={{ gap: 10 }}>
        <Input placeholder="الاسم (مثلاً: موقع قطة)" value={name} onChangeText={setName} />
        <Input placeholder="https://..." value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" autoCorrect={false} />
        <Button title="أضف وافحص" onPress={add} loading={saving} />
      </Card>
      <T muted size={12} style={{ marginTop: 8 }}>
        الفحص التلقائي كل 10 دقائق يشتغل من السيرفر بعد ما تفعّل الجدولة (شوف README).
      </T>
    </ScrollView>
  );
}
