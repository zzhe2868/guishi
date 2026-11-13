/** 右侧详情抽屉：看、改、设为待办、删除 */
import { state, KIND_META, KIND_ORDER } from './state.js';
import { esc, fmtTime, dayLabel, confirmDialog, toast, clip } from './util.js';
import {
  findEntry, tasksOfEntry, relatedOf, removeEntry, toggleTask,
  editEntry, addTaskFromEntry, subscribe,
} from './data.js';

const drawer = document.getElementById('drawer');
const mask = document.getElementById('drawer-mask');

let current = null;   // 当前打开的记录 id
let lastSig = '';     // 上次渲染的数据指纹，内容没变就不重绘

export function openEntry(id) {
  const entry = findEntry(id);
  if (!entry) { toast('这条记录已经不在了', 'err'); return; }
  state.activeId = id;
  current = id;
  lastSig = '';
  paint(entryHtml(entry));
}

export function closeDrawer() {
  drawer.classList.remove('open');
  mask.hidden = true;
  setTimeout(() => {
    if (!drawer.classList.contains('open')) {
      drawer.hidden = true;
      drawer.innerHTML = '';
    }
  }, 240);
  current = null;
  lastSig = '';
  state.activeId = null;
}

/** 数据变了就地重绘：正在编辑时不打扰，内容没变时不重绘 */
export function refreshDrawer() {
  if (!current) return;
  const form = drawer.querySelector('[data-edit-form]');
  if (form && !form.hidden) return;
  const entry = findEntry(current);
  if (!entry) { closeDrawer(); return; }
  const sig = signature(entry);
  if (sig === lastSig) return;
  paint(entryHtml(entry));
}

function signature(entry) {
  const tasks = tasksOfEntry(entry.id).map((t) => `${t.id}:${t.status}:${t.title}`);
  return [
    entry.id, entry.title, entry.kind, entry.summary,
    (entry.tags || []).join('|'), (entry.key_points || []).join('|'),
    entry.raw, entry.updated_at, tasks.join(','),
  ].join('§');
}

function paint(html) {
  const keep = drawer.scrollTop;
  drawer.hidden = false;
  mask.hidden = false;
  drawer.innerHTML = html;
  drawer.scrollTop = keep;
  requestAnimationFrame(() => drawer.classList.add('open'));
  const entry = current ? findEntry(current) : null;
  if (entry) lastSig = signature(entry);
}

function entryHtml(entry) {
  const m = KIND_META[entry.kind] || KIND_META.note;
  const tasks = tasksOfEntry(entry.id);
  const related = relatedOf(entry.id);
  const d = new Date(entry.created_at);
  const openTask = tasks.find((t) => t.status !== 'done');

  const head = `
    <div class="dw-top">
      <span class="kind ${m.cls}">${m.label}</span>
      <span class="mini">${dayLabel(d)} ${fmtTime(d)}</span>
      <span class="spacer"></span>
      <button class="dw-close" data-act="close" aria-label="关闭">×</button>
    </div>
    <h2 class="dw-title">${esc(entry.title || clip(entry.raw, 30))}</h2>
    <div class="dw-meta">
      ${(entry.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
    </div>`;

  const editForm = `
    <form class="dw-edit" data-edit-form hidden>
      <label class="dw-field">
        <span>标题</span>
        <input name="title" maxlength="60" value="${esc(entry.title || clip(entry.raw, 40))}">
      </label>
      <label class="dw-field">
        <span>分类</span>
        <select name="kind">
          ${KIND_ORDER.map((k) => `<option value="${k}" ${entry.kind === k ? 'selected' : ''}>${KIND_META[k].label}</option>`).join('')}
        </select>
      </label>
      <label class="dw-field">
        <span>标签（用逗号或空格分开，最多 6 个）</span>
        <input name="tags" value="${esc((entry.tags || []).join('、'))}">
      </label>
      <label class="dw-field">
        <span>摘要（列表里显示这一行，留空就显示原文开头）</span>
        <textarea name="summary" rows="2" maxlength="400">${esc(entry.summary || '')}</textarea>
      </label>
      <label class="dw-field">
        <span>要点（每行一条，可留空）</span>
        <textarea name="points" rows="3">${esc((entry.key_points || []).join('\n'))}</textarea>
      </label>
      <div class="dw-edit-actions">
        <button type="button" class="ghost sm" data-act="edit-cancel">取消</button>
        <button type="submit" class="primary sm">保存</button>
      </div>
    </form>`;

  const summary = entry.summary
    ? `<div class="dw-sec dw-view">
         <h5>摘要</h5>
         <p class="dw-summary">${esc(entry.summary)}</p>
       </div>`
    : '';

  const points = (entry.key_points || []).length
    ? `<div class="dw-sec dw-view">
         <h5>要点</h5>
         <ul class="dw-points">${entry.key_points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
       </div>`
    : '';

  const raw = `<div class="dw-sec dw-view">
      <h5>原始记录</h5>
      <pre class="dw-raw">${esc(entry.raw)}</pre>
    </div>`;

  const taskBlock = tasks.length
    ? `<div class="dw-sec">
        <h5>相关待办</h5>
        ${tasks.map((t) => `
          <div class="dw-task ${t.status === 'done' ? 'done' : ''}">
            <span class="txt">${esc(t.title)}</span>
            <button class="bt" data-task="${esc(t.id)}">${t.status === 'done' ? '撤销完成' : '标记完成'}</button>
          </div>`).join('')}
      </div>`
    : '';

  const relBlock = related.length
    ? `<div class="dw-sec dw-view">
        <h5>相关记录</h5>
        ${related.map((r) => `
          <button class="related" data-open="${esc(r.entry.id)}">
            <b>${esc(r.entry.title || clip(r.entry.raw, 24))}</b>
            <span>${esc(clip(r.entry.summary || r.entry.raw, 60))}</span>
            <em>↳ ${esc(r.reason)}</em>
          </button>`).join('')}
      </div>`
    : `<div class="dw-sec dw-view">
        <h5>相关记录</h5>
        <p class="dw-hint">还没有相近的记录。多写几条，或者给它们打上同一个标签。</p>
      </div>`;

  return `<div class="drawer-inner">
    ${head}
    ${editForm}
    ${summary}
    ${points}
    ${raw}
    ${taskBlock}
    ${relBlock}
    <div class="dw-actions">
      <button class="ghost" data-act="edit">编辑</button>
      <button class="ghost" data-act="to-task" ${openTask ? 'disabled title="已经有一条未完成的待办了"' : ''}>
        ${openTask ? '已在待办中' : '设为待办'}
      </button>
      <button class="ghost" data-act="copy">复制原文</button>
      <span class="spacer"></span>
      <button class="link-btn" data-act="delete">删除</button>
    </div>
  </div>`;
}

/* ---------------- 事件 ---------------- */

mask.addEventListener('click', closeDrawer);

drawer.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-edit-form]');
  if (!form) return;
  e.preventDefault();
  if (!current) return;

  const fd = new FormData(form);
  const tags = String(fd.get('tags') || '')
    .split(/[,，、\s]+/)
    .map((t) => t.trim().slice(0, 12))
    .filter(Boolean)
    .slice(0, 6);

  const points = String(fd.get('points') || '')
    .split('\n')
    .map((p) => p.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 8);

  const patch = {
    title: String(fd.get('title') || '').trim().slice(0, 60) || null,
    kind: KIND_META[fd.get('kind')] ? fd.get('kind') : 'note',
    tags: [...new Set(tags)],
    summary: String(fd.get('summary') || '').trim().slice(0, 400) || null,
    key_points: points,
  };

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    await editEntry(current, patch);
    toast('已保存', 'ok');
    lastSig = '';
    const entry = findEntry(current);
    if (entry) paint(entryHtml(entry));
  } catch (err) {
    toast(err.message || '保存失败', 'err');
    btn.disabled = false;
    btn.textContent = '保存';
  }
});

drawer.addEventListener('click', async (e) => {
  const closeBtn = e.target.closest('[data-act="close"]');
  if (closeBtn) { closeDrawer(); return; }

  const openBtn = e.target.closest('[data-open]');
  if (openBtn) { openEntry(openBtn.dataset.open); return; }

  const taskBtn = e.target.closest('[data-task]');
  if (taskBtn) {
    try {
      await toggleTask(taskBtn.dataset.task);
      lastSig = '';
      refreshDrawer();
    } catch (err) {
      toast(err.message || '操作失败', 'err');
    }
    return;
  }

  const act = e.target.closest('[data-act]');
  if (!act || !current) return;

  if (act.dataset.act === 'edit') {
    const form = drawer.querySelector('[data-edit-form]');
    if (!form) return;
    const opening = form.hidden;
    form.hidden = !opening;
    drawer.querySelectorAll('.dw-view').forEach((el) => { el.hidden = opening; });
    act.textContent = opening ? '收起编辑' : '编辑';
    act.classList.toggle('on', opening);
    if (opening) form.querySelector('input[name="title"]').focus();
    return;
  }

  if (act.dataset.act === 'edit-cancel') {
    const form = drawer.querySelector('[data-edit-form]');
    if (form) {
      form.hidden = true;
      drawer.querySelectorAll('.dw-view').forEach((el) => { el.hidden = false; });
      const btn = drawer.querySelector('[data-act="edit"]');
      if (btn) { btn.textContent = '编辑'; btn.classList.remove('on'); }
    }
    return;
  }

  if (act.dataset.act === 'to-task') {
    act.disabled = true;
    try {
      await addTaskFromEntry(current);
      toast('已加进待办', 'ok');
      lastSig = '';
      refreshDrawer();
    } catch (err) {
      toast(err.message || '添加失败', 'err');
      act.disabled = false;
    }
    return;
  }

  if (act.dataset.act === 'copy') {
    const entry = findEntry(current);
    if (entry) copy(entry.raw);
    return;
  }

  if (act.dataset.act === 'delete') {
    const ok = await confirmDialog('删除这条记录？它挂着的待办会保留下来，只是不再显示来源。此操作无法恢复。', { okText: '删除' });
    if (!ok) return;
    try {
      await removeEntry(current);
      closeDrawer();
      toast('已删除', 'ok');
    } catch (err) {
      toast(err.message || '删除失败', 'err');
    }
  }
});

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text || '');
    toast('已复制', 'ok');
  } catch {
    toast('浏览器不允许自动复制，请手动选取', 'err');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
});

// Tab 不要跑出抽屉
drawer.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const focusables = [...drawer.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

subscribe(() => refreshDrawer());
