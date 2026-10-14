'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, upload, type Call } from '@/lib/client';
import type { Me, Profile, Status } from '@/lib/types';
import { Avatar, avatarGradient, ErrorNote, Field, ghostButton, Icon, iconButton, inputClass, Modal, primaryButton } from './ui';

export const STATUSES: { value: Status; label: string; hint?: string; dot: string }[] = [
  { value: 'online', label: 'Connecté', dot: 'bg-ok' },
  { value: 'idle', label: 'Absent', dot: 'bg-amber-400' },
  { value: 'dnd', label: 'Occupé', hint: 'Plus aucun son de notification.', dot: 'bg-err' },
  { value: 'invisible', label: 'Invisible', hint: 'Tu apparais hors ligne, mais tu gardes accès à tout.', dot: 'bg-subtle' },
];

const BANNER_COLORS = ['#7c6cff', '#c26bff', '#ff6bb5', '#ff5a6a', '#ff8a3d', '#ffc83d', '#2fd27a', '#2ec5d3', '#4d8dff', '#23252f'];

export const bannerUrl = (id: number, version: number) => `/api/users/${id}/banner?v=${version}`;

/** Bannière : image si elle existe, sinon couleur choisie, sinon dégradé dérivé du pseudo. */
export function Banner({ profile, className }: { profile: Pick<Profile, 'id' | 'name' | 'banner' | 'banner_color'>; className: string }) {
  const style = profile.banner
    ? { backgroundImage: `url(${bannerUrl(profile.id, profile.banner)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: profile.banner_color ?? avatarGradient(profile.name) };
  return <div className={className} style={style} />;
}

/** Redimensionne une image (recadrage centré) et l'encode en WebP (PNG si le navigateur ne sait pas encoder le WebP). */
export async function resizeImage(file: File, width: number, height: number): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image');
  if (file.size > 15 * 1024 * 1024) throw new Error('Image trop lourde (15 Mo maximum)');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Image illisible'); });
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (!blob) throw new Error("Impossible de convertir l'image");
  return blob;
}

// ---------------------------------------------------------------------------
// Menu de statut (clic sur sa carte en bas à gauche)
// ---------------------------------------------------------------------------
export function StatusMenu({ me, onStatus, onEditProfile, onCopyId, onClose }: {
  me: Me; onStatus: (status: Status) => void; onEditProfile: () => void; onCopyId: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Au prochain tour : le clic qui ouvre le menu ne doit pas le refermer.
    const id = setTimeout(() => document.addEventListener('mousedown', away));
    document.addEventListener('keydown', esc);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, []);

  return (
    <div ref={ref} role="menu" className="absolute bottom-full left-0 z-40 mb-2 w-full animate-rise overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-2xl shadow-black/60">
      <Banner profile={me} className="h-16" />
      <div className="px-4 pb-3">
        <Avatar user={me} status={me.status} ring="border-ink-900" className="-mt-8 size-16 text-xl ring-4 ring-ink-900" />
        <div className="mt-2 truncate font-semibold">{me.name}<span className="font-normal text-subtle">#{me.tag}</span></div>
        {me.bio && <p className="mt-1 line-clamp-3 text-xs whitespace-pre-wrap text-muted">{me.bio}</p>}
      </div>
      <div className="border-t border-line p-1.5">
        {STATUSES.map((s) => (
          <button key={s.value} role="menuitemradio" aria-checked={me.status === s.value} onClick={() => onStatus(s.value)} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.05]">
            <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${s.dot}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{s.label}</span>
              {s.hint && <span className="block text-xs text-muted">{s.hint}</span>}
            </span>
            {me.status === s.value && <Icon name="check" className="mt-0.5 size-4 shrink-0 text-accent" />}
          </button>
        ))}
      </div>
      <div className="border-t border-line p-1.5">
        <MenuButton icon="settings" onClick={onEditProfile}>Modifier le profil</MenuButton>
        <MenuButton icon="copy" onClick={onCopyId}>Copier mon identifiant</MenuButton>
      </div>
    </div>
  );
}

function MenuButton({ icon, onClick, children }: { icon: 'settings' | 'copy'; onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-white/[0.05]">
      <Icon name={icon} className="size-4 text-muted" /> {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Mon compte : profil et sécurité
// ---------------------------------------------------------------------------
type Tab = 'profile' | 'security';

export function ProfileDialog({ open, onClose, me, token, call, notify, reload }: {
  open: boolean; onClose: () => void; me: Me; token: string; call: Call; notify: (text: string) => void; reload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <Modal open={open} onClose={onClose} className="h-[min(680px,calc(100%-32px))] w-[min(900px,calc(100%-32px))]">
      <div className="flex h-full">
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-ink-950/40 p-3">
          <h2 className="mb-3 px-2.5 pt-1 text-xs font-semibold tracking-wider text-subtle uppercase">Mon compte</h2>
          <TabButton icon="users" active={tab === 'profile'} onClick={() => setTab('profile')}>Profil</TabButton>
          <TabButton icon="shield" active={tab === 'security'} onClick={() => setTab('security')}>Sécurité</TabButton>
        </nav>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button aria-label="Fermer" onClick={onClose} className={`${iconButton} absolute top-4 right-4 z-10`}><Icon name="x" className="size-4" /></button>
          {tab === 'profile'
            ? <ProfileTab me={me} token={token} call={call} notify={notify} reload={reload} />
            : <SecurityTab call={call} notify={notify} />}
        </div>
      </div>
    </Modal>
  );
}

function ProfileTab({ me, token, call, notify, reload }: { me: Me; token: string; call: Call; notify: (text: string) => void; reload: () => Promise<void> }) {
  const [name, setName] = useState(me.name);
  const [bio, setBio] = useState(me.bio);
  const [color, setColor] = useState(me.banner_color);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'avatar' | 'banner' | 'save' | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const dirty = name !== me.name || bio !== me.bio || color !== me.banner_color;
  const preview = { ...me, name: name || me.name, bio, banner_color: color };

  async function run(kind: 'avatar' | 'banner' | 'save', fn: () => Promise<unknown>, done?: string) {
    setBusy(kind);
    setError('');
    try {
      await fn();
      await reload();
      if (done) notify(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const pick = (kind: 'avatar' | 'banner') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    run(kind, async () => {
      const blob = kind === 'avatar' ? await resizeImage(file, 256, 256) : await resizeImage(file, 960, 384);
      await upload(token, `/me/${kind}`, blob);
    }, kind === 'avatar' ? 'Photo de profil mise à jour' : 'Bannière mise à jour');
  };

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    run('save', () => call('/me', { name: name.trim(), bio, banner_color: color }, 'PATCH'), 'Profil enregistré');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-8">
        <h2 className="text-xl font-bold tracking-tight">Profil</h2>
        <p className="mt-1 text-sm text-muted">Ce que les autres voient de toi.</p>
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_280px]">
          <form onSubmit={save} className="space-y-6">
            <input ref={avatarInput} type="file" accept="image/*" hidden onChange={pick('avatar')} />
            <input ref={bannerInput} type="file" accept="image/*" hidden onChange={pick('banner')} />

            <section>
              <Label>Photo de profil</Label>
              <div className="flex items-center gap-3">
                <Avatar user={me} className="size-14 text-lg" />
                <button type="button" disabled={!!busy} onClick={() => avatarInput.current?.click()} className={primaryButton}>
                  {busy === 'avatar' ? 'Envoi…' : 'Changer la photo'}
                </button>
                {me.avatar > 0 && (
                  <button type="button" disabled={!!busy} onClick={() => run('avatar', () => call('/me/avatar', undefined, 'DELETE'), 'Photo retirée')} className={ghostButton}>Retirer</button>
                )}
              </div>
              <p className="mt-2 text-xs text-subtle">JPG, PNG, WebP ou GIF. Recadrée en carré 256 px.</p>
            </section>

            <section>
              <Label>Bannière</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  title="Couleur automatique"
                  onClick={() => setColor(null)}
                  className={`size-7 rounded-lg transition hover:scale-110 ${color === null ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : ''}`}
                  style={{ background: avatarGradient(me.name) }}
                />
                {BANNER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Couleur ${c}`}
                    onClick={() => setColor(c)}
                    className={`size-7 rounded-lg transition hover:scale-110 ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : ''}`}
                    style={{ background: c }}
                  />
                ))}
                <label className="relative size-7 cursor-pointer overflow-hidden rounded-lg ring-1 ring-line" title="Couleur personnalisée" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
                  <input type="color" value={color ?? '#7c6cff'} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => bannerInput.current?.click()} className={ghostButton}>
                  <Icon name="plus" className="size-4" /> {busy === 'banner' ? 'Envoi…' : me.banner ? "Changer l'image" : 'Ajouter une image'}
                </button>
                {me.banner > 0 && (
                  <button type="button" disabled={!!busy} onClick={() => run('banner', () => call('/me/banner', undefined, 'DELETE'), 'Image de bannière retirée')} className={ghostButton}>Retirer l&apos;image</button>
                )}
              </div>
              <p className="mt-2 text-xs text-subtle">L&apos;image remplace la couleur. Recadrée en 960 × 384 px.</p>
            </section>

            <Field label={`Pseudo (ton identifiant devient ${name || '…'}#${me.tag})`} value={name} onChange={(e) => setName(e.target.value)} maxLength={32} autoComplete="off" />

            <label className="block">
              <span className="mb-1.5 flex justify-between text-xs font-medium text-muted">À propos de moi<span className="tabular-nums">{bio.length}/190</span></span>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} rows={4} placeholder="Quelques mots sur toi…" className={`${inputClass} resize-none`} />
            </label>

            {error && <ErrorNote>{error}</ErrorNote>}
          </form>

          <div>
            <Label>Aperçu</Label>
            <div className="overflow-hidden rounded-2xl border border-line bg-ink-950 shadow-xl">
              <Banner profile={preview} className="h-24" />
              <div className="px-4 pb-4">
                <Avatar user={me} status={me.status} ring="border-ink-950" className="-mt-10 size-20 text-2xl ring-[6px] ring-ink-950" />
                <div className="mt-2 text-lg font-bold">{preview.name}<span className="text-sm font-medium text-subtle">#{me.tag}</span></div>
                {bio ? (
                  <>
                    <div className="mt-3 mb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">À propos</div>
                    <p className="text-sm break-words whitespace-pre-wrap text-fg/90">{bio}</p>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-subtle italic">Pas encore de bio.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {dirty && (
        <div className="flex animate-rise items-center gap-3 border-t border-line bg-ink-950/60 px-8 py-3">
          <span className="flex-1 text-sm text-muted">Modifications non enregistrées</span>
          <button onClick={() => { setName(me.name); setBio(me.bio); setColor(me.banner_color); }} className={ghostButton}>Annuler</button>
          <button disabled={!!busy || name.trim().length < 2} onClick={() => save()} className={primaryButton}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}

function SecurityTab({ call, notify }: { call: Call; notify: (text: string) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError('');
    if (f.get('next') !== f.get('confirm')) return setError('Les deux nouveaux mots de passe ne correspondent pas');
    setBusy(true);
    try {
      const { signed_out } = await call<{ signed_out: number }>('/me/password', { current: f.get('current'), next: f.get('next') });
      form.reset();
      notify(signed_out ? `Mot de passe modifié · ${signed_out} autre${signed_out > 1 ? 's' : ''} appareil${signed_out > 1 ? 's' : ''} déconnecté${signed_out > 1 ? 's' : ''}` : 'Mot de passe modifié');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="text-xl font-bold tracking-tight">Sécurité</h2>
      <p className="mt-1 text-sm text-muted">Change ton mot de passe. Tes autres appareils seront déconnectés.</p>
      <form onSubmit={submit} className="mt-6 max-w-md space-y-4">
        <Field label="Mot de passe actuel" name="current" type="password" autoComplete="current-password" required />
        <Field label="Nouveau mot de passe" name="next" type="password" autoComplete="new-password" minLength={8} required hint="8 caractères minimum." />
        <Field label="Confirmer le nouveau mot de passe" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button disabled={busy} className={primaryButton}>{busy ? 'Un instant…' : 'Changer le mot de passe'}</button>
      </form>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="mb-2 block text-xs font-medium text-muted">{children}</span>;
}

function TabButton({ icon, active, onClick, children }: { icon: 'users' | 'shield'; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${active ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}>
      <Icon name={icon} className="size-4" /> {children}
    </button>
  );
}

