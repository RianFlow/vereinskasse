"use client";

import type { ComponentType } from "react";
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

const legacyIcons:Record<string,string>={
  "🍺":"beer","🍻":"beer","🍾":"bottle","🥤":"glass","💧":"water","☕":"coffee",
  "🍕":"pizza","🍔":"burger","🌭":"sausage","🍟":"bowl","🍰":"cake","🍦":"icecream",
  "🍎":"apple","🍬":"candy","🥩":"meat","🥗":"salad","🧣":"shirt","✨":"sparkles","🏷️":"ticket",
};

export const productIconOptions=[
  ["beer","Bier"],["bottle","Flasche"],["glass","Glas"],["cocktail","Cocktail"],["champagne","Sekt"],
  ["gin","Longdrink"],["water","Wasser"],["coffee","Kaffee"],["cup","Becher"],["mug","Tasse"],["milk","Milch"],
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
  const Icon=iconMap[key];
  if(!Icon)return <span className={className} aria-hidden="true">{value||"•"}</span>;
  return <Icon size={size} stroke={1.8} className={className} aria-hidden={true}/>;
}
