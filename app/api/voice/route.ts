import { handler, voiceRoomsOf } from '@/lib/server';

/** Salons vocaux et appels privés occupés (tous serveurs confondus), pour le rail et les conversations. */
export const GET = handler(({ user }) => voiceRoomsOf(user.id));
