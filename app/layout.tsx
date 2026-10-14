import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

export const metadata: Metadata = { title: 'Agora', description: 'Alternative open source à Discord' };
export const viewport: Viewport = { themeColor: '#08090c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`h-full ${geist.variable}`}>
      <body className="h-full bg-ink-950 font-sans text-[15px] text-fg antialiased">{children}</body>
    </html>
  );
}
