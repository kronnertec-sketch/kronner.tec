import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-provider';
import { CookieConsent } from '@/components/CookieConsent';

export const metadata: Metadata = {
  title: 'Kronner · Tempo para o seu talento',
  description:
    'Agenda por cadeira, link público para clientes, feriados automáticos pelo CEP e financeiro com comissões para barbearias.',
  icons: {
    icon: '/kroner.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#0B0E10',
  width: 'device-width',
  initialScale: 1,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=Host+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <AuthProvider>
          {children}
          <CookieConsent />
        </AuthProvider>
      </body>
    </html>
  );
}
