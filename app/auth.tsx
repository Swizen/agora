'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/client';
import { ErrorNote, Field, Logo, primaryButton } from './ui';

/** Token de session stocké dans le navigateur ; `undefined` tant qu'il n'est pas lu. */
export function useToken() {
  const [token, setToken] = useState<string | null>();
  useEffect(() => setToken(localStorage.getItem('token')), []);
  return {
    token,
    login: (t: string) => { localStorage.setItem('token', t); setToken(t); },
    logout: () => { localStorage.removeItem('token'); setToken(null); },
  };
}

/** Fond commun des pages plein écran (connexion, invitation). */
export function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-full place-items-center overflow-hidden p-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-48 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-accent/25 blur-[120px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-48 size-[420px] rounded-full bg-accent-2/15 blur-[120px]" />
      <section className="relative w-full max-w-[400px] animate-rise">{children}</section>
    </main>
  );
}

export function AuthForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      onLogin((await api<{ token: string }>(null, '/' + mode, { name: f.get('name'), pass: f.get('pass') })).token);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <Field label="Pseudo" name="name" placeholder="ton_pseudo" autoComplete="username" required autoFocus />
        <Field
          label="Mot de passe"
          name="pass"
          type="password"
          placeholder="••••••••"
          autoComplete={register ? 'new-password' : 'current-password'}
          hint={register ? '8 caractères minimum.' : undefined}
          required
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button disabled={busy} className={`${primaryButton} w-full py-3`}>
          {busy ? 'Un instant…' : register ? 'Créer mon compte' : 'Se connecter'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {register ? 'Déjà inscrit ?' : 'Pas encore de compte ?'}{' '}
        <button type="button" onClick={() => { setMode(register ? 'login' : 'register'); setError(''); }} className="font-medium text-fg transition hover:text-accent">
          {register ? 'Se connecter' : 'Créer un compte'}
        </button>
      </p>
    </>
  );
}

export function AuthScreen({ onLogin }: { onLogin: (token: string) => void }) {
  return (
    <Backdrop>
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo className="size-14" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Bienvenue sur Agora</h1>
        <p className="mt-1.5 text-sm text-muted">Connecte-toi ou crée ton compte en quelques secondes.</p>
      </div>
      <AuthForm onLogin={onLogin} />
    </Backdrop>
  );
}
