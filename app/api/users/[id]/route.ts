import { handler, USER_COLS, fail, one, presenceOf } from '@/lib/server';
import type { Presence, Profile } from '@/lib/types';

export const GET = handler(({ id }): Profile & { presence: Presence } => ({
  ...(one<Profile>(`SELECT ${USER_COLS}, u.bio, u.banner_color, u.banner_v AS banner FROM users u WHERE u.id = ?`, id) ?? fail(404, 'Utilisateur introuvable')),
  presence: presenceOf(id),
}));
