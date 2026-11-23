'use client';
import { ClerkProvider } from '@clerk/react';
import { ptBR } from '@clerk/localizations';

const clerkAppearance = {
  variables: {
    colorPrimary: '#0D6E52',
    colorPrimaryForeground: '#FFFFFF',
    colorBackground: '#FFFFFF',
    colorForeground: '#101618',
    colorMutedForeground: '#526065',
    colorNeutral: '#101618',
    colorInput: '#FFFFFF',
    colorInputForeground: '#101618',
    colorDanger: '#B23232',
    colorSuccess: '#146C4B',
    borderRadius: '10px',
    fontFamily: 'var(--font-sans), system-ui, sans-serif',
    fontFamilyButtons: 'var(--font-sans), system-ui, sans-serif',
  },
  elements: {
    rootBox: {
      width: '100%',
      maxWidth: '400px',
    },
    cardBox: {
      width: '100%',
      maxWidth: '400px',
      boxShadow: '0 20px 50px -24px rgba(11, 14, 16, 0.22)',
      border: '1px solid #DCE2DF',
      borderRadius: '16px',
    },
    card: {
      boxShadow: 'none',
      border: 'none',
      backgroundColor: '#FFFFFF',
    },
    headerTitle: {
      fontFamily: 'var(--font-display), system-ui, sans-serif',
      letterSpacing: '-0.02em',
      fontWeight: 600,
    },
    formButtonPrimary: {
      backgroundColor: '#0D6E52',
      boxShadow: 'none',
      fontWeight: 600,
    },
    footerActionLink: {
      color: '#0D6E52',
      fontWeight: 600,
    },
  },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const key =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    'pk_test_ZWxlY3RyaWMtaWJleC0yMzQxLmNsZXJrLmFjY291bnRzLmRldiQ';
  if (!key)
    return (
      <main className="login">
        <h1>Acesso em configuração</h1>
        <p>A configuração do login ainda não foi concluída.</p>
      </main>
    );
  return (
    <ClerkProvider
      publishableKey={key}
      localization={ptBR}
      appearance={clerkAppearance}
    >
      {children}
    </ClerkProvider>
  );
}
