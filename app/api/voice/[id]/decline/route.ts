import { handler, channelOf, clients, emitTo, fail } from '@/lib/server';

// Refuser un appel privé : la personne qui appelle est prévenue, la sonnerie s'arrête sur nos autres onglets.
export const POST = handler(({ user, id }) => {
  const channel = channelOf(id, user.id);
  if (channel.server_id !== null) return fail(400, "Ce n'est pas un appel privé");
  const callers = [...clients].filter((c) => c.voice?.channelId === id && c.userId !== user.id).map((c) => c.userId);
  emitTo(callers, 'call_declined', { channel_id: id, user });
  emitTo([user.id], 'call_stop', { channel_id: id });
  return {};
});
