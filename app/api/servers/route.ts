import { handler, text, one, run, transaction } from '@/lib/server';
import { DEFAULT_PERMS } from '@/lib/shared';
import type { ServerSummary } from '@/lib/types';

export const POST = handler(({ user, body }) => {
  const name = text(body.name, 1, 64, 'Nom');
  return transaction(() => {
    const server = one<ServerSummary>('INSERT INTO servers (name, owner_id) VALUES (?, ?) RETURNING id, name', name, user.id)!;
    run('INSERT INTO members (server_id, user_id) VALUES (?, ?)', server.id, user.id);
    run("INSERT INTO channels (server_id, name) VALUES (?, 'général')", server.id);
    run("INSERT INTO roles (server_id, name, permissions, is_default) VALUES (?, '@everyone', ?, 1)", server.id, DEFAULT_PERMS);
    return server;
  });
});
