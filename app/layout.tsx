import './globals.css';
import {AuthProvider} from '@/lib/auth-provider';
export const metadata={title:'Kroner · Tempo para o seu talento',description:'Agenda e gestão da sua barbearia.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body><AuthProvider>{children}</AuthProvider></body></html>}
