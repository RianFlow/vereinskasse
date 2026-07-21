import { env } from "cloudflare:workers";
import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { discountRules, events, guestAccounts, members, products, roundClaims, rounds, saleAllocations, sales } from "../../../db/schema";
import { requireRole, sessionUser } from "../session";

const seedProducts = [
  { id:1,name:"Helles",price:3,icon:"🍺",category:"Getränke",color:"#f4b942" },{ id:2,name:"Radler",price:3,icon:"🍋",category:"Getränke",color:"#f7d66d" },
  { id:3,name:"Cola",price:2.5,icon:"🥤",category:"Getränke",color:"#d36b54" },{ id:4,name:"Wasser",price:2,icon:"💧",category:"Getränke",color:"#73b6e6" },
  { id:5,name:"Bratwurst",price:4,icon:"🌭",category:"Essen",color:"#e68155" },{ id:6,name:"Pommes",price:3.5,icon:"🍟",category:"Essen",color:"#f5c851" },
  { id:7,name:"Kuchen",price:2.5,icon:"🍰",category:"Essen",color:"#df9db4" },{ id:8,name:"Vereinsschal",price:15,icon:"🧣",category:"Fanartikel",color:"#68a487" },
];
const seedMembers = [
  { id:"M-1042",name:"Anna Becker",role:"Kassendienst",code:"VEREIN-1042",initials:"AB",active:true },
  { id:"M-1088",name:"Tobias Klein",role:"Vorstand",code:"VEREIN-1088",initials:"TK",active:true },
  { id:"M-1137",name:"Lea Wagner",role:"Helferin",code:"VEREIN-1137",initials:"LW",active:true },
  { id:"M-1201",name:"Tom Schneider",role:"Mitglied",code:"VEREIN-1201",initials:"TS",active:true },
  { id:"M-1214",name:"Mia Roth",role:"Mitglied",code:"VEREIN-1214",initials:"MR",active:true },
  { id:"M-1228",name:"Jonas Wolf",role:"Mitglied",code:"VEREIN-1228",initials:"JW",active:true },
  { id:"M-1240",name:"Alex Meier",role:"Mitglied",code:"VEREIN-1240",initials:"AM",active:true },
];

async function ensureSeed() {
  const db = getDb();
  const existing = await db.select({ id: products.id }).from(products).limit(1);
  if (!existing.length) await db.insert(products).values(seedProducts.map(p => ({...p, updatedAt:new Date().toISOString()})));
  await db.insert(members).values(seedMembers).onConflictDoNothing();
}

export async function GET() {
  try { await ensureSeed(); const db=getDb(); const safeMembers=(await db.select().from(members)).map(m=>({id:m.id,name:m.name,role:m.role,initials:m.initials,active:m.active}));return Response.json({ products:await db.select().from(products), discounts:await db.select().from(discountRules), members:safeMembers, guests:await db.select().from(guestAccounts).orderBy(desc(guestAccounts.updatedAt)), events:await db.select().from(events).orderBy(desc(events.startsAt)), sales:await db.select().from(sales).orderBy(desc(sales.time)).limit(500), allocations:await db.select().from(saleAllocations), rounds:await db.select().from(rounds).orderBy(desc(rounds.createdAt)), roundClaims:await db.select().from(roundClaims) }); }
  catch (e) { return Response.json({error:e instanceof Error?e.message:"Speicher nicht verfügbar"},{status:500}); }
}

export async function PUT(request:Request) {
  try { const body=await request.json() as {products?:Array<(typeof seedProducts)[number]&{memberPrice?:number|null}>;discounts?:{id:string;name:string;percent:number;active:boolean}[];operatorId?:string}; if(!body.products&&!body.discounts) return Response.json({error:"data required"},{status:400});
    const admin=await requireRole(request,["Vorstand"]);if(!admin)return Response.json({error:"Nur der Vorstand darf Artikel ändern"},{status:403});
    const now=new Date().toISOString(); const statements=body.products?[env.DB.prepare("DELETE FROM products"),...body.products.map(p=>env.DB.prepare("INSERT INTO products (id,name,price,member_price,icon,category,color,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(p.id,p.name,p.price,p.memberPrice??null,p.icon,p.category,p.color,now))]:[env.DB.prepare("DELETE FROM discount_rules"),...(body.discounts||[]).map(d=>env.DB.prepare("INSERT INTO discount_rules (id,name,percent,active,updated_at) VALUES (?,?,?,?,?)").bind(d.id,d.name,d.percent,d.active?1:0,now))];statements.push(env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),body.products?"PRODUCTS_UPDATED":"DISCOUNTS_UPDATED",body.products?"products":"discounts","all",admin.id,JSON.stringify({count:(body.products||body.discounts||[]).length}),now));
    await env.DB.batch(statements);
    await env.BACKUPS.put(`configuration/${now.slice(0,10)}/${Date.now()}.json`,JSON.stringify({products:body.products,discounts:body.discounts,operator:admin,createdAt:now}));
    return Response.json({ok:true});
  } catch(e){ return Response.json({error:e instanceof Error?e.message:"Speichern fehlgeschlagen"},{status:500}); }
}

export async function POST(request:Request) {
  try { const body=await request.json() as {id:string,total:number,items:number,time:string,member:string,memberId:string,method:string,eventId?:string|null,cart:unknown,lines?:{productId:number;productName:string;quantity:number;unitPrice:number;total:number}[],tendered?:number,changeDue?:number,allocations?:{memberId:string;memberName:string;amount:number;kind:string}[],guestAccount?:{id:string;name:string;type:"visitor"|"club";parentId?:string|null;parentName?:string},round?:{id:string;sponsorId:string;sponsorName:string;label:string;totalUnits:number;maxPerMember:number}};
    if(!body.id||!body.memberId||!Number.isFinite(body.total)||body.total<=0||!Number.isInteger(body.items)||body.items<=0) return Response.json({error:"Ungültige Buchung"},{status:400});
    const target=await env.DB.prepare("SELECT id,role FROM members WHERE id=? AND active=1").bind(body.memberId).first<{id:string;role:string}>();const session=await sessionUser(request);const trusted=body.method==="Vertrauensliste"&&body.allocations?.length===1&&body.allocations[0].memberId===body.memberId;const ownAccount=body.method==="Mitgliedskonto"&&session?.id===body.memberId&&body.allocations?.length===1&&body.allocations[0].memberId===body.memberId;const cashier=Boolean(session&&["Kassendienst","Vorstand"].includes(session.role));if(!target||(!trusted&&!ownAccount&&!cashier))return Response.json({error:"Keine Kassenberechtigung"},{status:403});
    const backupKey=`sales/${body.time.slice(0,10)}/${body.id}.json`; const backup=JSON.stringify({...body,backedUpAt:new Date().toISOString()});
    await env.BACKUPS.put(backupKey,backup,{httpMetadata:{contentType:"application/json"}});
    if(body.method==="Bar"&&(!Number.isFinite(body.tendered)||Number(body.tendered)<body.total))return Response.json({error:"Erhaltener Barbetrag ist zu niedrig"},{status:400});
    if(body.method==="Tageskonto"&&body.guestAccount){if(body.guestAccount.parentId&&body.guestAccount.parentName)await env.DB.prepare("INSERT INTO guest_accounts (id,name,type,parent_id,active,created_at,updated_at) VALUES (?,?,'club',NULL,1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=1,updated_at=excluded.updated_at").bind(body.guestAccount.parentId,body.guestAccount.parentName,body.time,body.time).run();await env.DB.prepare("INSERT INTO guest_accounts (id,name,type,parent_id,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,parent_id=excluded.parent_id,active=1,updated_at=excluded.updated_at").bind(body.guestAccount.id,body.guestAccount.name,body.guestAccount.type,body.guestAccount.parentId||null,body.time,body.time).run()}
    if(body.eventId&&!await env.DB.prepare("SELECT id FROM events WHERE id=? AND status='active'").bind(body.eventId).first())return Response.json({error:"Die ausgewählte Veranstaltung ist nicht mehr aktiv"},{status:409});
    const statements=[env.DB.prepare("INSERT OR IGNORE INTO sales (id,total,items,time,member,member_id,method,event_id,cart_json,backup_key) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(body.id,body.total,body.items,body.time,body.member,body.memberId,body.method,body.eventId||null,JSON.stringify(body.cart),backupKey),...(body.lines||[]).map((l,i)=>env.DB.prepare("INSERT OR IGNORE INTO sale_items (id,sale_id,product_id,product_name,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?)").bind(`${body.id}-line-${i}`,body.id,l.productId,l.productName,l.quantity,l.unitPrice,l.total)),...(body.allocations||[]).map((a,i)=>env.DB.prepare("INSERT OR IGNORE INTO sale_allocations (id,sale_id,member_id,member_name,amount,kind) VALUES (?,?,?,?,?,?)").bind(`${body.id}-${i}`,body.id,a.memberId,a.memberName,a.amount,a.kind)),...(["Mitgliedskonto","Vertrauensliste","Tageskonto"].includes(body.method)?(body.allocations||[]).map((a,i)=>env.DB.prepare("INSERT OR IGNORE INTO account_transactions (id,member_id,member_name,sale_id,type,amount,note,operator_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${body.id}-acct-${i}`,a.memberId,a.memberName,body.id,"Belastung",a.amount,body.method==="Tageskonto"?"Gast-/Tageskonto":body.method==="Vertrauensliste"?"Digitale Strichliste":a.kind==="runde"?"Runde":"Einkauf",body.memberId,body.time)):[]),...(body.method==="Bar"?[env.DB.prepare("INSERT OR IGNORE INTO payments (id,sale_id,method,amount,tendered,change_due,note,operator_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${body.id}-payment`,body.id,"Bar",body.total,body.tendered,Math.max(0,Number(body.tendered)-body.total),"Barverkauf",body.memberId,body.time)]:[]),env.DB.prepare("INSERT OR IGNORE INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(`${body.id}-audit`,`SALE_CREATED`,`sale`,body.id,body.memberId,JSON.stringify({method:body.method,total:body.total,items:body.items,eventId:body.eventId||null}),body.time),...(body.round?[env.DB.prepare("INSERT OR IGNORE INTO rounds (id,sale_id,sponsor_id,sponsor_name,label,total_units,remaining,max_per_member,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(body.round.id,body.id,body.round.sponsorId,body.round.sponsorName,body.round.label,body.round.totalUnits,body.round.totalUnits,body.round.maxPerMember,1,body.time)]:[])];
    await env.DB.batch(statements);
    return Response.json({ok:true,id:body.id,backupKey},{status:201});
  } catch(e){ return Response.json({error:e instanceof Error?e.message:"Buchung fehlgeschlagen"},{status:500}); }
}
