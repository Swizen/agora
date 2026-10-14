import { handler, all, audienceOf, isConnected } from '@/lib/server';
import type { Presence, Status } from '@/lib/types';

/** Présence de tous les utilisateurs que l'on voit (serveurs en commun, amis, conversations privées). */
export const GET = handler(({ user }) => {
  const ids = audienceOf(user.id);
  const rows = all<{ id: number; status: Status }>(`SELECT id, status FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return Object.fromEntries(rows.map((r) => [r.id, (r.status === 'invisible' || !isConnected(r.id) ? 'offline' : r.status) as Presence]));
});
