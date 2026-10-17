import { env } from "cloudflare:workers";
type IncludedItemInput={productId:number;quantity:number};
const parseIncludedItems=(value:string):IncludedItemInput[]=>{try{const data=JSON.parse(value);return Array.isArray(data)?data:[]}catch{return []}};
type SaleLine={productId:number;productName:string;quantity:number;unitPrice:number;total:number;countsForConsumption?:boolean;category?:string};
type StoredProduct={id:number;category:string;name:string;price:number;member_price:number|null;included_items_json:string;is_offer:number};
const moneyValue=(value:number)=>Math.round(value*100)/100;
export async function canonicalCart(profileId:string,cart:unknown,priceMode:"member"|"non_member"){
  if(!cart||typeof cart!=="object"||Array.isArray(cart))throw new Error("Ungültiger Warenkorb");
  const entries=Object.entries(cart as Record<string,unknown>);if(!entries.length||entries.length>100)throw new Error("Ungültiger Warenkorb");
  const quantities=new Map<number,number>();for(const [rawId,rawQuantity] of entries){const id=Number(rawId),quantity=Number(rawQuantity);if(!Number.isInteger(id)||!Number.isInteger(quantity)||quantity<0||quantity>99)throw new Error("Ungültige Artikelmenge");if(quantity>0)quantities.set(id,quantity)}if(!quantities.size)throw new Error("Der Warenkorb ist leer");
  const [productRows,discount]=await Promise.all([env.DB.prepare("SELECT id,name,price,member_price,included_items_json,is_offer,category FROM products WHERE profile_id=?").bind(profileId).all<StoredProduct>(),env.DB.prepare("SELECT percent FROM discount_rules WHERE profile_id=? AND active=1 ORDER BY updated_at DESC LIMIT 1").bind(profileId).first<{percent:number}>()]);
  const byId=new Map(productRows.results.map(product=>[Number(product.id),product])),discountPercent=Math.min(100,Math.max(0,Number(discount?.percent||0))),lines:SaleLine[]=[];let total=0;
  for(const [id,quantity] of quantities){const product=byId.get(id);if(!product)throw new Error("Ein Artikel ist nicht mehr verfügbar. Bitte Kasse neu laden.");const base=priceMode==="member"&&product.member_price!==null?Number(product.member_price):Number(product.price),unitPrice=moneyValue(base*(1-discountPercent/100));if(!Number.isFinite(unitPrice)||unitPrice<0)throw new Error("Ungültige Artikelkonfiguration");const included=parseIncludedItems(product.included_items_json),lineTotal=moneyValue(unitPrice*quantity);lines.push({productId:id,productName:product.name,category:product.category,quantity,unitPrice,total:lineTotal,countsForConsumption:!Boolean(product.is_offer)||!included.length});total=moneyValue(total+lineTotal);for(const item of included){const component=byId.get(item.productId);if(component)lines.push({productId:component.id,productName:component.name,quantity:item.quantity*quantity,unitPrice:0,total:0,countsForConsumption:true})}}
  return {cart:Object.fromEntries(quantities),lines,total,items:lines.filter(line=>line.countsForConsumption!==false).reduce((sum,line)=>sum+line.quantity,0)};
}
