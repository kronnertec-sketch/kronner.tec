create or replace function kroner_private.current_user_id() returns uuid
language plpgsql security definer set search_path='' as $$
declare claims jsonb:=auth.jwt(); subject text:=claims->>'sub'; email text; result uuid; linked text;
begin
 if subject is null or subject='' then return null; end if;
 if claims->>'iss'='https://funky-phoenix-3915.clerk.accounts.dev' then
  if claims->>'role' is distinct from 'authenticated'
   or subject not like 'user_%'
   or claims->>'email_verified' is distinct from 'true'
   or coalesce(claims->>'azp','') not in ('https://kroner-barbearias.vercel.app','https://kroner-piloto.vercel.app','https://kroner-piloto-jorgenetotz1-7118.vercel.app','http://localhost:3000') then
   raise exception 'Sessão inválida. Confirme seu e-mail e entre novamente.';
  end if;
  email:=lower(trim(claims->>'email'));
  if email is null or email='' then raise exception 'E-mail confirmado ausente na sessão.';end if;
  -- Serialize first sign-ins; binding is permanent and never follows later email changes.
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
 -- Keep already authenticated legacy sessions working during the rollout.
 if claims->>'iss'='https://azbccqwjnzrzrhvnlncy.supabase.co/auth/v1'
  and claims->>'role'='authenticated' then
  select id into result from auth.users where id=subject::uuid;
  if result is not null then
   insert into kroner_private.app_users(id) values(result) on conflict(id) do nothing;
  end if;
  return result;
 end if;
 raise exception 'Provedor de acesso não autorizado.';
end;
$$;
