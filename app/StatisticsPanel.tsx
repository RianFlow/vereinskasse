"use client";

import { useEffect, useMemo, useState } from "react";
import {startLivePolling,editingForm} from "./live-poll.mjs";
import { IconChartBar, IconClock, IconCrown, IconReceiptEuro, IconShoppingBag, IconUsers } from "@tabler/icons-react";

type StatisticProduct={productId:number;productName:string};
type StatisticProductValue=StatisticProduct&{quantity:number;revenue:number};
type StatisticsData={
  period:{days:number;from:string;to:string;label:string};ranking:{mode:"period"|"all";label:string};selectedProduct:StatisticProduct|null;
  summary:{revenue:number;sales:number;items:number;members:number};previous:{revenue:number;sales:number;items:number};changes:{revenue:number|null;sales:number|null;items:number|null};
  trend:{label:string;revenue:number;items:number;sales:number}[];products:StatisticProduct[];topProducts:StatisticProductValue[];lowProducts:StatisticProductValue[];
  memberRanking:{memberId:string;memberName:string;quantity:number;estimated:boolean}[];paymentMethods:{method:string;revenue:number;sales:number}[];peakHours:{hour:number;label:string;sales:number}[];note:string;
};

const money=(value:number)=>value.toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const quantity=(value:number)=>value.toLocaleString("de-DE",{maximumFractionDigits:2});
const methodLabel=(method:string)=>method==="Vertrauensliste"?"Monatsrechnung":method||"Sonstige";
const deltaLabel=(value:number|null)=>value===null?"neu":`${value>0?"+":""}${value.toLocaleString("de-DE",{maximumFractionDigits:1})} %`;

export function StatisticsPanel(){
  const [days,setDays]=useState(90),[productId,setProductId]=useState(""),[rankingMode,setRankingMode]=useState<"period"|"all">("period");
  const requestKey=`${days}:${productId}:${rankingMode}`;
  const [result,setResult]=useState<{key:string;data:StatisticsData|null;error:string}>({key:"",data:null,error:""});
  const data=result.data,loading=result.key!==requestKey,error=result.key===requestKey?result.error:"";
  useEffect(()=>startLivePolling({interval:5000,allowed:()=>!editingForm(),
    load:async(signal:AbortSignal)=>{const params=new URLSearchParams({days:String(days),ranking:rankingMode});if(productId)params.set("productId",productId);const response=await fetch(`/api/statistics?${params}`,{signal,cache:"no-store"}),body=await response.json();if(!response.ok)throw new Error(body.error||"Statistiken konnten nicht geladen werden.");if(signal.aborted||editingForm())return false;setResult({key:requestKey,data:body,error:""});},
    onError:(reason:unknown)=>setResult(current=>({key:requestKey,data:current.key===requestKey?current.data:null,error:reason instanceof Error?reason.message:"Verbindung unterbrochen. Angezeigte Statistik kann veraltet sein."}))
  }),[days,productId,rankingMode,requestKey]);
  const maxTrend=useMemo(()=>Math.max(1,...(data?.trend.map(row=>row.revenue)||[])),[data]);
  const maxProduct=useMemo(()=>Math.max(1,...(data?.topProducts.map(row=>row.quantity)||[])),[data]);
  const maxMember=useMemo(()=>Math.max(1,...(data?.memberRanking.map(row=>row.quantity)||[])),[data]);
  if(error&&!data)return <section className="panel statistics-error" role="alert"><strong>Auswertung nicht verfügbar</strong><span>{error}</span><button onClick={()=>setDays(current=>current===90?30:90)}>Erneut laden</button></section>;
  return <section className={`statistics-dashboard ${loading?"loading":""}`} aria-busy={loading}>
    <div className="statistics-toolbar"><div><p className="eyebrow">VERKAUF & VERBRAUCH</p><h2>Zahlen, die wirklich helfen</h2><small>Stornierte Buchungen werden automatisch ausgeschlossen.</small></div><div className="statistics-period" aria-label="Auswertungszeitraum">{[30,90,365].map(value=><button key={value} className={days===value?"active":""} onClick={()=>setDays(value)}>{value===365?"1 Jahr":`${value} Tage`}</button>)}</div></div>
    {error&&data&&<p role="status">Datenabgleich unterbrochen: {error} Automatischer Neuversuch läuft.</p>}
    {loading&&!data&&<div className="statistics-skeleton">Statistiken werden berechnet …</div>}
    {data&&<>
      <div className="statistics-kpis">
        <article><span><IconReceiptEuro size={20}/> Umsatz</span><strong>{money(data.summary.revenue)}</strong><small className={(data.changes.revenue||0)>=0?"positive":"negative"}>{deltaLabel(data.changes.revenue)} zum Zeitraum davor</small></article>
        <article><span><IconShoppingBag size={20}/> Buchungen</span><strong>{data.summary.sales}</strong><small className={(data.changes.sales||0)>=0?"positive":"negative"}>{deltaLabel(data.changes.sales)} zum Zeitraum davor</small></article>
        <article><span><IconChartBar size={20}/> Verbrauch</span><strong>{quantity(data.summary.items)} Stück</strong><small className={(data.changes.items||0)>=0?"positive":"negative"}>{deltaLabel(data.changes.items)} zum Zeitraum davor</small></article>
        <article><span><IconUsers size={20}/> Mitglieder</span><strong>{data.summary.members}</strong><small>mit Buchung im Zeitraum</small></article>
      </div>
      <section className="panel statistics-trend-panel"><header><div><p className="eyebrow">UMSATZVERLAUF</p><h3>{data.period.label}</h3></div><strong>{money(data.summary.revenue)}</strong></header><div className="statistics-trend" role="img" aria-label={`Umsatzverlauf für ${data.period.label}`}>{data.trend.map((row,index)=><div className="statistics-trend-column" key={`${row.label}-${index}`} title={`${row.label}: ${money(row.revenue)}, ${quantity(row.items)} Artikel`}><b style={{height:`${Math.max(4,row.revenue/maxTrend*100)}%`}}/><span>{row.label}</span></div>)}</div></section>
      <div className="statistics-grid">
        <section className="panel statistics-ranking products-ranking"><header><div><p className="eyebrow">SORTIMENT</p><h3>Am häufigsten gebucht</h3></div><span>nach Menge</span></header><div className="statistics-bars">{data.topProducts.filter(row=>row.quantity>0).map((product,index)=><article key={product.productId}><b>{index+1}</b><div><span><strong>{product.productName}</strong><em>{quantity(product.quantity)}× · {money(product.revenue)}</em></span><i><u style={{width:`${product.quantity/maxProduct*100}%`}}/></i></div></article>)}{!data.topProducts.some(row=>row.quantity>0)&&<p>Noch keine Verbrauchsdaten im gewählten Zeitraum.</p>}</div></section>
        <section className="panel statistics-ranking member-ranking"><header><div><p className="eyebrow">SPAẞ-RANGLISTE</p><h3>{data.selectedProduct?`${data.selectedProduct.productName}-Rangliste`:"Mitglieder-Rangliste"}</h3></div><IconCrown size={28}/></header><div className="statistics-ranking-controls"><label>Artikel<select value={productId} onChange={event=>setProductId(event.target.value)}><option value="">Alle Artikel</option>{data.products.map(product=><option key={product.productId} value={product.productId}>{product.productName}</option>)}</select></label><div><button className={rankingMode==="period"?"active":""} onClick={()=>setRankingMode("period")}>{days===365?"1 Jahr":`${days} Tage`}</button><button className={rankingMode==="all"?"active":""} onClick={()=>setRankingMode("all")}>Ewige Rangliste</button></div></div><ol>{data.memberRanking.map((member,index)=><li key={member.memberId}><b>{index<3?["🥇","🥈","🥉"][index]:index+1}</b><div><span><strong>{member.memberName}</strong>{index===0&&data.selectedProduct&&<small>{data.selectedProduct.productName}-Spitze</small>}</span><i><u style={{width:`${member.quantity/maxMember*100}%`}}/></i></div><em>{quantity(member.quantity)}×{member.estimated?"*":""}</em></li>)}{!data.memberRanking.length&&<li className="statistics-empty">Für diese Auswahl gibt es noch keine Mitgliederbuchung.</li>}</ol><p className="statistics-ranking-note">{data.note} Das ist eine lockere Vereinsstatistik – kein Nachweis darüber, wer etwas tatsächlich getrunken hat.</p></section>
        <section className="panel statistics-secondary"><header><div><p className="eyebrow">ZAHLUNGSARTEN</p><h3>Wie wurde bezahlt?</h3></div></header><div className="statistics-payment-list">{data.paymentMethods.map(method=><article key={method.method}><span><strong>{methodLabel(method.method)}</strong><small>{method.sales} Buchungen</small></span><b>{money(method.revenue)}</b></article>)}{!data.paymentMethods.length&&<p>Noch keine Zahlungen im Zeitraum.</p>}</div><div className="statistics-peak"><h4><IconClock size={18}/> Stärkste Zeiten</h4>{data.peakHours.map((hour,index)=><span key={hour.hour}><b>{index+1}</b>{hour.label}<em>{hour.sales} Buchungen</em></span>)}{!data.peakHours.length&&<small>Noch keine Zeitdaten vorhanden.</small>}</div></section>
        <section className="panel statistics-secondary low-products"><header><div><p className="eyebrow">EINKAUFSHILFE</p><h3>Selten gebucht</h3></div></header><p>Diese Artikel solltest du beim nächsten Einkauf besonders prüfen.</p><div>{data.lowProducts.map(product=><article key={product.productId}><strong>{product.productName}</strong><span>{quantity(product.quantity)}×</span><small>{money(product.revenue)}</small></article>)}</div></section>
      </div>
    </>}
  </section>;
}
