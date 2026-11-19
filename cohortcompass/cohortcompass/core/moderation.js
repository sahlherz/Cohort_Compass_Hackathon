// Moderation + escalation. Rule-based first pass (always on), optional cheap-model second opinion.
// Final rejections are a HUMAN decision: anything flagged goes to the GPP staff queue as "pending".
import { loadPrompt } from './llm.js';

const RULES = [
  ['protected_attribute', /\b(race|racist|black|white|asian|hispanic|latino|religio\w*|muslim|christian|jewish|hindu|gay|lesbian|trans(gender)?|disab\w*|pregnan\w*|old (man|woman|lady|guy)|too old|young (guy|girl)|accent|foreigner|immigrant|female prof|male prof)\b/i],
  ['appearance', /\b(ugly|hot|attractive|fat|skinny|dresses|outfit|looks like|hair)\b/i],
  ['personal_attack', /\b(idiot|stupid|moron|incompetent|worst (person|human)|hate (him|her|them)|lazy (bum|jerk)|jerk|clown)\b/i],
  ['private_life', /\b(divorce|his wife|her husband|drinks|drunk|dating|kids are|personal life)\b/i],
  ['contact_info', /[\w.+-]+@[\w-]+\.[\w.]+|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/],
  ['unverifiable_accusation', /\b(cheat(s|ed|ing)? on|steals|corrupt|plagiari[sz]ed)\b/i],
];
const ESCALATE = /\b(visa|opt\b|cpt\b|immigration|international student status|can'?t afford|tuition (help|aid)|financial hardship|food insecur|homeless|depress\w*|anxiety|suicid\w*|self[- ]harm|mental health|harass\w*|discriminat\w*|title ix|academic (integrity|misconduct)|accommodation)\b/i;

export function ruleModerate(text) {
  const flags = RULES.filter(([, rx]) => rx.test(text)).map(([f]) => f);
  const escalate = ESCALATE.test(text);
  if (escalate) flags.push('sensitive_topic');
  return { status: flags.filter((f) => f !== 'sensitive_topic').length ? 'pending' : 'approved', flags, escalate_to_staff: escalate };
}

export async function moderate(llm, text) {
  const r = ruleModerate(text);
  if (!llm.live) return { ...r, reviewed_by: 'auto', via: 'rules' };
  const out = await llm.call('cheap', loadPrompt('moderation'), String(text).slice(0, 4000), { maxTokens: 250 });
  if (!out?.status) return { ...r, reviewed_by: 'auto', via: 'rules' };
  const flags = [...new Set([...r.flags, ...(out.flags || [])])];
  // AI may ADD caution, never remove a rule flag or auto-reject: rejections are staff decisions.
  const status = flags.filter((f) => f !== 'sensitive_topic').length ? 'pending' : 'approved';
  return { status, flags, escalate_to_staff: r.escalate_to_staff || flags.includes('sensitive_topic'), suggested_edit: out.suggested_edit || null, reviewed_by: 'auto', via: 'rules+llm' };
}
