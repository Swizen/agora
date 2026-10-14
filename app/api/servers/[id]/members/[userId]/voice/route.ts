import { handler, clients, leaveVoice, requireModerable } from '@/lib/server';
import { Perm } from '@/lib/shared';

// Déconnecter un membre du vocal de ce serveur.
export const DELETE = handler(({ user, id, params }) => {
  const target = Number(params.userId);
  requireModerable(id, user.id, target, Perm.MOVE_MEMBERS);
  for (const c of clients) if (c.userId === target && c.voice?.serverId === id) leaveVoice(c);
  return {};
});
