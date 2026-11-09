"use client";

import { useState } from "react";
import { IconCheck, IconSearch, IconX } from "@tabler/icons-react";
import { distributeShares, euroText, parseEuroCents, validateShares, type SplitPart } from "./tablet-cash-model";

type Person = { id: string; name: string; initials?: string; type?: string; parentId?: string | null };
type Unit = { key: string; name: string; cents: number };
type Props = { people: Person[]; selectedId?: string; totalCents: number; units: Unit[]; disabled: boolean; onClose: () => void; onConfirm: (shares: { memberId: string; memberName: string; amount: number; kind: string }[]) => void };
const money = (cents: number) => (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export function TabletCashSplit({ people, selectedId, totalCents, units, disabled, onClose, onConfirm }: Props) {
  const [parts, setParts] = useState<SplitPart[]>(() => selectedId && people.some(person => person.id === selectedId) ? [{ id: selectedId, cents: totalCents, text: euroText(totalCents), fixed: false }] : []);
  const [query, setQuery] = useState(""), [kind, setKind] = useState<"amount" | "items">("amount"), [owners, setOwners] = useState<Record<string, string>>({});
  const names = new Map(people.map(person => [person.id, person]));
  const shared = distributeShares(parts, totalCents);
  const itemParts = shared.map(part => ({ ...part, cents: units.filter(unit => owners[unit.key] === part.id).reduce((sum, unit) => sum + unit.cents, 0) }));
  const actual = kind === "items" ? itemParts : shared;
  const status = validateShares(shared, totalCents);
  const accountsAvailable = parts.every(part => names.has(part.id));
  const ready = kind === "items" ? accountsAvailable && parts.length > 0 && units.filter(unit => unit.cents > 0).every(unit => parts.some(part => part.id === owners[unit.key])) && itemParts.reduce((sum, part) => sum + part.cents, 0) === totalCents : accountsAvailable && status.valid;
  const message = !accountsAvailable ? "Ein Konto ist nicht mehr verfügbar" : kind === "items" ? ready ? "Alle Artikel zugeordnet" : "Artikel einer Person zuordnen" : parts.length < 2 ? parts.length ? "Noch eine Person auswählen" : "Personen auswählen" : status.invalid ? "Bitte einen gültigen Betrag eingeben" : status.remaining > 0 ? `Noch ${money(status.remaining)} verteilen` : status.remaining < 0 ? `${money(-status.remaining)} zu viel verteilt` : !status.valid ? "Jeder Anteil muss größer als 0,00 € sein" : "Alles verteilt";
  const toggle = (id: string) => setParts(current => current.some(part => part.id === id) ? current.filter(part => part.id !== id) : current.length >= 100 ? current : [...current, { id, cents: 0, text: "0,00", fixed: false }]);
  const confirm = () => { if (!disabled && ready) onConfirm(actual.filter(part => Number(part.cents) > 0).map(part => ({ memberId: part.id, memberName: names.get(part.id)!.name, amount: Number(part.cents) / 100, kind: "anteil" }))); };

  return <>
    <div className="tc5-split-body">
      <section className="tc5-split-select">
        <div className="tc5-step"><span>1</span><h3>Personen auswählen</h3></div>
        <label className="tc5-search"><IconSearch size={18}/><input aria-label="Personen zum Aufteilen suchen" placeholder="Name oder Verein suchen …" value={query} onChange={event => setQuery(event.target.value)} disabled={disabled}/></label>
        <div className="tc5-split-people">{people.filter(person => `${person.name} ${names.get(person.parentId || "")?.name || ""}`.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de"))).map(person => {
          const chosen = parts.some(part => part.id === person.id);
          return <button key={person.id} disabled={disabled || !chosen && parts.length >= 100} className={chosen ? "chosen" : ""} aria-pressed={chosen} onClick={() => toggle(person.id)}><span className="tc5-avatar">{person.initials || person.name.slice(0, 2).toUpperCase()}</span><span><strong>{person.name}</strong><small>{person.type ? names.get(person.parentId || "")?.name || "Besucherverein" : "Mitglied"}</small></span><b>{chosen ? <IconCheck size={16}/> : "+"}</b></button>;
        })}</div>
      </section>
      <section className="tc5-split-amounts">
        <div className="tc5-step"><span>2</span><h3>{kind === "items" ? "Artikel zuordnen" : "Anteile prüfen"}</h3></div>
        <div className="tc5-split-tools"><span>{parts.length} {parts.length === 1 ? "Person" : "Personen"}</span><button className={kind === "amount" && !parts.some(part => part.fixed) ? "active" : ""} disabled={disabled || parts.length < 2} onClick={() => { setKind("amount"); setParts(current => current.map(part => ({ ...part, fixed: false }))); }}>Gleichmäßig</button><button disabled={disabled} onClick={() => setKind(current => current === "items" ? "amount" : "items")}>{kind === "items" ? "Beträge" : "Nach Artikeln"}</button></div>
        <div className="tc5-split-shares">
          {kind === "items" ? units.filter(unit => unit.cents > 0).map(unit => <label className="tc5-item-share" key={unit.key}><span>{unit.name}<small>{money(unit.cents)}</small></span><select aria-label={`${unit.name} zuordnen`} disabled={disabled} value={owners[unit.key] || ""} onChange={event => setOwners(current => ({ ...current, [unit.key]: event.target.value }))}><option value="">Person wählen</option>{parts.map(part => <option key={part.id} value={part.id}>{names.get(part.id)?.name || "Konto nicht verfügbar"}</option>)}</select></label>) : shared.map(part => <div className="tc5-share" key={part.id}>
            <div><strong>{names.get(part.id)?.name || "Konto nicht verfügbar"}</strong><small>{part.fixed ? "Festgelegt" : "Automatisch verteilt"}</small>{part.fixed && <button className="tc5-auto" disabled={disabled} onClick={() => setParts(current => current.map(value => value.id === part.id ? { ...value, fixed: false } : value))}>Wieder automatisch</button>}</div>
            <label className="tc5-share-input"><input
              aria-label={`Anteil für ${names.get(part.id)?.name || part.id}`} aria-invalid={part.cents === null}
              inputMode="decimal" maxLength={10} disabled={disabled} value={part.text}
              onFocus={event => event.currentTarget.select()}
              onChange={event => { const text = event.target.value; setParts(current => current.map(value => value.id === part.id ? { ...value, fixed: true, text, cents: parseEuroCents(text) } : value)); }}
              onBlur={() => { if (part.cents !== null) setParts(current => current.map(value => value.id === part.id ? { ...value, text: euroText(part.cents!) } : value)); }}
            /><span>€</span></label>
            <button className="tc5-remove" aria-label={`${names.get(part.id)?.name || part.id} aus Aufteilung entfernen`} disabled={disabled} onClick={() => toggle(part.id)}><IconX size={17}/></button>
          </div>)}
          {!parts.length && <p className="tc5-empty-split">Wer übernimmt einen Anteil?<small>Wähle links die Personen aus.</small></p>}
        </div>
        <p className="tc5-split-help">{kind === "items" ? "Getränke aus einer aktiven Runde sind bereits abgezogen." : "Betrag antippen, um ihn zu ändern. Der Rest verteilt sich automatisch."}</p>
      </section>
    </div>
    <div className="tc5-split-footer"><div><span>Zu verteilen <strong>{money(totalCents)}</strong></span><small className={ready ? "ready" : ""} role="status">{message}</small></div><button disabled={disabled} onClick={onClose}>Abbrechen</button><button className="tc-primary" disabled={disabled || !ready || totalCents <= 0} onClick={confirm}>{ready ? `Auf ${actual.filter(part => Number(part.cents) > 0).length} ${actual.filter(part => Number(part.cents) > 0).length === 1 ? "Konto" : "Konten"} buchen` : parts.length > 1 ? `Auf ${parts.length} Konten buchen` : "Personen auswählen"}</button></div>
  </>;
}
