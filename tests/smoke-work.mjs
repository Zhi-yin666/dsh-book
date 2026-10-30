// 工作本冒烟测试
import { workAdd, workSearch, workRecent, workDigest, workStats, readConfig } from '../lib/store.mjs';

console.log('配置:', readConfig());

console.log('写入:', workAdd({
  title: '换了新的底模版本',
  detail: '出图质量好了一截\n坑：放大修复只会把崩掉的细节一起放大',
  tags: ['comfyui', '底模'],
}));

console.log('写入:', workAdd({
  title: '归档脚本写错目录',
  detail: '原本写到 out/<月份>.md，应该是 digest/<月份>.md\n改完要重启才生效',
  tags: ['bug'],
}));

console.log('搜索「底模」:', JSON.stringify(workSearch('底模'), null, 2));
console.log('搜索「不存在的词」:', workSearch('不存在的词').length, '条');
console.log('最近:', JSON.stringify(workRecent().map(x => `${x.day} ${x.time} ${x.title}`), null, 2));
console.log('注入摘要:\n' + workDigest());
console.log('统计:', workStats());
