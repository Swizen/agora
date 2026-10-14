import { handler, broadcastUser, readImage, run } from '@/lib/server';

// Corps brut : image déjà redimensionnée par le navigateur (WebP, PNG ou JPEG).
export const PUT = handler(async ({ user, req }) => {
  const bytes = await readImage(req, 524288);
  run('UPDATE users SET avatar = ?, avatar_v = avatar_v + 1 WHERE id = ?', bytes, user.id);
  broadcastUser(user.id);
  return {};
});

export const DELETE = handler(({ user }) => {
  run('UPDATE users SET avatar = NULL, avatar_v = 0 WHERE id = ?', user.id);
  broadcastUser(user.id);
  return {};
});
