import { handler, all, broadcastPresence, broadcastUser, fail, one, run, text } from '@/lib/server';
import type { Me, Profile, ServerSummary, Status } from '@/lib/types';

const STATUSES: Status[] = ['online', 'idle', 'dnd', 'invisible'];

export const GET = handler(({ user }): Me => ({
  ...one<Omit<Profile, keyof typeof user> & { status: Status }>('SELECT status, bio, banner_color, banner_v AS banner FROM users WHERE id = ?', user.id)!,
  ...user,
  servers: all<ServerSummary & { muted: number }>('SELECT s.id, s.name, m.notify_muted AS muted FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY s.id', user.id)
    .map((s) => ({ ...s, muted: s.muted === 1 })),
}));

// Champs modifiables : name, bio, banner_color (null : couleur dérivée du pseudo), status.
export const PATCH = handler(({ user, body }) => {
  if (body.name !== undefined) {
    const name = text(body.name, 2, 32, 'Pseudo');
    if (!/^[\w.-]+$/.test(name)) fail(400, 'Pseudo : lettres, chiffres, . _ - uniquement');
    if (one('SELECT 1 FROM users WHERE name = ? AND id != ?', name, user.id)) fail(409, 'Pseudo déjà pris');
    run('UPDATE users SET name = ? WHERE id = ?', name, user.id);
  }
  if (body.bio !== undefined) run('UPDATE users SET bio = ? WHERE id = ?', text(body.bio, 0, 190, 'Bio'), user.id);
  if (body.banner_color !== undefined) {
    const color = body.banner_color === null ? null : String(body.banner_color);
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) fail(400, 'Couleur invalide');
    run('UPDATE users SET banner_color = ? WHERE id = ?', color && color.toLowerCase(), user.id);
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) fail(400, 'Statut invalide');
    run('UPDATE users SET status = ? WHERE id = ?', body.status as Status, user.id);
    broadcastPresence(user.id);
  }
  if (body.name !== undefined) broadcastUser(user.id);
  return {};
});
