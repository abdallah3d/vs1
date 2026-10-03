import { useState } from 'react';
import { ActivityIndicator, Alert, Linking } from 'react-native';
import { track } from '../lib/activity';
import { invoke, supabase } from '../lib/supabase';
import { colors, timeAgo } from '../lib/theme';
import { useLoader } from '../lib/useLoader';
import { Badge, Button, Card, Input, Row, SectionTitle, T } from './ui';

type RepoSummary = {
  repo: string;
  url: string;
  error?: string;
  pushed_at?: string;
  commits?: { sha: string; message: string; author: string | null; date: string | null }[];
  open_pull_requests?: { number: number; title: string; draft: boolean }[];
};

/** Accepts "owner/repo" or a github.com URL. */
function parseRepo(input: string): string | null {
  const m = input.trim().match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function GithubSection({ projectId }: { projectId: string }) {
  const [repo, setRepo] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, error, reload } = useLoader(async () => {
    const res = await invoke<{ repos: RepoSummary[] }>('github', { project_id: projectId });
    return res.repos;
  }, [projectId]);

  async function link() {
    const fullName = parseRepo(repo);
    if (!fullName) {
      Alert.alert('صيغة غير صحيحة', 'اكتبها كذا: owner/repo أو رابط github.com');
      return;
    }
    setSaving(true);
    const { error: err } = await supabase.from('github_repos').insert({ project_id: projectId, full_name: fullName });
    setSaving(false);
    if (err) return Alert.alert('ما انربط', err.message.includes('duplicate') ? 'هذا المستودع مربوط من قبل' : err.message);
    track('github_linked', { projectId, meta: { repo: fullName } });
    setRepo('');
    reload();
  }

  function unlink(fullName: string) {
    Alert.alert('فك ربط المستودع؟', fullName, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'فك الربط',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.from('github_repos').delete().eq('project_id', projectId).eq('full_name', fullName);
          if (err) Alert.alert('ما انفك', err.message);
          else reload();
        },
      },
    ]);
  }

  return (
    <>
      <SectionTitle>GitHub</SectionTitle>
      {!data && !error ? <ActivityIndicator color={colors.primary} style={{ marginBottom: 10 }} /> : null}
      {error ? <T muted size={13} style={{ marginBottom: 10 }}>{error}</T> : null}
      {(data ?? []).map((r) => (
        <Card key={r.repo} style={{ gap: 6 }} onPress={() => Linking.openURL(r.url)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T bold>{r.repo}</T>
            {r.error ? <Badge label="خطأ" tone="danger" /> : <T muted size={12}>آخر دفع {timeAgo(r.pushed_at ?? null)}</T>}
          </Row>
          {r.error ? <T size={12} style={{ color: colors.danger }}>{r.error}</T> : null}
          {r.commits ? (
            <T muted size={13}>{r.commits.length ? `${r.commits.length} كوميت هالأسبوع` : 'ما فيه كوميتات هالأسبوع'}</T>
          ) : null}
          {(r.commits ?? []).slice(0, 3).map((c) => (
            <T key={c.sha} size={13} numberOfLines={1}>• {c.message}</T>
          ))}
          {r.open_pull_requests?.length ? (
            <T size={13} style={{ color: colors.primary }}>
              {r.open_pull_requests.length} PR مفتوح: {r.open_pull_requests.map((p) => `#${p.number}`).join(' ')}
            </T>
          ) : null}
          <T muted size={11} onPress={() => unlink(r.repo)}>فك الربط</T>
        </Card>
      ))}
      <Card style={{ gap: 10 }}>
        <Input placeholder="owner/repo" value={repo} onChangeText={setRepo} autoCapitalize="none" autoCorrect={false} />
        <Button title="اربط مستودع" variant="secondary" onPress={link} loading={saving} disabled={!repo.trim()} />
      </Card>
    </>
  );
}
