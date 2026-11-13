/** 通用工具：转义、Markdown、高亮、时间格式化、Toast、确认框 */

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 关键词高亮（输入原文，返回安全 HTML）
 * 先在原文上一次性切分，再逐段转义：逐词串联替换会命中上一次插入的 <mark>，
 * 也会把 &amp; 这类实体从中间切断，产生破损标签。
 */
export function hl(text, terms) {
  const src = String(text == null ? '' : text);
  const list = [...new Set((terms || [])
    .map((t) => String(t == null ? '' : t).trim())
    .filter(Boolean))]
    .sort((a, b) => b.length - a.length);   // 长词优先，短词不会切断长词
  if (!list.length) return esc(src);

  const re = new RegExp(`(${list.map(escapeReg).join('|')})`, 'gi');
  return src
    .split(re)
    .map((seg, i) => (i % 2 ? `<mark>${esc(seg)}</mark>` : esc(seg)))
    .join('');
}

export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function toDate(v) {
  // 始终返回副本：调用方（如 startOfDay）会就地修改，不能污染原始时间
  if (v instanceof Date) return new Date(v.getTime());
  if (!v) return new Date();
  return new Date(v);
}

export function pad(n) { return String(n).padStart(2, '0'); }

/** 14:32 */
export function fmtTime(v) {
  const d = toDate(v);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 10月20日 */
export function fmtDate(v) {
  const d = toDate(v);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 2026年10月20日 */
export function fmtFullDate(v) {
  const d = toDate(v);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function startOfDay(v) {
  const d = toDate(v);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 今天 / 昨天 / 10月20日 / 2025年10月20日 */
export function dayLabel(v) {
  const d = startOfDay(v);
  const today = startOfDay(new Date());
  const diff = Math.round((today - d) / 86400000);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return `${diff} 天前`;
  if (d.getFullYear() === new Date().getFullYear()) return fmtDate(d);
  return fmtFullDate(d);
}

export function relTime(v) {
  const d = toDate(v);
  const diff = Date.now() - d.getTime();
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return fmtTime(d);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return fmtDate(d);
}

export function dueLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d) - today) / 86400000);
  if (diff === 0) return { text: '今天到期', cls: 'due-soon' };
  if (diff === 1) return { text: '明天到期', cls: 'due-soon' };
  if (diff < 0) return { text: `逾期 ${-diff} 天`, cls: 'overdue' };
  if (diff < 7) return { text: `${diff} 天后到期`, cls: '' };
  return { text: `${d.getMonth() + 1} 月 ${d.getDate()} 日`, cls: '' };
}

export function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const chars = Array.from(t);   // 按码点切，避免把 emoji 劈成半个
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : t;
}

export function debounce(fn, ms = 220) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** 带前缀的本地 id：时间戳保证大致有序，随机后缀避免同一毫秒内撞车 */
export function uid(prefix = 'x') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------- UI 小件 ---------------- */

let toastBox;
export function toast(msg, kind = '') {
  toastBox = toastBox || document.getElementById('toasts');
  if (!toastBox) return;
  // 连续记录时会连弹好几条，只留最新的三条，别糊住列表
  while (toastBox.children.length >= 3) toastBox.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  toastBox.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, kind === 'err' ? 4200 : 2600);
}

export function confirmDialog(text, { okText, danger = true } = {}) {
  return new Promise((resolve) => {
    const box = document.getElementById('confirm');
    const yes = document.getElementById('confirm-yes');
    const no = document.getElementById('confirm-no');
    const prev = document.activeElement;
    document.getElementById('confirm-text').textContent = text;
    yes.textContent = okText || '确定';
    yes.className = danger ? 'danger' : 'primary';
    box.hidden = false;

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
      if (e.key === 'Tab') {   // 只在两个按钮之间循环，别让焦点跑出去
        e.preventDefault();
        (document.activeElement === yes ? no : yes).focus();
      }
    };
    const done = (v) => {
      box.hidden = true;
      yes.onclick = null;
      no.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    document.addEventListener('keydown', onKey, true);
    yes.focus();
  });
}

export function autosize(el, max = 220) {
  const resize = () => {
    el.style.height = 'auto';
    const h = el.scrollHeight;
    // 元素在隐藏容器里时 scrollHeight 为 0，此时交还给 CSS（避免高度被锁成 0）
    el.style.height = h ? `${Math.min(h, max)}px` : '';
  };
  el.addEventListener('input', resize);
  resize();
  return resize;
}

/** 千分位，用于「已用 12.3 MB」这类展示 */
export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}
