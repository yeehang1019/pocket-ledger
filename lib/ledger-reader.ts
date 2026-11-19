import type {PocketData} from './pocket-domain';
import type {TransactionRow,RuleRow,OccurrenceRow,TripEntryRow} from './ledger-records';
export type LedgerSnapshot={
 transactions:(TransactionRow&{edit_version:string})[];rules:RuleRow[];occurrences:OccurrenceRow[];pending:OccurrenceRow[];
 budgets:{month:string;currency:string;category:string;amount:number}[];trip_entries:TripEntryRow[];
 trip_sync:{status:string;last_completed:string}|null;group_labels:{group_id:string;label:string}[];truncated:boolean;error?:string;
};
export class LedgerUnauthorized extends Error {}
const syncWarning='周期账单同步暂时失败；已显示保存的账单，新到期的周期费用可能尚未补齐。';
/** Recurring writes are optional preparation, never a prerequisite for reading saved records. */
export async function readLedgerSnapshot(sync:boolean,fetcher:typeof fetch=fetch){
 let warning='';
 if(sync){
  try{
   const result=await fetcher('/api/ledger',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sync'}),signal:AbortSignal.timeout(5000)});
   if(result.status===401)throw new LedgerUnauthorized();
   if(!result.ok)warning=syncWarning;
  }catch(error){if(error instanceof LedgerUnauthorized)throw error;warning=syncWarning;}
 }
 const response=await fetcher('/api/ledger',{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status===401)throw new LedgerUnauthorized();
 const ledger=await response.json() as LedgerSnapshot;
 if(!response.ok)throw new Error(ledger?.error||'暂时无法读取账本，请重试');
 let extra:Response;
 try{extra=await fetcher('/api/pocket',{cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw new Error('付款状态读取失败，不能判断哪些账单未付，请重试');}
 if(extra.status===401)throw new LedgerUnauthorized();
 if(!extra.ok)throw new Error('付款状态读取失败，不能判断哪些账单未付，请重试');
 const pocket=await extra.json() as PocketData;
 if(!Array.isArray(pocket.commitments)||!Array.isArray(pocket.bills))throw new Error('付款状态资料不完整，请重试');
 return {ledger,pocket,warning};
}
