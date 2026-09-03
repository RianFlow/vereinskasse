import { assert, billingMonth, currentMonth } from './security.mjs';

export function statisticsRange(input = {}) {
  const to = billingMonth(input.to || currentMonth());
  const end = new Date(`${to}-01T00:00:00.000Z`), first = new Date(end);
  first.setUTCMonth(first.getUTCMonth()-11);
  const from = billingMonth(input.from || first.toISOString().slice(0,7));
  const start = new Date(`${from}-01T00:00:00.000Z`);
  const length = (end.getUTCFullYear()-start.getUTCFullYear())*12+end.getUTCMonth()-start.getUTCMonth()+1;
  assert(length>0 && length<=36,400,'Bitte einen Zeitraum von 1 bis 36 Monaten auswählen.');
  end.setUTCMonth(end.getUTCMonth()+1);
  const months = Array.from({length},(_,index)=>{
    const date = new Date(start); date.setUTCMonth(date.getUTCMonth()+index); return date.toISOString().slice(0,7);
  });
  return {from,to,start:start.toISOString(),end:end.toISOString(),months};
}

export async function statistics(pool, profile, input) {
  const range = statisticsRange(input), params = [profile,range.start,range.end];
  const validSales = `s.profile_id=$1 AND s.time>=$2 AND s.time<$3
    AND NOT EXISTS(SELECT 1 FROM public.reversals r WHERE r.sale_id=s.id)`;
  const sales = (await pool.query(`SELECT substr(s.time,1,7) AS month,COUNT(*) AS sales,COALESCE(SUM(s.total),0) AS revenue
    FROM public.sales s WHERE ${validSales} GROUP BY substr(s.time,1,7)`,params)).rows;
  // Account payments are not new sales. Report separately, never add them to revenue.
  const paid = (await pool.query(`SELECT substr(created_at,1,7) AS month,-SUM(amount) AS payments
    FROM public.account_transactions WHERE profile_id=$1 AND created_at>=$2 AND created_at<$3 AND type='Zahlung'
    GROUP BY substr(created_at,1,7)`,params)).rows;
  const months = range.months.map(month=>{
    const sale = sales.find(row=>row.month===month), payment = paid.find(row=>row.month===month);
    return {month,sales:Number(sale?.sales||0),revenue:Number(sale?.revenue||0),payments:Number(payment?.payments||0)};
  });
  const products = (await pool.query(`SELECT si.product_name AS name,SUM(si.quantity) AS quantity
    FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id
    WHERE ${validSales} AND si.counts_for_consumption=1 GROUP BY si.product_name ORDER BY quantity DESC,si.product_name LIMIT 12`,params)).rows.map(row=>({...row,quantity:Number(row.quantity)}));
  const categories = (await pool.query(`SELECT COALESCE(p.category,'Nicht zugeordnet') AS name,SUM(si.total) AS revenue
    FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id LEFT JOIN public.products p ON p.id=si.product_id AND p.profile_id=s.profile_id
    WHERE ${validSales} GROUP BY COALESCE(p.category,'Nicht zugeordnet') ORDER BY revenue DESC,name`,params)).rows.map(row=>({...row,revenue:Number(row.revenue)}));
  const weekdays = (await pool.query(`SELECT EXTRACT(ISODOW FROM s.time::timestamptz AT TIME ZONE 'Europe/Berlin') AS day,
    COUNT(*) AS sales,SUM(s.total) AS revenue FROM public.sales s WHERE ${validSales} GROUP BY day ORDER BY day`,params)).rows;
  const methods = (await pool.query(`SELECT s.method AS name,COUNT(*) AS sales,SUM(s.total) AS revenue
    FROM public.sales s WHERE ${validSales} GROUP BY s.method ORDER BY revenue DESC,name`,params)).rows.map(row=>({...row,sales:Number(row.sales),revenue:Number(row.revenue)}));
  const quantity = Number((await pool.query(`SELECT COALESCE(SUM(si.quantity),0) AS quantity FROM public.sale_items si JOIN public.sales s ON s.id=si.sale_id
    WHERE ${validSales} AND si.counts_for_consumption=1`,params)).rows[0].quantity);
  const balances = (await pool.query(`SELECT member_id,SUM(amount) AS balance FROM public.account_transactions
    WHERE profile_id=$1 GROUP BY member_id`,[profile])).rows.map(row=>Number(row.balance));
  const bands = [{name:'Bis 10 €',count:0,amount:0},{name:'Über 10 bis 50 €',count:0,amount:0},{name:'Über 50 €',count:0,amount:0}];
  for(const balance of balances.filter(value=>value>0)){const band=bands[balance<=10?0:balance<=50?1:2];band.count++;band.amount+=Math.round(balance*100);}
  for(const band of bands)band.amount/=100;
  const sum = key => months.reduce((total,row)=>total+Math.round(row[key]*100),0)/100;
  const revenue=sum('revenue'),count=months.reduce((total,row)=>total+row.sales,0);
  return {from:range.from,to:range.to,months,products,categories,methods,
    weekdays:['Mo','Di','Mi','Do','Fr','Sa','So'].map((name,index)=>{
      const row=weekdays.find(row=>Number(row.day)===index+1);return {name,sales:Number(row?.sales||0),revenue:Number(row?.revenue||0)};
    }),balances:bands,summary:{revenue,sales:count,averageSale:count?Math.round(revenue/count*100)/100:0,quantity,payments:sum('payments'),
      outstanding:bands.reduce((total,band)=>total+Math.round(band.amount*100),0)/100,openAccounts:bands.reduce((total,band)=>total+band.count,0),
      credits:-balances.filter(value=>value<0).reduce((total,value)=>total+Math.round(value*100),0)/100},asOf:new Date().toISOString()};
}
