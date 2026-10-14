// Sons de l'interface, synthétisés à la volée (aucun fichier) : courts, doux, sur la sortie audio choisie.
export type Cue = 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'cameraOn' | 'cameraOff' | 'join' | 'leave' | 'userJoin' | 'userLeave' | 'message' | 'ring';

// Montant = activation, descendant = désactivation.
const NOTES: Record<Cue, number[]> = {
  unmute: [587, 880],
  mute: [880, 587],
  undeafen: [392, 587],
  deafen: [587, 392],
  cameraOn: [784, 1175],
  cameraOff: [1175, 784],
  join: [523, 659, 784],
  leave: [784, 659, 523],
  // Notifications : quelqu'un rejoint / quitte ton salon vocal, message privé reçu.
  userJoin: [698, 1047],
  userLeave: [1047, 698],
  message: [1319, 1568],
  ring: [659, 880, 659, 880], // appel privé entrant (rejouée en boucle tant que ça sonne)
};

let ctx: (AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }) | null = null;

export function playCue(cue: Cue, { volume = 1, sinkId = '' } = {}) {
  try {
    ctx ??= new AudioContext();
    ctx.resume().catch(() => {});
    if (ctx.setSinkId && ctx.sinkId !== sinkId) ctx.setSinkId(sinkId).catch(() => {});
    const start = ctx.currentTime + 0.01;
    NOTES[cue].forEach((freq, i) => {
      const t = start + i * 0.075;
      // Fondamentale + légère harmonique : un « ding » plus rond qu'une sinusoïde seule.
      for (const [mult, level] of [[1, 1], [2, 0.18]]) {
        const osc = ctx!.createOscillator(), env = ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.11 * volume * level, t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(env).connect(ctx!.destination);
        osc.start(t);
        osc.stop(t + 0.25);
      }
    });
  } catch {
    // Pas d'audio disponible : le son est purement décoratif.
  }
}
