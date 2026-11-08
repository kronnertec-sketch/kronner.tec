import assert from 'node:assert/strict';
import test from 'node:test';
import {pendingHolidays} from '../lib/holidays';
test('holiday reminders cross year boundaries and catch late access',()=>{
 const find=(date:string)=>pendingHolidays(date).find(x=>x.name==='Natal');
 assert.equal(find('2026-11-24'),undefined);
 assert.equal(find('2026-11-25')?.stage,30);
 assert.equal(find('2026-12-12')?.stage,14);
 assert.equal(find('2026-12-22')?.stage,7);
 assert.ok(pendingHolidays('2026-12-10').some(x=>x.date==='2027-01-01'));
 assert.ok(!pendingHolidays('2026-12-22',{'2026-12-25':'open'}).some(x=>x.name==='Natal'));
});
