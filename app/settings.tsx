'use client';
import { useEffect, useState } from 'react';
import { errorMessage, expiresLabel, inviteUrl, type Call } from '@/lib/client';
import { INVITE_DURATIONS, PERMISSIONS, Perm, covers, has } from '@/lib/shared';
import type { Invite, Role, ServerDetail, User } from '@/lib/types';
import { dangerButton, ErrorNote, ghostButton, Icon, iconButton, inputClass, Modal, ModalHeader, primaryButton, Switch } from './ui';

type Props = { server: ServerDetail; call: Call; notify: (text: string) => void; refresh: () => Promise<void> };

const SWATCHES = ['#7c6cff', '#c26bff', '#ff6bb5', '#ff5a6a', '#ff8a3d', '#ffc83d', '#2fd27a', '#2ec5d3', '#4d8dff', '#9a9cab'];

// Jamais attendu : le presse-papiers peut rester en suspens (onglet sans focus) ou être refusé.
const copy = (code: string, notify: (text: string) => void) => {
  navigator.clipboard.writeText(inviteUrl(code)).then(
    () => notify('Lien copié dans le presse-papiers'),
    () => notify('Copie impossible : sélectionne le lien pour le copier'),
  );
};

// ---------------------------------------------------------------------------
// Paramètres du serveur : rôles et lien personnalisé
// ---------------------------------------------------------------------------
export function ServerSettings({ open, onClose, ...props }: Props & { open: boolean; onClose: () => void }) {
  const tabs = [
    has(props.server.perms, Perm.MANAGE_ROLES) && { id: 'roles', label: 'Rôles', icon: 'shield' as const },
    has(props.server.perms, Perm.MANAGE_SERVER) && { id: 'vanity', label: 'Lien personnalisé', icon: 'link' as const },
  ].filter((t) => !!t);
  const [tab, setTab] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === tab) ? tab : tabs[0]?.id;

  return (
    <Modal open={open} onClose={onClose} className="h-[min(680px,calc(100%-32px))] w-[min(920px,calc(100%-32px))]">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Paramètres du serveur</h2>
            <p className="truncate text-sm text-muted">{props.server.name}</p>
          </div>
          <nav className="flex gap-1 rounded-xl bg-ink-950/60 p-1 ring-1 ring-line">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${current === t.id ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'}`}
              >
                <Icon name={t.icon} className="size-4" /> {t.label}
              </button>
            ))}
          </nav>
          <button aria-label="Fermer" onClick={onClose} className={iconButton}><Icon name="x" className="size-4" /></button>
        </div>
        {current === 'roles' && <RolesPanel {...props} />}
        {current === 'vanity' && <VanityPanel {...props} />}
      </div>
    </Modal>
  );
}

function RolesPanel(props: Props) {
  const { server, call, notify, refresh } = props;
  const [selected, setSelected] = useState(server.roles[0].id);
  const role = server.roles.find((r) => r.id === selected) ?? server.roles[0];

  async function create() {
    try {
      const r = await call<Role>(`/servers/${server.id}/roles`, { name: 'Nouveau rôle', color: SWATCHES[0], permissions: 0 });
      await refresh();
      setSelected(r.id);
    } catch (e) {
      notify(errorMessage(e));
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3">
        <button onClick={create} className={`${ghostButton} mb-2 w-full`}><Icon name="plus" className="size-4" /> Créer un rôle</button>
        {server.roles.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${r.id === role.id ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}
          >
            <span className="size-3 shrink-0 rounded-full" style={{ background: r.is_default ? 'transparent' : r.color, boxShadow: r.is_default ? 'inset 0 0 0 1.5px var(--color-subtle)' : undefined }} />
            <span className="flex-1 truncate">{r.name}</span>
            {!r.is_default && <span className="text-xs text-subtle">{server.members.filter((m) => m.roles.includes(r.id)).length}</span>}
          </button>
        ))}
      </div>
      <RoleEditor key={role.id} role={role} {...props} onDeleted={() => setSelected(server.roles[0].id)} />
    </div>
  );
}

function RoleEditor({ role, server, call, notify, refresh, onDeleted }: Props & { role: Role; onDeleted: () => void }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [perms, setPerms] = useState(role.permissions);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = covers(server.perms, role.permissions);
  const dirty = name !== role.name || color !== role.color || perms !== role.permissions;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify(errorMessage(e)); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    await call(`/roles/${role.id}`, { name, color, permissions: perms }, 'PATCH');
    await refresh();
    notify('Rôle enregistré');
  });
  const remove = () => run(async () => {
    await call(`/roles/${role.id}`, undefined, 'DELETE');
    await refresh();
    onDeleted();
    notify(`Rôle « ${role.name} » supprimé`);
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {role.is_default && (
          <p className="rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-fg/90">
            <b>@everyone</b> s&apos;applique à tous les membres du serveur. Ce sont les permissions de base.
          </p>
        )}
        {!editable && (
          <p className="flex items-center gap-2 rounded-xl border border-err/20 bg-err/10 px-4 py-3 text-sm text-err">
            <Icon name="alert" className="size-4 shrink-0" /> Ce rôle a des permissions que tu ne possèdes pas : lecture seule.
          </p>
        )}

        {!role.is_default && (
          <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">Nom du rôle</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} disabled={!editable} className={inputClass} />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted">Couleur</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Couleur ${c}`}
                    disabled={!editable}
                    onClick={() => setColor(c)}
                    className={`size-7 rounded-lg transition hover:scale-110 disabled:cursor-not-allowed ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : ''}`}
                    style={{ background: c }}
                  />
                ))}
                <label className="relative size-7 cursor-pointer overflow-hidden rounded-lg ring-1 ring-line" title="Couleur personnalisée" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
                  <input type="color" value={color} disabled={!editable} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
              </div>
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Permissions</h3>
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {PERMISSIONS.map((p) => {
              const allowed = editable && has(server.perms, p.flag);
              return (
                <div key={p.flag} className={`flex items-center gap-4 px-4 py-3 ${p.flag === Perm.ADMINISTRATOR ? 'bg-err/[0.04]' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="text-xs text-muted">{p.description}</div>
                  </div>
                  <Switch label={p.label} checked={has(perms, p.flag)} disabled={!allowed} onChange={() => setPerms((v) => v ^ p.flag)} />
                </div>
              );
            })}
          </div>
        </div>

        {!role.is_default && editable && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-err/20 p-4">
            <div>
              <div className="text-sm font-medium">Supprimer le rôle</div>
              <div className="text-xs text-muted">Il sera retiré de tous les membres qui le possèdent.</div>
            </div>
            <button disabled={busy} onClick={confirmDelete ? remove : () => setConfirmDelete(true)} className={dangerButton}>
              <Icon name="trash" className="size-4" /> {confirmDelete ? 'Confirmer' : 'Supprimer'}
            </button>
          </div>
        )}
      </div>

      {dirty && (
        <div className="flex animate-rise items-center gap-3 border-t border-line bg-ink-950/60 px-6 py-3">
          <span className="flex-1 text-sm text-muted">Modifications non enregistrées</span>
          <button onClick={() => { setName(role.name); setColor(role.color); setPerms(role.permissions); }} className={ghostButton}>Annuler</button>
          <button disabled={busy || !name.trim()} onClick={save} className={primaryButton}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}

function VanityPanel({ server, call, notify, refresh }: Props) {
  const [value, setValue] = useState(server.vanity ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(vanity: string) {
    setBusy(true);
    setError('');
    try {
      await call(`/servers/${server.id}`, { vanity }, 'PATCH');
      await refresh();
      setValue(vanity.toLowerCase());
      notify(vanity ? 'Lien personnalisé enregistré' : 'Lien personnalisé supprimé');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl">
        <h3 className="text-base font-semibold">Lien personnalisé</h3>
        <p className="mt-1 text-sm text-muted">Une adresse mémorable et permanente pour rejoindre {server.name}. Elle n&apos;expire jamais.</p>
        <form onSubmit={(e) => { e.preventDefault(); save(value.trim()); }} className="mt-5">
          <div className="flex items-stretch overflow-hidden rounded-xl border border-line bg-ink-950/60 transition focus-within:border-accent/60 focus-within:ring-4 focus-within:ring-accent/15">
            <span className="flex items-center border-r border-line bg-white/[0.03] px-3.5 text-sm text-subtle">{location.host}/invite/</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="mon-serveur"
              maxLength={32}
              aria-label="Lien personnalisé"
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 outline-none placeholder:text-subtle"
            />
          </div>
          <p className="mt-1.5 text-xs text-subtle">3 à 32 caractères : lettres minuscules, chiffres et tirets.</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button disabled={busy || value === (server.vanity ?? '') || value.length < 3} className={primaryButton}>Enregistrer</button>
            {server.vanity && (
              <>
                <button type="button" onClick={() => copy(server.vanity!, notify)} className={ghostButton}><Icon name="copy" className="size-4" /> Copier le lien</button>
                <button type="button" disabled={busy} onClick={() => save('')} className={dangerButton}>Supprimer</button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
export function InviteDialog({ open, onClose, server, me, call, notify }: Omit<Props, 'refresh'> & { open: boolean; onClose: () => void; me: User }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [ttl, setTtl] = useState<number | null>(604_800);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCreate = has(server.perms, Perm.CREATE_INVITES);
  const canManage = has(server.perms, Perm.MANAGE_SERVER);

  useEffect(() => {
    if (!open) return;
    setFresh(null);
    setInvites(null);
    call<Invite[]>(`/servers/${server.id}/invites`).then(setInvites).catch((e) => notify(errorMessage(e)));
  }, [open, server.id]);

  async function generate() {
    setBusy(true);
    try {
      const invite = await call<Invite>(`/servers/${server.id}/invites`, { expires_in: ttl });
      setInvites((list) => [invite, ...(list ?? [])]);
      setFresh(invite.code);
      copy(invite.code, notify);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(code: string) {
    try {
      await call(`/invites/${code}`, undefined, 'DELETE');
      setInvites((list) => list?.filter((i) => i.code !== code) ?? null);
      if (fresh === code) setFresh(null);
    } catch (e) {
      notify(errorMessage(e));
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="w-[min(540px,calc(100%-32px))]">
      <ModalHeader title={`Inviter sur ${server.name}`} description="Partage un lien : il ouvre une page d'invitation pour rejoindre le serveur." onClose={onClose} />
      <div className="max-h-[70vh] space-y-6 overflow-y-auto p-6">
        {server.vanity && (
          <LinkBox label="Lien personnalisé" code={server.vanity} meta="Permanent" onCopy={() => copy(server.vanity!, notify)} />
        )}

        {canCreate && (
          <div>
            <span className="mb-2 block text-xs font-medium text-muted">Expiration du lien</span>
            <div className="flex flex-wrap gap-1.5">
              {INVITE_DURATIONS.map((d) => (
                <button
                  key={d.label}
                  onClick={() => setTtl(d.seconds)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${ttl === d.seconds ? 'bg-accent/20 text-fg ring-1 ring-accent/60' : 'bg-white/[0.04] text-muted ring-1 ring-line hover:text-fg'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <button disabled={busy} onClick={generate} className={`${primaryButton} mt-4 w-full`}>
              <Icon name="link" className="size-4" /> Générer un lien d&apos;invitation
            </button>
            {fresh && <div className="mt-3"><LinkBox label="Nouveau lien — copié !" code={fresh} highlight onCopy={() => copy(fresh, notify)} /></div>}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
            {canManage ? 'Invitations actives' : 'Tes invitations actives'}
          </h3>
          {invites === null ? (
            <div className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />
          ) : invites.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-subtle">Aucune invitation active.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {invites.map((i) => (
                <li key={i.code} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">{i.code}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                      <span className="inline-flex items-center gap-1"><Icon name="clock" className="size-3" /> {expiresLabel(i.expires_at)}</span>
                      <span>· {i.uses} utilisation{i.uses > 1 ? 's' : ''}</span>
                      <span>· par {i.creator}</span>
                    </div>
                  </div>
                  <button aria-label="Copier le lien" title="Copier le lien" onClick={() => copy(i.code, notify)} className={iconButton}><Icon name="copy" className="size-4" /></button>
                  {(canManage || i.creator === me.name) && (
                    <button aria-label="Révoquer" title="Révoquer" onClick={() => revoke(i.code)} className={`${iconButton} hover:bg-err/10 hover:text-err`}><Icon name="trash" className="size-4" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function LinkBox({ label, code, meta, highlight = false, onCopy }: { label: string; code: string; meta?: string; highlight?: boolean; onCopy: () => void }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'animate-rise border-accent/40 bg-accent/10' : 'border-line bg-ink-950/60'}`}>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold tracking-wider text-subtle uppercase">
        {label}
        {meta && <span className="normal-case tracking-normal">{meta}</span>}
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-sm text-fg">{inviteUrl(code)}</code>
        <button onClick={onCopy} className={ghostButton}><Icon name="copy" className="size-4" /> Copier</button>
      </div>
    </div>
  );
}
