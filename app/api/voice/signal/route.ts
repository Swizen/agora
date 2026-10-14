import { handler, clients, fail, ownClient, sse } from '@/lib/server';
import type { SignalData } from '@/lib/types';

// Relais de signalisation WebRTC (offre, réponse, candidats ICE) entre deux participants d'un même salon vocal.
export const POST = handler(({ user, body }) => {
  const from = ownClient(body.from, user.id);
  const to = [...clients].find((c) => c.id === body.to);
  if (!from.voice || !to?.voice || to.voice.channelId !== from.voice.channelId) return fail(409, 'Ce participant a quitté le salon');
  if (!body.data || typeof body.data !== 'object') return fail(400, 'Signal invalide');
  to.send(sse('signal', { from: from.id, data: body.data as SignalData }));
  return {};
});
