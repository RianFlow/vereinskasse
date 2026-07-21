"use client";

import { useEffect, useMemo, useState } from "react";

type Product = { id: number; name: string; price: number; icon: string; category: string; color: string };
type Cart = Record<number, number>;
type Member = { id: string; name: string; role: string; code: string; initials: string };
type Sale = { total: number; items: number; time: string; member?: string; memberId?: string; method?: string };

const members: Member[] = [
  { id: "M-1042", name: "Anna Becker", role: "Kassendienst", code: "VEREIN-1042", initials: "AB" },
  { id: "M-1088", name: "Tobias Klein", role: "Vorstand", code: "VEREIN-1088", initials: "TK" },
  { id: "M-1137", name: "Lea Wagner", role: "Helferin", code: "VEREIN-1137", initials: "LW" },
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

export default function Home() {
  const [products, setProducts] = useState<Product[]>(seed);
  const [cart, setCart] = useState<Cart>({});
  const [view, setView] = useState<"kasse" | "admin">("kasse");
  const [category, setCategory] = useState("Alle");
  const [sales, setSales] = useState<Sale[]>([]);
  const [paid, setPaid] = useState(false);
  const [identify, setIdentify] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("vereinskasse-data");
    if (saved) {
      const data = JSON.parse(saved);
      setProducts(data.products || seed); setSales(data.sales || []);
    }
  }, []);
  useEffect(() => { localStorage.setItem("vereinskasse-data", JSON.stringify({ products, sales })); }, [products, sales]);

  const total = useMemo(() => products.reduce((sum, p) => sum + p.price * (cart[p.id] || 0), 0), [cart, products]);
  const itemCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const categories = ["Alle", ...Array.from(new Set(products.map(p => p.category)))];
  const shown = category === "Alle" ? products : products.filter(p => p.category === category);

  const add = (id: number) => { setPaid(false); setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 })); };
  const change = (id: number, d: number) => setCart(c => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }));
  const checkout = (method: string) => {
    if (!itemCount) return;
    setIdentify(method);
  };
  const finishCheckout = (member: Member) => {
    setSales(s => [...s, { total, items: itemCount, time: new Date().toISOString(), member: member.name, memberId: member.id, method: identify || "Bar" }]);
    setCart({}); setPaid(true);
    setIdentify(null);
    setTimeout(() => setPaid(false), 3500);
  };

  return <main className="app">
    <header>
      <div className="brand"><span className="crest">V</span><div><strong>Vereinskasse</strong><small>SV Beispielhausen</small></div></div>
      <div className="header-actions"><span className="status"><i /> Kasse geöffnet</span><button className="mode" onClick={() => setView(view === "kasse" ? "admin" : "kasse")}>{view === "kasse" ? "⚙ Admin" : "← Zur Kasse"}</button></div>
    </header>

    {view === "kasse" ? <section className="pos">
      <div className="catalog">
        <div className="title-row"><div><p className="eyebrow">VERKAUF</p><h1>Was darf es sein?</h1></div><span className="date">Heute · Vereinsfest</span></div>
        <nav className="filters">{categories.map(c => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</nav>
        <div className="grid">{shown.map(p => <button className="product" key={p.id} onClick={() => add(p.id)} style={{ "--tile": p.color } as React.CSSProperties}>
          <span className="product-icon">{p.icon}</span><span className="product-name">{p.name}</span><span className="price">{money(p.price)}</span>{cart[p.id] ? <b className="badge">{cart[p.id]}</b> : null}
        </button>)}</div>
      </div>
      <aside className="cart">
        <div className="cart-head"><div><p className="eyebrow">AKTUELLER BON</p><h2>Bestellung</h2></div><button className="clear" onClick={() => setCart({})}>Leeren</button></div>
        <div className="cart-items">{itemCount === 0 ? <div className="empty"><span>🧾</span><strong>Noch nichts gewählt</strong><p>Tippe links auf einen Artikel.</p></div> : products.filter(p => cart[p.id]).map(p => <div className="line" key={p.id}><span className="mini">{p.icon}</span><div><strong>{p.name}</strong><small>{money(p.price)} · {cart[p.id]}×</small></div><div className="stepper"><button onClick={() => change(p.id, -1)}>−</button><span>{cart[p.id]}</span><button onClick={() => change(p.id, 1)}>+</button></div><b>{money(p.price * cart[p.id])}</b></div>)}</div>
        <div className="checkout"><div className="sum"><span>Gesamt <small>{itemCount} Artikel</small></span><strong>{money(total)}</strong></div><button className="pay cash" disabled={!itemCount} onClick={() => checkout("Bar")}>💶 Bar bezahlen</button><button className="pay paypal" disabled={!itemCount} onClick={() => checkout("PayPal")}>PayPal <span>Demo</span></button></div>
      </aside>
      {paid && <div className="toast">✓ Zahlung erfasst – Bon abgeschlossen</div>}
      {identify && <IdentityDialog method={identify} onClose={() => setIdentify(null)} onVerified={finishCheckout} />}
    </section> : <Admin products={products} setProducts={setProducts} sales={sales} />}
  </main>;
}

function IdentityDialog({ method, onClose, onVerified }: { method: string; onClose: () => void; onVerified: (m: Member) => void }) {
  const [mode, setMode] = useState<"nfc" | "qr" | "manual">("nfc");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("Karte oder Chip an den Leser halten");
  const verify = (value: string) => {
    const member = members.find(m => m.code.toLowerCase() === value.trim().toLowerCase() || m.id.toLowerCase() === value.trim().toLowerCase());
    if (member) { setMessage(`✓ ${member.name} erkannt`); setTimeout(() => onVerified(member), 350); }
    else if (value.length > 5) setMessage("Code nicht bekannt – bitte erneut versuchen");
  };
  const startNfc = async () => {
    try {
      const Reader = (window as unknown as { NDEFReader?: new () => { scan: () => Promise<void>; onreading: (e: { serialNumber?: string }) => void } }).NDEFReader;
      if (!Reader) { setMessage("Externer Leser bereit – Karte auflegen oder Kennung eingeben"); return; }
      const reader = new Reader(); await reader.scan(); setMessage("NFC aktiv – Chip jetzt auflegen"); reader.onreading = e => verify(e.serialNumber || "");
    } catch { setMessage("NFC konnte nicht gestartet werden. Kennung bitte eingeben."); }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="identity-card">
    <button className="modal-close" onClick={onClose}>×</button><div className="identity-icon">🔐</div><p className="eyebrow">BUCHUNG FREIGEBEN</p><h2>Identität bestätigen</h2><p className="identity-sub">Vor der Zahlung mit {method} muss ein berechtigtes Vereinsmitglied erkannt werden.</p>
    <div className="id-tabs"><button className={mode === "nfc" ? "active" : ""} onClick={() => setMode("nfc")}>◉ NFC</button><button className={mode === "qr" ? "active" : ""} onClick={() => setMode("qr")}>▦ QR-Code</button><button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>👤 Auswahl</button></div>
    {mode === "manual" ? <div className="member-list">{members.map(m => <button key={m.id} onClick={() => onVerified(m)}><span>{m.initials}</span><div><strong>{m.name}</strong><small>{m.id} · {m.role}</small></div><b>›</b></button>)}</div> : <div className="scanner"><div className="scan-rings"><i/><i/><span>{mode === "nfc" ? "◉" : "▦"}</span></div><strong>{message}</strong><small>{mode === "nfc" ? "Tablet-NFC oder externer Kartenleser" : "QR-Code vor die Kamera halten oder Kennung eingeben"}</small>{mode === "nfc" && <button className="scan-start" onClick={startNfc}>NFC-Leser starten</button>}<div className="code-entry"><input autoFocus placeholder="z. B. VEREIN-1042" value={code} onChange={e => {setCode(e.target.value);verify(e.target.value)}} /><button onClick={() => verify(code)}>Prüfen</button></div><button className="demo-scan" onClick={() => verify("VEREIN-1042")}>Demo: Annas {mode === "nfc" ? "Karte" : "QR-Code"} scannen</button></div>}
    <div className="privacy-note">🛡️ Mitgliedsnummer, Zeitpunkt und Zahlart werden der Buchung zugeordnet.</div>
  </div></div>;
}

function Admin({ products, setProducts, sales }: { products: Product[]; setProducts: (p: Product[]) => void; sales: Sale[] }) {
  const revenue = sales.reduce((s, x) => s + x.total, 0);
  const items = sales.reduce((s, x) => s + x.items, 0);
  const update = (id: number, field: "name" | "price", value: string) => setProducts(products.map(p => p.id === id ? { ...p, [field]: field === "price" ? Number(value) : value } : p));
  return <section className="admin">
    <div className="admin-title"><div><p className="eyebrow">ADMINBEREICH</p><h1>Guten Abend, Vorstand 👋</h1><p>Produkte pflegen und den heutigen Verkauf im Blick behalten.</p></div><button onClick={() => setProducts([...products, { id: Date.now(), name: "Neuer Artikel", price: 1, icon: "✨", category: "Sonstiges", color: "#a6a1d8" }])}>+ Artikel hinzufügen</button></div>
    <div className="stats"><article><span>Heutiger Umsatz</span><strong>{money(revenue)}</strong><small>seit Kassenöffnung</small></article><article><span>Verkäufe</span><strong>{sales.length}</strong><small>abgeschlossene Bons</small></article><article><span>Artikel verkauft</span><strong>{items}</strong><small>über alle Kategorien</small></article></div>
    <div className="admin-grid"><section className="panel products-panel"><div className="panel-head"><h2>Artikel & Preise</h2><span>{products.length} Artikel</span></div>{products.map(p => <div className="edit-row" key={p.id}><span className="mini big">{p.icon}</span><input aria-label="Artikelname" value={p.name} onChange={e => update(p.id, "name", e.target.value)} /><span className="cat">{p.category}</span><div className="price-input"><input aria-label="Preis" type="number" step="0.5" value={p.price} onChange={e => update(p.id, "price", e.target.value)} /><span>€</span></div><button className="delete" onClick={() => setProducts(products.filter(x => x.id !== p.id))}>×</button></div>)}</section>
      <aside className="panel settings"><h2>Kassen-Einstellungen</h2><label>Vereinsname<input defaultValue="SV Beispielhausen" /></label><label>Akzentfarbe<div className="colors"><i className="selected"/><i/><i/><i/></div></label><div className="integration"><div className="paypal-mark">P</div><div><strong>PayPal anbinden</strong><small>API-Zugangsdaten werden für den Livebetrieb ergänzt.</small></div><span className="demo-pill">Demo</span></div></aside>
    </div><section className="panel identity-admin"><div className="panel-head"><div><p className="eyebrow">ZUGANG & SICHERHEIT</p><h2>Mitgliederkarten</h2></div><button>+ Mitglied anlegen</button></div><div className="member-admin-grid">{members.map(m => <article key={m.id}><span>{m.initials}</span><div><strong>{m.name}</strong><small>{m.id} · {m.role}</small></div><em>● Aktiv</em></article>)}</div><div className="last-sales"><strong>Letzte zugeordnete Buchungen</strong>{sales.slice(-3).reverse().map((s,i) => <span key={i}>{s.member || "Ohne Zuordnung"}<b>{money(s.total)}</b></span>)}</div></section>
  </section>;
}
