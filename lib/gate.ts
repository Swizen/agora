// Porte de bruit / appuyer-pour-parler, sans aucune dépendance.
// Exécutée dans l'AudioWorklet (sérialisée via toString : rester en JavaScript simple, sans import ni helper)
// et testée directement dans test.ts.
//
// mode : 0 fermé (micro coupé, touche relâchée), 1 ouvert (touche enfoncée, mode musique), 2 détection de la voix.
export function createNoiseGate(sampleRate: number) {
  const gate = {
    mode: 2,
    auto: true,         // seuil calé sur le bruit de fond
    threshold: -50,     // seuil manuel (dBFS)
    floor: -60,         // estimation du bruit de fond (dBFS)
    hold: 0,            // secondes restantes avant fermeture
    gain: 0,
    tick: 0,
    /** Traite un bloc ; renvoie un relevé de niveau toutes les 50 ms environ. */
    process(input: Float32Array[], output: Float32Array[]) {
      if (!input.length) return null;
      const frames = input[0].length, dt = frames / sampleRate;
      let sum = 0;
      for (let c = 0; c < input.length; c++) for (let i = 0; i < frames; i++) sum += input[c][i] * input[c][i];
      const level = 10 * Math.log10(sum / (input.length * frames) + 1e-12); // dBFS
      // Bruit de fond : suit immédiatement les baisses, remonte lentement (~2 dB/s).
      gate.floor = Math.max(-80, level < gate.floor ? level : gate.floor + 2 * dt);
      // Seuil auto : 15 dB au-dessus du bruit, borné entre -50 et -36 dBFS.
      // Plancher : après suppression du bruit, le silence est quasi numérique ; sans borne, un souffle ouvrirait le micro.
      // Plafond : une voix ou une note tenue ne doit jamais être prise pour du bruit de fond.
      const threshold = gate.auto ? Math.min(-36, Math.max(gate.floor + 15, -50)) : gate.threshold;
      if (gate.mode === 1 || (gate.mode === 2 && level > threshold)) gate.hold = 0.3; // maintien après la voix
      else gate.hold -= dt;
      const target = gate.mode === 0 || gate.hold <= 0 ? 0 : 1;
      const k = 1 - Math.exp(-1 / ((target > gate.gain ? 0.004 : 0.06) * sampleRate)); // attaque 4 ms, relâche 60 ms
      let g = gate.gain;
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0], out = output[c];
        g = gate.gain;
        for (let i = 0; i < frames; i++) {
          g += (target - g) * k;
          out[i] = src[i] * g;
        }
      }
      gate.gain = g;
      gate.tick += dt;
      if (gate.tick < 0.05) return null;
      gate.tick = 0;
      return { level, threshold, open: target === 1 };
    },
  };
  return gate;
}
