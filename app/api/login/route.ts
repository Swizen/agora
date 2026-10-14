import { publicHandler, fail, one, verify, session } from '@/lib/server';

export const POST = publicHandler(({ body }) => {
  const user = one<{ id: number; pass: string }>('SELECT id, pass FROM users WHERE name = ?', String(body.name ?? '').trim());
  if (!user || typeof body.pass !== 'string' || !verify(body.pass, user.pass)) return fail(401, 'Identifiants invalides');
  return session(user.id);
});
