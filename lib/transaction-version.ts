/** Content version: works with existing rows without a destructive schema migration. */
export type TransactionContent={title:string;amount:number;currency:string;kind:string;category:string;date:string;note?:string;deleted?:number};
export function transactionVersion(t:TransactionContent){return JSON.stringify([t.title,t.amount,t.currency,t.kind,t.category,t.date,t.note||'',t.deleted||0]);}
