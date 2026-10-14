import { handler, requirePerm, roleInput, toRole, one, emit, type RoleRow } from '@/lib/server';
import { Perm } from '@/lib/shared';

export const POST = handler(({ user, id, body }) => {
  const mine = requirePerm(id, user.id, Perm.MANAGE_ROLES);
  const { name, color, permissions } = roleInput(body, mine);
  const role = one<RoleRow>(
    'INSERT INTO roles (server_id, name, color, permissions) VALUES (?, ?, ?, ?) RETURNING id, name, color, permissions, is_default',
    id, name, color, permissions,
  )!;
  emit(id, 'server', { server_id: id });
  return toRole(role);
});
