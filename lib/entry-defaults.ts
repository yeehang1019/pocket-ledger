import {today} from './ledger-domain';
/** Preserve an already-booked recurring due date, but never permit new future transactions. */
export function entryDateMax(form:{date:string;rule_id?:string},now=today()){return form.rule_id&&form.date>now?form.date:now;}
/** Server records, not device-local history; exclude generated recurring records. */
type CategoryRecord={id:string;date:string;kind:string;category:string;deleted?:number;rule_id?:string;created_at?:string};
export function lastExpenseCategory(records:CategoryRecord[],categories:string[]){
 const recent=records.filter(t=>!t.deleted&&!t.rule_id&&t.kind==='expense'&&categories.includes(t.category)&&t.category!=='工资').sort((a,b)=>b.date.localeCompare(a.date)||(b.created_at||'').localeCompare(a.created_at||'')||b.id.localeCompare(a.id))[0];
 return recent?.category||'其他';
}
