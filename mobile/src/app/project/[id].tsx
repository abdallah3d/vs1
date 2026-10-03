import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Badge, Button, Card, Chip, Empty, ErrorNote, Input, Progress, Row, SectionTitle, T } from '../../components/ui';
import { track } from '../../lib/activity';
import { must, supabase } from '../../lib/supabase';
import { colors, todayISO } from '../../lib/theme';
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type MonitorLatest,
  type Priority,
  type Project,
  type ProjectStatus,
  type Task,
  type TaskStatus,
} from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo' };
const STATUS_ICON: Record<TaskStatus, string> = { todo: '○', doing: '◐', done: '●' };

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [adding, setAdding] = useState(false);

  const { data, error, refreshing, refresh, setData } = useLoader(async () => {
    const [project, tasks, monitors] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('tasks').select('*').eq('project_id', id).order('created_at'),
      supabase.from('monitor_latest').select('*').eq('project_id', id),
    ]);
    track('screen_view', { projectId: id, meta: { screen: 'project' } });
    return {
      project: must(project) as Project,
      tasks: must(tasks) as Task[],
      monitors: must(monitors) as MonitorLatest[],
    };
  }, [id]);

  async function addTask() {
    if (!title.trim()) return;
    setAdding(true);
    try {
      const task = must(
        await supabase.from('tasks').insert({ project_id: id, title: title.trim(), priority }).select().single(),
      ) as Task;
      track('task_created', { projectId: id, meta: { title: task.title } });
      setData((d) => (d ? { ...d, tasks: [...d.tasks, task] } : d));
      setTitle('');
    } catch (e) {
      Alert.alert('ما انحفظت', e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function cycleTask(task: Task) {
    const status = NEXT_STATUS[task.status];
    // Optimistic update; the row from the server replaces it (completed_at is set by a trigger).
    setData((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) } : d));
    try {
      const row = must(await supabase.from('tasks').update({ status }).eq('id', task.id).select().single()) as Task;
      setData((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? row : t)) } : d));
      track(status === 'done' ? 'task_completed' : status === 'todo' ? 'task_reopened' : 'task_updated', {
        projectId: id,
        meta: { title: task.title, status },
      });
    } catch (e) {
      setData((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? task : t)) } : d));
      Alert.alert('ما تحدّثت', e instanceof Error ? e.message : String(e));
    }
  }

  function deleteTask(task: Task) {
    Alert.alert('حذف المهمة؟', task.title, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.from('tasks').delete().eq('id', task.id);
          if (err) return Alert.alert('ما انحذفت', err.message);
          setData((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.id !== task.id) } : d));
        },
      },
    ]);
  }

  async function setStatus(status: ProjectStatus) {
    try {
      const project = must(await supabase.from('projects').update({ status }).eq('id', id).select().single()) as Project;
      setData((d) => (d ? { ...d, project } : d));
      track('project_updated', { projectId: id, meta: { status } });
    } catch (e) {
      Alert.alert('ما تحدّث', e instanceof Error ? e.message : String(e));
    }
  }

  function deleteProject() {
    Alert.alert('حذف المشروع؟', 'بتنحذف كل مهامه بعد.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.from('projects').delete().eq('id', id);
          if (err) return Alert.alert('ما انحذف', err.message);
          router.back();
        },
      },
    ]);
  }

  if (!data) {
    return (
      <View style={{ padding: 16 }}>
        <ErrorNote message={error} />
      </View>
    );
  }

  const { project, tasks, monitors } = data;
  const done = tasks.filter((t) => t.status === 'done').length;
  const today = todayISO();
  const groups: TaskStatus[] = ['doing', 'todo', 'done'];

  return (
    <>
      <Stack.Screen options={{ title: project.name }} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <ErrorNote message={error} />
        <Card style={{ gap: 10 }}>
          {project.description ? <T>{project.description}</T> : <T muted>بدون وصف</T>}
          <Progress value={tasks.length ? done / tasks.length : 0} color={project.color} />
          <T muted size={13}>{tasks.length ? `أنجزت ${done} من ${tasks.length} (${Math.round((done / tasks.length) * 100)}%)` : 'أضف مهام عشان تتابع التقدم'}</T>
          <Row style={{ flexWrap: 'wrap' }}>
            {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
              <Chip key={s} label={PROJECT_STATUS_LABEL[s]} active={project.status === s} color={project.color} onPress={() => setStatus(s)} />
            ))}
          </Row>
        </Card>

        <SectionTitle>إضافة مهمة</SectionTitle>
        <Card style={{ gap: 10 }}>
          <Input placeholder="وش المهمة؟" value={title} onChangeText={setTitle} onSubmitEditing={addTask} returnKeyType="done" />
          <Row style={{ justifyContent: 'space-between' }}>
            <Row>
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <Chip key={p} label={PRIORITY_LABEL[p]} active={priority === p} onPress={() => setPriority(p)} />
              ))}
            </Row>
            <Button title="أضف" onPress={addTask} loading={adding} disabled={!title.trim()} />
          </Row>
        </Card>

        {tasks.length === 0 ? <Empty title="ما فيه مهام بعد" hint="قسّم المشروع لخطوات صغيرة." /> : null}

        {groups.map((g) => {
          const items = tasks.filter((t) => t.status === g);
          if (!items.length) return null;
          return (
            <View key={g}>
              <SectionTitle>
                {TASK_STATUS_LABEL[g]} ({items.length})
              </SectionTitle>
              {items.map((t) => {
                const overdue = t.status !== 'done' && !!t.due_date && t.due_date < today;
                return (
                  <Card key={t.id} style={{ paddingVertical: 10 }}>
                    <Pressable onPress={() => cycleTask(t)} onLongPress={() => deleteTask(t)}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Row style={{ flex: 1 }}>
                          <T size={20} style={{ color: t.status === 'done' ? colors.success : project.color }}>{STATUS_ICON[t.status]}</T>
                          <T style={[{ flex: 1 }, t.status === 'done' && { textDecorationLine: 'line-through', color: colors.muted }]}>{t.title}</T>
                        </Row>
                        {overdue ? <Badge label="متأخرة" tone="danger" /> : null}
                        {t.priority === 'high' && t.status !== 'done' ? <Badge label="مهمة" tone="warning" /> : null}
                      </Row>
                    </Pressable>
                  </Card>
                );
              })}
            </View>
          );
        })}
        <T muted size={12} style={{ textAlign: 'center', marginTop: 4 }}>اضغط على المهمة لتغيير حالتها، واضغط مطولاً لحذفها</T>

        {monitors.length ? (
          <>
            <SectionTitle>المراقبة</SectionTitle>
            {monitors.map((m) => (
              <Card key={m.monitor_id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T bold>{m.name}</T>
                  <Badge label={m.ok === null ? 'لم يُفحص' : m.ok ? 'شغال' : 'واقف'} tone={m.ok === null ? 'neutral' : m.ok ? 'success' : 'danger'} />
                </Row>
              </Card>
            ))}
          </>
        ) : null}

        <Button title="حذف المشروع" variant="danger" onPress={deleteProject} style={{ marginTop: 24 }} />
      </ScrollView>
    </>
  );
}
