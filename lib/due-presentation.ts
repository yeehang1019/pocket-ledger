import {dueSummary,type DueItem} from './commitments';

/** Calendar month in the caller's ledger timezone (today() uses Kuala Lumpur). */
export function dueMonth(now:string){
 const month=now.slice(0,7),[year,number]=month.split('-').map(Number);
 return {month,start:month+'-01',end:new Date(Date.UTC(year,number,0)).toISOString().slice(0,10)};
}

/** Presentation only. Older obligations remain recoverable; next month is not a current-month debt. */
export function splitMonthlyDue(items:DueItem[],now:string){
 const {start,end}=dueMonth(now);
 return {current:items.filter(item=>item.due>=start&&item.due<=end),previous:items.filter(item=>item.due<start)};
}

/** Display-only partition of the shared payable list; unknown/review amounts are never estimates. */
export function dueStats(items:DueItem[],now:string){
 const known=items.filter(item=>!item.amountPending&&!item.review);
 const overdue=known.filter(item=>item.due<now),upcoming=known.filter(item=>item.due>=now);
 return {overdue:dueSummary(overdue),upcoming:dueSummary(upcoming),pending:dueSummary(items).pending};
}
