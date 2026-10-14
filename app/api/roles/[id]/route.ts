import { handler, requirePerm, roleInput, toRole, fail, one, run, emit, type RoleRow } from '@/lib/server';
import { Perm, covers } from '@/lib/shared';

// Un rôle n'est modifiable que par quelqu'un qui possède déjà toutes ses permissions.
function editable(roleId: number, userId: number) {
  const role = one<RoleRow & { server_id: number }>('SELECT id, server_id, name, color, permissions, is_default FROM roles WHERE id = ?', roleId)
    ?? fail(404, 'Rôle introuvable');
  const mine = requirePerm(role.server_id, userId, Perm.MANAGE_ROLES);
  if (!covers(mine, role.permissions)) fail(403, 'Ce rôle a des permissions que tu ne possèdes pas');
  return { role, mine };
}

export const PATCH = handler(({ user, id, body }) => {
  const { role, mine } = editable(id, user.id);
  const input = roleInput(body, mine, toRole(role));
  const updated = one<RoleRow>(
    'UPDATE roles SET name = ?, color = ?, permissions = ? WHERE id = ? RETURNING id, name, color, permissions, is_default',
    role.is_default ? role.name : input.name, input.color, input.permissions, id,
  )!;
  emit(role.server_id, 'server', { server_id: role.server_id });
  return toRole(updated);
});

export const DELETE = handler(({ user, id }) => {
  const { role } = editable(id, user.id);
  if (role.is_default) fail(400, 'Le rôle @everyone ne peut pas être supprimé');
  run('DELETE FROM roles WHERE id = ?', id);
  emit(role.server_id, 'server', { server_id: role.server_id });
  return {};
});
