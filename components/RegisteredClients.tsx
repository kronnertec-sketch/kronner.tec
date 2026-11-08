'use client';
import {useState} from 'react';
import type {Workspace} from '@/lib/types';
import {money} from '@/lib/domain';

const filters = ['A receber','Com dívida','Sem cortar há mais de 30 dias','Mensalistas'];

export default function RegisteredClients({data, day}:{data:Workspace; day:string}) {
  const [name,setName]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const threshold=new Date(day+'T12:00:00Z');
  threshold.setUTCDate(threshold.getUTCDate()-30);
  const cutoff=threshold.toISOString().slice(0,10);
  const rows=data.clients.filter(client=>client.user_id && client.name.toLocaleLowerCase('pt-BR').includes(name.trim().toLocaleLowerCase('pt-BR'))).map(client=>{
    const done=data.appointments.filter(a=>a.client===client.id && a.status==='done').sort((a,b)=>b.starts.localeCompare(a.starts));
    const last=done.length?new Intl.DateTimeFormat('en-CA',{timeZone:data.shop.cfg.timezone||'America/Sao_Paulo'}).format(new Date(done[0].starts)):null;
    const debts=data.charges.filter(c=>c.client===client.id && c.direction==='in').map(c=>({
      due:c.due, balance:c.amount-data.payments.filter(p=>p.charge===c.id).reduce((sum,p)=>sum+p.amount,0)
    })).filter(c=>c.balance>0);
    const flags=[debts.some(c=>!c.due||c.due>=day),debts.some(c=>c.due && c.due<cutoff),!!last && last<cutoff,data.memberships.some(m=>m.client===client.id && m.active)];
    return {client,last,flags,balance:debts.reduce((sum,c)=>sum+c.balance,0)};
  }).filter(row=>selected.every(f=>row.flags[filters.indexOf(f)]));
  return <section className="card"><label>Buscar cliente<input value={name} onChange={e=>setName(e.target.value)} /></label><div className="actions"><button className="btn" aria-pressed={!selected.length} onClick={()=>setSelected([])}>Todos</button>{filters.map(f=><label key={f}><input type="checkbox" checked={selected.includes(f)} onChange={()=>setSelected(selected.includes(f)?selected.filter(x=>x!==f):[...selected,f])}/>{f}</label>)}</div><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Telefone</th><th>Último atendimento</th><th>Saldo a receber</th></tr></thead><tbody>{rows.map(({client,last,balance})=><tr key={client.id}><td>{client.name}</td><td>{client.phone}</td><td>{last?last.split('-').reverse().join('/'):'Ainda não atendido'}</td><td>{money(balance)}</td></tr>)}</tbody></table></div>{!rows.length&&<p>Nenhum cliente cadastrado corresponde à busca.</p>}</section>;
}
