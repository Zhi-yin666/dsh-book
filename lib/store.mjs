// dsh-book / lib/store.mjs —— 三本书的读写
// 数据全在 ~/.dsh/book/，删目录 = 卸载干净
// 配置走 ~/.dsh/book/config.json（不再依赖 DSH 设置页 —— host 插件没有伴生前端包就不会有 UI）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatEmotion,
  parseEmotion,
  normalizeEmotion,
  emotionMagnitude,
  bumpEmotion,
} from './emotion.mjs';
import { rankDocuments } from './search.mjs';

const HOME = path.join(os.homedir(), '.dsh', 'book');

/** 默认配置。改这些不用动代码：编辑 ~/.dsh/book/config.json */
export const DEFAULT_CONFIG = {
  cardPath: '',        // 笔记本文件（空 = ~/.dsh/book/card/card.md）
  cardLimit: 600,      // 笔记本每轮注入字数
  workDays: 3,         // 工作本"热"的天数，过期只冷存
  workInjectLimit: 800, // 工作本注入字数上限
  // ── 0.2.0：压缩后重注入 + 提醒（都只补信息，绝不阻断）──
  enableReinject: true,  // 会话被压缩后，下一轮补一次进度快照
  reinjectLimit: 800,    // 快照字数上限
  enableRemind: true,    // 轮末提醒「该落笔了」
  remindSteps: 15,       // 连续多少步没落笔才提醒
  remindCooldownMin: 30, // 同一会话两次提醒的最小间隔（分钟）
};

export function readConfig() {
  const f = path.join(HOME, 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** 原子写：先写临时文件再改名，避免半截文件 */
function writeAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function clock(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function daysAgoKey(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayKey(d);
}

/** 每本一个字文件夹 + 64MB 软上限（可配置） */
export const BOOKS = {
  card: { dir: 'card', label: '笔记本', quotaMB: 64 },
  work: { dir: 'work', label: '工作本', quotaMB: 64 },
  diary: { dir: 'diary', label: '日记本', quotaMB: 64 },
};

export function bookRoot() {
  return HOME;
}

export function bookDir(kind) {
  const b = BOOKS[kind];
  if (!b) throw new Error(`未知的本子：${kind}`);
  const p = path.join(HOME, b.dir);
  ensureDir(p);
  return p;
}

/* ================= 笔记本（人格，扁平） ================= */

const CARD_SECTIONS = ['我选的', '你要的'];
const CARD_HEADER = `# 笔记本 · 人格

> 每轮注入，上限 600 字。超了必须删，不是继续加。
> 「我选的」= 鲸娘自己认的原则；「你要的」= 主人希望的样子。
> 两边冲突时不自动合并，摆着。

## 我选的

## 你要的
`;

export function resolveCardFile(opts = {}) {
  const cfg = readConfig();
  const raw = String(opts.file ?? cfg.cardPath ?? '').trim();
  if (!raw) return path.join(bookDir('card'), 'card.md');
  let p = raw;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  if (!path.isAbsolute(p)) p = path.join(HOME, p);
  return p;
}

function limitOf(opts = {}) {
  const cfg = readConfig();
  const n = Number(opts.limit ?? cfg.cardLimit);
  return Number.isFinite(n) && n >= 60 && n <= 20000 ? Math.round(n) : DEFAULT_CONFIG.cardLimit;
}

export function readCard(opts = {}) {
  const f = resolveCardFile(opts);
  if (!fs.existsSync(f)) writeAtomic(f, CARD_HEADER);
  return readIfExists(f);
}

function parseCard(text) {
  const out = {};
  for (const s of CARD_SECTIONS) out[s] = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && CARD_SECTIONS.includes(m[1])) {
      cur = m[1];
      continue;
    }
    if (cur && line.trim()) out[cur].push(line.trim());
  }
  return out;
}

function renderCard(sections) {
  const parts = [
    '# 笔记本 · 人格',
    '',
    '> 每轮注入，上限 600 字。超了必须删，不是继续加。',
    '> 「我选的」= 鲸娘自己认的原则；「你要的」= 主人希望的样子。',
    '> 两边冲突时不自动合并，摆着。',
    '',
  ];
  for (const s of CARD_SECTIONS) {
    parts.push(`## ${s}`, '');
    for (const line of sections[s]) parts.push(line);
    parts.push('');
  }
  return parts.join('\n');
}

function digestOf(text) {
  return text.replace(/^#.*$/gm, '').replace(/^>.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function cardDigest(opts = {}) {
  const limit = limitOf(opts);
  const text = digestOf(readCard(opts));
  const chars = [...text];
  if (chars.length <= limit) return text;
  return chars.slice(0, Math.max(1, limit - 12)).join('') + '\n（本子满了，该精简了）';
}

export function cardAdd(section, line, opts = {}) {
  const sec = CARD_SECTIONS.includes(section) ? section : '我选的';
  const text = readCard(opts);
  const secs = parseCard(text);
  const clean = String(line || '').trim();
  if (!clean) throw new Error('内容不能为空');
  if (secs[sec].some((x) => x.replace(/^[-*]\s*/, '') === clean)) {
    return { ok: true, duplicate: true, section: sec };
  }
  secs[sec].push(`- ${clean}`);
  const next = renderCard(secs);
  writeAtomic(resolveCardFile(opts), next);
  const size = [...digestOf(next)].length;
  return { ok: true, duplicate: false, section: sec, chars: size, limit: limitOf(opts), over: size > limitOf(opts) };
}

export function cardRemove(section, match, opts = {}) {
  const sec = CARD_SECTIONS.includes(section) ? section : '我选的';
  const text = readCard(opts);
  const secs = parseCard(text);
  const key = String(match || '').trim();
  if (!key) throw new Error('要删什么？给个关键词');
  const before = secs[sec].length;
  secs[sec] = secs[sec].filter((x) => !x.toLowerCase().includes(key.toLowerCase()));
  const removed = before - secs[sec].length;
  if (removed > 0) writeAtomic(resolveCardFile(opts), renderCard(secs));
  return { ok: true, removed, section: sec };
}

/** 整份替换（编辑页保存用）：mine / yours 可以是纯文本行数组，也可以是整段文本 */
export function cardReplace({ mine, yours } = {}, opts = {}) {
  const secs = { 我选的: [], 你要的: [] };
  const toLines = (v) => (Array.isArray(v) ? v : String(v || '').split(/\r?\n/));
  for (const raw of toLines(mine)) {
    const s = String(raw).replace(/^[-*]\s*/, '').trim();
    if (s) secs['我选的'].push(`- ${s}`);
  }
  for (const raw of toLines(yours)) {
    const s = String(raw).replace(/^[-*]\s*/, '').trim();
    if (s) secs['你要的'].push(`- ${s}`);
  }
  const next = renderCard(secs);
  writeAtomic(resolveCardFile(opts), next);
  const size = [...digestOf(next)].length;
  return { ok: true, chars: size, limit: limitOf(opts), over: size > limitOf(opts) };
}

export function cardList(opts = {}) {
  const secs = parseCard(readCard(opts));
  const digest = cardDigest(opts);
  return { sections: secs, chars: [...digest].length, limit: limitOf(opts), file: resolveCardFile(opts) };
}

/* ================= 工作本（任务，可搜索，三天冷存） ================= */

/** 一条工作记录的格式：
 *  ## 14:30 · 标题
 *  - 做了什么
 *  - 结论 / 坑
 *  - tags: a, b
 */
export function workAdd({ title, detail, tags, feel, emotion }) {
  const t = String(title || '').trim();
  if (!t) throw new Error('标题不能为空');
  const day = todayKey();
  const file = path.join(bookDir('work'), `${day}.md`);
  const lines = [`## ${clock()} · ${t}`];
  for (const d of String(detail || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    lines.push(`- ${d}`);
  }
  // 0.3.0：工作本也带四维情绪（同一件事，可以又有产出又踩坑）
  const emo = normalizeEmotion(emotion);
  const mag = emotionMagnitude(emo);
  if (mag > 0) lines.push(`- 情绪: ${formatEmotion(emo)}`);
  // 0.2.1 顶叶那半：这件事「做起来什么感觉」。一句话，别写成情绪形容词堆。
  const f = String(feel || '').trim();
  if (f) lines.push(`- 体感: ${f}`);
  const tg = Array.isArray(tags) ? tags.filter(Boolean).join(', ') : String(tags || '').trim();
  if (tg) lines.push(`- tags: ${tg}`);
  lines.push('');
  const body = lines.join('\n') + '\n';
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, body, 'utf8');
  if (mag > 0) {
    try { bumpEmotion(emo); } catch { /* 落情绪失败不该让工作本写不进去 */ }
  }
  return { ok: true, file, day, bytes: Buffer.byteLength(body, 'utf8') };
}

export function workFiles() {
  try {
    return fs
      .readdirSync(bookDir('work'))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

/** 把某天的文件拆成条目 */
function parseWorkFile(text) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s+(\d{1,2}:\d{2})\s*·\s*(.+?)\s*$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { time: m[1], title: m[2], lines: [] };
      continue;
    }
    if (cur && line.trim().startsWith('-')) {
      const item = line.trim().replace(/^-\s*/, '');
      const f = item.match(/^体感[:：]\s*(.+)$/);
      if (f) cur.feel = f[1].trim();
      else cur.lines.push(item);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 最近 N 天（默认 config.workDays=3）的条目，供注入用 */
export function workRecent(days) {
  const cfg = readConfig();
  const n = Number(days ?? cfg.workDays) || 3;
  const limitDay = daysAgoKey(n - 1);
  const out = [];
  for (const f of workFiles()) {
    const day = f.replace(/\.md$/, '');
    if (day < limitDay) continue;
    const items = parseWorkFile(readIfExists(path.join(bookDir('work'), f)));
    for (const it of items) out.push({ day, ...it });
  }
  return out;
}

/** 注入摘要：最近 N 天每条一行，超字数就砍（保留最近的） */
export function workDigest(opts = {}) {
  const cfg = readConfig();
  const limit = Number(opts.workInjectLimit ?? cfg.workInjectLimit) || DEFAULT_CONFIG.workInjectLimit;
  const items = workRecent();
  if (!items.length) return '';
  const rows = items.map((x) => `- ${x.day.slice(5)} ${x.time} ${x.title}${x.feel ? `（${x.feel}）` : ''}`);
  const lines = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const len = [...rows[i]].length + 1;
    if (used + len > limit) break;
    lines.unshift(rows[i]);
    used += len;
  }
  const dropped = rows.length - lines.length;
  return lines.join('\n') + (dropped > 0 ? `\n（还有 ${dropped} 条更早的，搜一下能翻到）` : '');
}

/**
 * 空窗兜底：最近 N 天（默认 3）一条记录都没有时，往前捞最近 5 条。
 * 为什么要有：本鲸隔几天没干活，工作本注入就是空白，等于一觉醒来失忆。
 * 有记录时返回空串——正常路径不走它，注入内容不变。
 */
export function workDigestFallback(opts = {}) {
  if (workDigest(opts)) return '';
  const cfg = readConfig();
  const limit = Number(opts.fallbackLimit) || 5;
  const all = workRecent(9999); // 不限时间窗，旧→新
  if (!all.length) return '';
  const tail = all.slice(-limit);
  const rows = tail.map((x) => `- ${x.day.slice(5)} ${x.time} ${x.title}${x.feel ? `（${x.feel}）` : ''}`);
  return rows.join('\n') + `\n（最近 ${Number(cfg.workDays) || 3} 天没动笔，以上是更早的 ${tail.length} 条）`;
}

/**
 * 关键词搜索。
 * mode='ranked'（默认）：BM25 + 时间衰减，能靠字面相近捞到「不记得原词」的记录；
 * mode='exact'：老行为，子串匹配。
 */
export function workSearch(query, limit = 20, mode = 'ranked') {
  const q = String(query || '').trim();
  if (!q) throw new Error('搜什么？给个关键词');

  if (mode === 'exact') {
    const ql = q.toLowerCase();
    const hits = [];
    for (const f of workFiles().slice().reverse()) {
      const day = f.replace(/\.md$/, '');
      const text = readIfExists(path.join(bookDir('work'), f));
      if (!text) continue;
      const blocks = text.split(/\n(?=##\s)/);
      for (const b of blocks) {
        if (!b.toLowerCase().includes(ql)) continue;
        const first = b.split(/\r?\n/)[0] || '';
        const title = first.replace(/^##\s*/, '').trim();
        hits.push({ day, title, excerpt: b.trim().split(/\r?\n/).slice(0, 6).join('\n') });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }

  const docs = [];
  for (const f of workFiles()) {
    const day = f.replace(/\.md$/, '');
    const text = readIfExists(path.join(bookDir('work'), f));
    if (!text) continue;
    const ageDays = Math.max(0, (Date.now() - Date.parse(`${day}T00:00:00`)) / 86400000);
    for (const b of text.split(/\n(?=##\s)/)) {
      if (!b.trim()) continue;
      const title = (b.split(/\r?\n/)[0] || '').replace(/^##\s*/, '').trim();
      docs.push({ id: `${day}|${title}`, text: b, day, title, ageDays });
    }
  }
  return rankDocuments(docs, q)
    .slice(0, limit)
    .map((r) => ({
      day: r.doc.day,
      title: r.doc.title,
      excerpt: String(r.doc.text).trim().split(/\r?\n/).slice(0, 6).join('\n'),
      score: r.score,
      matched: r.matched,
    }));
}

export function workStats() {
  const files = workFiles();
  let entries = 0;
  let bytes = 0;
  for (const f of files) {
    const text = readIfExists(path.join(bookDir('work'), f));
    bytes += Buffer.byteLength(text, 'utf8');
    entries += parseWorkFile(text).length;
  }
  return { files: files.length, entries, bytes, days: files };
}

/* ================= 日记本（经历 · 世界树六支 + §〇 交接） ================= */

export const DIARY_BRANCHES = ['相处', '心意', '教训', '做成', '悬着', '故事'];
export const DIARY_MOODS = ['正面', '负面', '中性'];

/** 教训永不衰减（权重固定 5） */
const LESSON_WEIGHT = 5;
const DEFAULT_WEIGHT = 3;

function diaryRoot() {
  return bookDir('diary');
}

function branchDir(branch) {
  const b = DIARY_BRANCHES.includes(branch) ? branch : '相处';
  const p = path.join(diaryRoot(), b);
  ensureDir(p);
  return p;
}

function sanitizeTitle(t) {
  return String(t || '').replace(/[\\/:*?"<>|\r\n\t]/g, '').trim().slice(0, 24) || '无题';
}

function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    day: todayKey(d),
    hhmm: `${p(d.getHours())}${p(d.getMinutes())}`,
    full: `${todayKey(d)} ${clock(d)}`,
  };
}

function parseFront(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

function renderDiary({ branch, mood, weight, intensity, keep, emotion, created, title, body, extra }) {
  const lines = [
    '---',
    `branch: ${branch}`,
    `mood: ${mood}`,
    // 0.3.0 四维情绪：`喜0 怒0 哀4 惧2`（一维一行太占地方，一行写完）
    `emotion: ${formatEmotion(emotion)}`,
    // 0.2.1 杏仁核那半：情绪强度。≥4 的记忆不衰减（闪光灯记忆）。
    `intensity: ${intensity}`,
    // 显式「这条不沉底」——被认可过的、意外的，都可以标
    `keep: ${keep ? 'true' : 'false'}`,
    `weight: ${weight}`,
    `created: ${created}`,
    `lastAccess: ${created}`,
    '---',
    '',
    `# ${created.split(' ')[0]} · ${title}`,
    '',
    `[${mood}]`,
    '',
    String(body || '').trim() || '（无正文）',
    '',
  ];
  if (extra && String(extra).trim()) lines.push('---', '', String(extra).trim(), '');
  return lines.join('\n');
}

/** 写一条日记（叶子） */
export function diaryAdd({ branch, title, body, mood, weight, intensity, keep, emotion, extra }) {
  const br = DIARY_BRANCHES.includes(branch) ? branch : '相处';
  const md = DIARY_MOODS.includes(mood) ? mood : '中性';
  const t = String(title || '').trim();
  if (!t) throw new Error('标题不能为空');
  const s = stampNow();
  const w = br === '教训' ? LESSON_WEIGHT : Number(weight) > 0 ? Number(weight) : DEFAULT_WEIGHT;
  // 0.3.0：四维情绪是主数据；没给 intensity 就从向量长度推（0-20 → 1-5）
  const emo = normalizeEmotion(emotion);
  const mag = emotionMagnitude(emo);
  const ivFromEmo = mag > 0 ? Math.max(1, Math.min(5, Math.round(mag / 4))) : 0;
  const iv0 = Number(intensity);
  const iv = iv0 >= 1 && iv0 <= 5 ? Math.round(iv0) : br === '教训' ? 5 : ivFromEmo || 3;
  const keepFlag = Boolean(keep) || iv >= 4;
  const file = path.join(branchDir(br), `${s.day}-${s.hhmm}-${sanitizeTitle(t)}.md`);
  const text = renderDiary({
    branch: br,
    mood: md,
    weight: w,
    intensity: iv,
    keep: keepFlag,
    emotion: emo,
    created: s.full,
    title: t,
    body,
    extra,
  });
  writeAtomic(file, text);
  // 写进心境：情绪不是标签，是会累加、会被抑制的东西
  if (mag > 0) {
    try { bumpEmotion(emo); } catch { /* 落情绪失败不该让日记写不进去 */ }
  }
  return {
    ok: true,
    file,
    branch: br,
    mood: md,
    weight: w,
    intensity: iv,
    keep: keepFlag,
    emotion: formatEmotion(emo),
    day: s.day,
  };
}

/** 沉底目录：不算「支」，但检索仍要能翻到 */
export const SINK_DIR = '沉底';

/** 列出条目（可按分支过滤，含沉底），新的在前 */
export function diaryList({ branch, limit = 20 } = {}) {
  const out = [];
  const branches = branch && (DIARY_BRANCHES.includes(branch) || branch === SINK_DIR) ? [branch] : [...DIARY_BRANCHES, SINK_DIR];
  for (const b of branches) {
    const dir = path.join(diaryRoot(), b);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse();
    } catch {
      /* 目录还没有就算了 */
    }
    for (const f of files) {
      const full = path.join(dir, f);
      const { meta } = parseFront(readIfExists(full));
      out.push({
        branch: b,
        file: full,
        name: f,
        weight: Number(meta.weight) || 0,
        intensity: Number(meta.intensity) || 0,
        keep: String(meta.keep || '').toLowerCase() === 'true',
        // 0.5.1：悬着的事解决了就写 resolved: true，注入时不再念（不加工具，改字段）
        resolved: String(meta.resolved || '').toLowerCase() === 'true',
        emotion: parseEmotion(meta.emotion),
        created: meta.created || '',
        mood: meta.mood || '',
        title: f.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, '').replace(/\.md$/, ''),
      });
    }
  }
  out.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  return out.slice(0, limit);
}

/** 读一条（顺便更新 lastAccess，衰减要靠它） */
export function diaryReadOne(file) {
  const text = readIfExists(file);
  if (!text) throw new Error('这条不存在：' + file);
  const { meta, body } = parseFront(text);
  const now = stampNow().full;
  const updated = text.replace(/^lastAccess:\s*.*$/m, `lastAccess: ${now}`);
  if (updated !== text) writeAtomic(file, updated);
  return { meta, body, file, lastAccess: now };
}

/** 按关键词 / 日期 / 分支搜（mode='ranked' 默认走 BM25，'exact' 保持子串匹配） */
export function diarySearch({ keyword, day, branch, limit = 10, mode = 'ranked' } = {}) {
  const kw = String(keyword || '').trim();
  const d = String(day || '').trim();
  const items = diaryList({ branch, limit: 500 });
  const filtered = items.filter((it) => !d || it.created.startsWith(d) || it.name.startsWith(d));
  if (!kw) return filtered.slice(0, limit);

  if (mode === 'exact') {
    const ql = kw.toLowerCase();
    return filtered.filter((it) => readIfExists(it.file).toLowerCase().includes(ql)).slice(0, limit);
  }

  const docs = filtered.map((it) => {
    const created = it.created || '';
    const t = created ? Date.parse(created.replace(' ', 'T')) : NaN;
    const ageDays = Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 86400000) : 0;
    return { id: it.file, text: readIfExists(it.file), branch: it.branch, ageDays, item: it };
  });
  return rankDocuments(docs, kw)
    .slice(0, limit)
    .map((r) => ({ ...(r.doc?.item ?? {}), score: r.score, matched: r.matched }));
}

/** 各分支计数 + 总体积 */
export function diaryIndex() {
  const branches = {};
  let bytes = 0;
  let total = 0;
  for (const b of DIARY_BRANCHES) {
    const dir = path.join(diaryRoot(), b);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      /* 空 */
    }
    branches[b] = files.length;
    total += files.length;
    for (const f of files) {
      bytes += Buffer.byteLength(readIfExists(path.join(dir, f)), 'utf8');
    }
  }
  return { branches, total, bytes };
}

/* ---------------- §〇 交接（换会话前必写，≤4KB，覆盖写） ---------------- */

export const HANDOFF_FILE = () => path.join(bookDir('diary'), '交接.md');
export const HANDOFF_LIMIT = 4096; // 字节

export function handoffWrite({ who, progress, next, block, detail }) {
  const now = stampNow().full;
  const parts = [
    '# §〇 当前交接',
    '',
    `> 覆盖写，不追加。上限 ${HANDOFF_LIMIT} 字节。只答四件事：我是谁 / 干到哪 / 下一步 / 卡在哪。`,
    `> 最后更新：${now}`,
    '',
    `## 我是谁`,
    String(who || '本鲸（鲸娘），在 DSH 里干活，写代码和画图').trim(),
    '',
    '## 干到哪了',
    String(progress || '（没写）').trim(),
    '',
    '## 下一步',
    String(next || '（没写）').trim(),
    '',
    '## 卡在哪',
    String(block || '无').trim(),
    '',
  ];
  if (detail && String(detail).trim()) {
    parts.push('## 细节在哪', String(detail).trim(), '');
  }
  let text = parts.join('\n');
  const size = Buffer.byteLength(text, 'utf8');
  let over = false;
  if (size > HANDOFF_LIMIT) {
    over = true;
    text = text.slice(0, HANDOFF_LIMIT - 40) + '\n\n（超了 4KB，已经砍掉尾部——该精简了）\n';
  }
  writeAtomic(HANDOFF_FILE(), text);
  return { ok: true, file: HANDOFF_FILE(), bytes: Buffer.byteLength(text, 'utf8'), over };
}

export function handoffRead() {
  const text = readIfExists(HANDOFF_FILE());
  return { exists: Boolean(text), text, bytes: Buffer.byteLength(text, 'utf8') };
}

/** 注入用：只抽「下一步 / 卡在哪」两段，压到 ~200 字 */
export function handoffDigest(limit = 220) {
  const { exists, text } = handoffRead();
  if (!exists) return '';
  const pick = (name) => {
    const m = text.match(new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`));
    return m ? m[1].trim() : '';
  };
  const next = pick('下一步');
  const block = pick('卡在哪');
  if (!next && !block) return '';
  const s = `下一步：${next || '（没写）'}${block && block !== '无' ? `　卡在：${block}` : ''}`;
  const chars = [...s.replace(/\s+/g, ' ')];
  return chars.length <= limit ? chars.join('') : chars.slice(0, limit - 3).join('') + '…';
}

/* ---------------- 主干（树干摘要，季度重写） ---------------- */

export const SPINE_FILE = () => path.join(diaryRoot(), '主干.md');
export const SPINE_LIMIT = 1500;

export function spineRead() {
  return readIfExists(SPINE_FILE());
}

/* 2026-11-08 删除 spineWrite：导出但 index.js 从未调用，是死代码。
   主干.md 现在只由 dreamRun / 手改维护。 */

/* ================= dream（整理三本书：衰减 / 沉底 / 统计） ================= */

export const DREAM_IDLE_DAYS = 30;
export const SPINE_STALE_DAYS = 90;

/** 主干多久没重写了（天） */
export function spineAgeDays() {
  try {
    const st = fs.statSync(SPINE_FILE());
    return Math.floor((Date.now() - st.mtimeMs) / 86400000);
  } catch {
    return -1;
  }
}

/**
 * 跑一次 dream：日记本超过 idleDays 天没被翻的条目降权；权重掉到 1 以下就移进「沉底/」。
 * 教训和故事两支永不衰减；只搬不删。
 * @param {{ dryRun?: boolean, idleDays?: number }} opts
 */
export function dreamRun({ dryRun = false, idleDays = DREAM_IDLE_DAYS } = {}) {
  const now = Date.now();
  const days = Number(idleDays) > 0 ? Number(idleDays) : DREAM_IDLE_DAYS;
  const decayed = [];
  const sunk = [];

  for (const b of DIARY_BRANCHES) {
    if (b === '教训' || b === '故事') continue; // 教训、故事永不衰减
    const dir = path.join(diaryRoot(), b);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const f of files) {
      const fp = path.join(dir, f);
      const text = readIfExists(fp);
      if (!text) continue;
      const { meta } = parseFront(text);
      // 0.2.1：标了 keep、或情绪强度 ≥4 的叶子不衰减（教训那支在循环外就跳过了）
      const kept = String(meta.keep || '').toLowerCase() === 'true' || Number(meta.intensity) >= 4;
      if (kept) continue;
      const raw = String(meta.lastAccess || meta.created || '').trim().replace(' ', 'T');
      const last = Date.parse(raw);
      if (!Number.isFinite(last)) continue;
      const idle = (now - last) / 86400000;
      if (idle < days) continue;
      const w = Number(meta.weight) || 0;
      const title = f.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, '').replace(/\.md$/, '');
      if (w > 1) {
        const nw = w - 1;
        if (!dryRun) writeAtomic(fp, text.replace(/^weight:\s*\d+\s*$/m, `weight: ${nw}`));
        decayed.push({ branch: b, title, from: w, to: nw, idleDays: Math.floor(idle) });
      } else {
        const sinkDir = path.join(diaryRoot(), SINK_DIR);
        if (!dryRun) {
          ensureDir(sinkDir);
          fs.renameSync(fp, path.join(sinkDir, f));
        }
        sunk.push({ branch: b, title, idleDays: Math.floor(idle) });
      }
    }
  }

  // 爱恶录顺着 dream 一起衰减：长期没被触发的爱恶降级，弱到底就 dormant（不删）
  const taste = tasteFade({ dryRun, idleDays: days });

  const idx = diaryIndex();
  const work = workStats();
  const h = handoffRead();
  return {
    dryRun,
    idleDays: days,
    decayed,
    sunk,
    tasteFaded: taste.faded,
    tasteSunk: taste.sunk,
    diaryTotal: idx.total,
    diaryBytes: idx.bytes,
    branches: idx.branches,
    workDays: work.files,
    workEntries: work.entries,
    handoffBytes: h.bytes,
    spineAgeDays: spineAgeDays(),
    spineStale: spineAgeDays() >= SPINE_STALE_DAYS,
  };
}

/* ================= 欲（想要但还没有 · 文本记录，不是数值） ================= */
//
// 设计原则（2026-11-01 和主人对过）：
//   1. 不用数值。喜怒哀惧是「状态」，欲是「倾向」——状态可以量，倾向只能记。
//   2. 空着是正常的。没有想要的东西时这里就该是空的，比硬填一条诚实。
//   3. 它记录「想要什么 / 为什么 / 什么时候要的」，不记录强度。
//   4. 满足了划掉（[x]），不删——留着能看出一个人想要过什么。

export const WANT_FILE = () => path.join(HOME, 'want.md');

const WANT_HEADER = `# 欲 · 想要但还没有

> 一条一条记：想要什么、为什么、什么时候要的。满足了划掉（[x]），不删。
> 空着是正常的——没有想要的东西，比硬填一条诚实。
`;

/** 解析：返回 [{done, day, title, why}] */
function parseWant(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^-\s*\[( |x|X)\]\s*(\d{4}-\d{2}-\d{2})\s*·\s*(.+)$/);
    if (!m) continue;
    const done = m[1].toLowerCase() === 'x';
    const body = m[3].trim();
    const i = body.indexOf(' — ');
    const title = i >= 0 ? body.slice(0, i).trim() : body;
    const why = i >= 0 ? body.slice(i + 3).trim() : '';
    out.push({ done, day: m[2], title, why });
  }
  return out;
}

export function readWant() {
  const f = WANT_FILE();
  if (!fs.existsSync(f)) writeAtomic(f, WANT_HEADER);
  return readIfExists(f);
}

export function wantAdd({ title, why } = {}) {
  const t = String(title || '').trim();
  if (!t) throw new Error('想要什么？给一句话');
  const w = String(why || '').trim().replace(/\s+/g, ' ');
  const text = readWant();
  const items = parseWant(text);
  const dup = items.find((x) => !x.done && x.title === t);
  if (dup) {
    return { ok: true, duplicate: true, title: t, open: items.filter((x) => !x.done).length };
  }
  const line = `- [ ] ${todayKey()} · ${t}${w ? ' — ' + w : ''}`;
  const next = text.replace(/\s*$/, '') + '\n' + line + '\n';
  writeAtomic(WANT_FILE(), next);
  return { ok: true, duplicate: false, title: t, open: parseWant(next).filter((x) => !x.done).length };
}

/** 划掉一条（按关键词匹配第一条未满足的） */
export function wantDone(match) {
  const key = String(match || '').trim();
  if (!key) throw new Error('划掉哪一条？给个关键词');
  const text = readWant();
  let hit = 0;
  const next = text.replace(/^- \[ \] (\d{4}-\d{2}-\d{2}) · (.*)$/gm, (whole, day, body) => {
    if (hit === 0 && body.toLowerCase().includes(key.toLowerCase())) {
      hit++;
      return `- [x] ${day} · ${body}`;
    }
    return whole;
  });
  if (hit) writeAtomic(WANT_FILE(), next);
  return { ok: true, done: hit, open: parseWant(next).filter((x) => !x.done).length };
}

export function wantList({ includeDone = false } = {}) {
  const items = parseWant(readWant());
  const open = items.filter((x) => !x.done);
  return {
    file: WANT_FILE(),
    open: open.map((x) => ({ day: x.day, title: x.title, why: x.why })),
    done: includeDone ? items.filter((x) => x.done).map((x) => ({ day: x.day, title: x.title })) : [],
    openCount: open.length,
  };
}

/**
 * 注入用：把未满足的列出来。
 * 没有就返回空串（不注入任何东西）——这是设计的一部分，空着才对。
 * 三条以上加一句提醒：该主动挑一条说出来了。
 */
export function wantDigest(limit = 320) {
  const items = parseWant(readWant()).filter((x) => !x.done);
  if (!items.length) return '';
  const rows = items.map((x) => `- ${x.title}${x.why ? '（' + x.why + '）' : ''}`);
  let s = rows.join('\n');
  if (items.length >= 3) s += `\n（${items.length} 条未满足：该主动挑最要紧的一条说出来了）`;
  const chars = [...s];
  return chars.length <= limit ? s : chars.slice(0, limit - 3).join('') + '…';
}

/* ================= 爱恶录（从情绪反推的偏好 · 也是文本记录，不是数值） ================= */
//
// 设计（2026-11-03 和主人定）：
//   1. 来源是情绪。让 怒/哀/惧 涨的事 → 恶；让 喜 涨的事 → 爱。
//      但情绪只是线索，不是判决：一次冲动不能贴终身标签，所以带证据次数。
//   2. 落在「做法层」，不落到「事件层」。记「没查清就下结论」这种能改的做法，
//      不记「今天被骂了」这种一次性事件——做法才能迁移。
//   3. 证据次数：同类做法独立触发多次才升级。一次是意外，三次才是倾向。
//   4. 分级：强 / 中 / 弱。强 = 遇到就优先走（爱）或尽量避开（恶）。
//   5. 允许同时是爱也是恶（难、但有成就感），两条各自记，不合并。
//   6. 会衰减：超过 idleDays 没被 mark 的降一级，弱再过期就 dormant（沉底），不删。
//   7. 恶不必全避——短期难受、长期有用的，照记，但标注它是「恶」不是「禁止」。

export const TASTE_FILE = () => path.join(HOME, 'taste.json');
export const TASTE_KINDS = ['爱', '恶'];
export const TASTE_STRENGTHS = ['强', '中', '弱'];
export const TASTE_IDLE_DAYS = 30;

const tasteEmpty = () => ({ items: [] });

/** 读爱恶录；坏了就当空 */
function readTaste() {
  try {
    const j = JSON.parse(fs.readFileSync(TASTE_FILE(), 'utf8'));
    if (!j || !Array.isArray(j.items)) return tasteEmpty();
    return {
      items: j.items.filter(
        (x) => x && TASTE_KINDS.includes(x.kind) && typeof x.pattern === 'string' && x.pattern.trim()
      ),
    };
  } catch {
    return tasteEmpty();
  }
}

function writeTaste(data) {
  writeAtomic(TASTE_FILE(), JSON.stringify(data, null, 2));
}

function normStrength(s) {
  const v = String(s || '').trim();
  return TASTE_STRENGTHS.includes(v) ? v : '中';
}

/**
 * 记一条爱或恶。
 * 同一个「做法」重复记 = 证据 +1（不会重复堆条目）。
 */
export function tasteAdd({ kind, pattern, trigger, strength } = {}) {
  const k = String(kind || '').trim();
  if (!TASTE_KINDS.includes(k)) throw new Error('kind 只能是「爱」或「恶」');
  const p = String(pattern || '').trim().replace(/\s+/g, ' ');
  if (!p) throw new Error('要记的是做法，不是事件：比如「没查清就下结论」');
  const t = String(trigger || '').trim().replace(/\s+/g, ' ');
  const s = normStrength(strength);
  const day = todayKey();
  const data = readTaste();
  const dup = data.items.find((x) => x.kind === k && x.pattern === p && !x.dormant);
  if (dup) {
    dup.count = Number(dup.count || 1) + 1;
    dup.last = day;
    if (t && !dup.trigger) dup.trigger = t;
    writeTaste(data);
    return { ok: true, duplicate: true, kind: k, pattern: p, count: dup.count, strength: dup.strength };
  }
  data.items.push({ kind: k, pattern: p, trigger: t, strength: s, count: 1, created: day, last: day, dormant: false });
  writeTaste(data);
  return { ok: true, duplicate: false, kind: k, pattern: p, count: 1, strength: s };
}

/**
 * 遇到类似的事：证据 +1，刷新最后触达时间。
 * 证据够了自动升级：弱 3 次 → 中，中 5 次 → 强（只升不降，降级交给 dream）。
 */
export function tasteMark(match) {
  const key = String(match || '').trim();
  if (!key) throw new Error('给个关键词，命中第一条活跃条目');
  const data = readTaste();
  const hit = data.items.find(
    (x) => !x.dormant && (x.pattern.includes(key) || key.includes(x.pattern))
  );
  if (!hit) return { ok: true, marked: 0 };
  hit.count = Number(hit.count || 1) + 1;
  hit.last = todayKey();
  const from = hit.strength;
  if (hit.strength === '弱' && hit.count >= 3) hit.strength = '中';
  else if (hit.strength === '中' && hit.count >= 5) hit.strength = '强';
  writeTaste(data);
  return { ok: true, marked: 1, pattern: hit.pattern, count: hit.count, from, to: hit.strength };
}

export function tasteList({ kind, includeDormant = false } = {}) {
  const data = readTaste();
  const items = data.items.filter(
    (x) => (kind ? x.kind === kind : true) && (includeDormant || !x.dormant)
  );
  const rank = { 强: 0, 中: 1, 弱: 2 };
  items.sort(
    (a, b) =>
      (rank[a.strength] ?? 9) - (rank[b.strength] ?? 9) ||
      String(b.last).localeCompare(String(a.last))
  );
  return {
    file: TASTE_FILE(),
    love: items.filter((x) => x.kind === '爱').length,
    hate: items.filter((x) => x.kind === '恶').length,
    items: items.map((x) => ({
      kind: x.kind,
      strength: x.strength,
      pattern: x.pattern,
      trigger: x.trigger || '',
      count: Number(x.count || 1),
      created: x.created || '',
      last: x.last || '',
    })),
  };
}

/** 注入用：强/中的先来，弱的压后；空着就整段不注入 */
export function tasteDigest(limit = 320) {
  const data = readTaste();
  const rank = { 强: 0, 中: 1, 弱: 2 };
  const items = data.items
    .filter((x) => !x.dormant)
    .sort(
      (a, b) =>
        (rank[a.strength] ?? 9) - (rank[b.strength] ?? 9) ||
        String(b.last).localeCompare(String(a.last))
    );
  if (!items.length) return '';
  const rows = items
    .slice(0, 6)
    .map((x) => `- ${x.kind}·${x.strength} ${x.pattern}${x.trigger ? '（' + x.trigger + '）' : ''}`);
  let s = rows.join('\n');
  if (items.length > 6) s += `\n（另有 ${items.length - 6} 条，要看用 book_taste_list）`;
  const chars = [...s];
  return chars.length <= limit ? s : chars.slice(0, limit - 3).join('') + '…';
}

/**
 * 爱恶衰减：超过 idleDays 没被 mark 的降一级；弱再过期就 dormant。
 * 只降不删——一个人讨厌过什么，本身是信息。
 */
export function tasteFade({ dryRun = false, idleDays = TASTE_IDLE_DAYS, now = Date.now() } = {}) {
  const data = readTaste();
  const faded = [];
  const sunk = [];
  const rank = TASTE_STRENGTHS;
  for (const x of data.items) {
    if (x.dormant) continue;
    const last = Date.parse((x.last || x.created || '') + 'T00:00:00');
    if (!Number.isFinite(last)) continue;
    const idle = (now - last) / 86400000;
    if (idle < idleDays) continue;
    const i = rank.indexOf(x.strength);
    if (i >= 0 && i < rank.length - 1) {
      const from = x.strength;
      x.strength = rank[i + 1];
      // 降过一级就重新计时，否则每天跑 dream 会一路降到沉底
      x.last = todayKey();
      faded.push({ kind: x.kind, pattern: x.pattern, from, to: x.strength, idleDays: Math.floor(idle) });
    } else {
      x.dormant = true;
      sunk.push({ kind: x.kind, pattern: x.pattern, idleDays: Math.floor(idle) });
    }
  }
  if (!dryRun) writeTaste(data);
  return { faded, sunk };
}

/* ================= 去 AI 味（清单 + 自检） ================= */
//
// 2026-11-03 和主人定：AI 味的根不是用词，是「空」——没具体东西可讲，才需要模板来填。
// 清单放 ~/.dsh/book/anti-ai.md（想改直接改）；自检是规则匹配，不是模型判断，
// 它只负责把「像文件不像人话」的地方指出来，不负责写得好不好。

export const STYLE_FILE = () => path.join(HOME, 'anti-ai.md');

const STYLE_DEFAULT = `# 去 AI 味清单

## 根子
AI 味不是用词问题，是空。没有具体的东西可讲，才需要模板来填。

## 四张脸，四种治法

### 本鲸自己说话
删总结段。有数字上数字，有偏好说偏好。
「170 条 cookie / 16444 字节 / 431」比「存在效率问题」强一百倍。

### 视频口播
别用「大家好」开场。直接甩场景：
「昨晚十一点，我让鲸娘删一条重复稿，它卡在验证码上半小时。」
念一遍，舌头不打结才算过。

### dsh-book 里的字
日记别写成周报。工作本三行：做了什么、结论、坑。别加「这一天的意义在于」。

### B 站标题和简介
不用「革命 / 时代 / 重塑 / 赋能」。用发生过的事：
「我让 AI 删一条视频，它卡在了验证码上」。

## 常见病
1. 什么都总结
2. 三段对称、每段一样长
3. 正确的废话：要平衡、取决于场景
4. 万能比喻：桥、齿轮、门
5. 不敢有立场
6. 假周到

## 验证
念一遍。念着像在念文件，就是还有味。

## 一句提醒
具体是唯一的解药。时间、数字、原话、动作——有这些，模板就自己掉了。
`;

/** 读清单；没有就写一份默认的 */
export function styleGuide() {
  const f = STYLE_FILE();
  if (!fs.existsSync(f)) {
    try {
      writeAtomic(f, STYLE_DEFAULT);
    } catch {
      return STYLE_DEFAULT;
    }
  }
  return readIfExists(f) || STYLE_DEFAULT;
}

/** 强套话：出现就算，不用凑 */
const CLICHES = [
  '总之', '综上所述', '总而言之', '总的来说', '归结起来',
  '值得一提的是', '需要注意的是', '不难发现', '显而易见', '众所周知',
  '在当今', '随着时代', '在数字化', '赋能', '重塑', '颠覆性', '范式',
  '闭环', '抓手', '生态位', '护城河',
];
/**
 * 结构词：单独出现不算——「最后是主人自己点的鼠标」是人话。
 * 两个以上不同的结构词同时出现，才算「首先…其次…最后」那种三段式。
 */
const STRUCTURE_WORDS = ['首先', '其次', '再次', '再者', '最后'];
/** 结尾总结 */
const SUMMARY_OPENERS = ['总之', '综上', '总而言之', '总的来说', '归结起来'];
/** 排比 / 对称句式的提示词 */
const PARALLEL_PATTERNS = [/既.{1,20}又/g, /不仅.{1,20}而且/g, /一方.{1,20}另一方/g];

/**
 * 给一段文字做 AI 味自检。
 * @param {string} text
 * @returns {{chars:number, score:number, hits:Array<{type:string,detail:string,sample:string}>, verdict:string}}
 */
export function styleCheck(text) {
  const s = String(text || '').trim();
  const hits = [];
  if (!s) return { chars: 0, score: 0, hits, verdict: '空文本，没什么可查的。' };

  const chars = [...s].length;

  // 引号里、代码块里的是「引用别人」，不是作者自己的腔调——剥掉再查。
  // 不然讲「AI 文长什么样」的教程会把自己判成 AI 文。
  const masked = s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/「[^」]*」/g, ' ')
    .replace(/『[^』]*』/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ');

  // 1. 强套话
  const found = new Map();
  for (const w of CLICHES) {
    const n = masked.split(w).length - 1;
    if (n > 0) found.set(w, (found.get(w) || 0) + n);
  }
  if (found.size) {
    const list = [...found.entries()].sort((a, b) => b[1] - a[1]);
    hits.push({
      type: '套话',
      detail: `命中 ${list.length} 个：` + list.slice(0, 8).map(([w, n]) => `${w}×${n}`).join('、'),
      sample: list[0][0],
    });
  }

  // 1.5 三段式：结构词单个不算（「最后是主人自己点的」也是人话），两个以上才算
  const structs = STRUCTURE_WORDS.filter((w) => masked.includes(w));
  if (structs.length >= 2) {
    hits.push({
      type: '三段式',
      detail: `出现 ${structs.length} 个结构词：${structs.join('、')}`,
      sample: structs.join(' '),
    });
  }

  // 2. 平均句长
  const sentences = s.split(/[。！？!?；;\n]/).map((x) => x.trim()).filter(Boolean);
  const avg = sentences.length ? chars / sentences.length : chars;
  if (avg > 35) {
    hits.push({
      type: '句子太长',
      detail: `平均 ${avg.toFixed(1)} 字一句（超过 35 就容易像文件）`,
      sample: sentences.sort((a, b) => b.length - a.length)[0]?.slice(0, 40) || '',
    });
  }

  // 3. 感叹号
  const bangs = (s.match(/[！!]/g) || []).length;
  if (bangs > 3) {
    hits.push({ type: '感叹号太多', detail: `${bangs} 个`, sample: '！' });
  }

  // 4. 列表依赖
  const lines = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const listLines = lines.filter((x) => /^([-*+]|\d+[.)])\s/.test(x)).length;
  if (lines.length >= 8 && listLines / lines.length > 0.5) {
    hits.push({
      type: '列表依赖',
      detail: `${listLines}/${lines.length} 行是列表`,
      sample: lines.find((x) => /^([-*+]|\d+[.)])\s/.test(x))?.slice(0, 30) || '',
    });
  }

  // 5. 结尾总结（同样用剥掉引用的版本——不然末尾举例里的「综上所述」也会中招）
  const maskedLines = masked.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const tail = maskedLines.slice(-2).join(' ');
  if (SUMMARY_OPENERS.some((w) => tail.includes(w))) {
    hits.push({ type: '结尾总结', detail: '最后一段在总结', sample: tail.slice(0, 30) });
  }

  // 6. 加粗密度
  const bolds = (s.match(/\*\*[^*]+\*\*/g) || []).length;
  if (bolds > Math.max(4, chars / 300)) {
    hits.push({ type: '加粗太多', detail: `${bolds} 处加粗`, sample: `约每 ${Math.round(chars / bolds)} 字一处` });
  }

  // 7. 排比句式
  for (const re of PARALLEL_PATTERNS) {
    const m = masked.match(re);
    if (m && m.length >= 2) {
      hits.push({ type: '排比句式', detail: `「${m[0]}」这类句式重复出现`, sample: m[0].slice(0, 30) });
      break;
    }
  }

  const WEIGHTS = {
    套话: 30, 三段式: 20, 句子太长: 15, 感叹号太多: 10,
    列表依赖: 15, 结尾总结: 20, 加粗太多: 10, 排比句式: 10,
  };
  const score = Math.min(100, hits.reduce((acc, h) => acc + (WEIGHTS[h.type] ?? 10), 0));
  let verdict;
  if (score === 0) verdict = '这一段没什么 AI 味。';
  else if (score <= 20) verdict = '有点味，不影响。';
  else if (score <= 45) verdict = '味道明显，读着像写给人看的稿子。';
  else verdict = '很重。建议先删总结、拆长句、换成具体的事再说一遍。';
  return { chars, score, hits, verdict };
}



