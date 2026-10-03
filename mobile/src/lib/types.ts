export type ProjectStatus = 'idea' | 'active' | 'paused' | 'done';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export type Project = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  project_id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
};

export type MonitorLatest = {
  monitor_id: string;
  project_id: string | null;
  name: string;
  url: string;
  enabled: boolean;
  ok: boolean | null;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
  checked_at: string | null;
};

export type ActivityEvent = {
  id: number;
  event: string;
  project_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: 'فكرة',
  active: 'شغال',
  paused: 'متوقف',
  done: 'منتهي',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'لم تبدأ',
  doing: 'قيد العمل',
  done: 'منجزة',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
};

export const EVENT_LABEL: Record<string, string> = {
  app_open: 'فتح التطبيق',
  screen_view: 'تصفح',
  project_created: 'مشروع جديد',
  project_updated: 'تعديل مشروع',
  task_created: 'مهمة جديدة',
  task_completed: 'إنجاز مهمة',
  task_reopened: 'إعادة فتح مهمة',
  task_updated: 'تعديل مهمة',
  monitor_added: 'رابط مراقبة جديد',
  agent_message: 'محادثة الأجينت',
};
