'use client';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { errorMessage, type Call } from '@/lib/client';
import { Perm, covers, has, memberPerms } from '@/lib/shared';
import type { Channel, ServerDetail, User, VoiceParticipant } from '@/lib/types';
import { VoiceClient } from '@/lib/voice';
import { Avatar, avatarGradient, Icon, iconButton, MenuCheck, MenuItem, MenuSeparator, PopupMenu, primaryButton } from './ui';

/** Une instance de VoiceClient par session ; le composant se redessine à chaque changement d'état. */
export function useVoice(call: Call, notify: (text: string) => void) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const clientId = useRef<string | null>(null);
  const voice = useRef<VoiceClient>(null);
  voice.current ??= new VoiceClient({ call, clientId: () => clientId.current, onChange: rerender, onError: notify });
  useEffect(() => {
    const detach = voice.current!.attachKeyboard();
    return () => { detach(); voice.current?.leave(); };
  }, []);
  return { voice: voice.current, clientId };
}

/** « KeyV » → « V », « Space » → « Espace »… */
export const keyLabel = (code: string) =>
  ({ Space: 'Espace', Backquote: '²', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droit', AltLeft: 'Alt', CapsLock: 'Verr. Maj' } as Record<string, string>)[code]
  ?? code.replace(/^Key|^Digit|^Numpad/, '');

function statusOf(voice: VoiceClient) {
  if (voice.state === 'joining') return { text: 'Connexion…', tone: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' };
  const states = [...voice.peerStates.values()];
  if (states.includes('failed')) return { text: 'Connexion difficile', tone: 'text-err', dot: 'bg-err' };
  if (states.some((s) => s === 'new' || s === 'connecting')) return { text: 'Connexion aux participants…', tone: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' };
  return { text: 'Connecté', tone: 'text-ok', dot: 'bg-ok shadow-[0_0_8px] shadow-ok' };
}

function qualityOf(voice: VoiceClient) {
  const q = voice.quality;
  if (!q) return null;
  const tone = q.rtt < 120 && q.loss < 0.02 ? 'text-ok' : q.rtt < 250 && q.loss < 0.08 ? 'text-amber-400' : 'text-err';
  const detail = `Ping ${q.rtt} ms · pertes ${(q.loss * 100).toFixed(1)} %`;
  return { tone, label: `${q.rtt} ms`, detail };
}

/** Avatar entouré d'un anneau vert quand la personne parle. */
function SpeakingAvatar({ user, speaking, className }: { user: User; speaking: boolean; className: string }) {
  return (
    // inline-grid + shrink-0 : la bulle garde sa taille (et reste ronde) dans une ligne étroite.
    <span className={`inline-grid shrink-0 rounded-full transition-shadow duration-150 ${speaking ? 'shadow-[0_0_0_2px_var(--color-ink-900),0_0_0_4px_var(--color-ok)]' : ''}`}>
      <Avatar user={user} className={className} />
    </span>
  );
}

function FlagIcons({ p, voice }: { p: VoiceParticipant; voice: VoiceClient }) {
  const localMuted = p.client_id !== voice.selfId && !!voice.settings.userMuted[p.user.id];
  return (
    <>
      {p.video && <Icon name="video" className="size-3.5 shrink-0 text-muted" />}
      {p.server_muted && <span title="Rendu muet par un modérateur" className="shrink-0 text-err"><Icon name="shield" className="size-3.5" /></span>}
      {localMuted && <span title="Rendu muet pour toi" className="shrink-0 text-err"><Icon name="volume" className="size-3.5" /></span>}
      {p.deafened ? <Icon name="headphonesOff" className="size-3.5 shrink-0 text-err" /> : p.muted && <Icon name="micOff" className="size-3.5 shrink-0 text-err" />}
    </>
  );
}

/** Ouvre le menu d'un participant (clic droit sur sa tuile ou sur son nom dans la liste des salons). */
export type OpenParticipantMenu = (p: VoiceParticipant, x: number, y: number) => void;

export function VoiceChannelItem({ channel, participants, active, voice, onClick, onMenu }: {
  channel: Channel; participants: VoiceParticipant[]; active: boolean; voice: VoiceClient; onClick: () => void; onMenu: OpenParticipantMenu;
}) {
  const here = voice.channelId === channel.id;
  return (
    <div>
      <button
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition ${active ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}
      >
        <Icon name="volume" className={`size-4 shrink-0 ${here ? 'text-ok' : active ? 'text-accent' : 'opacity-60'}`} />
        <span className="flex-1 truncate text-left">{channel.name}</span>
      </button>
      {participants.length > 0 && (
        <ul className="mt-0.5 mb-1 ml-6 space-y-0.5">
          {participants.map((p) => (
            <li
              key={p.client_id}
              onContextMenu={(e) => { e.preventDefault(); onMenu(p, e.clientX, e.clientY); }}
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-sm text-muted transition hover:bg-white/[0.04]"
            >
              <SpeakingAvatar user={p.user} speaking={voice.speaking.has(p.client_id)} className="size-6 text-[10px]" />
              <span className={`flex-1 truncate ${voice.speaking.has(p.client_id) ? 'text-fg' : ''}`}>{p.user.name}</span>
              <FlagIcons p={p} voice={voice} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Panneau « vocal connecté » au-dessus de la carte utilisateur. */
export function VoicePanel({ voice, onOpen, onSettings, notify }: { voice: VoiceClient; onOpen: () => void; onSettings: () => void; notify: (text: string) => void }) {
  const status = statusOf(voice);
  const quality = qualityOf(voice);
  const toggle = (on: boolean) => `flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${on ? 'bg-err/15 text-err hover:bg-err/25' : 'bg-white/[0.04] text-muted hover:bg-white/[0.08] hover:text-fg'}`;
  const run = (fn: () => Promise<unknown> | void) => () => { Promise.resolve(fn()).catch((e) => notify(e instanceof Error ? e.message : String(e))); };
  // Allumer la caméra depuis le panneau affiche la scène : on se voit tout de suite.
  const toggleCamera = run(() => {
    if (!voice.camera) onOpen();
    return voice.setCamera(!voice.camera);
  });
  return (
    <div className="mx-2 mt-2 animate-rise rounded-xl bg-ink-950/60 p-3 ring-1 ring-line">
      <div className="flex items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${status.dot}`} />
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className={`truncate text-sm font-semibold ${status.tone}`}>{status.text}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-subtle hover:text-muted">
            <span className="truncate">{voice.label}</span>
            {quality && voice.state === 'connected' && (
              <span title={quality.detail} className={`inline-flex shrink-0 items-center gap-0.5 font-medium tabular-nums ${quality.tone}`}>
                <Icon name="signal" className="size-3" />{quality.label}
              </span>
            )}
          </div>
        </button>
        <button aria-label="Réglages audio et vidéo" title="Réglages audio et vidéo" onClick={onSettings} className={iconButton}>
          <Icon name="sliders" className="size-4" />
        </button>
        <button aria-label="Quitter le salon vocal" title="Quitter le salon vocal" onClick={run(() => voice.leave())} className={`${iconButton} hover:bg-err/10 hover:text-err`}>
          <Icon name="phoneOff" className="size-4" />
        </button>
      </div>
      {voice.serverMuted && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-err/10 px-2 py-1 text-[11px] text-err">
          <Icon name="shield" className="size-3" /> Micro coupé par un modérateur
        </div>
      )}
      {voice.settings.inputMode === 'ptt' && (
        <div className={`mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${voice.pushToTalkActive ? 'bg-ok/15 text-ok' : 'bg-white/[0.03] text-subtle'}`}>
          <Icon name="keyboard" className="size-3" />
          {voice.pushToTalkActive ? 'Tu parles' : <>Maintiens <b className="font-semibold text-muted">{keyLabel(voice.settings.pttKey)}</b> pour parler</>}
        </div>
      )}
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <button aria-pressed={voice.muted || voice.serverMuted} disabled={voice.serverMuted} title={voice.serverMuted ? 'Micro coupé par un modérateur' : voice.muted ? 'Réactiver le micro' : 'Couper le micro'} onClick={() => voice.setMuted(!voice.muted)} className={toggle(voice.muted || voice.serverMuted)}>
          <Icon name={voice.muted ? 'micOff' : 'mic'} className="size-3.5" /> Micro
        </button>
        <button aria-pressed={voice.deafened} title={voice.deafened ? 'Réactiver le son' : 'Couper le son'} onClick={() => voice.setDeafened(!voice.deafened)} className={toggle(voice.deafened)}>
          <Icon name={voice.deafened ? 'headphonesOff' : 'headphones'} className="size-3.5" /> Son
        </button>
        <button aria-pressed={!!voice.camera} disabled={voice.cameraStarting} title={voice.camera ? 'Couper la caméra' : 'Activer la caméra'} onClick={toggleCamera} className={voice.camera ? 'flex items-center justify-center gap-1.5 rounded-lg bg-ok/15 py-1.5 text-xs font-medium text-ok transition hover:bg-ok/25' : toggle(false)}>
          {voice.cameraStarting ? <Spinner className="size-3.5" /> : <Icon name={voice.camera ? 'video' : 'videoOff'} className="size-3.5" />} Vidéo
        </button>
      </div>
    </div>
  );
}

export function Spinner({ className = 'size-8' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-2 border-white/15 border-t-accent ${className}`} />;
}

/** Écran d'attente d'une vidéo : fond neutre et indicateur de chargement. */
function VideoLoading({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink-950">
      <div className="flex flex-col items-center gap-3 text-sm text-muted">
        <Spinner />
        {label}
      </div>
    </div>
  );
}

function VideoView({ stream, mirror = false, label }: { stream: MediaStream; mirror?: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  // Uniquement la piste vidéo : sinon l'élément peut se dire prêt grâce au seul audio et rester noir.
  const track = stream.getVideoTracks()[0];
  const video = useMemo(() => new MediaStream(track ? [track] : []), [track]);
  useEffect(() => {
    setReady(false);
    if (ref.current) ref.current.srcObject = video;
  }, [video]);
  // Prête seulement quand une vraie image est décodée.
  const markReady = (e: React.SyntheticEvent<HTMLVideoElement>) => { if (e.currentTarget.videoWidth > 0) setReady(true); };
  // muted : le son passe par l'élément audio du participant (volume, sortie choisie).
  return (
    <>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        onLoadedData={markReady}
        onResize={markReady}
        onPlaying={markReady}
        className={`absolute inset-0 size-full bg-ink-950 object-cover transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'} ${mirror ? '-scale-x-100' : ''}`}
      />
      {!ready && <VideoLoading label={label} />}
    </>
  );
}

/** Tuiles des participants : salon vocal (plein écran) ou appel privé (bandeau compact). */
export function ParticipantGrid({ participants, voice, here, onMenu, compact = false }: {
  participants: VoiceParticipant[]; voice: VoiceClient; here: boolean; onMenu: OpenParticipantMenu; compact?: boolean;
}) {
  const peerStates = voice.peerStates;
  return (
    <div className={compact
      ? 'relative mx-auto grid w-full max-w-4xl justify-center gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,280px))]'
      : 'relative mx-auto grid h-full max-w-6xl content-center gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]'}>
      {participants.map((p) => {
        const speaking = voice.speaking.has(p.client_id);
        const isSelf = p.client_id === voice.selfId;
        const state = here && !isSelf ? peerStates.get(p.client_id) : undefined;
        // Hors de l'appel, on ne voit rien de ce qui s'y passe : avatars seulement.
        // Sa propre caméra s'affiche dès l'ouverture, sans attendre la confirmation du serveur.
        const hidden = !isSelf && !!voice.settings.hiddenVideo[p.user.id];
        const videoOn = here && !hidden && (isSelf ? !!voice.camera || voice.cameraStarting : p.video);
        const stream = isSelf ? voice.camera : voice.streamOf(p.client_id);
        const hasTrack = !!stream?.getVideoTracks().length;
        const loadingLabel = isSelf ? 'Démarrage de la caméra…' : 'Chargement de la vidéo…';
        const volume = voice.settings.userVolumes[p.user.id] ?? 1;
        return (
          <div
            key={p.client_id}
            onContextMenu={(e) => { e.preventDefault(); onMenu(p, e.clientX, e.clientY); }}
            className={`group relative grid aspect-video animate-rise place-items-center overflow-hidden rounded-2xl border bg-ink-900 transition-shadow duration-150 ${speaking ? 'border-ok shadow-[0_0_0_2px_var(--color-ok),0_0_32px_-4px_var(--color-ok)]' : 'border-line'}`}
          >
            {videoOn ? (
              hasTrack ? <VideoView stream={stream!} mirror={isSelf} label={loadingLabel} /> : <VideoLoading label={loadingLabel} />
            ) : (
              <>
                <div className="absolute inset-0 opacity-25" style={{ background: avatarGradient(p.user.name) }} />
                <div className="absolute inset-0 bg-ink-900/60" />
                <Avatar user={p.user} className={`relative shadow-2xl ${compact ? 'size-16 text-2xl' : 'size-20 text-3xl'}`} />
                {here && hidden && p.video && (
                  <span className="absolute top-3 left-3 flex items-center gap-1 rounded-md bg-black/55 px-2 py-0.5 text-xs text-muted backdrop-blur">
                    <Icon name="videoOff" className="size-3" /> Caméra masquée
                  </span>
                )}
              </>
            )}
            <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 text-sm font-medium backdrop-blur">
              <span className="truncate">{p.user.name}</span>{isSelf && <span className="text-subtle">(toi)</span>}
              <FlagIcons p={p} voice={voice} />
            </div>
            {state && state !== 'connected' && (
              <div className="absolute top-3 right-3 rounded-md bg-black/55 px-2 py-0.5 text-xs text-amber-400 backdrop-blur">
                {state === 'failed' ? 'Échec de connexion' : 'Connexion…'}
              </div>
            )}
            {here && !isSelf && !compact && (
              <label className="absolute right-3 bottom-3 flex items-center gap-2 rounded-lg bg-black/55 px-2 py-1 opacity-0 backdrop-blur transition group-hover:opacity-100 focus-within:opacity-100">
                <Icon name="volume" className="size-3.5 text-muted" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={(e) => voice.setUserVolume(p.user.id, Number(e.target.value) / 100)}
                  aria-label={`Volume de ${p.user.name}`}
                  className="w-24 accent-accent"
                />
                <span className="w-8 text-right text-[11px] text-muted tabular-nums">{Math.round(volume * 100)}%</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Micro, son, caméra, réglages, raccrocher. */
export function CallControls({ voice, onSettings, notify }: { voice: VoiceClient; onSettings: () => void; notify: (text: string) => void }) {
  const round = (on = false) => `grid size-12 place-items-center rounded-full transition active:scale-95 disabled:cursor-not-allowed ${on ? 'bg-err/20 text-err hover:bg-err/30' : 'bg-white/[0.06] text-fg hover:bg-white/[0.12]'}`;
  const toggleCamera = () => { voice.setCamera(!voice.camera).catch((e) => notify(e instanceof Error ? e.message : String(e))); };
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        aria-label={voice.muted ? 'Réactiver le micro' : 'Couper le micro'}
        title={voice.serverMuted ? 'Micro coupé par un modérateur' : voice.muted ? 'Réactiver le micro' : 'Couper le micro'}
        disabled={voice.serverMuted}
        onClick={() => voice.setMuted(!voice.muted)}
        className={round(voice.muted || voice.serverMuted)}
      >
        <Icon name={voice.muted || voice.serverMuted ? 'micOff' : 'mic'} />
      </button>
      <button aria-label={voice.deafened ? 'Réactiver le son' : 'Couper le son'} title={voice.deafened ? 'Réactiver le son' : 'Couper le son'} onClick={() => voice.setDeafened(!voice.deafened)} className={round(voice.deafened)}>
        <Icon name={voice.deafened ? 'headphonesOff' : 'headphones'} />
      </button>
      <button
        aria-label={voice.camera ? 'Couper la caméra' : 'Activer la caméra'}
        title={voice.camera ? 'Couper la caméra' : 'Activer la caméra'}
        onClick={toggleCamera}
        disabled={voice.cameraStarting}
        className={voice.camera ? 'grid size-12 place-items-center rounded-full bg-ok/20 text-ok transition hover:bg-ok/30 active:scale-95' : round()}
      >
        {voice.cameraStarting ? <Spinner className="size-5" /> : <Icon name={voice.camera ? 'video' : 'videoOff'} />}
      </button>
      <button aria-label="Réglages audio et vidéo" title="Réglages audio et vidéo" onClick={onSettings} className={round()}>
        <Icon name="sliders" />
      </button>
      <button aria-label="Quitter le salon vocal" title="Raccrocher" onClick={() => voice.leave()} className="grid h-12 place-items-center rounded-full bg-err px-6 text-white transition hover:brightness-110 active:scale-95">
        <Icon name="phoneOff" />
      </button>
    </div>
  );
}

/** Scène d'un salon vocal de serveur. */
export function VoiceStage({ channel, server, voice, onJoin, onSettings, onMenu, notify }: {
  channel: Channel; server: ServerDetail; voice: VoiceClient; onJoin: () => void; onSettings: () => void; onMenu: OpenParticipantMenu; notify: (text: string) => void;
}) {
  const participants = server.voice[channel.id] ?? [];
  const here = voice.channelId === channel.id;
  const canConnect = has(server.perms, Perm.CONNECT);
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <Icon name="volume" className="size-5 shrink-0 text-subtle" />
        <h1 className="truncate font-semibold">{channel.name}</h1>
        <span className="hidden h-5 w-px bg-line md:block" />
        <span className="hidden truncate text-sm text-muted md:block">{server.name}</span>
        <span className="ml-auto text-sm text-muted">{participants.length} connecté{participants.length > 1 ? 's' : ''}</span>
      </header>

      <div className="relative flex-1 overflow-y-auto bg-ink-950/40 p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />
        {participants.length ? (
          <ParticipantGrid participants={participants} voice={voice} here={here} onMenu={onMenu} />
        ) : (
          <div className="relative grid h-full place-items-center">
            <div className="max-w-sm animate-rise text-center">
              <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-linear-to-br from-accent/30 to-accent-2/20 ring-1 ring-white/10">
                <Icon name="volume" className="size-8" />
              </div>
              <h2 className="mt-5 text-xl font-bold tracking-tight">Personne n&apos;est là pour l&apos;instant</h2>
              <p className="mt-1.5 text-sm text-muted">Rejoins le salon : les autres membres te verront et pourront te rejoindre.</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-line px-6 py-4">
        {here ? (
          <CallControls voice={voice} onSettings={onSettings} notify={notify} />
        ) : canConnect ? (
          <button onClick={onJoin} disabled={voice.state === 'joining'} className={`${primaryButton} px-6 py-3`}>
            <Icon name="volume" className="size-4" /> {voice.state === 'joining' ? 'Connexion…' : 'Rejoindre le vocal'}
          </button>
        ) : (
          <p className="flex items-center gap-2 text-sm text-subtle"><Icon name="shield" className="size-4" /> Tu n&apos;as pas la permission de rejoindre ce salon vocal.</p>
        )}
      </div>
    </>
  );
}

/** Bandeau d'appel en haut d'une conversation privée. */
export function CallArea({ channelId, peer, participants, voice, onJoin, onSettings, onMenu, notify }: {
  channelId: number; peer: User; participants: VoiceParticipant[]; voice: VoiceClient;
  onJoin: (video: boolean) => void; onSettings: () => void; onMenu: OpenParticipantMenu; notify: (text: string) => void;
}) {
  const here = voice.channelId === channelId;
  const waiting = here && participants.length <= 1;
  return (
    <div className="relative shrink-0 animate-rise border-b border-line bg-ink-950/70 px-6 py-5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_75%)]" />
      <ParticipantGrid participants={participants} voice={voice} here={here} onMenu={onMenu} compact />
      <p className="relative mt-3 text-center text-sm text-muted">
        {waiting ? <>Appel de <b className="text-fg">{peer.name}</b> en cours…</> : here ? 'Appel en cours' : <><b className="text-fg">{peer.name}</b> est en appel</>}
      </p>
      <div className="relative mt-4">
        {here ? (
          <CallControls voice={voice} onSettings={onSettings} notify={notify} />
        ) : (
          <div className="flex justify-center gap-3">
            <button onClick={() => onJoin(false)} className="inline-flex items-center gap-2 rounded-xl bg-ok px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:brightness-110 active:scale-[.98]">
              <Icon name="phone" className="size-4" /> Rejoindre l&apos;appel
            </button>
            <button onClick={() => onJoin(true)} className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.04] px-4 py-2.5 text-sm font-medium transition hover:bg-white/[0.08]">
              <Icon name="video" className="size-4" /> Avec la caméra
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu contextuel d'un participant (clic droit)
// ---------------------------------------------------------------------------
export function ParticipantMenu({ participant: p, x, y, server, voice, call, notify, onProfile, onDm, onClose }: {
  participant: VoiceParticipant;
  x: number;
  y: number;
  server: ServerDetail | null;  // null : appel privé (pas de modération)
  voice: VoiceClient;
  call: Call;
  notify: (text: string) => void;
  onProfile: (userId: number) => void;
  onDm: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [confirmKick, setConfirmKick] = useState(false);
  const isSelf = p.client_id === voice.selfId;
  const member = server?.members.find((m) => m.id === p.user.id);
  // On ne modère que quelqu'un dont on possède toutes les permissions, jamais le propriétaire (cf. API).
  const moderable = !!server && !!member && !isSelf && p.user.id !== server.owner_id && covers(server.perms, memberPerms(server, member));
  const canMute = moderable && has(server!.perms, Perm.MUTE_MEMBERS);
  const canMove = moderable && has(server!.perms, Perm.MOVE_MEMBERS);
  const canKick = moderable && has(server!.perms, Perm.KICK_MEMBERS);
  const volume = voice.settings.userVolumes[p.user.id] ?? 1;

  const act = (fn: () => Promise<unknown> | void, close = true) => () => {
    Promise.resolve(fn()).then(() => { if (close) onClose(); }, (e) => notify(errorMessage(e)));
  };

  return (
    <PopupMenu x={x} y={y} onClose={onClose}>
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar user={p.user} className="size-8 text-xs" />
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{p.user.name}<span className="font-normal text-subtle">#{p.user.tag}</span></div>
      </div>
      {(server || !isSelf) && <MenuSeparator />}
      {server && <MenuItem icon="users" onClick={act(() => onProfile(p.user.id))}>Profil</MenuItem>}
      {server && !isSelf && <MenuItem icon="message" onClick={act(() => onDm(p.user.name))}>Envoyer un message</MenuItem>}

      {!isSelf && (
        <>
          <MenuSeparator />
          <div className="px-2.5 py-2">
            <div className="mb-1.5 flex justify-between text-xs font-medium text-muted">Volume<span className="tabular-nums">{Math.round(volume * 100)} %</span></div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => voice.setUserVolume(p.user.id, Number(e.target.value) / 100)}
              aria-label={`Volume de ${p.user.name}`}
              className="w-full accent-accent"
            />
          </div>
          <MenuCheck checked={!!voice.settings.userMuted[p.user.id]} onClick={act(() => voice.setUserMuted(p.user.id, !voice.settings.userMuted[p.user.id]), false)}>
            Rendre muet pour moi
          </MenuCheck>
          <MenuCheck checked={!!voice.settings.hiddenVideo[p.user.id]} onClick={act(() => voice.setVideoHidden(p.user.id, !voice.settings.hiddenVideo[p.user.id]), false)}>
            Masquer sa caméra
          </MenuCheck>
        </>
      )}

      {server && (canMute || canMove || canKick) && (
        <>
          <MenuSeparator />
          <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-subtle uppercase">Modération</div>
          {canMute && (
            <MenuCheck danger checked={p.server_muted} onClick={act(() => call(`/servers/${server.id}/members/${p.user.id}`, { voice_muted: !p.server_muted }, 'PATCH'), false)}>
              Rendre muet pour tous
            </MenuCheck>
          )}
          {canMove && (
            <MenuItem icon="phoneOff" danger onClick={act(async () => {
              await call(`/servers/${server.id}/members/${p.user.id}/voice`, undefined, 'DELETE');
              notify(`${p.user.name} a été déconnecté du vocal`);
            })}>Déconnecter du vocal</MenuItem>
          )}
          {canKick && (
            confirmKick ? (
              <MenuItem icon="userMinus" danger onClick={act(async () => {
                await call(`/servers/${server.id}/members/${p.user.id}`, undefined, 'DELETE');
                notify(`${p.user.name} a été exclu du serveur`);
              })}>Confirmer l&apos;exclusion</MenuItem>
            ) : (
              <MenuItem icon="userMinus" danger onClick={() => setConfirmKick(true)}>Exclure du serveur…</MenuItem>
            )
          )}
        </>
      )}
    </PopupMenu>
  );
}
