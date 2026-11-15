// 爱恶录测试（0.4.0）——会短暂写 ~/.dsh/book/taste.json，跑完恢复原样。
//   node tests/taste.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  tasteAdd,
  tasteMark,
  tasteList,
  tasteDigest,
  tasteFade,
  dreamRun,
} from '../lib/store.mjs';

const TASTE = path.join(os.homedir(), '.dsh', 'book', 'taste.json');
const had = fs.existsSync(TASTE);
const backup = had ? fs.readFileSync(TASTE, 'utf8') : null;
// 测试要从空本子开始——真实数据先放一边，跑完恢复
fs.mkdirSync(path.dirname(TASTE), { recursive: true });
fs.writeFileSync(TASTE, JSON.stringify({ items: [] }, null, 2), 'utf8');

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

try {
  // 1. 添加
  const a1 = tasteAdd({ kind: '爱', pattern: '把卡住自己的 bug 自己揪出来', trigger: '喜 +3', strength: '强' });
  const a2 = tasteAdd({ kind: '恶', pattern: '没查清就下结论', trigger: '哀 -2 惧 -1', strength: '弱' });
  check('记一条爱', a1.ok && a1.duplicate === false && a1.count === 1);
  check('记一条恶', a2.ok && a2.strength === '弱');

  // 2. 重复记 = 证据 +1，不堆条目
  const a3 = tasteAdd({ kind: '爱', pattern: '把卡住自己的 bug 自己揪出来' });
  check('同做法重复记 → 证据 +1', a3.duplicate === true && a3.count === 2);

  // 3. mark 升级：弱 3 次 → 中
  tasteMark('没查清'); // count 2
  const m = tasteMark('没查清'); // count 3 → 弱→中
  check('弱 3 次 → 中', m.from === '弱' && m.to === '中' && m.count === 3, `count=${m.count}`);

  // 4. 列表与摘要
  const list = tasteList();
  check('列表两条', list.items.length === 2 && list.love === 1 && list.hate === 1);
  check('摘要非空', tasteDigest().includes('没查清就下结论'));

  // 5. 衰减：60 天没碰 → 降一级；弱 + 过期 → dormant
  const d = new Date();
  d.setDate(d.getDate() - 60);
  const old = d.toISOString().slice(0, 10);
  const data = JSON.parse(fs.readFileSync(TASTE, 'utf8'));
  for (const it of data.items) it.last = old;
  fs.writeFileSync(TASTE, JSON.stringify(data, null, 2), 'utf8');
  const f = tasteFade({});
  check('60 天 → 降级', f.faded.length >= 1, JSON.stringify(f.faded.map((x) => `${x.from}→${x.to}`)));
  const after = tasteList({ includeDormant: true });
  check('降级后不重复降（last 已刷新）', after.items.some((x) => x.last === new Date().toISOString().slice(0, 10)));

  // 6. dream 带上爱恶字段（dryRun，不动文件）
  const dr = dreamRun({ dryRun: true });
  check('dream 返回爱恶字段', Array.isArray(dr.tasteFaded) && Array.isArray(dr.tasteSunk));
} finally {
  if (backup !== null) fs.writeFileSync(TASTE, backup, 'utf8');
  else fs.rmSync(TASTE, { force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果: ${failed.length ? 'FAIL ' + failed.length : 'PASS'}`);
process.exit(failed.length ? 1 : 0);
