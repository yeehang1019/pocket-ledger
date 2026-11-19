/** Runs in head before paint. Self-contained: no imports or external closure. */
export function bootstrapAppearance(){
 const root=document.documentElement;
 let choice='auto',legacy='',motion='full';
 try{choice=localStorage.getItem('ledger-world-choice')||'';legacy=localStorage.getItem('ledger-theme')||'';motion=localStorage.getItem('pocket-motion')||motion;}catch{}
 if(!['auto','glass','neon'].includes(choice))choice=legacy?(['game','racing'].includes(legacy)?'neon':'glass'):'auto';
 const dark=matchMedia('(prefers-color-scheme: dark)').matches;
 const world=choice==='neon'?'neon':'glass';
 const resolved=world==='neon'||dark?'dark':'light';
 root.dataset.worldChoice=choice;root.dataset.world=world;root.dataset.theme=world==='glass'?'cream':'game';root.dataset.mode=resolved;root.style.colorScheme=resolved;
 const low=typeof navigator!=='undefined'&&navigator.hardwareConcurrency>0&&navigator.hardwareConcurrency<=4;
 root.dataset.performance=low?'compact':'standard';
 root.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'off':motion==='off'?'off':motion==='soft'||low?'soft':'full';
}
export const appearanceScript=`(${bootstrapAppearance.toString()})();`;
