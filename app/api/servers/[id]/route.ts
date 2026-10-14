import { handler, serverDetail, requirePerm, fail, one, run, emit } from '@/lib/server';
import { Perm } from '@/lib/shared';

export const GET = handler(({ user, id }) => serverDetail(id, user.id));

// Lien personnalisé : /invite/<vanity>. Chaîne vide = suppression.
export const PATCH = handler(({ user, id, body }) => {
  requirePerm(id, user.id, Perm.MANAGE_SERVER);
  const vanity = (typeof body.vanity === 'string' ? body.vanity.trim().toLowerCase() : '') || null;
  if (vanity) {
    if (!/^[a-z0-9-]{3,32}$/.test(vanity)) fail(400, 'Lien : 3 à 32 caractères, lettres minuscules, chiffres et tirets');
    if (one('SELECT 1 FROM servers WHERE vanity = ? AND id != ?', vanity, id) || one('SELECT 1 FROM invites WHERE code = ?', vanity)) {
      fail(409, 'Ce lien est déjà pris');
    }
  }
  run('UPDATE servers SET vanity = ? WHERE id = ?', vanity, id);
  emit(id, 'server', { server_id: id });
  return { vanity };
});
