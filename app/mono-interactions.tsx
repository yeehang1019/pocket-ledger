'use client';
import {useEffect,useRef} from 'react';
import {shouldDismissSheet} from '@/lib/visual-interactions';

/** Scroll changes only composited chrome, never data or React ledger state. */
export function useMonoChrome(page:string){
 useEffect(()=>{let frame=0;const update=()=>{frame=0;document.documentElement.style.setProperty('--nav-progress',String(Math.min(1,Math.max(0,(window.scrollY-10)/40))))};const scroll=()=>{if(!frame)frame=requestAnimationFrame(update)};window.scrollTo({top:0,behavior:'instant'});update();window.addEventListener('scroll',scroll,{passive:true});return()=>{window.removeEventListener('scroll',scroll);if(frame)cancelAnimationFrame(frame)}},[page]);
}

/** Dragging is optional; Radix keeps Escape, close button and focus restoration. */
export function SheetHandle({disabled,onClose}:{disabled:boolean;onClose:()=>void}){
 const origin=useRef<number|null>(null),distance=useRef(0);
 const reset=(element:HTMLElement)=>{const sheet=element.closest<HTMLElement>('[data-slot="dialog-content"]');if(sheet){sheet.style.removeProperty('--sheet-drag');sheet.removeAttribute('data-dragging')}origin.current=null;distance.current=0};
 return <div className="sheet-grab" aria-hidden="true" onPointerDown={e=>{if(disabled)return;origin.current=e.clientY;distance.current=0;e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.closest('[data-slot="dialog-content"]')?.setAttribute('data-dragging','true')}} onPointerMove={e=>{if(origin.current===null)return;distance.current=Math.max(0,e.clientY-origin.current);e.currentTarget.closest<HTMLElement>('[data-slot="dialog-content"]')?.style.setProperty('--sheet-drag',distance.current+'px')}} onPointerUp={e=>{if(origin.current===null)return;const dismiss=shouldDismissSheet(distance.current,disabled);reset(e.currentTarget);if(dismiss)onClose()}} onPointerCancel={e=>reset(e.currentTarget)} onLostPointerCapture={e=>reset(e.currentTarget)}><span/></div>;
}
