# Agora

Alternative open source à Discord : serveurs, salons textuels, messages en temps réel.

Next.js 16 (App Router) pour le front et le back, TypeScript, Tailwind CSS 4, SQLite intégré à Node (`node:sqlite`) : aucune base à installer. Node.js ≥ 22.13.

## Lancer

```sh
npm install
npm run dev      # http://localhost:3000
npm run build && npm start   # production
npm test         # parcours complet de l'API (lance son propre next dev sur une base en mémoire)
npm run typecheck
```

Variables : `DB` (chemin de la base, défaut `agora.db`), `PORT` (géré par Next),
`NEXT_PUBLIC_ICE_SERVERS` (JSON, serveurs STUN/TURN pour le vocal ; STUN public par défaut — un TURN est nécessaire derrière certains NAT).

## Ce qui marche

- **Comptes** : pseudo + mot de passe (scrypt), sessions par token, identifiant public `pseudo#1234`
- **Profil** : photo, bannière (image ou couleur), bio, pseudo modifiable ; changement de mot de passe (déconnecte les autres appareils)
- **Statuts** : Connecté, Absent, Occupé (sons de notification coupés), Invisible ; présence en direct
- **Serveurs** : salons textuels, membres, messages en temps réel (Server-Sent Events), historique paginé
- **Rôles et permissions** : `@everyone` + rôles personnalisés (nom, couleur, 7 permissions), affichés dans la liste des membres.
  Règle anti-escalade : on ne peut accorder, retirer ou modérer que des permissions qu'on possède soi-même.
- **Invitations** : liens `/invite/<code>` expirables (30 min → jamais), révocables, avec compteur d'utilisations ;
  lien personnalisé `/invite/mon-serveur` ; page d'invitation publique avec aperçu du serveur
- **Messages privés** : entre amis ou membres d'un serveur commun
- **Amis** : demande par identifiant complet (`pseudo#1234`), acceptation / refus / retrait, demandes croisées acceptées d'office
- **Salons vocaux et vidéo** (WebRTC, maillage complet) :
  - Opus 48 kHz, débit réglable de 64 à 256 kb/s, correction d'erreurs (FEC), sans DTX, priorité réseau haute
  - Chaîne d'entrée dans un AudioWorklet : volume du micro, détection de la voix (seuil auto ou manuel), appuyer-pour-parler
  - Suppression du bruit, annulation de l'écho, contrôle du gain ; mode musique (stéréo, sans traitement)
  - Choix du micro, de la sortie audio et de la caméra, changement à chaud sans coupure
  - Caméra jusqu'en 1080p / 30 i/s, activable sans renégociation
  - Volume par personne, test du micro (s'écouter), indicateur de parole, ping et pertes de paquets
  - Sons d'interface et de notification (arrivées / départs, messages privés)
  - Clic droit sur un participant : volume, sourdine et caméra masquée pour soi ; modération (rendre muet pour tous, déconnecter, exclure)
- **Migrations** de base versionnées (`PRAGMA user_version`) : les bases existantes sont mises à jour sans perte

## Architecture

| Fichier | Rôle |
|---|---|
| `app/page.tsx`, `app/chat.tsx` | Application (rail des serveurs, navigation, temps réel) |
| `app/conversation.tsx` | Vue d'un salon ou d'une conversation privée |
| `app/members.tsx` | Liste des membres groupés par rôle, fiche membre |
| `app/settings.tsx` | Paramètres du serveur (rôles, lien personnalisé), invitations |
| `app/friends.tsx` | Page Amis |
| `app/profile.tsx` | Menu de statut, édition du profil et du mot de passe |
| `app/voice.tsx`, `app/av-settings.tsx` | Salon vocal (tuiles, contrôles), réglages audio / vidéo |
| `lib/voice.ts` | Moteur WebRTC : connexions, signalisation, chaîne audio, qualité |
| `app/invite/[code]/page.tsx` | Page d'invitation |
| `app/auth.tsx`, `app/ui.tsx` | Connexion, composants d'interface |
| `app/api/**/route.ts` | Routes API |
| `lib/server.ts` | Base SQLite et migrations, auth, permissions, temps réel |
| `lib/shared.ts` | Permissions et règles partagées client / serveur |
| `lib/types.ts` | Types partagés |
| `test.ts` | Test de bout en bout de l'API (part d'une base v1 pour tester les migrations) |

### API

| Route | Usage |
|---|---|
| `POST /api/register` · `login` · `logout`, `GET /api/me` | Comptes |
| `POST /api/servers`, `GET` · `PATCH /api/servers/:id` | Serveurs (PATCH : lien personnalisé) |
| `POST /api/servers/:id/channels` | Salons |
| `POST /api/servers/:id/roles`, `PATCH` · `DELETE /api/roles/:id` | Rôles |
| `PATCH` · `DELETE /api/servers/:id/members/:userId` | Rôles d'un membre, exclusion |
| `GET` · `POST /api/servers/:id/invites` | Invitations d'un serveur |
| `GET` · `POST` · `DELETE /api/invites/:code` | Aperçu public, rejoindre, révoquer (code ou lien personnalisé) |
| `GET` · `POST /api/dms` | Conversations privées |
| `GET` · `POST /api/friends`, `POST` · `DELETE /api/friends/:id` | Amis et demandes |
| `GET` · `PATCH /api/me`, `POST /api/me/password`, `PUT` · `DELETE /api/me/avatar` · `/banner` | Mon profil, statut, mot de passe, images |
| `GET /api/users/:id`, `GET /api/users/:id/avatar` · `/banner` | Profil public, images |
| `GET /api/presence` | Présence des utilisateurs visibles |
| `DELETE /api/servers/:id/members/:userId/voice` | Déconnecter du vocal (`PATCH …/members/:userId` avec `voice_muted` : rendre muet) |
| `GET` · `POST /api/channels/:id/messages` | Messages (salons et conversations privées) |
| `POST` · `PATCH` · `DELETE /api/voice/:channelId` | Rejoindre un salon vocal, micro / son / caméra, quitter |
| `POST /api/voice/signal` | Relais de signalisation WebRTC |
| `GET /api/events` | Flux temps réel (dont présence vocale et signalisation) |

## Feuille de route

- Édition / suppression de messages, pièces jointes
- Présence en ligne, indicateur « en train d'écrire »
- Hiérarchie des rôles (ordre réglable), permissions par salon
- Partage d'écran
- SFU (LiveKit, mediasoup) au-delà de ~6 personnes par salon vocal
- Rate limiting (connexion, demandes d'ami), expiration des sessions
- Layout mobile
- Scalabilité horizontale (Redis pub/sub à la place du fan-out en mémoire)

## Licence

MIT
