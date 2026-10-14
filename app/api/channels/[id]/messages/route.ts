import { handler, channelOf, requirePerm, fail, text, one, all, emit, emitTo, reopenDm } from '@/lib/server';
import { Perm } from '@/lib/shared';
import type { Message } from '@/lib/types';

const textChannel = (id: number, userId: number) => {
  const channel = channelOf(id, userId);
  if (channel.kind === 'voice') fail(400, "Un salon vocal n'a pas de messages");
  return channel;
};

export const GET = handler(({ user, id, url }) => {
  textChannel(id, user.id);
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  return all<Message>(`
    SELECT m.id, m.channel_id, m.user_id, u.name, u.avatar_v AS avatar, m.body, m.created_at FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 50`, id, before).reverse();
});

export const POST = handler(({ user, body, id }) => {
  const channel = textChannel(id, user.id);
  if (channel.server_id !== null) requirePerm(channel.server_id, user.id, Perm.SEND_MESSAGES);
  const msg: Message = {
    ...one<Omit<Message, 'name' | 'avatar'>>('INSERT INTO messages (channel_id, user_id, body) VALUES (?, ?, ?) RETURNING id, channel_id, user_id, body, created_at',
      id, user.id, text(body.body, 1, 2000, 'Message'))!,
    name: user.name,
    avatar: user.avatar,
  };
  if (channel.server_id === null) {
    reopenDm(id);
    emitTo([channel.dm_a!, channel.dm_b!], 'msg', { ...msg, server_id: null });
  }
  else emit(channel.server_id, 'msg', { ...msg, server_id: channel.server_id });
  return msg;
});
