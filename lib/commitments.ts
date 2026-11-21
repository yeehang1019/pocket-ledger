import {validDate} from './ledger-domain';
import type {OccurrenceRow,RuleRow,TripEntryRow} from './ledger-records';
import type {PocketBill} from './pocket-domain';
type ScheduledRule=Pick<RuleRow,'id'|'title'|'kind'|'currency'|'category'|'status'|'mode'|'amount'|'start'|'frequency'|'month_days'>;
type Term=Omit<OccurrenceRow,'owner'>;
export const paymentMethods:Record<string,string>={ordinary:'普通付款',spaylater:'SPayLater',grabpaylater:'Grab PayLater',other:'其他 PayLater'};
export type Instalment={id:string;due:string;amount:number;paid_date:string};
export type PlanData={provider:string;total:number;date:string;months:number;first_due:string;rows:Instalment[];covers?:{plan:string;row:string;amount:number}[]};
export type DepositData={amount:number;date:string;movements:{id:string;kind:'refund'|'deduct'|'rent';voided?:boolean;amount:number;date:string;note:string}[]};
export type Commitment={id:string;kind:'paylater'|'deposit'|'confirmation';title:string;currency:string;source_key:string;source_signature:string;data:string;revision:number;status:string;review?:boolean};
export function monthlyDate(first:string,offset:number){const [y,m,d]=first.split('-').map(Number),month=m-1+offset;return new Date(Date.UTC(y,month,Math.min(d,new Date(Date.UTC(y,month+1,0)).getUTCDate()))).toISOString().slice(0,10)}
export function planRows(id:string,total:number,months:number,first:string):Instalment[]{
 if(!Number.isSafeInteger(total)||total<=0||total>1e11||!Number.isInteger(months)||months<1||months>60||!validDate(first)||!validDate(monthlyDate(first,months-1)))throw Error('请检查还款总额、期数和日期');
 if(total<months)throw Error('每期金额必须至少为一个最小货币单位');
 return Array.from({length:months},(_,i)=>({id:`${id}:${i+1}`,due:monthlyDate(first,i),amount:Math.floor(total/months)+(i<total%months?1:0),paid_date:''}));
}
export function validateRows(rows:Instalment[],total:number){
 if(!Array.isArray(rows)||rows.length<1||rows.length>60||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>typeof r.id!=='string'||r.id.length>250||!validDate(r.due)||!Number.isSafeInteger(r.amount)||r.amount<=0||r.paid_date&& !validDate(r.paid_date))||rows.reduce((n,r)=>n+r.amount,0)!==total)throw Error('各期金额必须大于零，合计须等于应还总额，日期必须有效');
}
export function invoiceRowsMatchMonth(rows:Instalment[],sourceKey:string){
 return rows.length===1&&rows[0].due.slice(0,7)===sourceKey.slice(-7);
}
export function tripPlan(entry:TripEntryRow):Commitment|null{
 if(entry.record_type!=='expense'||entry.deleted||!entry.paylater)return null;
 const p=JSON.parse(entry.paylater);if(!p||!Object.hasOwn(paymentMethods,p.provider)||p.provider==='ordinary'||!Number.isSafeInteger(p.total)||p.total<=0||!Number.isInteger(p.months)||!validDate(p.first_due))throw Error('Trip Share 分期资料无效');
 const id=`trip:${entry.group_id}:${entry.record_id}:${entry.member_id}`;
 const data:PlanData={provider:p.provider,total:p.total,date:entry.date,months:p.months,first_due:p.first_due,rows:planRows(id,p.total,p.months,p.first_due)};
 return {id,kind:'paylater',title:entry.title,currency:entry.currency,source_key:id,source_signature:entry.paylater,data:JSON.stringify(data),revision:-1,status:'active'};
}
export function allCommitments(saved:Commitment[]=[],trip:TripEntryRow[]=[]){
 const imported=trip.map(tripPlan).filter((p):p is Commitment=>!!p),byId=new Map(imported.map(p=>[p.id,p]));
 const result=[...saved.map(p=>({...p,review:p.source_key.startsWith('trip:')&&(!byId.has(p.id)||byId.get(p.id)!.source_signature!==p.source_signature||byId.get(p.id)!.currency!==p.currency||JSON.parse(byId.get(p.id)!.data).date!==JSON.parse(p.data).date)})),...imported.filter(p=>!saved.some(s=>s.id===p.id))];
 for(const p of result.filter(p=>p.source_key.startsWith('invoice:'))){
  const d=JSON.parse(p.data) as PlanData,month=p.source_key.slice(-7);
  p.review=(d.covers||[]).some(c=>{
   const covered=result.find(x=>x.id===c.plan);
   if(!covered||covered.status!=='active'||covered.review||covered.currency!==p.currency)return true;
   const plan=JSON.parse(covered.data) as PlanData,row=plan.rows.find(r=>r.id===c.row);
   return plan.provider!==d.provider||!row||row.amount!==c.amount||row.due.slice(0,7)!==month||!!row.paid_date;
  });
 }
 return result;
}
export const depositHeld=(d:DepositData)=>d.amount-d.movements.filter(m=>!m.voided).reduce((n,m)=>n+m.amount,0);
type DueSummaryRow={id:string;title:string;due:string;amount:number;currency:string;expected?:boolean;review?:boolean;amountPending?:boolean;previousAmount?:number;row?:Instalment};
export type DueItem=DueSummaryRow&(
 {type:'paylater';parent:Commitment;row:Instalment}|{type:'rule';parent:Term}|{type:'pocket';parent:PocketBill}
);
export function dueSummary(items:DueItem[]){return {total:items.filter(d=>!d.review&&!d.amountPending).reduce((n,d)=>n+d.amount,0),pending:items.filter(d=>d.amountPending).length,count:items.length};}
export function dueDescription(items:DueItem[],now:string){const {count,pending}=dueSummary(items);return `${count} 笔待付${pending?`（其中 ${pending} 笔金额待填）`:''} · ${items.filter(d=>d.due<now).length} 笔逾期`;}
export function paymentDue(plans:Commitment[],bills:PocketBill[],occurrences:Term[],rules:ScheduledRule[],now:string,end:string,schedule:(start:string,frequency:string,end:string,monthDays?:string)=>string[]):DueItem[]{
 const result:DueItem[]=[],marks=new Map(plans.filter(p=>p.kind==='confirmation').map(p=>[p.id,{...JSON.parse(p.data),ignored:p.status==='ignored'}]));
 const covered=new Set(plans.filter(p=>p.kind==='paylater'&&p.status==='active').flatMap(p=>((JSON.parse(p.data) as PlanData).covers||[]).map(c=>JSON.stringify([c.plan,c.row]))));
 for(const p of plans.filter(p=>p.kind==='paylater'&&p.status==='active'))for(const row of (JSON.parse(p.data) as PlanData).rows)if(!row.paid_date&&!covered.has(JSON.stringify([p.id,row.id]))&&row.due<=end)result.push({id:row.id,title:p.title,due:row.due,amount:row.amount,currency:p.currency,type:'paylater',parent:p,row,review:p.review});
 for(const bill of bills)if(bill.status==='active'&&['planned','postpaid'].includes(bill.mode)&&!bill.paid_date&&(bill.due_date||bill.consumption_date)<=end)result.push({id:'pocket:'+bill.id,title:bill.title,due:bill.due_date||bill.consumption_date,amount:bill.amount,currency:bill.currency,type:'pocket',parent:bill,expected:bill.mode==='planned'});
 const recorded=new Set(occurrences.map(o=>o.rule_id+':'+o.due));
 for(const o of occurrences.filter(o=>o.status==='pending'&&o.kind==='expense'&&o.due<=end&&!marks.get(`rule:${o.rule_id}:${o.due}`)?.ignored)){
  const previous=occurrences.filter(p=>p.rule_id===o.rule_id&&p.status==='recorded'&&p.due<o.due&&p.amount>0&&p.currency===o.currency).sort((a,b)=>b.due.localeCompare(a.due))[0];
  result.push({id:`rule:${o.rule_id}:${o.due}`,title:o.title,due:o.due,amount:0,currency:o.currency,type:'rule',parent:o,amountPending:true,previousAmount:previous?.amount});
 }
 for(const o of occurrences.filter(o=>['recorded','awaiting'].includes(o.status)&&o.kind==='expense')){
  const id=`rule:${o.rule_id}:${o.due}`,mark=marks.get(id);if(o.due<=end&&!mark?.ignored&&(!mark?.paid_date||mark.amount!==o.amount))result.push({id,title:o.title,due:o.due,amount:o.amount,currency:o.currency,type:'rule',parent:o});
 }
 for(const r of rules.filter(r=>r.status==='active'&&r.kind==='expense'))for(const due of schedule(r.start,r.frequency,end,r.month_days).filter(d=>d>now)){
  const id=`rule:${r.id}:${due}`,mark=marks.get(id),variable=r.mode!=='fixed';
  const previous=variable?occurrences.filter(o=>o.rule_id===r.id&&o.status==='recorded'&&o.due<due&&o.amount>0&&o.currency===r.currency).sort((a,b)=>b.due.localeCompare(a.due))[0]:undefined;
  if(!recorded.has(r.id+':'+due)&&!mark?.ignored&&(!mark?.paid_date||mark.amount!==r.amount))result.push({id,title:r.title,due,amount:variable?0:r.amount,currency:r.currency,type:'rule',parent:{...r,rule_id:r.id,due},expected:true,...(variable?{amountPending:true,previousAmount:previous?.amount}:{})});
 }
 return result.sort((a,b)=>a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
}
