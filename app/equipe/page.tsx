'use client';
import ProfessionalSettings from '@/components/ProfessionalSettings';
import TeamDirectory from '@/components/TeamDirectory';
import TeamAgenda,{type Appointment} from '@/components/TeamAgenda';
import Link from 'next/link';
import {useAuth} from '@clerk/react';
import {useCallback,useEffect,useState} from 'react';
import {useApi} from '@/lib/supabase';
import {today} from '@/lib/domain';

type Person={id:string;name:string;role:string;status:string;finance:boolean};
type Entry={id:string;professional:string;name:string;starts:string;ends:string;services:string;status:string};
const roles:Record<string,string>={owner:'Conta principal',partner:'Sócio',employee:'Funcionário'};
const statuses:Record<string,string>={active:'Ativo',invited:'Convite pendente',inactive:'Desativado'};
export default function Team(){
 const api=useApi(),{isLoaded,isSignedIn,getToken}=useAuth();
 const [members,setMembers]=useState<Person[]>([]),[appointments,setAppointments]=useState<Appointment[]>([]);
 const [self,setSelf]=useState(''),[sent,setSent]=useState(false);
 const [access,setAccess]=useState(''),[day,setDay]=useState(today()),[error,setError]=useState(''),[invite,setInvite]=useState(''),[link,setLink]=useState(''),[busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
   const identity=await api('team:identity');
   setSelf(identity.id);setAccess(identity.role||(identity.revoked?'revoked':'none'));
   if(identity.role){
     const [team,agenda]=await Promise.all([api('team:list'),api('team:agenda',{day})]);
     setMembers(team);setAppointments(agenda);
   }
 },[api,day]);
 useEffect(()=>{
   if(!isLoaded)return;
   const token=location.hash.slice(1);
   if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem('kroner:convite',token);history.replaceState(null,'','/equipe');}
   if(!isSignedIn){location.replace('/entrar?next=/equipe');return;}
   setInvite(sessionStorage.getItem('kroner:convite')||'');
   refresh().catch(e=>setError(e.message));
 },[refresh,isLoaded,isSignedIn]);
 async function run(action:string,payload:Record<string,unknown>){
   setBusy(true);setError('');
   try{
     let result;
     if(action==='invite'){
       const response=await fetch('/api/equipe/convite',{method:'POST',headers:{Authorization:'Bearer '+await getToken(),'Content-Type':'application/json'},body:JSON.stringify(payload)});
       result=await response.json();if(!response.ok)throw new Error(result.error);setSent(result.sent);
     }else result=await api('team:'+action,payload);
     if(result.token)setLink(location.origin+'/equipe#'+result.token);
     if(action==='accept'){sessionStorage.removeItem('kroner:convite');setInvite('');}
     await refresh();
   }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <main className="booking"><header><Link className="brand" href="/"><img src="/kroner.svg" alt="Kroner" width="155"/></Link>{['owner','partner'].includes(access)&&<Link className="btn" href={access==='partner'?'/painel?gestao=1':'/painel'}>Painel</Link>}</header><h1>Equipe e cadeiras</h1>{error&&<p role="alert" className="notice danger">{error}</p>}
 {invite&&<section className="card"><h2>Convite para a equipe</h2><p>Use a conta do e-mail que recebeu o convite.</p><button disabled={busy} className="btn primary" onClick={()=>run('accept',{token:invite})}>Aceitar convite</button></section>}
 {access==='revoked'&&<p>Seu acesso à equipe foi desativado.</p>}
 {access==='none'&&!invite&&<p>Abra o link de convite enviado pela conta principal.</p>}
 {access==='owner'&&<section className="card"><h2>Convidar profissional</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);run('invite',{name:f.get('name'),email:f.get('email'),role:f.get('role')});}}><label>Nome<input name="name" required minLength={2} maxLength={100}/></label><label>E-mail do profissional<input type="email" name="email" required/></label><label>Papel<select name="role"><option value="employee">Funcionário</option><option value="partner">Sócio</option></select></label><button className="btn primary" disabled={busy}>Gerar convite</button></form>{link&&<label>{sent?'Convite enviado pelo Clerk.':'Envie este link ao profissional.'} Ele vence em sete dias.<input readOnly value={link} onFocus={e=>e.target.select()}/></label>}
 {members.filter(m=>m.role!=='owner'&&m.status!=='inactive').map(m=><article className="line" key={m.id}><b>{m.name}</b><span>{statuses[m.status]}</span><select value={m.role} disabled={busy} aria-label={'Papel de '+m.name} onChange={e=>run('permissions',{id:m.id,role:e.target.value,finance:m.finance})}><option value="employee">Funcionário</option><option value="partner">Sócio</option></select>{m.role==='employee'&&<label><input type="checkbox" disabled={busy} checked={m.finance} onChange={e=>run('permissions',{id:m.id,role:m.role,finance:e.target.checked})}/>Financeiro individual</label>}<button className="btn" disabled={busy} onClick={()=>{if(confirm('Desativar o acesso de '+m.name+'?'))run('deactivate',{id:m.id})}}>Desativar</button></article>)}</section>}
 {roles[access]&&<section className="card"><h2>Agenda da equipe</h2><label>Dia<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label><TeamAgenda members={members} entries={appointments} role={access} day={day} refresh={refresh}/></section>}
 {roles[access]&&<><TeamDirectory canSeeFinance={access!=='employee'||!!members.find(m=>m.id===self)?.finance}/><ProfessionalSettings/></>}
 </main>;
}
