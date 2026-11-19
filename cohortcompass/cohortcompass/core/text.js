// Deterministic text utilities: answer parsing, PII stripping, and a small TF-IDF index
// (stand-in for the production vector index behind the same search() interface).
const STOP = new Set('a an the and or of to in on for with at by from is are was were be been it this that as i my me we our you your they them do did does not no yes so if but about how what which who when where why than then there their its into over under more most less very can could should would will just also'.split(' '));

export const tokenize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9:+#.\s-]/g, ' ').split(/\s+/).map((w) => w.replace(/^[.-]+|[.-]+$/g, '')).filter((w) => w.length > 1 && !STOP.has(w));

export function createIndex(docs /* [{id, text, meta}] */) {
  const df = new Map();
  const vecs = docs.map((d) => {
    const tf = new Map();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { d, tf };
  });
  const N = docs.length || 1;
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));
  return {
    search(q, k = 8, filter = () => true) {
      const qt = tokenize(q);
      return vecs
        .filter((v) => filter(v.d))
        .map((v) => {
          let s = 0;
          for (const t of qt) if (v.tf.has(t)) s += (1 + Math.log(v.tf.get(t))) * idf(t);
          return { ...v.d, score: s / Math.sqrt(1 + v.tf.size / 20) };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

// ---------- PII ----------
export function stripContact(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email removed]')
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[phone removed]')
    .replace(/https?:\/\/\S+|www\.\S+|linkedin\.com\/\S+/gi, '[link removed]')
    .replace(/\b\d{1,5}\s+\w+(\s\w+)?\s(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct)\b\.?/gi, '[address removed]');
}

// ---------- answer parsing ----------
export const isSkip = (s) => /^\s*(skip|pass|n\/?a|not sure|idk|don'?t know|no idea|-)\s*\.?$/i.test(s || '');

export function parseNumber(s) {
  const t = String(s).replace(/,/g, '');
  const r = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
  if (r) return (Number(r[1]) + Number(r[2])) / 2;
  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  const words = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`, 'i').test(t)) return n;
  return null;
}

export function parseScale(s) {
  const n = parseNumber(s);
  if (n != null && n >= 1 && n <= 5) return Math.round(n);
  const t = String(s).toLowerCase();
  if (/very (easy|slow|unclear)|terrible|awful|none at all/.test(t)) return 1;
  if (/very (hard|fast|clear)|excellent|amazing|outstanding|incredibl/.test(t)) return 5;
  if (/\b(easy|slow|unclear|poor|weak)\b/.test(t)) return 2;
  if (/\b(hard|fast|clear|good|strong|helpful)\b/.test(t)) return 4;
  if (/\b(ok|okay|average|fine|medium|moderate)\b/.test(t)) return 3;
  return null;
}

export function parseBool(s) {
  const t = String(s).toLowerCase();
  if (/^\s*(y|yes|yeah|yep|definitely|absolutely|sure|would)\b/.test(t) || /\bwould (re)?take\b/.test(t)) return true;
  if (/^\s*(n|no|nope|never|not)\b/.test(t) || /wouldn'?t/.test(t)) return false;
  return null;
}

export function parseChoice(s, options /* [{value,label,syn?}] */) {
  const t = String(s).toLowerCase();
  for (const o of options) if (t.trim() === o.value || t.trim() === String(o.label).toLowerCase()) return o.value;
  for (const o of options) {
    const keys = [o.value.replace(/_/g, ' '), String(o.label).toLowerCase(), ...(o.syn || [])];
    if (keys.some((k) => k && t.includes(k))) return o.value;
  }
  return null;
}

export const parseList = (s) => String(s).split(/[,;\n]|\band\b|\s\/\s/).map((x) => x.replace(/^[\s•*-]+|[\s.]+$/g, '').trim()).filter((x) => x.length > 1 && !isSkip(x));

const GRADE_KEYS = [
  ['exams', /exam|midterm|final(?! project)|test/],
  ['quizzes', /quiz/],
  ['problem_sets', /problem set|homework|hw|assignments?|psets?/],
  ['case_writeups', /case/],
  ['group_project', /group|team project/],
  ['individual_project', /individual project|paper|project/],
  ['participation', /participation|attendance|engagement/],
  ['presentations', /presentation|pitch/],
  ['discussion_posts', /discussion|posts?|forum/],
];
export function parseGradingMix(s) {
  const out = [];
  const t = String(s).toLowerCase();
  const re = /([a-z][a-z \-/]{2,30}?)\s*[:=]?\s*(\d{1,3})\s*%?|(\d{1,3})\s*%?\s*(?:for |on |is |are )?([a-z][a-z \-/]{2,30})/g;
  let m;
  while ((m = re.exec(t))) {
    const label = (m[1] || m[4] || '').trim();
    const pct = Number(m[2] || m[3]);
    const hit = GRADE_KEYS.find(([, rx]) => rx.test(label));
    if (hit && pct > 0 && pct <= 100) {
      const ex = out.find((g) => g.type === hit[0]);
      if (ex) ex.percent += pct; else out.push({ type: hit[0], percent: pct });
    }
  }
  return out.length ? out : null;
}
