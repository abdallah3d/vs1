import { useNavigation } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Button, Chip, Empty, ErrorNote, Input, Row, T } from '../../components/ui';
import { invoke, must, supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { useLoader } from '../../lib/useLoader';

type Block = { type: string; text?: string };
type StoredMessage = { id: number; role: 'user' | 'assistant'; content: Block[] };
type Bubble = { key: string; role: 'user' | 'assistant'; text: string };

const SUGGESTIONS = [
  'وش وضع مشاريعي اليوم؟',
  'وش أسوي الحين؟ رتب لي الأولويات',
  'هل تطبيقاتي شغالة؟',
  'حلل نشاطي هالأسبوع',
  'فيه مشروع مهمل؟',
];

/** Turns stored API messages into chat bubbles, hiding tool calls and results. */
function toBubbles(rows: StoredMessage[]): Bubble[] {
  const out: Bubble[] = [];
  for (const row of rows) {
    const text = row.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n')
      .trim();
    if (!text) continue;
    // Strip the "[now: ...]" line the server prepends to each user message.
    const clean = row.role === 'user' ? text.replace(/^\[now:[^\]]*\]\n?/, '') : text;
    out.push({ key: String(row.id), role: row.role, text: clean });
  }
  return out;
}

export default function Agent() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Bubble[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const navigation = useNavigation();

  const { data, error, reload } = useLoader(async () => {
    const rows = must(
      await supabase.from('agent_messages').select('id, role, content').order('id', { ascending: false }).limit(200),
    ) as StoredMessage[];
    return toBubbles(rows.reverse());
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable onPress={clear} style={{ paddingHorizontal: 16 }}>
          <T muted size={13}>محادثة جديدة</T>
        </Pressable>
      ),
    });
  }, [navigation]);

  function clear() {
    Alert.alert('بدء محادثة جديدة؟', 'بتنمسح المحادثة الحالية. مشاريعك ومهامك ما تتأثر.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'امسح',
        style: 'destructive',
        onPress: async () => {
          const { data: auth } = await supabase.auth.getUser();
          if (!auth.user) return;
          const { error: err } = await supabase.from('agent_messages').delete().eq('user_id', auth.user.id);
          if (err) Alert.alert('ما انمسحت', err.message);
          else reload();
        },
      },
    ]);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    setSendError(null);
    setSending(true);
    setPending([{ key: 'pending-user', role: 'user', text: message }]);
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await invoke<{ reply: string; tools_used: string[] }>('agent', { message, timeZone });
      setPending((p) => [...p, { key: 'pending-reply', role: 'assistant', text: res.reply }]);
      await reload();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
      setInput(message);
    } finally {
      setPending([]);
      setSending(false);
    }
  }

  const bubbles = [...(data ?? []), ...pending];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        <ErrorNote message={error} />
        {data && bubbles.length === 0 ? (
          <Empty
            title="أهلاً، أنا أجينت مشاريعك 🤖"
            hint="أتابع مشاريعك ومهامك، أراقب روابط تطبيقاتك، وأحلل نشاطك. اسألني أو اطلب مني أضيف وأعدّل."
          />
        ) : null}
        {bubbles.map((b) => (
          <View
            key={b.key}
            style={{
              alignSelf: b.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
              backgroundColor: b.role === 'user' ? colors.primary : colors.card,
              borderRadius: 16,
              padding: 12,
              borderWidth: b.role === 'user' ? 0 : 1,
              borderColor: colors.border,
            }}
          >
            <T selectable style={{ color: b.role === 'user' ? '#fff' : colors.text, lineHeight: 22 }}>{b.text}</T>
          </View>
        ))}
        {sending ? (
          <Row style={{ alignSelf: 'flex-start' }}>
            <ActivityIndicator color={colors.primary} />
            <T muted size={13}>يشيك على بياناتك…</T>
          </Row>
        ) : null}
        <ErrorNote message={sendError} />
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: 10, gap: 8 }}>
        {!sending && bubbles.length < 2 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row-reverse' }}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} onPress={() => send(s)} />
            ))}
          </ScrollView>
        ) : null}
        <Row>
          <Input
            style={{ flex: 1, maxHeight: 120, minHeight: 44 }}
            placeholder="اكتب للأجينت…"
            value={input}
            onChangeText={setInput}
            multiline
            editable={!sending}
          />
          <Button title="إرسال" onPress={() => send(input)} disabled={!input.trim() || sending} />
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}
