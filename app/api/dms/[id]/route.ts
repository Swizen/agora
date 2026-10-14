import { handler, channelOf, fail, run } from '@/lib/server';

// Fermer une conversation privée : elle disparaît de la liste, l'historique est conservé.
export const DELETE = handler(({ user, id }) => {
  if (channelOf(id, user.id).server_id !== null) return fail(400, "Ce n'est pas une conversation privée");
  run('INSERT OR IGNORE INTO dm_closed (user_id, channel_id) VALUES (?, ?)', user.id, id);
  return {};
});
