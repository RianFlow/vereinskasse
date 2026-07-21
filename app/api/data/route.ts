import { env } from "cloudflare:workers";
import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, products, saleAllocations, sales } from "../../../db/schema";

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
];

async function ensureSeed() {
  const db = getDb();
  const existing = await db.select({ id: products.id }).from(products).limit(1);
  if (!existing.length) await db.insert(products).values(seedProducts.map(p => ({...p, updatedAt:new Date().toISOString()})));
  const existingMembers = await db.select({ id: members.id }).from(members).limit(1);
  if (!existingMembers.length) await db.insert(members).values(seedMembers);
}

export async function GET() {
  try { await ensureSeed(); const db=getDb(); return Response.json({ products:await db.select().from(products), members:await db.select().from(members), sales:await db.select().from(sales).orderBy(desc(sales.time)).limit(500), allocations:await db.select().from(saleAllocations) }); }
  catch (e) { return Response.json({error:e instanceof Error?e.message:"Speicher nicht verfügbar"},{status:500}); }
}

export async function PUT(request:Request) {
  try { const body=await request.json() as {products?:typeof seedProducts}; if(!body.products) return Response.json({error:"products required"},{status:400});
    const now=new Date().toISOString(); const statements=[env.DB.prepare("DELETE FROM products"),...body.products.map(p=>env.DB.prepare("INSERT INTO products (id,name,price,icon,category,color,updated_at) VALUES (?,?,?,?,?,?,?)").bind(p.id,p.name,p.price,p.icon,p.category,p.color,now))];
    await env.DB.batch(statements);
    return Response.json({ok:true});
  } catch(e){ return Response.json({error:e instanceof Error?e.message:"Speichern fehlgeschlagen"},{status:500}); }
}

export async function POST(request:Request) {
  try { const body=await request.json() as {id:string,total:number,items:number,time:string,member:string,memberId:string,method:string,cart:unknown,allocations?:{memberId:string;memberName:string;amount:number;kind:string}[]};
    if(!body.id||!body.memberId) return Response.json({error:"Ungültige Buchung"},{status:400});
    const backupKey=`sales/${body.time.slice(0,10)}/${body.id}.json`; const backup=JSON.stringify({...body,backedUpAt:new Date().toISOString()});
    await env.BACKUPS.put(backupKey,backup,{httpMetadata:{contentType:"application/json"}});
    const statements=[env.DB.prepare("INSERT OR IGNORE INTO sales (id,total,items,time,member,member_id,method,cart_json,backup_key) VALUES (?,?,?,?,?,?,?,?,?)").bind(body.id,body.total,body.items,body.time,body.member,body.memberId,body.method,JSON.stringify(body.cart),backupKey),...(body.allocations||[]).map((a,i)=>env.DB.prepare("INSERT OR IGNORE INTO sale_allocations (id,sale_id,member_id,member_name,amount,kind) VALUES (?,?,?,?,?,?)").bind(`${body.id}-${i}`,body.id,a.memberId,a.memberName,a.amount,a.kind))];
    await env.DB.batch(statements);
    return Response.json({ok:true,id:body.id,backupKey},{status:201});
  } catch(e){ return Response.json({error:e instanceof Error?e.message:"Buchung fehlgeschlagen"},{status:500}); }
}
