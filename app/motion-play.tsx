'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Bot,Sparkles,Zap,Check,Flame} from 'lucide-react';
import {bootstrapAppearance} from '@/lib/appearance';
import {money,today} from '@/lib/ledger-domain';
export const celebrate=(message='已保存')=>window.dispatchEvent(new CustomEvent('pocket-celebrate',{detail:message}));
type FeedbackWindow = Window & {webkitAudioContext?: typeof AudioContext};
let audio: AudioContext | undefined;
let lastFeedback = 0;
function unlockAudio(){
  if(localStorage.getItem('pocket-sound')!=='on')return;
  const Audio = window.AudioContext || (window as FeedbackWindow).webkitAudioContext;
  if(!Audio)return;
  try{audio ||= new Audio();void audio.resume().catch(()=>{});}catch{}
}
function feedback(){
  if(Date.now()-lastFeedback<800)return;lastFeedback=Date.now();
  if(localStorage.getItem('pocket-haptic')==='on' && navigator.vibrate)navigator.vibrate(18);
  if(localStorage.getItem('pocket-sound')!=='on'||!audio||audio.state!=='running')return;
  const start=audio.currentTime;
  [660,880].forEach((frequency,i)=>{
    const tone=audio!.createOscillator(),gain=audio!.createGain();
    tone.type='sine';tone.frequency.value=frequency;
    gain.gain.setValueAtTime(0,start+i*.075);gain.gain.linearRampToValueAtTime(.025,start+i*.075+.012);
    gain.gain.exponentialRampToValueAtTime(.0001,start+i*.075+.14);
    tone.connect(gain);gain.connect(audio!.destination);tone.start(start+i*.075);tone.stop(start+i*.075+.15);
    tone.onended=()=>{tone.disconnect();gain.disconnect()};
  });
}
export function MotionSettings(){
  const [mode,setMode]=useState('full');
  useEffect(()=>{const frame=requestAnimationFrame(()=>setMode(localStorage.getItem('pocket-motion')||'full'));return()=>cancelAnimationFrame(frame);},[]);
  const change=(key:string,value:string)=>{localStorage.setItem('pocket-'+key,value);const data=key==='motion-style'?'motionStyle':key;document.documentElement.dataset[data]=value;bootstrapAppearance()};
  return <section className="panel motion-studio">
    <div className="motion-title"><Zap/><div><span>操作反馈</span><h3>动效与操作反馈</h3><p>完整体验、简化呈现，或完全关闭。</p></div></div>

    <div className="motion-controls"><label>动效<select value={mode} onChange={e=>{setMode(e.target.value);change('motion',e.target.value)}}><option value="full">完整</option><option value="soft">简化</option><option value="off">关</option></select></label></div>
    
    <p className="motion-note" role="status">{'系统减少动态效果时自动关闭；低性能设备自动简化。'}</p>
  </section>
}
export function MotionLayer(){
  const [event,setEvent]=useState({id:0,message:''});const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    const root=document.documentElement;
    bootstrapAppearance();root.dataset.motionStyle=localStorage.getItem('pocket-motion-style')||'all';
    const connection=(navigator as Navigator & {connection?:{saveData?:boolean}}).connection;root.dataset.performance=connection?.saveData||navigator.hardwareConcurrency<=4?'compact':'standard';
    let scrollTimer:ReturnType<typeof setTimeout>;const scroll=()=>{root.dataset.scrolling='true';clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{root.dataset.scrolling='false'},180)};window.addEventListener('scroll',scroll,{passive:true});
    const visibility=()=>{root.dataset.motionPaused=document.hidden?'true':'false'};visibility();
    const handler=(e:Event)=>{if(root.dataset.motion==='off'||root.dataset.motion==='soft'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;feedback();setEvent({id:Date.now(),message:(e as CustomEvent<string>).detail});if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setEvent(v=>({...v,message:''})),1600)};
    window.addEventListener('pocket-celebrate',handler);window.addEventListener('pointerdown',unlockAudio);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('scroll',scroll);clearTimeout(scrollTimer);window.removeEventListener('pocket-celebrate',handler);window.removeEventListener('pointerdown',unlockAudio);document.removeEventListener('visibilitychange',visibility);if(timer.current)clearTimeout(timer.current)}
  },[]);
  return <><div className="motion-world" aria-hidden="true"><div className="world-grid"/><div className="world-ribbon ribbon-one"/><div className="world-ribbon ribbon-two"/><div className="world-ring"/>{Array.from({length:8},(_,i)=><i className="world-mote" key={i} style={{'--x':(i*37%100)+'%','--y':(i*61%100)+'%','--duration':(14+i%6*3)+'s','--delay':(-i*1.7)+'s','--size':(2+i%3*2)+'px'} as React.CSSProperties}/>)}</div>{event.message&&<div key={event.id} className="celebrate-stage" aria-hidden="true"><span className="celebrate-check"><Check size={32}/></span>{Array.from({length:14},(_,i)=><i key={i} style={{'--angle':i*360/14+'deg','--distance':80+(i%4)*30+'px','--delay':(i%5)*.015+'s','--particle-color':i%3===0?'var(--app-primary)':i%3===1?'var(--app-secondary)':'var(--app-a1)'} as React.CSSProperties}/>)}<strong>{event.message}</strong></div>}</>
}
export function AnimatedMoney({amount,currency,enter=false}:{amount:number;currency:string;enter?:boolean}){const [display,setDisplay]=useState(amount),last=useRef(amount),first=useRef(true);useLayoutEffect(()=>{const initial=first.current;first.current=false;const start=enter&&initial?0:last.current,target=amount;last.current=target;if(document.documentElement.dataset.motion==='off'||window.matchMedia('(prefers-reduced-motion: reduce)').matches){const frame=requestAnimationFrame(()=>setDisplay(target));return()=>cancelAnimationFrame(frame);}let frame=0;const startAt=performance.now(),duration=enter&&initial?900:300;const tick=(time:number)=>{const t=Math.min(1,(time-startAt)/duration);setDisplay(Math.round(start+(target-start)*(1-(1-t)**4)));if(t<1)frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)},[amount,enter]);return <span aria-label={money(amount,currency)}><span aria-hidden="true">{money(display,currency)}</span></span>}
export function Companion({spent,count}:{spent:number;count:number}){const [touch,setTouch]=useState(0);const messages=['今天的小账，我陪你记。','先选场景，再填金额。两步就好。','消费和付款各记各的，账就清楚啦。','存一点、记一点，慢慢接近目标。'];return <section className="companion-card"><button className="companion-bot" aria-label="和记账伙伴互动" onClick={()=>{setTouch(v=>v+1);celebrate('继续保持 ✦')}}><Bot size={42}/><span className="companion-orbit"><Sparkles size={15}/></span></button><div><span className="companion-label"><Flame size={13}/>POCKET PLAY</span><h3>{messages[touch%messages.length]}</h3><p>今天 {count} 笔消费记录 · 点一下伙伴，给自己一点鼓励。</p></div><span className="companion-date">{today().slice(5)}</span></section>}
