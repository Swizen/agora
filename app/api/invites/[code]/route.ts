import { handler, publicHandler, findInvite, permissionsOf, transaction, fail, one, run, emit } from '@/lib/server';
import { Perm, has } from '@/lib/shared';
import type { InvitePreview, ServerSummary } from '@/lib/types';

// Aperçu public, affiché sur la page /invite/<code> avant connexion.
export const GET = publicHandler(({ params }): InvitePreview => {
  const invite = findInvite(params.code);
  const server = one<ServerSummary & { members: number }>(
    'SELECT s.id, s.name, (SELECT COUNT(*) FROM members WHERE server_id = s.id) AS members FROM servers s WHERE s.id = ?', invite.server_id,
  )!;
  return { code: params.code, server, expires_at: invite.expires_at };
});

// Rejoindre le serveur.
export const POST = handler(({ user, params }) => {
  const invite = findInvite(params.code);
  const joined = transaction(() => {
    const added = Number(run('INSERT OR IGNORE INTO members (server_id, user_id) VALUES (?, ?)', invite.server_id, user.id).changes) > 0;
    if (added && invite.code) run('UPDATE invites SET uses = uses + 1 WHERE code = ?', invite.code);
    return added;
  });
  if (joined) emit(invite.server_id, 'member', { ...user, server_id: invite.server_id, roles: [] });
  return one<ServerSummary>('SELECT id, name FROM servers WHERE id = ?', invite.server_id)!;
});

// Révocation : par son créateur ou avec « Gérer le serveur ».
export const DELETE = handler(({ user, params }) => {
  const invite = one<{ server_id: number; creator_id: number }>('SELECT server_id, creator_id FROM invites WHERE code = ?', params.code)
    ?? fail(404, 'Invitation introuvable');
  if (invite.creator_id !== user.id && !has(permissionsOf(invite.server_id, user.id), Perm.MANAGE_SERVER)) fail(403, 'Permission insuffisante');
  run('DELETE FROM invites WHERE code = ?', params.code);
  return {};
});
