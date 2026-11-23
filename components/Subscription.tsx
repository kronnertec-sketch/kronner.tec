'use client';
import {useAuth} from '@clerk/react';
import {useEffect,useState} from 'react';

export default function Subscription(){
 const {getToken,isSignedIn}=useAuth();
 const [available,setAvailable]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [count,setCount]=useState(0);
 const [active,setActive]=useState(false);
 const [isTestAccount,setIsTestAccount]=useState(false);

 useEffect(()=>{
   fetch('/api/assinatura',{cache:'no-store'})
     .then(r=>r.json())
     .then(s=>setAvailable(s.available===true))
     .catch(()=>setAvailable(false));
 },[]);

 useEffect(()=>{
   if(isSignedIn&&available){
     submit('status');
   }
 },[isSignedIn,available]);

 async function submit(action:string){
   setBusy(true);
   try{
     const token=await getToken({template:'kroner_claims'}).catch(()=>getToken());
     const response=await fetch('/api/assinatura',{
       method:'POST',
       headers:{
         Authorization:'Bearer '+token,
         'Content-Type':'application/json'
       },
       body:JSON.stringify({action,quantity:count})
     });
     const result=await response.json();
     if(!response.ok)throw new Error(result.error);
     if(result.url){location.assign(result.url);return;}
     if(result.isTestAccount){
       setIsTestAccount(true);
       setActive(true);
       setCount(result.extras||0);
       setMessage('Conta de testes autorizada · Acesso liberado sem cobrança.');
       return;
     }
     if(action==='status'){
       setCount(result.extras);
       setActive(['active','trialing'].includes(result.status));
       const names:Record<string,string>={
         active:'Ativa',
         trialing:'Em período gratuito de 15 dias',
         sem_assinatura:'Sem assinatura',
         past_due:'Pagamento pendente',
         paused:'Pausada',
         unpaid:'Em aberto'
       };
       setMessage(names[result.status]||result.status);
     }else{
       setMessage('Quantidade atualizada. O ajuste proporcional será lançado na fatura.');
     }
   }catch(e){
     setMessage(e instanceof Error?e.message:'Falha ao consultar assinatura.');
   }finally{
     setBusy(false);
   }
 }

 if(!available)return <section className="card"><h2>Assinatura Kronner</h2><p>Contratação online ainda indisponível.</p></section>;

 return (
   <section className="card">
     <h2>Assinatura Kronner</h2>
     <p>Plano Principal de R$ 99,90/mês com 1 cadeira. 15 dias de teste grátis sem cartão. Cada cadeira adicional custa R$ 35,90/mês com pró-rata proporcional.</p>
     {isTestAccount ? (
       <div className="notice success-notice" style={{margin:'12px 0'}}>
         <strong>Modo de Testes Ativo</strong>
         <p>Esta conta tem acesso liberado gratuito e irrestrito a todas as funcionalidades e cadeiras.</p>
       </div>
     ) : (
       <div className="actions">
         <button className="btn" disabled={busy} onClick={()=>submit('status')}>Consultar assinatura</button>
         <button className="btn primary" disabled={busy} onClick={()=>submit('iniciar')}>Abrir contratação</button>
         <button className="btn" disabled={busy} onClick={()=>submit('portal')}>Cartão e faturas</button>
       </div>
     )}
     {active && !isTestAccount && (
       <form onSubmit={e=>{e.preventDefault();if(confirm('Confirmar a nova quantidade de cadeiras e o ajuste proporcional até a renovação?'))submit('cadeiras')}}>
         <label>Cadeiras adicionais
           <input type="number" min="0" max="100" required value={count} onChange={e=>setCount(e.target.valueAsNumber)}/>
         </label>
         <button className="btn" disabled={busy}>Atualizar quantidade</button>
       </form>
     )}
     <p role="status">{message}</p>
   </section>
 );
}
