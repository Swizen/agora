import { publicHandler, fail, text, one, hash, newTag, session } from '@/lib/server';

export const POST = publicHandler(({ body }) => {
  const name = text(body.name, 2, 32, 'Pseudo');
  if (!/^[\w.-]+$/.test(name)) fail(400, 'Pseudo : lettres, chiffres, . _ - uniquement');
  if (typeof body.pass !== 'string' || body.pass.length < 8 || body.pass.length > 128) return fail(400, 'Mot de passe : 8 à 128 caractères');
  if (one('SELECT 1 FROM users WHERE name = ?', name)) fail(409, 'Pseudo déjà pris');
  return session(one<{ id: number }>('INSERT INTO users (name, pass, tag) VALUES (?, ?, ?) RETURNING id', name, hash(body.pass), newTag())!.id);
});
