import { handler, fail, hash, one, run, verify } from '@/lib/server';

// Changer de mot de passe déconnecte les autres appareils (on garde la session courante).
export const POST = handler(({ user, token, body }) => {
  const { pass } = one<{ pass: string }>('SELECT pass FROM users WHERE id = ?', user.id)!;
  if (typeof body.current !== 'string' || !verify(body.current, pass)) fail(403, 'Mot de passe actuel incorrect');
  if (typeof body.next !== 'string' || body.next.length < 8 || body.next.length > 128) return fail(400, 'Nouveau mot de passe : 8 à 128 caractères');
  run('UPDATE users SET pass = ? WHERE id = ?', hash(body.next), user.id);
  const { changes } = run('DELETE FROM sessions WHERE user_id = ? AND token != ?', user.id, token);
  return { signed_out: Number(changes) };
});
