import {INCOME_CATEGORIES} from './ledger-domain';
export const sourceNames={manual:'自己记的',fixed:'周期支出',tripshare:'Trip 份额'} as const;
import type {TripEntryRow} from './ledger-records';
type SourceRecord={source?:string;rule_id?:string;pocket?:boolean};
type SpendingRecord=SourceRecord&{kind:string;amount:number;category:string};
export function sourceOf(t:SourceRecord):keyof typeof sourceNames{return t.source?'tripshare':t.rule_id||t.pocket?'fixed':'manual';}
export function spendingSummary(rows:SpendingRecord[],limit=5){
 const sources={manual:0,fixed:0,tripshare:0},categories=new Map<string,number>();let total=0;
 for(const t of rows){if(t.kind==='income')continue;const amount=t.kind==='refund'?-t.amount:t.amount;total+=amount;sources[sourceOf(t)]+=amount;categories.set(t.category||'其他',(categories.get(t.category||'其他')||0)+amount);}
 const all=[...categories].map(([category,value])=>({category,value})).sort((a,b)=>b.value-a.value);
 if(all.length<=limit)return {total,sources,categories:all};
 const head=all.filter(x=>x.category!=='其他').slice(0,limit-1),names=new Set(head.map(x=>x.category));
 return {total,sources,categories:[...head,{category:'其他',value:all.filter(x=>!names.has(x.category)).reduce((n,x)=>n+x.value,0)}]};
}
export function categoryForKind(category:string,kind:string){return kind==='income'?INCOME_CATEGORIES.includes(category):category==='其他'||!INCOME_CATEGORIES.includes(category);}
export function tripConsumption(entries:TripEntryRow[]){return entries.filter(e=>e.record_type==='expense'&&!e.deleted).map(e=>({id:`trip:${e.group_id}:${e.record_id}:${e.member_id}`,source:e.group_id,groupType:e.group_type,title:e.title,amount:e.consumed,paid:e.paid,currency:e.currency,kind:'expense',category:({Food:'餐饮',Grocery:'餐饮',Transport:'交通',Accommodation:'居住',Shopping:'购物',Activity:'娱乐'} as Record<string,string>)[e.category]||'其他',date:e.date,note:'来自 Trip Share · 原始分类：'+e.category}));}
