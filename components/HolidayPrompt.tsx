'use client';
import {useEffect,useState} from 'react';
import {pendingHolidays} from '@/lib/holidays';
export default function HolidayPrompt({items,identity,day,review}:{items:ReturnType<typeof pendingHolidays>;identity:string;day:string;review:()=>void}){
  const urgent=items.filter(item=>item.days<=14);
  const [visible,setVisible]=useState(false);
  const key='kroner:holiday-prompt:'+identity;
  const hasUrgent=urgent.length>0;
  useEffect(()=>{
    if(!hasUrgent)return;
    try{
      if(localStorage.getItem(key)===day||sessionStorage.getItem(key)===day)return;
      localStorage.setItem(key,day);
      sessionStorage.setItem(key,day);
    }catch{}
    setVisible(true);
  },[key,day,hasUrgent]);
  if(!visible||!hasUrgent)return null;
  return <div className="overlay modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="holiday-heading" className="modal card"><div className="split"><h2 id="holiday-heading">Feriados pendentes</h2><button type="button" className="close" aria-label="Fechar" onClick={()=>setVisible(false)}>×</button></div><p>Confira os feriados das próximas duas semanas e confirme se vai trabalhar.</p><ul>{urgent.map(item=><li key={item.date}>{item.date.split('-').reverse().join('/')} · {item.name} · {item.scope}</li>)}</ul><div className="actions"><button autoFocus className="btn primary" onClick={()=>{setVisible(false);review()}}>Ver feriados</button><button className="btn" onClick={()=>setVisible(false)}>Lembrar depois</button></div></section></div>;
}
