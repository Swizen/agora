'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, errorMessage, expiresLabel, lastView } from '@/lib/client';
import type { InvitePreview, ServerSummary } from '@/lib/types';
import { AuthForm, Backdrop, useToken } from '../../auth';
import { avatarGradient, Icon, primaryButton, serverInitials } from '../../ui';

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { token, login } = useToken();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InvitePreview>(null, `/invites/${encodeURIComponent(code)}`).then(setPreview).catch((e) => setError(errorMessage(e)));
  }, [code]);

  async function accept() {
    setBusy(true);
    try {
      const server = await api<ServerSummary>(token!, `/invites/${encodeURIComponent(code)}`, {});
      lastView.set(String(server.id));
      router.push('/');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Backdrop>
      {error ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-err/10 text-err ring-1 ring-err/20"><Icon name="alert" className="size-7" /></div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Invitation indisponible</h1>
          <p className="mt-1.5 text-sm text-muted">{error}</p>
          <a href="/" className={`${primaryButton} mt-6`}>Retour à Agora</a>
        </div>
      ) : !preview ? (
        <div className="h-72 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" />
      ) : (
        <>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center shadow-2xl shadow-black/50 backdrop-blur-xl">
            <div
              className="mx-auto grid size-20 place-items-center rounded-3xl text-2xl font-bold text-white shadow-xl ring-1 ring-white/10"
              style={{ background: avatarGradient(preview.server.name) }}
            >
              {serverInitials(preview.server.name)}
            </div>
            <p className="mt-6 text-sm text-muted">Tu as été invité à rejoindre</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{preview.server.name}</h1>
            <div className="mt-3 flex items-center justify-center gap-4 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-ok" /> {preview.server.members} membre{preview.server.members > 1 ? 's' : ''}</span>
              <span className="inline-flex items-center gap-1.5"><Icon name="clock" className="size-3.5" /> {expiresLabel(preview.expires_at)}</span>
            </div>
            {token && (
              <button disabled={busy} onClick={accept} className={`${primaryButton} mt-7 w-full py-3`}>
                {busy ? 'Un instant…' : "Accepter l'invitation"}
              </button>
            )}
            {token === null && <p className="mt-6 text-sm text-muted">Connecte-toi ou crée un compte pour rejoindre le serveur.</p>}
          </div>
          {token === null && <div className="mt-6"><AuthForm onLogin={login} /></div>}
        </>
      )}
    </Backdrop>
  );
}
