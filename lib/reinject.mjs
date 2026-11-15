// lib/reinject.mjs —— 压缩后重注入的快照拼装（0.2.0）
//
// 为什么需要它：笔记本 / 工作本 / 交接都注册在 systemPrompt 里，每轮重算，
// 压缩不会把它们踢掉。真正会丢的是「这一轮读进上下文的进度细节」——
// 交接的下一步、最近在干什么、主干写到哪了。压缩事件一来，就补这一段。
//
// 设计约束：
//   1. 纯函数，不读会话、不调模型、不发网络请求。调用方给多少就拼多少。
//   2. 硬上限（默认 800 字），超了从尾部截，绝不让快照自己变成压缩源。
//   3. 拿不到内容就返回空串 —— 宁可什么都不注入，也不注入一条空壳。
import fs from 'node:fs';
import path from 'node:path';
import { readConfig, handoffDigest, workDigest, spineRead, bookRoot } from './store.mjs';

/** 快照开头这句很重要：告诉模型「这是补的背景，不是用户说的话」 */
const HEAD = '【小本本 · 压缩后快照】上面的上下文被压缩过。以下是当前进度，照着接，别重新问我：';

/**
 * 0.2 的诊断日志：只写本地小文件（≤64KB，超了留最近 150 行）。
 * 真机上光看会话记录分不清「事件没收到 / 构造器没拿到 / 状态没置上」，
 * 这三件事必须能事后查。任何异常都吞掉——诊断永远不影响主流程。
 */
export function diag(line) {
  try {
    const f = path.join(bookRoot(), '.0.2-diag.log');
    fs.appendFileSync(f, `${new Date().toISOString()} ${line}\n`, 'utf8');
    if (fs.statSync(f).size > 65536) {
      const keep = fs.readFileSync(f, 'utf8').split('\n').slice(-150).join('\n');
      fs.writeFileSync(f, keep, 'utf8');
    }
  } catch { /* 什么都不做 */ }
}

/**
 * @param {number} [limit] 字数上限（默认取 config.reinjectLimit = 800）
 * @returns {string} 可直接塞进消息的文本；没有内容时返回 ''
 */
export function buildReinjection(limit) {
  const cfg = readConfig();
  const max = Number(limit ?? cfg.reinjectLimit) || 800;

  const parts = [];

  // 交接优先：这是「干到哪、下一步、卡在哪」的接力棒
  try {
    const handoff = handoffDigest(220);
    if (handoff) parts.push(`【交接】${handoff}`);
  } catch { /* 单段失败不影响整体 */ }

  // 工作本：最近三天在干什么（workDigest 自己会按上限裁）
  try {
    const work = workDigest({ workInjectLimit: Math.max(120, Math.floor(max * 0.55)) });
    if (work) parts.push(`【最近三天】\n${work}`);
  } catch { /* 同上 */ }

  // 主干：长期主线，只取开头一段
  try {
    const spine = String(spineRead() || '').trim();
    if (spine) parts.push(`【主干】\n${[...spine].slice(0, 240).join('')}`);
  } catch { /* 同上 */ }

  if (!parts.length) return '';

  const text = HEAD + '\n' + parts.join('\n');
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 12).join('') + '\n（快照已截断）';
}
