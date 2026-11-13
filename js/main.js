/** 应用外壳：启动、路由、快捷键、备份菜单 */
import { state, ROUTES } from './state.js';
import * as data from './data.js';
import * as backup from './backup.js';
import * as db from './db.js';
import { toast, confirmDialog, fmtBytes } from './util.js';
import { initTags, openTagManager } from './tags.js';
import { initInbox, renderInbox, focusCapture } from './views/inbox.js';
import { initTasks, renderTasks } from './views/tasks.js';
import { initReview, renderReview } from './views/review.js';

const $ = (id) => document.getElementById(id);

/* ---------------- 启动 ---------------- */

(async function boot() {
  try {
    await db.openDB();
  } catch (err) {
    showFatal(err);
    return;
  }

  initInbox();
  initTasks();
  initReview();
  initTags();
  bindShell();
  window.addEventListener('hashchange', route);

  try {
    await data.loadAll();
  } catch (err) {
    toast(err.message || '读取本地数据失败', 'err');
  }

  data.subscribe(renderCurrent);
  state.ready = true;
  $('app').hidden = false;
  renderCurrent();
  route();
  refreshUsage();
})();

function showFatal(err) {
  const box = $('fatal');
  const msg = $('fatal-msg');
  if (msg) msg.textContent = (err && err.message) || '本地数据库打不开，可能是不支持或存储被禁用。';
  if (box) box.hidden = false;
}

/* ---------------- 外壳 ---------------- */

function bindShell() {
  $('nav-capture').addEventListener('click', focusCapture);

  $('btn-tags').addEventListener('click', openTagManager);

  $('btn-backup').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('backup-menu');
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#backup-menu') && !e.target.closest('#btn-backup')) {
      $('backup-menu').hidden = true;
    }
  });

  $('backup-menu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-backup]');
    if (!btn) return;
    $('backup-menu').hidden = true;
    const kind = btn.dataset.backup;
    if (kind === 'import') { $('import-file').click(); return; }
    if (kind === 'wipe') { wipe(); return; }
    doExport(kind);
  });

  $('import-file').addEventListener('change', onImport);

  // 收件箱顶部「看回顾」：用事件委托，因为那颗按钮是渲染出来的
  $('summary-bar').addEventListener('click', (e) => {
    if (e.target.closest('[data-goto-review]')) location.hash = '#/review';
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const tag = (t.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;

    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      focusCapture();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (state.route !== 'inbox') location.hash = '#/inbox';
      setTimeout(() => {
        const el = $('search');
        if (el) { el.focus(); el.select(); }
      }, 120);
    }
  });
}

function doExport(kind) {
  const payload = { entries: state.entries, tasks: state.tasks };
  if (!payload.entries.length && !payload.tasks.length) {
    toast('还没有可导出的内容', 'err');
    return;
  }
  try {
    if (kind === 'json') {
      backup.download(backup.fileName('backup', 'json'), backup.buildJson(payload), 'application/json;charset=utf-8');
      toast(`已导出 ${payload.entries.length} 条记录（JSON）`, 'ok');
    } else {
      backup.download(backup.fileName('notes', 'md'), backup.buildMarkdown(payload), 'text/markdown;charset=utf-8');
      toast(`已导出 ${payload.entries.length} 条记录（Markdown）`, 'ok');
    }
  } catch (err) {
    toast(err.message || '导出失败', 'err');
  }
}

async function onImport(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';   // 允许再次选同一个文件
  if (!file) return;

  try {
    const parsed = backup.parseBackup(await file.text());
    const ok = await confirmDialog(
      `导入 ${parsed.entries.length} 条记录、${parsed.tasks.length} 条待办？\n同 id 的内容会用文件里的版本覆盖，其余追加。`,
      { okText: '导入', danger: false },
    );
    if (!ok) return;
    const result = await data.mergeIn(parsed);
    toast(`已导入 ${result.entries} 条记录、${result.tasks} 条待办`, 'ok');
    refreshUsage();
  } catch (err) {
    toast(err.message || '导入失败', 'err');
  }
}

async function wipe() {
  const ok = await confirmDialog('清空全部本地数据？记录和待办都会删掉，建议先导出备份。此操作无法恢复。', { okText: '清空' });
  if (!ok) return;
  try {
    await data.wipeAll();
    toast('已清空', 'ok');
    refreshUsage();
  } catch (err) {
    toast(err.message || '清空失败', 'err');
  }
}

async function refreshUsage() {
  state.storage = await db.usage();
  paintStatus();
}

function paintStatus() {
  const text = $('local-status-text');
  if (!text) return;
  const used = state.storage ? ` · ${fmtBytes(state.storage.used)}` : '';
  text.textContent = `本地存储 · ${state.entries.length} 条${used}`;
}

/* ---------------- 路由与渲染 ---------------- */

function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'inbox').split('?')[0];
  state.route = ROUTES.includes(name) ? name : 'inbox';

  document.querySelectorAll('.view').forEach((v) => {
    v.hidden = v.dataset.view !== state.route;
  });
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('on', a.dataset.route === state.route);
  });

  renderCurrent();
  if (state.route !== 'inbox') {
    const view = document.querySelector(`.view[data-view="${state.route}"]`);
    if (view) view.scrollTop = 0;
  }
}

function renderCurrent() {
  updateCounts();
  paintStatus();
  if (!state.ready) return;
  if (state.route === 'inbox') renderInbox();
  else if (state.route === 'tasks') renderTasks();
  else if (state.route === 'review') renderReview();
}

function updateCounts() {
  const inbox = $('nav-count-inbox');
  const tasks = $('nav-count-tasks');
  if (inbox) inbox.textContent = state.entries.length > 99 ? '99+' : (state.entries.length || '');
  const open = data.openTasks().length;
  if (tasks) tasks.textContent = open > 99 ? '99+' : (open || '');
}
