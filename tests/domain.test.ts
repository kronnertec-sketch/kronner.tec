import {test} from 'node:test';import assert from 'node:assert/strict';import {phone,cents,fee,debtStatus,safeReturn} from '../lib/domain';
test('phone formats normalize to a single contact',()=>{assert.equal(phone('(34) 99999-1234'),phone('+55 34 99999-1234'));assert.throws(()=>phone('99999-1234'))});
test('money preserves cents and rejects invalid values',()=>{assert.equal(cents('39,99'),3999);assert.equal(fee(4000,300),120);assert.throws(()=>cents('-1'))});
test('grace period and partial payments',()=>{assert.equal(debtStatus(4000,1000,'2026-10-01',15,'2026-10-16'),'Pendente');assert.equal(debtStatus(4000,1000,'2026-10-01',15,'2026-10-17'),'Atrasado');assert.equal(debtStatus(4000,4000,'2026-10-01',15,'2026-10-17'),'Pago')});
test('auth return path stays inside app',()=>{assert.equal(safeReturn('/b/shop-a'),'/b/shop-a');assert.equal(safeReturn('https://evil.example'),'/painel');assert.equal(safeReturn('//evil.example'),'/painel')});

import {settingsDraft,settingsValues} from '../lib/domain';
import {defaults} from '../lib/types';
test('settings accept Brazilian decimals without changing their scale',()=>{const draft=settingsDraft({...defaults,creditFee:150});assert.equal(draft.creditFee,'1,5');assert.equal(settingsValues({...draft,creditFee:'0,1'}).creditFee,10);assert.equal(settingsValues({...draft,creditFee:'1,5'}).creditFee,150);assert.equal(settingsValues({...draft,debitFee:'1.25'}).debitFee,125);assert.equal(settingsValues({...draft,notice:'0'}).notice,0)});
test('empty and incomplete settings cannot silently become zero',()=>{const draft=settingsDraft(defaults);for(const patch of [{creditFee:''},{creditFee:'1,'},{creditFee:'101'},{notice:''},{grid:'1.5'}])assert.throws(()=>settingsValues({...draft,...patch}));});
