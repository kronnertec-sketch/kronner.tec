const fixedNationalDates: Record<string,string> = {
  '01-01':'Confraternização Universal','04-21':'Tiradentes','05-01':'Dia do Trabalho',
  '09-07':'Independência','10-12':'Nossa Senhora Aparecida','11-02':'Finados',
  '11-15':'Proclamação da República','11-20':'Consciência Negra','12-25':'Natal'
};

export const stateHolidaysByUf: Record<string, Array<{mmdd:string;name:string}>> = {
  AC:[{mmdd:'01-23',name:'Dia do Evangélico'},{mmdd:'06-15',name:'Aniversário do Acre'},{mmdd:'09-05',name:'Dia da Amazônia'},{mmdd:'11-17',name:'Tratado de Petrópolis'}],
  AL:[{mmdd:'06-24',name:'São João'},{mmdd:'06-29',name:'São Pedro'},{mmdd:'09-16',name:'Emancipação Política de Alagoas'}],
  AM:[{mmdd:'09-05',name:'Elevação do Amazonas à categoria de província'},{mmdd:'12-08',name:'Nossa Senhora da Conceição'}],
  AP:[{mmdd:'03-19',name:'Dia de São José'},{mmdd:'07-25',name:'São Tiago'},{mmdd:'10-05',name:'Criação do Estado do Amapá'}],
  BA:[{mmdd:'07-02',name:'Independência da Bahia'}],
  CE:[{mmdd:'03-19',name:'São José'},{mmdd:'03-25',name:'Data Magna do Ceará'}],
  DF:[{mmdd:'04-21',name:'Fundação de Brasília'},{mmdd:'11-30',name:'Dia do Evangélico'}],
  ES:[{mmdd:'04-17',name:'Nossa Senhora da Penha'}],
  GO:[{mmdd:'10-24',name:'Pedra Fundamental de Goiânia'}],
  MA:[{mmdd:'07-28',name:'Adesão do Maranhão à Independência'}],
  MG:[{mmdd:'04-21',name:'Data Magna de Minas Gerais'}],
  MS:[{mmdd:'10-11',name:'Criação do Estado de Mato Grosso do Sul'}],
  MT:[{mmdd:'11-20',name:'Consciência Negra'}],
  PA:[{mmdd:'08-15',name:'Adesão do Grão-Pará à Independência'}],
  PB:[{mmdd:'08-05',name:'Fundação do Estado da Paraíba'}],
  PE:[{mmdd:'03-06',name:'Data Magna de Pernambuco'},{mmdd:'06-24',name:'São João'}],
  PI:[{mmdd:'03-13',name:'Dia da Batalha do Jenipapo'},{mmdd:'10-19',name:'Dia do Piauí'}],
  PR:[{mmdd:'12-19',name:'Emancipação Política do Paraná'}],
  RJ:[{mmdd:'04-23',name:'Dia de São Jorge'},{mmdd:'10-20',name:'Dia do Comércio'}],
  RN:[{mmdd:'06-29',name:'Dia de São Pedro'},{mmdd:'10-03',name:'Mártires de Cunhaú e Uruaçu'}],
  RO:[{mmdd:'01-04',name:'Criação do Estado de Rondônia'},{mmdd:'06-18',name:'Dia do Evangélico'}],
  RR:[{mmdd:'10-05',name:'Criação do Estado de Roraima'}],
  RS:[{mmdd:'09-20',name:'Revolução Farroupilha'}],
  SC:[{mmdd:'08-11',name:'Criação da Capitania de Santa Catarina'}],
  SE:[{mmdd:'07-08',name:'Autonomia Política de Sergipe'}],
  SP:[{mmdd:'07-09',name:'Revolução Constitucionalista de 1932'}],
  TO:[{mmdd:'03-18',name:'Autonomia do Estado do Tocantins'},{mmdd:'09-08',name:'Nossa Senhora da Natividade'},{mmdd:'10-05',name:'Criação do Estado do Tocantins'}]
};

export function easterSunday(year:number): Date {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day,12,0,0));
}

function movableNationalDatesForYear(year:number): Record<string,string> {
  const easter=easterSunday(year).getTime();
  const add=(days:number)=>new Date(easter+days*86400000).toISOString().slice(0,10);
  return {
    [add(-47)]:'Carnaval',
    [add(-2)]:'Sexta-Feira Santa',
    [add(60)]:'Corpus Christi'
  };
}

export function pendingHolidays(day:string, decisions:Record<string,string>={}, uf?:string, customEvents:Array<{date:string;name:string;scope:string}>=[]) {
  const first=Date.parse(day+'T12:00:00Z');
  const startYear=Number(day.slice(0,4));
  const movable:Record<string,string>={
    ...movableNationalDatesForYear(startYear),
    ...movableNationalDatesForYear(startYear+1)
  };
  const stateMap:Record<string,string>={};
  if(uf&&stateHolidaysByUf[uf.toUpperCase()]){
    for(const item of stateHolidaysByUf[uf.toUpperCase()])stateMap[item.mmdd]=item.name;
  }
  const customMap:Record<string,{name:string;scope:string}>={};
  for(const ev of customEvents){
    if(ev?.date&&ev?.name)customMap[ev.date]={name:ev.name,scope:ev.scope||'Municipal'};
  }
  return Array.from({length:31},(_,days)=>{
    const date=new Date(first+days*86400000).toISOString().slice(0,10);
    const mmdd=date.slice(5);
    const custom=customMap[date];
    const national=fixedNationalDates[mmdd]||movable[date];
    const stateName=stateMap[mmdd];
    const name=custom?.name||national||stateName;
    const scope=custom?.scope||(national?'Nacional':stateName?'Estadual':'Nacional');
    return {date,days,name,scope,stage:days<=7?7:days<=14?14:30};
  }).filter(item=>item.name && !decisions[item.date]);
}
