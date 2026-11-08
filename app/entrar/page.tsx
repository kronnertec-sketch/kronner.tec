'use client';
import {useState,useEffect} from 'react';
import {SignIn,SignUp,useAuth} from '@clerk/react';
import Link from 'next/link';
import {safeReturn} from '@/lib/domain';
export default function Login(){
 const [signup,S]=useState(false),[next,N]=useState('/painel'),[ready,R]=useState(false);
 const {isLoaded,isSignedIn}=useAuth();
 useEffect(()=>{const q=new URLSearchParams(location.search);N(safeReturn(q.get('next')));S(q.get('mode')==='signup');R(true)},[]);
 useEffect(()=>{if(ready&&isLoaded&&isSignedIn)location.replace(next)},[ready,isLoaded,isSignedIn,next]);
 const query='&next='+encodeURIComponent(next);
 return <main className="login"><Link href="/" className="brand"><img src="/kroner.svg" alt="Kroner" width="155" height="39"/></Link><div className="eyebrow">TEMPO PARA O SEU TALENTO</div>{!ready||!isLoaded?<p role="status">Carregando acesso seguro…</p>:isSignedIn?<p role="status">Entrando…</p>:<><p>{signup?'Confirme seu e-mail com o código enviado pelo Clerk.':'Entre para continuar de onde parou.'}</p>{signup?<SignUp routing="hash" signInUrl={'/entrar?mode=signin'+query} forceRedirectUrl={next}/>:<SignIn routing="hash" signUpUrl={'/entrar?mode=signup'+query} forceRedirectUrl={next}/>}<small>Já usava a Kroner antes? No primeiro acesso pelo Clerk, crie sua conta com o mesmo e-mail e confirme o código para recuperar seus dados.</small></>}<small>Seu acesso é individual. Não compartilhe sua senha ou código.</small></main>
}
