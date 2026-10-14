import { handler, permissionsOf, requirePerm, isInviteDuration, newInviteCode, fail, one, all, run } from '@/lib/server';
import { Perm, has } from '@/lib/shared';
import type { Invite } from '@/lib/types';

// Invitations actives : toutes avec « Gérer le serveur », sinon seulement les siennes.
export const GET = handler(({ user, id }) => {
  const perms = permissionsOf(id, user.id);
  const manage = has(perms, Perm.MANAGE_SERVER);
  if (!manage && !has(perms, Perm.CREATE_INVITES)) fail(403, 'Permission insuffisante');
  run('DELETE FROM invites WHERE expires_at < ?', Date.now());
  return all<Invite>(
    `SELECT i.code, u.name AS creator, i.expires_at, i.uses, i.created_at FROM invites i JOIN users u ON u.id = i.creator_id
     WHERE i.server_id = ? AND (? OR i.creator_id = ?) ORDER BY i.created_at DESC`,
    id, manage ? 1 : 0, user.id,
  );
});

// body.expires_in : durée en secondes parmi INVITE_DURATIONS, ou null pour un lien permanent.
export const POST = handler(({ user, id, body }) => {
  requirePerm(id, user.id, Perm.CREATE_INVITES);
  const ttl = body.expires_in ?? null;
  if (!isInviteDuration(ttl)) return fail(400, 'Durée invalide');
  const invite = one<Omit<Invite, 'creator'>>(
    'INSERT INTO invites (code, server_id, creator_id, expires_at) VALUES (?, ?, ?, ?) RETURNING code, expires_at, uses, created_at',
    newInviteCode(), id, user.id, ttl === null ? null : Date.now() + ttl * 1000,
  )!;
  return { ...invite, creator: user.name } satisfies Invite;
});
