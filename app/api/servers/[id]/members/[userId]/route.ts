import { handler, requirePerm, requireModerable, permissionsOf, transaction, fail, one, all, run, emit, emitTo, emitVoice, clients, leaveVoice } from '@/lib/server';
import { Perm, covers } from '@/lib/shared';

const requireMember = (serverId: number, userId: number) =>
  one('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', serverId, userId) ?? fail(404, 'Membre introuvable');

// body.roles : remplace les rôles d'un membre (chaque rôle ajouté ou retiré doit être couvert par nos permissions).
// body.voice_muted : rend muet / rétablit le micro d'un membre pour tout le vocal.
export const PATCH = handler(({ user, id, params, body }) => {
  const target = Number(params.userId);
  if (typeof body.voice_muted === 'boolean') {
    requireModerable(id, user.id, target, Perm.MUTE_MEMBERS);
    run('UPDATE members SET voice_muted = ? WHERE server_id = ? AND user_id = ?', body.voice_muted ? 1 : 0, id, target);
    for (const c of clients) if (c.userId === target && c.voice?.serverId === id) emitVoice(id, c.voice.channelId);
    if (body.roles === undefined) return {};
  }
  const mine = requirePerm(id, user.id, Perm.MANAGE_ROLES);
  requireMember(id, target);
  if (!Array.isArray(body.roles)) return fail(400, 'Rôles invalides');
  const wanted = new Set(body.roles.map(Number));
  const current = new Set(all<{ role_id: number }>('SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?', id, target).map((r) => r.role_id));
  const roles = all<{ id: number; permissions: number }>('SELECT id, permissions FROM roles WHERE server_id = ? AND NOT is_default', id);
  for (const r of roles) {
    if (wanted.has(r.id) !== current.has(r.id) && !covers(mine, r.permissions)) fail(403, 'Tu ne peux pas gérer un rôle plus puissant que les tiens');
  }
  transaction(() => {
    run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', id, target);
    for (const r of roles) if (wanted.has(r.id)) run('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', id, target, r.id);
  });
  emit(id, 'server', { server_id: id });
  return {};
});

// Exclusion.
export const DELETE = handler(({ user, id, params }) => {
  const mine = requirePerm(id, user.id, Perm.KICK_MEMBERS);
  const target = Number(params.userId);
  if (target === user.id) fail(400, "Tu ne peux pas t'exclure toi-même");
  requireMember(id, target);
  if (one('SELECT 1 FROM servers WHERE id = ? AND owner_id = ?', id, target) || !covers(mine, permissionsOf(id, target))) {
    fail(403, 'Tu ne peux pas exclure ce membre');
  }
  for (const c of clients) if (c.userId === target && c.voice?.serverId === id) leaveVoice(c);
  run('DELETE FROM members WHERE server_id = ? AND user_id = ?', id, target);
  emit(id, 'server', { server_id: id });
  emitTo([target], 'server', { server_id: id });
  return {};
});
