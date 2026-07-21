"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { PricingPanel } from "./PricingPanel";

type Product = { id: number; name: string; price: number; memberPrice?:number|null; icon: string; category: string; color: string };
type Discount={id:string;name:string;percent:number;active:boolean};
type Cart = Record<number, number>;
type Member = { id: string; name: string; role: string; code?: string; initials: string;active?:boolean };
type Sale = { id?: string; total: number; items: number; time: string; member?: string; memberId?: string; method?: string };
type Allocation = { memberId: string; memberName: string; amount: number; kind: "anteil" | "runde" };
type RoundSpec = { id:string; sponsorId:string; sponsorName:string; label:string; totalUnits:number; maxPerMember:number };
type OpenRound = RoundSpec & { remaining:number; active:boolean; createdAt:string };
type ControlData={shift?:{id:string;opened_by_name:string;opened_at:string;opening_cash:number}|null;accounts:{memberId:string;memberName:string;balance:number;accountType?:string}[];accountEntries?:{id:string;memberId:string;memberName:string;saleId?:string;type:string;amount:number;note:string;createdAt:string;cartJson?:string}[];accountItems?:{memberId:string;saleId:string;productName:string;quantity:number;unitPrice:number;total:number}[];recent:{id:string;time:string;total:number;member:string;method:string;reversal_id?:string;reversal_reason?:string}[]};

const members: Member[] = [
  { id: "M-1042", name: "Anna Becker", role: "Kassendienst", initials: "AB" },
  { id: "M-1088", name: "Tobias Klein", role: "Vorstand", initials: "TK" },
  { id: "M-1137", name: "Lea Wagner", role: "Helferin", initials: "LW" },
  { id: "M-1201", name: "Tom Schneider", role: "Mitglied", initials: "TS" },
  { id: "M-1214", name: "Mia Roth", role: "Mitglied", initials: "MR" },
  { id: "M-1228", name: "Jonas Wolf", role: "Mitglied", initials: "JW" },
  { id: "M-1240", name: "Alex Meier", role: "Mitglied", initials: "AM" },
];

const seed: Product[] = [
  { id: 1, name: "Helles", price: 3, icon: "🍺", category: "Getränke", color: "#f4b942" },
  { id: 2, name: "Radler", price: 3, icon: "🍋", category: "Getränke", color: "#f7d66d" },
  { id: 3, name: "Cola", price: 2.5, icon: "🥤", category: "Getränke", color: "#d36b54" },
  { id: 4, name: "Wasser", price: 2, icon: "💧", category: "Getränke", color: "#73b6e6" },
  { id: 5, name: "Bratwurst", price: 4, icon: "🌭", category: "Essen", color: "#e68155" },
  { id: 6, name: "Pommes", price: 3.5, icon: "🍟", category: "Essen", color: "#f5c851" },
  { id: 7, name: "Kuchen", price: 2.5, icon: "🍰", category: "Essen", color: "#df9db4" },
  { id: 8, name: "Vereinsschal", price: 15, icon: "🧣", category: "Fanartikel", color: "#68a487" },
];

const money = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const MembersContext=createContext<Member[]>(members);

export default function Home() {
  const [products, setProducts] = useState<Product[]>(seed);
  const [cart, setCart] = useState<Cart>({});
  const [view, setView] = useState<"kasse" | "admin">("kasse");
  const [category, setCategory] = useState("Alle");
  const [sales, setSales] = useState<Sale[]>([]);
  const [paid, setPaid] = useState(false);
  const [identify, setIdentify] = useState<string | null>(null);
  const [operator, setOperator] = useState<Member | null>(null);
  const [storageState, setStorageState] = useState<"online" | "offline" | "loading">("loading");
  const [rounds,setRounds]=useState<OpenRound[]>([]);
  const [claimRound,setClaimRound]=useState<OpenRound|null>(null);
  const [adminPrompt,setAdminPrompt]=useState(false); const [adminUser,setAdminUser]=useState<Member|null>(null); const [control,setControl]=useState<ControlData>({accounts:[],recent:[]});
  const [discounts,setDiscounts]=useState<Discount[]>([]);const [memberPricing,setMemberPricing]=useState(false);
  const [darkMode,setDarkMode]=useState(true);
  const [activeMember,setActiveMember]=useState<Member|null>(null); const [memberPrompt,setMemberPrompt]=useState(false);
  const [listMember,setListMember]=useState<Member|null>(null);
  const [memberFinder,setMemberFinder]=useState(false); const [recentMemberIds,setRecentMemberIds]=useState<string[]>([]);
  const [accountsOpen,setAccountsOpen]=useState(false);
  const [changeToast,setChangeToast]=useState<number|null>(null);
  const [clubMembers,setClubMembers]=useState<Member[]>(members);
  const [operationMode,setOperationMode]=useState<"club"|"event">("club");
  const [moreActions,setMoreActions]=useState(false);
  const [recentProductIds,setRecentProductIds]=useState<number[]>([]);
  const loadControl=()=>fetch("/api/control").then(r=>r.json()).then(setControl).catch(()=>{});
  const loadMembers=()=>fetch("/api/members").then(r=>r.json()).then(d=>setClubMembers(d.members||[])).catch(()=>{});

  useEffect(() => {
    // Initialisierung aus gerätelokalen Einstellungen; fachliche Daten kommen anschließend vom Server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDarkMode(localStorage.getItem("vereinskasse-theme") !== "light");
    const remembered=sessionStorage.getItem("vereinskasse-active-member"); if(remembered)setActiveMember(members.find(m=>m.id===remembered)||null);
    setRecentMemberIds(JSON.parse(localStorage.getItem("vereinskasse-recent-members")||"[]"));
    setRecentProductIds(JSON.parse(localStorage.getItem("vereinskasse-recent-products")||"[]"));
    setOperationMode(localStorage.getItem("vereinskasse-operation-mode")==="event"?"event":"club");
    const saved = localStorage.getItem("vereinskasse-data");
    if (saved) {
      const data = JSON.parse(saved);
      setProducts(data.products || seed); setSales(data.sales || []);
    }
    fetch("/api/data").then(r => { if(!r.ok) throw new Error(); return r.json(); }).then(data => {
      setProducts(data.products || seed);setDiscounts(data.discounts||[]);setClubMembers(data.members||members);const remembered=sessionStorage.getItem("vereinskasse-active-member");if(remembered)setActiveMember((data.members||members).find((m:Member)=>m.id===remembered)||null); setSales(data.sales || []); setRounds(data.rounds || []); setStorageState("online"); loadControl();
      const pending = JSON.parse(localStorage.getItem("vereinskasse-pending") || "[]") as unknown[];
      return Promise.all(pending.map(async s=>{try{const r=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(s)});return r.ok?null:s}catch{return s}}));
    }).then(remaining=>{const pending=remaining.filter(Boolean);if(pending.length)localStorage.setItem("vereinskasse-pending",JSON.stringify(pending));else localStorage.removeItem("vereinskasse-pending")}).catch(() => setStorageState("offline"));
  }, []);
  useEffect(() => { localStorage.setItem("vereinskasse-data", JSON.stringify({ products, sales })); }, [products, sales]);
  useEffect(() => { localStorage.setItem("vereinskasse-theme", darkMode ? "dark" : "light"); }, [darkMode]);
  useEffect(() => { localStorage.setItem("vereinskasse-operation-mode",operationMode); }, [operationMode]);

  const activeDiscount=discounts.find(d=>d.active);const unitPrice=(p:Product)=>Math.round((memberPricing&&p.memberPrice!=null?p.memberPrice:p.price)*(1-(activeDiscount?.percent||0)/100)*100)/100;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const total = useMemo(() => products.reduce((sum, p) => sum + unitPrice(p) * (cart[p.id] || 0), 0), [cart, products,memberPricing,activeDiscount]);
  const itemCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const categories = ["Alle", ...Array.from(new Set(products.map(p => p.category)))];
  const shown = category === "Alle" ? products : products.filter(p => p.category === category);
  const quickProducts=[...recentProductIds.map(id=>products.find(p=>p.id===id)).filter((p):p is Product=>Boolean(p)),...products].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i).slice(0,4);
  const quickMemberIds=[...recentMemberIds,...control.accounts.slice().sort((a,b)=>Number(b.balance)-Number(a.balance)).map(a=>a.memberId)].filter((id,i,a)=>a.indexOf(id)===i).slice(0,6);

  const add = (id: number) => { if(operationMode==="club"&&!billingMember){setMemberFinder(true);return}setPaid(false);setChangeToast(null); setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 })); };
  const change = (id: number, d: number) => setCart(c => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }));
  const checkout = (method: string) => {
    if (!itemCount) return;
    setIdentify(method);
  };
  const saveProducts = (next: Product[]) => {
    setProducts(next); fetch("/api/data",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({products:next,operatorId:adminUser?.id})}).then(r=>{if(!r.ok)throw new Error();setStorageState("online")}).catch(()=>setStorageState("offline"));
  };
  const authorizeCheckout = (member: Member) => { if(!["Kassendienst","Vorstand"].includes(member.role)){alert("Dieses Mitglied hat keine Kassenberechtigung.");return}setActiveMember(null);sessionStorage.removeItem("vereinskasse-active-member");setOperator(member); };
  const selectMember=(member:Member|null)=>{setActiveMember(member);setMemberPrompt(false);if(member)sessionStorage.setItem("vereinskasse-active-member",member.id);else sessionStorage.removeItem("vereinskasse-active-member")};
  const billingMember=listMember||activeMember;
  const openBalance=control.accounts.reduce((sum,a)=>sum+Number(a.balance),0);
  const currentLines=()=>products.filter(p=>cart[p.id]).map(p=>({productId:p.id,productName:p.name,quantity:cart[p.id],unitPrice:unitPrice(p),total:Math.round(unitPrice(p)*cart[p.id]*100)/100}));
  const chooseListMember=(member:Member)=>{setListMember(member);setMemberFinder(false)};
  const rememberProducts=()=>{const ids=currentLines().map(l=>l.productId);const recent=[...ids,...recentProductIds].filter((id,i,a)=>a.indexOf(id)===i).slice(0,6);setRecentProductIds(recent);localStorage.setItem("vereinskasse-recent-products",JSON.stringify(recent))};
  const submitSale=async(sale:Record<string,unknown>)=>{try{const r=await fetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(sale)});if(!r.ok){const d=await r.json().catch(()=>({error:"Buchung abgelehnt"}));alert(d.error||"Buchung abgelehnt");return false}setStorageState("online");loadControl();return true}catch{const pending=JSON.parse(localStorage.getItem("vereinskasse-pending")||"[]");pending.push(sale);localStorage.setItem("vereinskasse-pending",JSON.stringify(pending));setStorageState("offline");return true}};
  const finishMemberCheckout=async()=>{if(!billingMember||!itemCount)return;const sale={id:crypto.randomUUID(),total,items:itemCount,time:new Date().toISOString(),member:billingMember.name,memberId:billingMember.id,method:listMember?"Vertrauensliste":"Mitgliedskonto",cart,lines:currentLines(),allocations:[{memberId:billingMember.id,memberName:billingMember.name,amount:total,kind:"anteil"}]};if(!await submitSale(sale))return;setSales(s=>[sale,...s]);const recent=[billingMember.id,...recentMemberIds.filter(id=>id!==billingMember.id)].slice(0,5);setRecentMemberIds(recent);localStorage.setItem("vereinskasse-recent-members",JSON.stringify(recent));rememberProducts();setCart({});setPaid(true);setTimeout(()=>setPaid(false),3500)};
  const finishCheckout = async(allocations: Allocation[], round?:RoundSpec, payment?:{tendered:number;changeDue:number}) => {
    if(!operator) return;
    const sale = { id: crypto.randomUUID(), total, items: itemCount, time: new Date().toISOString(), member: operator.name, memberId: operator.id, method: identify || "Mitgliedskonto", cart, lines:currentLines(), allocations, round, ...payment };
    if(!await submitSale(sale))return;setSales(s => [sale, ...s]);rememberProducts();
    setCart({}); setPaid(true);
    if(round)setRounds(r=>[{...round,remaining:round.totalUnits,active:true,createdAt:sale.time},...r]);
    if(payment)setChangeToast(payment.changeDue);setIdentify(null); setOperator(null);
    setTimeout(() => setPaid(false), 3500);
  };

  return <MembersContext.Provider value={clubMembers}><main className={`app ${darkMode ? "dark" : "light"}`}>
    <header>
      <div className="brand"><span className="crest">V</span><div><strong>Vereinskasse</strong><small>SV Beispielhausen</small></div></div>
      <div className="header-actions"><span className={`status ${storageState}`}><i /> {storageState === "online" ? "Zentral gespeichert" : storageState === "offline" ? "Offline · wird nachgereicht" : "Speicher wird verbunden"}</span>{view==="kasse"&&(activeMember?<button className="member-session" onClick={()=>setMemberPrompt(true)}><span>{activeMember.initials}</span><div><small>Angemeldet</small><strong>{activeMember.name}</strong></div></button>:<button className="member-login" onClick={()=>setMemberPrompt(true)}>◉ Mitglied anmelden</button>)}<button className="theme-toggle" onClick={()=>setDarkMode(v=>!v)} aria-label={darkMode ? "Hellen Modus einschalten" : "Dunklen Modus einschalten"} title={darkMode ? "Heller Modus" : "Darkmode"}>{darkMode ? "☀" : "☾"}</button><button className="mode" onClick={() => {if(view==="admin")setView("kasse");else setAdminPrompt(true)}}>{view === "kasse" ? "⚙ Admin" : "← Zur Kasse"}</button></div>
    </header>

    {view === "kasse" ? <section className="pos">
      <div className="catalog">
        <div className="title-row"><div><p className="eyebrow">VERKAUF</p><h1>{operationMode==="club"?"Vereinsabend":"Veranstaltung"}</h1></div><span className="date">Heute · {operationMode==="club"?"Anschreiben":"Gäste & Direktverkauf"}</span></div>
        <div className="operation-switch" aria-label="Betriebsart"><button className={operationMode==="club"?"active":""} onClick={()=>{setOperationMode("club");setMoreActions(false)}}><strong>Vereinsabend</strong><small>Mitglieder schreiben an</small></button><button className={operationMode==="event"?"active":""} onClick={()=>{setOperationMode("event");setMoreActions(false);setListMember(null)}}><strong>Veranstaltung</strong><small>Gäste zahlen direkt oder gesammelt</small></button></div>
        <div className="account-overview"><div className="account-overview-icon">€</div><div><small>OFFENE ZECHEN</small><strong>{money(openBalance)}</strong><span>{control.accounts.length} {control.accounts.length===1?"offenes Konto":"offene Konten"}</span></div><div className="account-preview">{control.accounts.slice(0,3).map(a=><span key={a.memberId}>{a.memberName.split(" · ").at(-1)} <b>{money(Number(a.balance))}</b></span>)}</div><button onClick={()=>setAccountsOpen(true)}>Alle anzeigen →</button></div>
        {operationMode==="club"&&<><div className={`selected-customer ${billingMember?"":"empty-customer"}`}><span className="avatar">{billingMember?.initials||"1"}</span><div><strong>{billingMember?.name||"Zuerst Mitglied wählen"}</strong><small>{billingMember?"Alle Artikel werden auf diese Person gebucht":"Danach einfach die gewünschten Artikel antippen"}</small></div>{billingMember&&<div className="balance"><small>Aktuell offen</small><b>{money(Number(control.accounts.find(a=>a.memberId===billingMember.id)?.balance||0))}</b></div>}<button onClick={()=>setMemberFinder(true)}>{billingMember?"Ändern":"Auswählen"}</button></div><div className="trust-list"><div><strong>Schnellzugriff</strong><small>Zuletzt verwendet und häufig offen</small></div><div className="trust-members">{quickMemberIds.map(id=>clubMembers.find(m=>m.id===id)).filter((m):m is Member=>Boolean(m)&&m.active!==false&&m.role==="Mitglied").map(m=><button key={m.id} className={billingMember?.id===m.id?"active":""} onClick={()=>chooseListMember(m)}><span>{m.initials}</span>{m.name.split(" ")[0]}</button>)}<button className="open-member-finder" onClick={()=>setMemberFinder(true)}>⌕ Alle Mitglieder</button></div></div></>}
        <div className="quick-products"><div><strong>Schnellwahl</strong><small>{recentProductIds.length?"Zuletzt gebucht":"Beliebte Artikel"}</small></div><div className="quick-product-row">{quickProducts.map(p=><button key={p.id} onClick={()=>add(p.id)}><span>{p.icon}</span>{p.name}<b>{money(unitPrice(p))}</b></button>)}</div></div>
        {operationMode==="club"&&!billingMember&&<div className="product-lock-hint">Bitte zuerst oben ein Mitglied auswählen. So landet nichts versehentlich auf der falschen Zeche.</div>}
        <nav className="filters">{categories.map(c => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}<button className={memberPricing?"active":""} onClick={()=>setMemberPricing(!memberPricing)}>♥ Mitglied</button>{activeDiscount&&<span className="discount-chip">−{activeDiscount.percent}% {activeDiscount.name}</span>}</nav>
        {rounds.some(r=>r.active&&r.remaining>0)&&<div className="open-rounds"><div className="rounds-title"><strong>🎉 Offene Runden</strong><small>Pro Mitglied gilt das festgelegte Limit</small></div>{rounds.filter(r=>r.active&&r.remaining>0).map(r=><button key={r.id} onClick={()=>setClaimRound(r)}><span>🎁</span><div><strong>{r.label}</strong><small>von {r.sponsorName} · max. {r.maxPerMember} pro Person</small></div><b>{r.remaining}<small> übrig</small></b></button>)}</div>}
        <div className="grid">{shown.map(p => <button className="product" key={p.id} onClick={() => add(p.id)} style={{ "--tile": p.color } as React.CSSProperties}>
          <span className="product-icon">{p.icon}</span><span className="product-name">{p.name}</span><span className="price">{money(unitPrice(p))}</span>{memberPricing&&p.memberPrice!=null&&<small className="old-price">statt {money(p.price)}</small>}{cart[p.id] ? <b className="badge">{cart[p.id]}</b> : null}
        </button>)}</div>
      </div>
      <aside className="cart">
        <div className="cart-head"><div><p className="eyebrow">AKTUELLER BON</p><h2>Bestellung</h2></div><button className="clear" onClick={() => setCart({})}>Leeren</button></div>
        <div className="cart-items">{itemCount === 0 ? <div className="empty"><span>🧾</span><strong>Noch nichts gewählt</strong><p>Tippe links auf einen Artikel.</p></div> : products.filter(p => cart[p.id]).map(p => <div className="line" key={p.id}><span className="mini">{p.icon}</span><div><strong>{p.name}</strong><small>{money(unitPrice(p))} · {cart[p.id]}×</small></div><div className="stepper"><button onClick={() => change(p.id, -1)}>−</button><span>{cart[p.id]}</span><button onClick={() => change(p.id, 1)}>+</button></div><b>{money(unitPrice(p) * cart[p.id])}</b></div>)}</div>
        <div className="checkout"><div className="sum"><span>Gesamt <small>{itemCount} Artikel</small></span><strong>{money(total)}</strong></div>{operationMode==="club"?<>{billingMember?<><div className="checkout-person"><span>{billingMember.initials}</span><div><small>Wird angeschrieben auf</small><strong>{billingMember.name}</strong></div><button onClick={()=>setMemberFinder(true)}>Ändern</button></div><button className="pay account-direct" disabled={!itemCount} onClick={finishMemberCheckout}>✓ Auf {billingMember.name.split(" ")[0]} buchen</button><p className="mode-primary-note">Keine weitere Bestätigung nötig</p></>:<button className="pay account-login" onClick={()=>setMemberFinder(true)}>1 · Mitglied auswählen</button>}</>:<><button className="pay cash" disabled={!itemCount} onClick={() => checkout("Bar")}>💶 Bar bezahlen</button><button className="pay guest-pay" disabled={!itemCount} onClick={() => checkout("Tageskonto")}>🎟 Auf Tageskonto sammeln</button></>}<div className="more-actions"><button className="more-toggle" onClick={()=>setMoreActions(v=>!v)}>{moreActions?"− Weniger anzeigen":"＋ Weitere Aktionen"}</button>{moreActions&&<div className="more-actions-panel">{operationMode==="club"&&<button className="pay cash" disabled={!itemCount} onClick={() => checkout("Bar")}>💶 Ausnahmsweise bar bezahlen</button>}<button className="pay split-pay" disabled={!itemCount} onClick={() => checkout("Mitgliedskonto")}>👥 Einkauf aufteilen oder Runde</button>{operationMode==="club"&&<button className="pay guest-pay" disabled={!itemCount} onClick={() => checkout("Tageskonto")}>🎟 Gast- oder Tageskonto</button>}<button className="pay paypal" disabled title="Zahlungsanbieter noch nicht verbunden">PayPal · noch nicht verbunden</button></div>}</div></div>
      </aside>
      {paid && <div className="toast">✓ Buchung erfasst{changeToast!==null?` · ${money(changeToast)} Rückgeld`:""}</div>}
      {identify && !operator && <IdentityDialog method={identify} onClose={() => setIdentify(null)} onVerified={authorizeCheckout} />}
      {operator && identify==="Tageskonto" && <GuestAccountDialog total={total} operator={operator} onClose={() => {setOperator(null);setIdentify(null)}} onConfirm={finishCheckout} />}
      {operator && identify==="Bar" && <CashPaymentDialog total={total} operator={operator} onClose={() => {setOperator(null);setIdentify(null)}} onConfirm={p=>finishCheckout([],undefined,p)} />}
      {operator && !["Tageskonto","Bar"].includes(identify||"") && <AllocationDialog total={total} operator={operator} onClose={() => {setOperator(null);setIdentify(null)}} onConfirm={finishCheckout} />}
      {claimRound&&<ClaimDialog round={claimRound} onClose={()=>setClaimRound(null)} onClaim={(member)=>{fetch("/api/rounds",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({roundId:claimRound.id,memberId:member.id,memberName:member.name})}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setRounds(rs=>rs.map(x=>x.id===claimRound.id?{...x,remaining:Number(d.round.remaining),active:Boolean(d.round.active)}:x));setClaimRound(null);setPaid(true);setTimeout(()=>setPaid(false),2500)}).catch(e=>alert(e.message))}}/>}
    </section> : <Admin products={products} setProducts={saveProducts} discounts={discounts} setDiscounts={d=>{setDiscounts(d);fetch("/api/data",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({discounts:d,operatorId:adminUser?.id})})}} sales={sales} storageState={storageState} adminUser={adminUser!} control={control} refresh={loadControl} refreshMembers={loadMembers} />}
    {adminPrompt&&<IdentityDialog method="Adminbereich" onClose={()=>setAdminPrompt(false)} onVerified={m=>{if(m.role!=="Vorstand"){alert("Der Adminbereich ist nur für den Vorstand freigegeben.");return}setActiveMember(null);sessionStorage.removeItem("vereinskasse-active-member");setAdminUser(m);setAdminPrompt(false);setView("admin");loadControl()}}/>}
    {memberPrompt&&<MemberSessionDialog current={activeMember} onClose={()=>setMemberPrompt(false)} onSelect={selectMember}/>}
    {memberFinder&&<MemberFinder current={listMember} onClose={()=>setMemberFinder(false)} onSelect={chooseListMember}/>}
    {accountsOpen&&<OpenAccountsDialog data={control.accounts} entries={control.accountEntries||[]} items={control.accountItems||[]} onClose={()=>setAccountsOpen(false)} onAdmin={()=>{setAccountsOpen(false);setAdminPrompt(true)}}/>}
  </main></MembersContext.Provider>;
}

function OpenAccountsDialog({data,entries,items,onClose,onAdmin}:{data:ControlData["accounts"];entries:NonNullable<ControlData["accountEntries"]>;items:NonNullable<ControlData["accountItems"]>;onClose:()=>void;onAdmin:()=>void}){const total=data.reduce((s,a)=>s+Number(a.balance),0);const [selected,setSelected]=useState<string|null>(null);const account=data.find(a=>a.memberId===selected);const history=entries.filter(e=>e.memberId===selected);const itemTotals=Object.values(Object.groupBy(items.filter(i=>i.memberId===selected),i=>i.productName)).map(rows=>({name:rows![0].productName,quantity:rows!.reduce((s,r)=>s+Number(r.quantity),0),total:rows!.reduce((s,r)=>s+Number(r.total),0)}));return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card open-accounts-card"><button className="modal-close" onClick={onClose}>×</button>{account?<><button className="back-accounts" onClick={()=>setSelected(null)}>← Alle offenen Zechen</button><p className="eyebrow">ZECHENDETAILS</p><h2>{account.memberName}</h2><div className="open-total"><span>Noch zu zahlen</span><strong>{money(Number(account.balance))}</strong><small>{history.length} Buchungen und Zahlungen</small></div><div className="item-summary">{itemTotals.map(i=><div key={i.name}><span>{i.quantity}× {i.name}</span><b>{money(i.total)}</b></div>)}</div><div className="account-history">{history.map(e=><div key={e.id}><span>{new Date(e.createdAt).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})} · {e.note}</span><b className={Number(e.amount)<0?"credit":""}>{Number(e.amount)<0?"−":""}{money(Math.abs(Number(e.amount)))}</b></div>)}</div></>:<><p className="eyebrow">ZWISCHENSTAND</p><h2>Offene Zechen</h2><div className="open-total"><span>Gesamt noch offen</span><strong>{money(total)}</strong><small>{data.length} Konten</small></div><div className="open-account-list">{data.map(a=><button key={a.memberId} onClick={()=>setSelected(a.memberId)}><span className="account-avatar">{a.accountType==="guest"?"G":a.memberName.split(" ").map(x=>x[0]).slice(0,2).join("")}</span><div><strong>{a.memberName}</strong><small>{a.accountType==="guest"?"Gast- / Tageskonto":"Mitgliedskonto"}</small></div><b>{money(Number(a.balance))}</b><em>Details ›</em></button>)}{!data.length&&<p>Aktuell sind keine Zechen offen.</p>}</div></>}<button className="manage-accounts" onClick={onAdmin}>Im Adminbereich abrechnen</button></div></div>}

function MemberFinder({current,onClose,onSelect}:{current:Member|null;onClose:()=>void;onSelect:(m:Member)=>void}){
  const members=useContext(MembersContext);const [query,setQuery]=useState("");const normalized=query.trim().toLocaleLowerCase("de-DE");const all=members.filter(m=>m.role==="Mitglied"&&m.active!==false).sort((a,b)=>a.name.localeCompare(b.name,"de"));const filtered=all.filter(m=>!normalized||(normalized.length===1?m.name.toLocaleLowerCase("de-DE").startsWith(normalized):m.name.toLocaleLowerCase("de-DE").includes(normalized)||m.id.toLowerCase().includes(normalized)));const groups=Object.entries(Object.groupBy(filtered,m=>m.name[0].toUpperCase()));
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card finder-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">DIGITALE STRICHLISTE</p><h2>Mitglied finden</h2><label className="member-search"><span>⌕</span><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name oder Mitgliedsnummer eingeben"/><small>{filtered.length} Treffer</small></label><div className="alphabet-bar">{"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(l=>all.some(m=>m.name.startsWith(l))).map(l=><button key={l} onClick={()=>setQuery(l)}>{l}</button>)}</div><div className="finder-results">{groups.map(([letter,people])=><section key={letter}><b>{letter}</b><div>{people!.map(m=><button key={m.id} className={current?.id===m.id?"active":""} onClick={()=>onSelect(m)}><span>{m.initials}</span><div><strong>{m.name}</strong><small>{m.id}</small></div><em>{current?.id===m.id?"Ausgewählt":"Auswählen"}</em></button>)}</div></section>)}{!filtered.length&&<p>Kein Mitglied gefunden. Bitte Schreibweise prüfen.</p>}</div></div></div>
}

function MemberSessionDialog({current,onClose,onSelect}:{current:Member|null;onClose:()=>void;onSelect:(m:Member|null)=>void}){
  if(!current)return <IdentityDialog method="Mitglied anmelden" onClose={onClose} onVerified={onSelect}/>;
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card session-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">AKTUELLES MITGLIED</p><div className="session-current"><span>{current.initials}</span><div><strong>{current.name}</strong><small>{current.id} · sicher angemeldet</small></div></div><p className="identity-sub">Einkäufe können ohne weitere Bestätigung direkt auf dieses Mitgliedskonto gebucht werden.</p><button className="session-logout" onClick={()=>{fetch("/api/identify",{method:"DELETE"});onSelect(null)}}>Abmelden / Person wechseln</button></div></div>
}

function IdentityDialog({ method, onClose, onVerified }: { method: string; onClose: () => void; onVerified: (m: Member) => void }) {
  const [mode, setMode] = useState<"nfc" | "qr" | "manual">("nfc");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("Karte oder Chip an den Leser halten");
  const verify = async(value: string) => {
    if(value.trim().length<5)return;setMessage("Kennung wird geprüft …");try{const r=await fetch("/api/identify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:value.trim()})});const d=await r.json();if(!r.ok)throw new Error(d.error);setMessage(`✓ ${d.member.name} erkannt`);setTimeout(()=>onVerified(d.member),350)}catch(e){setMessage(e instanceof Error?e.message:"Code nicht bekannt – bitte erneut versuchen")}
  };
  const startNfc = async () => {
    try {
      const Reader = (window as unknown as { NDEFReader?: new () => { scan: () => Promise<void>; onreading: (e: { serialNumber?: string }) => void } }).NDEFReader;
      if (!Reader) { setMessage("Externer Leser bereit – Karte auflegen oder Kennung eingeben"); return; }
      const reader = new Reader(); await reader.scan(); setMessage("NFC aktiv – Chip jetzt auflegen"); reader.onreading = e => verify(e.serialNumber || "");
    } catch { setMessage("NFC konnte nicht gestartet werden. Kennung bitte eingeben."); }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card">
    <button className="modal-close" onClick={onClose}>×</button><div className="identity-icon">🔐</div><p className="eyebrow">{method==="Mitglied anmelden"?"MITGLIED ANMELDEN":"BUCHUNG FREIGEBEN"}</p><h2>Identität bestätigen</h2><p className="identity-sub">{method==="Mitglied anmelden"?"Einmal mit Karte, NFC oder QR-Code anmelden. Danach sind Einkäufe direkt möglich.":`Vor der Zahlung mit ${method} muss ein berechtigtes Vereinsmitglied erkannt werden.`}</p>
    <div className="id-tabs"><button className={mode === "nfc" ? "active" : ""} onClick={() => setMode("nfc")}>◉ NFC</button><button className={mode === "qr" ? "active" : ""} onClick={() => setMode("qr")}>▦ QR-Code</button><button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>⌨ Kennung</button></div>
    <div className="scanner"><div className="scan-rings"><i/><i/><span>{mode === "nfc" ? "◉" : mode==="qr"?"▦":"⌨"}</span></div><strong>{message}</strong><small>{mode === "nfc" ? "Tablet-NFC oder externer Kartenleser" : mode==="qr"?"QR-Code scannen oder Kennung eingeben":"Mitgliedskennung sicher eingeben"}</small>{mode === "nfc" && <button className="scan-start" onClick={startNfc}>NFC-Leser starten</button>}<div className="code-entry"><input autoFocus placeholder="z. B. VEREIN-1042" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")verify(code)}} /><button onClick={() => verify(code)}>Prüfen</button></div><button className="demo-scan" onClick={() => verify(method==="Adminbereich"?"VEREIN-1088":method==="Mitglied anmelden"?"VEREIN-1201":"VEREIN-1042")}>Passende Demo-Kennung verwenden</button></div>
    <div className="privacy-note">🛡️ Mitgliedsnummer, Zeitpunkt und Zahlart werden der Buchung zugeordnet.</div>
  </div></div>;
}

function AllocationDialog({ total, operator, onClose, onConfirm }: { total:number; operator:Member; onClose:()=>void; onConfirm:(a:Allocation[],r?:RoundSpec)=>void }) {
  const members=useContext(MembersContext).filter(m=>m.role==="Mitglied"&&m.active!==false);
  const [mode,setMode]=useState<"single"|"equal"|"custom"|"round">("single");
  const [selected,setSelected]=useState<string[]>(["M-1201"]);
  const [amounts,setAmounts]=useState<Record<string,string>>({"M-1201":total.toFixed(2)});
  const [roundLabel,setRoundLabel]=useState("Getränk der Geburtstagsrunde");
  const [roundUnits,setRoundUnits]=useState(5);
  const [roundLimit,setRoundLimit]=useState(1);
  const toggle=(id:string)=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const allocations:Allocation[]=mode==="round"||mode==="single" ? [{memberId:selected[0]||members[0].id,memberName:members.find(m=>m.id===(selected[0]||members[0].id))!.name,amount:total,kind:mode==="round"?"runde":"anteil"}] : selected.map((id,i)=>({memberId:id,memberName:members.find(m=>m.id===id)!.name,amount:mode==="equal"?Math.round(((i===selected.length-1?total-(Math.floor(total*100/selected.length)/100)*(selected.length-1):Math.floor(total*100/selected.length)/100))*100)/100:Number(amounts[id]||0),kind:"anteil"}));
  const assigned=Math.round(allocations.reduce((s,a)=>s+a.amount,0)*100)/100; const valid=allocations.length>0&&Math.abs(assigned-total)<0.01;
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card allocation-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">MITGLIEDERKONTO</p><h2>Einkauf zuordnen</h2><p className="identity-sub">Freigegeben durch {operator.name}. Wer übernimmt die {money(total)}?</p>
    <div className="allocation-modes"><button className={mode==="single"?"active":""} onClick={()=>setMode("single")}>Eine Person</button><button className={mode==="equal"?"active":""} onClick={()=>setMode("equal")}>Gleichmäßig</button><button className={mode==="custom"?"active":""} onClick={()=>setMode("custom")}>Eigene Anteile</button><button className={mode==="round"?"active":""} onClick={()=>setMode("round")}>🎂 Runde</button></div>
    {mode==="round"&&<div className="round-note"><strong>Eine Person eröffnet eine begrenzte Runde</strong><small>Jedes Mitglied kann später nur bis zum persönlichen Limit darauf buchen.</small><label>Bezeichnung<input value={roundLabel} onChange={e=>setRoundLabel(e.target.value)}/></label><div className="round-fields"><label>Getränke / Artikel<input type="number" min="1" value={roundUnits} onChange={e=>setRoundUnits(Math.max(1,Number(e.target.value)))}/></label><label>Max. pro Mitglied<input type="number" min="1" value={roundLimit} onChange={e=>setRoundLimit(Math.max(1,Number(e.target.value)))}/></label></div></div>}
    <div className="allocation-members">{members.filter(m=>m.role==="Mitglied").map(m=>{const active=selected.includes(m.id);return <button key={m.id} className={active?"active":""} onClick={()=>{if(mode==="single"||mode==="round")setSelected([m.id]);else toggle(m.id)}}><span>{m.initials}</span><div><strong>{m.name}</strong><small>{m.id}</small></div>{active&&mode==="custom"?<input aria-label={`Anteil ${m.name}`} type="number" step="0.01" value={amounts[m.id]||""} onClick={e=>e.stopPropagation()} onChange={e=>setAmounts({...amounts,[m.id]:e.target.value})}/>:<b>{active?"✓":"+"}</b>}</button>})}</div>
    <div className={`allocation-total ${valid?"ok":"bad"}`}><span>Zugeordnet<strong>{money(assigned)}</strong></span><span>Noch offen<strong>{money(Math.max(0,total-assigned))}</strong></span></div>
    <button className="confirm-allocation" disabled={!valid||mode==="round"&&!roundLabel.trim()} onClick={()=>onConfirm(allocations,mode==="round"?{id:crypto.randomUUID(),sponsorId:allocations[0].memberId,sponsorName:allocations[0].memberName,label:roundLabel.trim(),totalUnits:roundUnits,maxPerMember:roundLimit}:undefined)}>{mode==="round"?`Runde mit ${roundUnits} Einheiten eröffnen`:"Aufteilung übernehmen"}</button>
  </div></div>;
}

function ClaimDialog({round,onClose,onClaim}:{round:OpenRound;onClose:()=>void;onClaim:(m:Member)=>void}){
  const [code,setCode]=useState("");const [message,setMessage]=useState("Mitgliedskarte oder QR-Code verwenden");const verify=async()=>{try{const r=await fetch("/api/identify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code})});const d=await r.json();if(!r.ok)throw new Error(d.error);onClaim(d.member)}catch(e){setMessage(e instanceof Error?e.message:"Kennung ungültig")}};
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card"><button className="modal-close" onClick={onClose}>×</button><div className="identity-icon">🎁</div><p className="eyebrow">RUNDE EINLÖSEN</p><h2>{round.label}</h2><p className="identity-sub">Noch {round.remaining} verfügbar · höchstens {round.maxPerMember} pro Mitglied. {message}</p><div className="code-entry"><input autoFocus placeholder="Karte oder QR-Kennung" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")verify()}}/><button onClick={verify}>Prüfen</button></div></div></div>
}

function GuestAccountDialog({total,operator,onClose,onConfirm}:{total:number;operator:Member;onClose:()=>void;onConfirm:(a:Allocation[])=>void}){
  const [name,setName]=useState(""); const [reference,setReference]=useState("Turniergäste");
  const clean=(name.trim()||reference.trim()).replace(/[^a-zA-Z0-9äöüÄÖÜß -]/g,"").slice(0,50);
  const id=`GAST-${new Date().toISOString().slice(0,10)}-${clean.toUpperCase().replace(/\s+/g,"-")}`;
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card guest-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">SPÄTER BEZAHLEN</p><h2>Gast- oder Tageskonto</h2><p className="identity-sub">Die {money(total)} werden gesammelt und können am Tagesende ganz oder teilweise bezahlt werden. Freigegeben durch {operator.name}.</p><label>Veranstaltung / Gruppe<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="z. B. Sommerturnier"/></label><label>Name oder Tischnummer<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="z. B. Tisch 4 oder Familie Meier"/></label><div className="guest-summary"><span>Wird gebucht auf</span><strong>{name.trim()||reference.trim()||"–"}</strong><b>{money(total)}</b></div><button className="confirm-allocation" disabled={!clean} onClick={()=>onConfirm([{memberId:id,memberName:`${reference.trim()} · ${name.trim()||"Sammelkonto"}`,amount:total,kind:"anteil"}])}>Auf Tageskonto buchen</button></div></div>
}

function CashPaymentDialog({total,operator,onClose,onConfirm}:{total:number;operator:Member;onClose:()=>void;onConfirm:(p:{tendered:number;changeDue:number})=>void}){
  const [received,setReceived]=useState(total.toFixed(2));const tendered=Number(received.replace(",","."))||0;const change=Math.max(0,Math.round((tendered-total)*100)/100);const quick=[5,10,20,50,100].filter(v=>v>=total).slice(0,4);
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card cash-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">BARZAHLUNG</p><h2>Rückgeld berechnen</h2><p className="identity-sub">Kassendienst: {operator.name}</p><div className="cash-due"><span>Zu zahlen</span><strong>{money(total)}</strong></div><label className="cash-received">Erhaltener Betrag<div><input autoFocus inputMode="decimal" value={received} onChange={e=>setReceived(e.target.value)} onFocus={e=>e.currentTarget.select()}/><span>€</span></div></label><div className="cash-quick"><button onClick={()=>setReceived(total.toFixed(2))}>Passend</button>{quick.map(v=><button key={v} onClick={()=>setReceived(String(v))}>{v} €</button>)}</div><div className={`change-display ${tendered>=total?"valid":"invalid"}`}><span>Rückgeld</span><strong>{money(change)}</strong>{tendered<total&&<small>Noch {money(total-tendered)} fehlen</small>}</div><button className="confirm-cash" disabled={tendered<total} onClick={()=>onConfirm({tendered,changeDue:change})}>Barzahlung bestätigen</button></div></div>
}

function Admin({ products, setProducts,discounts,setDiscounts, sales, storageState,adminUser,control,refresh,refreshMembers }: { products: Product[]; setProducts: (p: Product[]) => void;discounts:Discount[];setDiscounts:(d:Discount[])=>void; sales: Sale[]; storageState:string;adminUser:Member;control:ControlData;refresh:()=>void;refreshMembers:()=>void }) {
  const members=useContext(MembersContext);const memberAction=async(body:Record<string,unknown>)=>{const r=await fetch("/api/members",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)alert(d.error);else refreshMembers()};const addMember=()=>{const name=prompt("Vor- und Nachname");if(!name)return;const role=prompt("Rolle: Mitglied, Helferin, Kassendienst oder Vorstand","Mitglied");if(!role)return;const code=prompt("Neue geheime Karten-/QR-Kennung (mindestens 6 Zeichen)");if(code)memberAction({action:"create",name,role,code})};
  const revenue = sales.reduce((s, x) => s + x.total, 0);
  const items = sales.reduce((s, x) => s + x.items, 0);
  const update = (id: number, field: "name" | "price", value: string) => setProducts(products.map(p => p.id === id ? { ...p, [field]: field === "price" ? Number(value) : value } : p));
  return <section className="admin">
    <PricingPanel products={products} setProducts={setProducts} discounts={discounts} setDiscounts={setDiscounts}/>
    <div className="admin-title"><div><p className="eyebrow">ADMINBEREICH</p><h1>Guten Abend, Vorstand 👋</h1><p>Produkte pflegen und den heutigen Verkauf im Blick behalten.</p></div><div className="admin-actions"><a href="/api/export">↓ Prüfexport</a><button onClick={async()=>{const r=await fetch("/api/backup",{method:"POST"});const d=await r.json();alert(r.ok?`Sicherung geprüft · ${Math.round(d.size/1024)} KB`:d.error)}}>↻ Sicherung</button><button onClick={() => setProducts([...products, { id: Date.now(), name: "Neuer Artikel", price: 1, icon: "✨", category: "Sonstiges", color: "#a6a1d8" }])}>+ Artikel hinzufügen</button></div></div>
    <div className="stats"><article><span>Heutiger Umsatz</span><strong>{money(revenue)}</strong><small>seit Kassenöffnung</small></article><article><span>Verkäufe</span><strong>{sales.length}</strong><small>abgeschlossene Bons</small></article><article><span>Artikel verkauft</span><strong>{items}</strong><small>über alle Kategorien</small></article></div>
    <div className="admin-grid"><section className="panel products-panel"><div className="panel-head"><h2>Artikel & Preise</h2><span>{products.length} Artikel</span></div>{products.map(p => <div className="edit-row" key={p.id}><span className="mini big">{p.icon}</span><input aria-label="Artikelname" value={p.name} onChange={e => update(p.id, "name", e.target.value)} /><span className="cat">{p.category}</span><div className="price-input"><input aria-label="Preis" type="number" step="0.5" value={p.price} onChange={e => update(p.id, "price", e.target.value)} /><span>€</span></div><button className="delete" onClick={() => setProducts(products.filter(x => x.id !== p.id))}>×</button></div>)}</section>
      <aside className="panel settings"><h2>Kassen-Einstellungen</h2><label>Vereinsname<input defaultValue="SV Beispielhausen" /></label><label>Akzentfarbe<div className="colors"><i className="selected"/><i/><i/><i/></div></label><div className="integration"><div className="paypal-mark">P</div><div><strong>PayPal anbinden</strong><small>API-Zugangsdaten werden für den Livebetrieb ergänzt.</small></div><span className="demo-pill">Demo</span></div></aside>
    </div><ControlPanel user={adminUser} data={control} refresh={refresh}/><section className="panel identity-admin"><div className="panel-head"><div><p className="eyebrow">ZUGANG & SICHERHEIT</p><h2>Mitgliederkarten</h2></div><button onClick={addMember}>+ Mitglied anlegen</button></div><div className="backup-banner"><span>✓</span><div><strong>Zentrale Speicherung + zweite Sicherung</strong><small>{storageState === "online" ? "Jede Buchung liegt in der Datenbank und zusätzlich im Sicherungsspeicher." : "Offline-Buchungen werden auf diesem Tablet vorgemerkt und automatisch übertragen."}</small></div></div><div className="member-admin-grid">{members.map(m => <article key={m.id} className={m.active===false?"inactive":""}><span>{m.initials}</span><div><strong>{m.name}</strong><small>{m.id} · {m.role}</small></div><button onClick={()=>{if(confirm(`${m.name} ${m.active===false?"aktivieren":"deaktivieren"}?`))memberAction({action:"toggle",id:m.id})}}>{m.active===false?"Aktivieren":"Deaktivieren"}</button></article>)}</div><div className="last-sales"><strong>Letzte zugeordnete Buchungen</strong>{sales.slice(0,3).map((s,i) => <span key={i}>{s.member || "Ohne Zuordnung"}<b>{money(s.total)}</b></span>)}</div></section>
  </section>;
}

function ControlPanel({user,data,refresh}:{user:Member;data:ControlData;refresh:()=>void}){
  const [paymentAccount,setPaymentAccount]=useState<ControlData["accounts"][number]|null>(null);
  const act=async(body:Record<string,unknown>)=>{const r=await fetch("/api/control",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,operatorId:user.id})});const d=await r.json();if(!r.ok){alert(d.error);return false}if(d.expected!==undefined)alert(`Soll: ${money(d.expected)} · Differenz: ${money(d.difference)}`);if(d.changeDue!==undefined)alert(`${money(d.changeDue)} Rückgeld · ${money(d.remaining)} verbleiben offen`);refresh();return true};
  return <><section className="control-grid"><article className="panel"><p className="eyebrow">KASSENSCHICHT</p><h2>{data.shift?"Kasse geöffnet":"Kasse geschlossen"}</h2>{data.shift?<><p>Eröffnet von {data.shift.opened_by_name}<br/>Anfangsbestand {money(data.shift.opening_cash)}</p><button onClick={()=>{const v=prompt("Gezählter Barbestand in Euro");if(v)act({action:"close",countedCash:Number(v.replace(",","."))})}}>Kassenabschluss durchführen</button></>:<button onClick={()=>{const v=prompt("Anfangsbestand in Euro","100");if(v)act({action:"open",openingCash:Number(v.replace(",","."))})}}>Kasse eröffnen</button>}</article><article className="panel accounts-panel"><p className="eyebrow">SPÄTER BEZAHLEN</p><h2>Offene Konten</h2>{data.accounts.length?data.accounts.map(a=><div key={a.memberId}><span><em className={`account-kind ${a.accountType}`}>{a.accountType==="guest"?"Tageskonto":"Mitglied"}</em>{a.memberName}</span><b>{money(Number(a.balance))}</b><button onClick={()=>setPaymentAccount(a)}>Bezahlen</button></div>):<p>Keine offenen Mitglieds- oder Tageskonten.</p>}</article><article className="panel recent-panel"><p className="eyebrow">KORREKTUREN</p><h2>Letzte Buchungen</h2>{data.recent.slice(0,6).map(s=><div key={s.id} className={s.reversal_id?"reversed":""}><span>{new Date(s.time).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})} · {s.method}<small>{s.member}</small></span><b>{money(s.total)}</b>{s.reversal_id?<em>Storniert</em>:<button onClick={()=>{const reason=prompt("Stornogrund");if(reason)act({action:"reverse",saleId:s.id,reason})}}>Storno</button>}<a href={`/api/receipt?id=${encodeURIComponent(s.id)}`} target="_blank">Beleg</a></div>)}</article></section>{paymentAccount&&<AccountPaymentDialog account={paymentAccount} onClose={()=>setPaymentAccount(null)} onConfirm={async p=>{if(await act({action:"payment",memberId:paymentAccount.memberId,memberName:paymentAccount.memberName,...p}))setPaymentAccount(null)}}/>}</>
}

function AccountPaymentDialog({account,onClose,onConfirm}:{account:ControlData["accounts"][number];onClose:()=>void;onConfirm:(p:{amount:number;paymentMethod:string;tendered:number})=>void}){const balance=Number(account.balance);const [amountText,setAmountText]=useState(balance.toFixed(2));const [receivedText,setReceivedText]=useState(balance.toFixed(2));const amount=Math.min(balance,Number(amountText.replace(",","."))||0),received=Number(receivedText.replace(",","."))||0,change=Math.max(0,Math.round((received-amount)*100)/100);return <div className="modal-backdrop"><div className="identity-card cash-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">KONTO ABRECHNEN</p><h2>{account.memberName}</h2><div className="cash-due"><span>Offene Zeche</span><strong>{money(balance)}</strong></div><label className="cash-received">Jetzt bezahlen<div><input value={amountText} onChange={e=>{setAmountText(e.target.value);setReceivedText(e.target.value)}}/><span>€</span></div></label><label className="cash-received">Bargeld erhalten<div><input value={receivedText} onChange={e=>setReceivedText(e.target.value)}/><span>€</span></div></label><div className={`change-display ${received>=amount&&amount>0?"valid":"invalid"}`}><span>Rückgeld</span><strong>{money(change)}</strong><small>Danach noch offen: {money(Math.max(0,balance-amount))}</small></div><button className="confirm-cash" disabled={amount<=0||received<amount} onClick={()=>onConfirm({amount,paymentMethod:"Bar",tendered:received})}>Zahlung bestätigen</button></div></div>}
