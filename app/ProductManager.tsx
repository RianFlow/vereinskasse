"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { IconPackage, IconPlus, IconSearch, IconTags, IconTicket, IconTrash } from "@tabler/icons-react";
import { PricingPanel } from "./PricingPanel";
import { ProductIcon, productIconOptions } from "./ProductIcon";
import { TabletNumberField } from "./TabletNumberField";

type IncludedItem={productId:number;quantity:number};
type Product={id:number;name:string;price:number;memberPrice?:number|null;includedItems?:IncludedItem[];isOffer?:boolean;icon:string;category:string;color:string};
type Discount={id:string;name:string;percent:number;active:boolean};

const money=(value:number)=>value.toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const colors=["#f4b942","#d36b54","#73b6e6","#68a487","#a6a1d8","#df9db4","#d79b45","#6f7e78"];

export function ProductManager({products,setProducts,discounts,setDiscounts}:{products:Product[];setProducts:(products:Product[])=>void;discounts:Discount[];setDiscounts:(discounts:Discount[])=>void}){
  const [view,setView]=useState<"articles"|"pricing">("articles");
  const [selectedId,setSelectedId]=useState<number|null>(products[0]?.id??null);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("Alle");
  const [showIcons,setShowIcons]=useState(false);
  const selected=products.find(product=>product.id===selectedId)||products[0]||null;
  const categories=useMemo(()=>["Alle",...Array.from(new Set(products.map(product=>product.category).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"de"))],[products]);
  const normalized=query.trim().toLocaleLowerCase("de-DE");
  const filtered=products.filter(product=>(category==="Alle"||product.category===category)&&(!normalized||`${product.name} ${product.category}`.toLocaleLowerCase("de-DE").includes(normalized)));

  const update=(id:number,patch:Partial<Product>)=>setProducts(products.map(product=>product.id===id?{...product,...patch}:product));
  const create=(offer=false)=>{
    const id=Date.now();
    const product:Product={id,name:offer?"Neues Angebot":"Neuer Artikel",price:offer?3.5:1,memberPrice:null,includedItems:[],isOffer:offer,icon:offer?"ticket":"sparkles",category:offer?"Angebote":"Sonstiges",color:offer?"#d79b45":"#a6a1d8"};
    setProducts([...products,product]);setSelectedId(id);setView("articles");setShowIcons(false);
  };
  const remove=(product:Product)=>{
    if(!confirm(`${product.name} wirklich löschen? Bereits gespeicherte Verkäufe bleiben in den Auswertungen erhalten.`))return;
    const remaining=products.filter(candidate=>candidate.id!==product.id);
    setProducts(remaining);setSelectedId(remaining[0]?.id??null);setShowIcons(false);
  };
  const setIncluded=(includedItems:IncludedItem[])=>selected&&update(selected.id,{includedItems});
  const addIncluded=()=>{
    if(!selected)return;
    const used=new Set((selected.includedItems||[]).map(item=>item.productId));
    const component=products.find(candidate=>candidate.id!==selected.id&&!used.has(candidate.id));
    if(component)setIncluded([...(selected.includedItems||[]),{productId:component.id,quantity:1}]);
  };
  const updateIncluded=(index:number,patch:Partial<IncludedItem>)=>selected&&setIncluded((selected.includedItems||[]).map((item,itemIndex)=>itemIndex===index?{...item,...patch}:item));
  const includedText=(product:Product)=>(product.includedItems||[]).map(item=>`${item.quantity}× ${products.find(candidate=>candidate.id===item.productId)?.name||"Artikel"}`).join(" + ");
  const includedValue=(product:Product)=>(product.includedItems||[]).reduce((sum,item)=>sum+(products.find(candidate=>candidate.id===item.productId)?.price||0)*item.quantity,0);

  return <section className="product-manager">
    <div className="product-manager-tabs" aria-label="Artikelverwaltung">
      <button className={view==="articles"?"active":""} onClick={()=>setView("articles")}><IconPackage size={20}/><span><strong>Artikel</strong><small>Anlegen und bearbeiten</small></span></button>
      <button className={view==="pricing"?"active":""} onClick={()=>setView("pricing")}><IconTags size={20}/><span><strong>Preise & Rabatte</strong><small>Mitglieder und Aktionen</small></span></button>
    </div>

    {view==="pricing"?<PricingPanel products={products} setProducts={setProducts} discounts={discounts} setDiscounts={setDiscounts}/>:<>
      <div className="product-manager-toolbar">
        <label className="product-search"><IconSearch size={19}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Artikel oder Kategorie suchen"/><small>{filtered.length} von {products.length}</small></label>
        <select aria-label="Kategorie filtern" value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select>
        <button className="new-offer" onClick={()=>create(true)}><IconTicket size={19}/> Angebot</button>
        <button className="new-product" onClick={()=>create(false)}><IconPlus size={20}/> Neuer Artikel</button>
      </div>

      <div className="product-workspace">
        <aside className="product-master">
          <div className="product-master-head"><div><p className="eyebrow">SORTIMENT</p><h2>Artikelübersicht</h2></div><span>{products.length}</span></div>
          <div className="product-master-list">{filtered.map(product=><button key={product.id} className={selected?.id===product.id?"active":""} onClick={()=>{setSelectedId(product.id);setShowIcons(false)}}><span className="managed-product-icon" style={{"--managed-color":product.color} as React.CSSProperties}><ProductIcon value={product.icon} size={27}/></span><div><strong>{product.name}</strong><small>{product.category||"Ohne Kategorie"}</small><em>{product.isOffer?"Angebot":(product.includedItems||[]).length?"Paket / Beigabe":"Einzelartikel"}</em></div><b>{money(product.price)}</b></button>)}{!filtered.length&&<div className="no-products"><IconSearch size={25}/><strong>Kein Artikel gefunden</strong><small>Suche oder Kategorie ändern.</small></div>}</div>
        </aside>

        <section className="product-detail panel">
          {selected?<><div className="product-detail-head"><div className="product-preview" style={{"--managed-color":selected.color} as CSSProperties}><ProductIcon value={selected.icon} size={35}/></div><div><p className="eyebrow">ARTIKEL BEARBEITEN</p><h2>{selected.name}</h2><small>Änderungen werden automatisch gespeichert.</small></div><button className="delete-managed-product" onClick={()=>remove(selected)}><IconTrash size={18}/><span>Löschen</span></button></div>

            <div className="product-form-grid">
              <label className="product-name-field">Artikelname<input value={selected.name} onChange={event=>update(selected.id,{name:event.target.value})} placeholder="z. B. Helles"/></label>
              <label>Marke / Kategorie<input className="brand-label-input" value={selected.category} onChange={event=>update(selected.id,{category:event.target.value})} placeholder="z. B. Getränke oder Coca-Cola"/></label>
              <label>Normalpreis<TabletNumberField label={`Preis ${selected.name}`} min={0} max={999} step={0.5} precision={2} unit="€" value={selected.price} onChange={value=>update(selected.id,{price:value??0})}/></label>
              <label>Mitgliedspreis<TabletNumberField label={`Mitgliedspreis ${selected.name}`} min={0} max={999} step={0.5} precision={2} unit="€" allowEmpty value={selected.memberPrice??null} onChange={value=>update(selected.id,{memberPrice:value})}/><small>Leer lassen = Normalpreis</small></label>
            </div>

            <div className="appearance-editor"><div><strong>Darstellung an der Kasse</strong><small>Einheitliches Symbol und eine gut erkennbare Kachelfarbe.</small></div><button className="current-icon-button" onClick={()=>setShowIcons(value=>!value)} aria-expanded={showIcons}><ProductIcon value={selected.icon} size={27}/><span>Icon auswählen</span></button><div className="product-colors">{colors.map(color=><button key={color} className={selected.color===color?"active":""} style={{background:color}} aria-label={`Farbe ${color}`} onClick={()=>update(selected.id,{color})}/>)}</div></div>
            {showIcons&&<div className="product-icon-picker managed-icon-picker"><div><strong>Passendes Icon auswählen</strong><small>{productIconOptions.length} Symbole und Marken-Badges für Getränke, Essen, Sport und Verein</small></div><div>{productIconOptions.map(([key,label])=><button key={key} className={selected.icon===key?"active":""} title={label} onClick={()=>{update(selected.id,{icon:key});setShowIcons(false)}}><ProductIcon value={key} size={25}/><span>{label}</span></button>)}</div></div>}

            <div className="managed-bundle-editor">
              <div className="managed-section-title"><div><strong>Paket, Beigabe oder Angebot</strong><small>Enthaltene Artikel zählen immer korrekt im Verbrauch.</small></div><span>{(selected.includedItems||[]).reduce((sum,item)=>sum+item.quantity,0)} Bestandteile</span></div>
              <div className="bundle-kind" aria-label="Paketart"><button className={!selected.isOffer?"active":""} onClick={()=>update(selected.id,{isOffer:false})}>Beigabe / inklusive</button><button className={selected.isOffer?"active":""} onClick={()=>update(selected.id,{isOffer:true})}>Angebotspreis</button></div>
              <p className="bundle-kind-help">{selected.isOffer?"Der Normalpreis oben gilt für das gesamte Angebot. Die Bestandteile werden nicht zusätzlich berechnet.":"Die Bestandteile werden mit 0,00 € gebucht und nur dem tatsächlichen Verbrauch zugerechnet."}</p>
              <div className="managed-components">{(selected.includedItems||[]).map((item,index)=>{const selectedElsewhere=new Set((selected.includedItems||[]).filter((_,itemIndex)=>itemIndex!==index).map(entry=>entry.productId));return <div className="bundle-component" key={`${selected.id}-${index}`}><select aria-label={`Enthaltener Artikel in ${selected.name}`} value={item.productId} onChange={event=>updateIncluded(index,{productId:Number(event.target.value)})}>{products.filter(candidate=>candidate.id!==selected.id).map(candidate=><option key={candidate.id} value={candidate.id} disabled={selectedElsewhere.has(candidate.id)}>{candidate.name}</option>)}</select><label>Menge<TabletNumberField compact label={`Enthaltene Menge in ${selected.name}`} min={1} max={99} value={item.quantity} onChange={value=>updateIncluded(index,{quantity:value??1})}/></label><button aria-label="Bestandteil entfernen" onClick={()=>setIncluded((selected.includedItems||[]).filter((_,itemIndex)=>itemIndex!==index))}>×</button></div>})}</div>
              <button className="add-bundle-component" disabled={products.filter(candidate=>candidate.id!==selected.id).every(candidate=>(selected.includedItems||[]).some(item=>item.productId===candidate.id))} onClick={addIncluded}>+ Bestandteil hinzufügen</button>
              {includedText(selected)&&<p className={`bundle-summary ${selected.isOffer?"offer-summary":""}`}><strong>Beim Verkauf von 1× {selected.name}:</strong> {selected.isOffer?<>Einzelwert {money(includedValue(selected))} · Angebot {money(selected.price)}{includedValue(selected)>selected.price&&<> · <b>{money(includedValue(selected)-selected.price)} Ersparnis</b></>}</>:<>zusätzlich {includedText(selected)} im Verbrauch · Preis bleibt {money(selected.price)}</>}</p>}
            </div>
          </>:<div className="empty-product-detail"><IconPackage size={38}/><h2>Noch keine Artikel</h2><p>Lege den ersten Artikel an, um ihn an der Kasse zu verkaufen.</p><button onClick={()=>create(false)}><IconPlus size={19}/> Ersten Artikel anlegen</button></div>}
        </section>
      </div>
    </>}
  </section>;
}
