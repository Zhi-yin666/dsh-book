// dsh-book / lib/index.js —— 小本本插件入口
// 三本书：笔记本（人格·每轮注入）、工作本（任务·可搜·三天热存）、日记本（待做）
import {
  cardAdd,
  cardRemove,
  cardList,
  cardDigest,
  cardReplace,
  workAdd,
  workSearch,
  workRecent,
  workDigest,
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
  spineWrite,
  dreamRun,
  spineAgeDays,
  DIARY_BRANCHES,
  DIARY_MOODS,
  readConfig,
  DEFAULT_CONFIG,
} from './store.mjs';
import { loadSchemastery } from './hostdeps.mjs';

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

/** 读配置：优先 config.json（store 里已经合并默认值），DSH config 只在设置页那套能用时才有意义 */
function opts() {
  return {};
}

export function apply(ctx) {
  const tools = [
    /* ------------------ 笔记本 ------------------ */
    {
      name: 'book_card_add',
      description:
        '往「笔记本」加一条人格条目。笔记本每轮注入、上限默认 600 字——加之前想清楚它值不值这个位置。' +
        'section：「我选的」= AI 自己认的原则；「你要的」= 你希望的样子（AI 保留意见也算数）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'line'],
        properties: {
          section: { type: 'string', enum: SECTION_ENUM, description: '放哪一半' },
          line: { type: 'string', description: '一条，一句话说完' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            section: { type: 'string' },
            duplicate: { type: 'boolean' },
            chars: { type: 'integer' },
            limit: { type: 'integer' },
            over: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('写入失败：' + (v.error ?? '未知错误'));
          if (v.duplicate) return textOut(`「${v.section}」里已经有这条了，没重复写。`);
          return textOut(
            `已写进「${v.section}」。当前 ${v.chars}/${v.limit} 字` + (v.over ? ' —— 超了，该删几条了。' : '。'),
          );
        },
      },
      async execute(args) {
        try {
          return cardAdd(args.section, args.line, opts());
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_card_remove',
      description: '从「笔记本」删掉含某个关键词的条目。本子有上限，满了就得清。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'match'],
        properties: {
          section: { type: 'string', enum: SECTION_ENUM, description: '删哪一半' },
          match: { type: 'string', description: '关键词或片段，命中即删' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            section: { type: 'string' },
            removed: { type: 'integer' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) =>
          v.ok === false
            ? textOut('删除失败：' + (v.error ?? '未知错误'))
            : textOut(v.removed ? `「${v.section}」删掉 ${v.removed} 条。` : `「${v.section}」里没找到匹配的，没删。`),
      },
      async execute(args) {
        try {
          return cardRemove(args.section, args.match, opts());
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },
    {
      name: 'book_card_list',
      description: '看「笔记本」当前全部内容、文件路径和字数。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
            file: { type: 'string' },
            chars: { type: 'integer' },
            limit: { type: 'integer' },
            mine: { type: 'array', items: { type: 'string' } },
            yours: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
          },
        },
        render: (_a, v) => {
          if (v.ok === false) return textOut('读取失败：' + (v.error ?? '未知错误'));
          const mine = (v.mine ?? []).join('\n') || '（空）';
          const yours = (v.yours ?? []).join('\n') || '（空）';
          return textOut(`笔记本 ${v.chars}/${v.limit} 字\n文件：${v.file}\n\n## 我选的\n${mine}\n\n## 你要的\n${yours}`);
        },
      },
      async execute() {
        try {
          const r = cardList(opts());
          return {
            ok: true,
            file: r.file,
            chars: r.chars,
            limit: r.limit,
            mine: r.sections['我选的'] ?? [],
            yours: r.sections['你要的'] ?? [],
          };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
    },

    /* ------------------ 工作本 ------------------ */
    {
      name: 'book_work_add',
      description:
        '往「工作本」记一条今天做的事。写之前**先压缩**：标题一句话，详情最多三行（做了什么 / 结论 / 坑）。' +
        '工作本只热三天，过期冷存（不会删，搜得到）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', description: '一句话：这件事是什么（不超过 30 字）' },
          detail: { type: 'string', description: '详情，可换行；建议 1-3 行：做了什么 / 结论或坑' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签，方便以后搜' },
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
          return workAdd({ title: args.title, detail: args.detail, tags: args.tags });
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
          const hits = workSearch(args.query, args.limit ?? 20);
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
        '往「日记本」记一条。五支选一个：相处（日常）、心意（听到的重要的话）、教训（做错/被纠正）、做成（有产出）、悬着（未定/欠着的）。' +
        '教训那支永不衰减；其余超过 30 天没人翻会降权沉底（不删）。',
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
            day: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_a, v) =>
          v.ok === false
            ? textOut('写入失败：' + (v.error ?? '未知错误'))
            : textOut(`记进「${v.branch}」了（${v.day}，${v.mood}，权重 ${v.weight}）。`),
      },
      async execute(args) {
        try {
          return diaryAdd({
            branch: args.branch,
            title: args.title,
            body: args.body,
            mood: args.mood,
            weight: args.weight,
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
          const hits = diarySearch({ keyword: args.keyword, day: args.day, branch: args.branch, limit });
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
      description: '看日记本全貌：五支各多少条、总字节、主干摘要、交接占用。',
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
          const lines = [
            `dream 跑完了${head}`,
            `日记本 ${v.diaryTotal} 条 / ${(v.diaryBytes / 1024).toFixed(1)} KB｜工作本 ${v.workDays} 天 ${v.workEntries} 条｜交接 ${v.handoffBytes} 字节`,
          ];
          if (d) lines.push(`\n降权 ${v.decayed.length} 条：\n${d}`);
          if (s) lines.push(`\n沉底 ${v.sunk.length} 条：\n${s}`);
          if (!d && !s) lines.push('\n没有需要处理的条目（都没有超过 ' + v.idleDays + ' 天）。');
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
          return d ? `【小本本 · 工作本 · 最近三天】\n${d}` : '';
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
    '<div><label>我选的（AI 自己认的原则）</label>' +
    '<textarea id="mine" spellcheck="false"></textarea>' +
    '<div class="hint">AI 可以拒绝、可以改；不是讨好谁写的话。</div></div>' +
    '<div><label>你要的（你希望的样子）</label>' +
    '<textarea id="yours" spellcheck="false"></textarea>' +
    '<div class="hint">两边冲突时不自动合并，摆着。</div></div>' +
    '</div>' +
    '<div class="bar"><button id="save">保存</button><span id="stat">加载中…</span></div>' +
    '<div id="toast"></div>' +
    '<script>' + JS + '</script>' +
    '</body></html>'
  );
}
