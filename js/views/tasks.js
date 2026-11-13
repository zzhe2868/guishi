/** 待办：清单 + 行内改优先级 / 截止日 / 标题 */
import { state } from '../state.js';
import { esc, toast, dueLabel, clip, relTime } from '../util.js';
import { addTask, toggleTask, removeTask, openTasks, findEntry, patchTask } from '../data.js';
import { openEntry } from '../drawer.js';

const $ = (id) => document.getElementById(id);

const PRIO_LABEL = { high: '高优', normal: '普通', low: '低' };
const PRIO_NEXT = { high: 'normal', normal: 'low', low: 'high' };
const PRIO_ORDER = { high: 0, normal: 1, low: 2 };

export function initTasks() {
  $('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('task-input');
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    try {
      await addTask(title);
    } catch (err) {
      toast(err.message || '添加失败', 'err');
      input.value = title;
    }
  });

  $('task-groups').addEventListener('click', async (e) => {
    const check = e.target.closest('.check');
    if (check) {
      const id = check.closest('.task').dataset.id;
      try {
        await toggleTask(id);
      } catch (err) {
        toast(err.message || '操作失败', 'err');
      }
      return;
    }

    const prio = e.target.closest('[data-prio]');
    if (prio) {
      const id = prio.closest('.task').dataset.id;
      const next = PRIO_NEXT[prio.dataset.prio] || 'normal';
      try {
        await patchTask(id, { priority: next });
      } catch (err) {
        toast(err.message || '改优先级失败', 'err');
      }
      return;
    }

    const link = e.target.closest('a[data-entry]');
    if (link) {
      e.preventDefault();
      openEntry(link.dataset.entry);
      return;
    }

    const del = e.target.closest('button[data-del]');
    if (del) {
      const id = del.dataset.del;
      try {
        await removeTask(id);
        toast('已移除', 'ok');
      } catch (err) {
        toast(err.message || '删除失败', 'err');
      }
    }
  });

  $('task-groups').addEventListener('change', async (e) => {
    const due = e.target.closest('[data-due]');
    if (!due) return;
    const id = due.closest('.task').dataset.id;
    try {
      await patchTask(id, { due_date: due.value || null });
      toast(due.value ? '截止日已更新' : '已清掉截止日', 'ok');
    } catch (err) {
      toast(err.message || '改截止日失败', 'err');
    }
  });

  // 标题行内编辑：回车提交，Esc 放弃
  $('task-groups').addEventListener('keydown', (e) => {
    const t = e.target.closest('[data-edit-title]');
    if (!t) return;
    if (e.key === 'Enter') { e.preventDefault(); t.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); t.textContent = t.dataset.orig || t.textContent; t.blur(); }
  });

  $('task-groups').addEventListener('focusin', (e) => {
    const t = e.target.closest('[data-edit-title]');
    if (t) t.dataset.orig = t.textContent;
  });

  $('task-groups').addEventListener('focusout', async (e) => {
    const t = e.target.closest('[data-edit-title]');
    if (!t) return;
    const id = t.closest('.task').dataset.id;
    const cur = state.tasks.find((x) => x.id === id);
    const title = t.textContent.replace(/\s+/g, ' ').trim();
    if (!title) { if (cur) t.textContent = cur.title; return; }
    if (cur && title === cur.title) return;
    try {
      await patchTask(id, { title });
      toast('已改好', 'ok');
    } catch (err) {
      toast(err.message || '改标题失败', 'err');
      if (cur) t.textContent = cur.title;
    }
  });
}

export function renderTasks() {
  // 正在行内编辑时别重绘，否则输入到一半会被冲掉
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('#task-groups') && (ae.isContentEditable || ae.tagName === 'INPUT')) return;

  const box = $('task-groups');
  const open = openTasks().slice();
  const done = state.tasks.filter((t) => t.status === 'done');

  open.sort((a, b) => {
    const p = (PRIO_ORDER[a.priority] ?? 1) - (PRIO_ORDER[b.priority] ?? 1);
    if (p) return p;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  done.sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at));

  if (!state.tasks.length) {
    box.innerHTML = `<div class="empty">
      <div class="empty-mark">办</div>
      <h3>还没有待办</h3>
      <p>在上面直接加一条；或者打开任意一条记录，<br>用「设为待办」把它挂过来。</p>
    </div>`;
    return;
  }

  const section = (title, items, count) => `
    <section class="task-group">
      <h2>${title}<em>${count}</em></h2>
      ${items.length ? items.map(taskRow).join('') : '<p style="color:var(--muted-2);font-size:12px;padding:2px 2px 6px">暂无</p>'}
    </section>`;

  box.innerHTML = [
    section('待办', open, open.length),
    done.length ? section('已完成', done.slice(0, 20), done.length) : '',
  ].join('');
}

function taskRow(t) {
  const done = t.status === 'done';
  const due = dueLabel(t.due_date);
  const entry = t.entry_id ? findEntry(t.entry_id) : null;
  return `<div class="task ${done ? 'done' : ''}" data-id="${esc(t.id)}">
    <button class="check" aria-label="${done ? '标记未完成' : '标记完成'}">
      <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
    </button>
    <div class="task-body">
      <div class="task-title" data-edit-title ${done ? '' : 'contenteditable="true" spellcheck="false" title="点一下可以改"'}>${esc(t.title)}</div>
      <div class="task-meta">
        ${done ? `<span>完成于 ${relTime(t.completed_at || t.created_at)}</span>` : `
          <button class="prio-btn ${t.priority || 'normal'}" data-prio="${t.priority || 'normal'}" title="点击切换优先级">${PRIO_LABEL[t.priority] || '普通'}</button>
          <label class="due-edit ${due ? due.cls : 'none'}" title="${due ? due.text : '设置截止日'}">
            <input type="date" data-due value="${t.due_date || ''}" aria-label="截止日">
          </label>`}
        ${entry ? `<a href="#/inbox" data-entry="${esc(entry.id)}">来自《${esc(clip(entry.title || entry.raw, 18))}》</a>` : ''}
        ${!done ? `<button class="link-btn" data-del="${esc(t.id)}" style="margin-left:auto;font-size:10.5px">移除</button>` : ''}
      </div>
    </div>
  </div>`;
}
