'use client';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { errorMessage } from '@/lib/client';
import type { Presence } from '@/lib/types';

// --- Styles partagés ---
export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-br from-accent to-accent-2 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-[.98] disabled:opacity-50';
export const ghostButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-fg/90 transition hover:bg-white/[0.07] active:scale-[.98] disabled:opacity-50';
export const dangerButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-err/30 bg-err/10 px-3.5 py-2 text-sm font-medium text-err transition hover:bg-err/20 active:scale-[.98] disabled:opacity-50';
export const iconButton = 'grid size-8 place-items-center rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-fg';
export const inputClass =
  'w-full rounded-xl border border-line bg-ink-950/60 px-3.5 py-2.5 outline-none transition placeholder:text-subtle focus:border-accent/60 focus:ring-4 focus:ring-accent/15 disabled:opacity-60';

// --- Icônes (tracés Lucide, ISC) ---
const paths = {
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  plus: 'M12 5v14M5 12h14',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  send: 'M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11zM21.85 2.15 10.91 13.09',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  userPlus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM19 8v6M22 11h-6',
  userMinus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM22 11h-6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  crown: 'M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.29l4.27-3.66a.5.5 0 0 1 .82.5l-2.83 10.25a1 1 0 0 1-.97.75H5.81a1 1 0 0 1-.97-.75L2.02 6a.5.5 0 0 1 .82-.5l4.27 3.66a1 1 0 0 0 1.52-.29zM5 21h14',
  alert: 'M12 8v4M12 16h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  message: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  settings:
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  x: 'M18 6 6 18M6 6l12 12',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  check: 'M20 6 9 17l-5-5',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94',
  volume: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6M19.364 18.364a9 9 0 0 0 0-12.728',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  micOff: 'M2 2l20 20M18.89 13.23A7.12 7.12 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12M12 19v3',
  headphones: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
  headphonesOff: 'M21 14h-1.343M9.128 3.47A9 9 0 0 1 21 12v3.343M2 2l20 20M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364',
  video: 'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  videoOff: 'M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M2 2l20 20',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  signal: 'M2 20h.01M7 20v-4M12 20v-8M17 20V8',
  keyboard: 'M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  phone: 'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384',
  bell: 'M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
  bellOff: 'M10.268 21a2 2 0 0 0 3.464 0M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742M2 2l20 20M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05',
  phoneOff: 'M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2C10.059 22 2 13.941 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473M22 2 2 22',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={paths[name]} />
    </svg>
  );
}

export function Logo({ className = 'size-12' }: { className?: string }) {
  return (
    <div className={`grid shrink-0 place-items-center rounded-2xl bg-linear-to-br from-accent to-accent-2 text-white shadow-lg shadow-accent/30 ${className}`}>
      <Icon name="message" className="size-1/2" />
    </div>
  );
}

// --- Avatars : couleur stable dérivée du pseudo ---
export const hue = (name: string) => [...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
export const nameColor = (name: string) => `hsl(${hue(name)} 85% 78%)`;
export const avatarGradient = (name: string) => {
  const h = hue(name);
  return `linear-gradient(135deg, hsl(${h} 75% 60%), hsl(${(h + 50) % 360} 70% 42%))`;
};

export const avatarUrl = (id: number, version: number) => `/api/users/${id}/avatar?v=${version}`;

/** Ce qu'il faut pour afficher un avatar : la photo si elle existe, sinon l'initiale sur un dégradé. */
export type AvatarUser = { id?: number; name: string; avatar?: number };

const STATUS_DOT: Record<Presence | 'invisible', string> = {
  online: 'bg-ok',
  idle: 'bg-amber-400',
  dnd: 'bg-err',
  offline: 'bg-subtle',
  invisible: 'bg-subtle',
};

export function Avatar({ user, status, className = 'size-10 text-sm', ring = 'border-ink-900' }: {
  user: AvatarUser;
  status?: Presence | 'invisible'; // pastille de statut
  className?: string;
  ring?: string;                   // couleur du contour de la pastille (= fond derrière l'avatar)
}) {
  return (
    <span aria-hidden="true" className={`relative inline-grid aspect-square shrink-0 rounded-full ${className}`}>
      {user.id && user.avatar ? (
        <img src={avatarUrl(user.id, user.avatar)} alt="" draggable={false} className="aspect-square size-full rounded-full object-cover ring-1 ring-white/10" />
      ) : (
        <span className="grid size-full place-items-center rounded-full font-semibold text-white ring-1 ring-white/10" style={{ background: avatarGradient(user.name) }}>
          {user.name[0]?.toUpperCase()}
        </span>
      )}
      {status && <span className={`absolute -right-0.5 -bottom-0.5 size-[36%] min-h-2.5 min-w-2.5 rounded-full border-2 ${ring} ${STATUS_DOT[status]}`} />}
    </span>
  );
}

// --- Formulaires ---
export function Field({ label, hint, ...props }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <input {...props} className={inputClass} />
      {hint && <span className="mt-1.5 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-ink-700'}`}
    >
      <span className={`absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-err/20 bg-err/10 px-3 py-2 text-sm text-err">
      <Icon name="alert" className="size-4 shrink-0" />
      {children}
    </p>
  );
}

// --- Modales (élément <dialog> natif : focus, Échap et arrière-plan gérés par le navigateur) ---
export function Modal({ open, onClose, className = 'w-[min(440px,calc(100%-32px))]', children }: {
  open: boolean; onClose: () => void; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className={`m-auto max-h-[calc(100%-32px)] overflow-hidden rounded-2xl border border-line bg-ink-900 p-0 text-fg shadow-2xl shadow-black/60 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-rise ${className}`}
    >
      {open && children}
    </dialog>
  );
}

export function ModalHeader({ title, description, onClose }: { title: string; description?: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-4 p-6 pb-0">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <button type="button" aria-label="Fermer" onClick={onClose} className={`${iconButton} -mt-1 -mr-2`}><Icon name="x" className="size-4" /></button>
    </div>
  );
}

// --- Modale de saisie (remplace prompt()) ---
export type PromptConfig = {
  title: string;
  description: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<unknown>;
};

export function PromptDialog({ config, onClose }: { config: PromptConfig | null; onClose: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(''), [config]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get('value') ?? '').trim();
    if (!value || !config) return;
    setBusy(true);
    try {
      await config.onSubmit(value);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!config} onClose={onClose}>
      {config && (
        <form key={config.title} onSubmit={submit}>
          <ModalHeader title={config.title} description={config.description} onClose={onClose} />
          <div className="p-6">
            <Field label={config.label} name="value" placeholder={config.placeholder} autoComplete="off" autoFocus required maxLength={200} />
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={ghostButton}>Annuler</button>
              <button disabled={busy} className={primaryButton}>{config.submitLabel}</button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Pastille de rôle : point coloré + nom. */
export function RoleChip({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white/[0.04] px-2 py-0.5 text-xs font-medium">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      {name}
      {onRemove && (
        <button type="button" aria-label={`Retirer ${name}`} onClick={onRemove} className="-mr-0.5 text-subtle hover:text-fg">
          <Icon name="x" className="size-3" />
        </button>
      )}
    </span>
  );
}

export const serverInitials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// --- Menus contextuels (clic droit) ---
export function PopupMenu({ x, y, onClose, className = 'w-64', children }: { x: number; y: number; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Reste dans la fenêtre.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setPos({ left: Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) });
  }, [x, y]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', onClose);
    };
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={pos}
      className={`fixed z-50 animate-rise overflow-hidden rounded-xl border border-line bg-ink-900/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

export function MenuItem({ icon, danger = false, onClick, children }: { icon: IconName; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${danger ? 'text-err hover:bg-err/10' : 'hover:bg-white/[0.06]'}`}>
      <Icon name={icon} className="size-4 shrink-0 opacity-80" /> {children}
    </button>
  );
}

export function MenuCheck({ checked, danger = false, onClick, children }: { checked: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitemcheckbox" aria-checked={checked} onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${danger ? 'text-err hover:bg-err/10' : 'hover:bg-white/[0.06]'}`}>
      <span className="flex-1">{children}</span>
      <span className={`grid size-4 place-items-center rounded border ${checked ? (danger ? 'border-err bg-err text-white' : 'border-accent bg-accent text-white') : 'border-line'}`}>
        {checked && <Icon name="check" className="size-3" />}
      </span>
    </button>
  );
}
