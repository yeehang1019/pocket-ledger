/** Pure presentation rules. No transaction, payment or account state. */
export const shouldDismissSheet=(distance:number,busy:boolean)=>!busy&&Number.isFinite(distance)&&distance>110;
export const dueVisualGroup=(item:{amountPending?:boolean;due:string},today:string)=>item.amountPending?'fill':item.due<today?'overdue':'soon';
