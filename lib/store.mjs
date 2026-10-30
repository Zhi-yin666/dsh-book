// dsh-book / lib/store.mjs —— 三本书的读写
// 数据全在 ~/.dsh/book/，删目录 = 卸载干净
// 配置走 ~/.dsh/book/config.json（不再依赖 DSH 设置页 —— host 插件没有伴生前端包就不会有 UI）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = path.join(os.homedir(), '.dsh', 'book');

/** 默认配置。改这些不用动代码：编辑 ~/.dsh/book/config.json */
export const DEFAULT_CONFIG = {
  cardPath: '',        // 笔记本文件（空 = ~/.dsh/book/card/card.md）
  cardLimit: 600,      // 笔记本每轮注入字数
  workDays: 3,         // 工作本"热"的天数，过期只冷存
  workInjectLimit: 800, // 工作本注入字数上限
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
> 「我选的」= AI 自己认的原则；「你要的」= 你希望的样子。
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
    '> 「我选的」= AI 自己认的原则；「你要的」= 你希望的样子。',
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
export function workAdd({ title, detail, tags }) {
  const t = String(title || '').trim();
  if (!t) throw new Error('标题不能为空');
  const day = todayKey();
  const file = path.join(bookDir('work'), `${day}.md`);
  const lines = [`## ${clock()} · ${t}`];
  for (const d of String(detail || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    lines.push(`- ${d}`);
  }
  const tg = Array.isArray(tags) ? tags.filter(Boolean).join(', ') : String(tags || '').trim();
  if (tg) lines.push(`- tags: ${tg}`);
  lines.push('');
  const body = lines.join('\n') + '\n';
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, body, 'utf8');
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
    if (cur && line.trim().startsWith('-')) cur.lines.push(line.trim().replace(/^-\s*/, ''));
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
  const rows = items.map((x) => `- ${x.day.slice(5)} ${x.time} ${x.title}`);
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

/** 关键词搜索全文（用于判断"这事以前做过没有"） */
export function workSearch(query, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) throw new Error('搜什么？给个关键词');
  const hits = [];
  const files = workFiles().slice().reverse(); // 新→旧
  for (const f of files) {
    const day = f.replace(/\.md$/, '');
    const text = readIfExists(path.join(bookDir('work'), f));
    if (!text) continue;
    const blocks = text.split(/\n(?=##\s)/);
    for (const b of blocks) {
      if (!b.toLowerCase().includes(q)) continue;
      const first = b.split(/\r?\n/)[0] || '';
      const title = first.replace(/^##\s*/, '').trim();
      hits.push({ day, title, excerpt: b.trim().split(/\r?\n/).slice(0, 6).join('\n') });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
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

/* ================= 日记本（经历 · 世界树五支 + §〇 交接） ================= */

export const DIARY_BRANCHES = ['相处', '心意', '教训', '做成', '悬着'];
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

function renderDiary({ branch, mood, weight, created, title, body, extra }) {
  const lines = [
    '---',
    `branch: ${branch}`,
    `mood: ${mood}`,
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
export function diaryAdd({ branch, title, body, mood, weight, extra }) {
  const br = DIARY_BRANCHES.includes(branch) ? branch : '相处';
  const md = DIARY_MOODS.includes(mood) ? mood : '中性';
  const t = String(title || '').trim();
  if (!t) throw new Error('标题不能为空');
  const s = stampNow();
  const w = br === '教训' ? LESSON_WEIGHT : Number(weight) > 0 ? Number(weight) : DEFAULT_WEIGHT;
  const file = path.join(branchDir(br), `${s.day}-${s.hhmm}-${sanitizeTitle(t)}.md`);
  const text = renderDiary({
    branch: br,
    mood: md,
    weight: w,
    created: s.full,
    title: t,
    body,
    extra,
  });
  writeAtomic(file, text);
  return { ok: true, file, branch: br, mood: md, weight: w, day: s.day };
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

/** 按关键词 / 日期 / 分支搜 */
export function diarySearch({ keyword, day, branch, limit = 10 } = {}) {
  const kw = String(keyword || '').trim().toLowerCase();
  const d = String(day || '').trim();
  const items = diaryList({ branch, limit: 500 });
  const hits = [];
  for (const it of items) {
    if (d && !it.created.startsWith(d) && !it.name.startsWith(d)) continue;
    const text = readIfExists(it.file);
    if (kw && !text.toLowerCase().includes(kw)) continue;
    hits.push(it);
    if (hits.length >= limit) break;
  }
  return hits;
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
    String(who || 'AI 助手，在 DSH 里干活，写代码和画图').trim(),
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

export function spineWrite(text) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('主干不能为空');
  const chars = [...clean];
  const out = chars.length > SPINE_LIMIT ? chars.slice(0, SPINE_LIMIT - 20).join('') + '\n（主干超了，该压缩）' : clean;
  writeAtomic(SPINE_FILE(), out + '\n');
  return { ok: true, chars: [...out].length, limit: SPINE_LIMIT };
}

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
 * 教训那一支永不衰减；只搬不删。
 * @param {{ dryRun?: boolean, idleDays?: number }} opts
 */
export function dreamRun({ dryRun = false, idleDays = DREAM_IDLE_DAYS } = {}) {
  const now = Date.now();
  const days = Number(idleDays) > 0 ? Number(idleDays) : DREAM_IDLE_DAYS;
  const decayed = [];
  const sunk = [];

  for (const b of DIARY_BRANCHES) {
    if (b === '教训') continue; // 教训永不衰减
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

  const idx = diaryIndex();
  const work = workStats();
  const h = handoffRead();
  return {
    dryRun,
    idleDays: days,
    decayed,
    sunk,
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

