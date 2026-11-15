// 工作本冒烟测试
import { workAdd, workSearch, workRecent, workDigest, workStats, readConfig } from '../lib/store.mjs';

console.log('配置:', readConfig());

console.log('写入:', workAdd({
  title: '换底模到 NoobAI-XL v1.1',
  detail: '手和尾巴终于画对了\n坑：hires fix 只会把崩的细节放大',
  tags: ['comfyui', '底模'],
}));

console.log('写入:', workAdd({
  title: '修 bili_archive_append 写错目录',
  detail: '原本写 out/<月份>.md，应为 digest/<月份>.md\n改 mcp_server.py 第 1699 行，需重启生效',
  tags: ['bili', 'bug'],
}));

console.log('搜索「底模」:', JSON.stringify(workSearch('底模'), null, 2));
console.log('搜索「不存在的词」:', workSearch('不存在的词').length, '条');
console.log('最近:', JSON.stringify(workRecent().map(x => `${x.day} ${x.time} ${x.title}`), null, 2));
console.log('注入摘要:\n' + workDigest());
console.log('统计:', workStats());
