create function public.kroner_billing_owner() returns uuid language sql volatile
security definer set search_path='' as $$
 select id from kroner_private.shops where owner=kroner_private.current_user_id()
$$;
revoke all on function public.kroner_billing_owner() from public,anon;
grant execute on function public.kroner_billing_owner() to authenticated;
