type ViewRecord={date:string;kind:string;amount:number};
export function groupLedgerPage<T extends ViewRecord>(records:T[],limit:number){
 const days=new Map<string,{day:string;rows:T[];count:number;spent:number;income:number}>();
 records.forEach((record,index)=>{
  let day=days.get(record.date);
  if(!day){day={day:record.date,rows:[],count:0,spent:0,income:0};days.set(record.date,day)}
  day.count++;
  if(record.kind==='income')day.income+=record.amount;
  else day.spent+=record.kind==='refund'?-record.amount:record.amount;
  if(index<limit)day.rows.push(record);
 });
 return [...days.values()].filter(day=>day.rows.length);
}
