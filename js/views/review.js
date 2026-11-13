/** 回顾：把区间内的记录和待办数一遍，全部是本地计数，没有任何推测 */
import { state, KIND_META, KIND_ORDER } from '../state.js';
import { esc, toast, fmtTime, dayLabel, dueLabel } from '../util.js';
import { reviewData } from '../data.js';
import * as backup from '../backup.js';
import { openEntry } from '../drawer.js';

const $ = (id) => document.getElementById(id);

export function initReview() {
  $('review-range').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-days]');
    if (!btn) return;
    state.reviewDays = Number(btn.dataset.days);
    [...$('review-range').children].forEach((x) => x.classList.toggle('on', x === btn));
    renderReview();
  });

  $('review-export').addEventListener('click', () => {
    try {
      const review = reviewData(state.reviewDays);
      const md = backup.buildReviewMarkdown(review);
      backup.download(backup.fileName('review', 'md'), md, 'text/markdown;charset=utf-8');
      toast('已导出这份回顾', 'ok');
    } catch (err) {
      toast(err.message || '导出失败', 'err');
    }
  });

  $('review-body').addEventListener('click', (e) => {
    const item = e.target.closest('[data-entry]');
    if (item) openEntry(item.dataset.entry);
  });
}

export function renderReview() {
  const review = reviewData(state.reviewDays);
  $('review-body').innerHTML = [
    statGrid(review),
    block('分类分布', bars(
      KIND_ORDER.filter((k) => review.kinds[k])
        .map((k) => ({ label: KIND_META[k].label, value: review.kinds[k] })),
    )),
    block('标签', bars(review.tags.map((t) => ({ label: t.name, value: t.count })))),
    block('记录节奏', spark(review.trend)),
    block('这段时间的记录', dayList(review)),
    block('还没做完的事', openList(review)),
  ].join('');
}

function statGrid(review) {
  const done = review.tasksNew.length ? `${review.tasksDone.length}/${review.tasksNew.length}` : '0';
  return `<div class="stat-grid">
    <div class="stat"><b>${review.total}</b><span>新增记录</span></div>
    <div class="stat"><b>${review.activeDays}</b><span>有记录的天数</span></div>
    <div class="stat"><b>${done}</b><span>新建待办 / 已完成</span></div>
    <div class="stat"><b class="${review.overdue.length ? 'warn' : ''}">${review.open.length}</b><span>未完成${review.overdue.length ? `（逾期 ${review.overdue.length}）` : ''}</span></div>
  </div>`;
}

function block(title, body) {
  return `<section class="rv-block">
    <h2>${title}</h2>
    ${body}
  </section>`;
}

function bars(items) {
  if (!items.length) return '<p class="rv-empty">这段时间没有可统计的内容</p>';
  const max = Math.max(...items.map((i) => i.value));
  return `<div class="bars">${items.map((it) => `
    <div class="bar-row">
      <span class="bar-label">${esc(it.label)}</span>
      <span class="bar-track"><i style="width:${Math.max(3, Math.round((it.value / max) * 100))}%"></i></span>
      <span class="bar-num">${it.value}</span>
    </div>`).join('')}</div>`;
}

function spark(trend) {
  const { items, unit } = trend;
  if (!items.length) return '<p class="rv-empty">没有数据</p>';
  const max = Math.max(1, ...items.map((i) => i.count));
  // 标签跟着柱子走：天少就全标，天多就隔几个标一个，最后一天永远标出来
  const step = items.length <= 7 ? 1 : items.length <= 14 ? 2 : 5;

  return `<div class="spark">${items.map((it, i) => {
    const h = it.count ? Math.max(9, Math.round((it.count / max) * 100)) : 2;
    const tick = (i % step === 0 || i === items.length - 1) ? it.label : '';
    return `<div class="spark-col${it.count ? '' : ' zero'}" title="${esc(it.label)}：${it.count} 条">
      <span class="bar-wrap"><i style="height:${h}%"></i></span>
      <span class="tick">${tick ? esc(tick) : ''}</span>
    </div>`;
  }).join('')}</div>
  <p class="spark-note">每格 1 ${unit}，最后一格是今天</p>`;
}

function dayList(review) {
  if (!review.entries.length) {
    return '<p class="rv-empty">这段时间还没有记录。回收件箱写一条吧。</p>';
  }
  const groups = new Map();
  for (const e of review.entries) {
    const key = dayLabel(e.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  return [...groups.entries()].map(([day, list]) => `
    <div class="rv-day">
      <h3>${esc(day)}<em>${list.length} 条</em></h3>
      <div class="rv-day-list">
        ${list.map((e) => {
          const m = KIND_META[e.kind] || KIND_META.note;
          return `<button data-entry="${esc(e.id)}">
            <time>${fmtTime(e.created_at)}</time>
            <span>${esc(e.title || '无标题')}</span>
            <em class="${m.cls}">${m.label}</em>
          </button>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function openList(review) {
  if (!review.open.length) return '<p class="rv-empty">没有未完成的待办，清空了。</p>';
  return `<ul class="rv-tasks">
    ${review.open.slice(0, 12).map((t) => {
      const due = dueLabel(t.due_date);
      return `<li class="${due && due.cls === 'overdue' ? 'late' : ''}">
        <span>${esc(t.title)}</span>
        ${due ? `<em>${esc(due.text)}</em>` : ''}
      </li>`;
    }).join('')}
    ${review.open.length > 12 ? `<li class="more">还有 ${review.open.length - 12} 条，去待办页看</li>` : ''}
  </ul>`;
}
