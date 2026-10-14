import { randomBytes } from 'node:crypto';
import { handler, broadcastPresence, clients, isConnected, leaveVoice, sse, type Client } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Flux Server-Sent Events : un par onglet connecté.
export const GET = handler(({ user, req }) => {
  const encoder = new TextEncoder();
  const client: Client = { id: randomBytes(9).toString('base64url'), userId: user.id, user, send: () => {} };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (!clients.delete(client)) return;
        leaveVoice(client);
        if (!isConnected(user.id)) broadcastPresence(user.id);
        try { controller.close(); } catch {}
      };
      client.send = (chunk) => { try { controller.enqueue(encoder.encode(chunk)); } catch { close(); } };
      const first = !isConnected(user.id);
      clients.add(client);
      client.send(sse('hello', { client_id: client.id }));
      if (first) broadcastPresence(user.id);
      req.signal.addEventListener('abort', close);
    },
    cancel: () => {
      if (!clients.delete(client)) return;
      leaveVoice(client);
      if (!isConnected(user.id)) broadcastPresence(user.id);
    },
  });
  // no-transform : empêche la compression de bufferiser le flux.
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' } });
});
