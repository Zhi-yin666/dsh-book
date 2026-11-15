// 去 AI 味清单 + 自检测试（0.5.0）
//   node tests/style.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { styleGuide, styleCheck, STYLE_FILE } from '../lib/store.mjs';

const F = STYLE_FILE();
const had = fs.existsSync(F);
const backup = had ? fs.readFileSync(F, 'utf8') : null;

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

try {
  const g = styleGuide();
  check('清单能读出来且不是空', g.length > 100, `${g.length} 字`);
  check('清单文件已落盘', fs.existsSync(F));
  check('清单里有「念一遍」', g.includes('念一遍'));

  const aiText = `首先，让我们来谈谈这个问题的重要性。在当今数字化时代，AI 已经深刻地改变了我们的生活方式，我们需要认真思考如何在这种变革中找到平衡，既要拥抱变化，又要守住底线。

其次，值得一提的是，效率与质量之间存在着微妙的张力，二者不可偏废。众所周知，任何技术都有其两面性。

最后，综上所述，我们应该以开放的心态拥抱未来，赋能每一个个体，重塑整个行业格局。`;

  const humanText = `昨晚十一点，我让鲸娘删一条重复稿。它卡在验证码上半小时。最后是主人自己点的鼠标，两下就删了。`;

  const a = styleCheck(aiText);
  const h = styleCheck(humanText);
  check('AI 稿判重', a.score >= 45, `score=${a.score}`);
  check('人话稿判轻', h.score <= 15, `score=${h.score}`);
  check('AI 稿命中套话', a.hits.some((x) => x.type === '套话'));
  check('AI 稿命中结尾总结', a.hits.some((x) => x.type === '结尾总结'));
  check('人话稿没有套话命中', !h.hits.some((x) => x.type === '套话'));
  check('空文本不炸', styleCheck('').score === 0);

  console.log('\n--- AI 稿诊断 ---\n' + a.verdict);
  for (const x of a.hits) console.log(`  ${x.type}: ${x.detail}`);
  console.log('\n--- 人话稿诊断 ---\n' + h.verdict);
  for (const x of h.hits) console.log(`  ${x.type}: ${x.detail}`);
} finally {
  if (backup !== null) fs.writeFileSync(F, backup, 'utf8');
  else fs.rmSync(F, { force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果: ${failed.length ? 'FAIL ' + failed.length : 'PASS'}`);
process.exit(failed.length ? 1 : 0);
