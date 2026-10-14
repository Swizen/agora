import { handler, fail, run, emitTo } from '@/lib/server';

// Accepter la demande reçue de l'utilisateur :id.
export const POST = handler(({ user, id }) => {
  const { changes } = run("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'", id, user.id);
  if (!Number(changes)) fail(404, 'Demande introuvable');
  emitTo([user.id, id], 'friends', {});
  return {};
});

// Retirer un ami, refuser une demande reçue ou annuler une demande envoyée.
export const DELETE = handler(({ user, id }) => {
  const { changes } = run(
    'DELETE FROM friendships WHERE (requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1)', user.id, id,
  );
  if (!Number(changes)) fail(404, 'Relation introuvable');
  emitTo([user.id, id], 'friends', {});
  return {};
});
