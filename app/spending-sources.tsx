import {ArrowUpRight} from 'lucide-react';
import {money} from '@/lib/ledger-domain';
import {sourceNames} from '@/lib/spending-summary';

/** Presentation only: signed source totals remain untouched, including refunds. */
export default function SpendingSources({sources,currency,onSelect}:{sources:Record<keyof typeof sourceNames,number>;currency:string;onSelect:(key:string)=>void}){
 const entries=Object.entries(sourceNames) as [keyof typeof sourceNames,string][];
 const positive=entries.reduce((sum,[key])=>sum+Math.max(0,sources[key]),0);
 return <div className="source-breakdown">
  <div className="source-proportion" role="img" aria-label="消费来源比例；比例按正净额绘制">{entries.map(([key,name])=><span key={key} className={'source-segment source-'+key} style={{flexGrow:positive?Math.max(0,sources[key])/positive:0}} title={`${name} ${money(sources[key],currency)}`}/>)}</div>
  <div className="spending-sources">{entries.map(([key,name])=><button key={key} type="button" data-source={key} onClick={()=>onSelect(key)}><span className={'source-dot source-'+key} aria-hidden="true"/><span>{name}</span><strong>{money(sources[key],currency)}</strong><ArrowUpRight size={16} aria-hidden="true"/></button>)}</div>
 </div>;
}
