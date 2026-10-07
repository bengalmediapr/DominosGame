// Cloudflare Pages Function for every /api/* request; the logic lives in server/api.ts.
import { Env, handle } from '../../server/api';

export const onRequest = (ctx: { request: Request; env: Env }): Promise<Response> => handle(ctx.request, ctx.env);
