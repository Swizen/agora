// Types partagés entre l'API et le client.
// Identifiant public : name#tag. avatar : version de la photo de profil (0 : aucune).
export type User = { id: number; name: string; tag: number; avatar: number };
/** Statut choisi par l'utilisateur ; « invisible » le fait apparaître hors ligne. */
export type Status = 'online' | 'idle' | 'dnd' | 'invisible';
/** Ce que les autres voient. */
export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export type Profile = User & { bio: string; banner_color: string | null; banner: number };
export type ServerSummary = { id: number; name: string };
export type Me = Profile & { status: Status; servers: (ServerSummary & { muted: boolean })[] }; // muted : notifications du serveur coupées
export type Channel = { id: number; server_id: number; name: string; kind: 'text' | 'voice' };
/** Une connexion présente dans un salon vocal (un utilisateur peut avoir plusieurs onglets ; un seul parle à la fois). */
export type VoiceFlags = { muted: boolean; deafened: boolean; video: boolean };
export type VoiceParticipant = VoiceFlags & { client_id: string; user: User; server_muted: boolean }; // server_muted : rendu muet par un modérateur
export type SignalData = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
export type Role = { id: number; name: string; color: string; permissions: number; is_default: boolean };
export type ServerMember = User & { roles: number[] };
export type ServerDetail = ServerSummary & {
  owner_id: number;
  vanity: string | null;
  perms: number; // permissions effectives de l'utilisateur courant
  channels: Channel[];
  members: ServerMember[];
  roles: Role[];   // @everyone en premier, puis par ordre de création
  voice: Record<number, VoiceParticipant[]>; // participants par salon vocal
};
export type Message = { id: number; channel_id: number; user_id: number; name: string; avatar: number; body: string; created_at: number };
export type Dm = { id: number; user: User; last_at: number | null };
/** Salon vocal ou appel privé occupé. */
export type VoiceRoom = { server_id: number | null; channel_id: number; participants: VoiceParticipant[] };
export type Friends = { friends: User[]; incoming: User[]; outgoing: User[] };
export type Invite = { code: string; creator: string; expires_at: number | null; uses: number; created_at: number };
export type InvitePreview = { code: string; server: ServerSummary & { members: number }; expires_at: number | null };

// Événements du flux temps réel (/api/events).
export type Events = {
  msg: Message & { server_id: number | null };  // server_id null : message privé
  channel: Channel;
  member: ServerMember & { server_id: number };
  server: { server_id: number };                // le serveur a changé (rôles, membres, lien…) : à recharger
  friends: Record<string, never>;               // la liste d'amis ou les demandes ont changé : à recharger
  presence: { user_id: number; status: Presence };
  user: { user: User };                         // pseudo ou photo modifiés
  hello: { client_id: string };                 // identifiant de cette connexion (adresse de la signalisation WebRTC)
  voice: VoiceRoom;                               // server_id null : appel privé
  typing: { channel_id: number; user: User };      // quelqu'un écrit dans un salon ou une conversation
  call: { channel_id: number; from: User };        // appel privé entrant
  call_stop: { channel_id: number };               // sonnerie à arrêter (appel refusé depuis un autre onglet)
  call_declined: { channel_id: number; user: User };
  signal: { from: string; data: SignalData };   // message WebRTC relayé depuis un autre participant
};
