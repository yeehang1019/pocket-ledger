/** Display-only retention of a successfully settled row; never changes accounting. */
export function completionRows<T extends {id:string;due:string}>(current:T[],completed:T|null):T[]{
 if(!completed||current.some(row=>row.id===completed.id))return current;
 return [...current,completed].sort((a,b)=>a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
}
export function motionAllowed(){return typeof window!=='undefined'&&document.documentElement.dataset.motion!=='off'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;}
