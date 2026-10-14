// Règles partagées entre l'API et le client.
import type { ServerDetail, ServerMember } from './types';

export const Perm = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  KICK_MEMBERS: 1 << 4,
  CREATE_INVITES: 1 << 5,
  SEND_MESSAGES: 1 << 6,
  CONNECT: 1 << 7,
  MUTE_MEMBERS: 1 << 8,
  MOVE_MEMBERS: 1 << 9,
} as const;

export const ALL_PERMS = Object.values(Perm).reduce((a, b) => a | b, 0);
export const DEFAULT_PERMS = Perm.SEND_MESSAGES | Perm.CREATE_INVITES | Perm.CONNECT;

export const PERMISSIONS: { flag: number; label: string; description: string }[] = [
  { flag: Perm.ADMINISTRATOR, label: 'Administrateur', description: 'Toutes les permissions, sans exception. À donner avec prudence.' },
  { flag: Perm.MANAGE_SERVER, label: 'Gérer le serveur', description: "Modifier le lien personnalisé et gérer toutes les invitations." },
  { flag: Perm.MANAGE_ROLES, label: 'Gérer les rôles', description: 'Créer, modifier et attribuer des rôles, dans la limite de ses propres permissions.' },
  { flag: Perm.MANAGE_CHANNELS, label: 'Gérer les salons', description: 'Créer de nouveaux salons.' },
  { flag: Perm.KICK_MEMBERS, label: 'Exclure des membres', description: 'Retirer des membres du serveur.' },
  { flag: Perm.CREATE_INVITES, label: 'Créer des invitations', description: "Générer des liens d'invitation." },
  { flag: Perm.SEND_MESSAGES, label: 'Envoyer des messages', description: 'Écrire dans les salons du serveur.' },
  { flag: Perm.CONNECT, label: 'Rejoindre les salons vocaux', description: 'Se connecter aux salons vocaux pour parler et écouter.' },
  { flag: Perm.MUTE_MEMBERS, label: 'Rendre muet les membres', description: 'Couper le micro de quelqu\'un pour tout le salon vocal.' },
  { flag: Perm.MOVE_MEMBERS, label: 'Déconnecter du vocal', description: 'Faire quitter un salon vocal à un membre.' },
];

export const has = (perms: number, flag: number) => (perms & flag) === flag;
/** On ne peut accorder, retirer ou modérer que des permissions qu'on possède soi-même. */
export const covers = (mine: number, target: number) => (target & ~mine) === 0;

/** Le propriétaire a tout ; sinon union des rôles (dont @everyone), Administrateur donnant tout. */
export function effectivePerms(isOwner: boolean, rolePerms: number[]) {
  if (isOwner) return ALL_PERMS;
  const perms = rolePerms.reduce((a, b) => a | b, 0);
  return has(perms, Perm.ADMINISTRATOR) ? ALL_PERMS : perms;
}

export const memberPerms = (server: ServerDetail, member: ServerMember) =>
  effectivePerms(member.id === server.owner_id, server.roles.filter((r) => r.is_default || member.roles.includes(r.id)).map((r) => r.permissions));

export const INVITE_DURATIONS: { seconds: number | null; label: string }[] = [
  { seconds: 1800, label: '30 min' },
  { seconds: 3600, label: '1 heure' },
  { seconds: 86_400, label: '1 jour' },
  { seconds: 604_800, label: '7 jours' },
  { seconds: null, label: 'Jamais' },
];
