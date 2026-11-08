create function kroner_private.is_holiday_closed(shop_id uuid, appointment_day date)
returns boolean language sql stable set search_path='' as $$
 select to_char(appointment_day,'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')
 and coalesce(s.cfg->'holidayDecisions'->>appointment_day::text,'pending') <> 'open'
 from kroner_private.shops s where s.id=shop_id;
$$;
revoke all on function kroner_private.is_holiday_closed(uuid,date) from public,anon,authenticated;
alter function kroner_private.available(uuid,uuid[],date,text) rename to available_without_holidays;
create function kroner_private.available(sid uuid,svc uuid[],day date,period text) returns jsonb
language sql set search_path='' as $$
 select case when kroner_private.is_holiday_closed(sid,day) then '[]'::jsonb
 else kroner_private.available_without_holidays(sid,svc,day,period) end;
$$;
revoke all on function kroner_private.available(uuid,uuid[],date,text) from public,anon,authenticated;
create function kroner_private.check_holiday_booking() returns trigger language plpgsql set search_path='' as $$
declare local_day date;
begin
 if new.status<>'booked' then return new; end if;
 if tg_op='UPDATE' and old.starts=new.starts and old.shop=new.shop then return new;end if;
 select (new.starts at time zone coalesce(cfg->>'timezone','America/Sao_Paulo'))::date into local_day from kroner_private.shops where id=new.shop;
 if kroner_private.is_holiday_closed(new.shop,local_day) then raise exception 'Agenda fechada neste feriado.';end if;
 return new;
end;
$$;
revoke all on function kroner_private.check_holiday_booking() from public,anon,authenticated;
create trigger check_holiday_booking before insert or update of starts,shop on kroner_private.appointments for each row execute function kroner_private.check_holiday_booking();
