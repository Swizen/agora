import { handler, run } from '@/lib/server';

export const POST = handler(({ token }) => {
  run('DELETE FROM sessions WHERE token = ?', token);
  return {};
});
