import { createHash, randomInt, randomUUID } from 'node:crypto';
import { assert, audit, billingMonth, currentMonth, money, text, transaction } from './security.mjs';
import { statistics } from './statistics.mjs';

const cents = value => Math.round(Number(value || 0) * 100);
async function lockCatalogue(db,profile){
  // Same row lock/order as the POS. Rollback also rolls back the revision.
  await db.query("INSERT INTO public.configuration_state(profile_id,revision,last_mutation) VALUES ($1,1,$2) ON CONFLICT(profile_id) DO UPDATE SET revision=configuration_state.revision+1,last_mutation=excluded.last_mutation",[profile,randomUUID()]);
}
export function memberVersion(row) {
  return createHash('sha256').update(JSON.stringify([row.name,row.invoice_email,row.invoice_email_consent_at])).digest('hex');
}
export function dataService(pool) {
  return {
    async members() {
      const { rows } = await pool.query(`SELECT id,name,role,initials,active,invoice_email,invoice_email_consent_at FROM public.members
        WHERE id NOT IN ('M-1042','M-1088','M-1137','M-1201','M-1214','M-1228','M-1240') ORDER BY name`);
      return rows.map(row => ({ ...row, version: memberVersion(row) }));
    },
    async saveMember(actor, id, input) {
      const name = text(input.name, 'Name');
      assert(!Object.hasOwn(input,'email') && !Object.hasOwn(input,'consent'),400,'Mitglieder-E-Mail-Adressen werden hier nicht bearbeitet.');
      return transaction(pool, async db => {
        const { rows: [before] } = await db.query('SELECT id,name,invoice_email,invoice_email_consent_at FROM public.members WHERE id=$1 FOR UPDATE', [id]);
        assert(before, 404, 'Mitglied nicht gefunden.');
        assert(input.version === memberVersion(before), 409, 'Das Mitglied wurde zwischenzeitlich geändert. Bitte neu laden.');
        const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
        // Existing contact/consent fields belong to the cash system and stay untouched.
        await db.query('UPDATE public.members SET name=$1,initials=$2 WHERE id=$3', [name,initials,id]);
        await audit(db, actor, 'MEMBER_UPDATED', id, { nameChanged: before.name !== name });
        return { ok: true };
      });
    },
    async createMember(actor, input) {
      const name = text(input.name, 'Vor- und Nachname');
      assert(name.split(/\s+/).length >= 2, 400, 'Bitte Vor- und Nachname eingeben.');
      return transaction(pool, async db => {
        const { rows } = await db.query('SELECT id FROM public.members WHERE LOWER(TRIM(name))=LOWER($1) AND active=1', [name]);
        assert(!rows.length, 409, 'Dieses aktive Mitglied ist bereits vorhanden.');
        const id = `M-${randomUUID().slice(0,8).toUpperCase()}`;
        await db.query("INSERT INTO public.members (id,name,role,code,initials,active) VALUES ($1,$2,'Mitglied',$3,$4,1)", [id,name,`NOLOGIN-${randomUUID()}`,name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()]);
        await audit(db, actor, 'MEMBER_CREATED', id);
        return { ok: true, id };
      });
    },
    async products(profile) {
      return (await pool.query('SELECT id,name,price,member_price,category,updated_at FROM public.products WHERE profile_id=$1 ORDER BY category,name', [profile])).rows;
    },
    async createProduct(actor, input) {
      const name = text(input.name, 'Artikelname'), category = text(input.category, 'Kategorie', 60);
      const price = money(input.price), memberPrice = input.memberPrice === '' || input.memberPrice == null ? null : money(input.memberPrice);
      const icons = ['beer','bottle','glass','water','coffee','veterano','cola','pizza','sausage','cake','package'];
      const icon = input.icon || 'package';
      assert(icons.includes(icon),400,'Bitte ein verfügbares Artikelsymbol auswählen.');
      assert(/^[0-9a-f-]{36}$/i.test(input.idempotencyKey || ''),400,'Artikelkennung fehlt. Bitte Formular neu öffnen.');
      const fingerprint = createHash('sha256').update(JSON.stringify(['product',actor.profileId,name,category,price,memberPrice,icon])).digest('hex');
      return transaction(pool, async db => {
        const claim = await db.query('INSERT INTO bo_mutations(id,user_id,fingerprint) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[input.idempotencyKey,actor.userId,fingerprint]);
        if (!claim.rowCount) {
          const {rows:[prior]} = await db.query('SELECT user_id,fingerprint FROM bo_mutations WHERE id=$1',[input.idempotencyKey]);
          assert(prior.user_id===actor.userId && prior.fingerprint===fingerprint,409,'Diese Artikelkennung wurde bereits anders verwendet.');
          return {ok:true,duplicate:true,message:'Der Artikel wurde bereits angelegt.'};
        }
        await lockCatalogue(db,actor.profileId);
        const {rows} = await db.query('SELECT id FROM public.products WHERE profile_id=$1 AND lower(trim(name))=lower($2)',[actor.profileId,name]);
        assert(!rows.length,409,'Ein Artikel mit diesem Namen ist bereits vorhanden. Bitte den bestehenden Artikel bearbeiten.');
        // Existing POS uses millisecond IDs. Keep a separate random, JS-safe BIGINT range.
        const id = randomInt(2**46,2**47), now = new Date().toISOString();
        await db.query("INSERT INTO public.products (id,profile_id,name,price,member_price,icon,category,color,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'green',$8)",[id,actor.profileId,name,price/100,memberPrice===null?null:memberPrice/100,icon,category,now]);
        await audit(db,actor,'PRODUCT_CREATED',String(id),{name,category,price:price/100,memberPrice:memberPrice===null?null:memberPrice/100});
        return {ok:true,id,message:'Artikel angelegt. Die Kassenoberfläche neu laden, damit er dort erscheint.'};
      });
    },
    async saveProduct(actor, id, input) {
      const price = money(input.price), memberPrice = input.memberPrice === '' || input.memberPrice === null ? null : money(input.memberPrice);
      const name = text(input.name, 'Artikelname'), category = text(input.category, 'Kategorie', 60);
      return transaction(pool, async db => {
        await lockCatalogue(db,actor.profileId);
        const { rows: [before] } = await db.query('SELECT id,name,price,member_price,category,updated_at FROM public.products WHERE id=$1 AND profile_id=$2 FOR UPDATE', [id,actor.profileId]);
        assert(before, 404, 'Artikel nicht gefunden.');
        assert(before.updated_at === input.version, 409, 'Der Artikel wurde zwischenzeitlich geändert. Bitte neu laden.');
        await db.query('UPDATE public.products SET name=$1,price=$2,member_price=$3,category=$4,updated_at=$5 WHERE id=$6 AND profile_id=$7', [name,price/100,memberPrice === null ? null : memberPrice/100,category,new Date().toISOString(),id,actor.profileId]);
        await audit(db, actor, 'PRICE_CHANGED', String(id), { before, after: { name, price:price/100, memberPrice:memberPrice === null ? null : memberPrice/100, category } });
        return { ok: true };
      });
    },
    async archive(profile) {
      return (await pool.query(`SELECT month,statement_number,closed_at FROM public.monthly_closures WHERE profile_id=$1 ORDER BY month DESC`, [profile])).rows;
    },
    async report(profile, month) {
      billingMonth(month);
      const { rows: [closure] } = await pool.query('SELECT * FROM public.monthly_closures WHERE profile_id=$1 AND month=$2', [profile,month]);
      const notes = (await pool.query('SELECT member_id,note,version FROM bo_invoice_notes WHERE profile_id=$1 AND month=$2', [profile,month])).rows;
      const balances = (await pool.query('SELECT member_id,SUM(amount) AS balance FROM public.account_transactions WHERE profile_id=$1 GROUP BY member_id', [profile])).rows;
      if (closure) {
        const digest = createHash('sha256').update(closure.snapshot_json).digest('hex');
        assert(digest === closure.checksum, 409, 'Die Prüfsumme dieser festgeschriebenen Abrechnung stimmt nicht. Bitte vor Bearbeitung prüfen.');
        return { ...JSON.parse(closure.snapshot_json), notes, balances, closure: { closed:true, statementNumber:closure.statement_number, closedAt:closure.closed_at, checksum:closure.checksum } };
      }
      const start = `${month}-01T00:00:00.000Z`, endDate = new Date(start);
      endDate.setUTCMonth(endDate.getUTCMonth()+1);
      const end = endDate.toISOString();
      // Same UTC booking boundaries as the existing cash app; closed snapshots always take precedence.
      const { rows } = await pool.query(`SELECT member_id,MAX(member_name) AS name,
        COALESCE(SUM(CASE WHEN created_at<$2 THEN amount ELSE 0 END),0) AS opening,
        COALESCE(SUM(CASE WHEN created_at>=$2 AND amount>0 THEN amount ELSE 0 END),0) AS charges,
        COALESCE(SUM(CASE WHEN created_at>=$2 AND type='Zahlung' THEN -amount ELSE 0 END),0) AS payments,
        COALESCE(SUM(CASE WHEN created_at>=$2 AND amount<0 AND type<>'Zahlung' THEN amount ELSE 0 END),0) AS adjustments,
        SUM(amount) AS closing FROM public.account_transactions WHERE profile_id=$1 AND created_at<$3 GROUP BY member_id
        HAVING SUM(amount)<>0 OR MAX(created_at)>=$2 ORDER BY name`, [profile,start,end]);
      let people = rows.map(row => ({ memberId:row.member_id,memberName:row.name,openingBalance:Number(row.opening),charges:Number(row.charges),payments:Number(row.payments),adjustments:Number(row.adjustments),closingBalance:Number(row.closing) }));
      const guests = (await pool.query('SELECT id,name,type,parent_id FROM public.guest_accounts WHERE profile_id=$1', [profile])).rows;
      for (const club of guests.filter(guest => guest.type === 'club')) {
        const ids = new Set([club.id, ...guests.filter(g => g.parent_id === club.id).map(g => g.id)]);
        const linked = people.filter(person => ids.has(person.memberId));
        if (!linked.length) continue;
        const grouped = { memberId:club.id,memberName:club.name,isClubGroup:true,children:linked.filter(p=>p.memberId!==club.id) };
        for (const key of ['openingBalance','charges','payments','adjustments','closingBalance']) grouped[key] = linked.reduce((sum,p)=>sum+cents(p[key]),0)/100;
        people = [...people.filter(p=>!ids.has(p.memberId)),grouped];
      }
      const items = (await pool.query(`SELECT at.member_id AS "memberId",at.sale_id AS "saleId",at.created_at AS "createdAt",
        si.product_name AS "productName",si.quantity,si.total,at.amount AS "allocatedAmount",
        (SELECT COUNT(*)>1 FROM public.sale_allocations sa WHERE sa.sale_id=at.sale_id AND sa.profile_id=at.profile_id) AS shared
        FROM public.account_transactions at JOIN public.sale_items si ON si.sale_id=at.sale_id JOIN public.sales s ON s.id=si.sale_id AND s.profile_id=at.profile_id
        WHERE at.profile_id=$1 AND at.created_at>=$2 AND at.created_at<$3 AND at.amount>0`, [profile,start,end])).rows;
      const due = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),10,12));
      return { month,label:new Date(start).toLocaleDateString('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}),dueLabel:due.toLocaleDateString('de-DE'),
        people,items,notes,balances,summary:{charges:people.reduce((s,p)=>s+cents(p.charges),0)/100,payments:people.reduce((s,p)=>s+cents(p.payments),0)/100,people:people.length},closure:{closed:false} };
    },
    async note(actor, month, memberId, input) {
      billingMonth(month);
      assert(typeof input.note === 'string' && input.note.length<=2000 && Number.isInteger(input.version), 400, 'Ungültiger Vermerk.');
      return transaction(pool, async db => {
        const { rows } = await db.query(`INSERT INTO bo_invoice_notes (profile_id,month,member_id,note,updated_by)
          SELECT $1,$2,$3,$4,$5 WHERE $6=0 ON CONFLICT(profile_id,month,member_id) DO NOTHING RETURNING version`, [actor.profileId,month,memberId,input.note,actor.userId,input.version]);
        if (!rows.length) {
          const updated = await db.query(`UPDATE bo_invoice_notes SET note=$1,version=version+1,updated_by=$2,updated_at=now()
            WHERE profile_id=$3 AND month=$4 AND member_id=$5 AND version=$6 RETURNING version`, [input.note,actor.userId,actor.profileId,month,memberId,input.version]);
          assert(updated.rowCount, 409, 'Der Vermerk wurde zwischenzeitlich geändert. Bitte neu laden.');
        }
        await audit(db, actor, 'INVOICE_NOTE_CHANGED', `${month}/${memberId}`);
        return { ok: true };
      });
    },
    async entries(profile, memberId) {
      return (await pool.query('SELECT id,type,amount,note,created_at FROM public.account_transactions WHERE profile_id=$1 AND member_id=$2 ORDER BY created_at DESC,id DESC LIMIT 200', [profile,memberId])).rows;
    },
    async addEntry(actor, input) {
      assert(['payment','adjustment'].includes(input.kind),400,'Ungültige Verwaltungsbuchung.');
      const amount = money(input.amount, input.kind === 'adjustment');
      assert(amount !== 0 && (input.kind !== 'payment' || amount > 0),400,'Bitte einen Betrag größer als null bzw. eine Korrektur ungleich null angeben.');
      const memberId = text(input.memberId, 'Mitglied',100), reason = text(input.reason,'Begründung / Überweisungsreferenz',500);
      const month = billingMonth(input.referenceMonth);
      assert(/^[0-9a-f-]{36}$/i.test(input.idempotencyKey || ''),400,'Buchungskennung fehlt. Bitte Formular neu öffnen.');
      assert(Number.isFinite(input.expectedBalance),400,'Kontostand fehlt. Bitte neu laden.');
      const signed = input.kind === 'payment' ? -amount : amount;
      const fingerprint = createHash('sha256').update(JSON.stringify([actor.profileId,memberId,signed,input.kind,reason,month])).digest('hex');
      return transaction(pool, async db => {
        const prior = await db.query('INSERT INTO bo_mutations(id,user_id,fingerprint) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[input.idempotencyKey,actor.userId,fingerprint]);
        if (!prior.rowCount) {
          const { rows:[old] } = await db.query('SELECT user_id,fingerprint FROM bo_mutations WHERE id=$1',[input.idempotencyKey]);
          assert(old.user_id === actor.userId && old.fingerprint === fingerprint,409,'Diese Buchungskennung wurde bereits anders verwendet.');
          return { ok:true, duplicate:true };
        }
        const { rows:[member] } = await db.query('SELECT id,name FROM public.members WHERE id=$1 FOR UPDATE',[memberId]);
        assert(member,404,'Für Verwaltungsbuchungen bitte ein Mitgliedskonto auswählen.');
        const { rows:[closed] } = await db.query('SELECT id FROM public.monthly_closures WHERE profile_id=$1 AND month=$2',[actor.profileId,currentMonth()]);
        assert(!closed,409,'Der aktuelle Monat ist bereits geschlossen.');
        const { rows:[balance] } = await db.query('SELECT COALESCE(SUM(amount),0) AS value FROM public.account_transactions WHERE profile_id=$1 AND member_id=$2',[actor.profileId,memberId]);
        assert(cents(balance.value) === cents(input.expectedBalance),409,'Der Kontostand hat sich geändert. Bitte neu laden und nochmals prüfen.');
        if (input.kind === 'payment') assert(amount <= cents(balance.value),409,'Die Zahlung übersteigt den offenen Kontostand. Überzahlungen bitte zuerst klären.');
        const id = randomUUID(), now = new Date().toISOString(), note = `Verwaltung · Bezug ${month}: ${reason}`, operator = `Verwaltung: ${actor.name}`;
        await db.query('INSERT INTO public.account_transactions (id,profile_id,member_id,member_name,sale_id,type,amount,note,operator_id,created_at) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9)',[id,actor.profileId,memberId,member.name,input.kind === 'payment'?'Zahlung':'Anpassung',signed/100,note,operator,now]);
        if (input.kind === 'payment') await db.query("INSERT INTO public.payments (id,profile_id,member_id,method,amount,note,operator_id,created_at) VALUES ($1,$2,$3,'Überweisung',$4,$5,$6,$7)",[randomUUID(),actor.profileId,memberId,amount/100,note,operator,now]);
        const details = { profileId:actor.profileId, memberId, amount:signed/100, referenceMonth:month, reason, userId:actor.userId };
        await db.query('INSERT INTO public.audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),'BACKOFFICE_ACCOUNT_ENTRY','account_transaction',id,operator,JSON.stringify(details),now]);
        await audit(db,actor,'ACCOUNT_ENTRY_CREATED',id,details);
        return { ok:true,id };
      });
    },
    statistics: (profile, range) => statistics(pool, profile, range),
  };
}
