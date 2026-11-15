// 压缩后重注入快照的冒烟测试 —— 只读，不写任何数据
// （~/.dsh/book 是真实数据，这个测试只调用纯读函数）
import { buildReinjection } from '../lib/reinject.mjs';
import { readConfig } from '../lib/store.mjs';

const cfg = readConfig();
console.log('配置里的 0.2 字段:', {
  enableReinject: cfg.enableReinject,
  reinjectLimit: cfg.reinjectLimit,
  enableRemind: cfg.enableRemind,
  remindSteps: cfg.remindSteps,
  remindCooldownMin: cfg.remindCooldownMin,
});

const snap = buildReinjection();
console.log('\n-- 默认快照（上限', cfg.reinjectLimit, '字）--');
console.log('字数:', [...snap].length);
console.log(snap || '(空 —— 本机三本书都没内容)');

const small = buildReinjection(120);
console.log('\n-- 限 120 字 --');
console.log('字数:', [...small].length, '（应 ≤120）');
console.log(small);

const empty = buildReinjection(80);
console.log('\n-- 限 80 字（更狠，验证截断不会崩）--');
console.log('字数:', [...empty].length);

const ok = [...small].length <= 120 && [...empty].length <= 80;
console.log('\n结果:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
