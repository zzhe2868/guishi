/** 运行时状态：视图只从这里读，改动统一走 data.js */

export const state = {
  ready: false,          // 首次加载是否完成
  error: '',             // 启动失败的原因

  entries: [],
  tasks: [],

  filters: { kind: 'all', tag: '', q: '' },
  listLimit: 100,        // 列表一次渲染多少条（纯渲染优化，不影响检索范围）

  activeId: null,
  route: 'inbox',

  reviewDays: 7,         // 回顾区间：7 / 30 / 90 / 0（全部）
  storage: null,         // { used, quota } | null
};

export const KIND_META = {
  idea: { label: '想法', cls: 'k-idea' },
  note: { label: '资料', cls: 'k-note' },
  task: { label: '待办', cls: 'k-task' },
  link: { label: '链接', cls: 'k-link' },
  quote: { label: '摘录', cls: 'k-quote' },
};

export const KIND_ORDER = ['idea', 'note', 'task', 'link', 'quote'];

export const ROUTES = ['inbox', 'tasks', 'review'];
