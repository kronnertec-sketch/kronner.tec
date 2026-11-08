create or replace function public.kroner_pos(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=kroner_private.current_user_id();me kroner_private.professionals;person kroner_private.professionals;s kroner_private.shops;prod kroner_private.products;apt kroner_private.appointments; sale kroner_private.sales;
 line jsonb;lines jsonb:='[]'; totals jsonb; op uuid:=(payload->>'request_id')::uuid;ch uuid;goods int:=0;svc int:=0;discount int:=coalesce((payload->>'discount')::int,0);qty int;amount int;refundable int;expected int;received int:=0; day date; counted int;opening int;
begin
 select * into me from kroner_private.professionals where user_id=uid and status='active';
 if me.role is null or me.role not in ('owner','partner') then raise exception 'Acesso restrito à gestão.';end if;
 select * into s from kroner_private.shops where id=me.shop for update;
 day:=(now() at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date;
 if action='list' then return jsonb_build_object('sales',coalesce((select jsonb_agg(to_jsonb(sa) order by sa.created_at desc) from kroner_private.sales sa where shop=s.id),'[]'),'rates',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'rate',commission_bps)) from kroner_private.professionals where shop=s.id and status='active'),'closings',coalesce((select jsonb_agg(to_jsonb(rc) order by rc.day desc) from kroner_private.register_closings rc where shop=s.id),'[]'));end if;
 if action='rate' then
 if me.role<>'owner' then raise exception 'Somente o titular altera comissões.';end if;
 update kroner_private.professionals set commission_bps=(payload->>'rate')::int where id=(payload->>'id')::uuid and shop=s.id;return '{"ok":true}';end if;
 if op is null then raise exception 'Identificador obrigatório.';end if;
 if exists(select 1 from kroner_private.requests r where r.id=op and r.actor=uid and r.action='pos_'||kroner_pos.action) then return '{"ok":true}';end if;
 insert into kroner_private.requests values(op,uid,'pos_'||kroner_pos.action,'{"ok":true}',now());
 if action='close' then
 day:=(payload->>'day')::date;opening:=(payload->>'opening')::int;counted:=(payload->>'counted')::int;
 if day>(now() at time zone coalesce(s.cfg->>'timezone','America/Sao_Paulo'))::date or least(opening,counted)<0 then raise exception 'Conferência inválida.';end if;
 select coalesce(jsonb_object_agg(method,net),'{}') into totals from (select p.method,sum(case when c.direction='in' then p.amount else -p.amount end) net from kroner_private.payments p join kroner_private.charges c on p.charge=c.id where p.shop=s.id and p.paid_on=day group by p.method) x;
 expected:=opening+coalesce((totals->>'cash')::int,0);
 insert into kroner_private.register_closings values(s.id,day,uid,opening,counted,expected,totals,now());return '{"ok":true}';end if;
 if action='sale' then
 select * into person from kroner_private.professionals where shop=s.id and id=coalesce((payload->>'professional')::uuid,me.id) and status='active';
 if person.id is null then raise exception 'Profissional inválido.';end if;
 if nullif(payload->>'appointment','') is not null then
 select * into apt from kroner_private.appointments where shop=s.id and id=(payload->>'appointment')::uuid and status='booked' and membership is null for update;
 if apt.id is null then raise exception 'Atendimento indisponível.';end if;
 select * into person from kroner_private.professionals where id=apt.professional;svc:=apt.price;
 end if;
 for line in select value from jsonb_array_elements(payload->'items') loop
 qty:=(line->>'quantity')::int;select * into prod from kroner_private.products where id=(line->>'id')::uuid and shop=s.id for update;
 if prod.id is null or qty is null or qty<1 or qty>prod.quantity then raise exception 'Produto indisponível ou quantidade acima do estoque.';end if;
 goods:=goods+qty*prod.price;
 update kroner_private.products set quantity=quantity-qty,updated_at=now() where id=prod.id;
 lines:=lines||jsonb_build_object('id',prod.id,'name',prod.name,'quantity',qty,'unit_price',prod.price,'unit_cost',prod.cost);
 end loop;
 if svc+goods<=0 or discount<0 or discount>svc+goods then raise exception 'Confira o total e o desconto.';end if;
 insert into kroner_private.charges(shop,client,appointment,description,amount,due,category) values(s.id,apt.client,apt.id,'Venda no PDV',svc+goods-discount,day,case when apt.id is null then 'sale' else 'service' end) returning id into ch;
 for line in select value from jsonb_array_elements(lines) loop
 insert into kroner_private.movements(shop,product,quantity,kind,unit_cost,charge,note) values(s.id,(line->>'id')::uuid,(line->>'quantity')::int,'sale',(line->>'unit_cost')::int,ch,'PDV');
 end loop;
 for line in select value from jsonb_array_elements(payload->'payments') loop
 amount:=(line->>'amount')::int;if amount<=0 then raise exception 'Pagamento inválido.';end if;
 perform kroner_private.api('pay',jsonb_build_object('charge',ch,'amount',amount,'method',line->>'method','paid_on',day,'settles_on',day,'request_id',gen_random_uuid()));end loop;
 update kroner_private.appointments set status='done' where id=apt.id;
 insert into kroner_private.sales(id,shop,actor,professional,appointment,charge,items,service_total,product_total,discount,commission,rate) values(op,s.id,uid,person.id,apt.id,ch,lines,svc,goods,discount,round(svc::numeric*(svc+goods-discount)/(svc+goods)*person.commission_bps/10000),person.commission_bps);
 elsif action='refund' then
 select * into sale from kroner_private.sales where shop=s.id and id=(payload->>'sale')::uuid for update;
 select coalesce(sum(p.amount),0) into received from kroner_private.payments p where p.charge=sale.charge;
 amount:=(payload->>'amount')::int;refundable:=received-sale.refunded;
 if sale.id is null or amount is null or amount<=0 or amount>refundable or coalesce(length(trim(payload->>'reason')),0)<3 then raise exception 'Revise o motivo e o saldo disponível para estorno.';end if;
 insert into kroner_private.charges(shop,description,direction,amount,due,category) values(s.id,'Estorno PDV '||sale.id||' · '||left(payload->>'reason',150),'out',amount,day,'refund') returning id into ch;
 perform kroner_private.api('pay',jsonb_build_object('charge',ch,'amount',amount,'method',payload->>'method','paid_on',day,'settles_on',day,'request_id',gen_random_uuid()));
 update kroner_private.sales set refunded=refunded+amount where id=sale.id;
 if coalesce((payload->>'return_goods')::boolean,false) then
 if amount+sale.refunded<>sale.product_total+sale.service_total-sale.discount then raise exception 'Devolução integral exige estorno de todo o valor da venda.';end if;
 for line in select value from jsonb_array_elements(sale.items) loop
 update kroner_private.products set quantity=quantity+(line->>'quantity')::int where id=(line->>'id')::uuid;
 insert into kroner_private.movements(shop,product,quantity,kind,unit_cost,charge,note) values(s.id,(line->>'id')::uuid,(line->>'quantity')::int,'return',(line->>'unit_cost')::int,ch,payload->>'reason');end loop;end if;
 else raise exception 'Operação inválida.';end if;
 insert into kroner_private.audit(shop,actor,action,record_id) values(s.id,uid,'pos_'||kroner_pos.action,op);return '{"ok":true}';
end;$$;
revoke all on function public.kroner_pos(text,jsonb) from public,anon;
grant execute on function public.kroner_pos(text,jsonb) to authenticated;
