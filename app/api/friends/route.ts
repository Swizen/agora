import { handler, fail, friendship, all, one, run, emitTo } from '@/lib/server';
import type { Friends, User } from '@/lib/types';

export const GET = handler(({ user }): Friends => {
  const rows = all<User & { status: 'pending' | 'accepted'; outgoing: number }>(`
    SELECT u.id, u.name, u.tag, u.avatar_v AS avatar, f.status, f.requester_id = ?1 AS outgoing
    FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
    WHERE ?1 IN (f.requester_id, f.addressee_id) ORDER BY u.name`, user.id);
  const pick = (keep: (r: (typeof rows)[number]) => boolean) => rows.filter(keep).map(({ id, name, tag, avatar }) => ({ id, name, tag, avatar }));
  return {
    friends: pick((r) => r.status === 'accepted'),
    incoming: pick((r) => r.status === 'pending' && !r.outgoing),
    outgoing: pick((r) => r.status === 'pending' && !!r.outgoing),
  };
});

// Demande d'ami par identifiant complet (pseudo#tag). Si l'autre nous avait déjà demandé, on devient amis directement.
// ponytail: pas de limite de débit sur les demandes ; à ajouter avec le rate limiting global.
export const POST = handler(({ user, body }) => {
  const match = /^(.+)#(\d{1,4})$/.exec(String(body.tag ?? '').trim()) ?? fail(400, 'Identifiant attendu au format pseudo#1234');
  const other = one<User>('SELECT id, name, tag, avatar_v AS avatar FROM users WHERE name = ? AND tag = ?', match[1], Number(match[2]))
    ?? fail(404, "Aucun utilisateur avec cet identifiant. Vérifie l'orthographe et le numéro.");
  if (other.id === user.id) fail(400, "Tu ne peux pas t'ajouter toi-même");
  const existing = friendship(user.id, other.id);
  if (existing?.status === 'accepted') fail(409, `Tu es déjà ami avec ${other.name}`);
  if (existing?.requester_id === user.id) fail(409, `Demande déjà envoyée à ${other.name}`);
  if (existing) run("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?", other.id, user.id);
  else run("INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')", user.id, other.id);
  emitTo([user.id, other.id], 'friends', {});
  return { status: existing ? 'accepted' : 'pending', user: other };
});
