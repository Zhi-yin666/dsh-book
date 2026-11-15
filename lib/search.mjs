// lib/search.mjs —— BM25-lite 检索（0.3.1）
//
// 为什么不用向量：那要模型或外部服务，破掉「零依赖」。BM25 用一条公式换来
// 「记得意思、不记得原词」也能搜到一半——中文按字 bigram 切，够用。
//
// 排序 = BM25 × (1 + 0.5·e^(-天数/30)) × (教训支 1.5)
// 时间衰减让新事优先，教训加成和「教训永不衰减」是同一条原则。
const K1 = 1.2;
const B = 0.75;

/**
 * 分词：中文按「相邻两字」切，英文/数字按词切。
 * 例：「BOM 把应用写崩了」→ ['bom', '把应', '应用', '用写', '写崩', '崩了']
 * 单字成段时保留单字（避免「看」这种查不到）。
 */
export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  for (const m of s.matchAll(/[a-z0-9_\-]+/g)) out.push(m[0]);
  for (const m of s.matchAll(/[\u4e00-\u9fa5]+/g)) {
    const seg = m[0];
    if (seg.length === 1) out.push(seg);
    else for (let i = 0; i < seg.length - 1; i += 1) out.push(seg.slice(i, i + 2));
  }
  return out;
}

/**
 * 给一批文档打分。
 * @param {Array<{id:string, text:string, ageDays?:number, branch?:string}>} docs
 * @param {string} query
 * @returns {Array<{id:string, score:number, matched:string[], doc:any}>}
 */
export function rankDocuments(docs, query) {
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length || !docs.length) return [];

  const prepared = docs.map((d) => {
    const tokens = tokenize(d.text || '');
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { doc: d, tf, len: tokens.length };
  });

  const N = prepared.length;
  const avgdl = prepared.reduce((s, p) => s + p.len, 0) / N || 1;

  const df = new Map();
  for (const p of prepared) {
    for (const t of qTerms) if (p.tf.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const idf = new Map(
    qTerms.map((t) => {
      const n = df.get(t) ?? 0;
      return [t, Math.log(1 + (N - n + 0.5) / (n + 0.5))];
    }),
  );

  const out = [];
  for (const p of prepared) {
    let s = 0;
    const matched = [];
    for (const t of qTerms) {
      const f = p.tf.get(t) ?? 0;
      if (!f) continue;
      matched.push(t);
      s += (idf.get(t) ?? 0) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * p.len) / avgdl)));
    }
    if (s <= 0) continue;
    const age = Number(p.doc.ageDays);
    const recency = Number.isFinite(age) ? 1 + 0.5 * Math.exp(-Math.max(0, age) / 30) : 1;
    const boost = p.doc.branch === '教训' ? 1.5 : 1;
    out.push({ id: p.doc.id, score: Number((s * recency * boost).toFixed(4)), matched, doc: p.doc });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}
