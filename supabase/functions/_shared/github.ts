// قراءة نشاط مستودعات GitHub. GITHUB_TOKEN اختياري: بدونه تشتغل المستودعات
// العامة فقط وبحد 60 طلب بالساعة؛ معه تشتغل الخاصة بعد.

export type RepoSummary = {
  repo: string;
  url: string;
  error?: string;
  default_branch?: string;
  pushed_at?: string;
  open_issues_and_prs?: number;
  commits?: Array<{ sha: string; message: string; author: string | null; date: string | null }>;
  open_pull_requests?: Array<{ number: number; title: string; author: string | null; updated_at: string; draft: boolean }>;
};

async function gh<T>(path: string): Promise<T> {
  const token = Deno.env.get("GITHUB_TOKEN");
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Mashari3i",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new Error("المستودع غير موجود أو خاص (أضف GITHUB_TOKEN للمستودعات الخاصة)");
  if (res.status === 403 || res.status === 429) throw new Error("تجاوزت حد طلبات GitHub، أضف GITHUB_TOKEN");
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  return await res.json() as T;
}

export async function repoSummary(fullName: string, days = 7): Promise<RepoSummary> {
  const url = `https://github.com/${fullName}`;
  try {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const [repo, commits, pulls] = await Promise.all([
      gh<{ default_branch: string; pushed_at: string; open_issues_count: number }>(`/repos/${fullName}`),
      gh<Array<{ sha: string; commit: { message: string; author: { name: string; date: string } | null } }>>(
        `/repos/${fullName}/commits?since=${encodeURIComponent(since)}&per_page=20`,
      ),
      gh<Array<{ number: number; title: string; user: { login: string } | null; updated_at: string; draft?: boolean }>>(
        `/repos/${fullName}/pulls?state=open&per_page=10`,
      ),
    ]);
    return {
      repo: fullName,
      url,
      default_branch: repo.default_branch,
      pushed_at: repo.pushed_at,
      open_issues_and_prs: repo.open_issues_count,
      commits: commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0].slice(0, 140),
        author: c.commit.author?.name ?? null,
        date: c.commit.author?.date ?? null,
      })),
      open_pull_requests: pulls.map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? null,
        updated_at: p.updated_at,
        draft: !!p.draft,
      })),
    };
  } catch (e) {
    return { repo: fullName, url, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Accepts "owner/repo", a github.com URL, or a URL ending in .git. */
export function parseRepo(input: string): string | null {
  const m = input.trim().match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
