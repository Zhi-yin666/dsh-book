// 工具定义体检：schema 合规 + 返回字段是否都在声明里
// 只调「只读 / dryRun」的工具，写工具靠真实使用验证
import { apply } from '../lib/index.js';

const registered = [];
const ctx = {
  tools: { register: (d) => registered.push(d) },
  get: (n) => (n === 'systemPrompt' ? { section: () => {} } : undefined),
  logger: { info() {}, warn() {} },
};

apply(ctx);
console.log('注册工具数:', registered.length);
console.log(registered.map((t) => t.name).join(' · '));

/** 递归检查 JSON Schema 的两条红线 */
const problems = [];
function walkSchema(node, path) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'object') {
    if (node.additionalProperties === undefined) {
      problems.push(`${path}: object 缺 additionalProperties`);
    } else if (typeof node.additionalProperties !== 'boolean') {
      problems.push(`${path}: additionalProperties 必须是 boolean（不能是对象）`);
    }
  }
  for (const [k, v] of Object.entries(node.properties || {})) walkSchema(v, `${path}.${k}`);
  if (node.items) walkSchema(node.items, `${path}[]`);
}
for (const t of registered) {
  walkSchema(t.parameters, `${t.name}.parameters`);
  walkSchema(t.output?.schema, `${t.name}.output.schema`);
}
console.log('\n=== schema 静态检查 ===');
console.log(problems.length ? problems.join('\n') : '全部通过');

/** 只读工具实跑，检查返回字段 */
const cases = {
  book_card_list: {},
  book_work_recent: {},
  book_work_search: { query: '底模' },
  book_diary_read: { limit: 3 },
  book_diary_index: {},
  book_handoff_read: {},
  book_dream_run: { dryRun: true },
};

console.log('\n=== 只读工具实跑 ===');
let bad = 0;
for (const t of registered) {
  const args = cases[t.name];
  if (!args) continue;
  const allowed = new Set(Object.keys(t.output?.schema?.properties || {}));
  try {
    const out = await t.execute(args, {});
    const extra = Object.keys(out).filter((k) => !allowed.has(k));
    if (extra.length) {
      bad++;
      console.log(`❌ ${t.name}: 返回了没声明的字段 ${extra.join(', ')}`);
    } else {
      console.log(`✅ ${t.name}: ${Object.keys(out).length} 个字段全在 schema 里`);
    }
  } catch (e) {
    bad++;
    console.log(`❌ ${t.name}: 执行抛错 ${e?.message ?? e}`);
  }
}
console.log('\n结果:', bad ? `${bad} 个有问题` : '全部通过');
