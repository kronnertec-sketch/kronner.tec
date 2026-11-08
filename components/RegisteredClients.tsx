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
  return (
    <section className="card">
      <div className="split" style={{marginBottom:16}}>
        <div>
          <h2>Base de clientes com conta</h2>
          <p style={{margin:'4px 0 0'}}>Clientes que entraram pelo seu link de agendamento e criaram conta na Kroner.</p>
        </div>
        <span className="badge">{rows.length} {rows.length===1?'cliente':'clientes'}</span>
      </div>
      <div className="toolbar" style={{marginBottom:16}}>
        <label style={{flex:1,maxWidth:360}}>Buscar por nome ou telefone
          <input placeholder="Digite o nome do cliente…" value={name} onChange={e=>setName(e.target.value)} />
        </label>
        <div className="filter-pills" role="group" aria-label="Filtros de clientes">
          <button type="button" className={'filter-pill '+(!selected.length?'active':'')} aria-pressed={!selected.length} onClick={()=>setSelected([])}>Todos</button>
          {filters.map(f=>(
            <button
              type="button"
              key={f}
              className={'filter-pill '+(selected.includes(f)?'active':'')}
              aria-pressed={selected.includes(f)}
              onClick={()=>setSelected(selected.includes(f)?selected.filter(x=>x!==f):[...selected,f])}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Telefone</th><th>Último atendimento</th><th>Saldo a receber</th><th>Contato</th></tr></thead>
          <tbody>
            {rows.map(({client,last,balance,flags})=>(
              <tr key={client.id}>
                <td>
                  <strong>{client.name}</strong>
                  {flags[3]&&<span className="badge" style={{marginLeft:8}}>Mensalista</span>}
                </td>
                <td>{client.phone}</td>
                <td>{last?last.split('-').reverse().join('/'):'Ainda não atendido'}</td>
                <td><span className={balance>0?'badge warn':'badge green'}>{balance>0?money(balance):'Em dia'}</span></td>
                <td>
                  {client.phone&&(
                    <a
                      className="btn small"
                      href={'https://wa.me/'+client.phone.replace(/\D/g,'')}
                      target="_blank"
                      rel="noreferrer"
                    >
                      WhatsApp ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length&&<p style={{textAlign:'center',padding:'24px 0'}}>Nenhum cliente cadastrado corresponde à busca.</p>}
    </section>
  );
}
