import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'diga-me',
  description: 'Possíveis identificações de figuras públicas em notícias.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
