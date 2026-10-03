import { supabase } from './supabase';

/**
 * Records what the user does in the app so the agent can spot patterns.
 * Fire-and-forget: tracking must never block or break the UI.
 */
export function track(event: string, opts: { projectId?: string | null; meta?: Record<string, unknown> } = {}) {
  supabase
    .from('activity_log')
    .insert({ event, project_id: opts.projectId ?? null, meta: opts.meta ?? {} })
    .then(({ error }) => {
      if (error) console.warn('track failed', error.message);
    });
}
