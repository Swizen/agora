'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, type Call } from '@/lib/client';
import type { Friends, Me, Presence, User } from '@/lib/types';
import { Avatar, ErrorNote, ghostButton, Icon, iconButton, primaryButton } from './ui';

export const userId = (u: User) => `${u.name}#${u.tag}`;

/** Statut d'amitié vu depuis l'utilisateur courant. */
export function friendStatus(friends: Friends, id: number) {
  if (friends.friends.some((u) => u.id === id)) return 'friend';
  if (friends.incoming.some((u) => u.id === id)) return 'incoming';
  if (friends.outgoing.some((u) => u.id === id)) return 'outgoing';
  return null;
}

type Tab = 'all' | 'pending' | 'add';

export function FriendsPanel({ me, friends, presence, call, notify, onMessage, empty }: {
  me: Me;
  friends: Friends;
  presence: Record<number, Presence>;
  call: Call;
  notify: (text: string) => void;
  onMessage: (name: string) => Promise<void>;
  empty?: ReactNode; // actions supplémentaires quand on n'a encore personne
}) {
  // Tant que l'utilisateur n'a pas choisi, l'onglet suit les données (elles arrivent après le premier rendu).
  const [chosen, setTab] = useState<Tab | null>(null);
  const tab = chosen ?? (friends.incoming.length ? 'pending' : friends.friends.length ? 'all' : 'add');
  const [confirm, setConfirm] = useState<number | null>(null);
  const pending = friends.incoming.length + friends.outgoing.length;

  const run = (fn: () => Promise<unknown>) => () => { fn().catch((e) => notify(errorMessage(e))); };
  const accept = (u: User) => run(async () => { await call(`/friends/${u.id}`, {}); notify(`Tu es maintenant ami avec ${u.name}`); });
  const remove = (u: User) => run(async () => { await call(`/friends/${u.id}`, undefined, 'DELETE'); setConfirm(null); });

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <Icon name="users" className="size-5 text-subtle" />
        <h1 className="mr-3 font-semibold">Amis</h1>
        <span className="h-5 w-px bg-line" />
        <nav className="flex items-center gap-1">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>Tous</TabButton>
          <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
            En attente
            {friends.incoming.length > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-err px-1 text-[10px] font-bold text-white">{friends.incoming.length}</span>
            )}
          </TabButton>
        </nav>
        <button
          onClick={() => setTab('add')}
          className={`ml-2 rounded-lg px-3 py-1 text-sm font-semibold transition ${tab === 'add' ? 'bg-ok/15 text-ok' : 'bg-ok text-ink-950 hover:brightness-110'}`}
        >
          Ajouter un ami
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {tab === 'add' && <AddFriend me={me} call={call} notify={notify} />}

        {tab === 'all' && (
          friends.friends.length ? (
            <Section title={`Tous les amis — ${friends.friends.length}`}>
              {friends.friends.map((u) => (
                <Row key={u.id} user={u} presence={presence}>
                  <RoundAction label="Envoyer un message" icon="message" onClick={run(() => onMessage(u.name))} />
                  {confirm === u.id ? (
                    <button onClick={remove(u)} className="rounded-lg bg-err/15 px-2.5 py-1 text-xs font-semibold text-err transition hover:bg-err/25">Retirer ?</button>
                  ) : (
                    <RoundAction label="Retirer des amis" icon="userMinus" danger onClick={() => setConfirm(u.id)} />
                  )}
                </Row>
              ))}
            </Section>
          ) : (
            <Empty title="Pas encore d'amis" text="Ajoute quelqu'un avec son identifiant pour discuter en privé, même sans serveur en commun.">
              <button onClick={() => setTab('add')} className={primaryButton}><Icon name="userPlus" className="size-4" /> Ajouter un ami</button>
              {empty}
            </Empty>
          )
        )}

        {tab === 'pending' && (
          pending ? (
            <>
              {friends.incoming.length > 0 && (
                <Section title={`Reçues — ${friends.incoming.length}`}>
                  {friends.incoming.map((u) => (
                    <Row key={u.id} user={u} presence={presence} subtitle="Demande d'ami reçue">
                      <RoundAction label="Accepter" icon="check" positive onClick={accept(u)} />
                      <RoundAction label="Refuser" icon="x" danger onClick={remove(u)} />
                    </Row>
                  ))}
                </Section>
              )}
              {friends.outgoing.length > 0 && (
                <Section title={`Envoyées — ${friends.outgoing.length}`}>
                  {friends.outgoing.map((u) => (
                    <Row key={u.id} user={u} presence={presence} subtitle="Demande d'ami envoyée">
                      <RoundAction label="Annuler la demande" icon="x" danger onClick={remove(u)} />
                    </Row>
                  ))}
                </Section>
              )}
            </>
          ) : (
            <Empty title="Aucune demande en attente" text="Les demandes d'ami que tu reçois et envoies apparaîtront ici." />
          )
        )}
      </div>
    </>
  );
}

function AddFriend({ me, call, notify }: { me: Me; call: Call; notify: (text: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = userId(me);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await call<{ status: 'pending' | 'accepted'; user: User }>('/friends', { tag: value.trim() });
      notify(res.status === 'accepted' ? `Tu es maintenant ami avec ${res.user.name}` : `Demande envoyée à ${userId(res.user)}`);
      setValue('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const copyMine = () => {
    navigator.clipboard.writeText(mine).then(() => notify('Identifiant copié'), () => notify('Copie impossible'));
  };

  return (
    <div className="max-w-2xl animate-rise">
      <h2 className="text-xl font-bold tracking-tight">Ajouter un ami</h2>
      <p className="mt-1 text-sm text-muted">Saisis l&apos;identifiant Agora de ton ami, au format <span className="font-mono text-fg">pseudo#1234</span>.</p>
      <form onSubmit={submit} className="mt-5">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-ink-950/60 p-2 pl-4 transition focus-within:border-accent/60 focus-within:ring-4 focus-within:ring-accent/15">
          <Icon name="at" className="size-5 shrink-0 text-subtle" />
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            placeholder="geeklegend#100"
            aria-label="Identifiant de ton ami"
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-1.5 outline-none placeholder:text-subtle"
          />
          <button disabled={busy || !/^.+#\d{1,4}$/.test(value.trim())} className={primaryButton}>Envoyer la demande</button>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>

      <div className="mt-8 flex items-center gap-4 rounded-2xl border border-line bg-linear-to-br from-accent/10 to-accent-2/5 p-5">
        <Avatar user={me} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold tracking-wider text-subtle uppercase">Ton identifiant</div>
          <div className="mt-0.5 truncate text-lg font-semibold">
            {me.name}<span className="text-muted">#{me.tag}</span>
          </div>
          <div className="text-xs text-muted">Partage-le pour qu&apos;on puisse t&apos;ajouter en ami.</div>
        </div>
        <button onClick={copyMine} className={ghostButton}><Icon name="copy" className="size-4" /> Copier</button>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium transition ${active ? 'bg-white/[0.08] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}>
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">{title}</h3>
      <div className="divide-y divide-line border-t border-line">{children}</div>
    </section>
  );
}

function Row({ user, presence, subtitle, children }: { user: User; presence: Record<number, Presence>; subtitle?: string; children: ReactNode }) {
  return (
    <div className="group -mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.03]">
      <Avatar user={user} status={presence[user.id] ?? 'offline'} className="size-9 text-xs" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">
          {user.name}<span className="font-normal text-subtle opacity-0 transition group-hover:opacity-100">#{user.tag}</span>
        </div>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function RoundAction({ label, icon, onClick, danger = false, positive = false }: {
  label: string; icon: 'message' | 'userMinus' | 'check' | 'x'; onClick: () => void; danger?: boolean; positive?: boolean;
}) {
  const tone = danger ? 'hover:text-err' : positive ? 'hover:text-ok' : 'hover:text-fg';
  return (
    <button aria-label={label} title={label} onClick={onClick} className={`${iconButton} size-9 rounded-full bg-ink-800 ${tone}`}>
      <Icon name={icon} className="size-4" />
    </button>
  );
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-[60%] place-items-center">
      <div className="max-w-sm animate-rise text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-linear-to-br from-accent/30 to-accent-2/20 ring-1 ring-white/10">
          <Icon name="users" className="size-8" />
        </div>
        <h2 className="mt-5 text-xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1.5 text-sm text-muted">{text}</p>
        {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
      </div>
    </div>
  );
}
