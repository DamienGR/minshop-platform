import type { APIRoute } from 'astro';

export const prerender = false;

// GET /api/admin/session — "is this browser the admin?", asked by the
// storefront's edit shortcut (ticket #178, features/auth/adminHint.ts). The
// route decides nothing: the middleware's gate stands in front of it, as in
// front of every /api/admin route, and answers 401 (password) or 403 (Access)
// to anyone else. Reaching this line is the answer.
export const GET: APIRoute = () =>
  Response.json({ admin: true }, { headers: { 'cache-control': 'private, no-store' } });
