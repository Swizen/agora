import { handler, broadcastUser, readImage, run } from '@/lib/server';

// Corps brut : image déjà redimensionnée par le navigateur (WebP, PNG ou JPEG).
export const PUT = handler(async ({ user, req }) => {
  const bytes = await readImage(req, 2 * 1024 * 1024);
  run('UPDATE users SET banner = ?, banner_v = banner_v + 1 WHERE id = ?', bytes, user.id);
  return {};
});

export const DELETE = handler(({ user }) => {
  run('UPDATE users SET banner = NULL, banner_v = 0 WHERE id = ?', user.id);
  return {};
});
