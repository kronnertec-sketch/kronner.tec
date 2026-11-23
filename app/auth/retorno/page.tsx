'use client';
import {useEffect} from 'react';
import {safeReturn} from '@/lib/domain';
export default function AuthReturn(){
 useEffect(()=>{const next=safeReturn(new URLSearchParams(location.search).get('next'));location.replace('/entrar?next='+encodeURIComponent(next))},[]);
 return <main className="login"><p role="status">Abrindo o acesso seguro da Kronner…</p></main>;
}
