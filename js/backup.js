/**
 * 备份：把本地数据导出成人能读的 Markdown 或可导回的 JSON，以及解析导入文件。
 * 全是纯函数，不碰 DOM 也不碰存储，方便单独验证。
 */
import { KIND_META, KIND_ORDER } from './state.js';
import { clip, uid } from './util.js';

const kindLabel = (k) => (KIND_META[k] && KIND_META[k].label) || '记录';

function stamp(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function dateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${stamp(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知日期';
  return stamp(d);
}

function isDone(t) { return t.status === 'done'; }

function taskLine(t, withBox = true) {
  const extra = [t.priority === 'high' ? '高优' : '', t.due_date ? `截止 ${t.due_date}` : '']
    .filter(Boolean).join('，');
  const box = withBox ? `[${isDone(t) ? 'x' : ' '}] ` : '';
  return `- ${box}${t.title}${extra ? `（${extra}）` : ''}`;
}

/* ---------------- 导出 ---------------- */

/** 可读的 Markdown：按天分组，和收件箱的顺序一致 */
export function buildMarkdown({ entries = [], tasks = [] } = {}, now = new Date()) {
  const open = tasks.filter((t) => !isDone(t));
  const out = [];

  out.push('# 归拾 · 记录导出');
  out.push('');
  out.push(`导出时间：${dateTime(now.toISOString())}`);
  out.push(`记录 ${entries.length} 条 · 待办 ${tasks.length} 条（未完成 ${open.length}）`);
  out.push('');

  const groups = new Map();
  for (const e of entries) {
    const key = dayKey(e.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  for (const [day, list] of groups) {
    out.push('---');
    out.push('');
    out.push(`## ${day}`);
    out.push('');
    for (const e of list) {
      out.push(`### [${kindLabel(e.kind)}] ${e.title || clip(e.raw, 40)}`);
      out.push('');
      out.push(`- 时间：${dateTime(e.created_at)}`);
      if (e.tags && e.tags.length) out.push(`- 标签：${e.tags.join(' / ')}`);
      if (e.summary) out.push(`- 摘要：${e.summary}`);
      if (e.key_points && e.key_points.length) {
        out.push('- 要点：');
        e.key_points.forEach((p) => out.push(`  - ${p}`));
      }

      const mine = tasks.filter((t) => t.entry_id === e.id);
      if (mine.length) {
        out.push('- 待办：');
        mine.forEach((t) => out.push(`  ${taskLine(t)}`));
      }

      out.push('');
      out.push('原始记录：');
      String(e.raw || '').split('\n').forEach((line) => out.push(`> ${line}`));
      out.push('');
    }
  }

  out.push('---');
  out.push('');
  out.push('## 待办清单');
  out.push('');
  if (!tasks.length) out.push('（暂无）');
  tasks.forEach((t) => out.push(taskLine(t)));
  out.push('');

  return out.join('\n');
}

/** 可导回的 JSON：结构稳定，便于以后迁移或二次处理 */
export function buildJson({ entries = [], tasks = [] } = {}, now = new Date()) {
  return JSON.stringify({
    app: 'guishi',
    version: 2,
    exportedAt: now.toISOString(),
    counts: { entries: entries.length, tasks: tasks.length },
    entries,
    tasks,
  }, null, 2);
}

/** 一份回顾报告，纯本地统计结果 */
export function buildReviewMarkdown(review) {
  const { start, end, entries, tasksNew, tasksDone, open, overdue, tags, kinds } = review;
  const out = [];
  const days = review.days;

  out.push(`# 回顾 · 近 ${days} 天`);
  out.push('');
  out.push(`${stamp(start)} – ${stamp(end)}`);
  out.push('');
  out.push('## 概览');
  out.push('');
  out.push(`- 新增记录：${entries.length} 条`);
  out.push(`- 有记录的天数：${review.activeDays} 天`);
  out.push(`- 新建待办：${tasksNew.length} 条，已完成 ${tasksDone.length} 条`);
  out.push(`- 当前未完成：${open.length} 条${overdue.length ? `（其中逾期 ${overdue.length} 条）` : ''}`);
  out.push('');

  out.push('## 分类分布');
  out.push('');
  const kindRows = KIND_ORDER.filter((k) => kinds[k]).map((k) => `- ${KIND_META[k].label}：${kinds[k]} 条`);
  out.push(kindRows.length ? kindRows.join('\n') : '（这段时间没有记录）');
  out.push('');

  out.push('## 标签');
  out.push('');
  out.push(tags.length ? tags.map((t) => `- ${t.name}：${t.count} 条`).join('\n') : '（暂无标签）');
  out.push('');

  out.push('## 记录');
  out.push('');
  if (!entries.length) out.push('（这段时间没有记录）');
  const groups = new Map();
  for (const e of entries) {
    const key = dayKey(e.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const [day, list] of groups) {
    out.push(`### ${day}`);
    out.push('');
    list.forEach((e) => {
      const d = new Date(e.created_at);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      out.push(`- ${hh}:${mm} [${kindLabel(e.kind)}] ${e.title || clip(e.raw, 30)}`);
    });
    out.push('');
  }

  out.push('## 还没做完的事');
  out.push('');
  if (!open.length) out.push('（没有未完成的待办）');
  open.forEach((t) => {
    const late = t.due_date && t.due_date < `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    out.push(`- ${t.title}${t.due_date ? `（截止 ${t.due_date}${late ? '，已逾期' : ''}）` : ''}`);
  });
  out.push('');

  return out.join('\n');
}

/* ---------------- 导入 ---------------- */

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return v.split(/[,，、\s]+/);
  return [];
}

function isoOr(value, fallback) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.raw || '').trim();
  if (!text) return null;
  const created = isoOr(raw.created_at, new Date().toISOString());
  return {
    id: String(raw.id || uid('e')),
    raw: text,
    kind: KIND_META[raw.kind] ? raw.kind : 'note',
    title: raw.title ? clip(String(raw.title), 60) : null,
    summary: raw.summary ? clip(String(raw.summary), 400) : null,
    tags: asArray(raw.tags).map((t) => clip(String(t), 12)).filter(Boolean).slice(0, 6),
    key_points: asArray(raw.key_points).map((p) => clip(String(p), 200)).filter(Boolean).slice(0, 8),
    created_at: created,
    updated_at: isoOr(raw.updated_at, created),
  };
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clip(String(raw.title || ''), 80);
  if (!title) return null;
  const created = isoOr(raw.created_at, new Date().toISOString());
  const done = raw.status === 'done';
  return {
    id: String(raw.id || uid('t')),
    entry_id: raw.entry_id ? String(raw.entry_id) : null,
    title,
    status: done ? 'done' : 'todo',
    priority: ['high', 'normal', 'low'].includes(raw.priority) ? raw.priority : 'normal',
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.due_date || '')) ? raw.due_date : null,
    created_at: created,
    completed_at: done ? isoOr(raw.completed_at, created) : null,
  };
}

/** 解析备份文件；结构不对就抛错，不做「猜你想要什么」 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('这不是有效的 JSON 文件');
  }
  if (!data || typeof data !== 'object') throw new Error('文件内容不是备份格式');

  const rawEntries = Array.isArray(data.entries) ? data.entries : null;
  const rawTasks = Array.isArray(data.tasks) ? data.tasks : null;
  if (!rawEntries && !rawTasks) throw new Error('备份里没有 entries 或 tasks 字段');

  const entries = (rawEntries || []).map(normalizeEntry).filter(Boolean);
  const tasks = (rawTasks || []).map(normalizeTask).filter(Boolean);
  if (!entries.length && !tasks.length) throw new Error('备份里没有可导入的内容');

  return { entries, tasks };
}

/* ---------------- 下载 ---------------- */

export function fileName(kind, ext, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stampText = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  return `guishi-${kind}-${stampText}.${ext}`;
}

export function download(name, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
