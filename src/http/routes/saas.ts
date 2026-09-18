import type { RequestContext } from '../types.js';
import { sendJSON } from '../responses.js';
import { handleSaasRoute } from '../../saas/routes.js';

export async function handleSaasDelegatedRoute(ctx: RequestContext): Promise<boolean> {
  if (!ctx.pathname.startsWith('/api/saas/')) {
    return false;
  }

  if (!ctx.config.saasMode) {
    sendJSON(ctx.res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
    return true;
  }

  const handled = await handleSaasRoute(ctx.pathname, ctx.req, ctx.res);
  if (handled) return true;
  sendJSON(ctx.res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
  return true;
}
