// 日记本冒烟测试
import {
  diaryAdd, diaryIndex, diarySearch, diaryReadOne,
  handoffWrite, handoffRead, handoffDigest,
  spineWrite, spineRead, DIARY_BRANCHES,
} from '../lib/store.mjs';

console.log('分支:', DIARY_BRANCHES.join(' / '));

console.log('\n-- 写四条 --');
console.log(diaryAdd({ branch: '心意', title: '记下一句重要的话', body: '今天听到一句很重的话。\n先记在这里。', mood: '正面', weight: 4 }));
console.log(diaryAdd({ branch: '教训', title: '后台进程忘了关', body: '跑完还在占显存，最后被手动关掉。\n以后：现起现用、用完就关。', mood: '负面' }));
console.log(diaryAdd({ branch: '做成', title: '第一版跑通', body: '笔记本 + 工作本都能用了，六个工具。', mood: '正面' }));
console.log(diaryAdd({ branch: '相处', title: '聊了一下午', body: '从工具聊到设计，记一笔。', mood: '正面' }));

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
  progress: '三本书全部写完，等重启验证日记本。',
  next: '① 重启 DSH 验工具 ② 写第一条真实日记 ③ 试设置页',
  block: '设置页做不了（要伴生前端包），改走 config.json',
  detail: '代码 ./dsh-book/；数据 ~/.dsh/book/',
}));
console.log('交接字节:', handoffRead().bytes, '| 注入摘要:', handoffDigest());

console.log('\n-- 主干 --');
console.log(spineWrite('这个项目从「给 AI 记点事」开始，慢慢把记忆当正事做。三本书：笔记本管人格、工作本管任务、日记本管经历。'));
console.log('主干:', spineRead().trim());
