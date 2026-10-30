/**
 * lib/hostdeps.mjs —— 从宿主那棵树里取 `@deepseek-ai/schemastery`
 *
 * 为什么：schemastery 在桌面版 profile 里是 optional peer（autoInstallPeers: false），
 * 裸 import 会让整条插件不激活。所以先按"宿主树"找，找不到再裸 import，
 * 再找不到就返回 null —— 插件照常加载，只是没有 Config、设置页降级。
 * （做法抄自 dsh-bili-pond/lib/hostdeps.mjs，2026-10-26）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai');

function candidateRoots() {
  const out = [];
  const push = (p) => { if (p && !out.includes(p)) out.push(p); };
  push(process.env.DSH_HOST_MODULES);

  const appdata = process.env.APPDATA;
  if (appdata) {
    const npm = join(appdata, 'npm', 'node_modules');
    push(join(npm, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'));
    push(join(npm, '@deepseek-ai'));
    try {
      for (const n of readdirSync(join(npm, '@deepseek-ai'))) {
        push(join(npm, '@deepseek-ai', n, 'node_modules', '@deepseek-ai'));
      }
    } catch { /* 没有就算了 */ }
  }

  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'));
    }
  } catch { /* 没有就算了 */ }

  push(SELF_MODULES);
  return out;
}

function entryUrlFor(root, name) {
  try {
    const dir = join(root, name);
    const pkgFile = join(dir, 'package.json');
    if (!existsSync(pkgFile)) return null;
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    const dot = pkg.exports?.['.'];
    const rel = typeof dot === 'string' ? dot : (dot?.import || dot?.default || pkg.module || pkg.main);
    if (!rel) return null;
    const file = join(dir, String(rel).replace(/^\.\//, ''));
    return existsSync(file) ? pathToFileURL(file).href : null;
  } catch { return null; }
}

async function fromHostTree(name) {
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue;
    const url = entryUrlFor(root, name);
    if (!url) continue;
    try {
      return await import(url);
    } catch { /* 换下一个 */ }
  }
  return null;
}

/** @returns {Promise<{ z: any | null, notes: string[] }>} */
export async function loadSchemastery() {
  const notes = [];
  let mod = await fromHostTree('schemastery');
  if (!mod) {
    try {
      mod = await import('@deepseek-ai/schemastery');
      notes.push('schemastery：宿主树里没有，用自己依赖里那份');
    } catch {
      notes.push('schemastery 拿不到 —— 没有 Config，设置页降级（插件照常跑）');
    }
  }
  return { z: mod?.default ?? mod ?? null, notes };
}
