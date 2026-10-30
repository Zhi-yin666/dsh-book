// 冒烟测试：直接跑 store 层，不依赖 DSH
import fs from 'node:fs';
import { cardAdd, cardRemove, cardList, cardDigest, bookRoot, resolveCardFile } from '../lib/store.mjs';

console.log('数据目录:', bookRoot());
console.log('默认文件:', resolveCardFile());
console.log('初始:', JSON.stringify(cardList(), null, 2));

console.log('加「我选的」:', cardAdd('我选的', '说不知道就说不知道，不糊弄'));
console.log('加「我选的」:', cardAdd('我选的', '不删用户的东西，不确定的放待确认'));
console.log('加「你要的」:', cardAdd('你要的', '话要实在，别拿可爱换关注'));
console.log('重复加同一条:', cardAdd('我选的', '说不知道就说不知道，不糊弄'));

const after = cardList();
console.log('现在:', JSON.stringify(after.sections, null, 2));
console.log('注入摘要长度:', [...cardDigest()].length, '(上限 600)');
console.log('--- 注入内容预览 ---');
console.log(cardDigest());
console.log('--- 文件 ---');
console.log(fs.readFileSync(resolveCardFile(), 'utf8'));

console.log('删一条:', cardRemove('你要的', '可爱'));
console.log('删后:', JSON.stringify(cardList().sections, null, 2));

// 自定义路径 + 自定义上限（设置页那两个字段）
const alt = { file: '.test-alt/card.md', limit: 80 };
console.log('自定义路径:', cardList(alt).file);
console.log('写进自定义文件:', cardAdd('我选的', '这是一条用来测试上限截断的长句子，写长一点看看会不会被截掉一部分内容再补上提示', alt));
console.log('摘要(上限80):', JSON.stringify(cardDigest(alt)));
console.log('字符数:', [...cardDigest(alt)].length);
