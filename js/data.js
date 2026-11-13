/**
 * 业务数据层：所有读写都落 IndexedDB，所有检索与统计都在内存里现算。
 * 没有网络请求，也没有异步等待模型 —— 调用方可以放心地把它当同步数据用，
 * 只有真正写盘的那一步是 await。
 */
import { state } from './state.js';
import * as db from './db.js';
import { clip, uid } from './util.js';

/* ---------------- 变更通知 ---------------- */

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 合并同一帧内的多次变更：批量导入时逐条 notify 会白白重绘几十次 */
let queued = false;
export function notify() {
  if (queued) return;
  queued = true;

  let flushed = false;
  const flush = () => {
    if (flushed) return;
    flushed = true;
    queued = false;
    listeners.forEach((fn) => {
      try { fn(); } catch (err) { console.warn('[guishi] 渲染回调出错', err); }
    });
  };

  // 优先等下一帧，画面更稳；但后台标签页里 rAF 会被节流甚至不触发，
  // 所以再加一个定时兜底，保证数据变了界面终究会跟上。
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
  setTimeout(flush, 80);
}

/* ---------------- 读取 ---------------- */

const byCreatedDesc = (a, b) => new Date(b.created_at) - new Date(a.created_at);

export async function loadAll() {
  const [entries, tasks] = await Promise.all([db.all('entries'), db.all('tasks')]);
  state.entries = entries.sort(byCreatedDesc);
  state.tasks = tasks.sort(byCreatedDesc);
  gramCache.clear();
  notify();
}

export function findEntry(id) {
  return state.entries.find((e) => e.id === id) || null;
}

export function tasksOfEntry(id) {
  return state.tasks.filter((t) => t.entry_id === id);
}

export function openTasks() {
  return state.tasks.filter((t) => t.status !== 'done');
}

export function overview() {
  const weekAgo = Date.now() - 7 * 86400000;
  return {
    total: state.entries.length,
    open: openTasks().length,
    week: state.entries.filter((e) => new Date(e.created_at).getTime() >= weekAgo).length,
  };
}

export function tagsRanked(limit = 12) {
  const map = new Map();
  for (const e of state.entries) {
    for (const t of e.tags || []) map.set(t, (map.get(t) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/* ---------------- 记录 ---------------- */

/** 原文第一行做默认标题：省得用户为「起个名」卡住；纯链接就退回去用域名后的文字 */
function defaultTitle(raw) {
  const first = String(raw || '').trim().split('\n')[0].trim();
  const withoutUrl = first.replace(/^https?:\/\/\S+\s*/i, '').trim();
  return clip(withoutUrl || first, 40) || '无标题';
}

export async function capture(raw, kind = 'idea') {
  const text = String(raw || '').trim();
  if (!text) throw new Error('写点什么再保存吧');
  const now = new Date().toISOString();
  const entry = {
    id: uid('e'),
    raw: text,
    kind,
    title: defaultTitle(text),
    summary: null,
    tags: [],
    key_points: [],
    created_at: now,
    updated_at: now,
  };
  await db.put('entries', entry);
  state.entries.unshift(entry);
  state.filters.kind = 'all';
  state.filters.tag = '';
  state.listLimit = Math.max(state.listLimit, 100);
  notify();
  return entry;
}

export async function editEntry(id, patch) {
  const target = findEntry(id);
  if (!target) throw new Error('这条记录已经不在了');
  const next = { ...target, ...patch, updated_at: new Date().toISOString() };
  next.tags = [...new Set((next.tags || []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 6);
  await db.put('entries', next);
  Object.assign(target, next);
  gramCache.delete(id);
  notify();
  return target;
}

export async function removeEntry(id) {
  await db.remove('entries', id);
  state.entries = state.entries.filter((e) => e.id !== id);
  gramCache.delete(id);
  if (state.activeId === id) state.activeId = null;

  // 待办不跟着删：把它从「来自某条记录」变成独立待办，和用户预期更接近
  const orphans = state.tasks.filter((t) => t.entry_id === id);
  for (const t of orphans) {
    t.entry_id = null;
    await db.put('tasks', t);
  }
  notify();
}

/* ---------------- 待办 ---------------- */

export async function addTask(title, extra = {}) {
  const text = clip(String(title || ''), 80);
  if (!text) throw new Error('待办内容不能为空');
  const task = {
    id: uid('t'),
    entry_id: extra.entry_id || null,
    title: text,
    status: 'todo',
    priority: extra.priority || 'normal',
    due_date: extra.due_date || null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  await db.put('tasks', task);
  state.tasks.unshift(task);
  notify();
  return task;
}

/** 把一条记录变成待办：标题沿用记录标题，保留来源方便回看 */
export async function addTaskFromEntry(entryId) {
  const entry = findEntry(entryId);
  if (!entry) throw new Error('这条记录已经不在了');
  const dup = state.tasks.find((t) => t.entry_id === entryId && t.status !== 'done');
  if (dup) throw new Error('这条记录已经有一条未完成的待办了');
  return addTask(entry.title || entry.raw, { entry_id: entryId });
}

export async function patchTask(id, patch) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new Error('这条待办已经不在了');
  const next = { ...task, ...patch };
  await db.put('tasks', next);
  Object.assign(task, next);
  notify();
  return task;
}

export async function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const done = task.status === 'done';
  const patch = done
    ? { status: 'todo', completed_at: null }
    : { status: 'done', completed_at: new Date().toISOString() };

  const before = { status: task.status, completed_at: task.completed_at };
  Object.assign(task, patch);
  notify();
  try {
    const next = { ...task };
    await db.put('tasks', next);
  } catch (err) {
    Object.assign(task, before);   // 写盘失败就把界面退回去，别让状态和存储对不上
    notify();
    throw err;
  }
}

export async function removeTask(id) {
  await db.remove('tasks', id);
  state.tasks = state.tasks.filter((t) => t.id !== id);
  notify();
}

/* ---------------- 标签 ---------------- */

/**
 * 改名，或改成另一个已有标签名（等于合并）；传空字符串表示去掉这个标签。
 * 只动记录本身，不碰待办。
 */
export async function renameTag(from, to) {
  const name = String(to || '').trim().slice(0, 12);
  if (!from || from === name) return 0;

  const affected = state.entries.filter((e) => (e.tags || []).includes(from));
  if (!affected.length) return 0;

  const now = new Date().toISOString();
  const next = [];
  for (const e of affected) {
    const tags = [...new Set((e.tags || []).map((t) => (t === from ? name : t)).filter(Boolean))].slice(0, 6);
    const row = { ...e, tags, updated_at: now };
    Object.assign(e, row);
    next.push(row);
  }
  await db.bulkPut('entries', next);
  next.forEach((row) => gramCache.delete(row.id));
  notify();
  return next.length;
}

/* ---------------- 本地关联（不算模型，只算重合度） ---------------- */

const STOP = new Set(['的', '了', '是', '我', '你', '他', '在', '有', '和', '与', '吗', '呢', '吧', '啊',
  '这', '那', '会', '要', '就', '都', '也', '很', '不', '没', '个', '上', '下', '中', '过', '得', '把', '被',
  '一个', '什么', '可以', '因为', '所以', '但是', '如果', '还是', '已经', '自己']);

const SIM_LIMIT = 600;   // 只取前 600 字参与相似度，长文不做全文比对

function grams(text) {
  const out = [];
  const clean = String(text || '').toLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, ' ');
  for (const seg of clean.split(/\s+/)) {
    if (!seg) continue;
    if (/^[a-z0-9]+$/.test(seg)) {
      if (seg.length >= 2) out.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i += 1) out.push(seg.slice(i, i + 2));
  }
  return out.filter((g) => !STOP.has(g));
}

const gramCache = new Map();

function entryGrams(entry) {
  const cached = gramCache.get(entry.id);
  if (cached) return cached;
  const text = [entry.title, entry.summary, (entry.key_points || []).join(' '), entry.raw]
    .filter(Boolean).join(' ').slice(0, SIM_LIMIT);
  const set = new Set(grams(text));
  gramCache.set(entry.id, set);
  return set;
}

/**
 * 找出和这条记录最像的几条：共同标签给固定分，正文的 bigram 重合度给浮动分。
 * 纯本地计算，不联网、不调模型，结果只用于展示。
 */
export function relatedOf(id, limit = 5) {
  const target = findEntry(id);
  if (!target) return [];
  const mine = new Set((target.tags || []).map((t) => String(t).toLowerCase()));
  const tg = entryGrams(target);
  const out = [];

  for (const entry of state.entries) {
    if (entry.id === id) continue;
    const shared = [];
    for (const t of entry.tags || []) {
      if (mine.has(String(t).toLowerCase())) shared.push(t);
    }
    const eg = entryGrams(entry);
    let overlap = 0;
    for (const g of eg) if (tg.has(g)) overlap += 1;
    const base = Math.max(1, Math.min(eg.size, tg.size));
    const ratio = overlap / base;

    const score = Math.round(shared.length * 34 + ratio * 100);
    if (score < 30) continue;
    out.push({
      entry,
      score,
      reason: shared.length
        ? `共同标签：${shared.slice(0, 2).join('、')}`
        : '内容相近',
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------------- 回顾（纯统计） ---------------- */

const DAY_MS = 86400000;

function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inRange(iso, start, end) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * 把区间内的记录与待办收成一份可以直接渲染的统计结果。
 * 这里没有任何「洞察」，只有计数、分布和清单 —— 数字都能在列表里对上。
 */
export function reviewData(days) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const start = new Date(end.getTime());
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const entries = state.entries.filter((e) => inRange(e.created_at, start, end));
  const tasksNew = state.tasks.filter((t) => inRange(t.created_at, start, end));
  const tasksDone = state.tasks.filter((t) => t.status === 'done' && inRange(t.completed_at, start, end));

  const kindCount = {};
  const tagCount = new Map();
  const activeDays = new Set();
  for (const e of entries) {
    kindCount[e.kind] = (kindCount[e.kind] || 0) + 1;
    for (const t of e.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    const key = dayKey(e.created_at);
    if (key) activeDays.add(key);
  }

  const tags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const open = openTasks();
  const overdue = open.filter((t) => t.due_date && t.due_date < dayKey(now));

  return {
    days,
    start,
    end,
    entries,
    tasksNew,
    tasksDone,
    total: entries.length,
    activeDays: activeDays.size,
    kinds: kindCount,
    tags,
    trend: trendOf(entries, start, days),
    open,
    overdue,
    doneRate: tasksNew.length ? Math.round((tasksDone.length / tasksNew.length) * 100) : null,
  };
}

/** 7/30 天按天画，90 天按周画 —— 90 根柱子太密，看不出形状 */
function trendOf(entries, start, days) {
  const buckets = [];
  if (days <= 30) {
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start.getTime());
      d.setDate(d.getDate() + i);
      buckets.push({ key: dayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 });
    }
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    for (const e of entries) {
      const i = index.get(dayKey(e.created_at));
      if (i != null) buckets[i].count += 1;
    }
    return { unit: '天', items: buckets };
  }

  const weeks = Math.ceil(days / 7);
  for (let i = 0; i < weeks; i += 1) {
    const from = new Date(start.getTime() + i * 7 * DAY_MS);
    const to = new Date(Math.min(from.getTime() + 6 * DAY_MS, start.getTime() + (days - 1) * DAY_MS));
    buckets.push({
      key: String(i),
      label: `${from.getMonth() + 1}/${from.getDate()}`,
      count: 0,
      from,
      to,
    });
  }
  for (const e of entries) {
    const t = new Date(e.created_at).getTime();
    const i = Math.min(buckets.length - 1, Math.floor((t - start.getTime()) / (7 * DAY_MS)));
    if (buckets[i]) buckets[i].count += 1;
  }
  return { unit: '周', items: buckets };
}

/* ---------------- 整体替换 / 导入 ---------------- */

export async function replaceAll({ entries, tasks }) {
  await db.replaceAll('entries', entries);
  await db.replaceAll('tasks', tasks);
  state.entries = [...entries].sort(byCreatedDesc);
  state.tasks = [...tasks].sort(byCreatedDesc);
  gramCache.clear();
  notify();
}

/** 合并导入：同 id 以文件里的为准，其余追加 */
export async function mergeIn({ entries, tasks }) {
  const entryMap = new Map(state.entries.map((e) => [e.id, e]));
  const taskMap = new Map(state.tasks.map((t) => [t.id, t]));
  entries.forEach((e) => entryMap.set(e.id, e));
  tasks.forEach((t) => taskMap.set(t.id, t));

  const nextEntries = [...entryMap.values()];
  const nextTasks = [...taskMap.values()];
  await db.replaceAll('entries', nextEntries);
  await db.replaceAll('tasks', nextTasks);
  state.entries = nextEntries.sort(byCreatedDesc);
  state.tasks = nextTasks.sort(byCreatedDesc);
  gramCache.clear();
  notify();
  return { entries: entries.length, tasks: tasks.length };
}

export async function wipeAll() {
  await db.wipe();
  state.entries = [];
  state.tasks = [];
  state.filters = { kind: 'all', tag: '', q: '' };
  state.listLimit = 100;
  state.activeId = null;
  gramCache.clear();
  notify();
}
