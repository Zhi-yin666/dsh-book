/**
 * dsh-book —— 浏览器半端：把「核心笔记本」编辑页接进 Web UI 的左侧栏
 * ============================================================================
 * 宿主机制（cordis_inspect 原文）：
 *   `sidebar.panellist` = 「Global panel icons. Each list id addresses the matching
 *    main panel; the sidebar owns the button」
 *   `main`              = 「Central panel selected by sidebar entry id.」
 * ⇒ 图标 id 与 main key 都用 `dsh-book`，点图标 shell 自己切到整页。
 *
 * 数据仍旧只走 Host 那条 `/api/book/card`（读写同一个 card.md），
 * 原来的 `/api/book/edit` 裸 HTML 页面留着当备用入口，两边写的是同一份文件。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-book',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'dsh-book'
    const API = '/api/book/card'

    /** 服务端存的是 `- 一行`，显示时去掉前缀；保存时按行拆开交回去（空行由 Host 丢掉）。 */
    const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x).replace(/^[-*]\s*/, ''))

    async function requestJson(path, options) {
      const response = await fetch(path, {
        cache: 'no-store',
        ...options,
        headers: { accept: 'application/json', ...(options && options.headers) },
      })
      let body
      try {
        body = await response.json()
      } catch {
        body = {}
      }
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    const T = {
      nav: '笔记本',
      title: '核心笔记本',
      sub: '每轮注入，上限 {limit} 字。一行一条；改完点保存，直接写回 card.md。',
      mine: '我选的（AI 自己认的原则）',
      mineHint: 'AI 可以拒绝、可以改；不是讨好谁写的话。',
      yours: '你要的（你希望的样子）',
      yoursHint: '两边冲突时不自动合并，摆着。',
      placeholder: '一行一条',
      save: '保存',
      saving: '保存中…',
      loading: '加载中…',
      saved: '笔记本已更新',
      over: '已保存，但超了字数上限',
      failed: '保存失败：{error}',
      loadFailed: '读不到笔记本：{error}',
      retry: '重试',
      chars: '{chars}/{limit} 字',
      overChars: '超出上限',
    }

    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
      )
    }

    /** 左侧栏图标：一本带书签的笔记簿。跟着宿主 currentColor 走，选中时用品牌色。 */
    function BookIcon({ size = 22, active }) {
      const edge = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block', opacity: active ? 1 : 0.82 },
        },
        h('path', {
          d: 'M5.4 4.6h11a2 2 0 0 1 2 2v12.8a2 2 0 0 1-2 2h-11a1 1 0 0 1-1-1V5.6a1 1 0 0 1 1-1Z',
          fill: 'none',
          stroke: edge,
          strokeWidth: 1.7,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M4.4 7.4h2M4.4 11.2h2M4.4 15h2',
          fill: 'none',
          stroke: edge,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M14.2 4.6v5.6l2-1.5 2 1.5V4.6',
          fill: 'none',
          stroke: edge,
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
      )
    }

    const CSS = `
.bk { display:flex; flex-direction:column; gap:14px; padding:18px 22px 20px; box-sizing:border-box;
      max-width:1200px; color:var(--dsw-alias-label-primary); }
.bk-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.bk-title { margin:0; font-size:17px; font-weight:600; letter-spacing:.2px; }
.bk-sub { font-size:12px; color:var(--dsw-alias-label-secondary); }
.bk-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
@media (max-width:900px) { .bk-grid { grid-template-columns:1fr; } }
.bk-col { display:flex; flex-direction:column; gap:6px; min-width:0; }
.bk-label { font-weight:600; font-size:13px; color:var(--dsw-alias-brand-primary); }
.bk-area { width:100%; box-sizing:border-box; height:320px; min-height:200px; max-height:calc(100vh - 300px);
      padding:12px 14px; border-radius:10px; border:1px solid var(--dsw-alias-border-l1);
      background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary);
      font:inherit; font-size:13px; line-height:1.75; resize:vertical; outline:none; }
.bk-area:focus { border-color:var(--dsw-alias-brand-primary); }
.bk-area::placeholder { color:var(--dsw-alias-label-secondary); opacity:.75; }
.bk-hint { font-size:11.5px; color:var(--dsw-alias-label-secondary); }
.bk-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.bk-btn { height:32px; padding:0 20px; border-radius:8px; border:1px solid transparent;
      background:var(--dsw-alias-brand-primary); color:#fff; font:inherit; font-size:13px; font-weight:600;
      cursor:pointer; }
.bk-btn:hover:not([disabled]) { filter:brightness(1.08); }
.bk-btn[disabled] { opacity:.45; cursor:not-allowed; }
.bk-stat { font-size:12px; color:var(--dsw-alias-label-secondary); }
.bk-ok { font-size:12px; color:var(--dsw-alias-state-success-primary); }
.bk-warn { font-size:12px; color:var(--dsw-alias-state-warn-primary); }
.bk-err { font-size:12px; color:var(--dsw-alias-state-error-primary); }
`

    function BookPage() {
      const [mine, setMine] = React.useState('')
      const [yours, setYours] = React.useState('')
      const [limit, setLimit] = React.useState(600)
      const [chars, setChars] = React.useState(0)
      const [over, setOver] = React.useState(false)
      const [file, setFile] = React.useState('')
      const [phase, setPhase] = React.useState('loading') // loading | idle | saving | saved | error
      const [error, setError] = React.useState('')

      const load = React.useCallback(async () => {
        setPhase('loading')
        try {
          const body = await requestJson(API)
          setMine(clean(body.mine).join('\n'))
          setYours(clean(body.yours).join('\n'))
          setChars(Number(body.chars) || 0)
          setLimit(Number(body.limit) || 600)
          setOver(Number(body.chars) > Number(body.limit))
          setFile(typeof body.file === 'string' ? body.file : '')
          setPhase('idle')
          setError('')
        } catch (cause) {
          setPhase('error')
          setError(fill(T.loadFailed, { error: String(cause?.message ?? cause) }))
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      const save = React.useCallback(async () => {
        setPhase('saving')
        try {
          const body = await requestJson(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mine: mine.split('\n'), yours: yours.split('\n') }),
          })
          setChars(Number(body.chars) || 0)
          setOver(Boolean(body.over))
          setPhase('saved')
          setError('')
        } catch (cause) {
          setPhase('error')
          setError(fill(T.failed, { error: String(cause?.message ?? cause) }))
        }
      }, [mine, yours])

      const busy = phase === 'loading' || phase === 'saving'

      return h(
        'div',
        { className: 'bk' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'bk-head' },
          h('h1', { className: 'bk-title' }, T.title),
          h('p', { className: 'bk-sub' }, fill(T.sub, { limit })),
        ),
        h(
          'div',
          { className: 'bk-grid' },
          h(
            'div',
            { className: 'bk-col' },
            h('label', { className: 'bk-label', htmlFor: 'bk-mine' }, T.mine),
            h('textarea', {
              id: 'bk-mine',
              className: 'bk-area',
              value: mine,
              spellCheck: false,
              placeholder: T.placeholder,
              disabled: phase === 'loading',
              onChange: (event) => {
                setMine(event.target.value)
                setPhase('idle')
              },
            }),
            h('div', { className: 'bk-hint' }, T.mineHint),
          ),
          h(
            'div',
            { className: 'bk-col' },
            h('label', { className: 'bk-label', htmlFor: 'bk-yours' }, T.yours),
            h('textarea', {
              id: 'bk-yours',
              className: 'bk-area',
              value: yours,
              spellCheck: false,
              placeholder: T.placeholder,
              disabled: phase === 'loading',
              onChange: (event) => {
                setYours(event.target.value)
                setPhase('idle')
              },
            }),
            h('div', { className: 'bk-hint' }, T.yoursHint),
          ),
        ),
        h(
          'div',
          { className: 'bk-bar' },
          h('button', { type: 'button', className: 'bk-btn', disabled: busy, onClick: () => void save() }, T.save),
          h(
            'span',
            { className: over ? 'bk-warn' : 'bk-stat' },
            fill(T.chars, { chars, limit }),
            over ? ` · ${T.overChars}` : '',
          ),
          phase === 'saving' ? h('span', { className: 'bk-stat' }, T.saving) : null,
          phase === 'saved' ? h('span', { className: over ? 'bk-warn' : 'bk-ok' }, over ? T.over : T.saved) : null,
          error ? h('span', { className: 'bk-err' }, error) : null,
          phase === 'error' && !busy
            ? h('button', { type: 'button', className: 'bk-btn', onClick: () => void load() }, T.retry)
            : null,
          file ? h('span', { className: 'bk-stat', title: file }, 'card.md') : null,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        slots.inject('sidebar.panellist', () =>
          slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 7, label: T.nav }, BookIcon),
        )
        slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, BookPage))
      },
    }
  },
})
