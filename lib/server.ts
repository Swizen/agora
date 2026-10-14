import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { scryptSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ALL_PERMS, DEFAULT_PERMS, INVITE_DURATIONS, Perm, covers, effectivePerms, has } from './shared';
import type { Channel, Events, Presence, Role, ServerDetail, Status, User, VoiceFlags, VoiceParticipant, VoiceRoom } from './types';

const NOW_MS = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

/** Colonnes d'un User (table users aliasée « u »). */
export const USER_COLS = 'u.id, u.name, u.tag, u.avatar_v AS avatar';

// Migrations : l'entrée n fait passer la base de la version n à n + 1 (PRAGMA user_version).
// Ne jamais modifier une migration déjà livrée : en ajouter une nouvelle à la fin.
const migrations = [
  // v1 : schéma initial (IF NOT EXISTS : les bases créées avant les migrations l'ont déjà).
  `
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS servers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), invite TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS members (
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (server_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (${NOW_MS})
    );
    CREATE INDEX IF NOT EXISTS messages_by_channel ON messages(channel_id, id);
  `,
  // v2 : invitations + lien personnalisé, messages privés, rôles.
  `
    CREATE TABLE servers_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), vanity TEXT UNIQUE);
    INSERT INTO servers_new (id, name, owner_id) SELECT id, name, owner_id FROM servers;
    CREATE TABLE invites (
      code TEXT PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      creator_id INTEGER NOT NULL REFERENCES users(id),
      expires_at INTEGER,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (${NOW_MS})
    );
    INSERT INTO invites (code, server_id, creator_id) SELECT invite, id, owner_id FROM servers;
    DROP TABLE servers;
    ALTER TABLE servers_new RENAME TO servers;

    -- Un salon appartient soit à un serveur, soit à une conversation privée entre dm_a < dm_b.
    CREATE TABLE channels_new (
      id INTEGER PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      dm_a INTEGER REFERENCES users(id),
      dm_b INTEGER REFERENCES users(id),
      UNIQUE (dm_a, dm_b),
      CHECK ((server_id IS NULL) = (dm_a IS NOT NULL AND dm_b IS NOT NULL AND dm_a < dm_b))
    );
    INSERT INTO channels_new (id, server_id, name) SELECT id, server_id, name FROM channels;
    DROP TABLE channels;
    ALTER TABLE channels_new RENAME TO channels;
    CREATE INDEX channels_by_server ON channels(server_id);

    CREATE TABLE roles (
      id INTEGER PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#9a9cab',
      permissions INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX one_default_role ON roles(server_id) WHERE is_default;
    INSERT INTO roles (server_id, name, permissions, is_default) SELECT id, '@everyone', ${DEFAULT_PERMS}, 1 FROM servers;
    CREATE TABLE member_roles (
      server_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, user_id),
      FOREIGN KEY (server_id, user_id) REFERENCES members(server_id, user_id) ON DELETE CASCADE
    );
  `,
  // v3 : identifiants publics (pseudo#tag) et amis.
  `
    ALTER TABLE users ADD COLUMN tag INTEGER NOT NULL DEFAULT 0;
    UPDATE users SET tag = abs(random()) % 9999 + 1;
    CREATE TABLE friendships (
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
      created_at INTEGER NOT NULL DEFAULT (${NOW_MS}),
      PRIMARY KEY (requester_id, addressee_id),
      CHECK (requester_id != addressee_id)
    );
    CREATE INDEX friendships_by_addressee ON friendships(addressee_id);
  `,
  // v4 : salons vocaux, et permission de les rejoindre accordée à @everyone.
  `
    ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice'));
    UPDATE roles SET permissions = permissions | ${Perm.CONNECT} WHERE is_default;
  `,
  // v5 : statut, profil (bio, bannière, photo), modération vocale.
  `
    ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'idle', 'dnd', 'invisible'));
    ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN banner_color TEXT;
    ALTER TABLE users ADD COLUMN avatar BLOB;
    ALTER TABLE users ADD COLUMN avatar_v INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN banner BLOB;
    ALTER TABLE users ADD COLUMN banner_v INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE members ADD COLUMN voice_muted INTEGER NOT NULL DEFAULT 0;
  `,
  // v6 : conversations privées fermées (masquées, historique conservé), serveurs aux notifications coupées.
  `
    CREATE TABLE dm_closed (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, channel_id)
    );
    ALTER TABLE members ADD COLUMN notify_muted INTEGER NOT NULL DEFAULT 0;
  `,
];

function init() {
  const db = new DatabaseSync(process.env.DB ?? 'agora.db');
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  // Les migrations recréent des tables : clés étrangères coupées le temps de la transaction (procédure officielle SQLite).
  db.exec('PRAGMA foreign_keys = OFF');
  for (let v = user_version; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migration v${v + 1} : clés étrangères invalides`);
      db.exec(`PRAGMA user_version = ${v + 1}; COMMIT`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Une connexion temps réel (un onglet). `voice` : salon vocal où elle se trouve. */
export type Client = {
  id: string;
  userId: number;
  user: User;
  send: (chunk: string) => void;
  voice?: VoiceFlags & { channelId: number; serverId: number | null }; // serverId null : appel privé
};

// Next peut charger ce module plusieurs fois (une copie par route, rechargement à chaud) :
// la base et les clients temps réel sont partagés via globalThis.
// La base s'ouvre à la première requête : le build importe les routes en parallèle sans y toucher.
const g = globalThis as typeof globalThis & { agoraDb?: DatabaseSync; agoraClients?: Set<Client>; agoraPing?: NodeJS.Timeout };
const db = () => (g.agoraDb ??= init());
export const clients = (g.agoraClients ??= new Set());
g.agoraPing ??= setInterval(() => { for (const c of clients) c.send(': ping\n\n'); }, 25_000).unref();

export const one = <T>(sql: string, ...args: SQLInputValue[]) => db().prepare(sql).get(...args) as T | undefined;
export const all = <T>(sql: string, ...args: SQLInputValue[]) => db().prepare(sql).all(...args) as T[];
export const run = (sql: string, ...args: SQLInputValue[]) => db().prepare(sql).run(...args);

export function transaction<T>(fn: () => T): T {
  db().exec('BEGIN');
  try {
    const result = fn();
    db().exec('COMMIT');
    return result;
  } catch (e) {
    db().exec('ROLLBACK');
    throw e;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

export const text = (value: unknown, min: number, max: number, label: string) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min || s.length > max) fail(400, `${label} : ${min} à ${max} caractères`);
  return s;
};

// --- Comptes ---
export const hash = (pass: string, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(pass, salt, 64).toString('hex')}`;
export const verify = (pass: string, stored: string) => {
  const [salt, key] = stored.split(':');
  return timingSafeEqual(scryptSync(pass, salt, 64), Buffer.from(key, 'hex'));
};
/** Numéro de l'identifiant public pseudo#tag ; les pseudos étant uniques, il sert de « secret » contre les demandes d'ami non sollicitées. */
export const newTag = () => randomInt(1, 10_000);

export const session = (userId: number) =>
  one<{ token: string }>('INSERT INTO sessions (token, user_id) VALUES (?, ?) RETURNING token', randomBytes(32).toString('hex'), userId)!;

// --- Permissions ---
export function permissionsOf(serverId: number, userId: number) {
  const server = one<{ owner_id: number }>(
    'SELECT s.owner_id FROM servers s JOIN members m ON m.server_id = s.id AND m.user_id = ? WHERE s.id = ?', userId, serverId,
  ) ?? fail(404, 'Serveur introuvable');
  const roles = all<{ permissions: number }>(
    'SELECT permissions FROM roles WHERE server_id = ?1 AND (is_default OR id IN (SELECT role_id FROM member_roles WHERE server_id = ?1 AND user_id = ?2))',
    serverId, userId,
  );
  return effectivePerms(server.owner_id === userId, roles.map((r) => r.permissions));
}

export function requirePerm(serverId: number, userId: number, flag: number) {
  const perms = permissionsOf(serverId, userId);
  if (!has(perms, flag)) fail(403, 'Permission insuffisante');
  return perms;
}

// --- Rôles ---
export type RoleRow = Omit<Role, 'is_default'> & { is_default: number };
export const toRole = ({ is_default, ...role }: RoleRow): Role => ({ ...role, is_default: is_default === 1 });

/** Valide un rôle envoyé par le client ; les champs absents gardent la valeur de `current`. */
export function roleInput(body: Record<string, unknown>, mine: number, current?: Role) {
  const name = body.name === undefined && current ? current.name : text(body.name, 1, 32, 'Nom du rôle');
  const color = body.color === undefined && current ? current.color : String(body.color ?? '#9a9cab');
  if (!/^#[0-9a-f]{6}$/i.test(color)) fail(400, 'Couleur invalide');
  const permissions = body.permissions === undefined && current ? current.permissions : Number(body.permissions ?? 0);
  if (!Number.isInteger(permissions) || permissions < 0 || permissions & ~ALL_PERMS) fail(400, 'Permissions invalides');
  if (!covers(mine, permissions)) fail(403, "Tu ne peux pas accorder des permissions que tu n'as pas");
  return { name, color: color.toLowerCase(), permissions };
}

// --- Serveurs ---
export function serverDetail(serverId: number, userId: number): ServerDetail {
  const perms = permissionsOf(serverId, userId);
  const links = all<{ user_id: number; role_id: number }>('SELECT user_id, role_id FROM member_roles WHERE server_id = ?', serverId);
  return {
    ...one<{ id: number; name: string; owner_id: number; vanity: string | null }>('SELECT id, name, owner_id, vanity FROM servers WHERE id = ?', serverId)!,
    perms,
    channels: all<Channel>('SELECT id, server_id, name, kind FROM channels WHERE server_id = ? ORDER BY id', serverId),
    voice: serverVoice(serverId),
    roles: all<RoleRow>('SELECT id, name, color, permissions, is_default FROM roles WHERE server_id = ? ORDER BY is_default DESC, id', serverId).map(toRole),
    members: all<User>(`SELECT ${USER_COLS} FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? ORDER BY u.name`, serverId)
      .map((u) => ({ ...u, roles: links.filter((l) => l.user_id === u.id).map((l) => l.role_id) })),
  };
}

// --- Invitations ---
export const newInviteCode = () => randomBytes(6).toString('base64url');
export const isInviteDuration = (value: unknown): value is number | null => INVITE_DURATIONS.some((d) => d.seconds === value);

/** Résout un code d'invitation ou un lien personnalisé. */
export function findInvite(code: string) {
  const invite = one<{ code: string; server_id: number; expires_at: number | null }>('SELECT code, server_id, expires_at FROM invites WHERE code = ?', code);
  if (invite) {
    if (invite.expires_at !== null && invite.expires_at < Date.now()) fail(410, 'Cette invitation a expiré');
    return invite;
  }
  const server = one<{ id: number }>('SELECT id FROM servers WHERE vanity = ?', code.toLowerCase()) ?? fail(404, 'Invitation invalide');
  return { code: null, server_id: server.id, expires_at: null };
}

// --- Salons (serveur ou message privé) ---
export const channelOf = (channelId: number, userId: number) =>
  one<{ id: number; server_id: number | null; dm_a: number | null; dm_b: number | null; kind: Channel['kind'] }>(
    `SELECT c.id, c.server_id, c.dm_a, c.dm_b, c.kind FROM channels c
     WHERE c.id = ?1 AND (?2 IN (c.dm_a, c.dm_b) OR EXISTS (SELECT 1 FROM members m WHERE m.server_id = c.server_id AND m.user_id = ?2))`,
    channelId, userId,
  ) ?? fail(404, 'Salon introuvable');

// --- Temps réel ---
// ponytail: fan-out en mémoire, un seul processus ; passer par Redis pub/sub (ou équivalent) pour scaler horizontalement.
export const sse = <E extends keyof Events>(event: E, data: Events[E]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function emitTo<E extends keyof Events>(userIds: Iterable<number>, event: E, data: Events[E]) {
  const ids = new Set(userIds);
  const chunk = sse(event, data);
  for (const c of clients) if (ids.has(c.userId)) c.send(chunk);
}

/** Relation entre deux utilisateurs, quel que soit le sens de la demande. */
export const friendship = (a: number, b: number) =>
  one<{ requester_id: number; status: 'pending' | 'accepted' }>(
    'SELECT requester_id, status FROM friendships WHERE (requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1)', a, b,
  );

export const emit = <E extends keyof Events>(serverId: number, event: E, data: Events[E]) =>
  emitTo(all<{ user_id: number }>('SELECT user_id FROM members WHERE server_id = ?', serverId).map((r) => r.user_id), event, data);

// --- Vocal ---
// La présence vocale vit sur les connexions temps réel : fermer l'onglet fait quitter le salon.
export function voiceParticipants(channelId: number): VoiceParticipant[] {
  const here = [...clients].filter((c) => c.voice?.channelId === channelId);
  if (!here.length) return [];
  const serverId = here[0].voice!.serverId;
  const silenced = new Set(serverId === null ? [] : all<{ user_id: number }>('SELECT user_id FROM members WHERE server_id = ? AND voice_muted', serverId).map((r) => r.user_id));
  return here.map((c) => {
    const { muted, deafened, video } = c.voice!;
    return { client_id: c.id, user: c.user, muted, deafened, video, server_muted: silenced.has(c.userId) };
  });
}

/** Un modérateur ne peut agir que sur quelqu'un dont il possède toutes les permissions, jamais sur le propriétaire. */
export function requireModerable(serverId: number, moderatorId: number, targetId: number, flag: number) {
  const mine = requirePerm(serverId, moderatorId, flag);
  if (targetId === moderatorId) fail(400, 'Action impossible sur toi-même');
  one('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', serverId, targetId) ?? fail(404, 'Membre introuvable');
  if (one('SELECT 1 FROM servers WHERE id = ? AND owner_id = ?', serverId, targetId) || !covers(mine, permissionsOf(serverId, targetId))) {
    fail(403, "Tu ne peux pas modérer ce membre");
  }
}

// --- Présence ---
// En ligne = au moins une connexion temps réel ouverte ; « invisible » apparaît hors ligne.
export const isConnected = (userId: number) => [...clients].some((c) => c.userId === userId);

/** Utilisateurs qui voient la présence de userId : serveurs en commun, amis, conversations privées (et lui-même). */
export const audienceOf = (userId: number) => all<{ id: number }>(`
  SELECT user_id AS id FROM members WHERE server_id IN (SELECT server_id FROM members WHERE user_id = ?1)
  UNION SELECT CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END FROM friendships WHERE ?1 IN (requester_id, addressee_id)
  UNION SELECT CASE WHEN dm_a = ?1 THEN dm_b ELSE dm_a END FROM channels WHERE ?1 IN (dm_a, dm_b)
  UNION SELECT ?1`, userId).map((r) => r.id);

export function presenceOf(userId: number): Presence {
  const status = one<{ status: Status }>('SELECT status FROM users WHERE id = ?', userId)?.status;
  return !status || status === 'invisible' || !isConnected(userId) ? 'offline' : status;
}

export const broadcastPresence = (userId: number) => emitTo(audienceOf(userId), 'presence', { user_id: userId, status: presenceOf(userId) });

/** Pseudo ou photo modifiés : connexions temps réel et vues des autres mises à jour. */
export function broadcastUser(userId: number) {
  const user = one<User>(`SELECT ${USER_COLS} FROM users u WHERE u.id = ?`, userId)!;
  for (const c of clients) if (c.userId === userId) c.user = user;
  emitTo(audienceOf(userId), 'user', { user });
}

// --- Images de profil ---
/** Format d'une image d'après ses premiers octets (jamais d'après ce que déclare le client). */
function imageType(bytes: Uint8Array) {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Photo et bannière : image redimensionnée par le navigateur, format contrôlé ici. */
export async function readImage(req: Request, maxBytes: number) {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) fail(413, 'Image trop lourde');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > maxBytes) fail(413, 'Image trop lourde');
  if (!imageType(bytes)) fail(400, 'Image invalide (WebP, PNG ou JPEG attendu)');
  return bytes;
}

export const imageResponse = (bytes: Uint8Array | null | undefined) =>
  bytes
    ? new Response(new Uint8Array(bytes), {
        // L'URL contient la version (?v=) : on peut la mettre en cache indéfiniment.
        headers: { 'content-type': imageType(bytes) ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
      })
    : new Response(null, { status: 404 });

/** États micro / son / caméra envoyés par le client ; les champs absents gardent leur valeur. */
export const voiceFlags = (body: Record<string, unknown>, current: VoiceFlags = { muted: false, deafened: false, video: false }): VoiceFlags => ({
  muted: typeof body.muted === 'boolean' ? body.muted : current.muted,
  deafened: typeof body.deafened === 'boolean' ? body.deafened : current.deafened,
  video: typeof body.video === 'boolean' ? body.video : current.video,
});

function serverVoice(serverId: number) {
  const voice: Record<number, VoiceParticipant[]> = {};
  for (const c of clients) if (c.voice?.serverId === serverId) voice[c.voice.channelId] ??= voiceParticipants(c.voice.channelId);
  return voice;
}

/** Participants d'un salon vocal ou d'un appel privé, diffusés aux membres du serveur ou aux deux interlocuteurs. */
export function emitVoice(serverId: number | null, channelId: number) {
  const room = { server_id: serverId, channel_id: channelId, participants: voiceParticipants(channelId) };
  if (serverId !== null) return emit(serverId, 'voice', room);
  const dm = one<{ dm_a: number; dm_b: number }>('SELECT dm_a, dm_b FROM channels WHERE id = ?', channelId);
  if (dm) emitTo([dm.dm_a, dm.dm_b], 'voice', room);
}

/** Salons vocaux et appels privés occupés que l'utilisateur peut voir. */
export function voiceRoomsOf(userId: number): VoiceRoom[] {
  const servers = new Set(all<{ server_id: number }>('SELECT server_id FROM members WHERE user_id = ?', userId).map((r) => r.server_id));
  const dms = new Set(all<{ id: number }>('SELECT id FROM channels WHERE ? IN (dm_a, dm_b)', userId).map((r) => r.id));
  const rooms = new Map<number, VoiceRoom>();
  for (const c of clients) {
    const v = c.voice;
    if (!v || rooms.has(v.channelId) || !(v.serverId === null ? dms.has(v.channelId) : servers.has(v.serverId))) continue;
    rooms.set(v.channelId, { server_id: v.serverId, channel_id: v.channelId, participants: voiceParticipants(v.channelId) });
  }
  return [...rooms.values()];
}

/** Une conversation privée fermée réapparaît (pour les deux) dès qu'il s'y passe quelque chose. */
export const reopenDm = (channelId: number) => run('DELETE FROM dm_closed WHERE channel_id = ?', channelId);

export function leaveVoice(client: Client) {
  if (!client.voice) return;
  const { serverId, channelId } = client.voice;
  client.voice = undefined;
  emitVoice(serverId, channelId);
}

/** Connexion temps réel appartenant à l'utilisateur (le client l'a reçue dans l'événement `hello`). */
export const ownClient = (clientId: unknown, userId: number) =>
  [...clients].find((c) => c.id === clientId && c.userId === userId) ?? fail(400, 'Connexion temps réel introuvable, recharge la page');

// --- Enveloppe des routes ---
async function readJson(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > 65_536) fail(413, 'Requête trop volumineuse');
  let value: unknown;
  try { value = JSON.parse(raw || '{}'); } catch {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON invalide');
  return value as Record<string, unknown>;
}

type Ctx = { user: User; token: string; body: Record<string, unknown>; id: number; params: Record<string, string>; url: URL; req: Request };
type RouteCtx = { params?: Promise<Record<string, string>> };

function wrap(fn: (ctx: Ctx) => unknown, open: boolean) {
  return async (req: Request, ctx: RouteCtx) => {
    try {
      const url = new URL(req.url);
      // EventSource ne peut pas envoyer d'en-têtes : le flux /api/events passe le token en query.
      const token = req.headers.get('authorization')?.replace(/^Bearer /, '') || url.searchParams.get('token') || '';
      const user = token ? one<User>(`SELECT ${USER_COLS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token) : undefined;
      if (!open && !user) fail(401, 'Non connecté');
      const body = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readJson(req) : {};
      const params = (await ctx?.params) ?? {};
      const out = await fn({ user: user!, token, body, id: Number(params.id), params, url, req });
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return e instanceof HttpError
        ? Response.json({ error: e.message }, { status: e.status })
        : Response.json({ error: 'Erreur serveur' }, { status: 500 });
    }
  };
}

// Route réservée aux utilisateurs connectés.
export const handler = (fn: (ctx: Ctx) => unknown) => wrap(fn, false);
// Route accessible sans session (inscription, connexion, aperçu d'invitation).
export const publicHandler = (fn: (ctx: Omit<Ctx, 'user'>) => unknown) => wrap(fn, true);
