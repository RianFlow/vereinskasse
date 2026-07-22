"use client";

import { TabletNumberField } from "./TabletNumberField";

type Product={id:number;name:string;price:number;memberPrice?:number|null;icon:string;category:string;color:string};
type Discount={id:string;name:string;percent:number;active:boolean};
const money=(n:number)=>n.toLocaleString("de-DE",{style:"currency",currency:"EUR"});

export function PricingPanel({products,setProducts,discounts,setDiscounts}:{products:Product[];setProducts:(p:Product[])=>void;discounts:Discount[];setDiscounts:(d:Discount[])=>void}){
  return <section className="panel pricing-panel">
    <div className="panel-head"><div><p className="eyebrow">PREISE & RABATTE</p><h2>Mitgliedspreise</h2></div><button onClick={()=>setDiscounts([...discounts,{id:crypto.randomUUID(),name:"Neuer Rabatt",percent:10,active:false}])}>+ Rabatt</button></div>
    <div className="member-prices">{products.map(p=><label key={p.id}><span>{p.icon} {p.name}<small>Normal {money(p.price)}</small></span><TabletNumberField compact label={`Mitgliedspreis ${p.name}`} min={0} max={999} step={0.5} precision={2} unit="€" allowEmpty value={p.memberPrice??null} onChange={value=>setProducts(products.map(x=>x.id===p.id?{...x,memberPrice:value}:x))}/></label>)}</div>
    <h3>Rabattaktionen</h3>
    <div className="discount-rules">{discounts.map(d=><div key={d.id}><input value={d.name} onChange={e=>setDiscounts(discounts.map(x=>x.id===d.id?{...x,name:e.target.value}:x))}/><TabletNumberField compact label={`Rabatt ${d.name}`} min={0} max={100} step={5} unit="%" value={d.percent} onChange={value=>setDiscounts(discounts.map(x=>x.id===d.id?{...x,percent:value??0}:x))}/><button className={d.active?"on":""} onClick={()=>setDiscounts(discounts.map(x=>({...x,active:x.id===d.id?!x.active:false})))}>{d.active?"Aktiv":"Aus"}</button></div>)}</div>
  </section>;
}
