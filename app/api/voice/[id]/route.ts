import { handler, channelOf, clients, emitTo, emitVoice, fail, leaveVoice, one, ownClient, reopenDm, requirePerm, voiceFlags, voiceParticipants, USER_COLS } from '@/lib/server';
import { Perm } from '@/lib/shared';
import type { User } from '@/lib/types';

// ponytail: maillage complet (chaque participant relié à chacun) ; au-delà de ~6 personnes, passer à un SFU (LiveKit, mediasoup).

// Rejoindre un salon vocal ou un appel privé avec une connexion temps réel ; renvoie les participants
// (le nouveau venu appelle les autres).
export const POST = handler(({ user, id, body }) => {
  const client = ownClient(body.client_id, user.id);
  const channel = channelOf(id, user.id);
  if (channel.server_id !== null) {
    if (channel.kind !== 'voice') return fail(400, "Ce salon n'est pas un salon vocal");
    requirePerm(channel.server_id, user.id, Perm.CONNECT);
  }
  // Un compte ne parle que depuis un seul onglet : les autres sont déconnectés du vocal.
  for (const c of clients) if (c.userId === user.id) leaveVoice(c);
  client.voice = { channelId: id, serverId: channel.server_id, ...voiceFlags(body) };
  emitVoice(channel.server_id, id);
  if (channel.server_id === null) {
    reopenDm(id);
    // Appel privé : on fait sonner l'autre s'il n'est pas déjà dans l'appel.
    const other = channel.dm_a === user.id ? channel.dm_b! : channel.dm_a!;
    if (![...clients].some((c) => c.userId === other && c.voice?.channelId === id)) emitTo([other], 'call', { channel_id: id, from: user });
  }
  return voiceParticipants(id);
});

// Micro, son ou caméra activés / coupés.
export const PATCH = handler(({ user, id, body }) => {
  const client = ownClient(body.client_id, user.id);
  if (client.voice?.channelId !== id) return fail(409, "Tu n'es pas dans ce salon vocal");
  Object.assign(client.voice, voiceFlags(body, client.voice));
  emitVoice(client.voice.serverId, id);
  return {};
});

export const DELETE = handler(({ user, id, body }) => {
  const client = ownClient(body.client_id, user.id);
  if (client.voice?.channelId === id) leaveVoice(client);
  return {};
});
