'use client';
import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {money,digits,today} from '@/lib/ledger-domain';
import {ArrowDownLeft} from 'lucide-react';

type IncomeOccurrence={id:string;title:string;kind:string;currency:string;status:string;due:string;amount:number};
export default function IncomeDue({occurrences,currency,save,readError}:{occurrences:IncomeOccurrence[];currency:string;save:(body:{action:'receive';id:string;amount:string;date:string})=>Promise<boolean>;readError?:boolean}){
 const [form,setForm]=useState<(Omit<IncomeOccurrence,'amount'>&{amount:string;date:string})|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const rows=occurrences.filter(o=>o.kind==='income'&&o.currency===currency&&['pending','awaiting'].includes(o.status)).sort((a,b)=>a.due.localeCompare(b.due));
 if(readError||!rows.length)return null;
 return <section className="panel income-due" aria-label="周期收入待收">
  <div className="panel-heading"><div><h2><ArrowDownLeft size={20} aria-hidden="true"/>收入待收 · {rows.length} 笔</h2><p>未到账不计收入</p></div></div>
  {rows.map(o=><article className="plan-row" key={o.id}><span><strong>{o.title}</strong><small>预计 {o.due} · {o.amount?money(o.amount,o.currency):'金额待填'}</small></span><button className="secondary" aria-label={'确认到账：'+o.title} onClick={()=>{setError('');setForm({...o,date:today(),amount:o.amount?String(o.amount/10**digits(o.currency)):''})}}>确认到账</button></article>)}
  <Dialog open={!!form} onOpenChange={open=>!open&&!busy&&setForm(null)}><DialogContent className="entry-dialog"><DialogTitle>确认收入到账</DialogTitle><DialogDescription>{form?.title} · 按实际到账日期计入收入，不抵减消费。</DialogDescription>{form&&<form className="pocket-form" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{if(await save({action:'receive',id:form.id,amount:form.amount,date:form.date}))setForm(null);else setError('未能保存，请检查提示后重试。输入已保留。')}catch{setError('保存失败，请重试。输入已保留。')}finally{setBusy(false)}}}>
   <label className="pocket-field">实际到账金额 · {currency==='MYR'?'RM':currency}<input autoFocus required inputMode="decimal" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
   <label className="pocket-field">实际到账日期<input type="date" required max={today()} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
   {error&&<p role="alert" className="entry-error">{error}</p>}<button className="primary save-button" disabled={busy}>{busy?'正在保存…':'确认到账'}</button>
  </form>}</DialogContent></Dialog>
 </section>;
}
