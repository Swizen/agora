'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { Channel, Dm, Events, Friends, Me, Message, Presence, ServerDetail, ServerSummary, Status, User, VoiceParticipant, VoiceRoom } from '@/lib/types';
import { api, ApiError, errorMessage, lastView, type Call } from '@/lib/client';
import { Perm, has } from '@/lib/shared';
import { ConversationView, type Conversation } from './conversation';
import { FriendsPanel } from './friends';
import { CallArea, ParticipantMenu, useVoice, VoiceChannelItem, VoicePanel, VoiceStage, type OpenParticipantMenu } from './voice';
import { ProfileDialog, StatusMenu } from './profile';
import { AvSettingsDialog } from './av-settings';
import { MemberDialog, MemberList, memberColor } from './members';
import { InviteDialog, ServerSettings } from './settings';
import { Avatar, ghostButton, Icon, iconButton, Logo, MenuCheck, MenuItem, nameColor, PopupMenu, primaryButton, PromptDialog, serverInitials, type PromptConfig } from './ui';

const PAGE = 50; // taille d'une page d'historique (cf. API)

const addUnique = <T extends { id: number }>(list: T[], extra: T[]) => [...list, ...extra.filter((m) => !list.some((x) => x.id === m.id))];

type Unread = Record<number, { server_id: number | null; count: number }>;      // par salon / conversation
type Typing = Record<number, Record<number, { name: string; until: number }>>; // salon → utilisateur → expiration

const withoutKey = <T,>(record: Record<number, T>, key: number) => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};
const withoutTyping = (t: Typing, channel: number, user: number) =>
  t[channel]?.[user] ? { ...t, [channel]: withoutKey(t[channel], user) } : t;

export default function Chat({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [home, setHome] = useState(false);                 // vue « Messages privés »
  const [dms, setDms] = useState<Dm[]>([]);
  const [friends, setFriends] = useState<Friends>({ friends: [], incoming: [], outgoing: [] });
  const [unread, setUnread] = useState<Unread>({});
  const [rooms, setRooms] = useState<Record<number, VoiceRoom>>({}); // salons vocaux et appels privés occupés
  const [typing, setTyping] = useState<Typing>({});
  const [incoming, setIncoming] = useState<Events['call'] | null>(null); // appel privé qui sonne
  const [serverMenu, setServerMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [server, setServer] = useState<ServerDetail | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [dialog, setDialog] = useState<PromptConfig | null>(null);
  const [panel, setPanel] = useState<'settings' | 'invite' | 'av' | 'profile' | null>(null);
  const [presence, setPresence] = useState<Record<number, Presence>>({});
  const [statusMenu, setStatusMenu] = useState(false);
  const [participantMenu, setParticipantMenu] = useState<{ p: VoiceParticipant; x: number; y: number } | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [stage, setStage] = useState<Channel | null>(null); // salon vocal affiché au centre
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  // Valeurs courantes lisibles depuis les callbacks du flux temps réel.
  const conversationRef = useRef<Conversation | null>(null);
  const serverRef = useRef<number | null>(null);
  const meRef = useRef<Me | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);                              // la vue suit-elle le bas de la conversation ?
  const prependFrom = useRef<number | null>(null);         // hauteur avant insertion de l'historique
  const loadingOlder = useRef(false);
  const lastTyping = useRef({ channel: 0, at: 0 });
  useEffect(() => { meRef.current = me; }, [me]);

  const notify = (text: string) => {
    const id = Date.now();
    setToast({ id, text });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2600);
  };
  const call: Call = <T,>(path: string, body?: object, method?: string) =>
    api<T>(token, path, body, method).catch((e) => { if (e instanceof ApiError && e.status === 401) onLogout(); throw e; });
  const act = (fn: () => Promise<unknown>) => () => { fn().catch((e) => notify(errorMessage(e))); };
  const { voice, clientId } = useVoice(call, notify);
  voice.dnd = me?.status === 'dnd'; // statut « Occupé » : pas de sons de notification

  // --- Navigation ---
  async function openConversation(c: Conversation) {
    setStage(null);
    conversationRef.current = c;
    setConversation(c);
    setMessages([]);
    setHasMore(false);
    stick.current = true;
    inputRef.current?.focus();
    setUnread((u) => withoutKey(u, c.id));
    const msgs = await call<Message[]>(`/channels/${c.id}/messages`);
    if (conversationRef.current !== c) return;
    setMessages(msgs);
    setHasMore(msgs.length === PAGE);
  }

  function leaveConversation() {
    conversationRef.current = null;
    setConversation(null);
    setMessages([]);
  }

  async function openServer(id: number) {
    const s = await call<ServerDetail>(`/servers/${id}`);
    serverRef.current = s.id;
    setServer(s);
    setHome(false);
    lastView.set(String(s.id));
    await openConversation(s.channels.find((c) => c.kind === 'text') ?? s.channels[0]);
  }

  /** Recharge un serveur après un changement (rôles, membres…) ; s'il n'est plus accessible, on l'oublie. */
  async function refreshServer(id = serverRef.current) {
    if (id == null) return;
    try {
      const s = await call<ServerDetail>(`/servers/${id}`);
      if (serverRef.current === id) setServer(s);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      setMe((m) => m && { ...m, servers: m.servers.filter((s) => s.id !== id) });
      if (serverRef.current === id) {
        notify('Tu ne fais plus partie de ce serveur');
        await openHome();
      }
    }
  }

  const loadDms = async () => {
    const list = await call<Dm[]>('/dms');
    setDms(list);
    return list;
  };

  async function openHome() {
    setStage(null);
    serverRef.current = null;
    setServer(null);
    setHome(true);
    lastView.set('home');
    leaveConversation();
    await loadDms();
  }

  const loadFriends = async () => setFriends(await call<Friends>('/friends'));
  const loadPresence = async () => setPresence(await call<Record<number, Presence>>('/presence'));
  const reloadMe = async () => {
    const m = await call<Me>('/me');
    meRef.current = m;
    setMe(m);
  };

  async function setStatus(status: Status) {
    setStatusMenu(false);
    await call('/me', { status }, 'PATCH');
    setMe((m) => m && { ...m, status });
  }

  const openParticipantMenu: OpenParticipantMenu = (p, x, y) => setParticipantMenu({ p, x, y });

  const openDm = (dm: Dm) => openConversation({ id: dm.id, name: dm.user.name, dm: dm.user });
  const loadRooms = async () => {
    const list = await call<VoiceRoom[]>('/voice');
    setRooms(Object.fromEntries(list.map((r) => [r.channel_id, r])));
  };

  /** Affiche une conversation privée (depuis une bulle de notification, le panneau d'appel…). */
  async function showDm(dm: Dm) {
    setStage(null);
    serverRef.current = null;
    setServer(null);
    setHome(true);
    lastView.set('home');
    await openDm(dm);
  }

  async function closeDm(dm: Dm) {
    await call(`/dms/${dm.id}`, undefined, 'DELETE');
    setDms((list) => list.filter((d) => d.id !== dm.id));
    setUnread((u) => withoutKey(u, dm.id));
    if (conversationRef.current?.id === dm.id) leaveConversation();
  }

  /** Appel privé : rejoindre (ou lancer) l'appel d'une conversation, caméra allumée ou non. */
  async function joinCall(channelId: number, peer: User, video: boolean) {
    await voice.join(channelId, `Appel avec ${peer.name}`);
    if (video) await voice.setCamera(true);
  }

  async function acceptCall() {
    const c = incoming;
    if (!c) return;
    setIncoming(null);
    await startDm(c.from.name);
    await joinCall(c.channel_id, c.from, false);
  }

  function declineCall() {
    const c = incoming;
    setIncoming(null);
    if (c) call(`/voice/${c.channel_id}/decline`, {}).catch(() => {});
  }

  // --- Notifications des serveurs ---
  const markServerRead = (serverId: number) =>
    setUnread((u) => Object.fromEntries(Object.entries(u).filter(([, v]) => v.server_id !== serverId)));

  async function setServerMuted(serverId: number, muted: boolean) {
    await call(`/servers/${serverId}/notifications`, { muted }, 'PATCH');
    setMe((m) => m && { ...m, servers: m.servers.map((s) => (s.id === serverId ? { ...s, muted } : s)) });
    if (muted) markServerRead(serverId);
    notify(muted ? 'Notifications du serveur coupées' : 'Notifications du serveur réactivées');
  }

  /** Signale qu'on écrit (au plus toutes les 3 s). */
  function sendTyping() {
    const c = conversationRef.current;
    const now = Date.now();
    if (!c || (lastTyping.current.channel === c.id && now - lastTyping.current.at < 3000)) return;
    lastTyping.current = { channel: c.id, at: now };
    call(`/channels/${c.id}/typing`, {}).catch(() => {});
  }

  async function startDm(name: string) {
    const dm = await call<Dm>('/dms', { name });
    setDms((list) => [dm, ...list.filter((d) => d.id !== dm.id)]);
    serverRef.current = null;
    setServer(null);
    setHome(true);
    lastView.set('home');
    await openDm(dm);
  }

  // --- Chargement initial : on revient sur la dernière vue ---
  useEffect(() => {
    call<Me>('/me')
      .then(async (m) => {
        meRef.current = m;
        setMe(m);
        loadFriends().catch((e) => notify(errorMessage(e)));
        loadPresence().catch((e) => notify(errorMessage(e)));
        loadRooms().catch((e) => notify(errorMessage(e)));
        const last = lastView.get();
        const target = m.servers.find((s) => String(s.id) === last) ?? (last === 'home' ? undefined : m.servers[0]);
        await (target ? openServer(target.id) : openHome());
      })
      .catch((e) => { if (!(e instanceof ApiError && e.status === 401)) notify(errorMessage(e)); });
  }, [token]);

  // --- Temps réel ---
  useEffect(() => {
    const es = new EventSource(`/api/events?token=${token}`);
    const on = <E extends keyof Events>(type: E, fn: (data: Events[E]) => void) =>
      es.addEventListener(type, (e) => fn(JSON.parse(e.data)));
    const report = (e: unknown) => notify(errorMessage(e));

    on('msg', (m) => {
      const current = m.channel_id === conversationRef.current?.id;
      if (current) setMessages((ms) => addUnique(ms, [m]));
      setTyping((t) => withoutTyping(t, m.channel_id, m.user_id));
      if (m.server_id === null) loadDms().catch(report); // conversation remontée en tête (ou rouverte)
      const self = meRef.current;
      if (!self || m.user_id === self.id) return;
      // Serveur en sourdine : ni son, ni pastille.
      if (m.server_id !== null && self.servers.find((s) => s.id === m.server_id)?.muted) return;
      if (!current) setUnread((u) => ({ ...u, [m.channel_id]: { server_id: m.server_id, count: (u[m.channel_id]?.count ?? 0) + 1 } }));
      if (!current || document.hidden) voice.notification('message');
    });
    on('typing', ({ channel_id, user }) =>
      setTyping((t) => ({ ...t, [channel_id]: { ...t[channel_id], [user.id]: { name: user.name, until: Date.now() + 6000 } } })));
    on('call', (c) => { setIncoming(c); loadDms().catch(report); });
    on('call_stop', ({ channel_id }) => setIncoming((c) => (c?.channel_id === channel_id ? null : c)));
    on('call_declined', ({ user }) => notify(`${user.name} a refusé l'appel`));
    on('channel', (c) => setServer((s) => (s?.id === c.server_id ? { ...s, channels: addUnique(s.channels, [c]) } : s)));
    on('member', (u) => {
      setServer((s) => (s?.id === u.server_id ? { ...s, members: addUnique(s.members, [u]) } : s));
      loadPresence().catch(report);
    });
    on('presence', ({ user_id, status }) => setPresence((p) => ({ ...p, [user_id]: status })));
    on('user', ({ user: u }) => {
      // Pseudo ou photo modifiés : mis à jour partout où la personne apparaît.
      if (u.id === meRef.current?.id) reloadMe().catch(report);
      setMessages((ms) => ms.map((m) => (m.user_id === u.id ? { ...m, name: u.name, avatar: u.avatar } : m)));
      setServer((s) => s && {
        ...s,
        members: s.members.map((m) => (m.id === u.id ? { ...m, ...u } : m)),
        voice: Object.fromEntries(Object.entries(s.voice).map(([k, list]) => [k, list.map((p) => (p.user.id === u.id ? { ...p, user: u } : p))])),
      });
      setDms((list) => list.map((d) => (d.user.id === u.id ? { ...d, user: u } : d)));
      setFriends((f) => ({ friends: f.friends.map((x) => (x.id === u.id ? u : x)), incoming: f.incoming.map((x) => (x.id === u.id ? u : x)), outgoing: f.outgoing.map((x) => (x.id === u.id ? u : x)) }));
      setConversation((c) => (c?.dm?.id === u.id ? { ...c, name: u.name, dm: u } : c));
    });
    on('server', ({ server_id }) => { refreshServer(server_id).catch(report); });
    on('friends', () => { loadFriends().then(loadPresence).catch(report); });
    on('hello', ({ client_id }) => {
      if (clientId.current) {
        voice.onReconnect(); // flux rétabli : l'ancienne session vocale est perdue côté serveur
        loadRooms().catch(report);
      }
      clientId.current = client_id;
    });
    on('voice', (e) => {
      setRooms((r) => (e.participants.length ? { ...r, [e.channel_id]: e } : withoutKey(r, e.channel_id)));
      setServer((s) => (s && s.id === e.server_id ? { ...s, voice: { ...s.voice, [e.channel_id]: e.participants } } : s));
      voice.onParticipants(e.channel_id, e.participants);
      // Appel terminé : on arrête de sonner.
      if (!e.participants.length) setIncoming((c) => (c?.channel_id === e.channel_id ? null : c));
    });
    on('signal', ({ from, data }) => voice.onSignal(from, data));
    return () => es.close();
  }, [token]);

  useEffect(() => {
    const id = setInterval(() => setTyping((t) => {
      const now = Date.now();
      if (!Object.values(t).some((users) => Object.values(users).some((u) => u.until <= now))) return t;
      return Object.fromEntries(Object.entries(t).map(([c, users]) => [c, Object.fromEntries(Object.entries(users).filter(([, u]) => u.until > now))]));
    }), 1000);
    return () => clearInterval(id);
  }, []);

  // Sonnerie d'un appel privé entrant (respecte « Occupé » et les sons de notification), 30 s au plus.
  useEffect(() => {
    if (!incoming) return;
    const ring = () => voice.notification('ring');
    ring();
    const id = setInterval(ring, 2500);
    const timeout = setTimeout(() => setIncoming(null), 30_000);
    return () => { clearInterval(id); clearTimeout(timeout); };
  }, [incoming]);

  // --- Défilement ---
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (prependFrom.current != null) {
      box.scrollTop = box.scrollHeight - prependFrom.current;
      prependFrom.current = null;
    } else if (stick.current) {
      box.scrollTop = box.scrollHeight;
    }
  }, [messages]);

  async function onScroll(e: UIEvent<HTMLDivElement>) {
    const box = e.currentTarget, c = conversationRef.current;
    stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 50;
    if (!c || !hasMore || box.scrollTop > 200 || loadingOlder.current || !messages.length) return;
    loadingOlder.current = true;
    try {
      const older = await call<Message[]>(`/channels/${c.id}/messages?before=${messages[0].id}`);
      if (conversationRef.current !== c) return;
      setHasMore(older.length === PAGE);
      prependFrom.current = box.scrollHeight;
      setMessages((ms) => [...older, ...ms]);
    } finally {
      loadingOlder.current = false;
    }
  }

  async function send(body: string) {
    const c = conversationRef.current;
    if (!c) return false;
    stick.current = true;
    lastTyping.current.at = 0;
    try {
      const m = await call<Message>(`/channels/${c.id}/messages`, { body });
      if (conversationRef.current?.id === m.channel_id) setMessages((ms) => addUnique(ms, [m]));
      return true;
    } catch (err) {
      notify(errorMessage(err));
      return false;
    }
  }

  // --- Modales de saisie ---
  const createServer = () => setDialog({
    title: 'Créer un serveur',
    description: 'Ton espace à toi et à tes amis. Tu pourras inviter du monde juste après.',
    label: 'Nom du serveur',
    placeholder: 'Le QG',
    submitLabel: 'Créer le serveur',
    onSubmit: async (name) => {
      const s = await call<ServerSummary>('/servers', { name });
      setMe((m) => m && { ...m, servers: [...m.servers, { ...s, muted: false }] });
      await openServer(s.id);
    },
  });

  const joinServer = () => setDialog({
    title: 'Rejoindre un serveur',
    description: "Colle un lien d'invitation, un code ou un lien personnalisé.",
    label: 'Invitation',
    placeholder: 'https://…/invite/aB3dE5fG',
    submitLabel: 'Rejoindre',
    onSubmit: async (value) => {
      const code = value.split('/').filter(Boolean).pop() ?? '';
      const s = await call<ServerSummary>(`/invites/${encodeURIComponent(code)}`, {});
      setMe((m) => m && { ...m, servers: addUnique(m.servers, [{ ...s, muted: false }]) });
      await openServer(s.id);
    },
  });

  async function openVoice(channel: Channel) {
    setStage(channel);
    if (server) await voice.join(channel.id, `${channel.name} · ${server.name}`);
  }

  const createChannel = (kind: Channel['kind']) => server && setDialog({
    title: kind === 'voice' ? 'Créer un salon vocal' : 'Créer un salon',
    description: `Nouveau salon ${kind === 'voice' ? 'vocal' : 'textuel'} dans ${server.name}.`,
    label: 'Nom du salon',
    placeholder: kind === 'voice' ? 'détente' : 'annonces',
    submitLabel: 'Créer le salon',
    onSubmit: async (name) => {
      const c = await call<Channel>(`/servers/${server.id}/channels`, { name, kind });
      setServer((s) => s && { ...s, channels: addUnique(s.channels, [c]) });
      if (kind === 'text') await openConversation(c);
      else setStage(c);
    },
  });

  const newDm = () => setDialog({
    title: 'Nouveau message',
    description: 'Écris à quelqu’un avec qui tu partages au moins un serveur.',
    label: 'Pseudo',
    placeholder: 'pseudo',
    submitLabel: 'Ouvrir la conversation',
    onSubmit: startDm,
  });

  const logout = act(async () => {
    await call('/logout', {}).catch(() => {});
    onLogout();
  });

  if (!me) return null;

  const perms = server?.perms ?? 0;
  const isOwner = server?.owner_id === me.id;
  const canSettings = has(perms, Perm.MANAGE_ROLES) || has(perms, Perm.MANAGE_SERVER);
  const canInvite = has(perms, Perm.CREATE_INVITES) || has(perms, Perm.MANAGE_SERVER);
  const dmBubbles = dms.filter((d) => unread[d.id]?.count).map((dm) => ({ dm, count: unread[dm.id].count }));
  const serverUnread = (id: number) => Object.values(unread).some((u) => u.server_id === id);
  const voiceRoom = voice.channelId !== null ? rooms[voice.channelId] : undefined;
  const inDmCall = voiceRoom?.server_id === null;
  const serverMuted = !!server && !!me.servers.find((s) => s.id === server.id)?.muted;
  const typingHere = conversation ? Object.values(typing[conversation.id] ?? {}).map((u) => u.name) : [];
  const menuRoom = participantMenu && Object.values(rooms).find((r) => r.participants.some((x) => x.client_id === participantMenu.p.client_id));
  const authorColor = (m: Message) => {
    const member = server?.members.find((x) => x.id === m.user_id);
    return server && member ? memberColor(server, member) : nameColor(m.name);
  };

  return (
    <div className="flex h-full">
      {/* ponytail: rail sans scroll pour que les tooltips CSS débordent ; passer à un portal si on dépasse ~12 serveurs. */}
      <nav aria-label="Serveurs" className="relative z-20 flex w-[72px] shrink-0 flex-col items-center gap-2 py-3">
        <RailSlot label="Messages privés" active={home}>
          <button aria-label="Messages privés" onClick={act(openHome)} className={`relative transition ${home ? '' : 'opacity-90 hover:opacity-100'}`}>
            <Logo className={`size-12 transition-all ${home ? 'rounded-2xl' : 'rounded-3xl hover:rounded-2xl'}`} />
            {friends.incoming.length > 0 && <Badge>{friends.incoming.length}</Badge>}
            {inDmCall && <VoiceBadge self />}
          </button>
        </RailSlot>
        {/* Bulles de notification : les personnes qui t'ont écrit */}
        {dmBubbles.map(({ dm, count }) => (
          <RailSlot key={dm.id} label={dm.user.name}>
            <button aria-label={`Messages de ${dm.user.name}`} onClick={act(() => showDm(dm))} className="relative animate-rise transition hover:scale-105">
              <Avatar user={dm.user} className="size-12 text-base" />
              <Badge>{count}</Badge>
            </button>
          </RailSlot>
        ))}
        <div className="my-1 h-px w-8 bg-line" />
        {me.servers.map((s) => {
          const occupied = Object.values(rooms).some((r) => r.server_id === s.id);
          return (
            <RailSlot key={s.id} label={s.name} active={s.id === server?.id} unread={!s.muted && serverUnread(s.id)}>
              <button
                aria-label={s.name}
                onClick={act(() => openServer(s.id))}
                onContextMenu={(e) => { e.preventDefault(); setServerMenu({ id: s.id, x: e.clientX, y: e.clientY }); }}
                className={`relative grid size-12 place-items-center text-sm font-semibold transition-all duration-200 ${s.id === server?.id
                  ? 'rounded-2xl bg-accent/20 text-white shadow-lg shadow-accent/20 ring-2 ring-accent/70'
                  : 'rounded-3xl bg-ink-800 text-fg/80 hover:rounded-2xl hover:bg-ink-700 hover:text-fg'}`}
              >
                {serverInitials(s.name)}
                {occupied && <VoiceBadge self={voiceRoom?.server_id === s.id} />}
                {s.muted && <span title="Notifications coupées" className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-ink-700 text-muted ring-4 ring-ink-950"><Icon name="bellOff" className="size-3" /></span>}
              </button>
            </RailSlot>
          );
        })}
        <RailSlot label="Créer un serveur" action>
          <button aria-label="Créer un serveur" onClick={createServer} className="grid size-12 place-items-center rounded-3xl bg-ink-800 text-ok transition-all hover:rounded-2xl hover:bg-ok hover:text-ink-950">
            <Icon name="plus" />
          </button>
        </RailSlot>
        <RailSlot label="Rejoindre un serveur" action>
          <button aria-label="Rejoindre un serveur" onClick={joinServer} className="grid size-12 place-items-center rounded-3xl bg-ink-800 text-ok transition-all hover:rounded-2xl hover:bg-ok hover:text-ink-950">
            <Icon name="link" />
          </button>
        </RailSlot>
      </nav>

      <div className="flex min-w-0 flex-1 overflow-hidden rounded-tl-2xl border-t border-l border-line bg-ink-900">
        <aside className="flex w-72 shrink-0 flex-col border-r border-line">
          {home ? (
            <>
              <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
                <h2 className="flex-1 truncate font-semibold tracking-tight">Messages privés</h2>
                <button aria-label="Nouveau message" title="Nouveau message" onClick={newDm} className={iconButton}><Icon name="plus" className="size-4" /></button>
              </header>
              <nav aria-label="Conversations privées" className="flex-1 space-y-0.5 overflow-y-auto p-3">
                <button
                  onClick={leaveConversation}
                  aria-current={!conversation ? 'page' : undefined}
                  className={`mb-3 flex w-full items-center gap-3 rounded-lg px-2 py-2 font-medium transition ${!conversation ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}
                >
                  <span className="grid size-8 place-items-center"><Icon name="users" className="size-5" /></span>
                  <span className="flex-1 text-left">Amis</span>
                  {friends.incoming.length > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-err px-1.5 text-[11px] font-bold text-white">{friends.incoming.length}</span>
                  )}
                </button>
                <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Messages privés</div>
                {dms.map((dm) => {
                  const active = dm.id === conversation?.id;
                  const count = unread[dm.id]?.count ?? 0;
                  const calling = !!rooms[dm.id];
                  return (
                    <div key={dm.id} className="group relative">
                      <button
                        onClick={act(() => openDm(dm))}
                        aria-current={active ? 'page' : undefined}
                        className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 pr-9 transition ${active ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}
                      >
                        <Avatar user={dm.user} status={presence[dm.user.id] ?? 'offline'} ring="border-ink-900" className="size-8 text-xs" />
                        <span className={`flex-1 truncate text-left ${count ? 'font-semibold text-fg' : ''}`}>{dm.user.name}</span>
                        {calling && <span title="Appel en cours" className="text-ok"><Icon name="phone" className="size-3.5" /></span>}
                        {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-err px-1.5 text-[11px] font-bold text-white group-hover:hidden">{count}</span>}
                      </button>
                      <button
                        aria-label={`Fermer la conversation avec ${dm.user.name}`}
                        title="Fermer la conversation (l'historique est conservé)"
                        onClick={act(() => closeDm(dm))}
                        className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-subtle opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.08] hover:text-fg focus-visible:opacity-100"
                      >
                        <Icon name="x" className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
                {!dms.length && (
                  <p className="px-2 py-4 text-sm leading-relaxed text-subtle">
                    Aucune conversation. Écris à un ami, à un membre d&apos;un serveur, ou clique sur <b className="text-muted">+</b>.
                  </p>
                )}
              </nav>
            </>
          ) : (
            <>
              <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
                <h2 className="truncate font-semibold tracking-tight">{server?.name}</h2>
                {isOwner ? (
                  <span title="Tu es propriétaire de ce serveur" className="shrink-0 text-amber-400"><Icon name="crown" className="size-4" /></span>
                ) : has(perms, Perm.ADMINISTRATOR) && (
                  <span title="Tu es administrateur de ce serveur" className="shrink-0 text-accent"><Icon name="shield" className="size-4" /></span>
                )}
                {server && (
                  <button
                    aria-label={serverMuted ? 'Réactiver les notifications du serveur' : 'Couper les notifications du serveur'}
                    title={serverMuted ? 'Réactiver les notifications' : 'Couper les notifications (son et pastilles)'}
                    aria-pressed={serverMuted}
                    onClick={act(() => setServerMuted(server.id, !serverMuted))}
                    className={`${iconButton} ml-auto ${serverMuted ? 'text-err' : ''}`}
                  >
                    <Icon name={serverMuted ? 'bellOff' : 'bell'} className="size-4" />
                  </button>
                )}
                {canSettings && (
                  <button aria-label="Paramètres du serveur" title="Paramètres du serveur" onClick={() => setPanel('settings')} className={iconButton}>
                    <Icon name="settings" className="size-4" />
                  </button>
                )}
              </header>
              <nav aria-label="Salons" className="flex-1 overflow-y-auto p-3">
                {server && (
                  <div className="mb-1.5 flex items-center justify-between px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                    <span>Salons textuels</span>
                    {has(perms, Perm.MANAGE_CHANNELS) && (
                      <button aria-label="Créer un salon textuel" title="Créer un salon textuel" onClick={() => createChannel('text')} className="rounded p-0.5 transition hover:text-fg">
                        <Icon name="plus" className="size-4" />
                      </button>
                    )}
                  </div>
                )}
                <div className="space-y-0.5">
                  {server?.channels.filter((c) => c.kind === 'text').map((c) => {
                    const active = !stage && c.id === conversation?.id;
                    const isUnread = !active && !!unread[c.id];
                    return (
                      <button
                        key={c.id}
                        onClick={act(() => openConversation(c))}
                        aria-current={active ? 'page' : undefined}
                        className={`relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 transition ${active ? 'bg-white/[0.07] text-fg' : isUnread ? 'font-semibold text-fg hover:bg-white/[0.04]' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}
                      >
                        {isUnread && <span className="absolute top-1/2 -left-3 h-2 w-1 -translate-y-1/2 rounded-r-full bg-fg" />}
                        <Icon name="hash" className={`size-4 shrink-0 ${active ? 'text-accent' : isUnread ? '' : 'opacity-60'}`} />
                        <span className="truncate">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
                {server && (server.channels.some((c) => c.kind === 'voice') || has(perms, Perm.MANAGE_CHANNELS)) && (
                  <>
                    <div className="mt-5 mb-1.5 flex items-center justify-between px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                      <span>Salons vocaux</span>
                      {has(perms, Perm.MANAGE_CHANNELS) && (
                        <button aria-label="Créer un salon vocal" title="Créer un salon vocal" onClick={() => createChannel('voice')} className="rounded p-0.5 transition hover:text-fg">
                          <Icon name="plus" className="size-4" />
                        </button>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {server.channels.filter((c) => c.kind === 'voice').map((c) => (
                        <VoiceChannelItem
                          key={c.id}
                          channel={c}
                          participants={server.voice[c.id] ?? []}
                          active={stage?.id === c.id}
                          voice={voice}
                          onClick={act(() => openVoice(c))}
                          onMenu={openParticipantMenu}
                        />
                      ))}
                    </div>
                  </>
                )}
              </nav>
            </>
          )}
          {voice.channelId !== null && (
            <VoicePanel
              voice={voice}
              onSettings={() => setPanel('av')}
              notify={notify}
              onOpen={() => {
                if (inDmCall) {
                  const dm = dms.find((d) => d.id === voice.channelId);
                  if (dm) act(() => showDm(dm))();
                  return;
                }
                const c = server?.channels.find((x) => x.id === voice.channelId);
                if (c) setStage(c);
              }}
            />
          )}
          <footer className="relative m-2 flex items-center gap-1 rounded-xl bg-ink-950/60 p-1.5 ring-1 ring-line">
            {statusMenu && (
              <StatusMenu
                me={me}
                onStatus={(status) => { setStatus(status).catch((e) => notify(errorMessage(e))); }}
                onEditProfile={() => { setStatusMenu(false); setPanel('profile'); }}
                onCopyId={() => { setStatusMenu(false); navigator.clipboard.writeText(`${me.name}#${me.tag}`).then(() => notify('Identifiant copié'), () => notify('Copie impossible')); }}
                onClose={() => setStatusMenu(false)}
              />
            )}
            <button
              onClick={() => setStatusMenu((v) => !v)}
              aria-expanded={statusMenu}
              title="Statut et profil"
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 text-left transition hover:bg-white/[0.06] ${statusMenu ? 'bg-white/[0.06]' : ''}`}
            >
              <Avatar user={me} status={me.status} ring="border-ink-950" className="size-9 text-xs" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold">{me.name}</span>
                <span className="block truncate text-xs text-subtle">{{ online: 'Connecté', idle: 'Absent', dnd: 'Occupé', invisible: 'Invisible' }[me.status]}</span>
              </span>
            </button>
            <button aria-label="Réglages audio et vidéo" title="Réglages audio et vidéo" onClick={() => setPanel('av')} className="rounded-lg p-2 text-muted transition hover:bg-white/[0.06] hover:text-fg">
              <Icon name="sliders" className="size-[18px]" />
            </button>
            <button aria-label="Se déconnecter" title="Se déconnecter" onClick={logout} className="rounded-lg p-2 text-muted transition hover:bg-err/10 hover:text-err">
              <Icon name="logout" className="size-[18px]" />
            </button>
          </footer>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-ink-850">
          {stage && server && !home ? (
            <VoiceStage channel={stage} server={server} voice={voice} onJoin={act(() => openVoice(stage))} onSettings={() => setPanel('av')} onMenu={openParticipantMenu} notify={notify} />
          ) : conversation ? (
            <ConversationView
              key={conversation.id}
              conversation={conversation}
              server={conversation.dm ? null : server}
              messages={messages}
              hasMore={hasMore}
              canSend={conversation.dm ? true : has(perms, Perm.SEND_MESSAGES)}
              boxRef={boxRef}
              inputRef={inputRef}
              onScroll={onScroll}
              onSend={send}
              onInvite={!conversation.dm && canInvite ? () => setPanel('invite') : undefined}
              authorColor={authorColor}
              typing={typingHere}
              onTyping={sendTyping}
              onCall={conversation.dm ? (video) => act(() => joinCall(conversation.id, conversation.dm!, video))() : undefined}
              callArea={conversation.dm && (rooms[conversation.id] || voice.channelId === conversation.id) && (
                <CallArea
                  channelId={conversation.id}
                  peer={conversation.dm}
                  participants={rooms[conversation.id]?.participants ?? []}
                  voice={voice}
                  onJoin={(video) => act(() => joinCall(conversation.id, conversation.dm!, video))()}
                  onSettings={() => setPanel('av')}
                  onMenu={openParticipantMenu}
                  notify={notify}
                />
              )}
            />
          ) : home ? (
            <FriendsPanel
              me={me}
              friends={friends}
              call={call}
              notify={notify}
              onMessage={startDm}
              presence={presence}
              empty={!me.servers.length && <button onClick={createServer} className={ghostButton}><Icon name="plus" className="size-4" /> Créer un serveur</button>}
            />
          ) : (
            <Welcome title={`Bienvenue sur Agora, ${me.name}`} text="Crée ton premier serveur ou rejoins tes amis avec un lien d'invitation.">
              <button onClick={createServer} className={primaryButton}><Icon name="plus" className="size-4" /> Créer un serveur</button>
              <button onClick={joinServer} className={ghostButton}><Icon name="link" className="size-4" /> Rejoindre</button>
            </Welcome>
          )}
        </main>

        {server && !home && <MemberList server={server} presence={presence} onSelect={setMemberId} />}
      </div>

      <PromptDialog config={dialog} onClose={() => setDialog(null)} />
      <AvSettingsDialog open={panel === 'av'} onClose={() => setPanel(null)} voice={voice} notify={notify} />
      {server && (
        <>
          <ServerSettings open={panel === 'settings'} onClose={() => setPanel(null)} server={server} call={call} notify={notify} refresh={() => refreshServer()} />
          <InviteDialog open={panel === 'invite'} onClose={() => setPanel(null)} server={server} me={me} call={call} notify={notify} />
        </>
      )}
      <MemberDialog
        memberId={memberId}
        server={server}
        me={me}
        call={call}
        notify={notify}
        refresh={() => refreshServer()}
        friends={friends}
        presence={presence}
        onDm={startDm}
        onClose={() => setMemberId(null)}
      />
      <ProfileDialog open={panel === 'profile'} onClose={() => setPanel(null)} me={me} token={token} call={call} notify={notify} reload={reloadMe} />
      {participantMenu && (
        <ParticipantMenu
          key={participantMenu.p.client_id + participantMenu.x + participantMenu.y}
          participant={menuRoom?.participants.find((x) => x.client_id === participantMenu.p.client_id) ?? participantMenu.p}
          x={participantMenu.x}
          y={participantMenu.y}
          server={menuRoom?.server_id != null && server?.id === menuRoom.server_id ? server : null}
          voice={voice}
          call={call}
          notify={notify}
          onProfile={setMemberId}
          onDm={startDm}
          onClose={() => setParticipantMenu(null)}
        />
      )}

      {serverMenu && (() => {
        const s = me.servers.find((x) => x.id === serverMenu.id);
        if (!s) return null;
        return (
          <PopupMenu x={serverMenu.x} y={serverMenu.y} onClose={() => setServerMenu(null)} className="w-60">
            <div className="truncate px-2.5 pt-1 pb-2 text-xs font-semibold text-subtle">{s.name}</div>
            <MenuItem icon="check" onClick={() => { markServerRead(s.id); setServerMenu(null); }}>Marquer comme lu</MenuItem>
            <MenuCheck checked={s.muted} onClick={act(() => setServerMuted(s.id, !s.muted))}>Rendre muet le serveur</MenuCheck>
          </PopupMenu>
        );
      })()}

      {incoming && (
        <div role="alertdialog" aria-label={`Appel de ${incoming.from.name}`} className="fixed right-6 bottom-6 z-50 w-80 animate-rise overflow-hidden rounded-2xl border border-line bg-ink-900/95 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <div className="flex flex-col items-center text-center">
            <span className="relative grid place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-ok/30" />
              <Avatar user={incoming.from} className="relative size-20 text-2xl" />
            </span>
            <div className="mt-4 text-xs font-semibold tracking-wider text-ok uppercase">Appel entrant</div>
            <div className="mt-1 text-lg font-bold">{incoming.from.name}</div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button onClick={declineCall} className="inline-flex items-center justify-center gap-2 rounded-xl bg-err px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[.98]">
              <Icon name="phoneOff" className="size-4" /> Refuser
            </button>
            <button onClick={act(acceptCall)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ok px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:brightness-110 active:scale-[.98]">
              <Icon name="phone" className="size-4" /> Accepter
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div key={toast.id} role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 animate-rise rounded-xl border border-line bg-ink-800/95 px-4 py-2.5 text-sm shadow-2xl shadow-black/50 backdrop-blur">
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** Emplacement du rail : pastille d'état à gauche et infobulle au survol. */
function RailSlot({ label, active = false, action = false, unread = false, children }: { label: string; active?: boolean; action?: boolean; unread?: boolean; children: ReactNode }) {
  return (
    <div className="group relative flex w-full justify-center">
      <span className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-all ${active ? 'h-10' : action ? 'h-0' : unread ? 'h-2 group-hover:h-5' : 'h-0 group-hover:h-5'}`} />
      {children}
      <span role="tooltip" className="pointer-events-none absolute top-1/2 left-full ml-2 -translate-x-1 -translate-y-1/2 rounded-lg border border-line bg-ink-950 px-3 py-1.5 text-sm font-medium whitespace-nowrap opacity-0 shadow-xl transition group-hover:translate-x-0 group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

function Welcome({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="relative grid flex-1 place-items-center overflow-hidden p-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_60%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute top-1/3 left-1/2 size-[480px] -translate-x-1/2 rounded-full bg-accent/15 blur-[120px]" />
      <div className="relative max-w-md animate-rise text-center">
        <Logo className="mx-auto size-16" />
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted">{text}</p>
        <div className="mt-8 flex justify-center gap-3">{children}</div>
      </div>
    </div>
  );
}

/** Pastille rouge de compteur (non-lus, demandes d'ami). */
function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="absolute -right-1 -bottom-1 grid h-5 min-w-5 place-items-center rounded-full bg-err px-1 text-[11px] font-bold text-white ring-4 ring-ink-950">
      {children}
    </span>
  );
}

/** Haut-parleur sur un serveur où quelqu'un est en vocal (vert : tu y es). */
function VoiceBadge({ self }: { self: boolean }) {
  return (
    <span
      title={self ? 'Tu es en vocal ici' : "Quelqu'un est en vocal"}
      className={`absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full ring-4 ring-ink-950 ${self ? 'bg-ok text-ink-950' : 'bg-ink-700 text-fg'}`}
    >
      <Icon name="volume" className="size-3" />
    </span>
  );
}
