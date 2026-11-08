begin;
create temp table scenarios(name text);
do $$
declare claims jsonb:='{"role":"authenticated","email_verified":true,"iss":"https://funky-phoenix-3915.clerk.accounts.dev","azp":"https://kroner-barbearias.vercel.app"}';owner_claims jsonb;staff_claims jsonb;profile jsonb;inv jsonb;staff uuid;sid uuid;i int;employee_label text;svc uuid;dt date:=current_date+2;cfg jsonb;args jsonb;
begin
 owner_claims:=claims||jsonb_build_object('sub','user_qa_'||gen_random_uuid(),'email','owner@example.invalid');
 perform set_config('request.jwt.claims',owner_claims::text,true);
 perform public.kroner_api('create_shop','{}');
 sid:=(public.kroner_team('identity')->>'shop')::uuid;
 cfg:=jsonb_build_object('phone','+5534999991234','professional','QA','city','Centralina','state','MG','timezone','America/Sao_Paulo','maxDays',21,'notice',10,'grid',10,'grace',15,'cancelMinutes',0,'creditFee',300,'debitFee',150,'week',(select jsonb_agg(jsonb_build_object('enabled',true,'open','08:00','close','22:00','lunchStart','12:00','lunchEnd','13:00')) from generate_series(0,6)));
 perform public.kroner_api('service','{"name":"QA","price":5000,"duration":30}');
 select id into svc from kroner_private.services where shop=sid;
 perform public.kroner_api('settings',jsonb_build_object('name','QA Shop','cfg',cfg,'activate',true));
 for i in 1..4 loop
 employee_label:='qa'||i||'@example.invalid';
 inv:=public.kroner_team('invite',jsonb_build_object('role',case when i=4 then 'partner' else 'employee' end,'email',employee_label,'name','Profissional QA'));
 staff_claims:=claims||jsonb_build_object('sub','user_qa_'||gen_random_uuid(),'email',employee_label);
 perform set_config('request.jwt.claims',staff_claims::text,true);
 perform public.kroner_team('accept',inv);
 staff:=(public.kroner_team('identity')->>'id')::uuid;
 perform public.kroner_team('preferences',jsonb_build_object('week',cfg->'week','notice',5*i,'buffer',5*i,'durations',jsonb_build_object(svc::text,35),'disabledServices','[]'::jsonb));
 assert (public.kroner_team('profile')->'preferences'->>'notice')::int=5*i;
 if i<4 then
 begin perform public.kroner_team('individual_finance');raise exception 'FAIL finance';exception when others then if sqlerrm='FAIL finance' then raise;end if;end;
 begin perform public.kroner_api('workspace');raise exception 'FAIL workspace';exception when others then if sqlerrm='FAIL workspace' then raise;end if;end;
 else assert (public.kroner_api('workspace')->'shop'->>'id')::uuid=sid;end if;
 perform set_config('request.jwt.claims',owner_claims::text,true);
 end loop;
 assert jsonb_array_length(public.kroner_team('list'))=5;
 insert into scenarios values('Convites, papéis e configurações individuais em cinco cadeiras');
 perform public.kroner_team('calendar_event',jsonb_build_object('date',dt,'name','Feriado para teste','scope','Municipal','source','https://example.invalid/qa'));
 args:=jsonb_build_object('professional',staff,'services',jsonb_build_array(svc),'day',dt,'period','morning');
 assert jsonb_array_length(public.kroner_team('slots',args))=0;
 perform set_config('request.jwt.claims',staff_claims::text,true);perform public.kroner_team('holiday',jsonb_build_object('date',dt,'decision','open'));
 assert jsonb_array_length(public.kroner_team('slots',args))>0;
 perform set_config('request.jwt.claims',owner_claims::text,true);
 assert jsonb_array_length(public.kroner_team('slots',args||jsonb_build_object('professional',public.kroner_team('identity')->>'id')))=0;
 perform public.kroner_team('deactivate',jsonb_build_object('id',staff));
 perform set_config('request.jwt.claims',staff_claims::text,true);
 assert public.kroner_team('identity')->>'role' is null;
 insert into scenarios values('Bloqueio municipal, decisão individual e revogação');
end $$;
select * from scenarios;
rollback;
