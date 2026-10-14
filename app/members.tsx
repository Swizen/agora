'use client';
import { useEffect, useState } from 'react';
import { errorMessage, type Call } from '@/lib/client';
import { Perm, covers, has, memberPerms } from '@/lib/shared';
import type { Friends, Presence, Profile, Role, ServerDetail, ServerMember, User } from '@/lib/types';
import { Banner } from './profile';
import { friendStatus, userId } from './friends';
import { Avatar, dangerButton, ghostButton, Icon, Modal, nameColor, primaryButton, RoleChip } from './ui';

/** Rôle le plus haut d'un membre (ordre de création ; @everyone exclu). */
export const topRole = (server: ServerDetail, member: ServerMember): Role | undefined =>
  server.roles.find((r) => !r.is_default && member.roles.includes(r.id));

export const memberColor = (server: ServerDetail, member: ServerMember) => topRole(server, member)?.color ?? nameColor(member.name);

/** Membres en ligne regroupés par rôle le plus haut (façon Discord), puis les membres hors ligne. */
function groups(server: ServerDetail, presence: Record<number, Presence>) {
  const online = server.members.filter((m) => (presence[m.id] ?? 'offline') !== 'offline');
  const byRole = server.roles
    .filter((r) => !r.is_default)
    .map((role) => ({ key: String(role.id), label: role.name, color: role.color, offline: false, members: online.filter((m) => topRole(server, m)?.id === role.id) }));
  return [
    ...byRole,
    { key: 'online', label: 'En ligne', color: undefined, offline: false, members: online.filter((m) => !topRole(server, m)) },
    { key: 'offline', label: 'Hors ligne', color: undefined, offline: true, members: server.members.filter((m) => !online.includes(m)) },
  ].filter((g) => g.members.length);
}

export function MemberList({ server, presence, onSelect }: { server: ServerDetail; presence: Record<number, Presence>; onSelect: (id: number) => void }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-l border-line xl:flex">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4 text-sm font-semibold text-muted">
        <Icon name="users" className="size-4" /> Membres — {server.members.length}
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        {groups(server, presence).map((g) => (
          <section key={g.key} className="mb-4">
            <h3 className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
              {g.color && <span className="size-2 rounded-full" style={{ background: g.color }} />}
              {g.label} — {g.members.length}
            </h3>
            {g.members.map((m) => {
              const roles = server.roles.filter((r) => m.roles.includes(r.id));
              return (
                <button key={m.id} onClick={() => onSelect(m.id)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.04] hover:opacity-100 ${g.offline ? 'opacity-45' : ''}`}>
                  <Avatar user={m} status={presence[m.id] ?? 'offline'} ring="border-ink-900" className="size-8 text-xs" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" style={{ color: memberColor(server, m) }}>{m.name}</div>
                    {roles.length > 0 && (
                      <div className="truncate text-[11px] text-subtle">{roles.map((r) => r.name).join(' · ')}</div>
                    )}
                  </div>
                  {m.id === server.owner_id && <span title="Propriétaire" className="text-amber-400"><Icon name="crown" className="size-4" /></span>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}

export function MemberDialog({ memberId, server, me, call, notify, refresh, friends, presence, onDm, onClose }: {
  memberId: number | null;
  server: ServerDetail | null;
  me: User;
  call: Call;
  notify: (text: string) => void;
  refresh: () => Promise<void>;
  friends: Friends;
  presence: Record<number, Presence>;
  onDm: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmKick, setConfirmKick] = useState(false);
  const member = server?.members.find((m) => m.id === memberId);
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    setProfile(null);
    if (memberId !== null) call<Profile>(`/users/${memberId}`).then(setProfile).catch(() => {});
  }, [memberId, member?.name, member?.avatar]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify(errorMessage(e)); } finally { setBusy(false); }
  };

  const close = () => { setConfirmKick(false); onClose(); };

  return (
    <Modal open={!!member} onClose={close} className="w-[min(400px,calc(100%-32px))]">
      {member && server && (() => {
        const isOwner = member.id === server.owner_id;
        const isMe = member.id === me.id;
        const roles = server.roles.filter((r) => !r.is_default);
        const canRoles = has(server.perms, Perm.MANAGE_ROLES);
        const canKick = has(server.perms, Perm.KICK_MEMBERS) && !isOwner && !isMe && covers(server.perms, memberPerms(server, member));

        const toggleRole = (role: Role) => run(async () => {
          const next = member.roles.includes(role.id) ? member.roles.filter((id) => id !== role.id) : [...member.roles, role.id];
          await call(`/servers/${server.id}/members/${member.id}`, { roles: next }, 'PATCH');
          await refresh();
        });

        const friend = friendStatus(friends, member.id);
        const addFriend = () => run(async () => {
          const res = await call<{ status: string }>('/friends', { tag: userId(member) });
          notify(res.status === 'accepted' ? `Tu es maintenant ami avec ${member.name}` : `Demande d'ami envoyée à ${member.name}`);
        });
        const acceptFriend = () => run(async () => {
          await call(`/friends/${member.id}`, {});
          notify(`Tu es maintenant ami avec ${member.name}`);
        });

        const kick = () => run(async () => {
          await call(`/servers/${server.id}/members/${member.id}`, undefined, 'DELETE');
          notify(`${member.name} a été exclu du serveur`);
          close();
          await refresh();
        });

        return (
          <div>
            <Banner profile={profile ?? { ...member, banner: 0, banner_color: null }} className="h-28" />
            <button aria-label="Fermer" onClick={close} className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-black/30 text-white/80 backdrop-blur transition hover:bg-black/50 hover:text-white">
              <Icon name="x" className="size-4" />
            </button>
            <div className="px-6 pb-6">
              <Avatar user={member} status={presence[member.id] ?? 'offline'} ring="border-ink-900" className="-mt-10 size-20 text-2xl ring-[6px] ring-ink-900" />
              <div className="mt-3 flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight" style={{ color: memberColor(server, member) }}>
                  {member.name}<span className="text-base font-medium text-subtle">#{member.tag}</span>
                </h2>
                {isOwner && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400">
                    <Icon name="crown" className="size-3" /> Propriétaire
                  </span>
                )}
              </div>

              {profile?.bio && (
                <>
                  <h3 className="mt-5 mb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">À propos</h3>
                  <p className="text-sm break-words whitespace-pre-wrap text-fg/90">{profile.bio}</p>
                </>
              )}

              <h3 className="mt-5 mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Rôles</h3>
              {canRoles ? (
                roles.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((r) => {
                      const on = member.roles.includes(r.id);
                      const allowed = covers(server.perms, r.permissions);
                      return (
                        <button
                          key={r.id}
                          disabled={busy || !allowed}
                          title={allowed ? (on ? 'Retirer ce rôle' : 'Attribuer ce rôle') : 'Ce rôle est plus puissant que les tiens'}
                          onClick={() => toggleRole(r)}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-transparent text-fg' : 'border-dashed border-line text-muted hover:text-fg'}`}
                          style={on ? { background: `${r.color}26`, boxShadow: `inset 0 0 0 1px ${r.color}66` } : undefined}
                        >
                          <span className="size-2.5 rounded-full" style={{ background: r.color }} />
                          {r.name}
                          {on && <Icon name="check" className="size-3" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-subtle">Aucun rôle sur ce serveur. Crée-en depuis les paramètres.</p>
                )
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {roles.filter((r) => member.roles.includes(r.id)).map((r) => <RoleChip key={r.id} name={r.name} color={r.color} />)}
                  {!member.roles.length && <p className="text-sm text-subtle">Aucun rôle.</p>}
                </div>
              )}

              {(!isMe || canKick) && (
                <div className="mt-6 flex gap-2">
                  {!isMe && (
                    <button disabled={busy} onClick={() => run(async () => { await onDm(member.name); close(); })} className={`${primaryButton} flex-1`}>
                      <Icon name="message" className="size-4" /> Envoyer un message
                    </button>
                  )}
                  {!isMe && (
                    friend === 'friend' ? (
                      <span title="Vous êtes amis" className={`${ghostButton} pointer-events-none text-ok`}><Icon name="check" className="size-4" /> Ami</span>
                    ) : friend === 'outgoing' ? (
                      <span title="Demande d'ami envoyée" className={`${ghostButton} pointer-events-none opacity-60`}><Icon name="clock" className="size-4" /></span>
                    ) : (
                      <button
                        disabled={busy}
                        title={friend === 'incoming' ? "Accepter sa demande d'ami" : 'Ajouter en ami'}
                        aria-label={friend === 'incoming' ? "Accepter sa demande d'ami" : 'Ajouter en ami'}
                        onClick={friend === 'incoming' ? acceptFriend : addFriend}
                        className={ghostButton}
                      >
                        <Icon name={friend === 'incoming' ? 'check' : 'userPlus'} className="size-4" />
                      </button>
                    )
                  )}
                  {canKick && (
                    <button disabled={busy} onClick={confirmKick ? kick : () => setConfirmKick(true)} className={dangerButton}>
                      <Icon name="userMinus" className="size-4" /> {confirmKick ? 'Confirmer' : 'Exclure'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </Modal>
  );
}
