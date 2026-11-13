/** 标签管理：改名 / 合并 / 删除 */
import { esc, toast, confirmDialog } from './util.js';
import { tagsRanked, renameTag } from './data.js';

const $ = (id) => document.getElementById(id);

export function initTags() {
  const modal = $('tag-modal');
  if (!modal) return;

  $('tag-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
    const row = e.target.closest('.tag-row');
    if (!row) return;

    if (e.target.closest('[data-save]')) {
      const from = row.dataset.from;
      const input = row.querySelector('input');
      const to = input.value.trim();
      if (!to) { toast('标签留空就用「删除」', 'err'); return; }
      if (to === from) return;
      save(row, from, to);
    }
    if (e.target.closest('[data-drop]')) {
      drop(row, row.dataset.from);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}

function open() {
  paint();
  $('tag-modal').hidden = false;
}

function close() {
  $('tag-modal').hidden = true;
}

function paint() {
  const box = $('tag-list');
  const tags = tagsRanked(60);
  if (!tags.length) {
    box.innerHTML = '<p class="dim" style="padding:10px 2px">还没有标签。打开任意一条记录，在「编辑」里加上标签就会出现在这里。</p>';
    return;
  }
  box.innerHTML = tags.map((t) => `
    <div class="tag-row" data-from="${esc(t.name)}">
      <input value="${esc(t.name)}" maxlength="12" aria-label="标签名">
      <span class="count">${t.count} 条</span>
      <button class="ghost sm" data-save>保存</button>
      <button class="link-btn" data-drop>删除</button>
    </div>`).join('');
}

async function save(row, from, to) {
  const btns = row.querySelectorAll('button');
  btns.forEach((b) => { b.disabled = true; });
  try {
    const n = await renameTag(from, to);
    toast(n ? `已更新 ${n} 条记录` : '没有需要改的记录', n ? 'ok' : '');
    paint();
  } catch (err) {
    toast(err.message || '改名失败', 'err');
    btns.forEach((b) => { b.disabled = false; });
  }
}

async function drop(row, name) {
  const ok = await confirmDialog(`删掉标签「${name}」？记录本身不受影响。`, { okText: '删除' });
  if (!ok) return;
  try {
    const n = await renameTag(name, '');
    toast(n ? `已从 ${n} 条记录里去掉` : '没有需要改的记录', 'ok');
    paint();
  } catch (err) {
    toast(err.message || '删除失败', 'err');
  }
}

export { open as openTagManager };
