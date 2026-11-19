import {Utensils,ShoppingBag,Car,House,Zap,Heart,Briefcase,MoreHorizontal,Wallet,Gift,HandCoins} from 'lucide-react';
const icons:Record<string,typeof Wallet>={'餐饮':Utensils,'购物':ShoppingBag,'交通':Car,'居住':House,'账单':Zap,'娱乐':Heart,'健康':Heart,'工资':Briefcase,'奖金':Gift,'兼职':Briefcase,'卖东西':HandCoins,'其他':MoreHorizontal};
export function CategoryIcon({name}:{name:string}){const Icon=icons[name]||Wallet;return <Icon size={20} aria-hidden="true"/>;}
