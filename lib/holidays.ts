const fixedNationalDates: Record<string,string> = {
  '01-01':'Confraternização Universal','04-21':'Tiradentes','05-01':'Dia do Trabalho',
  '09-07':'Independência','10-12':'Nossa Senhora Aparecida','11-02':'Finados',
  '11-15':'Proclamação da República','11-20':'Consciência Negra','12-25':'Natal'
};
export function pendingHolidays(day:string, decisions:Record<string,string>={}) {
  const first=Date.parse(day+'T12:00:00Z');
  return Array.from({length:31},(_,days)=>{
    const date=new Date(first+days*86400000).toISOString().slice(0,10);
    return {date,days,name:fixedNationalDates[date.slice(5)],scope:'Nacional',stage:days<=7?7:days<=14?14:30};
  }).filter(item=>item.name && !decisions[item.date]);
}
