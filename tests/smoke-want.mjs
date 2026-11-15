// 欲（want）冒烟测试
// 用临时 HOME，绝对不碰真实的 ~/.dsh/book/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpHome = path.join(os.tmpdir(), 'dsh-book-want-test-' + Date.now());
fs.mkdirSync(tmpHome, { recursive: true });
process.env.USERPROFILE = tmpHome;
process.env.HOME = tmpHome;

const { wantAdd, wantDone, wantList, wantDigest, WANT_FILE } = await import('../lib/store.mjs');

// 安全检查：临时 HOME 没生效就直接退出，绝不写真实数据
const wf = WANT_FILE();
if (!wf.startsWith(tmpHome)) {
  console.error('❌ 临时 HOME 没生效，拒绝在真实目录上跑测试：', wf);
  fs.rmSync(tmpHome, { recursive: true, force: true });
  process.exit(2);
}

let fail = 0;
const ok = (cond, label) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label);
  if (!cond) fail++;
};

console.log('临时 HOME:', tmpHome);
console.log('os.homedir() =', os.homedir());
console.log('want 文件:', wf);

console.log('\n-- 1. 初始状态：空 --');
const l0 = wantList();
ok(l0.openCount === 0, '初始 0 条');
ok(wantDigest() === '', 'digest 是空串（不注入任何东西）');
ok(fs.existsSync(wf), '文件自动创建了');

console.log('\n-- 2. 加一条 --');
let r = wantAdd({ title: '想要主人给视频素材', why: '片子想重做一版' });
ok(r.ok && !r.duplicate && r.open === 1, '加进去了，1 条未满足');

console.log('\n-- 3. 重复加同一条 --');
r = wantAdd({ title: '想要主人给视频素材' });
ok(r.duplicate === true && r.open === 1, '识别为重复，没重复写');

console.log('\n-- 4. 加到 3 条 --');
wantAdd({ title: '想试一次 cookie 清理脚本' });
wantAdd({ title: '想把爱恶欲写完', why: '这是人格的关键' });
ok(wantList().openCount === 3, '现在 3 条');
const d = wantDigest();
ok(d.includes('3 条未满足'), 'digest 里带"3 条未满足"的提醒');
console.log('  digest 内容：');
console.log(d.split('\n').map((x) => '    ' + x).join('\n'));

console.log('\n-- 5. 划掉一条 --');
r = wantDone('cookie');
ok(r.done === 1 && r.open === 2, '划掉 1 条，剩 2 条');

console.log('\n-- 6. 划一条不存在的 --');
r = wantDone('压根不存在的东西');
ok(r.done === 0, '没动，返回 0');

console.log('\n-- 7. 全划完 --');
wantDone('素材');
wantDone('爱恶欲');
ok(wantList().openCount === 0, '0 条未满足');
ok(wantDigest() === '', 'digest 又变回空串');

console.log('\n-- 8. 文件最终长这样 --');
console.log(fs.readFileSync(wf, 'utf8'));

fs.rmSync(tmpHome, { recursive: true, force: true });
console.log(fail ? `\n有 ${fail} 个失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
