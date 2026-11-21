export const CURRENCIES=['MYR','SGD','USD','CNY','EUR','GBP','JPY','KRW','THB','IDR','HKD','TWD','AUD'] as const;
export const INCOME_CATEGORIES=['工资','奖金','兼职','卖东西','其他'];
export const CATEGORIES=['餐饮','购物','交通','居住','账单','娱乐','健康','工资','其他'];
export const digits=(currency:string)=>currency==='JPY'||currency==='KRW'?0:2;
export function minor(value:string,currency:string){
 const decimals=digits(currency); const regex=decimals? /^\d{1,10}(\.\d{1,2})?$/:/^\d{1,10}$/;
 if(!regex.test(value))throw new Error(decimals?'请输入有效金额，最多两位小数':'该币种请使用整数金额');
 const [a,b='']=value.split('.');const amount=Number(a)*10**decimals+Number(b.padEnd(decimals,'0'));
 if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000000)throw new Error('金额必须大于零且在支持范围内');return amount;
}
export const today=(at=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export function validDate(s:string){if(!Number.isFinite(new Date(s+'T00:00:00Z').getTime()))return false;return /^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='2000-01-01'&&s<='2100-12-31'&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function dates(start:string,frequency:string,until:string,monthDays=''){
 const [y,m,d]=start.split('-').map(Number);const result:string[]=[];
 if(frequency==='semimonthly'){
  const days=monthDays.split(',').map(Number).sort((a,b)=>a-b);
  if(days.length!==2||days.some(day=>!Number.isInteger(day)||day<1||day>31)||days[0]===days[1])throw new Error('每月两次需要两个不同的日期');
  for(let n=0;n<1300;n++){
   const month=m-1+n;if(new Date(Date.UTC(y,month,1)).toISOString().slice(0,10)>until)break;
   const last=new Date(Date.UTC(y,month+1,0)).getUTCDate();
   for(const day of new Set(days.map(day=>Math.min(day,last)))){
    const value=new Date(Date.UTC(y,month,day)).toISOString().slice(0,10);
    if(value>=start&&value<=until)result.push(value);
   }
  }
  return result;
 }
 if(!['weekly','fortnightly','monthly','yearly'].includes(frequency))throw new Error('无效重复周期');
 for(let n=0;n<40000;n++){
 let date:Date;
 if(frequency==='weekly'||frequency==='fortnightly'){date=new Date(Date.UTC(y,m-1,d+n*(frequency==='weekly'?7:14)));}
 else {const step=frequency==='yearly'?12:1; const month=m-1+n*step;const last=new Date(Date.UTC(y,month+1,0)).getUTCDate();date=new Date(Date.UTC(y,month,Math.min(d,last)));}
 const s=date.toISOString().slice(0,10);if(s>until)break;result.push(s);
 }return result;
}
export const money=(amount:number,currency:string)=>currency==='MYR'?(amount<0?'−':'')+'RM '+new Intl.NumberFormat('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.abs(amount)/100):new Intl.NumberFormat('zh-CN',{style:'currency',currency,minimumFractionDigits:digits(currency),maximumFractionDigits:digits(currency)}).format(amount/10**digits(currency));
