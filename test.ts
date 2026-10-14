// Parcours complet de l'API : `npm test` lance `next dev` (ou `NEXT_CMD=start` après un build)
// sur une base temporaire au schéma v1, ce qui vérifie au passage la migration des anciennes bases.
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Channel, Dm, Events, Friends, Invite, InvitePreview, Me, Message, Profile, Role, ServerDetail, ServerSummary, VoiceParticipant, VoiceRoom } from './lib/types';
import { Perm } from './lib/shared.ts';
import { createNoiseGate } from './lib/gate.ts';

// --- Porte de bruit (détection de la voix) sur signaux synthétiques ---
{
  const RATE = 48_000, BLOCK = 128;
  let seed = 1;
  const noise = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31) * 2 - 1; // bruit blanc reproductible
  const amp = (db: number) => 10 ** (db / 20);
  // Joue `seconds` de signal ; renvoie, bloc par bloc, si la porte laisse passer le son.
  const run = (gate: ReturnType<typeof createNoiseGate>, seconds: number, sample: (t: number) => number) => {
    const open: boolean[] = [];
    for (let b = 0; b < (seconds * RATE) / BLOCK; b++) {
      const input = new Float32Array(BLOCK), output = new Float32Array(BLOCK);
      for (let i = 0; i < BLOCK; i++) input[i] = sample((b * BLOCK + i) / RATE);
      gate.process([input], [output]);
      open.push(gate.hold > 0 && gate.mode !== 0);
    }
    return open;
  };
  const ratio = (flags: boolean[]) => flags.filter(Boolean).length / flags.length;
  const tone = (db: number) => (t: number) => amp(db) * Math.SQRT2 * Math.sin(2 * Math.PI * 220 * t);

  // Silence quasi numérique (après suppression du bruit) : un souffle à -62 dB ne doit pas ouvrir le micro.
  assert.ok(ratio(run(createNoiseGate(RATE), 6, () => amp(-62) * noise())) < 0.01, 'souffle résiduel');
  // Silence numérique (-90 dB) ponctué de frappes de clavier / souffles à -58 dB (40 ms toutes les 600 ms) :
  // l'ancien seuil (-65 dB au plancher) laissait le micro ouvert ~54 % du temps sans parler.
  assert.ok(ratio(run(createNoiseGate(RATE), 10, (t) => amp(t % 0.6 < 0.04 ? -58 : -90) * noise())) < 0.01, 'clavier sur silence');
  // Bruit ambiant (ventilation) à -55 dB.
  assert.ok(ratio(run(createNoiseGate(RATE), 6, () => amp(-55) * noise())) < 0.01, 'bruit ambiant');
  // Voix hachée (400 ms de parole à -26 dB, 1 s de silence) sur fond de bruit à -60 dB.
  {
    const gate = createNoiseGate(RATE);
    const speaking = (t: number) => t % 1.4 < 0.4;
    const flags = run(gate, 14, (t) => amp(-60) * noise() + (speaking(t) ? tone(-26)(t) : 0));
    const at = (i: number) => (i * BLOCK) / RATE;
    const during = flags.filter((_, i) => at(i) > 1.4 && speaking(at(i)));
    const after = flags.filter((_, i) => at(i) > 1.4 && at(i) % 1.4 > 0.75); // au-delà des 300 ms de maintien
    assert.ok(ratio(during) > 0.97, `la voix ouvre le micro (${ratio(during)})`);
    assert.ok(ratio(after) < 0.01, `le micro se referme dans les silences (${ratio(after)})`);
  }
  // Note tenue 20 s à -15 dB : ne doit jamais être prise pour du bruit de fond.
  assert.ok(ratio(run(createNoiseGate(RATE), 20, tone(-15)).slice(400)) === 1, 'note tenue');
  // Appuyer-pour-parler : seule la touche décide.
  {
    const gate = createNoiseGate(RATE);
    gate.mode = 0;
    assert.equal(ratio(run(gate, 1, tone(-15))), 0, 'touche relâchée');
    gate.mode = 1;
    assert.equal(ratio(run(gate, 1, () => 0)), 1, 'touche enfoncée');
  }
  // Une fois ouverte, la porte laisse passer le signal intact.
  {
    const gate = createNoiseGate(RATE);
    run(gate, 0.5, tone(-20));
    const input = new Float32Array(BLOCK).map((_, i) => tone(-20)(i / RATE)), output = new Float32Array(BLOCK);
    gate.process([input], [output]);
    assert.ok(output.every((v, i) => Math.abs(v - input[i]) < 1e-3), 'signal intact');
  }
}

// --- Base au schéma v1 (avant migrations), avec un compte, un serveur et un message ---
// Nom fixe, nettoyé au lancement suivant : Windows garde le fichier verrouillé un moment après l'arrêt de next.
const dbPath = join(tmpdir(), 'agora-test.db');
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
const legacy = new DatabaseSync(dbPath);
legacy.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL);
  CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);
  CREATE TABLE servers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), invite TEXT NOT NULL UNIQUE);
  CREATE TABLE members (server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (server_id, user_id));
  CREATE TABLE channels (id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL);
  CREATE TABLE messages (id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)));
  INSERT INTO users VALUES (1, 'ancien', 'sel:${scryptSync('motdepasse0', 'sel', 64).toString('hex')}');
  INSERT INTO servers VALUES (1, 'Vieux serveur', 1, 'legacy01');
  INSERT INTO members VALUES (1, 1);
  INSERT INTO channels VALUES (1, 1, 'général');
  INSERT INTO messages (channel_id, user_id, body) VALUES (1, 1, 'message historique');
`);
legacy.close();

const port = process.env.TEST_PORT ?? 3999;
const base = `http://localhost:${port}/api`;
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.env.NEXT_CMD ?? 'dev', '-p', String(port)], {
  env: { ...process.env, DB: dbPath, NEXT_DIST_DIR: process.env.NEXT_CMD === 'start' ? '.next' : '.next-test' },
  stdio: 'ignore',
});
process.on('exit', () => {
  if (process.platform === 'win32') { try { execSync(`taskkill /pid ${next.pid} /T /F`, { stdio: 'ignore' }); } catch {} }
  else next.kill();
});
for (let i = 0; (await fetch(`${base}/me`).catch(() => null))?.status !== 401; i++) {
  if (i > 120) throw new Error('next ne répond pas');
  await new Promise((r) => setTimeout(r, 500));
}

const call = async <T = { error?: string }>(token: string | null, path: string, body?: object, method = body ? 'POST' : 'GET') => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
};
type Session = { token: string };
const register = async (name: string) => (await call<Session>(null, '/register', { name, pass: `${name}-motdepasse` })).data.token;

// --- Migration : l'ancien compte, son serveur, son message et son code d'invitation ont survécu ---
const ancien = (await call<Session>(null, '/login', { name: 'ancien', pass: 'motdepasse0' })).data.token;
assert.ok(ancien, 'connexion avec un compte antérieur à la migration');
const { data: oldServer } = await call<ServerDetail>(ancien, '/servers/1');
assert.equal(oldServer.name, 'Vieux serveur');
assert.equal(oldServer.roles[0].name, '@everyone', 'rôle par défaut créé par la migration');
assert.deepEqual((await call<Message[]>(ancien, '/channels/1/messages')).data.map((m) => m.body), ['message historique']);

// --- Comptes ---
const alice = await register('alice');
assert.equal((await call(null, '/register', { name: 'ALICE', pass: 'motdepasse1' })).status, 409);
assert.equal((await call(null, '/register', { name: 'bob', pass: 'court' })).status, 400);
assert.equal((await call(null, '/login', { name: 'alice', pass: 'mauvais!!' })).status, 401);
assert.equal((await call(null, '/me')).status, 401);
const [bob, carol, dave] = [await register('bob'), await register('carol'), await register('dave')];

// L'ancien code d'invitation fonctionne toujours
assert.equal((await call<InvitePreview>(null, '/invites/legacy01')).data.server.name, 'Vieux serveur');
assert.equal((await call(dave, '/invites/legacy01', {})).status, 200);

// --- Serveur ---
const { data: created } = await call<ServerSummary>(alice, '/servers', { name: 'Mon serveur' });
const sid = created.id;
const { data: srv } = await call<ServerDetail>(alice, `/servers/${sid}`);
const general = srv.channels[0].id;
assert.equal(srv.channels[0].name, 'général');
assert.equal((await call(bob, `/servers/${sid}`)).status, 404, 'non-membre ne voit pas le serveur');
assert.equal((await call(bob, `/channels/${general}/messages`)).status, 404, 'non-membre ne lit pas les messages');

// --- Invitations ---
assert.equal((await call(alice, `/servers/${sid}/invites`, { expires_in: 42 })).status, 400, 'durée hors liste');
const { data: invite } = await call<Invite>(alice, `/servers/${sid}/invites`, { expires_in: 1800 });
assert.ok(invite.expires_at! > Date.now());
const { data: forever } = await call<Invite>(alice, `/servers/${sid}/invites`, { expires_in: null });
assert.equal(forever.expires_at, null);
assert.equal((await call<InvitePreview>(null, `/invites/${invite.code}`)).data.server.members, 1, 'aperçu public');
assert.equal((await call(null, '/invites/inexistant')).status, 404);

// Bob écoute le flux temps réel, puis rejoint
const stream = await fetch(`${base}/events?token=${bob}`, { signal: AbortSignal.timeout(10_000) });
assert.equal((await call(bob, `/invites/${invite.code}`, {})).status, 200);
assert.equal((await call<Invite[]>(alice, `/servers/${sid}/invites`)).data.find((i) => i.code === invite.code)?.uses, 1);

// --- Permissions par défaut ---
assert.equal((await call(bob, `/servers/${sid}/channels`, { name: 'privé' })).status, 403, 'pas de « gérer les salons » par défaut');
assert.equal((await call(bob, `/servers/${sid}`, { vanity: 'pirate' }, 'PATCH')).status, 403);
assert.equal((await call(bob, `/servers/${sid}/roles`, { name: 'x' })).status, 403);

// --- Lien personnalisé ---
assert.equal((await call(alice, `/servers/${sid}`, { vanity: 'Pas Valide!' }, 'PATCH')).status, 400);
assert.equal((await call(alice, `/servers/${sid}`, { vanity: 'Mon-QG' }, 'PATCH')).status, 200);
assert.equal((await call(ancien, '/servers/1', { vanity: 'mon-qg' }, 'PATCH')).status, 409, 'lien déjà pris');
assert.equal((await call(carol, '/invites/mon-qg', {})).status, 200, 'rejoindre par lien personnalisé');

// --- Rôles ---
const { data: members } = await call<ServerDetail>(alice, `/servers/${sid}`);
const idOf = (name: string) => members.members.find((m) => m.name === name)!.id;
const [aliceId, bobId, carolId] = [idOf('alice'), idOf('bob'), idOf('carol')];

const { data: modo } = await call<Role>(alice, `/servers/${sid}/roles`, { name: 'Modo', color: '#ff8800', permissions: Perm.MANAGE_CHANNELS | Perm.MANAGE_ROLES });
assert.equal((await call(alice, `/servers/${sid}/members/${bobId}`, { roles: [modo.id] }, 'PATCH')).status, 200);
const { data: asBob } = await call<ServerDetail>(bob, `/servers/${sid}`);
assert.deepEqual(asBob.members.find((m) => m.id === bobId)!.roles, [modo.id], 'rôle visible dans la liste des membres');
assert.equal(asBob.perms & Perm.MANAGE_CHANNELS, Perm.MANAGE_CHANNELS);
assert.equal((await call(bob, `/servers/${sid}/channels`, { name: 'modération' })).status, 200, 'le rôle donne « gérer les salons »');

// Pas d'escalade : on ne donne que ce qu'on a
assert.equal((await call(bob, `/servers/${sid}/roles`, { name: 'Dieu', permissions: Perm.ADMINISTRATOR })).status, 403);
const { data: helper } = await call<Role>(bob, `/servers/${sid}/roles`, { name: 'Aide', permissions: Perm.MANAGE_CHANNELS });
assert.equal((await call(bob, `/servers/${sid}/members/${carolId}`, { roles: [helper.id] }, 'PATCH')).status, 200);
const { data: admin } = await call<Role>(alice, `/servers/${sid}/roles`, { name: 'Admin', permissions: Perm.ADMINISTRATOR });
assert.equal((await call(bob, `/servers/${sid}/members/${bobId}`, { roles: [modo.id, admin.id] }, 'PATCH')).status, 403, 'pas d’auto-promotion');
assert.equal((await call(bob, `/roles/${admin.id}`, { name: 'piraté' }, 'PATCH')).status, 403);
assert.equal((await call(bob, `/roles/${modo.id}`, { permissions: Perm.MANAGE_CHANNELS | Perm.MANAGE_ROLES | Perm.KICK_MEMBERS }, 'PATCH')).status, 403);

// @everyone : retirer l'envoi de messages
const everyone = srv.roles.find((r) => r.is_default)!;
assert.equal((await call(alice, `/roles/${everyone.id}`, { permissions: 0 }, 'PATCH')).status, 200);
assert.equal((await call(carol, `/channels/${general}/messages`, { body: 'interdit' })).status, 403, 'envoi retiré via @everyone');
assert.equal((await call(alice, `/roles/${everyone.id}`, {}, 'DELETE')).status, 400, '@everyone indestructible');
await call(alice, `/roles/${everyone.id}`, { permissions: Perm.SEND_MESSAGES | Perm.CREATE_INVITES }, 'PATCH');

// Alice poste, Bob reçoit en direct
await call(alice, `/channels/${general}/messages`, { body: '  salut <b>bob</b>  ' });
const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader();
let received = '';
while (!received.includes('event: msg')) received += (await reader.read()).value;
assert.match(received, /"body":"salut <b>bob<\/b>"/);
assert.match(received, /event: server/, 'changements de rôles diffusés en direct');
assert.deepEqual((await call<Message[]>(bob, `/channels/${general}/messages`)).data.map((m) => [m.name, m.body]), [['alice', 'salut <b>bob</b>']]);

// --- Messages privés ---
assert.equal((await call(bob, '/dms', { name: 'ancien' })).status, 403, 'pas de serveur en commun');
assert.equal((await call(bob, '/dms', { name: 'bob' })).status, 400);
const { data: dm } = await call<Dm>(bob, '/dms', { name: 'carol' });
assert.equal(dm.user.name, 'carol');
assert.equal((await call<Dm>(carol, '/dms', { name: 'bob' })).data.id, dm.id, 'une seule conversation par paire');
await call(bob, `/channels/${dm.id}/messages`, { body: 'psst' });
assert.equal((await call(alice, `/channels/${dm.id}/messages`)).status, 404, 'un tiers ne lit pas les messages privés');
assert.equal((await call(alice, `/channels/${dm.id}/messages`, { body: 'intrus' })).status, 404);
const { data: carolDms } = await call<Dm[]>(carol, '/dms');
assert.equal(carolDms[0].user.name, 'bob');
assert.ok(carolDms[0].last_at);

// --- Exclusion ---
assert.equal((await call(bob, `/servers/${sid}/members/${carolId}`, {}, 'DELETE')).status, 403, 'pas de « exclure » pour Modo');
assert.equal((await call(alice, `/servers/${sid}/members/${carolId}`, {}, 'DELETE')).status, 200);
assert.equal((await call(carol, `/servers/${sid}`)).status, 404, 'membre exclu');
await call(alice, `/servers/${sid}/members/${bobId}`, { roles: [admin.id] }, 'PATCH');
assert.equal((await call(bob, `/servers/${sid}/members/${aliceId}`, {}, 'DELETE')).status, 403, 'le propriétaire ne peut pas être exclu');

// --- Révocation d'invitation ---
assert.equal((await call(alice, `/invites/${invite.code}`, {}, 'DELETE')).status, 200);
assert.equal((await call(null, `/invites/${invite.code}`)).status, 404);

// --- Amis ---
const meOf = async (token: string) => (await call<Me>(token, '/me')).data;
const [bobMe, ancienMe, daveMe] = [await meOf(bob), await meOf(ancien), await meOf(dave)];
assert.ok(ancienMe.tag >= 1 && ancienMe.tag <= 9999, 'tag attribué aux comptes migrés');
const idOfMe = (u: Me) => `${u.name}#${u.tag}`;
const wrongTag = `ancien#${(ancienMe.tag % 9999) + 1}`;
assert.equal((await call(bob, '/friends', { tag: 'ancien' })).status, 400, 'format pseudo#tag obligatoire');
assert.equal((await call(bob, '/friends', { tag: wrongTag })).status, 404, 'le pseudo seul ne suffit pas');
assert.equal((await call(bob, '/friends', { tag: idOfMe(bobMe) })).status, 400, "pas d'auto-ajout");
assert.equal((await call(bob, '/dms', { name: 'ancien' })).status, 403, 'pas encore amis, pas de serveur commun');
assert.equal((await call(bob, '/friends', { tag: idOfMe(ancienMe) })).status, 200);
assert.equal((await call(bob, '/friends', { tag: idOfMe(ancienMe) })).status, 409, 'demande en double');
assert.deepEqual((await call<Friends>(ancien, '/friends')).data.incoming.map((u) => u.name), ['bob']);
assert.deepEqual((await call<Friends>(bob, '/friends')).data.outgoing.map((u) => u.name), ['ancien']);
assert.equal((await call(ancien, `/friends/${bobMe.id}`, {})).status, 200, 'demande acceptée');
assert.deepEqual((await call<Friends>(bob, '/friends')).data.friends.map((u) => u.name), ['ancien']);
assert.equal((await call(bob, '/dms', { name: 'ancien' })).status, 200, 'les amis peuvent discuter sans serveur commun');
assert.equal((await call(bob, '/friends', { tag: idOfMe(ancienMe) })).status, 409, 'déjà amis');

// Demandes croisées : devenir amis directement
await call(dave, '/friends', { tag: idOfMe(bobMe) });
assert.equal((await call<{ status: string }>(bob, '/friends', { tag: idOfMe(daveMe) })).data.status, 'accepted');

// Refus / retrait
assert.equal((await call(bob, `/friends/${daveMe.id}`, {}, 'DELETE')).status, 200);
assert.equal((await call<Friends>(dave, '/friends')).data.friends.length, 0);
assert.equal((await call(bob, `/friends/${daveMe.id}`, {}, 'DELETE')).status, 404);

// --- Salons vocaux ---
// Écoute le flux temps réel d'un utilisateur et rend les événements au fil de l'eau.
function listen(token: string) {
  const ctrl = new AbortController();
  const queue: { event: string; data: unknown }[] = [];
  (async () => {
    const res = await fetch(`${base}/events?token=${token}`, { signal: ctrl.signal });
    let buffer = '';
    for await (const chunk of res.body!.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n\n')) >= 0; buffer = buffer.slice(i + 2)) {
        const block = buffer.slice(0, i);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) queue.push({ event, data: JSON.parse(data) });
      }
    }
  })().catch(() => {});
  async function next<E extends keyof Events>(event: E, where: (d: Events[E]) => boolean = () => true): Promise<Events[E]> {
    for (const deadline = Date.now() + 5000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 50))) {
      const i = queue.findIndex((e) => e.event === event && where(e.data as Events[E]));
      if (i >= 0) return queue.splice(i, 1)[0].data as Events[E];
    }
    throw new Error(`événement « ${event} » non reçu`);
  }
  return { next, close: () => ctrl.abort() };
}

const { data: vc } = await call<Channel>(alice, `/servers/${sid}/channels`, { name: 'Vocal', kind: 'voice' });
assert.equal(vc.kind, 'voice');
assert.equal(vc.name, 'Vocal', 'un salon vocal garde son nom tel quel');
assert.equal((await call(alice, `/channels/${vc.id}/messages`)).status, 400, "pas de messages dans un salon vocal");
await call(dave, `/invites/${forever.code}`, {});
const [A, B, D] = [listen(alice), listen(bob), listen(dave)];
const [a, b, d] = [(await A.next('hello')).client_id, (await B.next('hello')).client_id, (await D.next('hello')).client_id];

assert.equal((await call(bob, `/voice/${vc.id}`, { client_id: a })).status, 400, "pas de connexion d'un autre");
assert.equal((await call(alice, `/voice/${general}`, { client_id: a })).status, 400, 'salon textuel');
assert.equal((await call<unknown[]>(alice, `/voice/${vc.id}`, { client_id: a })).data.length, 1);
await B.next('voice', (e) => e.channel_id === vc.id && e.participants.length === 1);
const { data: joined } = await call<VoiceParticipant[]>(bob, `/voice/${vc.id}`, { client_id: b });
assert.deepEqual(joined.map((p) => p.user.name).sort(), ['alice', 'bob']);
await A.next('voice', (e) => e.participants.length === 2);

// Signalisation relayée entre participants seulement
assert.equal((await call(bob, '/voice/signal', { from: b, to: a, data: { sdp: { type: 'offer', sdp: 'v=0' } } })).status, 200);
assert.deepEqual(await A.next('signal'), { from: b, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
assert.equal((await call(bob, '/voice/signal', { from: b, to: d, data: {} })).status, 409, 'destinataire hors du salon');

// Micro coupé, présence visible dans le serveur
await call(bob, `/voice/${vc.id}`, { client_id: b, muted: true }, 'PATCH');
await A.next('voice', (e) => e.participants.some((p) => p.client_id === b && p.muted && !p.video));
await call(bob, `/voice/${vc.id}`, { client_id: b, video: true, deafened: true }, 'PATCH');
await A.next('voice', (e) => e.participants.some((p) => p.client_id === b && p.muted && p.video && p.deafened));
assert.equal((await call<ServerDetail>(alice, `/servers/${sid}`)).data.voice[vc.id].length, 2);

// Permission « Rejoindre les salons vocaux »
await call(alice, `/roles/${everyone.id}`, { permissions: Perm.SEND_MESSAGES }, 'PATCH');
assert.equal((await call(dave, `/voice/${vc.id}`, { client_id: d })).status, 403);
await call(alice, `/roles/${everyone.id}`, { permissions: Perm.SEND_MESSAGES | Perm.CREATE_INVITES | Perm.CONNECT }, 'PATCH');

// Fermer l'onglet fait quitter le salon ; quitter explicitement aussi
B.close();
await A.next('voice', (e) => e.participants.length === 1);
await call(alice, `/voice/${vc.id}`, { client_id: a }, 'DELETE');
assert.equal((await call<ServerDetail>(alice, `/servers/${sid}`)).data.voice[vc.id], undefined);
A.close();
D.close();

// --- Présence et statut ---
await new Promise((r) => setTimeout(r, 300)); // fermeture des flux précédents
const daveId = daveMe.id;
assert.equal((await call<Record<number, string>>(bob, '/presence')).data[daveId], 'offline');
const B2 = listen(bob);
const b2 = (await B2.next('hello')).client_id;
const D2 = listen(dave);
const d2 = (await D2.next('hello')).client_id;
await B2.next('presence', (e) => e.user_id === daveId && e.status === 'online');
await call(dave, '/me', { status: 'dnd' }, 'PATCH');
await B2.next('presence', (e) => e.user_id === daveId && e.status === 'dnd');
await call(dave, '/me', { status: 'invisible' }, 'PATCH');
await B2.next('presence', (e) => e.user_id === daveId && e.status === 'offline');
assert.equal((await call<Me>(dave, '/me')).data.status, 'invisible', "on garde son statut choisi, même invisible");
assert.equal((await call(dave, '/me', { status: 'occupé' }, 'PATCH')).status, 400);
await call(dave, '/me', { status: 'online' }, 'PATCH');

// --- Profil ---
assert.equal((await call(dave, '/me', { name: 'bob' }, 'PATCH')).status, 409, 'pseudo déjà pris');
await call(dave, '/me', { name: 'dave2', bio: 'Batteur 🥁', banner_color: '#FF8800' }, 'PATCH');
assert.equal((await B2.next('user', (e) => e.user.id === daveId)).user.name, 'dave2', 'renommage diffusé');
const { data: daveProfile } = await call<Profile>(bob, `/users/${daveId}`);
assert.deepEqual([daveProfile.name, daveProfile.bio, daveProfile.banner_color], ['dave2', 'Batteur 🥁', '#ff8800']);
assert.equal((await call(dave, '/me', { bio: 'x'.repeat(191) }, 'PATCH')).status, 400);
assert.equal((await call(dave, '/me', { banner_color: 'rouge' }, 'PATCH')).status, 400);
await call(dave, '/me', { name: 'dave' }, 'PATCH');

// Photo de profil : WebP uniquement, servie publiquement avec sa version
const put = (token: string, path: string, bytes: Uint8Array<ArrayBuffer>) =>
  fetch(base + path, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/webp' }, body: bytes });
const fakeWebp = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([20, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0)), Array(16).fill(7)));
assert.equal((await put(dave, '/me/avatar', new TextEncoder().encode('<svg onload=alert(1)>'))).status, 400, 'pas de faux fichier');
assert.equal((await put(dave, '/me/avatar', new Uint8Array(600 * 1024))).status, 413, 'taille limitée');
assert.equal((await put(dave, '/me/avatar', fakeWebp)).status, 200);
assert.equal((await call<Me>(dave, '/me')).data.avatar, 1);
const img = await fetch(`${base}/users/${daveId}/avatar?v=1`);
assert.equal(img.headers.get('content-type'), 'image/webp');
assert.deepEqual(new Uint8Array(await img.arrayBuffer()), fakeWebp);
await call(dave, '/me/avatar', {}, 'DELETE');
assert.equal((await fetch(`${base}/users/${daveId}/avatar?v=2`)).status, 404);

// Mot de passe : les autres appareils sont déconnectés
const daveOther = (await call<Session>(null, '/login', { name: 'dave', pass: 'dave-motdepasse' })).data.token;
assert.equal((await call(dave, '/me/password', { current: 'mauvais-mdp', next: 'nouveau-mdp-1' })).status, 403);
assert.equal((await call(dave, '/me/password', { current: 'dave-motdepasse', next: 'court' })).status, 400);
assert.equal((await call(dave, '/me/password', { current: 'dave-motdepasse', next: 'nouveau-mdp-1' })).status, 200);
assert.equal((await call(daveOther, '/me')).status, 401, 'autre appareil déconnecté');
assert.equal((await call(dave, '/me')).status, 200, 'session courante conservée');
assert.equal((await call(null, '/login', { name: 'dave', pass: 'nouveau-mdp-1' })).status, 200);

// --- Modération vocale (bob est administrateur, dave simple membre, alice propriétaire) ---
assert.equal((await call(bob, `/voice/${vc.id}`, { client_id: b2 })).status, 200);
assert.equal((await call(dave, `/voice/${vc.id}`, { client_id: d2 })).status, 200);
assert.equal((await call(dave, `/servers/${sid}/members/${bobId}`, { voice_muted: true }, 'PATCH')).status, 403, 'sans permission');
assert.equal((await call(bob, `/servers/${sid}/members/${aliceId}`, { voice_muted: true }, 'PATCH')).status, 403, 'propriétaire intouchable');
assert.equal((await call(bob, `/servers/${sid}/members/${daveId}`, { voice_muted: true }, 'PATCH')).status, 200);
await D2.next('voice', (e) => e.participants.some((p) => p.client_id === d2 && p.server_muted));
// La sanction suit le membre : elle est toujours là s'il revient
await call(dave, `/voice/${vc.id}`, { client_id: d2 }, 'DELETE');
await call(dave, `/voice/${vc.id}`, { client_id: d2 });
assert.ok((await call<ServerDetail>(bob, `/servers/${sid}`)).data.voice[vc.id].find((p) => p.client_id === d2)?.server_muted);
await call(bob, `/servers/${sid}/members/${daveId}`, { voice_muted: false }, 'PATCH');
assert.equal((await call(dave, `/servers/${sid}/members/${bobId}/voice`, {}, 'DELETE')).status, 403, 'déconnexion sans permission');
assert.equal((await call(bob, `/servers/${sid}/members/${daveId}/voice`, {}, 'DELETE')).status, 200);
await B2.next('voice', (e) => e.channel_id === vc.id && !e.participants.some((p) => p.client_id === d2));
B2.close();
D2.close();

// --- Conversations privées : écriture en cours, fermeture, appels ---
const B3 = listen(bob), C3 = listen(carol), A3 = listen(alice);
const [b3, c3] = [(await B3.next('hello')).client_id, (await C3.next('hello')).client_id];
await A3.next('hello');
await call(bob, `/channels/${dm.id}/typing`, {});
assert.equal((await C3.next('typing', (e) => e.channel_id === dm.id)).user.name, 'bob', "carol voit que bob écrit");
assert.equal((await call(alice, `/channels/${dm.id}/typing`, {})).status, 404, 'un tiers ne peut pas signaler une écriture');

// Fermer la conversation : elle disparaît de la liste, l'historique reste, elle revient au message suivant
assert.equal((await call(carol, `/dms/${dm.id}`, {}, 'DELETE')).status, 200);
assert.ok(!(await call<Dm[]>(carol, '/dms')).data.some((d) => d.id === dm.id), 'conversation fermée');
assert.ok((await call<Message[]>(carol, `/channels/${dm.id}/messages`)).data.length > 0, 'historique conservé');
await call(bob, `/channels/${dm.id}/messages`, { body: 'tu es là ?' });
assert.ok((await call<Dm[]>(carol, '/dms')).data.some((d) => d.id === dm.id), 'rouverte par un nouveau message');

// Appel privé : sonnerie, refus, puis appel accepté
assert.equal((await call(bob, `/voice/${dm.id}`, { client_id: b3 })).status, 200);
assert.equal((await C3.next('call', (e) => e.channel_id === dm.id)).from.name, 'bob', 'ça sonne chez carol');
await call(carol, `/voice/${dm.id}/decline`, {});
assert.equal((await B3.next('call_declined', (e) => e.channel_id === dm.id)).user.name, 'carol');
assert.equal((await call(carol, `/voice/${dm.id}`, { client_id: c3 })).status, 200);
await B3.next('voice', (e) => e.channel_id === dm.id && e.server_id === null && e.participants.length === 2);
assert.equal((await call<VoiceRoom[]>(carol, '/voice')).data.find((r) => r.channel_id === dm.id)?.participants.length, 2);
assert.ok(!(await call<VoiceRoom[]>(alice, '/voice')).data.some((r) => r.channel_id === dm.id), "un tiers ne voit pas l'appel");
assert.equal((await call(alice, `/voice/${dm.id}`, { client_id: '' })).status, 400, "un tiers ne rejoint pas l'appel");
B3.close();
await C3.next('voice', (e) => e.channel_id === dm.id && e.participants.length === 1);
C3.close();
A3.close();

// --- Notifications d'un serveur coupées ---
assert.equal((await call(bob, `/servers/${sid}/notifications`, { muted: true }, 'PATCH')).status, 200);
assert.equal((await call<Me>(bob, '/me')).data.servers.find((s) => s.id === sid)?.muted, true);
assert.equal((await call(carol, `/servers/${sid}/notifications`, { muted: true }, 'PATCH')).status, 404, 'pas membre');

// Sous Windows, stdout est asynchrone sur un tube : on attend l'écriture avant de quitter.
process.stdout.write('ok\n', () => process.exit(0));
