create or replace function kroner_private.chair_slots(sid uuid,chair uuid,svc uuid[],day date,period text,manual boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare professional_row kroner_private.professionals; buffer_minutes integer; s kroner_private.shops; w jsonb; dur integer; price integer; n integer; lo time; hi time; lunch1 time; lunch2 time; a timestamptz; b timestamptz; cursor_t time; z text; result jsonb:='[]'; step integer;
begin
 select * into s from kroner_private.shops where id=sid and active; if s.id is null then return result;end if;
 select * into professional_row from kroner_private.professionals where id=chair and shop=sid and status='active';
 if professional_row.id is null then return result;end if;
 s.cfg:=s.cfg||professional_row.preferences;
 if (kroner_private.local_holiday(sid,day) or to_char(day,'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')) and coalesce(case when professional_row.role='owner' then s.cfg->'holidayDecisions' else professional_row.preferences->'holidayDecisions' end->>day::text,'')<>'open' then return result;end if;
 buffer_minutes:=coalesce((s.cfg->>'buffer')::integer,10);
 select sum(coalesce((professional_row.preferences->'durations'->>id::text)::int,duration)),sum(services.price),count(*) into dur,price,n from kroner_private.services where shop=sid and active and id=any(svc) and not(coalesce(professional_row.preferences->'disabledServices','[]') ? id::text);
 if n=0 or n<>cardinality(svc) or dur>=1440 then return result;end if;
 z:=coalesce(s.cfg->>'timezone','America/Sao_Paulo');
 if day<(now() at time zone z)::date or day>(now() at time zone z)::date+coalesce((s.cfg->>'maxDays')::int,21) then return result;end if;
 w:=s.cfg->'week'->extract(dow from day)::int;if not coalesce((w->>'enabled')::boolean,false) then return result;end if;
 lo:=(w->>'open')::time;hi:=(w->>'close')::time;lunch1:=nullif(w->>'lunchStart','')::time;lunch2:=nullif(w->>'lunchEnd','')::time;
 if period='morning' then hi:=least(hi,coalesce(lunch1,'11:00'::time));
 elsif period='afternoon' then lo:=greatest(lo,coalesce(lunch2,'11:00'::time));hi:=least(hi,'18:00'::time);
 elsif period='night' then lo:=greatest(lo,'18:00'::time);
 else raise exception 'Período inválido.';end if;
 step:=greatest(5,coalesce((s.cfg->>'grid')::integer,15));cursor_t:=lo;
 while day+cursor_t+make_interval(mins=>dur)<=day+hi and cursor_t<hi loop
 a:=(day+cursor_t) at time zone z;b:=a+make_interval(mins=>dur);
 if a>=now()+make_interval(mins=>case when manual then 0 else coalesce((s.cfg->>'notice')::int,10) end)
 and (lunch1 is null or not (cursor_t<lunch2 and day+cursor_t+make_interval(mins=>dur)>day+lunch1))
 and not exists(select 1 from kroner_private.appointments x where x.shop=sid and x.professional=chair and x.status in('booked','done') and x.starts<b+make_interval(mins=>buffer_minutes) and x.ends+make_interval(mins=>buffer_minutes)>a)
 and not exists(select 1 from kroner_private.blocks x where x.shop=sid and x.starts<b and x.ends>a)
 then result:=result||jsonb_build_object('start',a,'end',b,'label',to_char(cursor_t,'HH24:MI'),'duration',dur,'price',price);end if;
 exit when cursor_t+make_interval(mins=>step)<=cursor_t;cursor_t:=cursor_t+make_interval(mins=>step);
 end loop;return result;
end $$;
