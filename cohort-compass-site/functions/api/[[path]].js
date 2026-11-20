// Cloudflare Pages Function: routes /api/* to the shared core.
// Set ANTHROPIC_API_KEY (and optionally CC_STAFF_PIN) as encrypted env vars in the Pages dashboard.
// Optional: bind a KV namespace as CC_KV so submissions persist across isolates.
import { handle } from '../../api/core.js';
export const onRequest = (ctx) => handle(ctx.request, ctx.env);
