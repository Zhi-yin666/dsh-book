// 假宿主集成测试 —— 不进 DSH，直接调 apply()，验证 0.2.0 的钩子与注入路径。
// 只读本地文件，不写任何数据。
//
// 跑法（带假 dsh-llm，验证注入真正发生）：
//   $env:DSH_HOST_MODULES = "<工作区>\.fake-host\node_modules\@deepseek-ai"
//   node tests/fake-host.mjs
// 不设该变量也能跑，验证「拿不到构造器时原样放行」。
import { apply } from '../lib/index.js';

const handlers = {};
const registered = [];
const sections = [];

const sectionDefs = [];
const ctx = {
  tools: { register: (d) => registered.push(d?.name ?? '?') },
  get: (name) => {
    if (name === 'systemPrompt') {
      return { section: (s) => { sections.push(s.name); sectionDefs.push(s); } };
    }
    return null;
  },
  on: (evt, fn) => {
    (handlers[evt] ??= []).push(fn);
  },
  effect: (fn) => {
    try { fn(); } catch { /* 没有 webServer 时可能直接抛，忽略 */ }
  },
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
};

apply(ctx);

// 模拟一个真实 agent：带自己的 ctx（session/event 的统计就挂在它上面）
const agentEvents = {};
const makeAgent = (id, origin = 'main') => ({
  session: { id, header: { origin } },
  ctx: { on: (evt, fn) => { (agentEvents[evt] ??= []).push(fn); } },
});
const agent = makeAgent('fake-sid-1');
const subAgent = makeAgent('fake-sid-2', 'subagent');

const downstream = {
  kind: 'enter',
  messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
};
const runPreStep = async (a = agent) => {
  let out;
  for (const h of handlers['agent/pre-step'] ?? []) {
    out = await h({ agent: a, signal: { aborted: false } }, async () => downstream);
  }
  return out;
};
let seq = 0;
const emit = (type, data, a = agent) => {
  seq += 1;
  const ev = { type, data, seq, time: Date.now() };
  for (const h of handlers['session/event'] ?? []) h(a.session, ev);
  for (const h of agentEvents['session/event'] ?? []) h(a.session, ev);
};

// 真实顺序：agent 的事件监听在第一次 pre-step 时挂上，所以先暖机
const warm = await runPreStep();

// 1) 跑 15 步、一笔没落 -> 应安排提醒
emit('turn/start');
for (let i = 0; i < 15; i += 1) emit('tool/call', { name: 'read_file' });
emit('turn/end');

// 2) 压缩结束 -> 应安排重注入
emit('compaction/end', {});

// 3) 子代理压缩 -> 不安排（只验证不崩）
emit('compaction/end', {}, subAgent);

// 4) 下一次 pre-step：快照 + 提醒应一起注入
const result = await runPreStep();
const msgs = result?.messages ?? [];
const injected = msgs.filter((m) => m?.source?.plugin === 'dsh-book');
const text = String(injected[0]?.content?.[0]?.text ?? '');
const injectedBeforeUser = msgs.length === 2 && msgs[0]?.source?.plugin === 'dsh-book';
const hasSnap = text.includes('快照');
const hasRemind = text.includes('没落笔');

// 5) 子代理 pre-step：不注入
const subResult = await runPreStep(subAgent);
const subUntouched = subResult?.messages?.length === downstream.messages.length;

// 6) 状态已消费，再跑不应重复注入
const again = await runPreStep();
const noRepeat = again?.messages?.length === downstream.messages.length;

// 7) 兜底段：没有构造器时，快照/提醒应进 book:note 段
const noteSec = sectionDefs.find((s) => s.name === 'book:note');
const noteText = noteSec ? String(noteSec.text() ?? '') : '';
const noteOk = noteSec ? (noteText.includes('快照') || noteText.includes('没落笔')) : true;

console.log('注册工具数:', registered.length, '| 注入段:', sections.join(', '));
console.log('钩子:', Object.keys(handlers).join(', '), '| agent 级钩子:', Object.keys(agentEvents).join(', '));
console.log('暖机 pre-step 消息数:', warm?.messages?.length, '（应为 1）');
console.log('注入后消息数:', msgs.length, '| 来源:', msgs.map((m) => m?.source?.plugin ?? m?.source?.kind).join(' / '));
console.log('含快照:', hasSnap, '| 含提醒:', hasRemind);
console.log('注入路径:', injectedBeforeUser ? '已注入到用户消息前' : '原样放行（无构造器）');
console.log('兜底段 book:note:', noteSec ? `有内容=${noteText.length > 0} 含快照=${noteText.includes('快照')} 含提醒=${noteText.includes('没落笔')}` : '未注册');
console.log('子代理不注入:', subUntouched, '| 不重复注入:', noRepeat);

const ok = (injectedBeforeUser
  ? hasSnap && hasRemind && subUntouched && noRepeat
  : msgs.length === 1 && subUntouched && noRepeat) && noteOk;
console.log('\n结果:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
