'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BITRATES, RESOLUTIONS, type AvSettings, type VoiceClient } from '@/lib/voice';
import { errorMessage } from '@/lib/client';
import { ghostButton, Icon, iconButton, inputClass, Modal, Switch, type IconName } from './ui';
import { keyLabel } from './voice';

type Tab = 'voice' | 'video';

/** Réglages audio et vidéo : périphériques, test du micro, mode d'entrée, traitements, qualité, caméra. */
export function AvSettingsDialog({ open, onClose, voice, notify }: { open: boolean; onClose: () => void; voice: VoiceClient; notify: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>('voice');

  useEffect(() => {
    if (!open) return;
    voice.refreshDevices();
    return () => {
      // Fin d'un test : on se tait et on libère le micro s'il n'est pas utilisé par un appel.
      voice.setLoopback(false).catch(() => {});
      voice.releaseMic();
    };
  }, [open]);

  const set = (patch: Partial<AvSettings>) => { voice.updateSettings(patch).catch((e) => notify(errorMessage(e))); };

  return (
    <Modal open={open} onClose={onClose} className="h-[min(720px,calc(100%-32px))] w-[min(860px,calc(100%-32px))]">
      <div className="flex h-full">
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-ink-950/40 p-3">
          <h2 className="mb-3 px-2.5 pt-1 text-xs font-semibold tracking-wider text-subtle uppercase">Réglages</h2>
          <TabButton icon="mic" active={tab === 'voice'} onClick={() => setTab('voice')}>Voix et micro</TabButton>
          <TabButton icon="video" active={tab === 'video'} onClick={() => setTab('video')}>Vidéo</TabButton>
        </nav>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button aria-label="Fermer" onClick={onClose} className={`${iconButton} absolute top-4 right-4 z-10`}><Icon name="x" className="size-4" /></button>
          <div className="flex-1 overflow-y-auto p-8">
            {tab === 'voice' ? <VoiceTab voice={voice} set={set} notify={notify} /> : <VideoTab voice={voice} set={set} notify={notify} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

type TabProps = { voice: VoiceClient; set: (patch: Partial<AvSettings>) => void; notify: (text: string) => void };

function VoiceTab({ voice, set, notify }: TabProps) {
  const s = voice.settings;
  const [capturing, setCapturing] = useState(false);
  const needsPermission = !voice.devices.input.length;

  const allow = async () => {
    try { await voice.ensureMic(); } catch (e) { notify(errorMessage(e)); }
  };
  const toggleTest = () => voice.setLoopback(!voice.loopbackOn).catch((e) => notify(errorMessage(e)));

  // Capture de la touche d'appuyer-pour-parler
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== 'Escape') set({ pttKey: e.code });
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, { capture: true, once: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing]);

  return (
    <div className="max-w-2xl space-y-8">
      <Title>Voix et micro</Title>

      <Section title="Périphériques">
        {needsPermission && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm">
            <span className="flex-1">Autorise l&apos;accès au micro pour choisir tes périphériques.</span>
            <button onClick={allow} className={ghostButton}>Autoriser</button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <DeviceSelect label="Micro" value={s.inputDevice} devices={voice.devices.input} onChange={(inputDevice) => set({ inputDevice })} />
          {voice.outputSupported ? (
            <DeviceSelect label="Sortie audio" value={s.outputDevice} devices={voice.devices.output} onChange={(outputDevice) => set({ outputDevice })} />
          ) : (
            <div>
              <Label>Sortie audio</Label>
              <p className="rounded-xl border border-line px-3.5 py-2.5 text-sm text-subtle">Choix non pris en charge par ce navigateur : sortie par défaut du système.</p>
            </div>
          )}
          <Slider label="Volume du micro" value={s.inputVolume} max={2} onChange={(inputVolume) => set({ inputVolume })} />
          <Slider label="Volume de sortie" value={s.outputVolume} max={1} onChange={(outputVolume) => set({ outputVolume })} />
        </div>
      </Section>

      <Section title="Tester le micro">
        <LevelMeter voice={voice} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={toggleTest} className={voice.loopbackOn ? 'inline-flex items-center gap-2 rounded-xl bg-err/15 px-3.5 py-2 text-sm font-medium text-err transition hover:bg-err/25' : ghostButton}>
            <Icon name={voice.loopbackOn ? 'micOff' : 'mic'} className="size-4" /> {voice.loopbackOn ? 'Arrêter le test' : "M'écouter"}
          </button>
          <p className="text-xs text-subtle">Tu t&apos;entends avec tous les traitements appliqués. Utilise un casque pour éviter l&apos;effet Larsen.</p>
        </div>
      </Section>

      <Section title="Mode d'entrée">
        <Segmented
          value={s.inputMode}
          options={[{ value: 'vad', label: 'Détection de la voix' }, { value: 'ptt', label: 'Appuyer pour parler' }]}
          onChange={(inputMode) => set({ inputMode })}
        />
        {s.inputMode === 'vad' ? (
          <div className="mt-4 space-y-4">
            <Row title="Sensibilité automatique" description="Le seuil s'ajuste en continu au bruit de fond de ta pièce.">
              <Switch label="Sensibilité automatique" checked={s.vadAuto} onChange={(vadAuto) => set({ vadAuto })} />
            </Row>
            {!s.vadAuto && (
              <div>
                <Label>Seuil de déclenchement : {s.vadThreshold} dB</Label>
                <input type="range" min={-80} max={-10} value={s.vadThreshold} onChange={(e) => set({ vadThreshold: Number(e.target.value) })} className="w-full accent-accent" aria-label="Seuil de déclenchement" />
                <p className="mt-1 text-xs text-subtle">Le repère blanc sur la barre de niveau montre le seuil : ta voix doit le dépasser.</p>
              </div>
            )}
          </div>
        ) : (
          <Row title="Touche" description="Maintiens-la enfoncée pour parler. Ignorée pendant que tu écris.">
            <button onClick={() => setCapturing(true)} className={`min-w-28 rounded-xl border px-4 py-2 text-sm font-semibold transition ${capturing ? 'animate-pulse border-accent bg-accent/15 text-fg' : 'border-line bg-white/[0.04] hover:bg-white/[0.08]'}`}>
              {capturing ? 'Appuie sur une touche…' : keyLabel(s.pttKey)}
            </button>
          </Row>
        )}
      </Section>

      <Section title="Traitement de la voix">
        {s.musicMode && <p className="mb-3 text-xs text-amber-400">Désactivés en mode musique pour garder un son naturel.</p>}
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          <Row padded title="Suppression du bruit" description="Atténue ventilateur, clavier et bruits ambiants.">
            <Switch label="Suppression du bruit" checked={s.noiseSuppression && !s.musicMode} disabled={s.musicMode} onChange={(noiseSuppression) => set({ noiseSuppression })} />
          </Row>
          <Row padded title="Annulation de l'écho" description="Empêche tes haut-parleurs de revenir dans ton micro.">
            <Switch label="Annulation de l'écho" checked={s.echoCancellation && !s.musicMode} disabled={s.musicMode} onChange={(echoCancellation) => set({ echoCancellation })} />
          </Row>
          <Row padded title="Contrôle automatique du gain" description="Garde un volume de voix régulier.">
            <Switch label="Contrôle automatique du gain" checked={s.autoGainControl && !s.musicMode} disabled={s.musicMode} onChange={(autoGainControl) => set({ autoGainControl })} />
          </Row>
        </div>
      </Section>

      <Section title="Sons">
        <div className="rounded-xl border border-line p-4">
          <Row title="Sons de l'interface" description="Sons courts quand tu coupes ou réactives le micro, le son, la caméra, et quand tu rejoins ou quittes un salon.">
            <Switch label="Sons de l'interface" checked={s.uiSounds} onChange={(uiSounds) => set({ uiSounds })} />
          </Row>
        </div>
        <div className="mt-2 rounded-xl border border-line p-4">
          <Row title="Sons de notification" description="Quand quelqu'un rejoint ou quitte ton salon vocal, et à la réception d'un message privé. Toujours coupés en statut « Occupé ».">
            <Switch label="Sons de notification" checked={s.notifySounds} onChange={(notifySounds) => set({ notifySounds })} />
          </Row>
        </div>
      </Section>

      <Section title="Qualité audio">
        <div className="grid gap-2 sm:grid-cols-2">
          {BITRATES.map((b) => (
            <button
              key={b.value}
              onClick={() => set({ bitrate: b.value })}
              className={`rounded-xl border p-3 text-left transition ${s.bitrate === b.value ? 'border-accent/60 bg-accent/10 ring-1 ring-accent/40' : 'border-line hover:bg-white/[0.03]'}`}
            >
              <div className="text-sm font-semibold">{b.label}</div>
              <div className="text-xs text-muted">{b.hint}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-line p-4">
          <Row title={<span className="inline-flex items-center gap-2"><Icon name="music" className="size-4 text-accent" /> Mode musique</span>} description="Son stéréo, sans aucun traitement : pour partager de la musique ou jouer d'un instrument. Pense à monter la qualité en « Studio ».">
            <Switch label="Mode musique" checked={s.musicMode} onChange={(musicMode) => set({ musicMode })} />
          </Row>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          Codec Opus en 48 kHz, correction d&apos;erreurs activée et transmission continue : la voix reste claire même sur un réseau instable.
        </p>
      </Section>
    </div>
  );
}

function VideoTab({ voice, set, notify }: TabProps) {
  const s = voice.settings;
  const ref = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState<MediaStream | null>(null);

  // Aperçu indépendant de l'appel, relancé à chaque changement de caméra ou de résolution.
  useEffect(() => {
    if (!preview) return;
    return () => preview.getTracks().forEach((t) => t.stop());
  }, [preview]);

  async function startPreview() {
    const r = RESOLUTIONS[s.resolution];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: s.videoDevice ? { ideal: s.videoDevice } : undefined, width: { ideal: r.width }, height: { ideal: r.height }, frameRate: { ideal: 30 } },
      });
      setPreview(stream);
      voice.refreshDevices();
    } catch (e) {
      notify(e instanceof DOMException && e.name === 'NotAllowedError' ? "Accès à la caméra refusé : autorise-le dans les réglages du navigateur." : 'Impossible d\'ouvrir la caméra.');
    }
  }

  useEffect(() => {
    if (ref.current) ref.current.srcObject = preview;
  }, [preview]);

  useEffect(() => {
    if (preview) startPreview();
  }, [s.videoDevice, s.resolution]);

  const settingsOf = preview?.getVideoTracks()[0]?.getSettings();

  return (
    <div className="max-w-2xl space-y-8">
      <Title>Vidéo</Title>
      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-2xl border border-line bg-ink-950">
        <video ref={ref} autoPlay playsInline muted className={`absolute inset-0 size-full -scale-x-100 object-cover ${preview ? '' : 'hidden'}`} />
        {!preview && (
          <div className="text-center">
            <Icon name="video" className="mx-auto size-10 text-subtle" />
            <button onClick={startPreview} className={`${ghostButton} mt-4`}>Tester la caméra</button>
          </div>
        )}
        {settingsOf?.width && (
          <span className="absolute top-3 left-3 rounded-md bg-black/55 px-2 py-0.5 text-xs text-muted backdrop-blur">
            {settingsOf.width}×{settingsOf.height} · {Math.round(settingsOf.frameRate ?? 0)} i/s
          </span>
        )}
      </div>

      <Section title="Caméra">
        <DeviceSelect label="Périphérique" value={s.videoDevice} devices={voice.devices.video} onChange={(videoDevice) => set({ videoDevice })} />
      </Section>

      <Section title="Résolution envoyée">
        <Segmented
          value={s.resolution}
          options={(Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[]).map((r) => ({ value: r, label: r }))}
          onChange={(resolution) => set({ resolution })}
        />
        <p className="mt-2 text-xs text-subtle">30 images/s. La 1080p demande une bonne connexion montante, surtout à plusieurs.</p>
      </Section>
    </div>
  );
}

/** Barre de niveau du micro, animée hors de React (lecture directe de voice.meter à chaque image). */
function LevelMeter({ voice }: { voice: VoiceClient }) {
  const bar = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const pct = (db: number) => `${Math.min(100, Math.max(0, ((db + 80) / 80) * 100))}%`;
    const draw = () => {
      const { level, threshold, open } = voice.meter;
      if (bar.current) {
        bar.current.style.width = pct(level);
        bar.current.style.background = open ? 'var(--color-ok)' : 'var(--color-subtle)';
      }
      if (mark.current) {
        mark.current.style.left = pct(threshold);
        mark.current.style.display = voice.settings.inputMode === 'vad' ? '' : 'none';
      }
      if (label.current) label.current.textContent = level > -100 ? `${Math.round(level)} dB` : '—';
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [voice]);
  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-full bg-ink-800 ring-1 ring-line">
        <div ref={bar} className="h-full rounded-full transition-[width] duration-75" />
        <div ref={mark} className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_white]" />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-subtle">
        <span>{voice.inCall || voice.loopbackOn ? 'Niveau du micro' : 'Lance le test pour voir ton niveau'}</span>
        <span ref={label} className="tabular-nums" />
      </div>
    </div>
  );
}

// --- Éléments de formulaire ---
function Title({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-bold tracking-tight">{children}</h2>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold tracking-wider text-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-muted">{children}</span>;
}

function Row({ title, description, children, padded = false }: { title: ReactNode; description: string; children: ReactNode; padded?: boolean }) {
  return (
    <div className={`flex items-center gap-4 ${padded ? 'px-4 py-3' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted">{description}</div>
      </div>
      {children}
    </div>
  );
}

function DeviceSelect({ label, value, devices, onChange }: { label: string; value: string; devices: MediaDeviceInfo[]; onChange: (id: string) => void }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10`} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a9cab' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
        <option value="">Par défaut du système</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || 'Périphérique sans nom'}</option>
        ))}
      </select>
    </label>
  );
}

function Slider({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between text-xs font-medium text-muted">{label}<span className="tabular-nums">{Math.round(value * 100)} %</span></span>
      <input type="range" min={0} max={max * 100} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} className="w-full accent-accent" aria-label={label} />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-ink-950/60 p-1 ring-1 ring-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${value === o.value ? 'bg-white/[0.09] text-fg shadow' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TabButton({ icon, active, onClick, children }: { icon: IconName; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${active ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}>
      <Icon name={icon} className="size-4" /> {children}
    </button>
  );
}
