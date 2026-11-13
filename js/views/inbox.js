/** 收件箱：随手记 + 检索 + 列表 */
import { state, KIND_META, KIND_ORDER } from '../state.js';
import { esc, hl, clip, fmtTime, dayLabel, dueLabel, toast, debounce, autosize } from '../util.js';
import { capture, editEntry, tasksOfEntry, tagsRanked, overview } from '../data.js';
import { openEntry } from '../drawer.js';

const $ = (id) => document.getElementById(id);

let composer;
let captureEl;
let submitting = false;
let pickedKind = 'idea';
const seenIds = new Set();

export function initInbox() {
  composer = $('composer');
  captureEl = $('capture');
  autosize(captureEl, 200);

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  captureEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  $('kind-pick').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    pickedKind = btn.dataset.kind;
    [...$('kind-pick').children].forEach((el) => el.classList.toggle('on', el === btn));
  });

  const search = $('search');
  const clear = $('search-clear');
  const run = debounce(() => {
    state.filters.q = search.value.trim();
    state.listLimit = 100;
    clear.hidden = !search.value;
    renderList();
  }, 160);
  search.addEventListener('input', run);
  clear.addEventListener('click', () => {
    search.value = '';
    state.filters.q = '';
    state.listLimit = 100;
    clear.hidden = true;
    renderList();
    search.focus();
  });

  $('kind-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    state.filters.kind = btn.dataset.kind;
    state.listLimit = 100;
    renderKinds();
    renderList();
  });

  $('tag-row').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tag]');
    if (!btn) return;
    state.filters.tag = state.filters.tag === btn.dataset.tag ? '' : btn.dataset.tag;
    state.listLimit = 100;
    renderTags();
    renderList();
  });

  $('entry-list').addEventListener('click', (e) => {
    const more = e.target.closest('[data-load-more]');
    if (more) {
      state.listLimit += 100;
      renderList();
      return;
    }
    if (e.target.closest('[data-clear-filter]')) {
      resetFilters();
      return;
    }
    const sug = e.target.closest('[data-suggest-tag]');
    if (sug) {
      state.filters.tag = sug.dataset.suggestTag;
      state.filters.q = '';
      state.filters.kind = 'all';
      const s = $('search');
      if (s) s.value = '';
      $('search-clear').hidden = true;
      renderKinds();
      renderTags();
      renderList();
      return;
    }
    const card = e.target.closest('.entry');
    if (card) openEntry(card.dataset.id);
  });

  $('entry-list').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.entry');
    if (!card) return;
    e.preventDefault();
    openEntry(card.dataset.id);
  });

  $('load-sample').addEventListener('click', loadSamples);
}

function resetFilters() {
  state.filters = { kind: 'all', tag: '', q: '' };
  state.listLimit = 100;
  const s = $('search');
  if (s) s.value = '';
  $('search-clear').hidden = true;
  renderKinds();
  renderTags();
  renderList();
}

async function submit() {
  const raw = captureEl.value.trim();
  if (!raw) { captureEl.focus(); return; }
  if (submitting) return;

  submitting = true;
  const btn = $('capture-btn');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    await capture(raw, pickedKind);
    captureEl.value = '';
    captureEl.style.height = 'auto';
    state.filters = { kind: 'all', tag: '', q: '' };
    const s = $('search');
    if (s) { s.value = ''; $('search-clear').hidden = true; }
    toast('已收进收件箱', 'ok');
    if (state.route !== 'inbox') location.hash = '#/inbox';
    setTimeout(() => captureEl.focus(), 60);
  } catch (err) {
    toast(err.message || '保存失败，请重试', 'err');
  } finally {
    submitting = false;
    btn.disabled = false;
    btn.textContent = '记下来';
  }
}

export function focusCapture() {
  if (state.route !== 'inbox') location.hash = '#/inbox';
  setTimeout(() => {
    const el = $('capture');
    if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, 80);
}

/* ---------------- 渲染 ---------------- */

export function renderInbox() {
  renderSummary();
  renderKinds();
  renderTags();
  renderList();
}

function renderSummary() {
  const bar = $('summary-bar');
  if (!bar) return;
  const { total, open, week } = overview();

  if (!total) {
    bar.innerHTML = '<span class="dot"></span><span>随手写下来，之后就靠搜索和标签把它找回来。</span>';
    return;
  }

  const bits = [`已收 <b>${total}</b> 条`];
  if (week) bits.push(`本周 <b>${week}</b> 条`);
  if (open) bits.push(`<b>${open}</b> 条待办未完成`);

  bar.innerHTML = `
    <span class="dot"></span>
    <span>${bits.join(' · ')}</span>
    <div class="summary-actions">
      <button data-goto-review>看回顾</button>
    </div>`;
}

function renderKinds() {
  const box = $('kind-filter');
  const bar = box.closest('.toolbar');
  if (!state.entries.length) {          // 一条记录都没有时，筛选行没有意义
    box.innerHTML = '';
    if (bar) bar.hidden = true;
    return;
  }
  if (bar) bar.hidden = false;

  const counts = { all: state.entries.length };
  state.entries.forEach((e) => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
  const items = [['all', '全部'], ...KIND_ORDER.map((k) => [k, KIND_META[k].label])];
  box.innerHTML = items.map(([k, label]) => {
    const n = counts[k] || 0;
    if (k !== 'all' && !n) return '';
    return `<button data-kind="${k}" class="${state.filters.kind === k ? 'on' : ''}">${label}<em>${n}</em></button>`;
  }).join('');
}

function renderTags() {
  const box = $('tag-row');
  const tags = tagsRanked(10);
  if (!tags.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<span class="lbl">标签</span>' + tags.map((t) => (
    `<button data-tag="${esc(t.name)}" class="${state.filters.tag === t.name ? 'on' : ''}">${esc(t.name)} <span style="opacity:.55">${t.count}</span></button>`
  )).join('');
}

function matches(e, terms) {
  if (!terms.length) return true;
  const hay = [e.title, e.summary, e.raw, (e.tags || []).join(' '), (e.key_points || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase();
  return terms.every((t) => hay.includes(t.toLowerCase()));
}

function filtered() {
  const { kind, tag, q } = state.filters;
  const terms = q.trim().split(/\s+/).filter(Boolean);
  return state.entries.filter((e) => {
    if (kind !== 'all' && e.kind !== kind) return false;
    if (tag && !(e.tags || []).includes(tag)) return false;
    return matches(e, terms);
  });
}

export function renderList() {
  const list = $('entry-list');
  const empty = $('inbox-empty');
  const meta = $('list-meta');
  const rows = filtered();
  const terms = state.filters.q.trim().split(/\s+/).filter(Boolean);

  if (!state.entries.length) {
    list.innerHTML = '';
    empty.hidden = false;
    if (meta) meta.textContent = '';
    return;
  }
  empty.hidden = true;

  if (meta) {
    const bits = [`共 ${state.entries.length} 条`];
    if (rows.length !== state.entries.length) bits.push(`筛出 ${rows.length} 条`);
    if (terms.length) bits.push(`关键词：${terms.join(' + ')}`);
    meta.textContent = bits.join(' · ');
  }

  if (!rows.length) {
    const tags = tagsRanked(5);
    list.innerHTML = `<div class="empty" style="padding:36px 12px 28px">
      <h3 style="font-size:14px">没有匹配的记录</h3>
      <p>换个关键词，或者清掉现在的筛选条件。</p>
      ${tags.length ? `<div class="suggest">${tags.map((t) => `<button class="ghost sm" data-suggest-tag="${esc(t.name)}">${esc(t.name)}</button>`).join('')}</div>` : ''}
      <button class="ghost" data-clear-filter>清空筛选</button>
    </div>`;
    return;
  }

  const visible = rows.slice(0, state.listLimit);
  const groups = new Map();
  visible.forEach((e) => {
    const key = dayLabel(e.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  let html = '';
  let idx = 0;
  for (const [label, items] of groups) {
    html += `<div class="day-label">${esc(label)}</div>`;
    for (const e of items) {
      html += cardHtml(e, terms, idx);
      idx += 1;
    }
  }

  if (rows.length > visible.length) {
    html += `<div class="load-more">
      <button class="ghost" data-load-more>显示更多</button>
      <span>已显示 ${visible.length} / ${rows.length} 条</span>
    </div>`;
  }

  list.innerHTML = html;
}

function cardHtml(e, terms, idx) {
  const m = KIND_META[e.kind] || KIND_META.note;
  const open = tasksOfEntry(e.id).filter((t) => t.status !== 'done');
  const due = open.map((t) => dueLabel(t.due_date)).filter(Boolean)[0];
  const firstTime = !seenIds.has(e.id);
  seenIds.add(e.id);
  const anim = firstTime ? `animation-delay:${Math.min(idx * 18, 220)}ms` : 'animation:none';

  const tags = (e.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const metaBits = open.length
    ? `<span class="mini"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>${open.length} 条待办${due ? ` · ${due.text}` : ''}</span>`
    : '';

  return `
  <article class="entry" data-id="${esc(e.id)}" tabindex="0" style="${anim}">
    <div class="entry-top">
      <span class="kind ${m.cls}">${m.label}</span>
      <h3>${hl(e.title || clip(e.raw, 30), terms)}</h3>
      <time>${fmtTime(e.created_at)}</time>
    </div>
    <p class="entry-sum">${hl(e.summary || clip(e.raw, 110), terms)}</p>
    <div class="entry-foot">
      ${tags ? `<span class="foot-group">${tags}</span>` : ''}
      ${metaBits ? `<span class="foot-group">${metaBits}</span>` : ''}
    </div>
  </article>`;
}

/* ---------------- 示例 ---------------- */

const SAMPLES = [
  {
    kind: 'idea',
    text: '想做一个只给自己用的信息收件箱：随手记下来 → 自己归个类 → 以后靠搜索找回来。先不做多端同步，重点是把「记完就忘」这件事解决掉。',
    tags: ['产品', '信息管理'],
    summary: '先解决「记完就忘」，功能从简，重点是记录到复用的闭环。',
  },
  {
    kind: 'quote',
    text: '读《卡片笔记写作法》记下的一句：真正有用的不是收藏了多少，而是把新笔记和旧笔记连起来。所以检索不是关键，关联才是。',
    tags: ['读书', '方法'],
    summary: '收藏不等于记住，笔记的价值在于相互连接。',
  },
  {
    kind: 'task',
    text: '周五之前把产品原型的第一版画出来，重点是记录流的交互，不要在配色上花时间。',
    tags: ['产品'],
    summary: '原型第一版，聚焦记录流交互。',
  },
  {
    kind: 'link',
    text: 'https://www.nngroup.com/articles/progressive-disclosure/ 渐进式披露：先给最少的信息，让用户按需展开。详情面板的层级可以照这个思路做。',
    tags: ['设计', '参考'],
    summary: '渐进式披露：默认少给，按需展开。',
  },
];

async function loadSamples() {
  const btn = $('load-sample');
  btn.disabled = true;
  btn.textContent = '正在载入…';
  try {
    for (const s of SAMPLES) {
      const entry = await capture(s.text, s.kind);
      await editEntry(entry.id, { tags: s.tags, summary: s.summary });
    }
    toast('已载入 4 条示例，点开任意一条可以编辑', 'ok');
  } catch (err) {
    toast(err.message || '载入失败', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '再载入几条示例';
  }
}
