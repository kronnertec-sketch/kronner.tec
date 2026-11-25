'use client';
import HolidayPrompt from '@/components/HolidayPrompt';
import {pendingHolidays} from '@/lib/holidays';
import ShareGuide from '@/components/share-guide';
import {BrandLogo} from '@/components/BrandLogo';
import {KronnerEntrance} from '@/components/painel/KronnerEntrance';
import {ClientsPanel} from '@/components/painel/ClientsPanel';
import {FinancePanel} from '@/components/painel/FinancePanel';
import {ReportsPanel} from '@/components/painel/ReportsPanel';
import {EmployeesPanel} from '@/components/painel/EmployeesPanel';
import {SettingsHub} from '@/components/painel/SettingsHub';
import {ROLE_LABELS,type IdentityInfo,type ShopConfig,type ChargeRow} from '@/components/painel/types';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,CalendarDays,Users,Wallet,Bell,Settings,LogOut,Plus,
  ArrowUpRight,Copy,ChevronRight,ChevronLeft,Check,Scissors,Menu,FileBarChart,
  Repeat,HelpCircle,User,Clock,Tag,Coffee,X,CheckCircle2,XCircle,MessageCircle,
  RefreshCw,Trash2,Lock,UserCog
} from 'lucide-react';
import {useApi} from '@/lib/supabase';
import {useAuth,useClerk,useSession,useUser} from '@clerk/react';
import {cents,money,phone,today,days,debtStatus,settingsDraft,settingsValues} from '@/lib/domain';
import {defaults,type Workspace,type Row} from '@/lib/types';
import {fromZonedTime,formatInTimeZone} from 'date-fns-tz';

const tabs=[
  ['overview','Visão geral',LayoutDashboard],
  ['agenda','Agenda',CalendarDays],
  ['clients','Clientes',Users],
  ['monthly','Mensalistas',Repeat],
  ['team','Funcionários',UserCog],
  ['finance','Financeiro',Wallet],
  ['reports','Relatórios',FileBarChart],
  ['notices','Avisos',Bell],
  ['share','Divulgue sua agenda',Copy],
  ['settings','Configurações',Settings]
] as const;

const methods=[['pix','Pix'],['cash','Dinheiro'],['credit','Crédito'],['debit','Débito']];

const descriptions:Record<string,string>={
  share:'Seu link e orientações para facilitar o atendimento no WhatsApp.',
  overview:'Seu dia e os números que merecem atenção.',
  agenda:'Organize seus horários, encaixes e pausas.',
  clients:'Base geral da barbearia, pendências, atrasos e follow-up.',
  monthly:'Rotina fixa, relacionamento duradouro.',
  team:'Profissionais, permissões, comissões individuais e folgas.',
  finance:'Clareza sobre cada entrada, taxa e saída de serviços.',
  reports:'Desempenho da barbearia e apuração individual de comissões.',
  notices:'O que precisa da sua atenção.',
  settings:'A Kronner funcionando do seu jeito.'
};

function Field({label,name,type='text',value,required=true,...rest}:{label:string;name:string;type?:string;value?:any;required?:boolean;[k:string]:any}){
  return <label>{label}<input name={name} type={type} defaultValue={value} required={required} {...rest}/></label>;
}

function Select({label,name,options,value}:{label:string;name:string;options:(string[]|Row)[];value?:string}){
  return <label>{label}<select name={name} defaultValue={value}>{options.map((x:any)=><option value={x[0]} key={x[0]}>{x[1]}</option>)}</select></label>;
}

function Empty({title,text}:{title:string;text:string}){
  return <div className="empty"><span className="empty-icon" aria-hidden="true"><Scissors size={22} strokeWidth={1.85}/></span><h3>{title}</h3><p>{text}</p></div>;
}

function shiftIsoDay(dayStr:string,deltaDays:number){
  const dt=new Date(dayStr+'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate()+deltaDays);
  return dt.toISOString().slice(0,10);
}

function formatLongDayPt(dayStr:string){
  try{
    const dt=new Date(dayStr+'T12:00:00Z');
    const formatted=new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',weekday:'short',day:'2-digit',month:'long',year:'numeric'}).format(dt);
    return formatted.charAt(0).toUpperCase()+formatted.slice(1);
  }catch{
    return dayStr.split('-').reverse().join('/');
  }
}

export default function Dashboard(){
  const [ownerChair,setOwnerChair]=useState('');
  const [role,setRole]=useState<'owner'|'partner'|'employee'>('owner');
  const [identity,setIdentity]=useState<IdentityInfo>({
    role:'owner',shop:'',id:'',finance:true,commission_enabled:false,commission_bps:0,
    can_manage_memberships:true,can_register_payment:true,can_share_link:true
  });
  const [waveReady,setWaveReady]=useState(false);
  const [dashScope,setDashScope]=useState<string>('all');
  const [settingsDirty,setSettingsDirty]=useState(false);
  const [onboarding,setOnboarding]=useState(false);
  const call=useApi();
  const {isLoaded,isSignedIn}=useAuth();
  const {session,isLoaded:sessionLoaded}=useSession();
  const {user}=useUser();
  const {signOut}=useClerk();
  const handleEntranceDone=useCallback(()=>setWaveReady(true),[]);
  const [data,S]=useState<Workspace|null>(null),
    [tab,T]=useState('overview'),
    [loading,L]=useState(true),
    [busy,B]=useState(false),
    [error,E]=useState(''),
    [toast,Toast]=useState(''),
    [modal,M]=useState<Row|null>(null),
    [cfg,C]=useState<Row>(defaults),
    [name,N]=useState(''),
    [step,ST]=useState(0),
    [tour,TO]=useState(-1),
    [menu,MENU]=useState(false),
    [date,D]=useState(today()),
    [agendaRange,setAgendaRange]=useState<'day'|'week'|'month'>('day'),
    [agendaChair,setAgendaChair]=useState<string>('all'),
    [selectedAptId,setSelectedAptId]=useState<string>(''),
    [payMethod,setPayMethod]=useState<string>('pix'),
    [from,F]=useState(today().slice(0,8)+'01'),
    [to,TT]=useState(today()),
    [booking,BO]=useState<Row>({services:[],day:today(),period:'afternoon',start:'',client:'',name:'',phone:''}),
    [slots,SL]=useState<Row[]>([]);

  async function load(){
    try{
      if(!isSignedIn){location.assign('/entrar?next=/painel');return;}
      const membership=await call('team:identity');
      if(!membership.role && membership.revoked){
        location.replace('/equipe');
        return;
      }
      const nextRole=(membership.role||'owner') as 'owner'|'partner'|'employee';
      setOwnerChair(membership.id||'');
      setRole(nextRole);
      setIdentity({
        role:nextRole,
        shop:membership.shop||'',
        id:membership.id||'',
        name:membership.name||'',
        finance:nextRole!=='employee'||!!membership.finance,
        commission_enabled:!!membership.commission_enabled,
        commission_bps:Number(membership.commission_bps||0),
        can_manage_memberships:nextRole!=='employee'||!!membership.can_manage_memberships,
        can_register_payment:nextRole!=='employee'||membership.can_register_payment!==false,
        can_share_link:nextRole!=='employee'||membership.can_share_link!==false,
        revoked:!!membership.revoked
      });
      if(nextRole==='employee'){
        setDashScope(membership.id||'all');
      }
      const d=await call('workspace');
      if(d.onboarding){setOnboarding(true);return;}
      setOnboarding(false);
      S(d);
      C(settingsDraft({...defaults,...d.shop.cfg}));
      N(d.shop.name);
      setSettingsDirty(false);
      ST(d.shop.cfg.setupStep||0);
      if(!d.shop.active){
        T('settings');
        const tourKey='kroner:tour-seen:'+d.shop.id;
        const seen=sessionStorage.getItem('tour-seen')||(typeof localStorage!=='undefined'&&localStorage.getItem(tourKey));
        if(!seen){
          sessionStorage.setItem('tour-seen','1');
          try{localStorage.setItem(tourKey,'1');}catch{}
          TO(0);
        }
      }
    }catch(e){
      E((e as Error).message);
    }finally{
      L(false);
    }
  }

  useEffect(()=>{
    if(!isLoaded||!sessionLoaded)return;
    if(isSignedIn&&session)load();
    else if(!isSignedIn)location.assign('/entrar?next=/painel');
  },[isLoaded,sessionLoaded,isSignedIn,session?.id]);

  useEffect(()=>{
    const prof=booking.professional||ownerChair||data?.professionals?.[0]?.id;
    if(!modal||!['booking','move'].includes(modal.type)||!data||!booking.services?.length||!prof)return;
    let active=true;
    call('team:slots',{professional:prof,services:booking.services,day:booking.day,period:booking.period})
      .then(s=>{if(active){SL(s);BO(b=>({...b,professional:prof,start:''}));}})
      .catch(e=>E(e.message));
    return()=>{active=false;};
  },[modal?.type,booking.professional,booking.day,booking.period,booking.services,data?.shop.slug,ownerChair]);

  const mutate=async(action:string,payload:Row,close=true)=>{
    B(true);E('');
    try{
      await call(action,{...payload,request_id:crypto.randomUUID()});
      if(close)M(null);
      await load();
      Toast('Salvo com sucesso.');
      setTimeout(()=>Toast(''),4000);
      return true;
    }catch(e){
      E((e as Error).message);
      return false;
    }finally{
      B(false);
    }
  };

  const clientObj=(id:string)=>data?.clients.find(c=>c.id===id);
  const client=(id:string)=>clientObj(id)?.name||'Cliente';
  const clientPhone=(id:string)=>clientObj(id)?.phone||'';
  const paid=(id:string)=>data?.payments.filter(p=>p.charge===id).reduce((n,p)=>n+p.amount,0)||0;
  const tz=cfg.timezone||'America/Sao_Paulo';
  const at=(value:string)=>formatInTimeZone(value,tz,'HH:mm');
  const localDay=(value:string)=>formatInTimeZone(value,tz,'yyyy-MM-dd');

  const filteredAppointments=(data?.appointments||[])
    .filter(a=>{
      const d=localDay(a.starts);
      if(agendaRange==='day' && d!==date)return false;
      if(agendaRange==='week'){
        const end=shiftIsoDay(date,6);
        if(d<date||d>end)return false;
      }
      if(agendaRange==='month' && d.slice(0,7)!==date.slice(0,7))return false;
      if(agendaChair!=='all' && a.professional && a.professional!==agendaChair)return false;
      return true;
    })
    .sort((a,b)=>a.starts.localeCompare(b.starts));

  const dayAllAppointments=(data?.appointments||[])
    .filter(a=>localDay(a.starts)===date && (agendaChair==='all'||!a.professional||a.professional===agendaChair));

  const selectedApt=filteredAppointments.find(a=>a.id===selectedAptId)||filteredAppointments[0]||null;
  const selectedAptCharge=selectedApt?data?.charges.find(c=>c.appointment===selectedApt.id):null;
  const selectedAptPaid=selectedAptCharge?paid(selectedAptCharge.id):0;

  const pending=data?.charges.filter(c=>c.direction==='in'&&paid(c.id)<c.amount)||[];
  const reportPayments=data?.payments.filter(p=>p.settles_on>=from&&p.settles_on<=to)||[];
  const total=(direction:string,rows:Row[],exclude=false)=>rows.reduce((n,p)=>{
    const c=data?.charges.find(c=>c.id===p.charge);
    return c?.direction===direction&&(!exclude||c?.category!=='injection')?n+p.amount-p.fee:n;
  },0);
  const allDue=data?.charges.filter(c=>c.due>=from&&c.due<=to)||[];

  const notices:Row[]=[];
  pending.filter(c=>debtStatus(c.amount,paid(c.id),c.due,cfg.grace)==='Atrasado').forEach(c=>notices.push({
    title:c.category==='monthly'?'Mensalidade em atraso':'Pagamento em atraso',
    text:`${client(c.client)} · ${c.description} · ${money(c.amount-paid(c.id))}`,
    tab:'finance',
    danger:true
  }));

  data?.clients.forEach(c=>{
    const last=data.appointments.filter(a=>a.client===c.id&&a.status==='done').sort((a,b)=>b.starts.localeCompare(a.starts))[0];
    if(last&&Date.now()-Date.parse(last.starts)>(cfg.returnDays||30)*86400000)notices.push({title:'Cliente há +30 dias sem cortar',text:c.name+' · último atendimento em '+localDay(last.starts).split('-').reverse().join('/'),tab:'clients'});
  });

  data?.recurring.filter(r=>r.variable&&r.active).forEach(r=>notices.push({title:'Confira o valor deste mês',text:r.name+' · vencimento dia '+r.day,tab:'finance'}));

  const shopDay=formatInTimeZone(new Date(),data?.shop.cfg.timezone||'America/Sao_Paulo','yyyy-MM-dd');
  const calendarEvents=(data?.calendar||[]).map((ev:Row)=>({date:ev.day,name:ev.name,scope:ev.scope}));
  const holidays=pendingHolidays(shopDay,cfg.holidayDecisions,cfg.state,calendarEvents);
  const allUpcomingHolidays=pendingHolidays(shopDay,{},cfg.state,calendarEvents);
  for(const item of allUpcomingHolidays){
    const decision=cfg.holidayDecisions?.[item.date]||null;
    const statusText=decision==='open'
      ?' · Decisão atual: Vou trabalhar (você pode alterar a qualquer momento)'
      :decision==='closed'
        ?' · Decisão atual: Não vou trabalhar (agenda fechada nesta data)'
        :'';
    notices.push({
      title:item.stage===7?'Feriado nesta semana':item.stage===14?'Feriado nas próximas duas semanas':'Feriado nos próximos 30 dias',
      text:item.name+' · '+item.date.split('-').reverse().join('/')+' · '+item.scope+statusText,
      tab:'notices',
      holiday:item.date,
      holidayName:item.name,
      holidayDecision:decision
    });
  }
  const unreadNoticesCount=notices.filter(n=>!n.holidayDecision).length;

  async function decideHoliday(holidayDate:string,decision:'open'|'closed'){
    const msg=decision==='open'
      ?'Salvo: você vai trabalhar. O feriado continua na aba de Avisos caso queira mudar de ideia, sem novos alertas.'
      :'Salvo: agenda fechada no feriado. Ele continua na aba de Avisos caso queira mudar sua escolha.';
    if(role==='employee'){
      const ok=await mutate('team:holiday',{date:holidayDate,decision},false);
      if(ok){Toast(msg);setTimeout(()=>Toast(''),5000);}
      return;
    }
    const nextCfg:Row={...cfg,holidayDecisions:{...(cfg.holidayDecisions||{}),[holidayDate]:decision}};
    C(nextCfg);
    if(data?.shop.active){
      const normalized=phone(nextCfg.phone||data.shop.cfg.phone||'34999990000');
      const ok=await mutate('settings',{name,cfg:{...settingsValues(nextCfg),phone:normalized,setupStep:step},activate:true},false);
      if(ok){
        Toast(msg);
        setTimeout(()=>Toast(''),5000);
      }
    }else{
      Toast(msg);
      setTimeout(()=>Toast(''),5000);
    }
  }

  async function lookupCep(rawCep:string){
    const postal=String(rawCep||'').replace(/\D/g,'');
    if(postal.length!==8)return;
    try{
      const response=await fetch('https://viacep.com.br/ws/'+postal+'/json/');
      if(!response.ok)return;
      const address=await response.json();
      if(address.erro)return;
      C(prev=>({
        ...prev,
        cep:postal,
        city:address.localidade||prev.city,
        state:(address.uf||prev.state||'').toUpperCase(),
        ibge:address.ibge||prev.ibge,
        address:address.logradouro||prev.address,
        district:address.bairro||prev.district
      }));
      Toast('Cidade e endereço preenchidos pelo CEP.');
      setTimeout(()=>Toast(''),3500);
    }catch{}
  }

  async function saveSettings(activate=false,nextStep=step){
    try{
      const normalized=phone(cfg.phone);
      const ok=await mutate('settings',{name,cfg:{...settingsValues(cfg),phone:normalized,setupStep:nextStep},activate},false);
      if(ok){ST(nextStep);if(activate)T('overview');}
    }catch(e){
      E((e as Error).message);
    }
  }

  function openBooking(a?:Row){
    const existingClient=a?clientObj(a.client):null;
    BO({
      client:a?.client||'',
      name:existingClient?.name||'',
      phone:existingClient?.phone||'',
      professional:a?.professional||(agendaChair!=='all'?agendaChair:ownerChair)||data?.professionals?.[0]?.id||'',
      services:a?.services.map((s:Row)=>s.id)||[],
      day:a?localDay(a.starts):date,
      period:'afternoon',
      start:'',
      id:a?.id
    });
    SL([]);
    M({type:a?'move':'booking'});
  }

  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.currentTarget));
    const p:Row={...f};
    try{
      switch(modal?.type){
        case 'client':
          p.phone=phone(String(p.phone));
          await mutate('client',p);
          break;
        case 'service':
          p.price=cents(p.price);
          p.duration=Number(p.duration);
          await mutate('service',{...p,id:modal.item?.id,active:p.active!=='false'});
          break;
        case 'finish':
          p.amount=cents(p.amount||0);
          await mutate('finish',{...p,id:modal.item.id});
          break;
        case 'pay':
          p.amount=cents(p.amount);
          await mutate('pay',{...p,charge:modal.item.id});
          break;
        case 'charge':
          p.amount=cents(p.amount);
          p.paid=p.paid==='on';
          await mutate('charge',p);
          break;
        case 'product':
          p.cost=cents(p.cost);
          p.price=cents(p.price);
          p.minimum=Number(p.minimum);
          await mutate('product',p);
          break;
        case 'stock':
          p.quantity=Number(p.quantity);
          p.paid=p.paid==='on';
          await mutate('stock',{...p,id:modal.item.id});
          break;
        case 'block':
          p.start=fromZonedTime(String(p.start),tz).toISOString();
          p.end=fromZonedTime(String(p.end),tz).toISOString();
          await mutate('block',p);
          break;
        case 'recurring':
          p.amount=cents(p.amount||0);
          p.variable=p.variable==='on';
          p.day=Number(p.day);
          await mutate('recurring',p);
          break;
        case 'membership':
          p.price=cents(p.price);
          p.weekday=Number(p.weekday);
          p.due_day=Number(p.due_day);
          p.services=new FormData(e.currentTarget).getAll('services');
          await mutate('membership',p);
          break;
        case 'booking':
        case 'move': {
          const payload:Row={...booking};
          if(modal.type==='booking'){
            payload.client='';
            payload.name=String(booking.name||'').trim();
            payload.phone=phone(String(booking.phone||''));
          }
          await mutate(modal.type==='move'?'move':'manual_book',payload);
          break;
        }
      }
    }catch(e){
      E((e as Error).message);
    }
  }

  async function copy(text:string){
    try{
      await navigator.clipboard.writeText(text);
      Toast('Copiado!');
      setTimeout(()=>Toast(''),3000);
    }catch{
      E('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  if(loading)return (
    <>
      <KronnerEntrance loading={true} onComplete={handleEntranceDone} hasError={!!error}/>
      <div style={{minHeight:'100vh',background:'#0D6E52'}} aria-busy="true"/>
    </>
  );
  const currentEmail=user?.primaryEmailAddress?.emailAddress||'';
  if(onboarding)return (
    <>
      <KronnerEntrance loading={false} onComplete={handleEntranceDone} hasError={!!error}/>
      <main className="login">
        <Link href="/" className="brand"><BrandLogo variant="dark" height={34}/></Link>
        <section className="login-card">
          <h1>Abrir minha barbearia</h1>
          <p>Você será o titular e terá a primeira cadeira. Se recebeu um convite de equipe, abra o link enviado pelo responsável.</p>
          {currentEmail&&(
            <p className="notice" style={{fontSize:13}}>
              Conta conectada: <strong>{currentEmail}</strong>. Se sua barbearia já existe em outro e-mail ou método de login (ex.: Google vs. código), troque de conta abaixo antes de criar uma nova.
            </p>
          )}
          {error&&<p role="alert" className="notice danger">{error}</p>}
          <div className="actions" style={{marginTop:12}}>
            <button disabled={busy} className="btn primary" onClick={async()=>{B(true);try{await call('create_shop');await load();}catch(e){E((e as Error).message);}finally{B(false);}}}>Criar minha barbearia</button>
            <button type="button" className="btn" onClick={async()=>{try{sessionStorage.removeItem('kroner:convite');for(const k of Object.keys(sessionStorage)){if(k.startsWith('booking:'))sessionStorage.removeItem(k);}}catch{}await signOut();location.assign('/entrar?next=/painel');}}>Entrar com outra conta</button>
          </div>
        </section>
      </main>
    </>
  );
  if(!data)return <div className="card"><h1>Não foi possível abrir o painel.</h1><p>{error}</p><button className="btn" onClick={load}>Tentar novamente</button></div>;

  const url=typeof window!=='undefined'?location.origin+'/b/'+data.shop.slug:'';
  const title=tabs.find(x=>x[0]===tab)?.[1];
  const paymentFields=<><Select label="Método" name="method" options={methods}/><div className="form-grid"><Field label="Data do pagamento" name="paid_on" type="date" value={today()}/><Field label="Disponível no caixa em" name="settles_on" type="date" value={today()}/></div><small>Taxas de cartão calculadas conforme as configurações. Pix e dinheiro sem desconto.</small></>;

  const dayReceived=total('in',data.payments.filter(p=>p.settles_on===date),true);
  const bufferMinutes=Number(cfg.buffer||10);

  const isTeam=data.professionals.length>1;
  const isManager=role==='owner'||role==='partner';
  const canPay=isManager||identity.can_register_payment;
  const canSeeFinance=isManager||identity.finance;
  const visibleTabs=tabs.filter(([id])=>{
    if(isManager)return true;
    if(id==='monthly')return identity.can_manage_memberships;
    if(id==='finance')return identity.finance;
    if(id==='reports')return identity.commission_enabled;
    if(id==='share')return identity.can_share_link;
    return true;
  });
  const effectiveDashScope=!isTeam?'all':isManager?dashScope:identity.id;
  const dashAppointments=effectiveDashScope==='all'?data.appointments:data.appointments.filter(a=>a.professional===effectiveDashScope);
  const shareUrl=role==='employee'&&identity.id?`${url}?p=${identity.id}`:url;
  const canEditSelectedApt=selectedApt&&(isManager||selectedApt.professional===identity.id);

  const navigateTab=(id:string)=>{
    if(!data.shop.active&&id!=='settings'){
      Toast('Conclua e ative as configurações da barbearia para liberar esta área.');
      setTimeout(()=>Toast(''),4000);
      MENU(false);
      return;
    }
    T(id);
    MENU(false);
  };

  const handleSignOut=async()=>{
    try{
      sessionStorage.removeItem('kroner:convite');
      for(const k of Object.keys(sessionStorage)){
        if(k.startsWith('booking:'))sessionStorage.removeItem(k);
      }
    }catch{}
    await signOut();
    location.assign('/entrar');
  };

  const topPillTabs=visibleTabs.filter(([id])=>['overview','agenda','clients','finance','reports'].includes(id));
  const railGroup1=visibleTabs.filter(([id])=>['overview','agenda','clients','monthly'].includes(id));
  const railGroup2=visibleTabs.filter(([id])=>['team','finance','reports','share','notices'].includes(id));
  const railGroup3=visibleTabs.filter(([id])=>['settings'].includes(id));

  // Real 6-day activity bars from dashAppointments (zero mock data)
  const sixDays=Array.from({length:6},(_,idx)=>{
    const dStr=shiftIsoDay(today(),-(5-idx));
    const count=dashAppointments.filter(a=>localDay(a.starts)===dStr&&a.status!=='cancelled').length;
    const label=new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',weekday:'short'}).format(new Date(dStr+'T12:00:00Z')).replace('.','').slice(0,3);
    return {day:dStr,label,count};
  });
  const maxBar=Math.max(1,...sixDays.map(x=>x.count));
  const firstName=(identity.name||cfg.professional||name||'Kronner').trim().split(' ')[0];

  return (
    <>
      <KronnerEntrance loading={false} onComplete={handleEntranceDone} hasError={!!error}/>
      <div className={'kr-shell '+(waveReady?'kr-wave-ready':'')}>
      <a className="kl-skip" href="#painel-conteudo">Ir para o conteúdo principal</a>
      {data.shop.active&&tour<0&&!modal&&<HolidayPrompt items={holidays} identity={data.shop.id} day={shopDay} review={()=>T('notices')}/>}
      {menu&&<div className="sidebar-backdrop" onClick={()=>MENU(false)} aria-hidden="true"/>}

      {/* Mobile Slide-Over Drawer */}
      <aside className={'kr-mobile-drawer '+(menu?'open':'')} aria-label="Menu mobile">
        <div className="split">
          <Link className="kr-topnav-brand" href="/"><BrandLogo variant="dark" height={28}/></Link>
          <button type="button" className="kr-icon-circle" aria-label="Fechar menu" onClick={()=>MENU(false)}><X size={18}/></button>
        </div>
        <div className="kr-mini-metric" style={{padding:'10px 12px'}}>
          <div>
            <strong>{name}</strong>
            <span>{ROLE_LABELS[role]}</span>
          </div>
        </div>
        <nav>
          {visibleTabs.map(([id,label,Icon])=>(
            <button key={id} type="button" className={tab===id?'active':''} onClick={()=>navigateTab(id)}>
              <Icon size={18}/>{label}
              {id==='notices'&&unreadNoticesCount>0&&<span className="kr-badge danger" style={{marginLeft:'auto'}}>{unreadNoticesCount}</span>}
            </button>
          ))}
        </nav>
        <div className="kr-actions-row">
          <button type="button" className="btn small" onClick={()=>{MENU(false);TO(0);}}><HelpCircle size={15}/> Ajuda</button>
          <button type="button" className="btn small" onClick={handleSignOut}><LogOut size={15}/> Sair</button>
        </div>
      </aside>

      {/* Floating Top Pill Navigation Bar (inside sticky backdrop so scrolling content never peeks above) */}
      <div className="kr-topnav-sticky">
      <header className="kr-topnav">
        <div className="kr-topnav-left">
          <button type="button" className="kr-mobile-trigger" onClick={()=>MENU(!menu)} aria-label="Abrir menu">
            <Menu size={19}/>
          </button>
          <Link className="kr-topnav-brand" href="/"><BrandLogo variant="dark" height={28}/></Link>
        </div>

        <nav className="kr-topnav-pills" aria-label="Navegação principal">
          {topPillTabs.map(([id,label])=>(
            <button
              key={id}
              type="button"
              className={'kr-topnav-pill '+(tab===id?'active':'')}
              onClick={()=>navigateTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="kr-topnav-right">
          <button type="button" className="kr-icon-circle" aria-label="Avisos" onClick={()=>navigateTab('notices')}>
            <Bell size={18}/>
            {unreadNoticesCount>0&&<span className="kr-icon-dot"/>}
          </button>
          <button type="button" className="kr-icon-circle" aria-label="Conhecer o sistema" onClick={()=>TO(0)}>
            <HelpCircle size={18}/>
          </button>
          <div className="kr-user-chip">
            <span className="kr-user-avatar">{firstName.slice(0,1).toUpperCase()}</span>
            <span className="kr-user-meta">
              <strong>{name}</strong>
              <small>{ROLE_LABELS[role]}</small>
            </span>
          </div>
        </div>
      </header>
      </div>

      <div className="kr-body-grid">
        {/* 3-Group Floating Left Icon Rail */}
        <aside className="kr-rail" aria-label="Atalhos laterais">
          <div className="kr-rail-group">
            {railGroup1.map(([id,label,Icon])=>(
              <button
                key={id}
                type="button"
                aria-label={label}
                data-tip={label}
                className={'kr-rail-btn '+(tab===id?'active':'')}
                onClick={()=>navigateTab(id)}
              >
                <Icon size={19}/>
              </button>
            ))}
          </div>
          {railGroup2.length>0&&(
            <div className="kr-rail-group">
              {railGroup2.map(([id,label,Icon])=>(
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  data-tip={label}
                  className={'kr-rail-btn '+(tab===id?'active':'')}
                  onClick={()=>navigateTab(id)}
                >
                  <Icon size={19}/>
                  {id==='notices'&&unreadNoticesCount>0&&<span className="kr-rail-badge">{unreadNoticesCount}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="kr-rail-group">
            {railGroup3.map(([id,label,Icon])=>(
              <button
                key={id}
                type="button"
                aria-label={label}
                data-tip={label}
                className={'kr-rail-btn '+(tab===id?'active':'')}
                onClick={()=>navigateTab(id)}
              >
                <Icon size={19}/>
              </button>
            ))}
            <button type="button" aria-label="Sair da conta" data-tip="Sair da conta" className="kr-rail-btn" onClick={handleSignOut}>
              <LogOut size={18}/>
            </button>
          </div>
        </aside>

        <main id="painel-conteudo" className="kr-main">
          {tab!=='overview'&&(
            <div className="kr-greeting-row">
              <div>
                <h1>{title}</h1>
                <p className="kr-sub">{descriptions[tab]}</p>
              </div>
              {data.shop.active&&tab!=='agenda'&&(
                <button type="button" className="kr-pill-cta primary" onClick={()=>openBooking()}>
                  <Plus size={17}/> Novo agendamento
                </button>
              )}
            </div>
          )}

          {error&&!modal&&<div role="alert" className="notice danger">{error}<button onClick={()=>E('')}>×</button></div>}
          {toast&&<div role="status" className="toast"><Check size={17}/>{toast}</div>}

          {tab==='overview'&&(
            <>
              <div className="kr-greeting-row">
                <h1>Bem-vindo de volta, <span>{firstName}</span></h1>
                <div className="kr-greeting-actions">
                  {isTeam&&isManager&&(
                    <label className="kr-inline-select">
                      <select aria-label="Escopo da dashboard" value={dashScope} onChange={e=>setDashScope(e.target.value)}>
                        <option value="all">Visão geral da barbearia</option>
                        <option value={identity.id}>Minha dashboard</option>
                        {data.professionals.filter(p=>p.id!==identity.id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  )}
                  {data.shop.active&&(
                    <button type="button" className="kr-pill-cta primary" onClick={()=>openBooking()}>
                      <Plus size={17}/> Novo agendamento
                    </button>
                  )}
                </div>
              </div>

              <div className="kr-bento">
                {/* Focal Emerald Metric Card */}
                <section className="kr-bento-card">
                  <div className="kr-bento-head">
                    <div>
                      <h2>{canSeeFinance?'Resumo financeiro':'Resumo da agenda'}</h2>
                      <small>{effectiveDashScope==='all'?'Toda a barbearia':'Perfil selecionado'}</small>
                    </div>
                    <button type="button" className="kr-corner-btn" aria-label="Abrir detalhes" onClick={()=>T(canSeeFinance?'finance':'agenda')}>
                      <ArrowUpRight size={16}/>
                    </button>
                  </div>
                  <div className="kr-emerald-card">
                    <div className="kr-emerald-top">
                      <span>{canSeeFinance?'Recebido hoje (líquido)':'Agendamentos hoje'}</span>
                      {canSeeFinance?<Wallet size={17}/>:<CalendarDays size={17}/>}
                    </div>
                    <div className="kr-emerald-val">
                      {canSeeFinance
                        ? money(total('in',data.payments.filter(p=>p.settles_on===today()),true))
                        : dashAppointments.filter(a=>localDay(a.starts)===today()&&a.status==='booked').length}
                    </div>
                    <div className="kr-emerald-foot">
                      <span>{name}</span>
                      <span>{dashAppointments.filter(a=>a.status==='done').length} concluídos</span>
                    </div>
                  </div>
                  <div className="kr-mini-metric">
                    <div>
                      <span>{canSeeFinance?'A receber em aberto':'Hoje na agenda'}</span>
                      <strong>
                        {canSeeFinance
                          ? money(pending.reduce((n,c)=>n+c.amount-paid(c.id),0))
                          : dashAppointments.filter(a=>localDay(a.starts)===today()&&a.status==='booked').length}
                      </strong>
                    </div>
                    <span className="kr-tag emerald">
                      {canSeeFinance?`${pending.length} aberto(s)`:'Ativo'}
                    </span>
                  </div>
                </section>

                {/* Real 6-Day Hatched Emerald Activity Bar Chart */}
                <section className="kr-bento-card">
                  <div className="kr-bento-head">
                    <div>
                      <h2>Movimento da semana</h2>
                      <small>Atendimentos confirmados nos últimos 6 dias</small>
                    </div>
                    <button type="button" className="kr-corner-btn" aria-label="Ver relatórios" onClick={()=>T(isManager||identity.commission_enabled?'reports':'agenda')}>
                      <ArrowUpRight size={16}/>
                    </button>
                  </div>
                  <div className="kr-bars" aria-label="Gráfico de atendimentos dos últimos 6 dias">
                    {sixDays.map(item=>{
                      const pct=Math.max(14,Math.round((item.count/maxBar)*100));
                      const isPeak=item.count>0&&item.count===maxBar;
                      return (
                        <div className="kr-bar-col" key={item.day}>
                          <div className="kr-bar-wrap">
                            {isPeak&&<span className="kr-bar-pill">{item.count}</span>}
                            <div
                              className={'kr-bar-fill '+(isPeak?'peak':'')}
                              style={{height:`${pct}%`}}
                              title={`${item.label}: ${item.count} atendimento(s)`}
                            />
                          </div>
                          <span className="kr-bar-label">{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Quick Share / Productivity Bento Card */}
                <section className="kr-bento-card">
                  <div className="kr-bento-head">
                    <div>
                      <h2>{isManager||identity.can_share_link?'Link de agendamento':'Sua produtividade'}</h2>
                      <small>{isManager||identity.can_share_link?'Compartilhe com seus clientes':'Resumo da sua cadeira'}</small>
                    </div>
                    <button type="button" className="kr-corner-btn" aria-label="Abrir" onClick={()=>T(isManager||identity.can_share_link?'share':'agenda')}>
                      <ArrowUpRight size={16}/>
                    </button>
                  </div>
                  <div className="kr-mini-metric">
                    <div>
                      <span>Hoje na agenda</span>
                      <strong>{dashAppointments.filter(a=>localDay(a.starts)===today()&&a.status==='booked').length}</strong>
                    </div>
                    <span className="kr-tag neutral">{data.clients.length} clientes</span>
                  </div>
                  {(isManager||identity.can_share_link)&&(
                    <>
                      <div className="link-box" style={{margin:0,fontSize:'0.78rem'}}>{shareUrl}</div>
                      <div className="kr-actions-row">
                        <button type="button" className="btn primary small" onClick={()=>copy(shareUrl)}><Copy size={14}/> Copiar</button>
                        <a href={shareUrl} target="_blank" rel="noreferrer" className="btn small">Abrir <ArrowUpRight size={13}/></a>
                      </div>
                    </>
                  )}
                </section>
              </div>

              <div className="kr-bento-wide">
                <section className="kr-bento-card">
                  <div className="kr-bento-head">
                    <div>
                      <h2>Próximos horários</h2>
                      <small>Clique em um atendimento para abrir na agenda</small>
                    </div>
                    <button type="button" className="text-btn" onClick={()=>T('agenda')}>Ver agenda →</button>
                  </div>
                  {dashAppointments.filter(a=>a.status==='booked'&&a.starts>=new Date().toISOString()).slice(0,5).map(a=>(
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={()=>{D(localDay(a.starts));setSelectedAptId(a.id);T('agenda');}}
                      onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){D(localDay(a.starts));setSelectedAptId(a.id);T('agenda');}}}
                      className="appointment-preview clickable-preview"
                      key={a.id}
                    >
                      <b>{at(a.starts)}</b>
                      <span>
                        <strong>{client(a.client)}</strong>
                        <small>{localDay(a.starts).split('-').reverse().join('/')} · {a.services.map((s:Row)=>s.name).join(' + ')}{isTeam&&effectiveDashScope==='all'?' · '+(data.professionals.find(p=>p.id===a.professional)?.name||''):''}</small>
                      </span>
                      <span className="badge">Agendado</span>
                    </div>
                  ))}
                  {!dashAppointments.some(a=>a.status==='booked'&&a.starts>=new Date().toISOString())&&<Empty title="Agenda pronta para receber." text="Compartilhe seu link ou cadastre o primeiro atendimento."/>}
                </section>

                <section className="kr-bento-card">
                  <div className="kr-bento-head">
                    <div>
                      <h2>Avisos e atenção</h2>
                      <small>{unreadNoticesCount>0?`${unreadNoticesCount} pendência(s) para revisar`:'Tudo em dia por aqui'}</small>
                    </div>
                    <button type="button" className="kr-corner-btn" aria-label="Ver avisos" onClick={()=>T('notices')}>
                      <ArrowUpRight size={16}/>
                    </button>
                  </div>
                  {notices.slice(0,3).map((n,i)=>(
                    <div key={i} className="kr-mini-metric" style={{cursor:'pointer'}} onClick={()=>T(n.tab)}>
                      <div>
                        <strong style={{fontSize:'0.88rem'}}>{n.title}</strong>
                        <span>{n.text}</span>
                      </div>
                    </div>
                  ))}
                  {!notices.length&&<p className="kr-sub">Nenhum aviso pendente no momento.</p>}
                </section>
              </div>
            </>
          )}

          {tab==='share'&&(isManager||identity.can_share_link)&&(
            <div className="kr-module">
              <ShareGuide url={shareUrl}/>
              {isTeam&&isManager&&(
                <section className="card kr-list-card">
                  <h3>Links individuais por profissional</h3>
                  <div className="kr-service-list">
                    {data.professionals.map(p=>{
                      const pUrl=`${url}?p=${p.id}`;
                      return (
                        <article className="kr-service-row" key={p.id}>
                          <div>
                            <strong>{p.name}</strong>
                            <div className="kr-cell-sub mono">{pUrl}</div>
                          </div>
                          <button type="button" className="btn small" onClick={()=>copy(pUrl)}><Copy size={13}/> Copiar link</button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {tab==='agenda'&&(
            <>
              <div className="agenda-header-bar">
                <div className="agenda-date-nav">
                  <button type="button" className="icon-btn" aria-label="Dia anterior" onClick={()=>D(shiftIsoDay(date,-1))}><ChevronLeft size={18}/></button>
                  <label className="agenda-date-picker" aria-label="Dia da agenda">
                    <CalendarDays size={16}/>
                    <span>{formatLongDayPt(date)}</span>
                    <input type="date" value={date} onChange={e=>D(e.target.value)} aria-label="Selecionar data"/>
                  </label>
                  <button type="button" className="icon-btn" aria-label="Próximo dia" onClick={()=>D(shiftIsoDay(date,1))}><ChevronRight size={18}/></button>
                </div>

                <div className="agenda-view-pills" role="group" aria-label="Modo de visualização">
                  <button type="button" className={agendaRange==='day'?'active':''} onClick={()=>setAgendaRange('day')}>Dia</button>
                  <button type="button" className={agendaRange==='week'?'active':''} onClick={()=>setAgendaRange('week')}>Semana</button>
                  <button type="button" className={agendaRange==='month'?'active':''} onClick={()=>setAgendaRange('month')}>Mês</button>
                </div>
              </div>

              <div className="agenda-subbar">
                <div className="actions" style={{margin:0}}>
                  {isTeam&&(
                    <label className="agenda-chair-filter" aria-label="Filtrar profissional">
                      <User size={16}/>
                      <select value={agendaChair} onChange={e=>setAgendaChair(e.target.value)}>
                        <option value="all">Toda a equipe</option>
                        {data.professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  )}
                  {isManager&&<button type="button" className="btn" onClick={()=>M({type:'block'})}><Lock size={15}/> Bloquear período</button>}
                </div>
                <button type="button" className="btn primary" onClick={()=>openBooking()}><Plus size={17}/> Novo agendamento</button>
              </div>

              <div className="agenda-kpis">
                <article className="agenda-kpi">
                  <span className="agenda-kpi-icon"><CalendarDays size={18}/></span>
                  <div>
                    <strong>{dayAllAppointments.filter(a=>a.status!=='cancelled').length}</strong>
                    <small>Agendamentos</small>
                  </div>
                </article>
                <article className="agenda-kpi">
                  <span className="agenda-kpi-icon green"><CheckCircle2 size={18}/></span>
                  <div>
                    <strong>{dayAllAppointments.filter(a=>a.status==='done').length}</strong>
                    <small>Concluídos</small>
                  </div>
                </article>
                <article className="agenda-kpi">
                  <span className="agenda-kpi-icon red"><XCircle size={18}/></span>
                  <div>
                    <strong>{dayAllAppointments.filter(a=>a.status==='absent').length}</strong>
                    <small>Não compareceu</small>
                  </div>
                </article>
                {canSeeFinance&&(
                <article className="agenda-kpi">
                  <span className="agenda-kpi-icon copper"><Wallet size={18}/></span>
                  <div>
                    <strong>{money(dayReceived)}</strong>
                    <small>Recebidos no dia</small>
                  </div>
                </article>
                )}
              </div>

              <div className={'agenda-workspace'+(selectedApt?'':' full-width')}>
                <section className="card" style={{marginBottom:0}}>
                  {!filteredAppointments.length?(
                    <Empty title="Um dia com espaço para novos clientes." text="Os horários livres aparecem automaticamente no link de agendamento ou você pode criar um agendamento manual apenas com nome e telefone."/>
                  ):(
                    <div className="agenda-timeline">
                      {filteredAppointments.map((a,idx)=>{
                        const durationMins=Math.max(5,Math.round((Date.parse(a.ends)-Date.parse(a.starts))/60000));
                        const isSelected=selectedApt?.id===a.id;
                        const statusMap:Record<string,{label:string;cls:string}>={
                          booked:{label:'Agendado',cls:''},
                          done:{label:'Concluído',cls:'green'},
                          absent:{label:'Não compareceu',cls:'red'},
                          cancelled:{label:'Cancelado',cls:'warn'}
                        };
                        const st=statusMap[a.status]||statusMap.booked;
                        const nextApt=filteredAppointments[idx+1];
                        const showBuffer=nextApt && localDay(nextApt.starts)===localDay(a.starts) && bufferMinutes>0;
                        return (
                          <div key={a.id}>
                            <div className="agenda-slot-item">
                              <div className="agenda-time-col">{at(a.starts)}</div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={()=>setSelectedAptId(a.id)}
                                onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')setSelectedAptId(a.id);}}
                                className={'agenda-card status-'+a.status+(isSelected?' selected-apt':'')}
                              >
                                <div className="agenda-card-main">
                                  <span className="agenda-card-avatar"><User size={16}/></span>
                                  <div className="agenda-card-info">
                                    <strong>{client(a.client)}</strong>
                                    <p>{a.services.map((s:Row)=>s.name).join(' + ')}</p>
                                    <div className="agenda-card-meta">
                                      <Clock size={13}/>
                                      <span>{agendaRange!=='day'?localDay(a.starts).split('-').reverse().join('/')+' · ':''}{at(a.starts)} às {at(a.ends)} · {durationMins} min</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="agenda-card-right">
                                  <span className={'badge '+st.cls}>{st.label}{a.membership?' · Mensalista':''}</span>
                                  <span className="badge neutral">{a.membership?'Incluído':money(a.price)}</span>
                                </div>
                              </div>
                            </div>
                            {showBuffer&&(
                              <div className="agenda-interval-row" style={{marginTop:8}}>
                                <div className="agenda-time-col" style={{paddingTop:0,fontSize:11,color:'var(--muted)'}}>{at(a.ends)}</div>
                                <div className="agenda-interval-pill">
                                  <Coffee size={14}/> Intervalo de segurança · {bufferMinutes} min
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {selectedApt&&(
                  <aside className="agenda-inspector" aria-label="Detalhes do agendamento">
                    <div className="agenda-inspector-head">
                      <h2>{client(selectedApt.client)}</h2>
                      <button type="button" className="close" aria-label="Fechar detalhes" onClick={()=>setSelectedAptId('')}><X size={16}/></button>
                    </div>

                    <div className="agenda-client-box">
                      <div className="agenda-client-box-left">
                        <span className="agenda-card-avatar"><User size={16}/></span>
                        <div>
                          <strong>{client(selectedApt.client)}</strong>
                          <small>{clientPhone(selectedApt.client)||'Telefone não informado'}</small>
                        </div>
                      </div>
                      {clientPhone(selectedApt.client)&&(
                        <a
                          className="whatsapp-pill"
                          href={'https://wa.me/'+clientPhone(selectedApt.client).replace(/\D/g,'')}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Conversar no WhatsApp"
                          title="Abrir no WhatsApp"
                        >
                          <MessageCircle size={17}/>
                        </a>
                      )}
                    </div>

                    <div className="agenda-detail-list">
                      <div className="agenda-detail-item">
                        <CalendarDays size={15}/>
                        <span>{formatLongDayPt(localDay(selectedApt.starts))}</span>
                      </div>
                      <div className="agenda-detail-item">
                        <Clock size={15}/>
                        <span>{at(selectedApt.starts)} às {at(selectedApt.ends)} ({Math.max(5,Math.round((Date.parse(selectedApt.ends)-Date.parse(selectedApt.starts))/60000))} min)</span>
                      </div>
                      <div className="agenda-detail-item">
                        <Scissors size={15}/>
                        <span>{selectedApt.services.map((s:Row)=>s.name).join(' + ')}</span>
                      </div>
                      <div className="agenda-detail-item">
                        <Tag size={15}/>
                        <strong>{selectedApt.membership?'Incluído no plano mensalista':money(selectedApt.price)}</strong>
                      </div>
                    </div>

                    <span className="agenda-section-label">Status do atendimento</span>
                    <div className="agenda-status-grid">
                      <button
                        type="button"
                        className={'agenda-status-btn'+(selectedApt.status==='booked'?' active-booked':'')}
                        disabled={selectedApt.status!=='booked'||busy}
                      >
                        <CalendarDays size={14}/> Agendado
                      </button>
                      <button
                        type="button"
                        className={'agenda-status-btn'+(selectedApt.status==='done'?' active-done':'')}
                        disabled={!canEditSelectedApt||selectedApt.status!=='booked'||busy}
                        onClick={()=>M({type:'finish',item:selectedApt})}
                      >
                        <Check size={14}/> Concluído
                      </button>
                      <button
                        type="button"
                        className={'agenda-status-btn'+(selectedApt.status==='absent'?' active-absent':'')}
                        disabled={!canEditSelectedApt||selectedApt.status!=='booked'||busy}
                        onClick={()=>{if(confirm('Registrar que o cliente não compareceu?'))mutate('cancel',{id:selectedApt.id,status:'absent'});}}
                      >
                        <X size={14}/> Não compareceu
                      </button>
                      <button
                        type="button"
                        className={'agenda-status-btn'+(selectedApt.status==='cancelled'?' active-cancelled':'')}
                        disabled={!canEditSelectedApt||selectedApt.status!=='booked'||busy}
                        onClick={()=>{if(confirm('Cancelar este agendamento?'))mutate('cancel',{id:selectedApt.id});}}
                      >
                        <Trash2 size={14}/> Cancelado
                      </button>
                    </div>

                    {canEditSelectedApt&&selectedApt.status==='booked'&&canPay&&(
                      <>
                        <span className="agenda-section-label">Pagamento rápido</span>
                        <label style={{marginBottom:10}}>
                          Forma de pagamento
                          <select value={payMethod} onChange={e=>setPayMethod(e.target.value)}>
                            {methods.map(([k,lbl])=><option key={k} value={k}>{lbl}</option>)}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn primary"
                          style={{width:'100%'}}
                          disabled={busy}
                          onClick={()=>mutate('finish',{
                            id:selectedApt.id,
                            payment:selectedApt.membership?'monthly':'full',
                            amount:selectedApt.price,
                            method:payMethod,
                            paid_on:today(),
                            settles_on:today()
                          })}
                        >
                          <Check size={16}/> Finalizar e registrar recebimento
                        </button>
                      </>
                    )}

                    {canEditSelectedApt&&selectedApt.status==='done'&&canPay&&selectedAptCharge&&selectedAptPaid<selectedAptCharge.amount&&(
                      <button
                        type="button"
                        className="btn primary"
                        style={{width:'100%',marginTop:8}}
                        onClick={()=>M({type:'pay',item:selectedAptCharge})}
                      >
                        Receber saldo pendente ({money(selectedAptCharge.amount-selectedAptPaid)})
                      </button>
                    )}

                    {canEditSelectedApt&&selectedApt.status==='booked'&&(
                      <div className="agenda-QuickActions">
                        <button type="button" className="btn small" onClick={()=>M({type:'finish',item:selectedApt})}>Finalizar</button>
                        <button type="button" className="btn small" onClick={()=>{if(confirm('Remarcar ou transferir este atendimento?'))openBooking(selectedApt);}}><RefreshCw size={13}/> Remarcar / Transferir</button>
                        <button type="button" className="btn small danger-outline" onClick={()=>{if(confirm('Cancelar este agendamento?'))mutate('cancel',{id:selectedApt.id});}}>Cancelar</button>
                      </div>
                    )}
                    {!canEditSelectedApt&&selectedApt.status==='booked'&&(
                      <p className="kr-sub" style={{marginTop:10}}>Visualização somente leitura — atendimento pertencente a outro profissional.</p>
                    )}
                  </aside>
                )}
              </div>

              {data.blocks.length>0&&(
                <section className="card" style={{marginTop:20}}>
                  <h2>Pausas e bloqueios</h2>
                  {data.blocks.map(b=>(
                    <div className="line" key={b.id}>
                      <span>{localDay(b.starts).split('-').reverse().join('/')} · {at(b.starts)}–{at(b.ends)} · {b.reason}</span>
                      {isManager&&<button className="text-btn" onClick={()=>mutate('unblock',{id:b.id})}>Liberar</button>}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}

          {tab==='clients'&&(
            <ClientsPanel
              clients={data.clients as any}
              appointments={data.appointments as any}
              charges={data.charges as any}
              payments={data.payments as any}
              memberships={data.memberships as any}
              professionals={data.professionals as any}
              cfg={data.shop.cfg as unknown as ShopConfig}
              identity={identity}
              onNewClient={()=>M({type:'client'})}
              onReceiveCharge={(ch:ChargeRow)=>M({type:'pay',item:ch})}
            />
          )}

          {tab==='team'&&(
            <EmployeesPanel
              identity={identity}
              call={call}
              onTeamChanged={load}
            />
          )}

          {tab==='monthly'&&(
            <>
              <div className="toolbar">
                <p>Débitos anteriores não bloqueiam novos atendimentos.</p>
                <button className="btn primary" onClick={()=>M({type:'membership'})}>Cadastrar mensalista</button>
              </div>
              {data.memberships.map(m=>(
                <section className="card" key={m.id}>
                  <div className="split">
                    <div>
                      <h2>{client(m.client)}</h2>
                      <p>{data.professionals.find(p=>p.id===m.professional)?.name} · {days[m.weekday]} · {m.at_time.slice(0,5)} · {money(m.price)}/mês</p>
                      <small>Vencimento: {m.due_day?'dia '+m.due_day:'último atendimento previsto do mês'}</small>
                    </div>
                    <span className="badge">{m.active?'Ativo':'Suspenso'}</span>
                  </div>
                  {m.active&&(
                    <form className="actions" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);mutate('monthly_generate',{id:m.id,month:String(f.get('month'))+'-01'});}}>
                      <Field label="Mês a reservar" name="month" type="month" value={today().slice(0,7)}/>
                      <button className="btn primary" disabled={busy}>Gerar agenda e mensalidade</button>
                      <button type="button" className="text-btn" onClick={()=>{if(confirm('Suspender e liberar todos os horários futuros deste plano? As dívidas permanecem.'))mutate('monthly_stop',{id:m.id});}}>Suspender plano</button>
                    </form>
                  )}
                </section>
              ))}
              {!data.memberships.length&&<div className="card"><Empty title="Horário fixo, todo mês." text="Cadastre o cliente, os serviços incluídos e o valor especial. Gere cada mês com conferência de conflitos."/></div>}
            </>
          )}

          {tab==='finance'&&canSeeFinance&&(
            <FinancePanel
              charges={data.charges as any}
              payments={data.payments as any}
              appointments={data.appointments as any}
              memberships={data.memberships as any}
              clients={data.clients as any}
              professionals={data.professionals as any}
              cfg={data.shop.cfg as unknown as ShopConfig}
              identity={identity}
              isTeam={isTeam}
              onNewCharge={()=>M({type:'charge'})}
              onGenerateExpenses={()=>mutate('generate_expenses',{month:today()})}
              onReceiveCharge={(ch:ChargeRow)=>M({type:'pay',item:ch})}
            />
          )}

          {tab==='reports'&&(isManager||identity.commission_enabled)&&(
            <ReportsPanel
              appointments={data.appointments as any}
              charges={data.charges as any}
              payments={data.payments as any}
              professionals={data.professionals as any}
              cfg={data.shop.cfg as unknown as ShopConfig}
              identity={identity}
              isTeam={isTeam}
              call={call}
            />
          )}

          {tab==='notices'&&(
            <>
              <p>Os avisos são internos. Os feriados permanecem listados aqui para você consultar ou alterar sua decisão quando precisar, sem repetir alertas na tela.</p>
              {notices.map((n,i)=>(
                <div className={'card notification '+(n.danger?'warning':'')} key={i}>
                  <Bell size={22}/>
                  <div>
                    <h3>{n.title}</h3>
                    <p>{n.text}</p>
                  </div>
                  {n.holiday?(
                    <div className="actions" style={{margin:0}}>
                      <button
                        type="button"
                        className={'btn '+(n.holidayDecision==='open'?'primary':'')}
                        disabled={busy}
                        onClick={()=>decideHoliday(n.holiday,'open')}
                      >
                        {n.holidayDecision==='open'?'✓ Vou trabalhar':'Vou trabalhar'}
                      </button>
                      <button
                        type="button"
                        className={'btn '+(n.holidayDecision==='closed'?'primary':'')}
                        disabled={busy}
                        onClick={()=>decideHoliday(n.holiday,'closed')}
                      >
                        {n.holidayDecision==='closed'?'✓ Não vou trabalhar':'Não vou trabalhar'}
                      </button>
                    </div>
                  ):(
                    <button className="btn" onClick={()=>T(n.tab)}>Conferir</button>
                  )}
                </div>
              ))}
              {!notices.length&&<div className="card"><Empty title="Tudo em dia por aqui." text="Quando algo precisar de atenção, você encontrará o aviso nesta área."/></div>}
            </>
          )}

          {tab==='settings'&&data.shop.active&&(
            <SettingsHub
              shop={data.shop as any}
              cfg={{
                ...(data.shop.cfg as unknown as ShopConfig),
                ...cfg,
                creditFee:typeof cfg.creditFee==='number'?cfg.creditFee:Math.round((Number(String(cfg.creditFee||'0').replace(',','.'))||0)*100),
                debitFee:typeof cfg.debitFee==='number'?cfg.debitFee:Math.round((Number(String(cfg.debitFee||'0').replace(',','.'))||0)*100),
                maxDays:Number(cfg.maxDays||21),
                grid:Number(cfg.grid||15),
                notice:Number(cfg.notice||10),
                cancelMinutes:Number(cfg.cancelMinutes||120),
                grace:Number(cfg.grace||5),
              }}
              setCfg={(next)=>{C({...next,creditFee:(next.creditFee/100).toString(),debitFee:(next.debitFee/100).toString()});setSettingsDirty(true);}}
              shopName={name}
              setShopName={(v)=>{N(v);setSettingsDirty(true);}}
              services={data.services as any}
              professionals={data.professionals as any}
              identity={identity}
              dirty={settingsDirty}
              saving={busy}
              onSaveSettings={async()=>{await saveSettings(false,step);setSettingsDirty(false);}}
              onLookupCep={lookupCep}
              onOpenNewService={()=>M({type:'service'})}
              onOpenEditService={(svc)=>M({type:'service',item:svc})}
              onToggleService={async(svc)=>{await mutate('service',{id:svc.id,name:svc.name,price:svc.price,duration:svc.duration,active:!svc.active},false);}}
              onGoToEmployees={()=>T('team')}
              call={call}
            />
          )}

          {tab==='settings'&&!data.shop.active&&(
            <>
              <div className="setup-progress">
                {['Identificação','Expediente','Serviços','Financeiro','Opcionais','Revisão'].map((x,i)=>(
                  <button key={x} className={step===i?'active':''} disabled={!data.shop.active&&i>step} onClick={()=>ST(i)}>
                    <span>{i+1}</span>{x}
                  </button>
                ))}
              </div>
              <section className="card settings">
                <span className="eyebrow">{data.shop.active?'CONFIGURAÇÕES':'PRIMEIRO ACESSO · '+(step+1)+' DE 6'}</span>
                <h2>{['Sua barbearia começa aqui.','Qual é o seu horário?','O que você oferece?','Dinheiro organizado desde o início.','Ative o que faz sentido.','Confira antes de começar.'][step]}</h2>
                <p>Campos essenciais precisam ser preenchidos. Produtos e mensalistas podem ficar para depois.</p>

                {step===0&&(
                  <div className="form-grid">
                    <label>Nome da barbearia *<input value={name} onChange={e=>N(e.target.value)} required/></label>
                    <label>Profissional responsável *<input value={cfg.professional} onChange={e=>C({...cfg,professional:e.target.value})}/></label>
                    <label>Telefone de contato com DDD *<input type="tel" placeholder="(34) 99999-0000" value={cfg.phone} onChange={e=>C({...cfg,phone:e.target.value})}/></label>
                    <label>CEP *<input inputMode="numeric" placeholder="00000-000" value={cfg.cep||''} onChange={e=>{const val=e.target.value;C({...cfg,cep:val});if(val.replace(/\D/g,'').length===8)lookupCep(val);}}/></label>
                    <label>Cidade *<input value={cfg.city} onChange={e=>C({...cfg,city:e.target.value})}/></label>
                    <label>UF *<input maxLength={2} value={cfg.state} onChange={e=>C({...cfg,state:e.target.value.toUpperCase()})}/></label>
                    <label>Fuso horário *<select value={cfg.timezone} onChange={e=>C({...cfg,timezone:e.target.value})}>{['America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha'].map(x=><option key={x}>{x}</option>)}</select></label>
                    {([['address','Logradouro'],['number','Número'],['complement','Complemento (opcional)'],['district','Bairro'],['ibge','Código IBGE (se disponível)']] as const).map(([key,label])=>(
                      <label key={key}>{label}<input value={cfg[key]||''} onChange={e=>C({...cfg,[key]:e.target.value})}/></label>
                    ))}
                    <label>País<input readOnly value="Brasil"/></label>
                    <button type="button" className="btn" onClick={()=>lookupCep(cfg.cep||'')}>Consultar CEP e preencher cidade</button>
                  </div>
                )}

                {step===1&&(
                  <>
                    <div className="table-wrap">
                      <table className="hours">
                        <thead><tr><th>Dia</th><th>Atende?</th><th>Abre</th><th>Encerra</th><th>Faz pausa?</th><th>Início pausa</th><th>Fim pausa</th></tr></thead>
                        <tbody>
                          {cfg.week.map((w:Row,i:number)=>{
                            const set=(k:string,v:any)=>C({...cfg,week:cfg.week.map((a:Row,j:number)=>j===i?{...a,[k]:v}:a)});
                            return (
                              <tr key={i}>
                                <td>{days[i]}</td>
                                <td><input type="checkbox" checked={w.enabled} onChange={e=>set('enabled',e.target.checked)} aria-label={'Atende '+days[i]}/></td>
                                <td><input type="time" value={w.open} onChange={e=>set('open',e.target.value)} disabled={!w.enabled}/></td>
                                <td><input type="time" value={w.close} onChange={e=>set('close',e.target.value)} disabled={!w.enabled}/></td>
                                <td><input type="checkbox" checked={!!w.lunchStart} disabled={!w.enabled} aria-label={'Pausa '+days[i]} onChange={e=>C({...cfg,week:cfg.week.map((a:Row,j:number)=>j===i?{...a,lunchStart:e.target.checked?'12:00':'',lunchEnd:e.target.checked?'13:00':''}:a)})}/></td>
                                <td><input type="time" value={w.lunchStart} disabled={!w.lunchStart||!w.enabled} onChange={e=>set('lunchStart',e.target.value)}/></td>
                                <td><input type="time" value={w.lunchEnd} disabled={!w.lunchStart||!w.enabled} onChange={e=>set('lunchEnd',e.target.value)}/></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="form-grid">
                      {[['maxDays','Agendar até quantos dias à frente?'],['notice','Antecedência mínima (minutos)'],['grid','Intervalo entre opções (minutos)'],['cancelMinutes','Cancelar até quantos minutos antes?']].map(([key,label])=>(
                        <label key={key}>{label}<input type="number" min="0" value={cfg[key]} onChange={e=>C({...cfg,[key]:e.target.value})}/></label>
                      ))}
                    </div>
                    <div className="review" style={{marginBottom:16}}>
                      <label className="checkbox" style={{marginBottom:8}}>
                        <input
                          type="checkbox"
                          checked={Number(cfg.buffer??10)>0}
                          onChange={e=>C({...cfg,buffer:e.target.checked?(Number(cfg.buffer)>0?cfg.buffer:10):0})}
                        />
                        <strong>Ativar intervalo de segurança entre atendimentos</strong>
                      </label>
                      <p style={{margin:'0 0 12px',fontSize:13}}>
                        Esse tempo extra fica reservado automaticamente após cada atendimento caso você gaste mais tempo do que o horário programado, evitando atrasar o próximo cliente.
                      </p>
                      {Number(cfg.buffer??10)>0&&(
                        <label style={{maxWidth:280,marginBottom:0}}>
                          Tempo de segurança (minutos)
                          <input
                            type="number"
                            min="1"
                            max="180"
                            value={cfg.buffer??10}
                            onChange={e=>C({...cfg,buffer:e.target.value})}
                          />
                        </label>
                      )}
                    </div>
                    <div className="notice">O último atendimento deve terminar até o encerramento. Sem almoço, manhã termina às 11h; tarde vai até 18h; noite começa às 18h, respeitando o expediente.</div>
                    {data.shop.active&&<div className="notice">Mudanças no expediente não cancelam reservas existentes. Confira a agenda e remarque os atendimentos afetados.</div>}
                  </>
                )}

                {step===2&&(
                  <>
                    <div className="service-list">
                      {data.services.map(s=>(
                        <div className="line" key={s.id}>
                          <span><b>{s.name}</b> · {s.duration} min · {money(s.price)} {s.active?'':'(desativado)'}</span>
                          <button className="btn" onClick={()=>M({type:'service',item:s})}>Editar</button>
                        </div>
                      ))}
                    </div>
                    <button className="btn primary" onClick={()=>M({type:'service'})}>Adicionar serviço</button>
                    <p>Cadastre pelo menos um serviço. Corte, barba e sobrancelha podem ter durações diferentes.</p>
                  </>
                )}

                {step===3&&(
                  <>
                    <div className="form-grid">
                      {[['creditFee','Taxa de crédito (%)'],['debitFee','Taxa de débito (%)']].map(([key,label])=>(
                        <label key={key}>{label}<input type="text" inputMode="decimal" value={cfg[key]} onChange={e=>C({...cfg,[key]:e.target.value})}/></label>
                      ))}
                      <label>Carência até considerar atrasado (dias)<input type="number" min="0" max="90" value={cfg.grace} onChange={e=>C({...cfg,grace:e.target.value})}/></label>
                    </div>
                    <div className="notice">Pix e dinheiro entram sem taxa. Taxas zero precisam refletir o seu contrato. O sistema não calcula impostos. Ao salvar, você confirma os valores informados.</div>
                  </>
                )}

                {step===4&&(
                  <>
                    <div className="form-grid">
                      <label>Avisar cliente após dias sem atendimento<input type="number" min="1" value={cfg.returnDays||30} onChange={e=>C({...cfg,returnDays:e.target.value})}/></label>
                    </div>
                    <p>Mensalistas, equipe e despesas recorrentes podem ser configurados depois, nas próprias abas.</p>
                  </>
                )}

                {step===5&&(
                  <>
                    <div className="review">
                      <h3>{name}</h3>
                      <p>{cfg.professional} · {cfg.city}/{cfg.state} · {cfg.phone}</p>
                      <p>{data.services.filter(s=>s.active).length} serviços · {cfg.maxDays} dias de antecedência máxima · {cfg.grace} dias de carência</p>
                      <p>Estoque {cfg.stock?'ativado':'não utilizado'} · Fuso {cfg.timezone}</p>
                    </div>
                    {data.shop.active&&(
                      <>
                        <h3>Seu link fixo</h3>
                        <div className="link-box">{url}</div>
                        <button className="btn" onClick={()=>copy(url)}>Copiar link</button>
                      </>
                    )}
                  </>
                )}

                <div className="setup-footer">
                  {step>0&&<button className="btn" onClick={()=>ST(step-1)}>Voltar</button>}
                  <button disabled={busy} className="btn primary" onClick={()=>{
                    if(step===0&&(!/^\d{5}-?\d{3}$/.test(cfg.cep||'')||!cfg.address?.trim()||!cfg.number?.trim()||!cfg.district?.trim()||(cfg.ibge&&!/^\d{7}$/.test(cfg.ibge)))){E('Confira CEP, logradouro, número, bairro e código IBGE.');return;}
                    if(step===0&&(!cfg.professional||!cfg.city||cfg.state?.length!==2)){E('Preencha profissional, cidade e UF.');return;}
                    if(step===2&&!data.services.some(s=>s.active)){E('Cadastre ao menos um serviço ativo.');return;}
                    saveSettings(step===5,step<5?step+1:step);
                  }}>{busy?'Salvando…':step===5?(data.shop.active?'Salvar configurações':'Ativar minha barbearia'):'Salvar e continuar'} <ChevronRight size={17}/></button>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
      <footer className="app-footer">
          <span>Kronner · Tempo para o seu talento.</span>
          <nav className="app-footer-links" aria-label="Documentos legais">
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/termos">Termos</Link>
            <Link href="/reembolso">Reembolso</Link>
            <Link href="/cookies">Cookies</Link>
          </nav>
        </footer>
        <nav className="mobile-bottom-nav" aria-label="Navegação rápida">
            {([
              ['overview','Início',LayoutDashboard],
              ['agenda','Agenda',CalendarDays],
              ['clients','Clientes',Users],
              ...(canSeeFinance?[['finance','Financeiro',Wallet]]:[['team','Equipe',UserCog]])
            ] as any[]).map(([id,lbl,Icon])=>(
              <button
                key={id}
                type="button"
                className={tab===id?'active':''}
                onClick={()=>{
                  if(!data.shop.active&&id!=='settings'){
                    Toast('Conclua e ative as configurações da barbearia para liberar esta área.');
                    setTimeout(()=>Toast(''),4000);
                    return;
                  }
                  T(id);
                }}
              >
                <Icon size={18}/>
                <span>{lbl}</span>
              </button>
            ))}
            <button type="button" onClick={()=>MENU(true)}>
              <Menu size={18}/>
              <span>Mais</span>
            </button>
          </nav>

      {tour>=0&&(
        <div className="overlay">
          <section className="modal tour" role="dialog" aria-modal="true" aria-label="Apresentação do sistema">
            <div className="split">
              <span className="eyebrow">CONHEÇA A KRONNER · {tour+1} DE {tabs.length}</span>
              <button type="button" className="close" aria-label="Fechar apresentação" onClick={()=>{TO(-1);sessionStorage.setItem('tour-seen','1');try{localStorage.setItem('kroner:tour-seen:'+data.shop.id,'1');}catch{}}}>×</button>
            </div>
            <h2>{tabs[tour][1]}</h2>
            <p>{descriptions[tabs[tour][0]]}</p>
            <p>{tabs[tour][0]==='settings'?'Agora vamos configurar o essencial, etapa por etapa. Produtos e mensalistas são opcionais.':'Você poderá acessar esta área pelo menu lateral e rever esta apresentação quando quiser.'}</p>
            <div className="actions" style={{justifyContent:'space-between'}}>
              <button type="button" className="text-btn" onClick={()=>{TO(-1);sessionStorage.setItem('tour-seen','1');try{localStorage.setItem('kroner:tour-seen:'+data.shop.id,'1');}catch{}}}>Pular apresentação</button>
              <div className="actions" style={{marginTop:0}}>
                {tour>0&&<button type="button" className="btn" onClick={()=>TO(tour-1)}>← Anterior</button>}
                <button type="button" className="btn primary" onClick={()=>{
                  if(tour===tabs.length-1){
                    TO(-1);
                    sessionStorage.setItem('tour-seen','1');
                    try{localStorage.setItem('kroner:tour-seen:'+data.shop.id,'1');}catch{}
                    if(!data.shop.active)T('settings');
                  }else TO(tour+1);
                }}>{tour===tabs.length-1?(data.shop.active?'Concluir':'Ir às configurações'):'Próxima área'} →</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {modal&&(
        <div className="overlay">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Cadastro">
            <div className="split">
              <h2>{{
                client:'Novo cliente',
                service:'Serviço',
                finish:'Finalizar atendimento',
                pay:'Registrar pagamento',
                charge:'Novo lançamento',
                product:'Cadastrar produto',
                stock:'Movimentar estoque',
                block:'Bloquear período',
                recurring:'Despesa recorrente',
                membership:'Cliente mensalista',
                booking:'Novo agendamento',
                move:'Remarcar com confirmação'
              }[modal.type as string]}</h2>
              <button className="close" onClick={()=>{M(null);E('');}} aria-label="Fechar">×</button>
            </div>
            <form onSubmit={submit}>
              {modal.type==='client'&&<><Field label="Nome" name="name"/><Field label="Telefone com DDD" name="phone" type="tel"/></>}
              {modal.type==='service'&&(
                <>
                  <Field label="Nome do serviço" name="name" value={modal.item?.name}/>
                  <div className="form-grid">
                    <Field label="Preço (R$)" name="price" type="number" min="0" step="0.01" value={modal.item?modal.item.price/100:''}/>
                    <Field label="Duração (minutos)" name="duration" type="number" min="5" max="480" value={modal.item?.duration||30}/>
                  </div>
                  {modal.item&&<Select label="Disponibilidade" name="active" value={String(modal.item.active)} options={[["true","Ativo"],["false","Desativado"]]}/>}
                  <small>Ao salvar preço zero, você confirma que o serviço é gratuito.</small>
                </>
              )}
              {modal.type==='finish'&&(
                <>
                  <p>{client(modal.item.client)} · {money(modal.item.price)}</p>
                  <Select label="Situação do pagamento" name="payment" options={modal.item.membership?[['monthly','Incluído na mensalidade']]:canPay?[['full','Pagamento integral'],['partial','Pagamento parcial'],['none','Não pagou']]:[['none','Não pagou']]}/>
                  {!modal.item.membership&&canPay&&<><Field label="Valor pago (preencher se parcial)" name="amount" type="number" value="0" min="0" step="0.01" required={false}/>{paymentFields}</>}
                </>
              )}
              {modal.type==='pay'&&(
                <>
                  <p>{modal.item.description} · saldo {money(modal.item.amount-paid(modal.item.id))}</p>
                  <Field label="Valor (R$)" name="amount" type="number" min="0.01" step="0.01" value={(modal.item.amount-paid(modal.item.id))/100}/>
                  {paymentFields}
                </>
              )}
              {modal.type==='charge'&&(
                <>
                  <Field label="Descrição" name="description"/>
                  <div className="form-grid">
                    <Select label="Movimento" name="direction" options={[["out","Saída"],["in","Entrada"]]}/>
                    <Select label="Categoria" name="category" options={[["expense","Despesa"],["injection","Aporte do dono"],["withdrawal","Retirada"],["other","Outro"]]}/>
                    <Field label="Valor (R$)" name="amount" type="number" min="0.01" step="0.01"/>
                    <Field label="Data / vencimento" name="due" type="date" value={today()}/>
                  </div>
                  <label className="checkbox"><input type="checkbox" name="paid"/>Já pago / recebido</label>
                  <Select label="Método" name="method" options={methods}/>
                </>
              )}
              {modal.type==='product'&&(
                <>
                  <Field label="Nome do produto" name="name"/>
                  <div className="form-grid">
                    <Field label="Custo unitário (R$)" name="cost" type="number" min="0" step="0.01"/>
                    <Field label="Preço de venda (R$)" name="price" type="number" min="0" step="0.01"/>
                    <Field label="Estoque mínimo" name="minimum" type="number" min="0" value="2"/>
                    <Field label="Validade (opcional)" name="expires" type="date" required={false}/>
                  </div>
                  <small>Depois de cadastrar, registre uma compra para dar entrada na quantidade e no financeiro.</small>
                </>
              )}
              {modal.type==='stock'&&(
                <>
                  <p>{modal.item.name} · {modal.item.quantity} em estoque</p>
                  <Select label="Movimento" name="kind" options={[["purchase","Compra / entrada"],["sale","Venda"],["loss","Perda"],["internal","Uso interno"]]}/>
                  <Field label="Quantidade" name="quantity" type="number" min="1"/>
                  <Field label="Data" name="due" type="date" value={today()}/>
                  <Field label="Disponível no caixa em" name="settles_on" type="date" value={today()}/>
                  <Field label="Observação" name="note" required={false}/>
                  <label className="checkbox"><input type="checkbox" name="paid" defaultChecked/>Compra ou venda já paga</label>
                  <Select label="Método" name="method" options={methods}/>
                </>
              )}
              {modal.type==='block'&&(
                <>
                  <Field label="Motivo" name="reason"/>
                  <Field label="Início" name="start" type="datetime-local"/>
                  <Field label="Fim" name="end" type="datetime-local"/>
                  <small>Se houver reservas no intervalo, será necessário resolvê-las antes. Nada será cancelado automaticamente.</small>
                </>
              )}
              {modal.type==='recurring'&&(
                <>
                  <Field label="Descrição (ex.: aluguel, energia)" name="name"/>
                  <Field label="Valor previsto (R$)" name="amount" type="number" min="0" step="0.01" value="0"/>
                  <Field label="Dia de vencimento" name="day" type="number" min="1" max="28" value="5"/>
                  <label className="checkbox"><input type="checkbox" name="variable"/>Valor variável: lembrar de lançar manualmente</label>
                  <small>Despesas fixas são geradas como previsão e só saem do caixa quando pagas.</small>
                </>
              )}
              {modal.type==='membership'&&(
                <>
                  <Select label="Cadeira responsável" name="professional" options={data.professionals.map(p=>[p.id,p.name])}/>
                  <Select label="Cliente" name="client" options={data.clients.map(c=>[c.id,c.name])}/>
                  <div className="form-grid">
                    <Select label="Dia fixo semanal" name="weekday" options={days.map((d,i)=>[String(i),d])}/>
                    <Field label="Horário fixo" name="time" type="time"/>
                    <Field label="Mensalidade (R$)" name="price" type="number" min="0" step="0.01"/>
                    <Field label="Vence no dia (0 = último corte do mês)" name="due_day" type="number" min="0" max="28" value="5"/>
                  </div>
                  <h3>Serviços incluídos em cada visita</h3>
                  {data.services.filter(s=>s.active).map(s=><label className="checkbox" key={s.id}><input type="checkbox" name="services" value={s.id}/>{s.name}</label>)}
                </>
              )}
              {['booking','move'].includes(modal.type)&&(
                <>
                  {data.professionals.length>1&&(
                    <label>Profissional
                      <select value={booking.professional} onChange={e=>BO({...booking,professional:e.target.value,start:''})}>
                        {data.professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  )}
                  {modal.type==='booking'?(
                    <div className="form-grid">
                      <label>Nome do cliente *
                        <input
                          required
                          minLength={2}
                          placeholder="Ex.: Pedro Silva"
                          value={booking.name||''}
                          onChange={e=>BO({...booking,name:e.target.value})}
                        />
                      </label>
                      <label>Telefone com DDD *
                        <input
                          required
                          type="tel"
                          placeholder="(34) 99999-0000"
                          value={booking.phone||''}
                          onChange={e=>BO({...booking,phone:e.target.value})}
                        />
                      </label>
                    </div>
                  ):(
                    <p>Cliente: <strong>{client(booking.client)}</strong></p>
                  )}
                  <h3>Serviços</h3>
                  {data.services.filter(s=>s.active).map(s=>(
                    <label className="checkbox" key={s.id}>
                      <input
                        type="checkbox"
                        disabled={modal.type==='move'}
                        checked={booking.services.includes(s.id)}
                        onChange={e=>BO({...booking,services:e.target.checked?[...booking.services,s.id]:booking.services.filter((id:string)=>id!==s.id)})}
                      />
                      {s.name} · {s.duration} min · {money(s.price)}
                    </label>
                  ))}
                  <div className="form-grid">
                    <label>Dia<input type="date" value={booking.day} onChange={e=>BO({...booking,day:e.target.value})}/></label>
                    <label>Período
                      <select value={booking.period} onChange={e=>BO({...booking,period:e.target.value})}>
                        <option value="morning">Manhã</option>
                        <option value="afternoon">Tarde</option>
                        <option value="night">Noite</option>
                      </select>
                    </label>
                  </div>
                  <label>Horário disponível
                    <select required value={booking.start} onChange={e=>BO({...booking,start:e.target.value})}>
                      <option value="">{slots.length?'Selecione um horário':'Escolha os serviços acima para ver horários'}</option>
                      {slots.map(s=><option key={s.start} value={s.start}>{s.label}</option>)}
                    </select>
                  </label>
                </>
              )}
              {error&&<div role="alert" className="notice danger">{error}</div>}
              <div className="actions">
                <button className="btn" type="button" onClick={()=>{M(null);E('');}}>Voltar</button>
                <button className="btn primary" disabled={busy}>{busy?'Salvando…':'Salvar'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
    </>
  );
}
