import type { Metadata, Viewport } from 'next';
import {appearanceScript} from '@/lib/appearance';
import './globals.css';
import './pocket-play.css';
import './motion-worlds.css';
import './creative-shell.css';
import './studio.css';
import './lightfield.css';
import './phase-one.css';
import './round-two.css';
import './worlds.css';
import './desktop-layout.css';
import './payables-polish.css';
import './flow-summary.css';
export const metadata: Metadata = {title:'口袋账本 · 每一笔，心中有数',description:'私人收入、支出与周期账单。',icons:{icon:'/favicon.svg',apple:'/icon-192.png'},appleWebApp:{capable:true,title:'口袋账本',statusBarStyle:'default'}};
export const viewport: Viewport = {width:'device-width',initialScale:1,themeColor:'#245c49'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:appearanceScript}}/><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials"/></head><body>{children}</body></html>}
