"use client";

import type { ComponentType, CSSProperties } from "react";
import {
  IconApple,
  IconAward,
  IconBallFootball,
  IconBallTennis,
  IconBallVolleyball,
  IconBalloon,
  IconBeer,
  IconBottle,
  IconBowlSpoon,
  IconBread,
  IconBurger,
  IconCake,
  IconCandy,
  IconCards,
  IconCarrot,
  IconCheese,
  IconChocolate,
  IconCoffee,
  IconConfetti,
  IconCrown,
  IconCup,
  IconDeviceGamepad2,
  IconDroplet,
  IconEgg,
  IconFish,
  IconFlame,
  IconGift,
  IconGlass,
  IconGlassChampagne,
  IconGlassCocktail,
  IconGlassGin,
  IconGrill,
  IconHanger,
  IconHeart,
  IconIceCream2,
  IconLemon,
  IconMeat,
  IconMedal,
  IconMicrophone,
  IconMilk,
  IconMug,
  IconMushroom,
  IconMusic,
  IconPackage,
  IconPaw,
  IconPepper,
  IconPizza,
  IconSalad,
  IconSausage,
  IconShirt,
  IconSoup,
  IconSparkles,
  IconStar,
  IconTargetArrow,
  IconTicket,
  IconToolsKitchen2,
  IconTrophy,
} from "@tabler/icons-react";

type ProductIconComponent=ComponentType<{size?:number;stroke?:number;className?:string;"aria-hidden"?:boolean}>;
type BrandBadge={text:string;background:string;color:string;border?:string;round?:boolean};

const iconMap:Record<string,ProductIconComponent>={
  beer:IconBeer,bottle:IconBottle,coffee:IconCoffee,cup:IconCup,glass:IconGlass,
  cocktail:IconGlassCocktail,champagne:IconGlassChampagne,gin:IconGlassGin,water:IconDroplet,
  milk:IconMilk,mug:IconMug,pizza:IconPizza,burger:IconBurger,sausage:IconSausage,
  cake:IconCake,icecream:IconIceCream2,apple:IconApple,candy:IconCandy,soup:IconSoup,
  bowl:IconBowlSpoon,bread:IconBread,meat:IconMeat,fish:IconFish,salad:IconSalad,
  lemon:IconLemon,cheese:IconCheese,carrot:IconCarrot,egg:IconEgg,mushroom:IconMushroom,
  pepper:IconPepper,chocolate:IconChocolate,kitchen:IconToolsKitchen2,grill:IconGrill,flame:IconFlame,
  package:IconPackage,shirt:IconShirt,hanger:IconHanger,trophy:IconTrophy,target:IconTargetArrow,
  football:IconBallFootball,tennis:IconBallTennis,volleyball:IconBallVolleyball,cards:IconCards,
  game:IconDeviceGamepad2,gift:IconGift,ticket:IconTicket,crown:IconCrown,medal:IconMedal,
  award:IconAward,balloon:IconBalloon,confetti:IconConfetti,music:IconMusic,microphone:IconMicrophone,
  heart:IconHeart,star:IconStar,paw:IconPaw,sparkles:IconSparkles,
};

const brandBadges:Record<string,BrandBadge>={
  cola:{text:"COLA",background:"#c81d2b",color:"#fff",round:true},
  "cola-zero":{text:"ZERO",background:"#171717",color:"#fff",round:true},
  fanta:{text:"F",background:"#f28c18",color:"#fff",round:true},
  sprite:{text:"SP",background:"#15864b",color:"#fff",round:true},
  heineken:{text:"H★",background:"#08783e",color:"#fff",round:true},
  becks:{text:"B",background:"#07543d",color:"#fff",border:"#d8b658"},
  krombacher:{text:"K",background:"#0d6449",color:"#f7d97c",round:true},
  veltins:{text:"V",background:"#f4f7f8",color:"#07558c",border:"#8db1c9"},
  warsteiner:{text:"W",background:"#e6ca6b",color:"#26221c",round:true},
  veterano:{text:"VET",background:"#a91f25",color:"#fff"},
  jaegermeister:{text:"J",background:"#e86b1c",color:"#173d2e",round:true},
  energy:{text:"EN",background:"#2455a4",color:"#fff"},
};

const legacyIcons:Record<string,string>={
  "🍺":"beer","🍻":"beer","🍾":"bottle","🥤":"glass","💧":"water","☕":"coffee",
  "🍕":"pizza","🍔":"burger","🌭":"sausage","🍟":"bowl","🍰":"cake","🍦":"icecream",
  "🍎":"apple","🍬":"candy","🥩":"meat","🥗":"salad","🧣":"shirt","✨":"sparkles","🏷️":"ticket",
};

export const productIconOptions=[
  ["beer","Bier"],["bottle","Flasche"],["glass","Glas"],["cocktail","Cocktail"],["champagne","Sekt"],
  ["gin","Longdrink"],["water","Wasser"],["coffee","Kaffee"],["cup","Becher"],["mug","Tasse"],["milk","Milch"],
  ["cola","Cola"],["cola-zero","Cola Zero"],["fanta","Fanta"],["sprite","Sprite"],["energy","Energy"],
  ["heineken","Heineken"],["becks","Beck's"],["krombacher","Krombacher"],["veltins","Veltins"],
  ["warsteiner","Warsteiner"],["veterano","Veterano"],["jaegermeister","Jägermeister"],
  ["pizza","Pizza"],["burger","Burger"],["sausage","Wurst"],["meat","Fleisch"],["fish","Fisch"],
  ["salad","Salat"],["soup","Suppe"],["bowl","Schale"],["bread","Brot"],["cake","Kuchen"],
  ["icecream","Eis"],["apple","Obst"],["candy","Süßes"],["chocolate","Schokolade"],["lemon","Zitrone"],
  ["cheese","Käse"],["carrot","Gemüse"],["egg","Ei"],["mushroom","Pilze"],["pepper","Gewürz"],
  ["kitchen","Küche"],["grill","Grill"],["flame","Heiß"],["package","Artikel"],["shirt","Kleidung"],
  ["hanger","Textilien"],["trophy","Pokal"],["target","Darts"],["football","Fußball"],["tennis","Tennis"],
  ["volleyball","Volleyball"],["cards","Karten"],["game","Spiel"],["gift","Geschenk"],["ticket","Ticket"],
  ["crown","Premium"],["medal","Medaille"],["award","Auszeichnung"],["balloon","Feier"],["confetti","Party"],
  ["music","Musik"],["microphone","Mikrofon"],["heart","Verein"],["star","Favorit"],["paw","Tier"],["sparkles","Sonstiges"],
] as const;

export function ProductIcon({value,size=30,className}:{value:string;size?:number;className?:string}){
  const key=legacyIcons[value]||value;
  const badge=brandBadges[key];
  if(badge){
    const badgeStyle:CSSProperties={
      width:size,
      height:size,
      display:"inline-grid",
      placeItems:"center",
      flex:"0 0 auto",
      overflow:"hidden",
      borderRadius:badge.round?"50%":Math.max(4,Math.round(size*.22)),
      border:`1px solid ${badge.border||"rgba(255,255,255,.38)"}`,
      background:badge.background,
      color:badge.color,
      boxShadow:"inset 0 0 0 1px rgba(0,0,0,.08)",
      fontFamily:"Arial,Helvetica,sans-serif",
      fontSize:Math.max(7,Math.round(size*(badge.text.length>3?.24:badge.text.length>2?.29:.4))),
      fontWeight:900,
      letterSpacing:badge.text.length>3?"-.06em":"-.02em",
      lineHeight:1,
    };
    return <span className={["product-brand-badge",className].filter(Boolean).join(" ")} style={badgeStyle} aria-hidden="true">{badge.text}</span>;
  }
  const Icon=iconMap[key];
  if(!Icon)return <span className={className} aria-hidden="true">{value||"•"}</span>;
  return <Icon size={size} stroke={1.8} className={className} aria-hidden={true}/>;
}
