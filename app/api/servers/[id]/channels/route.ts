import { handler, requirePerm, text, one, emit } from '@/lib/server';
import { Perm } from '@/lib/shared';
import type { Channel } from '@/lib/types';

export const POST = handler(({ user, body, id }) => {
  requirePerm(id, user.id, Perm.MANAGE_CHANNELS);
  const kind = body.kind === 'voice' ? 'voice' : 'text';
  const raw = text(body.name, 1, 32, 'Nom');
  const name = kind === 'text' ? raw.toLowerCase().replace(/\s+/g, '-') : raw;
  const channel = one<Channel>('INSERT INTO channels (server_id, name, kind) VALUES (?, ?, ?) RETURNING id, server_id, name, kind', id, name, kind)!;
  emit(id, 'channel', channel);
  return channel;
});
