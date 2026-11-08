'use client';
import {ClerkProvider} from '@clerk/react';
import {ptBR} from '@clerk/localizations';
export function AuthProvider({children}:{children:React.ReactNode}) {
 const key=process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||'pk_test_c3BsZW5kaWQtc2hhZC00MzMwLmNsZXJrLmFjY291bnRzLmRldiQ';
 if(!key)return <main className="login"><h1>Acesso em configuração</h1><p>A configuração do login ainda não foi concluída.</p></main>;
 return <ClerkProvider publishableKey={key} localization={ptBR}>{children}</ClerkProvider>;
}
