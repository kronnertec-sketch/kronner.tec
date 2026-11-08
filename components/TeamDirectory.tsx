'use client';
import {Earnings} from './Management';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/supabase';
import {money,today} from '@/lib/domain';
type Client={id:string;name:string;last:string|null;monthly:boolean;receivable:boolean;debt:boolean};
type Payment={day:string;amount:number;fee:number;method:string};
export default function TeamDirectory({canSeeFinance}:{canSeeFinance:boolean}){
 const api=useApi(),[clients,setClients]=useState<Client[]>([]),[payments,setPayments]=useState<Payment[]>([]),[term,setTerm]=useState(''),[flags,setFlags]=useState<string[]>([]),[error,setError]=useState('');
 useEffect(()=>{api('team:clients').then(setClients).catch(e=>setError(e.message));if(canSeeFinance)api('team:individual_finance').then(setPayments).catch(e=>setError(e.message))},[api,canSeeFinance]);
 const cutoff=Date.parse(today())-30*86400000;
 const labels=['A receber','Com dívida','Sem cortar há mais de 30 dias','Mensalistas'];
 return <section className="card"><details><summary>Clientes cadastrados</summary><label>Buscar por nome<input value={term} onChange={e=>setTerm(e.target.value)}/></label>{labels.map(f=><label key={f}><input type="checkbox" checked={flags.includes(f)} onChange={()=>setFlags(flags.includes(f)?flags.filter(x=>x!==f):[...flags,f])}/>{f}</label>)}{clients.filter(c=>c.name.toLowerCase().includes(term.toLowerCase())&&flags.every(f=>[c.receivable,c.debt,c.last&&Date.parse(c.last)<cutoff,c.monthly][labels.indexOf(f)])).map(c=><div className="line" key={c.id}><b>{c.name}</b><span>{c.last?c.last.split('-').reverse().join('/'):'Ainda não atendido'}</span></div>)}</details>
 {canSeeFinance&&<Earnings/>}{canSeeFinance&&<details><summary>Meus recebimentos</summary>{payments.length===0&&<p>Nenhum recebimento registrado.</p>}{payments.map((p,i)=><p key={i}>{p.day.split('-').reverse().join('/')} · {p.method} · {money(p.amount)} · taxa {money(p.fee)}</p>)}</details>}{error&&<p role="alert">{error}</p>}</section>;
}
