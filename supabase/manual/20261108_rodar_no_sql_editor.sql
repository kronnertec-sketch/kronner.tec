-- Kroner V6 · rodar UMA vez no Supabase (projeto kroner.app) → SQL Editor → Run.
-- O banco ainda está vazio, então nenhuma informação é perdida.
-- Essas alterações não puderam ser aplicadas automaticamente porque removem
-- restrições antigas (o painel exige confirmação manual para isso).

-- 1) Donos e clientes passam a ser identificados pela conta Clerk (app_users).
alter table kroner_private.shops drop constraint if exists shops_owner_fkey;
alter table kroner_private.shops add constraint shops_owner_fkey
  foreign key(owner) references kroner_private.app_users(id);
alter table kroner_private.clients drop constraint if exists clients_user_id_fkey;
alter table kroner_private.clients add constraint clients_user_id_fkey
  foreign key(user_id) references kroner_private.app_users(id);

-- 2) Várias cadeiras: dois barbeiros podem atender no mesmo horário.
--    (a regra antiga bloqueava qualquer sobreposição na barbearia inteira;
--     agora o conflito é verificado por profissional em chair_slots).
alter table kroner_private.appointments drop constraint if exists appointments_shop_tstzrange_excl;

-- 3) Feriados agora são decididos por profissional (chair_slots), não pela barbearia.
drop trigger if exists check_holiday_booking on kroner_private.appointments;

-- 4) Identidade: não grava mais nada em auth.users (usuários vêm do Clerk).
create or replace function kroner_private.current_user_id() returns uuid
language plpgsql security definer set search_path='' as $$
declare claims jsonb:=auth.jwt(); subject text:=claims->>'sub'; email text; result uuid; linked text;
begin
 if subject is null or subject='' then return null; end if;
 if claims->>'iss' in ('https://splendid-shad-4330.clerk.accounts.dev','https://funky-phoenix-3915.clerk.accounts.dev') then
  if claims->>'role' is distinct from 'authenticated'
   or subject not like 'user_%'
   or claims->>'email_verified' is distinct from 'true'
   or not (
     coalesce(claims->>'azp','') = ''
     or coalesce(claims->>'azp','') in ('https://kroner-nine.vercel.app','https://kroner-eight.vercel.app','http://localhost:3000')
     or claims->>'azp' like 'https://%.vercel.app'
   ) then
   raise exception 'Sessão inválida. Confirme seu e-mail e entre novamente.';
  end if;
  email:=lower(trim(claims->>'email'));
  if email is null or email='' then raise exception 'E-mail confirmado ausente na sessão.';end if;
  perform pg_advisory_xact_lock(hashtextextended('kroner:clerk:'||subject,0));
  select id into result from kroner_private.app_users where clerk_subject=subject;
  if result is not null then return result;end if;
  select id,clerk_subject into result,linked from kroner_private.app_users where legacy_email=email for update;
  if result is not null then
   if linked is not null then raise exception 'Esta conta antiga já foi vinculada a outro acesso. Entre com o acesso original.';end if;
   update kroner_private.app_users set clerk_subject=subject where id=result;
  else
   insert into kroner_private.app_users(clerk_subject) values(subject) returning id into result;
  end if;
  return result;
 end if;
 raise exception 'Provedor de acesso não autorizado.';
end;
$$;
revoke all on function kroner_private.current_user_id() from public,anon,authenticated;
