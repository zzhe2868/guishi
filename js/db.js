/**
 * 本地存储：IndexedDB 的极薄封装。
 *
 * 只有两张表 —— 记录与待办。个人知识库的数据量（几千条）用 getAll 全量读
 * 完全够用，换来的是「所有检索与统计都能在内存里同步算完」，不需要查询语言。
 * 每条记录自带字符串 id，写入前就能确定，便于乐观更新与导入去重。
 */

const DB_NAME = 'guishi';
const DB_VERSION = 1;

export const STORES = ['entries', 'tasks'];

let opening = null;

/** 打开（并在首次打开时建表）数据库；重复调用复用同一个 Promise */
export function openDB() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB，换个浏览器或关闭无痕模式再试'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        store.createIndex('created_at', 'created_at');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打不开本地数据库'));
    req.onblocked = () => reject(new Error('本地数据库被另一个标签页占用，关掉多余的标签页再刷新'));
  });
  return opening;
}

/** 读全表 */
export async function all(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('读取本地数据失败'));
  });
}

/** 写入一条（同 id 覆盖） */
export async function put(store, row) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(row);
    tx.oncomplete = () => resolve(row);
    tx.onerror = () => reject(tx.error || new Error('保存失败，本地存储可能已满'));
    tx.onabort = () => reject(tx.error || new Error('保存被中断'));
  });
}

/** 批量写入 */
export async function bulkPut(store, rows) {
  if (!rows.length) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    rows.forEach((row) => os.put(row));
    tx.oncomplete = () => resolve(rows.length);
    tx.onerror = () => reject(tx.error || new Error('批量保存失败'));
    tx.onabort = () => reject(tx.error || new Error('批量保存被中断'));
  });
}

/** 删除一条 */
export async function remove(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('删除失败'));
  });
}

/** 清空一张表 */
export async function clear(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('清空失败'));
  });
}

/** 用给定数据整体替换一张表（导入用） */
export async function replaceAll(store, rows) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    os.clear();
    rows.forEach((row) => os.put(row));
    tx.oncomplete = () => resolve(rows.length);
    tx.onerror = () => reject(tx.error || new Error('导入写入失败，本地存储可能已满'));
    tx.onabort = () => reject(tx.error || new Error('导入被中断'));
  });
}

/** 清空整个应用的数据（两张表一起） */
export async function wipe() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    STORES.forEach((name) => tx.objectStore(name).clear());
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('清空失败'));
  });
}

/** 浏览器给这个站点分配了多少空间、已用多少 */
export async function usage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage: used, quota } = await navigator.storage.estimate();
    return { used: used || 0, quota: quota || 0 };
  } catch {
    return null;
  }
}
