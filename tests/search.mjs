// BM25-lite 检索的单元测试 —— 纯函数，不读真实数据
import { tokenize, rankDocuments } from '../lib/search.mjs';

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fail += 1;
};

const t1 = tokenize('把应用写崩了');
check('中文切 bigram', t1.includes('应用') && t1.includes('写崩'), JSON.stringify(t1));
check('英文按词切', tokenize('BOM 事故').includes('bom'));
check('单字成段保留', tokenize('看').includes('看'));

const docs = [
  { id: 'bom', text: '改 profile 时写进 BOM，DSH 起不来', ageDays: 1 },
  { id: 'lora', text: '换了底模 NoobAI，手和尾巴画对了', ageDays: 2 },
  { id: 'plugin', text: '给插件加了检索，还要再调', ageDays: 30 },
];

const r1 = rankDocuments(docs, 'BOM 崩');
check('多词查询能命中（原词）', r1[0]?.id === 'bom', JSON.stringify(r1.map((x) => `${x.id}:${x.score}`)));

const r2 = rankDocuments(docs, '插件 检索');
check('拆成两个词也能命中', r2[0]?.id === 'plugin', JSON.stringify(r2.map((x) => x.id)));

const r3 = rankDocuments(docs, '底模');
check('单条命中', r3.length === 1 && r3[0].id === 'lora');

// 排序：同文本，教训支 ×1.5
const same = [
  { id: 'normal', text: '写配置时弄坏了应用', ageDays: 1 },
  { id: 'lesson', text: '写配置时弄坏了应用', ageDays: 1, branch: '教训' },
];
const r4 = rankDocuments(same, '写配置 弄坏');
check('教训支加权（同文本排前）', r4[0]?.id === 'lesson', JSON.stringify(r4.map((x) => `${x.id}:${x.score}`)));

// 时间衰减：同文本，新的分高
const aged = [
  { id: 'old', text: '同一个问题又出现了一次', ageDays: 60 },
  { id: 'new', text: '同一个问题又出现了一次', ageDays: 0 },
];
const r5 = rankDocuments(aged, '同一个问题');
check('新的排前（时间衰减）', r5[0]?.id === 'new', JSON.stringify(r5.map((x) => `${x.id}:${x.score}`)));

// 不相关就空
check('不相关返回空', rankDocuments(docs, '完全不挨着的词').length === 0);

console.log('\n结果:', fail === 0 ? 'PASS' : `FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
