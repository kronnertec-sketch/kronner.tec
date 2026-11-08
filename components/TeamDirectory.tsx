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
 return (
  <section className="card">
   <h2>Diretório e comissões da equipe</h2>
   <details className="ux-accordion">
    <summary>Clientes cadastrados ({clients.length})</summary>
    <div className="ux-accordion-body">
     <label>Buscar por nome<input placeholder="Digite o nome do cliente…" value={term} onChange={e=>setTerm(e.target.value)}/></label>
     <div className="filter-pills" style={{marginBottom:14}}>
      {labels.map(f=>(
       <button
        type="button"
        key={f}
        className={'filter-pill '+(flags.includes(f)?'active':'')}
        onClick={()=>setFlags(flags.includes(f)?flags.filter(x=>x!==f):[...flags,f])}
       >
        {f}
       </button>
      ))}
     </div>
     {clients.filter(c=>c.name.toLowerCase().includes(term.toLowerCase())&&flags.every(f=>[c.receivable,c.debt,c.last&&Date.parse(c.last)<cutoff,c.monthly][labels.indexOf(f)])).map(c=>(
      <div className="line" key={c.id}>
       <b>{c.name}</b>
       <span>{c.last?c.last.split('-').reverse().join('/'):'Ainda não atendido'}</span>
      </div>
     ))}
    </div>
   </details>
   {canSeeFinance&&<Earnings/>}
   {canSeeFinance&&(
    <details className="ux-accordion">
     <summary>Meus recebimentos ({payments.length})</summary>
     <div className="ux-accordion-body">
      {payments.length===0&&<p style={{margin:0}}>Nenhum recebimento registrado.</p>}
      {payments.map((p,i)=>(
       <div className="line" key={i}>
        <span>{p.day.split('-').reverse().join('/')} · {p.method.toUpperCase()}</span>
        <span><b>{money(p.amount)}</b> <small style={{display:'inline'}}>(taxa {money(p.fee)})</small></span>
       </div>
      ))}
     </div>
    </details>
   )}
   {error&&<p role="alert" className="notice danger">{error}</p>}
  </section>
 );
}
