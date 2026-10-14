import { publicHandler, imageResponse, one } from '@/lib/server';

// Public : les balises <img> ne peuvent pas envoyer d'en-tête d'authentification.
export const GET = publicHandler(({ id }) => imageResponse(one<{ banner: Uint8Array | null }>('SELECT banner FROM users WHERE id = ?', id)?.banner));
