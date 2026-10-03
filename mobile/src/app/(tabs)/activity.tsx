import { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Card, Empty, ErrorNote, Row, SectionTitle, T } from '../../components/ui';
import { must, supabase } from '../../lib/supabase';
import { colors, timeAgo } from '../../lib/theme';
import { EVENT_LABEL, type ActivityEvent } from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

const DAYS = 14;
const DAY_NAMES = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Activity() {
  const { data, error, refreshing, refresh } = useLoader(async () => {
    const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString();
    return must(
      await supabase.from('activity_log').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(3000),
    ) as ActivityEvent[];
  });

  const summary = useMemo(() => {
    const events = data ?? [];
    // "Progress" events are things that move projects forward, not just browsing.
    const progress = events.filter((e) => e.event !== 'screen_view' && e.event !== 'app_open');
    const days: { key: string; label: string; count: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = localDay(d);
      days.push({ key, label: DAY_NAMES[d.getDay()], count: progress.filter((e) => localDay(new Date(e.created_at)) === key).length });
    }
    // Today still counts as "in progress", so a streak can end yesterday.
    let streak = 0;
    let i = days.length - 1;
    if (days[i].count === 0) i--;
    for (; i >= 0 && days[i].count > 0; i--) streak++;
    const byType: Record<string, number> = {};
    for (const e of events) byType[e.event] = (byType[e.event] ?? 0) + 1;
    return {
      days,
      max: Math.max(1, ...days.map((d) => d.count)),
      streak,
      opens: byType.app_open ?? 0,
      completed: byType.task_completed ?? 0,
      byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
      recent: progress.slice(0, 20),
    };
  }, [data]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <ErrorNote message={error} />

      <Row style={{ marginBottom: 12 }}>
        <Stat label="أيام متتالية" value={summary.streak} emoji="🔥" />
        <Stat label={`مهام أنجزتها (${DAYS} يوم)`} value={summary.completed} emoji="✅" />
        <Stat label="مرات الفتح" value={summary.opens} emoji="📱" />
      </Row>

      <SectionTitle>إنجازك اليومي</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 4 }}>
          {summary.days.map((d) => (
            <View key={d.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <View
                style={{
                  width: '70%',
                  height: `${(d.count / summary.max) * 85}%`,
                  minHeight: d.count ? 4 : 2,
                  backgroundColor: d.count ? colors.primary : colors.border,
                  borderRadius: 4,
                }}
              />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
          {summary.days.map((d, i) => (
            <T key={d.key} muted size={9} style={{ flex: 1, textAlign: 'center' }}>
              {i % 2 === 1 ? d.label : ''}
            </T>
          ))}
        </View>
      </Card>

      <SectionTitle>آخر تحركاتك</SectionTitle>
      {data && summary.recent.length === 0 ? <Empty title="ما فيه نشاط بعد" hint="أضف مشروع أو أنجز مهمة وبيظهر هنا." /> : null}
      {summary.recent.map((e) => (
        <Card key={e.id} style={{ paddingVertical: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T>
              {EVENT_LABEL[e.event] ?? e.event}
              {typeof e.meta?.title === 'string' ? ` — ${e.meta.title}` : typeof e.meta?.name === 'string' ? ` — ${e.meta.name}` : ''}
              {e.meta?.source === 'agent' ? ' 🤖' : ''}
            </T>
            <T muted size={12}>{timeAgo(e.created_at)}</T>
          </Row>
        </Card>
      ))}

      {summary.byType.length ? (
        <>
          <SectionTitle>توزيع النشاط</SectionTitle>
          <Card style={{ gap: 6 }}>
            {summary.byType.map(([event, count]) => (
              <Row key={event} style={{ justifyContent: 'space-between' }}>
                <T>{EVENT_LABEL[event] ?? event}</T>
                <T bold>{count}</T>
              </Row>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value, emoji }: { label: string; value: number; emoji: string }) {
  return (
    <Card style={{ flex: 1, marginBottom: 0, alignItems: 'center' }}>
      <T size={18} style={{ textAlign: 'center' }}>{emoji}</T>
      <T bold size={20} style={{ textAlign: 'center' }}>{value}</T>
      <T muted size={11} style={{ textAlign: 'center' }}>{label}</T>
    </Card>
  );
}
