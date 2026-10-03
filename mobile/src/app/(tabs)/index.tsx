import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Badge, Button, Card, Chip, Empty, ErrorNote, Input, Progress, Row, SectionTitle, T } from '../../components/ui';
import { track } from '../../lib/activity';
import { must, supabase } from '../../lib/supabase';
import { colors, PROJECT_COLORS, timeAgo, todayISO } from '../../lib/theme';
import { PROJECT_STATUS_LABEL, type Project, type ProjectStatus, type Task } from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

type ProjectWithTasks = Project & { tasks: Pick<Task, 'status' | 'due_date'>[] };

const FILTERS: (ProjectStatus | 'all')[] = ['all', 'active', 'idea', 'paused', 'done'];

export default function Projects() {
  const [filter, setFilter] = useState<ProjectStatus | 'all'>('all');
  const [adding, setAdding] = useState(false);

  const { data, error, refreshing, refresh, reload } = useLoader(async () => {
    track('screen_view', { meta: { screen: 'projects' } });
    return must(
      await supabase.from('projects').select('*, tasks(status, due_date)').order('updated_at', { ascending: false }),
    ) as ProjectWithTasks[];
  });

  const projects = useMemo(() => (data ?? []).filter((p) => filter === 'all' || p.status === filter), [data, filter]);

  const stats = useMemo(() => {
    const all = data ?? [];
    const today = todayISO();
    const tasks = all.flatMap((p) => p.tasks);
    return {
      active: all.filter((p) => p.status === 'active').length,
      open: tasks.filter((t) => t.status !== 'done').length,
      overdue: tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today).length,
    };
  }, [data]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <ErrorNote message={error} />

      <Row style={{ marginBottom: 12 }}>
        <Stat label="مشاريع شغالة" value={stats.active} />
        <Stat label="مهام مفتوحة" value={stats.open} />
        <Stat label="متأخرة" value={stats.overdue} danger={stats.overdue > 0} />
      </Row>

      {adding ? (
        <NewProject
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : (
        <Button title="+ مشروع جديد" onPress={() => setAdding(true)} style={{ marginBottom: 12 }} />
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row-reverse', paddingBottom: 12 }}>
        {FILTERS.map((f) => (
          <Chip key={f} label={f === 'all' ? 'الكل' : PROJECT_STATUS_LABEL[f]} active={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ScrollView>

      {data && projects.length === 0 ? (
        <Empty title="ما فيه مشاريع هنا" hint="أضف أول مشروع أو فكرة، أو اطلب من الأجينت يضيفها لك." />
      ) : null}

      {projects.map((p) => {
        const done = p.tasks.filter((t) => t.status === 'done').length;
        const total = p.tasks.length;
        return (
          <Card key={p.id} onPress={() => router.push(`/project/${p.id}`)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.color }} />
                <T bold size={16}>{p.name}</T>
              </Row>
              <Badge label={PROJECT_STATUS_LABEL[p.status]} tone={p.status === 'active' ? 'primary' : p.status === 'done' ? 'success' : 'neutral'} />
            </Row>
            {p.description ? <T muted numberOfLines={2} style={{ marginTop: 6 }}>{p.description}</T> : null}
            <View style={{ marginTop: 10, gap: 6 }}>
              <Progress value={total ? done / total : 0} color={p.color} />
              <Row style={{ justifyContent: 'space-between' }}>
                <T muted size={12}>{total ? `${done} من ${total} مهام` : 'بدون مهام'}</T>
                <T muted size={12}>آخر تحديث {timeAgo(p.updated_at)}</T>
              </Row>
            </View>
          </Card>
        );
      })}

      <SignOut />
    </ScrollView>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <Card style={{ flex: 1, marginBottom: 0, alignItems: 'center' }}>
      <T bold size={22} style={{ color: danger ? colors.danger : colors.text, textAlign: 'center' }}>{value}</T>
      <T muted size={12} style={{ textAlign: 'center' }}>{label}</T>
    </Card>
  );
}

function NewProject({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const row = must(
        await supabase
          .from('projects')
          .insert({ name: name.trim(), description: description.trim() || null, status, color })
          .select('id')
          .single(),
      );
      track('project_created', { projectId: row.id, meta: { name: name.trim() } });
      onCreated();
    } catch (e) {
      Alert.alert('ما انحفظ', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <SectionTitle>مشروع جديد</SectionTitle>
      <Input placeholder="اسم المشروع" value={name} onChangeText={setName} autoFocus />
      <Input placeholder="وصف مختصر (اختياري)" value={description} onChangeText={setDescription} multiline />
      <Row style={{ flexWrap: 'wrap' }}>
        {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
          <Chip key={s} label={PROJECT_STATUS_LABEL[s]} active={status === s} onPress={() => setStatus(s)} />
        ))}
      </Row>
      <Row>
        {PROJECT_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: colors.text }}
          />
        ))}
      </Row>
      <Row>
        <Button title="حفظ" onPress={save} loading={saving} disabled={!name.trim()} style={{ flex: 1 }} />
        <Button title="إلغاء" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}

function SignOut() {
  return (
    <Pressable onPress={() => supabase.auth.signOut()} style={{ marginTop: 24, alignItems: 'center' }}>
      <T muted size={13}>تسجيل خروج</T>
    </Pressable>
  );
}
