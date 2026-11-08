import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";

export async function GET(request: Request) {
  const profile = await requireProfile(request);
  if (!profile) return Response.json({ error: "Profilanmeldung erforderlich" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("personId");
  if (!id || id.length > 100) return Response.json({ error: "Bitte eine Person auswählen" }, { status: 400 });
  const person = await env.DB.prepare("SELECT id FROM members WHERE id=? AND active=1").bind(id).first()
    || await env.DB.prepare("SELECT id FROM guest_accounts WHERE id=? AND profile_id=? AND active=1").bind(id, profile.id).first();
  if (!person) return Response.json({ error: "Person nicht verfügbar" }, { status: 404 });
  // A shared amount does not establish who ordered an individual article.
  // Cart JSON retains the sold bundle rather than counting its expanded contents twice.
  const result = await env.DB.prepare(`
    SELECT s.id,s.time,s.cart_json FROM sales s
    WHERE s.profile_id=? AND NOT EXISTS (SELECT 1 FROM reversals r WHERE r.sale_id=s.id)
      AND ((s.method='Bar' AND s.member_id=? AND NOT EXISTS (SELECT 1 FROM sale_allocations a WHERE a.sale_id=s.id))
        OR ((SELECT COUNT(*) FROM sale_allocations a WHERE a.sale_id=s.id)=1
          AND EXISTS (SELECT 1 FROM sale_allocations a WHERE a.sale_id=s.id AND a.profile_id=s.profile_id AND a.member_id=? AND a.kind='anteil' AND ABS(a.amount-s.total)<0.001)))
    ORDER BY s.time DESC,s.id DESC LIMIT 10
  `).bind(profile.id, id, id).all<{ id: string; time: string; cart_json: string }>();
  const orders = result.results.flatMap(row => {
    try {
      const raw = JSON.parse(row.cart_json);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const cart = Object.fromEntries(Object.entries(raw).filter(([key, quantity]) => Number.isSafeInteger(Number(key)) && Number(key) > 0 && Number.isInteger(quantity) && Number(quantity) > 0 && Number(quantity) <= 99));
      return Object.keys(cart).length ? [{ id: row.id, time: row.time, cart }] : [];
    } catch { return []; }
  });
  return Response.json({ personId: id, orders }, { headers: { "Cache-Control": "no-store" } });
}
