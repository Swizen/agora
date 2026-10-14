import { handler, all, channelOf, emitTo, fail } from '@/lib/server';

// Envoyé par le client toutes les quelques secondes pendant la saisie.
export const POST = handler(({ user, id }) => {
  const channel = channelOf(id, user.id);
  if (channel.kind === 'voice') return fail(400, "Un salon vocal n'a pas de messages");
  const audience = channel.server_id === null
    ? [channel.dm_a!, channel.dm_b!]
    : all<{ user_id: number }>('SELECT user_id FROM members WHERE server_id = ?', channel.server_id).map((r) => r.user_id);
  emitTo(audience.filter((u) => u !== user.id), 'typing', { channel_id: id, user });
  return {};
});
