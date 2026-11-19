'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
/** One finite completion marker; repeating or unmounting cancels its previous timer. */
export function useCompletion<T>(duration:number){
 const [completed,setCompleted]=useState<T|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const mark=useCallback((value:T)=>{if(timer.current)clearTimeout(timer.current);setCompleted(value);timer.current=setTimeout(()=>{setCompleted(null);timer.current=null},duration)},[duration]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 return [completed,mark] as const;
}
