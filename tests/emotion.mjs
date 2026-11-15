// 四维情绪的单元测试 —— 用临时 USERPROFILE 跑，绝不碰真实 mood.json
// 跑法：$env:USERPROFILE="<临时目录>"; node tests/emotion.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HALF_LIFE_DAYS,
  bumpEmotion,
  readMood,
  decayMood,
  describeMood,
} from '../lib/emotion.mjs';

const file = path.join(os.homedir(), '.dsh', 'book', 'mood.json');
const reset = () => { try { fs.unlinkSync(file); } catch { /* 没有就算了 */ } };

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fail += 1;
};

reset();

let r = bumpEmotion({ 喜: 3, 哀: 2 });
check('基础累加', r.after.喜 === 3 && r.after.哀 === 2, JSON.stringify(r.after));

for (let i = 0; i < 6; i += 1) bumpEmotion({ 喜: 5 });
let m = readMood();
check('单维上限 10', m.emotion.喜 === 10, JSON.stringify(m.emotion));

r = bumpEmotion({ 怒: 4 });
check('喜满 → 其他维增量打五折', r.inc.怒 === 2 && r.suppressed, `inc.怒=${r.inc.怒}`);

for (const k of ['怒', '哀', '惧']) {
  for (let i = 0; i < 4; i += 1) bumpEmotion({ [k]: 5 });
}
m = readMood();
r = bumpEmotion({ 喜: 4 });
const expected = 4 * 0.5 * 0.5;
check('怒/哀/惧 满 → 喜被压两层', Math.abs(r.inc.喜 - expected) < 0.01, `inc.喜=${r.inc.喜}，期望≈${expected}`);
check('怒/哀/惧 三维都满', ['怒', '哀', '惧'].every((k) => m.emotion[k] === 10), JSON.stringify(m.emotion));

// 衰减：四种情绪都满，40 天前
const old = new Date(Date.now() - 40 * 86400000).toISOString();
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ emotion: { 喜: 10, 怒: 10, 哀: 10, 惧: 10 }, updated: old }), 'utf8');
const dec = decayMood(readMood());
check('40 天后「怒」几乎归零', dec.emotion.怒 < 0.01, `怒=${dec.emotion.怒}`);
check('40 天后「喜」还留着大半', dec.emotion.喜 > 7, `喜=${dec.emotion.喜}`);
check('40 天后「哀」介于两者之间', dec.emotion.哀 > 0.1 && dec.emotion.哀 < dec.emotion.喜, `哀=${dec.emotion.哀}`);
console.log('  40 天后:', JSON.stringify(dec.emotion));
console.log('  半衰期:', JSON.stringify(HALF_LIFE_DAYS));

fs.writeFileSync(file, JSON.stringify({ emotion: { 喜: 6.2, 怒: 0, 哀: 3.4, 惧: 0 }, updated: new Date().toISOString() }), 'utf8');
console.log('  心境描述:', describeMood(readMood()));

reset();
console.log('\n结果:', fail === 0 ? 'PASS' : `FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
