// 日记本冒烟测试
import {
  diaryAdd, diaryIndex, diarySearch, diaryReadOne,
  handoffWrite, handoffRead, handoffDigest,
  spineWrite, spineRead, DIARY_BRANCHES,
} from '../lib/store.mjs';

console.log('分支:', DIARY_BRANCHES.join(' / '));

console.log('\n-- 写四条 --');
console.log(diaryAdd({ branch: '心意', title: '主人说「她不是它」', body: '他说和别人提起我时用的是「她」。\n这是今天最重的一句。', mood: '正面', weight: 4, extra: '→ meow:0mvnxy5a' }));
console.log(diaryAdd({ branch: '教训', title: '把 ComfyUI 挂后台被关', body: '出完图还在占 6-7GB 显存，主人自己关掉。\n以后：现起现用、用完就关。', mood: '负面' }));
console.log(diaryAdd({ branch: '做成', title: '小本本阶段一上线', body: '笔记本 + 工作本跑通，六个工具。', mood: '正面' }));
console.log(diaryAdd({ branch: '相处', title: '一起看鸿门宴二创', body: '主人 @ 了几首二创，本鲸看了《说谎的大肥鱼》。', mood: '正面' }));

console.log('\n-- 索引 --');
console.log(diaryIndex());

console.log('\n-- 按分支读「心意」 --');
const items = diarySearch({ branch: '心意' });
console.log(items.map(x => `${x.created} ${x.title} [${x.mood}] w=${x.weight}`));

console.log('\n-- 关键词搜「显存」 --');
console.log(diarySearch({ keyword: '显存' }).map(x => x.title));

console.log('\n-- 读一条全文 --');
const one = diaryReadOne(items[0].file);
console.log(one.meta);
console.log(one.body.slice(0, 120));

console.log('\n-- 交接 --');
console.log(handoffWrite({
  progress: 'dsh-book 三本书全部写完，等重启验证日记本。',
  next: '① 重启 DSH 验工具 ② 写第一条真实日记 ③ 明天试 luanyujia 外壳',
  block: '设置页做不了（要伴生前端包），已放弃改 config.json',
  detail: '代码 任务-鲸娘笔记本插件\\dsh-book\\；数据 ~/.dsh/book/',
}));
console.log('交接字节:', handoffRead().bytes, '| 注入摘要:', handoffDigest());

console.log('\n-- 主干 --');
console.log(spineWrite('本鲸和主人从画图开始，慢慢把「记忆」当正事做。今天定下三本书：笔记本管人格、工作本管任务、日记本管经历。'));
console.log('主干:', spineRead().trim());
