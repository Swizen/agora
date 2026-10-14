// Appels à l'API depuis le navigateur.
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(token: string | null, path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data;
}

/** `api` déjà liée au token de la session. */
export type Call = <T = unknown>(path: string, body?: object, method?: string) => Promise<T>;

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const inviteUrl = (code: string) => `${location.origin}/invite/${code}`;

// Dernière vue ouverte ('home' ou id de serveur), pour y revenir au rechargement.
export const lastView = {
  get: () => { try { return localStorage.getItem('agora:last'); } catch { return null; } },
  set: (value: string) => { try { localStorage.setItem('agora:last', value); } catch {} },
};

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
/** « Expire dans 3 heures », « N'expire jamais »… */
export function expiresLabel(expiresAt: number | null) {
  if (expiresAt === null) return "N'expire jamais";
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  if (minutes < 60) return `Expire ${relative.format(minutes, 'minute')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Expire ${relative.format(hours, 'hour')}`;
  return `Expire ${relative.format(Math.round(hours / 24), 'day')}`;
}

/** Envoi d'un fichier brut (photo de profil, bannière). */
export async function upload(token: string, path: string, blob: Blob) {
  const res = await fetch('/api' + path, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': blob.type }, body: blob });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? res.statusText);
}
