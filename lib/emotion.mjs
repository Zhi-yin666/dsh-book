// lib/emotion.mjs —— 喜怒哀惧四维情绪（0.3.0）
//
// 设计来自主人 2026-10-27 定的规则：
//   1. 四维，每维 0-10，写入时按事件增量累加；
//   2. 某维满了（=10），其他维的增量打五折；
//   3. 怒 / 哀 / 惧 任一满，额外再压「喜」的增量（又一层五折）；
//   4. 每维随时间衰减，半衰期不同：怒最快，喜最慢（喜 = 底色）。
//
// 这个文件只管「情绪这一层」：读写心境、增量、抑制、衰减、格式化。
// 不知道日记长什么样，也不写日记 —— 那是 store.mjs 的事（单向依赖，避免循环）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 四维，顺序固定：喜 / 怒 / 哀 / 惧 */
export const EMOTIONS = ['喜', '怒', '哀', '惧'];
/** 每维上限 */
export const EMOTION_CAP = 10;
/**
 * 半衰期（天）。
 * 喜最长 —— 好事记得久，是底色；
 * 怒最短 —— 火气不该过夜；
 * 惧比哀长一点 —— 怕过的东西忘太快会再吃亏。
 */
export const HALF_LIFE_DAYS = { 喜: 90, 怒: 2, 哀: 14, 惧: 7 };
/** 满了之后，别的维增量打几折 */
const SUPPRESS = 0.5;
/** 这一层「算入心境」的最小可见值 */
const VISIBLE = 0.5;

const MOOD_FILE = () => path.join(os.homedir(), '.dsh', 'book', 'mood.json');

const zero = () => ({ 喜: 0, 怒: 0, 哀: 0, 惧: 0 });

const round2 = (n) => Number(Number(n).toFixed(2));

/** 从任意形状里取出一组合法情绪（缺的补 0，超界夹到 0-10） */
export function normalizeEmotion(raw) {
  const out = zero();
  if (!raw || typeof raw !== 'object') return out;
  for (const k of EMOTIONS) {
    const n = Number(raw[k]);
    out[k] = Number.isFinite(n) && n > 0 ? Math.min(EMOTION_CAP, n) : 0;
  }
  return out;
}

/** 向量长度（0-20）：既是「情绪强度」，也是旧的 intensity 的替代品 */
export function emotionMagnitude(e) {
  return Math.sqrt(EMOTIONS.reduce((s, k) => s + (Number(e?.[k]) || 0) ** 2, 0));
}

/** 把情绪写成一行 frontmatter：`emotion: 喜0 怒0 哀4 惧2` */
export function formatEmotion(e) {
  return EMOTIONS.map((k) => `${k}${Math.round(Number(e?.[k]) || 0)}`).join(' ');
}

/** 解析 `喜0 怒0 哀4 惧2`（也容忍分隔符是空格/逗号/顿号） */
export function parseEmotion(text) {
  const out = zero();
  if (!text) return out;
  const s = String(text);
  for (const k of EMOTIONS) {
    const m = s.match(new RegExp(`${k}\\s*[:：=]?\\s*(\\d+(?:\\.\\d+)?)`));
    if (m) out[k] = Math.min(EMOTION_CAP, Number(m[1]));
  }
  return out;
}

/** 读心境文件；坏了就当作一片平静 */
export function readMood() {
  try {
    const j = JSON.parse(fs.readFileSync(MOOD_FILE(), 'utf8'));
    const e = normalizeEmotion(j.emotion);
    return { emotion: e, updated: typeof j.updated === 'string' ? j.updated : new Date().toISOString() };
  } catch {
    return { emotion: zero(), updated: new Date().toISOString() };
  }
}

/** 单维衰减：v * 0.5^(天数 / 半衰期) */
function decayOne(v, days, halfLife) {
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(days) || days <= 0) return v > 0 ? v : 0;
  return v * Math.pow(0.5, days / halfLife);
}

/** 按「距上次更新过了多久」把心境衰减到当下 */
export function decayMood(mood, now = new Date()) {
  const last = Date.parse(mood?.updated ?? '');
  const days = Number.isFinite(last) ? Math.max(0, (now.getTime() - last) / 86400000) : 0;
  const out = zero();
  for (const k of EMOTIONS) out[k] = round2(decayOne(mood?.emotion?.[k] ?? 0, days, HALF_LIFE_DAYS[k]));
  return { emotion: out, updated: now.toISOString(), days };
}

/**
 * 给心境加一次情绪。
 * @param {{喜?:number,怒?:number,哀?:number,惧?:number}} delta 想加的量（>0 才生效）
 * @param {Date} [now]
 * @returns {{before:object, inc:object, after:object, suppressed:boolean}}
 */
export function bumpEmotion(delta, now = new Date()) {
  const cur = decayMood(readMood(), now);
  const before = { ...cur.emotion };
  const full = (k) => before[k] >= EMOTION_CAP - 1e-6;

  const inc = zero();
  let suppressed = false;
  for (const k of EMOTIONS) {
    const d = Number(delta?.[k]) || 0;
    if (!(d > 0)) continue;
    let factor = 1;
    // 规则 2：别的维有满的 → 这一维的增量打五折
    if (EMOTIONS.some((o) => o !== k && full(o))) {
      factor *= SUPPRESS;
      suppressed = true;
    }
    // 规则 3：怒/哀/惧 任一满 → 再压「喜」
    if (k === '喜' && ['怒', '哀', '惧'].some(full)) {
      factor *= SUPPRESS;
      suppressed = true;
    }
    inc[k] = round2(d * factor);
  }

  const after = zero();
  for (const k of EMOTIONS) after[k] = round2(Math.min(EMOTION_CAP, before[k] + inc[k]));

  const payload = { emotion: after, updated: now.toISOString() };
  try {
    fs.mkdirSync(path.dirname(MOOD_FILE()), { recursive: true });
    fs.writeFileSync(MOOD_FILE(), JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    /* 写不进去就算了，情绪不该挡住干活 */
  }
  return { before, inc, after, suppressed };
}

/** 把心境说成一句话（注进上下文用）；很轻就不说话 */
export function describeMood(mood) {
  const e = mood?.emotion ?? zero();
  const shown = EMOTIONS.filter((k) => (e[k] ?? 0) >= VISIBLE).map((k) => `${k} ${e[k].toFixed(1)}`);
  if (!shown.length) return '';
  let top = '喜';
  for (const k of EMOTIONS) if ((e[k] ?? 0) > (e[top] ?? 0)) top = k;
  return `[${shown.join(' / ')}] 主调：${top}`;
}
