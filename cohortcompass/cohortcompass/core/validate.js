// JSON Schema 2020-12 validation (Ajv) + semantic rules the schema can't express cleanly.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCError } from './errors.js';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
export const SCHEMA_VERSION = '1.0.0';
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

export const SCHEMAS = {};
for (const f of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) {
  const s = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8'));
  SCHEMAS[f.replace('.schema.json', '')] = s;
  ajv.addSchema(s);
}
export const schemaId = (name) => SCHEMAS[name]?.$id;

function semanticChecks(name, rec) {
  const missing = [];
  const invalid = [];
  if (name === 'course-review') {
    for (const f of ['pace', 'difficulty', 'clarity', 'feedback_quality']) {
      if ((rec[f] === 1 || rec[f] === 5) && !(rec.examples || []).some((e) => e.field === f)) missing.push(`examples[field=${f}]`);
    }
    if ((rec.avoid_if || []).length && !(rec.examples || []).some((e) => e.field === 'avoid_if')) {
      // warnings need evidence too
      missing.push('examples[field=avoid_if]');
    }
    if (rec.grading_mix?.length) {
      const sum = rec.grading_mix.reduce((a, g) => a + g.percent, 0);
      if (sum < 90 || sum > 110) invalid.push({ path: '/grading_mix', reason: `percentages sum to ${sum}, expected ~100` });
    }
  }
  if (name === 'career-outcome' && rec.people_roles_that_helped) {
    rec.people_roles_that_helped.forEach((p, i) => {
      if (p.name_with_consent && !rec.extensions?.x_name_consent) invalid.push({ path: `/people_roles_that_helped/${i}/name_with_consent`, reason: 'names require explicit consent (extensions.x_name_consent=true)' });
    });
  }
  return { missing, invalid };
}

/** Validate a record. Returns {valid, missing_fields, invalid_fields}. */
export function validate(name, rec) {
  const fn = ajv.getSchema(schemaId(name));
  if (!fn) throw new CCError('BAD_REQUEST', `unknown schema ${name}`);
  const ok = fn(rec);
  const missing = [];
  const invalid = [];
  for (const e of fn.errors || []) {
    if (e.keyword === 'required') missing.push((e.instancePath ? e.instancePath.slice(1) + '.' : '') + e.params.missingProperty);
    else if (['if', 'anyOf', 'allOf'].includes(e.keyword)) continue;
    else invalid.push({ path: e.instancePath || '/', reason: e.message + (e.params?.allowedValues ? `: ${e.params.allowedValues.join('|')}` : '') });
  }
  const sem = semanticChecks(name, rec);
  missing.push(...sem.missing);
  invalid.push(...sem.invalid);
  const uniq = [...new Set(missing)];
  return { valid: ok && uniq.length === 0 && invalid.length === 0, missing_fields: uniq, invalid_fields: invalid };
}

export function assertValid(name, rec) {
  const r = validate(name, rec);
  if (!r.valid) throw new CCError('VALIDATION_FAILED', `${name} failed validation`, { missing_fields: r.missing_fields, invalid_fields: r.invalid_fields, retryable: true });
  return rec;
}

/** Enum values for a top-level field (used by interview options + extractor prompts). */
export function enumOf(name, path) {
  let node = SCHEMAS[name];
  for (const p of path.split('.')) {
    node = node?.properties?.[p] ?? node?.items?.properties?.[p];
    if (node?.type === 'array' && node.items) node = node.items.enum ? node.items : node;
  }
  return node?.enum || node?.items?.enum || null;
}
