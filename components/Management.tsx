'use client';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/supabase';
import {money,cents,today} from '@/lib/domain';
import type {Row,Workspace} from '@/lib/types';
export function Earnings(){
 const api=useApi(),[rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[name,setName]=useState(''),[from,setFrom]=useState(today().slice(0,8)+'01'),[to,setTo]=useState(today());
 useEffect(()=>{api('manage:earnings').then(setRows).catch(e=>setError(e.message))},[api]);
 const selected=rows.filter(r=>(!name||r.name===name)&&r.day.slice(0,10)>=from&&r.day.slice(0,10)<=to);
 return <details><summary>Relatório de comissões</summary><label>Profissional<select value={name} onChange={e=>setName(e.target.value)}><option value="">Todos disponíveis</option>{[...new Set(rows.map(r=>r.name))].map(n=><option key={n}>{n}</option>)}</select></label><label>De<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Até<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><p>Base de serviços {money(selected.reduce((s,r)=>s+r.basis,0))} · Comissões {money(selected.reduce((s,r)=>s+r.commission,0))}</p>{selected.map((r,i)=><p key={i}>{r.name} · {r.day.slice(0,10)} · {money(r.commission)}</p>)}{error&&<p role="alert">{error}</p>}</details>
}
export default function Management({data,role,refresh}:{data:Workspace;role:string;refresh:()=>Promise<void>}){
 const api=useApi(),[id,setId]=useState(data.products[0]?.id||''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const p=data.products.find(x=>x.id===id);
 async function send(action:string,f:FormData){setBusy(true);try{const values=Object.fromEntries(f);await api('manage:'+action,{...values,rate:cents(String(f.get('rate')||0)),active:f.has('active'),request_id:crypto.randomUUID()});await refresh();setMessage('Alterações salvas.')}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 return <section className="card"><Earnings/>{role==='owner'&&<details><summary>Comissão específica por serviço</summary><form onSubmit={e=>{e.preventDefault();send('service_rate',new FormData(e.currentTarget))}}><label>Profissional<select name="professional">{data.professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Serviço<select name="service">{data.services.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Comissão (%)<input name="rate" type="number" min="0" max="100" step=".01" required/></label><button className="btn" disabled={busy}>Salvar comissão</button></form></details>}
 <details><summary>Inventário físico</summary><label>Produto<select value={id} onChange={e=>setId(e.target.value)}>{data.products.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{p&&<form key={id} onSubmit={e=>{e.preventDefault();send('inventory',new FormData(e.currentTarget))}}><input type="hidden" name="id" value={id}/><label>Unidade<input name="unit" required defaultValue={p.unit}/></label><label>Quantidade contada<input name="count" type="number" min="0" required defaultValue={p.quantity}/></label><label><input type="checkbox" name="active" defaultChecked={p.active}/>Produto ativo</label><label>Motivo do ajuste<input name="reason" required minLength={3}/></label><button className="btn" disabled={busy}>Registrar inventário</button></form>}</details><p role="status">{message}</p></section>
}
