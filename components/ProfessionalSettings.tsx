'use client';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/supabase';
import {defaults} from '@/lib/types';
import {days,today} from '@/lib/domain';
import {pendingHolidays} from '@/lib/holidays';
import HolidayPrompt from './HolidayPrompt';

type Shift={enabled:boolean;open:string;close:string;lunchStart:string;lunchEnd:string};
type Profile={role:string;finance:boolean;calendar:{date:string;name:string;scope:string}[];id:string;slug:string;week:Shift[]|null;services:{id:string;name:string;duration:number}[];preferences:{notice?:number;buffer?:number;durations?:Record<string,number>;disabledServices?:string[];holidayDecisions?:Record<string,string>}};

export default function ProfessionalSettings(){
 const api=useApi(),[profile,setProfile]=useState<Profile>(),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[suggestions,setSuggestions]=useState<{date:string;name:string}[]>([]);
 useEffect(()=>{api('team:profile').then(setProfile).catch(e=>setMessage(e.message))},[api]);
 async function save(action:string,payload:Record<string,unknown>){setBusy(true);try{await api('team:'+action,payload);setProfile(await api('team:profile'));setMessage('Alterações salvas.')}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 if(!profile)return <p role="status">{message}</p>;
 const pref=profile.preferences,day=today();
 const local=profile.calendar.map(h=>({...h,days:Math.round((Date.parse(h.date)-Date.parse(day))/86400000),stage:30})).filter(h=>h.days>=0&&h.days<=30);
 const holidays=[...new Map([...pendingHolidays(day),...local].map(h=>[h.date,h])).values()].sort((a,b)=>a.date.localeCompare(b.date)),pending=holidays.filter(h=>!pref.holidayDecisions?.[h.date]);
 return (
  <section className="card">
   <div className="split" style={{marginBottom:14}}>
    <div>
     <h2>Minha cadeira</h2>
     <p style={{margin:'4px 0 0'}}>Ajuste seu expediente individual, tempo de cada serviço e intervalo de segurança.</p>
    </div>
    <a className="btn" href={'/b/'+profile.slug+'?p='+profile.id} target="_blank" rel="noreferrer">Meu link de agendamento ↗</a>
   </div>

   <details className="ux-accordion">
    <summary>Expediente, serviços e intervalos</summary>
    <div className="ux-accordion-body">
     <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const week=days.map((_,i)=>({enabled:f.has('active'+i),...Object.fromEntries(['open','close','lunchStart','lunchEnd'].map(k=>[k,f.get(k+i)]))}));save('preferences',{week,buffer:f.has('bufferOn')?Number(f.get('buffer')):0,notice:f.has('noticeOn')?Number(f.get('notice')):0,disabledServices:profile.services.filter(s=>!f.has(s.id)).map(s=>s.id),durations:Object.fromEntries(profile.services.map(s=>[s.id,Number(f.get('duration'+s.id))]))})}}>
      <div className="form-grid">
       <div>
        <label className="checkbox"><input type="checkbox" name="noticeOn" defaultChecked={pref.notice!==0}/>Aplicar antecedência mínima</label>
        <label>Antecedência para reservas online (minutos)<input type="number" min="1" max="10080" name="notice" defaultValue={pref.notice||10}/></label>
       </div>
       <div>
        <label className="checkbox"><input type="checkbox" name="bufferOn" defaultChecked={pref.buffer!==0}/>Aplicar intervalo de segurança entre clientes</label>
        <label>Intervalo de segurança (minutos)<input name="buffer" type="number" min="0" max="180" defaultValue={pref.buffer||10} required/><small>Tempo extra reservado após cada corte caso o atendimento demore um pouco mais que o horário programado.</small></label>
       </div>
      </div>

      <h3>Meus serviços e duração</h3>
      <div className="form-grid">
       {profile.services.map(s=>(
        <fieldset className="ux-fieldset" key={s.id}>
         <legend>{s.name}</legend>
         <label className="checkbox"><input type="checkbox" name={s.id} defaultChecked={!pref.disabledServices?.includes(s.id)}/>Ofereço este serviço</label>
         <label style={{marginBottom:0}}>Duração em minutos<input required type="number" name={'duration'+s.id} min="1" max="720" defaultValue={pref.durations?.[s.id]??s.duration}/></label>
        </fieldset>
       ))}
      </div>

      <h3 style={{marginTop:18}}>Horário por dia da semana</h3>
      {(profile.week||defaults.week).map((w:Shift,i:number)=>(
       <fieldset className="ux-fieldset" key={i}>
        <legend>{days[i]}</legend>
        <label className="checkbox"><input type="checkbox" name={'active'+i} defaultChecked={w.enabled}/>Trabalho neste dia</label>
        <div className="actions" style={{marginTop:8}}>
         {([['open','Abertura'],['close','Fechamento'],['lunchStart','Início da pausa'],['lunchEnd','Fim da pausa']] as const).map(([k,label])=>(
          <label key={k}>{label}<input type="time" name={k+i} defaultValue={w[k]||''}/></label>
         ))}
        </div>
       </fieldset>
      ))}
      <button className="btn primary" disabled={busy}>Salvar expediente</button>
     </form>
    </div>
   </details>

   <HolidayPrompt items={pending} identity={profile.id} day={today()} review={()=>document.getElementById('myholidays')?.scrollIntoView()}/>

   <section id="myholidays" style={{marginTop:18}}>
    {profile.role==='owner'&&(
     <details className="ux-accordion">
      <summary>Cadastrar feriado oficial da localidade</summary>
      <div className="ux-accordion-body">
       <button className="btn" type="button" style={{marginBottom:14}} onClick={async()=>{try{const year=Number(today().slice(0,4));const groups=await Promise.all([year,year+1].map(async y=>{const r=await fetch('https://brasilapi.com.br/api/feriados/v1/'+y);if(!r.ok)throw new Error();return r.json()}));setSuggestions(groups.flat());setMessage('Consulte a legislação da localidade antes de cadastrar.')}catch{setMessage('A fonte externa está indisponível. O cadastro manual continua disponível.')}}}>Consultar calendário nacional</button>
       {suggestions.length>0&&(
        <div className="review" style={{maxHeight:180,overflow:'auto',marginBottom:14}}>
         {suggestions.map(s=><div key={s.date}>{s.date.split('-').reverse().join('/')} · {s.name}</div>)}
        </div>
       )}
       <form onSubmit={e=>{e.preventDefault();save('calendar_event',Object.fromEntries(new FormData(e.currentTarget)))}}>
        <div className="form-grid">
         <label>Nome<input name="name" required/></label>
         <label>Data<input type="date" name="date" required/></label>
         <label>Abrangência<select name="scope">{['Municipal','Estadual','Nacional'].map(s=><option key={s}>{s}</option>)}</select></label>
         <label>Link da publicação oficial<input type="url" name="source" required/></label>
        </div>
        <button disabled={busy} className="btn primary">Registrar feriado</button>
       </form>
      </div>
     </details>
    )}
    <h3>Feriados dos próximos 30 dias</h3>
    {!holidays.length&&<p>Nenhum feriado previsto nos próximos 30 dias.</p>}
    {holidays.map(h=>(
     <div className="line" key={h.date}>
      <div>
       <b>{h.date.split('-').reverse().join('/')} · {h.name} · {h.scope}</b>
       <small>{({open:'Vou trabalhar',closed:'Vou folgar'} as Record<string,string>)[pref.holidayDecisions?.[h.date]||'']||'Aguardando sua decisão'}</small>
      </div>
      <div className="actions" style={{marginTop:0}}>
       {[['open','Vou trabalhar neste feriado'],['closed','Vou folgar']].map(([decision,label])=>(
        <button className="btn small" key={decision} disabled={busy} onClick={()=>{if(confirm(label+' em '+h.name+'?'))save('holiday',{date:h.date,decision})}}>{label}</button>
       ))}
      </div>
     </div>
    ))}
   </section>
   {message&&<p role="status" className="notice">{message}</p>}
  </section>
 );
}
