import { handler, fail, run } from '@/lib/server';

// Couper / rétablir les notifications (sonores et visuelles) d'un serveur, pour soi.
export const PATCH = handler(({ user, id, body }) => {
  if (typeof body.muted !== 'boolean') return fail(400, 'muted attendu');
  const { changes } = run('UPDATE members SET notify_muted = ? WHERE server_id = ? AND user_id = ?', body.muted ? 1 : 0, id, user.id);
  if (!Number(changes)) fail(404, 'Serveur introuvable');
  return { muted: body.muted };
});
