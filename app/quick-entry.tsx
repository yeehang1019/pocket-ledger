'use client';
import {useState} from 'react';
import {Delete} from 'lucide-react';
import {CategoryIcon} from './category-icons';
import {today,digits,INCOME_CATEGORIES} from '@/lib/ledger-domain';
import {paymentMethods} from '@/lib/commitments';
import type {PocketData} from '@/lib/pocket-domain';
import {entryDateMax} from '@/lib/entry-defaults';
export type EntryForm={id:string;title:string;amount:string;currency:string;kind:string;category:string;date:string;note:string;payment_method:string;months:number;first_due:string;total:string;original_paylater?:boolean;rule_id?:string;edit_version?:string};
export default function QuickEntry({templates,form,setForm,categories,busy,error,conflict,onReload,onOverwrite,onSave}:{templates:PocketData['templates'];form:EntryForm;setForm:(f:EntryForm)=>void;categories:string[];busy:boolean;error:string;conflict:boolean;onReload:()=>void;onOverwrite:()=>void;onSave:()=>Promise<void>}){
 const [dateOpen,setDateOpen]=useState(false);
 const yesterday=new Date(Date.parse(today()+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const cats=form.kind==='income'?INCOME_CATEGORIES:categories.filter(c=>c==='其他'||!INCOME_CATEGORIES.includes(c));
 return <form className="fast-entry" data-failed={!!error&&!conflict||undefined} onSubmit={e=>{e.preventDefault();void onSave()}} aria-busy={busy}>
  <div className="date-choices entry-kind" role="group" aria-label="记账类型">{[['expense','支出'],['income','收入'],['refund','退款']].map(([kind,label])=><button type="button" key={kind} disabled={busy||!!form.original_paylater||!!form.rule_id} aria-pressed={form.kind===kind} onClick={()=>setForm({...form,kind,category:kind==='income'?'工资':INCOME_CATEGORIES.includes(form.category)?'其他':form.category,payment_method:'ordinary'})}>{label}</button>)}</div>
  <div className="quick-categories" role="group" aria-label="分类">{cats.map(c=><button type="button" key={c} aria-pressed={form.category===c} className={form.category===c?'selected':''} onClick={()=>setForm({...form,category:c})}><CategoryIcon name={c}/><span>{c}</span></button>)}</div>
  <label className="fast-amount" htmlFor="fast-amount">金额 · {form.currency==='MYR'?'RM':form.currency}<input id="fast-amount" autoFocus required inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
  <div className="date-choices" role="group" aria-label="日期">{[[today(),'今天'],[yesterday,'昨天']].map(([date,label])=><button type="button" key={date} aria-pressed={form.date===date} onClick={()=>{setForm({...form,date});setDateOpen(false)}}>{label}</button>)}<button type="button" aria-expanded={dateOpen} onClick={()=>setDateOpen(!dateOpen)}>选日期</button><span>{form.date}</span></div>
  {dateOpen&&<label className="pocket-field">交易日期<input type="date" required max={entryDateMax(form)} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>}
  <details className="entry-more" open={form.original_paylater||undefined}><summary>更多</summary>{templates.some(t=>cats.includes(t.category))&&<div className="quick-categories" aria-label="记账模板">{templates.filter(t=>cats.includes(t.category)).map(t=><button type="button" key={t.id} onClick={()=>setForm({...form,title:t.title,category:t.category,amount:String(t.amount/10**digits(t.currency))})}>{t.title}</button>)}</div>}<div className="form-grid">
   <label className="pocket-field">名称 · 选填<input maxLength={100} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
   <label className="pocket-field">币种<select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})}>{['MYR','SGD','USD','CNY','EUR','GBP','JPY','KRW','THB','IDR','HKD','TWD','AUD'].map(c=><option key={c} value={c}>{c==='MYR'?'RM':c}</option>)}</select></label>
   <label className="pocket-field">备注 · 选填<textarea maxLength={500} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
  </div>{form.kind==='expense'&&<label className="pocket-field">付款方式<select value={form.payment_method||'ordinary'} onChange={e=>setForm({...form,payment_method:e.target.value,months:e.target.value==='grabpaylater'?1:form.months||1})}>{Object.entries(paymentMethods).map(([key,label])=><option key={key} value={key} disabled={!!form.original_paylater&&key==='ordinary'||!!form.rule_id&&key!=='ordinary'}>{label}</option>)}</select></label>}
  {form.kind==='expense'&&form.payment_method!=='ordinary'&&<div className="form-grid"><label className="pocket-field">分几期<input type="number" min="1" max="60" required disabled={form.payment_method==='grabpaylater'} value={form.months} onChange={e=>setForm({...form,months:Number(e.target.value)})}/></label><label className="pocket-field">首期到期日<input type="date" required min={form.date} value={form.first_due} onChange={e=>setForm({...form,first_due:e.target.value})}/></label><label className="pocket-field">平台总应还 · 含手续费<input inputMode="decimal" value={form.total} placeholder={form.amount} onChange={e=>setForm({...form,total:e.target.value})}/></label></div>}
  </details>
  {error&&<div className="entry-error" role="alert"><p>{error}</p>{conflict&&<><button type="button" className="secondary" onClick={onReload}>重新载入</button><button type="button" className="secondary" onClick={onOverwrite}>保留我的输入并覆盖</button></>}</div>}
  <div className="entry-keypad" role="group" aria-label="数字键盘">{['1','2','3','4','5','6','7','8','9','.','0','delete'].map(key=><button type="button" disabled={busy} key={key} aria-label={key==='delete'?'退格':`输入 ${key}`} onClick={()=>{const value=String(form.amount||'');const next=key==='delete'?value.slice(0,-1):key==='.'?(value.includes('.')?value:(value||'0')+'.'):(value==='0'?'':value)+key;if(/^\d{0,10}(\.\d{0,2})?$/.test(next))setForm({...form,amount:next})}}>{key==='delete'?<Delete size={22} aria-hidden="true"/>:key}</button>)}</div>
  <button className="primary save-button" disabled={busy||!form.category}>{busy?'正在保存…':'保存'}</button>
 </form>;
}
