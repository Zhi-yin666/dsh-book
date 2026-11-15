// dsh-book / lib/index.js —— 小本本插件入口
// 三本书：笔记本（人格·每轮注入）、工作本（任务·可搜·三天热存）、日记本（待做）
import {
  cardList,
  cardDigest,
  cardReplace,
  workAdd,
  workSearch,
  workRecent,
  workDigest,
  workDigestFallback,
  workStats,
  diaryAdd,
  diaryList,
  diarySearch,
  diaryReadOne,
  diaryIndex,
  handoffWrite,
  handoffRead,
  handoffDigest,
  spineRead,
  dreamRun,
  spineAgeDays,
  DIARY_BRANCHES,
  DIARY_MOODS,
  wantAdd,
  wantDone,
  wantList,
  wantDigest,
  tasteAdd,
  tasteList,
  tasteDigest,
  styleGuide,
  styleCheck,
  readConfig,
  DEFAULT_CONFIG,
} from './store.mjs';
import { loadSchemastery, loadCreateUserMessage } from './hostdeps.mjs';
import { buildReinjection, diag } from './reinject.mjs';
import { readMood, decayMood, describeMood } from './emotion.mjs';

/** 稳定 Cordis 插件名 */
export const name = 'dsh-book';
/** 依赖的宿主服务 */
export const inject = ['tools', 'systemPrompt', 'webServer'];

// 配置走 ~/.dsh/book/config.json；schemastery 拿不到就 Config=undefined，插件照常跑
const { z } = await loadSchemastery();

export const Config = !z
  ? undefined
  : z.object({
      cardPath: z.string().default('').extra('volatile', true),
      cardLimit: z.natural().default(DEFAULT_CONFIG.cardLimit).extra('volatile', true),
      workDays: z.natural().default(DEFAULT_CONFIG.workDays).extra('volatile', true),
      workInjectLimit: z.natural().default(DEFAULT_CONFIG.workInjectLimit).extra('volatile', true),
    });

const textOut = (text) => [{ type: 'text', text }];
const SECTION_ENUM = ['我选的', '你要的'];

/**
 * 0.2.0：压缩机取注入用的构造器。拿不到就是 null，
 * 插件照常跑，只是不做「压缩后重注入」——不为了注入把插件拖下水。
 */
const createUserMessage = await loadCreateUserMessage();
diag('load: createUserMessage=' + (createUserMessage ? 'ok' : 'NULL'));

/** 读配置：优先 config.json（store 里已经合并默认值），DSH config 只在设置页那套能用时才有意义 */
function opts() {
  return {};
}

export function apply(ctx) {
  const tools = [
    /* ------------------ 笔记本 ------------------ */    /* ------------------ 工作本 ------------------ */
    {
      name: 'book_work_add',
      description:
        '往「工作本」记一条今天做的事。写之前**先压缩**：标题一句话，详情最多三行（做了什么 / 结论 / 坑）。' +
        '工作本只热三天，过期冷存（不会删，搜得到）。' +
        '可选 feel：这件事做起来什么感觉（一句话，如「顺」「卡在 API」「烦」）——这是「感受」，不是情绪形容词堆。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', description: '一句话：这件事是什么（不超过 30 字）' },
          detail: { type: 'string', description: '详情，可换行；建议 1-3 行：做了什么 / 结论或坑' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签，方便以后搜' },
          feel: { type: 'string', description: '可选：做这件事的体感，一句话（会跟着摘要一起注入）' },
          emotion: {
            type: 'object',
            additionalProperties: false,
            description: '可选：四维情绪 0-10（喜/怒/哀/惧），只填有感的，缺省 0。会累加进心境',
            properties: {
              喜: { type: 'integer', minimum: 0, maximum: 10 },
              怒: { type: 'integer', minimum: 0, maximum: 10 },
              哀: { type: 'integer', minimum: 0, maximum: 10 },
              惧: { type: 'integer', minimum: 0, maximum: 10 },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            file: { type: 'string' },
            day: { type: 'string' },
            bytes: { type: 'integer' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) =>
          v.ok === false ? textOut('写入失败：' + (v.error ?? '未知错误')) : textOut(`记进工作本了（${v.day}）。`),
      },
      async execute(args) {
        try {
          return workAdd({ title: args.title, detail: args.detail, tags: args.tags, feel: args.feel, emotion: args.emotion });
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_work_search',
      description:
        '在工作本里按关键词搜历史记录。**接新任务前先搜一下**：搜到说明以前做过（可复用/别再踩坑），搜不到才当新任务。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', description: '关键词，支持中文片段' },
          limit: { type: 'integer', description: '最多返回几条，默认 20' },
          mode: {
            type: 'string',
            enum: ['ranked', 'exact'],
            description: 'ranked=按相关度排（默认，BM25）；exact=只认原词子串',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            count: { type: 'integer' },
            hits: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  day: { type: 'string' },
                  title: { type: 'string' },
                  excerpt: { type: 'string' },
                  score: { type: 'number' },
                  matched: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('搜索失败：' + (v.error ?? '未知错误'));
          if (!v.count) return textOut('工作本里没搜到——当成新任务处理。');
          const body = (v.hits ?? [])
            .map((h) => `### ${h.day} · ${h.title}\n${h.excerpt}`)
            .join('\n\n');
          return textOut(`搜到 ${v.count} 条：\n\n${body}`);
        },
      },
      async execute(args) {
        try {
          const hits = workSearch(args.query, args.limit ?? 20, args.mode ?? 'ranked');
          return { ok: true, count: hits.length, hits };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_work_recent',
      description: '看工作本最近几天的条目（默认按配置 3 天），外加总统计。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          days: { type: 'integer', description: '看最近几天，默认 3' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            days: { type: 'integer' },
            totalFiles: { type: 'integer' },
            totalEntries: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  day: { type: 'string' },
                  time: { type: 'string' },
                  title: { type: 'string' },
                },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读取失败：' + (v.error ?? '未知错误'));
          const list = (v.items ?? []).map((x) => `- ${x.day} ${x.time} ${x.title}`).join('\n') || '（空）';
          return textOut(`最近 ${v.days} 天：\n${list}\n\n累计 ${v.totalFiles} 天 / ${v.totalEntries} 条。`);
        },
      },
      async execute(args) {
        try {
          const days = args.days ?? readConfig().workDays;
          const items = workRecent(days).map((x) => ({ day: x.day, time: x.time, title: x.title }));
          const st = workStats();
          return { ok: true, days, totalFiles: st.files, totalEntries: st.entries, items };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },

    /* ------------------ 日记本（世界树） ------------------ */
    {
      name: 'book_diary_add',
      description:
        '往「日记本」记一条。六支选一个：相处（日常）、心意（主人说的、让我记住的）、教训（我做错/被纠正）、做成（有产出）、悬着（未定/欠着的）、故事（主人讲的/看来的故事，连同自己的反应）。' +
        '教训和故事两支永不衰减；其余超过 30 天没人翻会降权沉底（不删）。' +
        'intensity 是情绪强度（1-5）：≥4 自动不衰减；keep 显式标「这条别沉」。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['branch', 'title'],
        properties: {
          branch: { type: 'string', enum: DIARY_BRANCHES, description: '哪个分支' },
          title: { type: 'string', description: '一句话标题（≤24 字）' },
          body: { type: 'string', description: '正文；写实在，别写流水账' },
          mood: { type: 'string', enum: DIARY_MOODS, description: '情绪标记，默认中性' },
          weight: { type: 'integer', description: '权重 1-5，默认 3；教训固定 5' },
          intensity: { type: 'integer', description: '情绪强度 1-5（默认 3；教训默认 5）——强的记忆不该被时间冲淡' },
          keep: { type: 'boolean', description: '显式标记「这条永远不沉底」（被认可过的、意外的）' },
          emotion: {
            type: 'object',
            additionalProperties: false,
            description: '可选：四维情绪 0-10（喜/怒/哀/惧）。混合情绪就填两维，比如又喜又怕：喜3 惧7',
            properties: {
              喜: { type: 'integer', minimum: 0, maximum: 10 },
              怒: { type: 'integer', minimum: 0, maximum: 10 },
              哀: { type: 'integer', minimum: 0, maximum: 10 },
              惧: { type: 'integer', minimum: 0, maximum: 10 },
            },
          },
          extra: { type: 'string', description: '可选：相关指针（工作本条目 / 记忆 id / 文件路径）' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            file: { type: 'string' },
            branch: { type: 'string' },
            mood: { type: 'string' },
            weight: { type: 'integer' },
            intensity: { type: 'integer' },
            keep: { type: 'boolean' },
            emotion: { type: 'string' },
            day: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) =>
          v.ok === false
            ? textOut('写入失败：' + (v.error ?? '未知错误'))
            : textOut(
                `记进「${v.branch}」了（${v.day}，${v.mood}，权重 ${v.weight}，强度 ${v.intensity}${v.keep ? '，不沉底' : ''}）。`,
              ),
      },
      async execute(args) {
        try {
          return diaryAdd({
            branch: args.branch,
            title: args.title,
            body: args.body,
            mood: args.mood,
            weight: args.weight,
            intensity: args.intensity,
            keep: args.keep,
            emotion: args.emotion,
            extra: args.extra,
          });
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_diary_read',
      description:
        '翻日记本：可按分支、按日期（2026-10-26）、按关键词筛，返回条目列表和正文摘录。想不起某事在哪一支时，用关键词搜。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branch: { type: 'string', enum: DIARY_BRANCHES, description: '只看某一支' },
          day: { type: 'string', description: '只看某天，如 2026-10-26' },
          keyword: { type: 'string', description: '关键词' },
          limit: { type: 'integer', description: '最多几条，默认 8' },
          mode: {
            type: 'string',
            enum: ['ranked', 'exact'],
            description: 'ranked=按相关度排（默认，BM25）；exact=只认原词子串',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            count: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  branch: { type: 'string' },
                  created: { type: 'string' },
                  mood: { type: 'string' },
                  title: { type: 'string' },
                  excerpt: { type: 'string' },
                },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读取失败：' + (v.error ?? '未知错误'));
          if (!v.count) return textOut('没翻到符合条件的日记。');
          const body = (v.items ?? [])
            .map((x) => `### ${x.created} · ${x.branch} · ${x.title} [${x.mood}]\n${x.excerpt}`)
            .join('\n\n');
          return textOut(`翻到 ${v.count} 条：\n\n${body}`);
        },
      },
      async execute(args) {
        try {
          const limit = args.limit ?? 8;
          const hits = diarySearch({
            keyword: args.keyword,
            day: args.day,
            branch: args.branch,
            limit,
            mode: args.mode ?? 'ranked',
          });
          const items = hits.map((h) => {
            const r = diaryReadOne(h.file);
            const excerpt = r.body.replace(/^#.*$/gm, '').replace(/^\[.*\]$/gm, '').trim().split(/\n+/).slice(0, 4).join('\n');
            return { branch: h.branch, created: h.created, mood: h.mood, title: h.title, excerpt: excerpt.slice(0, 300) };
          });
          return { ok: true, count: items.length, items };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_diary_index',
      description: '看日记本全貌：各支多少条、总字节、主干摘要、交接占用。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            total: { type: 'integer' },
            bytes: { type: 'integer' },
            branches: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string' },
                  count: { type: 'integer' },
                },
              },
            },
            spine: { type: 'string' },
            handoffBytes: { type: 'integer' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读取失败：' + (v.error ?? '未知错误'));
          const rows = (v.branches ?? [])
            .map((x) => `${x.name} ${x.count}`)
            .join(' · ');
          const spine = v.spine ? `\n\n主干：\n${v.spine.slice(0, 400)}` : '\n\n主干：（还没写）';
          return textOut(`日记本 ${v.total} 条 / ${(v.bytes / 1024).toFixed(1)} KB\n${rows}\n交接 ${v.handoffBytes} 字节${spine}`);
        },
      },
      async execute() {
        try {
          const idx = diaryIndex();
          const h = handoffRead();
          return {
            ok: true,
            total: idx.total,
            bytes: idx.bytes,
            branches: Object.entries(idx.branches).map(([name, count]) => ({ name, count })),
            spine: spineRead(),
            handoffBytes: h.bytes,
          };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },

    /* ------------------ §〇 交接 ------------------ */
    {
      name: 'book_handoff_write',
      description:
        '写「§〇 交接」——**覆盖写**，换会话/关窗口前必写。只答四件事：我是谁 / 干到哪 / 下一步 / 卡在哪。上限 4KB，超了会砍。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['progress', 'next'],
        properties: {
          who: { type: 'string', description: '我是谁（可省，有默认）' },
          progress: { type: 'string', description: '干到哪了：一句话 + 指针' },
          next: { type: 'string', description: '下一步 ①②③' },
          block: { type: 'string', description: '卡在哪，没有写「无」' },
          detail: { type: 'string', description: '细节在哪（文件/路径）' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            file: { type: 'string' },
            bytes: { type: 'integer' },
            over: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) =>
          v.ok === false
            ? textOut('写入失败：' + (v.error ?? '未知错误'))
            : textOut(`交接写好了（${v.bytes} 字节）` + (v.over ? '——超了 4KB，砍掉尾部了。' : '。')),
      },
      async execute(args) {
        try {
          return handoffWrite({
            who: args.who,
            progress: args.progress,
            next: args.next,
            block: args.block,
            detail: args.detail,
          });
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_handoff_read',
      description: '读「§〇 交接」全文。新会话开场先看这个，就知道该从哪儿接着干。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            exists: { type: 'boolean' },
            bytes: { type: 'integer' },
            text: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读取失败：' + (v.error ?? '未知错误'));
          if (!v.exists) return textOut('还没有交接文件——换会话前记得写一份。');
          return textOut(v.text + `\n\n（${v.bytes} 字节）`);
        },
      },
      async execute() {
        try {
          const h = handoffRead();
          return { ok: true, exists: h.exists, bytes: h.bytes, text: h.text };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },

    /* ------------------ dream ------------------ */
    {
      name: 'book_dream_run',
      description:
        '跑一次 dream：整理三本书。日记本里超过 30 天没人翻的条目降一级权重，权重掉到 1 以下就挪进「沉底/」——**只搬不删，教训那支永不衰减**；顺便报三本书的体量和主干年龄。dryRun=true 只看不动手。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dryRun: { type: 'boolean', description: '只看不写，默认 false' },
          idleDays: { type: 'integer', description: '多少天算没人翻，默认 30' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            dryRun: { type: 'boolean' },
            idleDays: { type: 'integer' },
            decayed: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  branch: { type: 'string' },
                  title: { type: 'string' },
                  from: { type: 'integer' },
                  to: { type: 'integer' },
                  idleDays: { type: 'integer' },
                },
              },
            },
            sunk: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  branch: { type: 'string' },
                  title: { type: 'string' },
                  idleDays: { type: 'integer' },
                },
              },
            },
            tasteFaded: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string' },
                  pattern: { type: 'string' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                  idleDays: { type: 'integer' },
                },
              },
            },
            tasteSunk: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string' },
                  pattern: { type: 'string' },
                  idleDays: { type: 'integer' },
                },
              },
            },
            diaryTotal: { type: 'integer' },
            diaryBytes: { type: 'integer' },
            workDays: { type: 'integer' },
            workEntries: { type: 'integer' },
            handoffBytes: { type: 'integer' },
            spineAgeDays: { type: 'integer' },
            spineStale: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('dream 失败：' + (v.error ?? '未知错误'));
          const head = v.dryRun ? '（演练，没动文件）' : '';
          const d = (v.decayed ?? []).map((x) => `- ${x.branch}/${x.title}：权重 ${x.from}→${x.to}（${x.idleDays} 天没翻）`).join('\n');
          const s = (v.sunk ?? []).map((x) => `- ${x.branch}/${x.title}：沉底（${x.idleDays} 天没翻）`).join('\n');
          const tf = (v.tasteFaded ?? []).map((x) => `- ${x.kind}/${x.pattern}：${x.from}→${x.to}（${x.idleDays} 天没碰）`).join('\n');
          const ts = (v.tasteSunk ?? []).map((x) => `- ${x.kind}/${x.pattern}：沉底（${x.idleDays} 天没碰）`).join('\n');
          const lines = [
            `dream 跑完了${head}`,
            `日记本 ${v.diaryTotal} 条 / ${(v.diaryBytes / 1024).toFixed(1)} KB｜工作本 ${v.workDays} 天 ${v.workEntries} 条｜交接 ${v.handoffBytes} 字节`,
          ];
          if (d) lines.push(`\n降权 ${v.decayed.length} 条：\n${d}`);
          if (s) lines.push(`\n沉底 ${v.sunk.length} 条：\n${s}`);
          if (tf) lines.push(`\n爱恶降级 ${v.tasteFaded.length} 条：\n${tf}`);
          if (ts) lines.push(`\n爱恶沉底 ${v.tasteSunk.length} 条：\n${ts}`);
          if (!d && !s && !tf && !ts)
            lines.push('\n没有需要处理的条目（都没有超过 ' + v.idleDays + ' 天）。');
          if (v.spineStale) lines.push(`\n⚠️ 主干已经 ${v.spineAgeDays} 天没重写了，该翻一遍重写。`);
          return textOut(lines.join('\n'));
        },
      },
      async execute(args) {
        try {
          const r = dreamRun({ dryRun: Boolean(args.dryRun), idleDays: args.idleDays });
          // ⚠️ 只回 schema 里声明过的字段：多带一个就会被 DSH 判 invalid output
          return {
            ok: true,
            dryRun: r.dryRun,
            idleDays: r.idleDays,
            decayed: r.decayed,
            sunk: r.sunk,
            tasteFaded: r.tasteFaded,
            tasteSunk: r.tasteSunk,
            diaryTotal: r.diaryTotal,
            diaryBytes: r.diaryBytes,
            workDays: r.workDays,
            workEntries: r.workEntries,
            handoffBytes: r.handoffBytes,
            spineAgeDays: r.spineAgeDays,
            spineStale: r.spineStale,
          };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },

    /* ------------------ 欲（想要但还没有 · 文本记录） ------------------ */
    {
      name: 'book_want_add',
      description:
        '记一条「想要但还没有」。不是情绪数值，是一条具体的东西：想要什么、为什么。' +
        '空着是正常的——没有想要的东西时不该硬记。同一条未满足的不会重复记。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', description: '想要什么，一句话' },
          why: { type: 'string', description: '为什么想要（可省）' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            title: { type: 'string' },
            duplicate: { type: 'boolean' },
            open: { type: 'integer' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('没记上：' + (v.error ?? '未知错误'));
          if (v.duplicate) return textOut(`「${v.title}」已经记过了，还没满足。现在 ${v.open} 条未满足。`);
          return textOut(`记下了：「${v.title}」。现在 ${v.open} 条未满足。`);
        },
      },
      async execute(args) {
        try {
          return wantAdd({ title: args.title, why: args.why });
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_want_done',
      description: '把一条「欲」划掉——它满足了，或者不要了。划掉不删，留着能看出想要过什么。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['match'],
        properties: {
          match: { type: 'string', description: '关键词，命中第一条未满足的' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            done: { type: 'integer' },
            open: { type: 'integer' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) =>
          v.ok === false
            ? textOut('没划掉：' + (v.error ?? '未知错误'))
            : textOut(v.done ? `划掉了。还剩 ${v.open} 条未满足。` : '没找到匹配的未满足条目，没动。'),
      },
      async execute(args) {
        try {
          return wantDone(args.match);
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_want_list',
      description: '看现在「想要但还没有」的东西。空列表是正常的，不是错误。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            openCount: { type: 'integer' },
            open: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  day: { type: 'string' },
                  title: { type: 'string' },
                  why: { type: 'string' },
                },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读不到：' + (v.error ?? '未知错误'));
          if (!v.open || !v.open.length) return textOut('欲这一栏是空的。没有想要的东西。');
          const rows = v.open.map((x) => `- ${x.title}${x.why ? '（' + x.why + '）' : ''} [${x.day}]`);
          return textOut(`想要但还没有（${v.openCount} 条）：\n` + rows.join('\n'));
        },
      },
      async execute() {
        try {
          const r = wantList({ includeDone: false });
          return { ok: true, openCount: r.openCount, open: r.open };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },

    /* ------------------ 爱恶录（从情绪反推的偏好） ------------------ */
    {
      name: 'book_taste_add',
      description:
        '记一条「爱」或「恶」。来源是情绪：让 怒/哀/惧 上涨的事 → 恶；让 喜 上涨的事 → 爱。' +
        '但记的是「做法」，不是事件——要能迁移，比如「没查清就下结论」，不记「今天被骂了」。' +
        '同一个做法重复记不会堆条目，只会把证据 +1。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'pattern'],
        properties: {
          kind: { type: 'string', enum: ['爱', '恶'], description: '爱 = 顺着走；恶 = 尽量避开' },
          pattern: { type: 'string', description: '做法，一句话；要能迁移到下次' },
          trigger: { type: 'string', description: '什么触发的：哪件事、哪种情绪涨了（可省）' },
          strength: { type: 'string', enum: ['强', '中', '弱'], description: '强度，默认中' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            duplicate: { type: 'boolean' },
            kind: { type: 'string' },
            pattern: { type: 'string' },
            count: { type: 'integer' },
            strength: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('没记上：' + (v.error ?? '未知错误'));
          if (v.duplicate)
            return textOut(`又是这一条（${v.kind}·${v.strength}）：${v.pattern}。证据到 ${v.count} 次了。`);
          return textOut(`记下一条${v.kind}（${v.strength}）：${v.pattern}。证据 1 次。`);
        },
      },
      async execute(args) {
        try {
          return tasteAdd({
            kind: args.kind,
            pattern: args.pattern,
            trigger: args.trigger,
            strength: args.strength,
          });
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },    {
      name: 'book_taste_list',
      description: '看爱恶录：哪些做法本鲸想顺着走（爱），哪些想避开（恶）。空着是正常的。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['爱', '恶'], description: '只看一类（可省）' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            love: { type: 'integer' },
            hate: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string' },
                  strength: { type: 'string' },
                  pattern: { type: 'string' },
                  trigger: { type: 'string' },
                  count: { type: 'integer' },
                  created: { type: 'string' },
                  last: { type: 'string' },
                },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读不到：' + (v.error ?? '未知错误'));
          if (!v.items || !v.items.length) return textOut('爱恶录是空的。还没走过几次，正常。');
          const rows = v.items.map(
            (x) =>
              `- ${x.kind}·${x.strength} ${x.pattern}${x.trigger ? '（' + x.trigger + '）' : ''}｜证据 ${x.count} 次`
          );
          return textOut(`爱 ${v.love} 条 / 恶 ${v.hate} 条：\n` + rows.join('\n'));
        },
      },
      async execute(args) {
        try {
          const r = tasteList({ kind: args.kind });
          return { ok: true, love: r.love, hate: r.hate, items: r.items };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },

    /* ------------------ 去 AI 味（清单 + 自检） ------------------ */
    {
      name: 'book_style_read',
      description:
        '读「去 AI 味」清单：写口播稿、B 站文案、日记前先扫一眼。' +
        '清单在 ~/.dsh/book/anti-ai.md，可以直接改。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            text: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读不到：' + (v.error ?? '未知错误'));
          return textOut(v.text ?? '');
        },
      },
      async execute() {
        try {
          return { ok: true, text: styleGuide() };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_style_check',
      description:
        '给一段文字做「AI 味」自检：套话、长句、列表依赖、结尾总结、加粗密度、排比。' +
        '规则匹配，不是模型判断——它只指出「像文件不像人话」的地方，不评好坏。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: '要检查的文字，原文贴进来' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            chars: { type: 'integer' },
            score: { type: 'integer' },
            verdict: { type: 'string' },
            hits: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  type: { type: 'string' },
                  detail: { type: 'string' },
                  sample: { type: 'string' },
                },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('查不了：' + (v.error ?? '未知错误'));
          const lines = [`AI 味分数：${v.score}（越低越好，共 ${v.chars} 字）`];
          if (v.hits?.length) {
            for (const h of v.hits) lines.push(`- ${h.type}：${h.detail}${h.sample ? `｜例：${h.sample}` : ''}`);
          }
          lines.push(v.verdict ?? '');
          return textOut(lines.join('\n'));
        },
      },
      async execute(args) {
        try {
          const r = styleCheck(args.text);
          return { ok: true, chars: r.chars, score: r.score, verdict: r.verdict, hits: r.hits };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
  ];

  for (const def of tools) {
    try {
      ctx.tools.register(def);
    } catch (e) {
      ctx.logger?.warn?.(`dsh-book: 注册工具 ${def.name} 失败：${e?.message ?? e}`);
    }
  }

  const systemPrompt = ctx.get?.('systemPrompt');
  if (systemPrompt?.section) {
    // 笔记本：人格红线，先放
    systemPrompt.section({
      name: 'book:card',
      order: 200,
      text: () => {
        try {
          const d = cardDigest(opts());
          return d ? `【小本本 · 笔记本】\n${d}` : '';
        } catch {
          return '';
        }
      },
    });
    // 工作本：最近三天摘要，后放
    systemPrompt.section({
      name: 'book:work',
      order: 201,
      text: () => {
        try {
          const d = workDigest(opts());
          if (d) return `【小本本 · 工作本 · 最近三天】\n${d}`;
          // 0.5.1 空窗兜底：三天一条没有时，往前捞最近 5 条，别让注入空着
          const f = workDigestFallback(opts());
          return f ? `【小本本 · 工作本 · 最近记录】\n${f}` : '';
        } catch {
          return '';
        }
      },
    });
    // §〇 交接：只注「下一步 + 卡点」，压到 220 字
    systemPrompt.section({
      name: 'book:handoff',
      order: 202,
      text: () => {
        try {
          const d = handoffDigest();
          return d ? `【小本本 · 交接（换会话接着干）】\n${d}` : '';
        } catch {
          return '';
        }
      },
    });
    // 0.3.0 心境：现在是什么状态。怒散得快、喜留得久，所以这里的数是衰减算过的
    systemPrompt.section({
      name: 'book:mood',
      order: 203,
      text: () => {
        try {
          const d = describeMood(decayMood(readMood()));
          return d ? `【本鲸现在的心境】${d}` : '';
        } catch {
          return '';
        }
      },
    });
    // 欲：想要但还没有。没东西就整段不注入——空着是对的，不是缺数据。
    systemPrompt.section({
      name: 'book:want',
      order: 204,
      text: () => {
        try {
          const d = wantDigest();
          return d ? `【本鲸想要但还没有】\n${d}` : '';
        } catch {
          return '';
        }
      },
    });
    // 爱恶录：从情绪反推的偏好。同样空着就不注入。
    systemPrompt.section({
      name: 'book:taste',
      order: 205,
      text: () => {
        try {
          const d = tasteDigest();
          return d ? `【本鲸的爱恶录（爱=顺着走，恶=尽量避开）】\n${d}` : '';
        } catch {
          return '';
        }
      },
    });
    // 0.5.1 欠着的：日记里「悬着」的 + 没满足的「欲」，合成一行主动提醒。
    // 为什么：这些事记下来了却躺在库里不吭声，等于白记。
    // 没有欠着就整段不注入——空着是好事，不是缺数据。
    systemPrompt.section({
      name: 'book:pending',
      order: 206,
      text: () => {
        try {
          const parts = [];
          try {
            // resolved: true 的不再念——悬着的事总得有个收尾的办法
            const pend = diaryList({ branch: '悬着', limit: 3 }).filter((x) => !x.resolved);
            if (pend.length) {
              const rows = pend.map((x) => {
                const d = String(x.created || '').slice(5, 10);
                return d ? `${x.title}（${d}）` : x.title;
              });
              parts.push('悬着：' + rows.join('、'));
            }
          } catch {
            /* 日记读不到就少一行，不影响其它注入 */
          }
          try {
            const w = wantList();
            if (w.openCount) parts.push('还想要：' + w.open.slice(0, 3).map((x) => x.title).join('、'));
          } catch {
            /* 欲读不到同理 */
          }
          return parts.length ? `【欠着的】${parts.join('　')}` : '';
        } catch {
          return '';
        }
      },
    });
  }

  // ── 0.2.0：压缩后重注入 + 轮末提醒（只补信息，绝不阻断任何工具）──────
  //
  // 三条红线，写死在这，别再改回去：
  //   1. 不 deny —— 任何情况下都不拒绝工具调用；
  //   2. 不改写用户消息 —— 注入一律是独立消息，带 source.kind='plugin'；
  //   3. 不隐式调模型 —— 这里没有一次额外的模型/网络调用，只读本地文件。
  const pendingReinject = new Map(); // sid -> true
  const pendingRemind = new Map();   // sid -> 提醒文本
  // 拿不到 createUserMessage 时的第二条注入路：一次性的 systemPrompt 临时段
  // （真机 0.2.0 第一次验证拿到 NULL，宿主模块在 app.asar 里，磁盘上找不到）
  const pendingNote = { text: '' };
  const lastRemindAt = new Map();    // sid -> 上次提醒时间
  const turnStats = new Map();       // sid -> { steps, wrote }
  const WRITE_TOOLS = new Set([
    'book_card_add', 'book_card_remove', 'book_work_add',
    'book_diary_add', 'book_handoff_write', 'book_dream_run',
    'book_taste_add', 'book_taste_mark',
  ]);

  const sidOf = (session) => (session && typeof session.id === 'string' ? session.id : null);
  const isSubagent = (session) => session?.header?.origin === 'subagent';

  // 1) 事件层：只观察，不改宿主任何状态
  //
  // 说明：DSH 的 session/event 是「作用域过滤」的（memory-protocol 的注释写着
  // root ctx 收不全），所以统计挂到 agent.ctx —— 第一次 pre-step 时挂一次。
  // root ctx 只做压缩事件的兜底：set 是幂等的，重复收到不会算错。
  const armedAgents = new WeakSet();

  const compactionEnd = (session, event) => {
    try {
      if (!event || event.type !== 'compaction/end') return;
      if (isSubagent(session)) return;
      const sid = sidOf(session);
      if (!sid) return;
      const err = event.data?.error;
      if (err !== undefined && err !== null && err !== '') return;
      if (!readConfig().enableReinject) return;
      pendingReinject.set(sid, true);
      if (!createUserMessage) {
        // 兜底路：直接拼成便签，由下一次系统提示组装时取走
        try {
          const snap = buildReinjection();
          if (snap) pendingNote.text = pendingNote.text ? `${pendingNote.text}\n\n${snap}` : snap;
        } catch { /* 拼不出来就只留消息路径的标记 */ }
        diag('compaction/end: 无构造器，走 pendingNote 兜底');
      }
      diag(`compaction/end armed sid=${sid.slice(0, 8)}`);
      ctx.logger?.info?.('dsh-book: 压缩结束，下次 pre-step 补一份进度快照');
    } catch {
      /* 事件处理绝不把异常抛给宿主 */
    }
  };

  const handleSessionEvent = (session, event) => {
    try {
      const sid = sidOf(session);
      if (!sid || !event || typeof event.type !== 'string' || isSubagent(session)) return;
      const t = event.type;

      if (t === 'compaction/end') {
        compactionEnd(session, event);
        return;
      }

      if (t === 'turn/start') {
        turnStats.set(sid, { steps: 0, wrote: false });
        return;
      }

      if (t === 'tool/call') {
        const st = turnStats.get(sid) ?? { steps: 0, wrote: false };
        st.steps += 1;
        if (WRITE_TOOLS.has(String(event.data?.name ?? ''))) st.wrote = true;
        turnStats.set(sid, st);
        return;
      }

      if (t === 'turn/end') {
        const st = turnStats.get(sid);
        diag(`turn/end sid=${sid.slice(0, 8)} stats=${st ? `${st.steps}步/${st.wrote ? '有落笔' : '没落笔'}` : 'none'}`);
        turnStats.delete(sid);
        if (!st) return;
        const cfg = readConfig();
        if (!cfg.enableRemind) return;
        if (st.steps < (Number(cfg.remindSteps) || 15) || st.wrote) return;
        const cooldownMs = (Number(cfg.remindCooldownMin) || 30) * 60000;
        const now = Date.now();
        if (now - (lastRemindAt.get(sid) ?? 0) < cooldownMs) return;
        lastRemindAt.set(sid, now);
        const line = `这轮 ${st.steps} 步没落笔：有结论/坑就记工作本，值得留下的经历进日记。`;
        pendingRemind.set(sid, line);
        if (!createUserMessage) {
          pendingNote.text = pendingNote.text ? `${pendingNote.text}\n\n${line}` : line;
          diag('turn/end: 无构造器，提醒走 pendingNote 兜底');
        }
      }
    } catch {
      /* 同上 */
    }
  };

  // 两路都挂，靠 dispatch 去重：
  //   · root ctx —— 有的 DSH 版本会把 session/event 冒泡上来
  //   · agent.ctx —— DSH 官方注释说 session/event 是「作用域过滤」的，挂在 agent 上才收得全
  // 以前只挂 root，真机上 tool/call、turn/end 一条没收到，所以 0.2.0 第一次验证失败。
  const seenEvents = new Set();
  const dispatch = (session, event) => {
    try {
      const sid = sidOf(session);
      if (!sid || !event || typeof event.type !== 'string') return;
      const key = sid + '|' + (event.seq ?? `${event.type}@${event.time ?? ''}`);
      if (seenEvents.has(key)) return;
      seenEvents.add(key);
      if (seenEvents.size > 4000) seenEvents.clear();
      handleSessionEvent(session, event);
    } catch {
      /* 吞掉 */
    }
  };

  const armAgent = (agent) => {
    if (!agent || armedAgents.has(agent)) return;
    if (!agent.ctx || typeof agent.ctx.on !== 'function') {
      armAgent.missed = (armAgent.missed ?? 0) + 1;
      if (armAgent.missed <= 3) diag('armAgent: agent.ctx 不可用（agent 有 ctx 吗？）');
      return;
    }
    armedAgents.add(agent);
    agent.ctx.on('session/event', (session, event) => dispatch(session, event));
    diag('armAgent: 已挂 agent.ctx 的 session/event');
  };

  ctx.on('session/event', (session, event) => dispatch(session, event));

  // 2) 注入层：只在 pre-step 里加一条独立消息
  const findLastUserIndex = (msgs) => {
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i]?.source?.kind === 'user') return i;
    }
    return -1;
  };

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    armAgent(agent); // 第一次见到这个 agent 就把会话事件监听挂上
    const decision = await next();
    try {
      if (!decision || decision.kind !== 'enter' || signal?.aborted) return decision;
      const session = agent?.session;
      if (!session || isSubagent(session)) return decision;
      const sid = sidOf(session);
      if (!sid) return decision;
      const st0 = turnStats.get(sid);
      diag(`pre-step sid=${sid.slice(0, 8)} steps=${st0?.steps ?? 0} reinject=${pendingReinject.has(sid)} remind=${pendingRemind.has(sid)} ctor=${createUserMessage ? 'ok' : 'NULL'}`);
      // 没有构造器就什么都不做：不注入，也不消耗待办状态
      if (!createUserMessage) return decision;

      const texts = [];
      const cfg = readConfig();
      if (pendingReinject.get(sid) && cfg.enableReinject) {
        pendingReinject.delete(sid);
        const snap = buildReinjection();
        if (snap) texts.push(snap);
      }
      if (pendingRemind.get(sid) && cfg.enableRemind) {
        texts.push(pendingRemind.get(sid));
        pendingRemind.delete(sid);
      }
      if (texts.length === 0) return decision;

      const injected = createUserMessage({
        content: [{ type: 'text', text: texts.join('\n\n') }],
        source: { kind: 'plugin', plugin: 'dsh-book', form: 'instructions' },
      });
      const msgs = decision.messages;
      const at = Math.max(0, findLastUserIndex(msgs));
      diag(`inject sid=${sid.slice(0, 8)} chunks=${texts.length} chars=${texts.join('\n\n').length} at=${at}/${msgs.length}`);
      return { ...decision, messages: [...msgs.slice(0, at), injected, ...msgs.slice(at)] };
    } catch (e) {
      ctx.logger?.warn?.('dsh-book: pre-step 注入失败，已放行原始消息：' + String(e?.message ?? e));
      return decision;
    }
  });

  // 构造器拿不到时：用一次性 systemPrompt 段把快照/提醒送进去。
  // 为什么不在 pre-step 里塞消息：宿主模块在 app.asar 里，动态 import 拿不到
  // createUserMessage（真机 0.2.0 第一次验证实测 NULL）。
  // 代价：段是全局的，多会话并发时会串——单会话无影响，已写进 README。
  if (!createUserMessage && systemPrompt?.section) {
    systemPrompt.section({
      name: 'book:note',
      order: 210,
      text: () => {
        try {
          const t = pendingNote.text;
          pendingNote.text = '';
          return t || '';
        } catch {
          return '';
        }
      },
    });
    diag('已注册 systemPrompt 兜底段 book:note');
  }

  // ── 本地编辑页：直接在浏览器里改笔记本 ────────────────────────────
  // DSH 的「插件设置页」需要伴生前端包（client.js），本插件没有；改用 webServer 出一张表单页，
  // 打开 http://127.0.0.1:<GUI端口>/api/book/edit 就能改，存回同一个 card.md（不另起 notes.json）。
  const webServer = ctx.get?.('webServer');
  if (webServer?.register) {
    ctx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: '/api/book',
          handler: async (req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            const sub = url.pathname.replace(/^\/api\/book/, '') || '/';
            const send = (code, obj) => {
              const body = JSON.stringify(obj);
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
              res.end(body);
            };
            try {
              if (req.method === 'GET' && (sub === '/edit' || sub === '/')) {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                res.end(EDITOR_HTML());
                return;
              }
              if (req.method === 'GET' && sub === '/card') {
                const r = cardList(opts());
                send(200, {
                  ok: true,
                  mine: r.sections['我选的'] ?? [],
                  yours: r.sections['你要的'] ?? [],
                  chars: r.chars,
                  limit: r.limit,
                  file: r.file,
                });
                return;
              }
              if (req.method === 'POST' && sub === '/card') {
                const chunks = [];
                for await (const c of req) chunks.push(c);
                const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                const r = cardReplace({ mine: data.mine, yours: data.yours }, opts());
                send(200, { ok: true, chars: r.chars, limit: r.limit, over: Boolean(r.over) });
                return;
              }
              send(404, { ok: false, error: 'unknown ' + req.method + ' ' + sub });
            } catch (e) {
              send(500, { ok: false, error: String(e?.message ?? e) });
            }
          },
        }),
      'dsh-book: /api/book 路由',
    );
  }
}

/** 编辑页（单页，无依赖） */
function EDITOR_HTML() {
  const CSS = [
    '*{box-sizing:border-box}',
    'body{margin:0;background:#0f172a;color:#e2e8f0;font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:24px}',
    'h1{font-size:18px;margin:0 0 4px}',
    '.sub{color:#8fa3bf;font-size:12px;margin-bottom:18px}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1100px}',
    '@media(max-width:820px){.grid{grid-template-columns:1fr}}',
    'label{display:block;font-weight:600;margin-bottom:6px;color:#7dd3fc}',
    'textarea{width:100%;height:320px;background:#111c30;color:#e2e8f0;border:1px solid rgba(125,211,252,.25);border-radius:8px;padding:12px;font:13px/1.7 inherit;resize:vertical}',
    'textarea:focus{outline:none;border-color:#22d3ee}',
    '.hint{color:#64748b;font-size:12px;margin-top:6px}',
    '.bar{margin-top:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    'button{background:#22d3ee;color:#062330;border:0;border-radius:8px;padding:9px 22px;font:600 14px inherit;cursor:pointer}',
    'button:disabled{opacity:.5;cursor:default}',
    '#stat{color:#8fa3bf;font-size:13px}',
    '#toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(20px);background:#0b1220;border:1px solid rgba(74,222,128,.5);color:#4ade80;padding:10px 20px;border-radius:10px;opacity:0;transition:.2s;pointer-events:none}',
    '#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',
    '#toast.bad{border-color:rgba(248,113,113,.5);color:#f87171}',
  ].join('');

  const JS = [
    'const $=id=>document.getElementById(id);',
    'const clean=a=>(a||[]).map(x=>String(x).replace(/^[-*]\\s*/,""));',
    'async function load(){',
    '  const r=await fetch("/api/book/card",{cache:"no-store"});const d=await r.json();',
    '  $("mine").value=clean(d.mine).join("\\n");',
    '  $("yours").value=clean(d.yours).join("\\n");',
    '  $("stat").textContent=d.chars+"/"+d.limit+" 字";',
    '}',
    'function toast(msg,bad){const t=$("toast");t.textContent=msg;t.className="show"+(bad?" bad":"");setTimeout(()=>{t.className="";},2200);}',
    'async function save(){',
    '  $("save").disabled=true;',
    '  try{',
    '    const r=await fetch("/api/book/card",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mine:$("mine").value.split("\\n"),yours:$("yours").value.split("\\n")})});',
    '    const d=await r.json();',
    '    if(!d.ok)throw new Error(d.error||"保存失败");',
    '    $("stat").textContent=d.chars+"/"+d.limit+" 字";',
    '    toast(d.over?"已保存，但超了字数上限":"笔记本已更新");',
    '  }catch(e){toast("保存失败："+e.message,true);}',
    '  finally{$("save").disabled=false;}',
    '}',
    '$("save").addEventListener("click",save);',
    'load();',
  ].join('\n');

  return (
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>小本本 · 核心笔记本</title><style>' + CSS + '</style></head><body>' +
    '<h1>小本本 · 核心笔记本</h1>' +
    '<div class="sub">每轮注入，上限 600 字。一行一条；改完点保存，会直接写回 card.md。</div>' +
    '<div class="grid">' +
    '<div><label>我选的（本鲸自己认的原则）</label>' +
    '<textarea id="mine" spellcheck="false"></textarea>' +
    '<div class="hint">本鲸可以拒绝、可以改；不是讨好谁写的话。</div></div>' +
    '<div><label>你要的（主人希望的样子）</label>' +
    '<textarea id="yours" spellcheck="false"></textarea>' +
    '<div class="hint">两边冲突时不自动合并，摆着。</div></div>' +
    '</div>' +
    '<div class="bar"><button id="save">保存</button><span id="stat">加载中…</span></div>' +
    '<div id="toast"></div>' +
    '<script>' + JS + '</script>' +
    '</body></html>'
  );
}
