# dsh-book（小本本）· 0.1.0 测试版

给 DeepSeek Harness（DSH）用的**本地记忆插件**。三本书 + 一份交接，全部是磁盘上的 Markdown 文件，
没有数据库、没有嵌入模型、没有 Python、没有网络请求。

> ⚠️ 这是自用插件的 0.1.0 测试版，只在一台 Windows + DSH 桌面版上验证过。
> 请当作「可以装、可以看、可以骂」的版本，不要当作稳定软件。

---

## 它解决什么

AI 的记忆通常只有两种做法：模型自己记（会话一关就没了），或者塞进一个检索库（要检索、要模型、要依赖）。

dsh-book 走第三条路：**把记忆做成文件，按时间冷热分层，需要时再翻。**

| 本子 | 干什么 | 怎么进入上下文 |
|---|---|---|
| **笔记本** | 人格、底线、说话方式 | **每轮全量注入**，默认 600 字上限 |
| **工作本** | 今天做了什么 | 最近 3 天自动注入，过期不注入但**永不删除**，可搜索 |
| **日记本** | 真正记住的事，五支：相处 / 心意 / 教训 / 做成 / 悬着 | 不自动注入，用工具翻 |
| **§〇 交接** | 换会话接着干的接力棒（我是谁 / 干到哪 / 下一步 / 卡在哪） | 注入压缩后的 220 字 |

外加 `dream`：30 天没人翻的日记降一级权重，掉到 1 以下搬进 `沉底/`——**只搬不删**，「教训」那支永远不衰减。

---

## 安装

### 方式 A：装本地 tgz（推荐）

```sh
dsh plugin --profile <你的 profile 名> add file:<解压目录>\dsh-book-0.1.0.tgz
```

`<你的 profile 名>` 一般是 `desktop` 或 `web`，看 `~/.dsh/profiles/` 下有什么。
装完重启 DSH。新会话里应该能看到 12 个 `book_*` 工具，左侧栏多一个「笔记本」入口。

### 方式 B：从源码目录装

```sh
dsh plugin --profile <profile> add file:<解压目录>\dsh-book
```

### 方式 C：手动（不推荐，容易出错）

解压到 `~/.dsh/profiles/<profile>/node_modules/dsh-book`，然后在 profile 的 `package.json` 里：

1. `dependencies` 加 `"dsh-book": "link:<绝对路径>"`
2. `dsh.profile.bundles` 末尾加 `"dsh-book"`

手动改 JSON 请用 Node/Python，**不要用 PowerShell 的 `Set-Content -Encoding utf8`**
（Windows PowerShell 5.1 会写 BOM，DSH 读到 BOM 会起不来）。

---

## 装完怎么用

不用特意配置，直接跟 AI 说：

- 「记一下今天修了啥」→ 写工作本
- 「这事我想记住」→ 写日记（选五支之一）
- 「我要换会话了，写个交接」→ 写交接
- 「翻翻以前关于 XX 的记录」→ 搜索

默认数据目录：

```
~/.dsh/book/
├── card/card.md          # 笔记本（可以手动编辑，格式是 Markdown 的两节：我选的 / 你要的）
├── work/YYYY-MM-DD.md    # 工作本，一天一个文件
├── diary/<分支>/*.md     # 日记本，按五支分目录
├── diary/主干.md          # 长期主线（1500 字上限）
├── diary/交接.md          # §〇 交接（4096 字节上限）
└── config.json           # 可选：改注入字数等
```

`config.json` 可选项（不写就用默认）：

```json
{
  "cardLimit": 600,
  "workDays": 3,
  "workInjectLimit": 800
}
```

---

## 0.1.0 的已知限制（请先读）

1. **没有语义检索**，只能按关键词子串搜。记得意思、不记得原词的时候搜不到。
2. **没有项目隔离**：多个工作区的记录混在一起。
3. **会话压缩后不会自动补记忆**：模型上轮翻过的日记内容可能丢（笔记本/交接每轮重算，不会丢）。
4. **左侧栏入口依赖 `@deepseek-ai/dsh-client-ui-sidebar`**：如果你的 DSH 版本没有这个包，
   页面入口不会出现，但插件本体和工具仍然能用（会打一条 warn 日志）。
5. **界面与文案全中文**，没有 i18n。
6. **只在 Windows 桌面版验证过**，headless / 其他系统未测。
7. 没有权限控制：任何会话都能读写 `~/.dsh/book/`。

安装时如果 pnpm 提示 `@deepseek-ai/cordis` peer 未满足，通常是宿主已自带，可忽略；
如果启动报错，请把 `~/.dsh/logs` 里对应时段的日志贴回来。

---

## 想要什么反馈

报 bug 的时候，这几样最有帮助：

1. 你的 DSH 版本（关于页 / `dsh --version`）
2. 安装方式（A/B/C 哪个）
3. 报错**全文**，不要截半句
4. `~/.dsh/book/` 的目录树（`tree` 或 `Get-ChildItem -Recurse` 输出）
5. 触发问题的那句话（原话）

想提需求也行，但先说清楚是「记不住」还是「记乱了」——这两种要动的地方完全不同。

---

## 卸载

从 profile 的 `bundles` 里移除 `dsh-book`（或 `dsh plugin remove dsh-book`），重启 DSH。
`~/.dsh/book/` 是你自己的数据，删不删自己决定——**建议留着备份**。

---

## 文件清单

```
dsh-book/
├── package.json
├── cordis.patch.yml      # bundle patch
├── client.js             # 左侧栏「笔记本」面板
├── lib/
│   ├── index.js          # 插件入口：12 个工具 + 3 段注入 + 编辑页
│   ├── store.mjs         # 三本书的读写、dream
│   └── hostdeps.mjs      # 宿主包解析兜底
├── tests/
│   ├── check-tools.mjs   # 工具 schema 体检（只读工具实跑）
│   └── smoke*.mjs        # 三本书的冒烟测试，不依赖 DSH
├── LICENSE
├── .gitignore
└── README.md
```

MIT License.
