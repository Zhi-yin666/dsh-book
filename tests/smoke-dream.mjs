// dream 冒烟测试：造过期数据，验证降权与沉底
import fs from 'node:fs';
import { diaryAdd, diaryList, dreamRun, spineAgeDays } from '../lib/store.mjs';

const ago = (days) => {
  const d = new Date(Date.now() - days * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 1) 写两条：一条待降权、一条低权重待沉底、一条教训（不该动）
const a = diaryAdd({ branch: '相处', title: 'dream测试-待降权', body: '权重3，40天没翻', mood: '中性' });
const b = diaryAdd({ branch: '心意', title: 'dream测试-待沉底', body: '权重1，40天没翻', mood: '中性' });
const c = diaryAdd({ branch: '教训', title: 'dream测试-教训不动', body: '教训永不衰减', mood: '负面' });

// 2) 把前两条改成 40 天前翻的，b 的权重降到 1
for (const [path, w] of [[a.file, 3], [b.file, 1], [c.file, 5]]) {
  let t = fs.readFileSync(path, 'utf8');
  t = t.replace(/^lastAccess:.*$/m, `lastAccess: ${ago(40)}`);
  t = t.replace(/^weight:.*$/m, `weight: ${w}`);
  fs.writeFileSync(path, t, 'utf8');
}

console.log('=== dryRun ===');
console.log(JSON.stringify(dreamRun({ dryRun: true }), null, 2));

console.log('\n=== 真跑 ===');
const r = dreamRun();
console.log('降权:', r.decayed.map(x => `${x.title} ${x.from}->${x.to}`));
console.log('沉底:', r.sunk.map(x => x.title));

console.log('\n=== 复查 ===');
const all = diaryList({ limit: 50 });
for (const x of all.filter(i => i.title.startsWith('dream测试'))) {
  console.log(` ${x.branch} / ${x.title} / w=${x.weight}`);
}
console.log('主干年龄(天):', spineAgeDays());
