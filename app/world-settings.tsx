'use client';
import {useEffect,useState} from 'react';
import {Layers,Monitor,Zap,Check} from 'lucide-react';
import {bootstrapAppearance} from '@/lib/appearance';
export function WorldThemeController(){
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),reduce=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>bootstrapAppearance();update();media.addEventListener('change',update);reduce.addEventListener('change',update);window.addEventListener('storage',update);window.addEventListener('ledger-appearance-change',update);return()=>{media.removeEventListener('change',update);reduce.removeEventListener('change',update);window.removeEventListener('storage',update);window.removeEventListener('ledger-appearance-change',update)}},[]);
 return null;
}
export function WorldSettings(){
 const [choice,setChoice]=useState('auto'),[notice,setNotice]=useState('');
 useEffect(()=>{const update=()=>setChoice(document.documentElement.dataset.worldChoice||'auto');update();window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update)},[]);
 const choose=(value:string)=>{try{localStorage.setItem('ledger-world-choice',value);setChoice(value);bootstrapAppearance();window.dispatchEvent(new Event('ledger-appearance-change'));}catch{setNotice('外观偏好无法保存在此浏览器，请检查存储权限。')}};
 return <section id="appearance-settings" className="panel world-settings" tabIndex={-1}><div className="panel-heading"><div><h2>选择你的世界</h2><p>同一本账，两种气质。</p></div><Layers aria-hidden="true"/></div><div className="world-choices">{[
  {id:'glass',name:'iOS Mono',label:'黑白玻璃 · 跟随系统明暗',Icon:Layers},
  {id:'neon',name:'Neon City',label:'霓虹 · 始终深色',Icon:Zap},
  {id:'auto',name:'自动',label:'跟随系统 · iOS Mono 浅色 / 深色',Icon:Monitor}
 ].map(({id,name,label,Icon})=><button className={'world-choice world-choice-'+id} key={id} aria-pressed={choice===id} onClick={()=>choose(id)}><span className="world-choice-preview" aria-hidden="true"><Icon size={18}/><b>RM 24.80</b><i/></span><span><strong>{name}</strong><small>{label}</small></span>{choice===id&&<Check size={18} aria-hidden="true"/>}</button>)}</div>{notice&&<p role="alert">{notice}</p>}</section>;
}
