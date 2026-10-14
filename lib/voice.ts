// Moteur audio / vidéo côté navigateur : WebRTC en maillage complet, signalisation via l'API.
//
// Chaîne d'entrée :  micro → volume d'entrée → porte (AudioWorklet) → piste envoyée
// La porte (détection de la voix ou appuyer-pour-parler) tourne dans le thread audio : elle reste réactive
// même onglet en arrière-plan, là où les timers JavaScript sont ralentis par le navigateur.
//
// Règles de négociation : le nouveau venu appelle les participants déjà présents (jamais d'offres croisées).
// L'appelant réserve d'emblée un canal vidéo : allumer la caméra remplace simplement sa piste, sans renégocier.
import type { Call } from './client';
import { createNoiseGate } from './gate';
import { playCue, type Cue } from './sounds';
import type { SignalData, VoiceFlags, VoiceParticipant } from './types';

// STUN public par défaut. Derrière certains NAT (réseaux d'entreprise, 4G), il faut un serveur TURN :
// NEXT_PUBLIC_ICE_SERVERS='[{"urls":"turn:turn.exemple.fr:3478","username":"…","credential":"…"}]'
const ICE_SERVERS: RTCIceServer[] = process.env.NEXT_PUBLIC_ICE_SERVERS
  ? JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS)
  : [{ urls: 'stun:stun.l.google.com:19302' }];

export const BITRATES = [
  { value: 64_000, label: 'Standard', hint: '64 kb/s — économise la bande passante' },
  { value: 96_000, label: 'Haute', hint: '96 kb/s' },
  { value: 128_000, label: 'Très haute', hint: '128 kb/s — recommandé' },
  { value: 256_000, label: 'Studio', hint: '256 kb/s — pour la musique' },
];

export const RESOLUTIONS = {
  '480p': { width: 854, height: 480, bitrate: 1_000_000 },
  '720p': { width: 1280, height: 720, bitrate: 2_500_000 },
  '1080p': { width: 1920, height: 1080, bitrate: 4_500_000 },
} as const;

export type AvSettings = {
  inputDevice: string;          // '' : périphérique par défaut du système
  outputDevice: string;
  videoDevice: string;
  inputVolume: number;          // 0 – 2
  outputVolume: number;         // 0 – 1
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  musicMode: boolean;           // stéréo, traitements coupés : musique, instruments
  bitrate: number;              // débit Opus envoyé (b/s)
  inputMode: 'vad' | 'ptt';     // détection de la voix ou appuyer-pour-parler
  vadAuto: boolean;             // seuil calé automatiquement sur le bruit de fond
  vadThreshold: number;         // seuil manuel (dBFS)
  pttKey: string;               // KeyboardEvent.code
  resolution: keyof typeof RESOLUTIONS;
  uiSounds: boolean;            // sons à l'activation / désactivation (micro, son, caméra, salon)
  notifySounds: boolean;        // sons de notification (arrivées / départs dans le salon, messages privés)
  userVolumes: Record<number, number>; // volume par utilisateur, 0 – 1
  userMuted: Record<number, boolean>;  // utilisateurs rendus muets pour soi
  hiddenVideo: Record<number, boolean>; // caméras masquées pour soi
};

export const DEFAULT_SETTINGS: AvSettings = {
  inputDevice: '',
  outputDevice: '',
  videoDevice: '',
  inputVolume: 1,
  outputVolume: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  musicMode: false,
  bitrate: 128_000,
  inputMode: 'vad',
  vadAuto: true,
  vadThreshold: -50,
  pttKey: 'KeyV',
  resolution: '720p',
  uiSounds: true,
  notifySounds: true,
  userVolumes: {},
  userMuted: {},
  hiddenVideo: {},
};

const STORAGE_KEY = 'agora:av';
const loadSettings = (): AvSettings => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
};

// Seuil de détection de la parole des autres participants (niveau RMS 0 – 1), pour l'indicateur visuel.
const REMOTE_SPEAKING_THRESHOLD = 0.02;

/**
 * Paramètres Opus annoncés dans notre SDP : ce que nous acceptons de recevoir.
 * Débit maximal permis (le débit réel est plafonné par chaque émetteur), stéréo possible,
 * correction d'erreurs (FEC) active, pas de DTX (pas de coupures dans les silences).
 */
export function tuneOpus(sdp: string) {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const params = 'minptime=10;useinbandfec=1;usedtx=0;stereo=1;sprop-stereo=1;maxaveragebitrate=510000;maxplaybackrate=48000';
  const fmtp = new RegExp(`a=fmtp:${pt} [^\\r\\n]*`);
  return fmtp.test(sdp) ? sdp.replace(fmtp, `a=fmtp:${pt} ${params}`) : sdp.replace(new RegExp(`(a=rtpmap:${pt} [^\\r\\n]*)`), `$1\r\na=fmtp:${pt} ${params}`);
}

// Porte de bruit exécutée dans le thread audio : la logique (lib/gate.ts) est sérialisée dans le worklet.
const GATE_WORKLET = `
const createNoiseGate = ${createNoiseGate.toString()};
class AgoraGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gate = createNoiseGate(sampleRate);
    this.port.onmessage = (e) => Object.assign(this.gate, e.data);
  }
  process(inputs, outputs) {
    const meter = this.gate.process(inputs[0], outputs[0]);
    if (meter) this.port.postMessage(meter);
    return true;
  }
}
registerProcessor('agora-gate', AgoraGate);
`;

type Peer = {
  pc: RTCPeerConnection;
  initiator: boolean;
  stream: MediaStream;              // pistes reçues (audio + vidéo)
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];   // candidats reçus avant la description distante
  queue: Promise<unknown>;          // signaux traités dans l'ordre d'arrivée
  analyser?: AnalyserNode;
  userId?: number;
  lost: number;                     // compteurs pour le taux de perte
  received: number;
};

export type VoiceState = 'idle' | 'joining' | 'connected';
export type Devices = { input: MediaDeviceInfo[]; output: MediaDeviceInfo[]; video: MediaDeviceInfo[] };
export type Meter = { level: number; threshold: number; open: boolean };

const mediaError = (e: unknown, what: 'micro' | 'caméra') => {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return new Error(`Accès ${what === 'micro' ? 'au micro' : 'à la caméra'} refusé : autorise-le dans les réglages du navigateur.`);
  if (name === 'NotFoundError') return new Error(`Aucun${what === 'micro' ? ' micro' : 'e caméra'} détecté${what === 'micro' ? '' : 'e'}.`);
  if (name === 'NotReadableError') return new Error(`${what === 'micro' ? 'Le micro' : 'La caméra'} est déjà utilisé${what === 'micro' ? '' : 'e'} par une autre application.`);
  return new Error(`Impossible d'ouvrir ${what === 'micro' ? 'le micro' : 'la caméra'}.`);
};

export class VoiceClient {
  state: VoiceState = 'idle';
  channelId: number | null = null;
  label = '';                        // « salon · serveur », pour le panneau de connexion
  muted = false;
  deafened = false;
  camera: MediaStream | null = null; // aperçu local de la caméra envoyée
  cameraStarting = false;            // caméra en cours d'ouverture (autorisation, démarrage du capteur)
  serverMuted = false;               // micro coupé par un modérateur
  dnd = false;                       // statut « Occupé » : pas de sons de notification
  speaking = new Set<string>();      // identifiants de connexion en train de parler
  settings: AvSettings = loadSettings();
  devices: Devices = { input: [], output: [], video: [] };
  meter: Meter = { level: -100, threshold: -50, open: false }; // lu en continu par l'écran de réglages
  quality: { rtt: number; loss: number } | null = null;

  private peers = new Map<string, Peer>();
  private ctx: AudioContext | null = null;
  private raw: MediaStream | null = null;     // micro brut
  private source?: MediaStreamAudioSourceNode;
  private inputGain?: GainNode;
  private gate?: AudioWorkletNode;
  private dest?: MediaStreamAudioDestinationNode;
  private micReady: Promise<void> | null = null;
  private loopback = false;
  private pttDown = false;
  private mutedBeforeDeafen = false;
  private roster = new Map<string, number>(); // connexion → utilisateur, d'après la dernière liste reçue
  private silenced = new Set<string>();       // connexions rendues muettes par un modérateur
  private timers: ReturnType<typeof setInterval>[] = [];
  private sending: Promise<unknown> = Promise.resolve();

  constructor(private opts: { call: Call; clientId: () => string | null; onChange: () => void; onError: (message: string) => void }) {}

  get selfId() { return this.opts.clientId(); }
  get inCall() { return this.channelId !== null; }
  get outputSupported() { return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype; }
  get peerStates() { return new Map([...this.peers].map(([id, p]) => [id, p.pc.connectionState])); }
  /** Flux reçu d'un participant (audio + vidéo éventuelle). */
  streamOf(clientId: string) { return this.peers.get(clientId)?.stream; }

  // ------------------------------------------------------------------ Session
  async join(channelId: number, label: string) {
    if (this.channelId === channelId) return;
    await this.leave();
    const clientId = this.opts.clientId();
    if (!clientId) throw new Error('Connexion temps réel en cours, réessaie dans un instant');
    this.state = 'joining';
    this.channelId = channelId;
    this.label = label;
    this.opts.onChange();
    try {
      await this.ensureMic();
      const participants = await this.opts.call<VoiceParticipant[]>(`/voice/${channelId}`, { client_id: clientId, ...this.flags() });
      this.state = 'connected';
      this.applyParticipants(participants, true);
      for (const p of participants) if (p.client_id !== clientId) this.offer(p.client_id, p.user.id);
      this.cue('join');
    } catch (e) {
      this.teardown();
      throw e;
    }
    this.timers.push(setInterval(() => this.measureRemotes(), 100), setInterval(() => this.collectStats(), 2000));
    this.opts.onChange();
  }

  async leave() {
    const channelId = this.channelId, clientId = this.opts.clientId();
    if (channelId === null) return;
    this.cue('leave');
    this.teardown();
    if (clientId) await this.opts.call(`/voice/${channelId}`, { client_id: clientId }, 'DELETE').catch(() => {});
  }

  setMuted(muted: boolean) {
    this.cue(muted ? 'mute' : 'unmute');
    this.muted = muted;
    if (!muted && this.deafened) {
      this.deafened = false;
      this.applyOutput();
    }
    this.applyGate();
    this.publishFlags();
  }

  /** Son coupé : on n'entend plus personne et le micro se coupe ; en réactivant le son, le micro retrouve son état. */
  setDeafened(deafened: boolean) {
    this.cue(deafened ? 'deafen' : 'undeafen');
    if (deafened && !this.deafened) this.mutedBeforeDeafen = this.muted;
    this.deafened = deafened;
    this.muted = deafened || this.mutedBeforeDeafen;
    this.applyOutput();
    this.applyGate();
    this.publishFlags();
  }

  async setCamera(on: boolean) {
    if (on === !!this.camera || this.cameraStarting) return;
    await this.switchCamera(on);
    this.cue(on ? 'cameraOn' : 'cameraOff');
  }

  /** Ouvre (ou rouvre, après un changement de périphérique) / ferme la caméra et la distribue aux participants. */
  private async switchCamera(on: boolean) {
    if (on) {
      this.cameraStarting = true;
      this.opts.onChange();
      try {
        const track = await this.openCamera();
        this.camera?.getTracks().forEach((t) => t.stop());
        this.camera = new MediaStream([track]);
      } finally {
        this.cameraStarting = false;
      }
    } else {
      this.camera?.getTracks().forEach((t) => t.stop());
      this.camera = null;
    }
    for (const peer of this.peers.values()) await this.videoSender(peer)?.replaceTrack(this.camera?.getVideoTracks()[0] ?? null);
    this.peers.forEach((p) => this.applySendParams(p));
    this.publishFlags();
  }

  /** Volume d'écoute d'un utilisateur (0 – 1), mémorisé dans ce navigateur. */
  setUserVolume(userId: number, volume: number) {
    this.updateSettings({ userVolumes: { ...this.settings.userVolumes, [userId]: volume } });
  }

  // ------------------------------------------------------------------ Réglages
  async updateSettings(patch: Partial<AvSettings>) {
    const before = this.settings;
    this.settings = { ...before, ...patch };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch {}
    const changed = (k: keyof AvSettings) => k in patch && patch[k] !== before[k];

    if (this.inputGain) this.inputGain.gain.value = this.settings.inputVolume;
    this.applyGate();
    this.applyOutput();
    if (changed('bitrate') || changed('resolution')) this.peers.forEach((p) => this.applySendParams(p));
    this.opts.onChange();

    try {
      if (this.raw && (changed('inputDevice') || changed('noiseSuppression') || changed('echoCancellation') || changed('autoGainControl') || changed('musicMode'))) {
        await this.openMic();
        if (changed('musicMode')) this.rebuildOutput();
      }
      if (this.camera && (changed('videoDevice') || changed('resolution'))) await this.switchCamera(true);
    } catch (e) {
      this.opts.onError(e instanceof Error ? e.message : String(e));
    }
  }

  async refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    this.devices = {
      input: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
      output: all.filter((d) => d.kind === 'audiooutput' && d.deviceId),
      video: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
    };
    this.opts.onChange();
  }

  /** Test du micro : on s'entend soi-même (après traitement). Ouvre le micro si besoin. */
  async setLoopback(on: boolean) {
    if (on) await this.ensureMic();
    this.loopback = on;
    if (!this.gate || !this.ctx) return;
    try { this.gate.disconnect(this.ctx.destination); } catch {}
    if (on) this.gate.connect(this.ctx.destination);
    this.opts.onChange();
  }

  get loopbackOn() { return this.loopback; }

  /** Ferme le micro hors appel (fin d'un test dans les réglages). */
  releaseMic() {
    if (this.inCall) return;
    this.loopback = false;
    this.raw?.getTracks().forEach((t) => t.stop());
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.raw = null;
    this.source = this.inputGain = this.gate = this.dest = undefined;
    this.micReady = null;
  }

  // ------------------------------------------------------------------ Clavier (appuyer-pour-parler)
  attachKeyboard() {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    };
    const set = (down: boolean) => {
      if (this.pttDown === down) return;
      this.pttDown = down;
      this.applyGate();
      this.opts.onChange();
    };
    const keydown = (e: KeyboardEvent) => { if (this.settings.inputMode === 'ptt' && e.code === this.settings.pttKey && !typing(e)) set(true); };
    const keyup = (e: KeyboardEvent) => { if (e.code === this.settings.pttKey) set(false); };
    const blur = () => set(false);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    const devices = () => { this.refreshDevices(); };
    navigator.mediaDevices?.addEventListener('devicechange', devices);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      navigator.mediaDevices?.removeEventListener('devicechange', devices);
    };
  }

  get pushToTalkActive() { return this.pttDown; }

  // ------------------------------------------------------------------ Signalisation
  /** Message WebRTC relayé par le serveur. */
  onSignal(from: string, data: SignalData) {
    // Dès que le micro est prêt : un nouveau venu peut nous appeler avant même la réponse à notre propre entrée.
    if (!this.dest || !this.inCall) return;
    const peer = this.peer(from, false);
    peer.queue = peer.queue.then(async () => {
      if (data.sdp) {
        await peer.pc.setRemoteDescription(data.sdp);
        for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c);
        if (data.sdp.type === 'offer') {
          // Canal vidéo réservé par l'appelant : on l'ouvre dans les deux sens et on y met notre caméra.
          for (const t of peer.pc.getTransceivers()) {
            if (t.receiver.track.kind === 'video' && t.currentDirection !== 'stopped') {
              t.direction = 'sendrecv';
              await t.sender.replaceTrack(this.camera?.getVideoTracks()[0] ?? null);
            }
          }
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp ?? '') });
          this.signal(from, { sdp: peer.pc.localDescription!.toJSON() });
        }
        this.applySendParams(peer);
      } else if (data.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pending.push(data.candidate);
      }
    }).catch((e) => console.warn('[vocal] signal', e));
  }

  /** Participants diffusés par le serveur : on raccroche avec ceux qui sont partis. */
  onParticipants(channelId: number, participants: VoiceParticipant[]) {
    if (channelId !== this.channelId || this.state !== 'connected') return;
    if (!participants.some((p) => p.client_id === this.opts.clientId())) {
      this.teardown();
      this.opts.onError('Tu as été déconnecté du salon vocal');
      return;
    }
    this.applyParticipants(participants, false);
  }

  private applyParticipants(participants: VoiceParticipant[], initial: boolean) {
    const self = this.opts.clientId();
    const before = this.roster;
    this.roster = new Map(participants.map((p) => [p.client_id, p.user.id]));
    // Sons d'arrivée / de départ des autres (pas pour la liste reçue en entrant).
    if (!initial) {
      if (participants.some((p) => p.client_id !== self && !before.has(p.client_id))) this.notification('userJoin');
      else if ([...before.keys()].some((id) => id !== self && !this.roster.has(id))) this.notification('userLeave');
    }
    // Micro coupé par un modérateur : appliqué par ceux qui écoutent (le serveur ne voit pas passer l'audio).
    this.silenced = new Set(participants.filter((p) => p.server_muted).map((p) => p.client_id));
    const serverMuted = this.silenced.has(self ?? '');
    if (serverMuted !== this.serverMuted) {
      this.serverMuted = serverMuted;
      if (!initial || serverMuted) this.opts.onError(serverMuted ? 'Un modérateur a coupé ton micro' : 'Un modérateur a rétabli ton micro');
    }
    for (const p of participants) {
      const peer = this.peers.get(p.client_id);
      if (peer) peer.userId = p.user.id;
    }
    this.applyGate();
    this.applyOutput();
    for (const id of this.peers.keys()) if (!this.roster.has(id)) this.drop(id);
    this.opts.onChange();
  }

  /** Son de notification : coupé en statut « Occupé » ou si l'utilisateur les a désactivés. */
  notification(cue: Cue) {
    if (this.settings.notifySounds && !this.dnd) playCue(cue, { volume: this.settings.outputVolume, sinkId: this.settings.outputDevice });
  }

  /** Rendre muet un utilisateur pour soi seulement. */
  setUserMuted(userId: number, muted: boolean) {
    this.updateSettings({ userMuted: { ...this.settings.userMuted, [userId]: muted } });
  }

  /** Masquer la caméra d'un utilisateur pour soi seulement. */
  setVideoHidden(userId: number, hidden: boolean) {
    this.updateSettings({ hiddenVideo: { ...this.settings.hiddenVideo, [userId]: hidden } });
  }

  /** La connexion temps réel a été rétablie sous un nouvel identifiant : la session vocale côté serveur est perdue. */
  onReconnect() {
    if (!this.inCall) return;
    this.teardown();
    this.opts.onError('Connexion perdue : tu as quitté le salon vocal');
  }

  // ------------------------------------------------------------------ Interne : micro et chaîne audio
  /** Ouvre le micro et la chaîne audio (idempotent). */
  ensureMic() {
    return (this.micReady ??= (async () => {
      const ctx = (this.ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' }));
      ctx.resume().catch(() => {}); // peut démarrer suspendu selon la politique d'autoplay
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([GATE_WORKLET], { type: 'application/javascript' })));
      this.inputGain = ctx.createGain();
      this.inputGain.gain.value = this.settings.inputVolume;
      this.gate = new AudioWorkletNode(ctx, 'agora-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.gate.port.onmessage = (e: MessageEvent<Meter>) => this.onMeter(e.data);
      this.inputGain.connect(this.gate);
      this.rebuildOutput();
      this.applyGate();
      try {
        await this.openMic();
      } catch (e) {
        this.micReady = null;
        this.releaseMic();
        throw e;
      }
      await this.refreshDevices(); // les noms des périphériques ne sont visibles qu'après autorisation
    })());
  }

  private async openMic() {
    const s = this.settings, music = s.musicMode;
    let raw: MediaStream;
    try {
      raw = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: s.inputDevice ? { ideal: s.inputDevice } : undefined,
          echoCancellation: !music && s.echoCancellation,
          noiseSuppression: !music && s.noiseSuppression,
          autoGainControl: !music && s.autoGainControl,
          channelCount: { ideal: music ? 2 : 1 },
          sampleRate: { ideal: 48_000 },
          sampleSize: { ideal: 16 },
        },
      });
    } catch (e) {
      throw mediaError(e, 'micro');
    }
    // Remplacement à chaud : seule la source change, la piste envoyée aux participants reste la même.
    this.source?.disconnect();
    this.raw?.getTracks().forEach((t) => t.stop());
    this.raw = raw;
    this.source = this.ctx!.createMediaStreamSource(raw);
    this.source.connect(this.inputGain!);
  }

  /** Piste envoyée : mono pour la voix, stéréo en mode musique. Remplacée dans chaque connexion si elle change. */
  private rebuildOutput() {
    const ctx = this.ctx!, old = this.dest;
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = this.settings.musicMode ? 2 : 1;
    dest.channelCountMode = 'explicit';
    const track = dest.stream.getAudioTracks()[0];
    track.contentHint = this.settings.musicMode ? 'music' : 'speech';
    if (old) try { this.gate!.disconnect(old); } catch {}
    this.gate!.connect(dest);
    this.dest = dest;
    for (const peer of this.peers.values()) {
      peer.pc.getSenders().find((s) => s.track?.kind === 'audio')?.replaceTrack(track);
    }
    old?.stream.getTracks().forEach((t) => t.stop());
  }

  private onMeter(meter: Meter) {
    this.meter = meter;
    const self = this.opts.clientId();
    if (!self) return;
    const speaking = meter.open && !this.muted && !this.serverMuted;
    if (speaking !== this.speaking.has(self)) {
      this.speaking = new Set(this.speaking);
      if (speaking) this.speaking.add(self); else this.speaking.delete(self);
      this.opts.onChange();
    }
  }

  private applyGate() {
    const s = this.settings;
    // Mode musique : jamais de porte sur la détection de voix (on ne coupe pas une musique).
    const silent = this.muted || this.serverMuted;
    const mode = silent ? 0 : s.inputMode === 'ptt' ? (this.pttDown ? 1 : 0) : s.musicMode ? 1 : 2;
    this.gate?.port.postMessage({ mode, auto: s.vadAuto, threshold: s.vadThreshold });
    for (const t of this.dest?.stream.getAudioTracks() ?? []) t.enabled = !silent;
  }

  private applyOutput() {
    const s = this.settings;
    for (const [id, peer] of this.peers) {
      peer.audio.muted = this.deafened || this.silenced.has(id) || (peer.userId !== undefined && !!s.userMuted[peer.userId]);
      peer.audio.volume = Math.min(1, s.outputVolume * (peer.userId !== undefined ? (s.userVolumes[peer.userId] ?? 1) : 1));
      if (this.outputSupported && peer.audio.sinkId !== s.outputDevice) peer.audio.setSinkId(s.outputDevice).catch(() => {});
    }
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }) | null;
    if (ctx?.setSinkId && ctx.sinkId !== s.outputDevice) ctx.setSinkId(s.outputDevice).catch(() => {});
  }

  private async openCamera() {
    const s = this.settings, r = RESOLUTIONS[s.resolution];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: s.videoDevice ? { ideal: s.videoDevice } : undefined,
          width: { ideal: r.width },
          height: { ideal: r.height },
          frameRate: { ideal: 30 },
          aspectRatio: { ideal: 16 / 9 },
        },
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = 'motion';
      this.refreshDevices();
      return track;
    } catch (e) {
      throw mediaError(e, 'caméra');
    }
  }

  // ------------------------------------------------------------------ Interne : connexions
  private peer(id: string, initiator: boolean, userId?: number) {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { pc, initiator, stream: new MediaStream(), audio, pending: [], queue: Promise.resolve(), userId: userId ?? this.roster.get(id), lost: 0, received: 0 };
    pc.addTrack(this.dest!.stream.getAudioTracks()[0], this.dest!.stream);
    if (initiator) {
      const video = pc.addTransceiver('video', { direction: 'sendrecv' });
      const cam = this.camera?.getVideoTracks()[0];
      if (cam) video.sender.replaceTrack(cam);
    }
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(id, { candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      peer.stream.addTrack(e.track);
      if (e.track.kind === 'audio') {
        audio.srcObject = peer.stream;
        audio.play().catch(() => {});
        if (this.ctx) {
          peer.analyser = this.ctx.createAnalyser();
          peer.analyser.fftSize = 512;
          this.ctx.createMediaStreamSource(new MediaStream([e.track])).connect(peer.analyser);
        }
      }
      this.opts.onChange();
    };
    pc.onconnectionstatechange = () => {
      // Coupure réseau : l'appelant relance la négociation ICE.
      if (pc.connectionState === 'failed' && initiator) this.offer(id, userId, true);
      this.opts.onChange();
    };
    this.peers.set(id, peer);
    this.applyOutput();
    return peer;
  }

  private offer(id: string, userId?: number, iceRestart = false) {
    const peer = this.peer(id, true, userId);
    peer.queue = peer.queue.then(async () => {
      const offer = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp ?? '') });
      this.signal(id, { sdp: peer.pc.localDescription!.toJSON() });
    }).catch((e) => console.warn('[vocal] offre', e));
  }

  private videoSender(peer: Peer) {
    return peer.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video' && t.currentDirection !== 'stopped')?.sender;
  }

  /** Débits et priorités d'envoi (après chaque négociation et à chaque changement de réglage). */
  private applySendParams(peer: Peer) {
    for (const t of peer.pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      const params = t.sender.getParameters();
      if (!params.encodings?.length) continue; // pas encore négocié
      for (const enc of params.encodings) {
        enc.priority = kind === 'audio' ? 'high' : 'medium';
        enc.networkPriority = kind === 'audio' ? 'high' : 'medium';
        enc.maxBitrate = kind === 'audio' ? this.settings.bitrate : RESOLUTIONS[this.settings.resolution].bitrate;
        if (kind === 'video') enc.maxFramerate = 30;
      }
      t.sender.setParameters(params).catch((e) => console.warn('[vocal] paramètres', e));
    }
  }

  // Envois sérialisés : l'offre part toujours avant ses candidats ICE.
  private signal(to: string, data: SignalData) {
    const from = this.opts.clientId();
    this.sending = this.sending.then(() => this.opts.call('/voice/signal', { from, to, data })).catch(() => {});
  }

  private cue(cue: Cue) {
    if (this.settings.uiSounds) playCue(cue, { volume: this.settings.outputVolume, sinkId: this.settings.outputDevice });
  }

  private flags(): VoiceFlags {
    return { muted: this.muted, deafened: this.deafened, video: !!this.camera };
  }

  private publishFlags() {
    this.opts.onChange();
    const clientId = this.opts.clientId();
    if (this.state === 'connected' && clientId) {
      this.opts.call(`/voice/${this.channelId}`, { client_id: clientId, ...this.flags() }, 'PATCH').catch(() => {});
    }
  }

  private drop(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(id);
    this.speaking.delete(id);
    this.opts.onChange();
  }

  private measureRemotes() {
    const level = (a?: AnalyserNode) => {
      if (!a) return 0;
      const data = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    };
    const self = this.opts.clientId();
    const next = new Set([...this.speaking].filter((id) => id === self));
    for (const [id, p] of this.peers) if (!p.audio.muted && level(p.analyser) > REMOTE_SPEAKING_THRESHOLD) next.add(id);
    if (next.size !== this.speaking.size || [...next].some((id) => !this.speaking.has(id))) {
      this.speaking = next;
      this.opts.onChange();
    }
  }

  /** Ping et pertes de paquets (pire connexion), pour l'indicateur de qualité. */
  private async collectStats() {
    let rtt = 0, loss = 0;
    for (const peer of this.peers.values()) {
      const stats = await peer.pc.getStats().catch(() => null);
      stats?.forEach((s) => {
        if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime !== undefined) rtt = Math.max(rtt, s.currentRoundTripTime * 1000);
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          const lost = s.packetsLost - peer.lost, received = s.packetsReceived - peer.received;
          peer.lost = s.packetsLost;
          peer.received = s.packetsReceived;
          if (lost + received > 0) loss = Math.max(loss, lost / (lost + received));
        }
      });
    }
    this.quality = this.peers.size ? { rtt: Math.round(rtt), loss } : null;
    this.opts.onChange();
  }

  private teardown() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.camera?.getTracks().forEach((t) => t.stop());
    this.camera = null;
    this.channelId = null;
    this.state = 'idle';
    this.quality = null;
    this.roster = new Map();
    this.silenced = new Set();
    this.serverMuted = false;
    this.speaking = new Set();
    this.releaseMic();
    this.opts.onChange();
  }
}
