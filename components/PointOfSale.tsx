'use client';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/supabase';
import {cents,money,today} from '@/lib/domain';
import type {Row,Workspace} from '@/lib/types';
const methods=[['cash','Dinheiro'],['pix','Pix'],['credit','Crédito'],['debit','Débito']];
export default function PointOfSale({data,role,refresh}:{data:Workspace;role:string;refresh:()=>Promise<void>}){
 const api=useApi(),[records,setRecords]=useState<{sales:Row[];rates:Row[];closings:Row[]}>({sales:[],rates:[],closings:[]}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[cart,setCart]=useState<Record<string,number>>({}),[appointment,setAppointment]=useState(''),[discount,setDiscount]=useState('0');
 useEffect(()=>{api('pos:list').then(setRecords).catch(e=>setMessage(e.message))},[api,data]);
 async function run(action:string,payload:Row,form:HTMLFormElement){
 setBusy(true);try{const key=form.dataset.requestId||crypto.randomUUID();form.dataset.requestId=key;await api('pos:'+action,{...payload,request_id:key});delete form.dataset.requestId;form.reset();if(action==='sale'){setCart({});setAppointment('');setDiscount('0')}await refresh();setMessage('Operação registrada.')}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 const selected=data.appointments.find(a=>a.id===appointment);
 const total=(selected?.price||0)+data.products.reduce((v,p)=>v+p.price*(cart[p.id]||0),0)-Number(discount.replace(',','.'))*100;
 return (
  <section className="card">
   <h2>Ponto de venda</h2>
   <p style={{marginTop:0}}>Registre vendas avulsas, produtos na finalização do atendimento, estornos e fechamento diário do caixa.</p>
   <details className="ux-accordion">
    <summary>Nova venda ou conclusão de atendimento</summary>
    <form className="ux-accordion-body" onChange={e=>{delete e.currentTarget.dataset.requestId}} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const payments=methods.map(([method])=>({method,amount:cents(String(f.get(method)||0))})).filter(p=>p.amount>0);run('sale',{appointment:appointment||null,professional:f.get('professional'),discount:cents(discount),items:Object.entries(cart).filter(([,v])=>v>0).map(([id,quantity])=>({id,quantity})),payments},e.currentTarget)}catch(err){setMessage((err as Error).message)}}}>
     <div className="form-grid">
      <label>Atendimento
       <select value={appointment} onChange={e=>setAppointment(e.target.value)}>
        <option value="">Venda avulsa</option>
        {data.appointments.filter(a=>a.status==='booked'&&!a.membership).map(a=><option value={a.id} key={a.id}>{data.clients.find(c=>c.id===a.client)?.name} · {new Date(a.starts).toLocaleString('pt-BR',{timeZone:data.shop.cfg.timezone})} · {money(a.price)}</option>)}
       </select>
      </label>
      <label>Profissional da venda avulsa
       <select name="professional" disabled={!!appointment}>{data.professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
     </div>
     {data.products.filter(p=>p.active).length>0&&(
      <div className="form-grid">
       {data.products.filter(p=>p.active).map(p=>(
        <label key={p.id}>{p.name} · {money(p.price)} · {p.quantity} em estoque
         <input aria-label={'Quantidade de '+p.name} type="number" min="0" max={p.quantity} value={cart[p.id]||0} onChange={e=>setCart({...cart,[p.id]:Number(e.target.value)})}/>
        </label>
       ))}
      </div>
     )}
     <div className="form-grid">
      <label>Desconto (R$)
       <input type="number" min="0" step=".01" required value={discount} onChange={e=>setDiscount(e.target.value)}/>
      </label>
      <div className="review" style={{display:'flex',flexDirection:'column',justifyContent:'center',padding:'12px 16px',marginBottom:15}}>
       <small>Total a receber</small>
       <strong style={{fontSize:20}}>{money(Math.round(total))}</strong>
      </div>
     </div>
     <p style={{margin:'4px 0 12px'}}>Informe o valor recebido em cada meio. O restante fica a receber.</p>
     <div className="form-grid">
      {methods.map(([key,label])=><label key={key}>{label} (R$)<input type="number" step=".01" min="0" defaultValue="0" name={key}/></label>)}
     </div>
     <button className="btn primary" disabled={busy}>Confirmar venda</button>
    </form>
   </details>

   <details className="ux-accordion">
    <summary>Vendas e estornos ({records.sales.length})</summary>
    <div className="ux-accordion-body">
     {!records.sales.length&&<p style={{margin:0}}>Nenhuma venda registrada no PDV ainda.</p>}
     {records.sales.map(s=>(
      <article className="card" style={{background:'var(--bg)',marginBottom:12}} key={s.id}>
       <p style={{marginTop:0}}><strong>{new Date(s.created_at).toLocaleDateString('pt-BR')}</strong> · Serviços {money(s.service_total)} · Produtos {money(s.product_total)} · Desconto {money(s.discount)} · Comissão {money(s.commission)} · Estornado {money(s.refunded)}</p>
       <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(confirm('Registrar o estorno e a saída no caixa?'))run('refund',{sale:s.id,amount:cents(String(f.get('amount'))),method:f.get('method'),reason:f.get('reason'),return_goods:f.has('goods')},e.currentTarget)}}>
        <div className="form-grid">
         <label>Valor a estornar (R$)<input required name="amount" type="number" min=".01" step=".01"/></label>
         <label>Meio usado na devolução<select name="method">{methods.map(([m,l])=><option key={m} value={m}>{l}</option>)}</select></label>
        </div>
        <label>Motivo<input name="reason" minLength={3} required/></label>
        <label className="checkbox"><input type="checkbox" name="goods"/>Devolver todos os produtos ao estoque no estorno integral</label>
        <button className="btn" disabled={busy}>Registrar estorno</button>
       </form>
      </article>
     ))}
    </div>
   </details>

   {role==='owner'&&(
    <details className="ux-accordion">
     <summary>Comissão sobre serviços do PDV</summary>
     <div className="ux-accordion-body">
      {records.rates.map(p=>(
       <form className="line" style={{display:'flex',alignItems:'flex-end',gap:12}} key={p.id} onSubmit={e=>{e.preventDefault();run('rate',{id:p.id,rate:cents(String(new FormData(e.currentTarget).get('rate')))},e.currentTarget)}}>
        <label style={{flex:1,marginBottom:0}}>{p.name} (%)<input required name="rate" type="number" min="0" max="100" step=".01" defaultValue={p.rate/100}/></label>
        <button className="btn" disabled={busy}>Salvar percentual</button>
       </form>
      ))}
     </div>
    </details>
   )}

   <details className="ux-accordion">
    <summary>Fechamento diário de caixa</summary>
    <div className="ux-accordion-body">
     <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run('close',{day:f.get('day'),opening:cents(String(f.get('opening'))),counted:cents(String(f.get('counted')))},e.currentTarget)}}>
      <div className="form-grid">
       <label>Dia<input type="date" name="day" required defaultValue={today()} max={today()}/></label>
       <label>Dinheiro na abertura (R$)<input name="opening" type="number" min="0" step=".01" required defaultValue="0"/></label>
       <label>Dinheiro contado (R$)<input name="counted" required type="number" min="0" step=".01"/></label>
      </div>
      <button className="btn primary" disabled={busy}>Fechar caixa</button>
     </form>
     {records.closings.map(c=>(
      <div className="line" key={c.day}>
       <span>{c.day.split('-').reverse().join('/')}</span>
       <span>Esperado <b>{money(c.expected)}</b> · Contado <b>{money(c.counted)}</b> · Diferença <b>{money(c.counted-c.expected)}</b></span>
      </div>
     ))}
    </div>
   </details>
   {message&&<p role="status" className="notice">{message}</p>}
  </section>
 );
}
