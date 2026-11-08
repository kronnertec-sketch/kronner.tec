create table kroner_private.professionals (
 id uuid primary key default gen_random_uuid(), shop uuid not null references kroner_private.shops,
 user_id uuid references kroner_private.app_users, name text not null,
 role text not null check(role in ('owner','partner','employee')),
 status text not null check(status in ('active','invited','inactive')),
 finance boolean not null default false, email text, invite_hash text, expires timestamptz,
 preferences jsonb not null default '{}', unique(id,shop)
);
create unique index one_active_team on kroner_private.professionals(user_id) where status='active';
create unique index one_invite on kroner_private.professionals(shop,email) where status='invited';
alter table kroner_private.professionals enable row level security;
revoke all on kroner_private.professionals from public,authenticated,anon;
insert into kroner_private.professionals(shop,user_id,name,role,status)
 select id,owner,coalesce(nullif(cfg->>'professional',''),name),'owner','active' from kroner_private.shops;
create function kroner_private.shop_owner_chair() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into kroner_private.professionals(shop,user_id,name,role,status) values(new.id,new.owner,coalesce(nullif(new.cfg->>'professional',''),new.name),'owner','active');
 return new;
end;$$;
revoke all on function kroner_private.shop_owner_chair() from public,authenticated,anon;
create trigger shop_owner_chair after insert on kroner_private.shops for each row execute function kroner_private.shop_owner_chair();
alter table kroner_private.appointments add column professional uuid,add column created_by uuid references kroner_private.app_users;
update kroner_private.appointments a set professional=p.id from kroner_private.professionals p where p.shop=a.shop and p.role='owner';
alter table kroner_private.appointments alter column professional set not null, add foreign key(professional,shop) references kroner_private.professionals(id,shop);
create function kroner_private.default_appointment_professional() returns trigger language plpgsql set search_path='' as $$
begin
 if new.professional is null then select id into new.professional from kroner_private.professionals where shop=new.shop and role='owner'; end if;
 new.created_by:=kroner_private.current_user_id();return new;
end;$$;
create trigger default_appointment_professional before insert on kroner_private.appointments for each row execute function kroner_private.default_appointment_professional();
revoke all on function kroner_private.default_appointment_professional() from public,anon,authenticated;
create function public.kroner_team(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=kroner_private.current_user_id(); me kroner_private.professionals; target kroner_private.professionals; token text; mail text:=lower(auth.jwt()->>'email'); selected_role text:=payload->>'role';
begin
 if uid is null then raise exception 'Entre na sua conta.';end if;
 select * into me from kroner_private.professionals where user_id=uid and status='active' for update;
 if action='accept' then
  select * into target from kroner_private.professionals where invite_hash=encode(extensions.digest(payload->>'token','sha256'),'hex') and status='invited' and expires>now() for update;
  if target.id is null or target.email is distinct from mail or auth.jwt()->>'email_verified' is distinct from 'true' then raise exception 'Convite expirado ou e-mail diferente do convidado.';end if;
  if me.id is not null then raise exception 'Esta conta já pertence a uma equipe.';end if;
  update kroner_private.professionals set user_id=uid,status='active',invite_hash=null where id=target.id;
  insert into kroner_private.audit(shop,actor,action,record_id) values(target.shop,uid,'team_accept',target.id);return '{"ok":true}';
 end if;
 if action='identity' then return jsonb_build_object('role',me.role,'shop',me.shop,'id',me.id,'revoked',exists(select 1 from kroner_private.professionals where user_id=uid and status='inactive'));end if;
 if me.id is null then raise exception 'Sem vínculo ativo com a equipe.';end if;
 if action='list' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'status',status,'finance',finance) order by name) from kroner_private.professionals where shop=me.shop and (me.role='owner' or status='active')),'[]');end if;
 if action='agenda' then return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'professional',a.professional,'name',c.name,'starts',a.starts,'ends',a.ends,'status',a.status,'services',(select string_agg(v->>'name',', ') from jsonb_array_elements(a.services)v)) order by a.starts) from kroner_private.appointments a join kroner_private.clients c on a.client=c.id join kroner_private.shops s on s.id=a.shop where a.shop=me.shop and (a.starts at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date=(payload->>'day')::date),'[]');end if;
 if me.role<>'owner' then raise exception 'Somente a conta principal gerencia a equipe.';end if;
 if action='invite' then
  if selected_role is null or selected_role not in ('partner','employee') or coalesce(length(trim(payload->>'name')),0) not between 2 and 100 or coalesce(payload->>'email','') !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Confira nome, e-mail e papel.';end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into kroner_private.professionals(shop,name,role,status,email,invite_hash,expires)
   values(me.shop,trim(payload->>'name'),selected_role,'invited',lower(trim(payload->>'email')),encode(extensions.digest(token,'sha256'),'hex'),now()+interval '7 days')
   on conflict(shop,email) where status='invited' do update set name=excluded.name,role=excluded.role,invite_hash=excluded.invite_hash,expires=excluded.expires returning * into target;
 elsif action in ('permissions','deactivate') then
  select * into target from kroner_private.professionals where id=(payload->>'id')::uuid and shop=me.shop and role<>'owner' and status<>'inactive' for update;
  if target.id is null then raise exception 'Profissional indisponível.';end if;
  if action='permissions' then
   if selected_role is null or selected_role not in ('partner','employee') then raise exception 'Papel inválido.';end if;
   update kroner_private.professionals set role=selected_role,finance=coalesce((payload->>'finance')::boolean,false) where id=target.id;
  else
   if exists(select 1 from kroner_private.appointments where professional=target.id and ends>now() and status='booked') then raise exception 'Transfira ou cancele os atendimentos futuros.';end if;
   update kroner_private.professionals set status='inactive',invite_hash=null where id=target.id;
  end if;
 else raise exception 'Operação desconhecida.';end if;
 insert into kroner_private.audit(shop,actor,action,record_id) values(me.shop,uid,'team_'||action,target.id);
 return jsonb_build_object('ok',true,'token',token);
end;$$;
revoke all on function public.kroner_team(text,jsonb) from public,anon;
grant execute on function public.kroner_team(text,jsonb) to authenticated;
