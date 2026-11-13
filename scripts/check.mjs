#!/usr/bin/env node
/**
 * 提交前自检：语法、模块引用、DOM 绑定、资源路径、隐私残留。
 *
 * 只用 Node 内置模块，不装依赖：`node scripts/check.mjs`
 * 任何一项不通过都会以非 0 退出，适合放进 CI 或 pre-commit。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.workbuddy', 'node_modules']);
const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.yml', '.yaml']);

const problems = [];
const fail = (msg) => problems.push(msg);

/* ---------------- 收集文件 ---------------- */

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') && name !== '.gitignore' && name !== '.gitattributes') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');

/* ---------------- 1. 语法 ---------------- */

const jsFiles = files.filter((f) => ['.js', '.mjs'].includes(extname(f)));
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fail(`语法错误 ${rel(file)}\n${String(err.stderr || err.message).trim()}`);
  }
}

/* ---------------- 2. 模块导入 ---------------- */

function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((part) => {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    });
  }
  if (/export\s+default/.test(src)) names.add('default');
  return names;
}

for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    if (spec.startsWith('node:')) continue;   // Node 内置模块不算外部依赖
    if (!spec.startsWith('.')) {
      fail(`非相对导入 ${rel(file)} -> ${spec}`);
      continue;
    }
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) {
      fail(`找不到模块 ${rel(file)} -> ${spec}`);
      continue;
    }
    const clause = m[1];
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      const wanted = named[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const have = exportsOf(target);
      for (const name of wanted) {
        if (!have.has(name)) fail(`${rel(file)} 从 ${spec} 导入了不存在的 ${name}`);
      }
    }
  }
}

/* ---------------- 3. DOM 绑定 ---------------- */

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8');
  const used = new Set([
    ...[...src.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  ]);
  for (const id of used) {
    if (!ids.has(id)) fail(`${rel(file)} 引用了不存在的 #${id}`);
  }
}

/* ---------------- 4. 资源引用 ---------------- */

for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = m[1];
  if (/^(data:|#|mailto:)/.test(url)) continue;
  if (/^https?:/.test(url)) {
    if (!url.startsWith('http://www.w3.org/')) fail(`index.html 引用了外部资源：${url}`);
    continue;
  }
  const target = join(ROOT, url.split('?')[0]);
  if (!existsSync(target)) fail(`index.html 引用了不存在的文件：${url}`);
}

/* ---------------- 5. 隐私与平台痕迹 ---------------- */

const FORBIDDEN = [
  { re: /\b[A-Za-z]:[\\/]/, msg: '本机绝对路径' },
  { re: /\/Users\/[A-Za-z0-9._-]+/, msg: '本机绝对路径' },
  { re: /\bworkbuddy\b/i, msg: '开发平台名' },
  { re: /\btencent\b|\bqq\.com\b/i, msg: '厂商名' },
  { re: /wbapp_[A-Za-z0-9]+/, msg: '应用 id' },
  { re: /sharecode/i, msg: '分享口令' },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, msg: '邮箱地址' },
  { re: /(?<!\d)1[3-9]\d{9}(?!\d)/, msg: '手机号' },
  { re: /\bsk-[A-Za-z0-9]{10,}/, msg: '疑似密钥' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{10,}/, msg: '疑似令牌' },
  { re: /\bAI\b/, msg: 'AI 字样' },
  { re: /大模型|模型调用|提示词/, msg: '模型相关措辞' },
];

for (const file of files) {
  if (!TEXT_EXT.has(extname(file))) continue;
  const name = rel(file);
  if (name === 'scripts/check.mjs') continue;   // 规则本身自然会命中这些词
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of FORBIDDEN) {
      if (rule.re.test(line)) fail(`${name}:${i + 1} 命中「${rule.msg}」：${line.trim().slice(0, 90)}`);
    }
  });
}

/* ---------------- 结果 ---------------- */

const textFiles = files.filter((f) => TEXT_EXT.has(extname(f))).length;
if (problems.length) {
  console.error(`✗ 自检未通过，${problems.length} 个问题：\n`);
  problems.forEach((p, i) => console.error(`${String(i + 1).padStart(2, ' ')}. ${p}`));
  process.exit(1);
}

console.log(`✓ 自检通过：${jsFiles.length} 个脚本、${textFiles} 个文本文件`);
console.log(`  · 语法、模块导入、DOM 绑定、资源路径均正常`);
console.log(`  · 未发现路径、邮箱、令牌等隐私痕迹`);
