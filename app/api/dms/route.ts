import { handler, fail, friendship, text, one, all, run } from '@/lib/server';
import type { Dm, User } from '@/lib/types';

type DmRow = { id: number; user_id: number; name: string; tag: number; avatar: number; last_at: number | null };
const toDm = ({ id, user_id, name, tag, avatar, last_at }: DmRow): Dm => ({ id, user: { id: user_id, name, tag, avatar }, last_at });

// ?1 = utilisateur courant ; l'autre participant est celui des deux qui n'est pas lui.
const DM_SELECT = `
  SELECT c.id, u.id AS user_id, u.name, u.tag, u.avatar_v AS avatar, (SELECT MAX(created_at) FROM messages WHERE channel_id = c.id) AS last_at
  FROM channels c JOIN users u ON u.id = CASE WHEN c.dm_a = ?1 THEN c.dm_b ELSE c.dm_a END`;

export const GET = handler(({ user }) =>
  all<DmRow>(`${DM_SELECT} WHERE ?1 IN (c.dm_a, c.dm_b) AND NOT EXISTS (SELECT 1 FROM dm_closed WHERE user_id = ?1 AND channel_id = c.id)
    ORDER BY last_at DESC NULLS LAST, c.id DESC`, user.id).map(toDm));

// Ouvre (ou crée) la conversation avec un autre utilisateur : il faut être amis ou partager un serveur.
export const POST = handler(({ user, body }) => {
  const other = one<User>('SELECT id, name, tag, avatar_v AS avatar FROM users WHERE name = ?', text(body.name, 1, 32, 'Pseudo')) ?? fail(404, 'Utilisateur introuvable');
  if (other.id === user.id) fail(400, "Tu ne peux pas t'écrire à toi-même");
  const shared = one('SELECT 1 FROM members a JOIN members b ON a.server_id = b.server_id WHERE a.user_id = ? AND b.user_id = ?', user.id, other.id);
  if (!shared && friendship(user.id, other.id)?.status !== 'accepted') fail(403, 'Vous devez être amis ou partager un serveur pour discuter en privé');
  const [a, b] = user.id < other.id ? [user.id, other.id] : [other.id, user.id];
  run("INSERT OR IGNORE INTO channels (name, dm_a, dm_b) VALUES ('', ?, ?)", a, b);
  const dm = toDm(one<DmRow>(`${DM_SELECT} WHERE c.dm_a = ?2 AND c.dm_b = ?3`, user.id, a, b)!);
  run('DELETE FROM dm_closed WHERE user_id = ? AND channel_id = ?', user.id, dm.id);
  return dm;
});
