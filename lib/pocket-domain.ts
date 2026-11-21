import type {Commitment} from './commitments';
export type PocketBill={id:string;title:string;mode:string;category:string;amount:number;currency:string;consumption_date:string;due_date:string;paid_date:string;status:string;account_id:string;parent_id:string};
export type PocketData={truncated?:boolean;commitments?:Commitment[];bills:PocketBill[];accounts:{id:string;title:string;currency:string;statement_day:number;due_day:number}[];templates:{id:string;title:string;currency:string;category:string;amount:number}[];goals:{id:string;title:string;currency:string;target:number;saved:number}[];categories:{name:string}[];range_budgets:{id:string;title:string;start:string;end:string;currency:string;category:string;amount:number}[]};
export const emptyPocket:PocketData={bills:[],accounts:[],templates:[],goals:[],categories:[],range_budgets:[]};
export const recognised=(b:PocketBill,now:string)=>b.status==='active'&&['postpaid','prepaid','use'].includes(b.mode)&&b.consumption_date<=now;
export const prepaidBalance=(b:PocketBill,bills:PocketBill[])=>b.amount-bills.filter(x=>x.parent_id===b.id&&x.status==='active').reduce((sum,x)=>sum+x.amount,0);
