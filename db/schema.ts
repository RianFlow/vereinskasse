import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey(), name: text("name").notNull(), price: real("price").notNull(),
  memberPrice: real("member_price"),
  icon: text("icon").notNull(), category: text("category").notNull(), color: text("color").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const discountRules=sqliteTable("discount_rules",{id:text("id").primaryKey(),name:text("name").notNull(),percent:real("percent").notNull(),active:integer("active",{mode:"boolean"}).notNull().default(false),updatedAt:text("updated_at").notNull()});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(), name: text("name").notNull(), role: text("role").notNull(),
  code: text("code").notNull().unique(), initials: text("initials").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(), total: real("total").notNull(), items: integer("items").notNull(),
  time: text("time").notNull(), member: text("member").notNull(), memberId: text("member_id").notNull(),
  method: text("method").notNull(), cartJson: text("cart_json").notNull(), backupKey: text("backup_key"),
});
export const saleItems = sqliteTable("sale_items", { id:text("id").primaryKey(),saleId:text("sale_id").notNull(),productId:integer("product_id").notNull(),productName:text("product_name").notNull(),quantity:integer("quantity").notNull(),unitPrice:real("unit_price").notNull(),total:real("total").notNull() });
export const payments = sqliteTable("payments", { id:text("id").primaryKey(),saleId:text("sale_id"),memberId:text("member_id"),method:text("method").notNull(),amount:real("amount").notNull(),tendered:real("tendered"),changeDue:real("change_due"),note:text("note").notNull(),operatorId:text("operator_id").notNull(),createdAt:text("created_at").notNull() });
export const auditLogs = sqliteTable("audit_logs", { id:text("id").primaryKey(),action:text("action").notNull(),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),operatorId:text("operator_id").notNull(),detailsJson:text("details_json").notNull(),createdAt:text("created_at").notNull() });
export const authSessions = sqliteTable("auth_sessions", { token:text("token").primaryKey(),memberId:text("member_id").notNull(),role:text("role").notNull(),expiresAt:text("expires_at").notNull(),createdAt:text("created_at").notNull() });

export const saleAllocations = sqliteTable("sale_allocations", {
  id: text("id").primaryKey(), saleId: text("sale_id").notNull(), memberId: text("member_id").notNull(),
  memberName: text("member_name").notNull(), amount: real("amount").notNull(), kind: text("kind").notNull(),
});

export const rounds = sqliteTable("rounds", {
  id:text("id").primaryKey(), saleId:text("sale_id").notNull(), sponsorId:text("sponsor_id").notNull(), sponsorName:text("sponsor_name").notNull(),
  label:text("label").notNull(), totalUnits:integer("total_units").notNull(), remaining:integer("remaining").notNull(), maxPerMember:integer("max_per_member").notNull().default(1),
  active:integer("active",{mode:"boolean"}).notNull().default(true), createdAt:text("created_at").notNull(),
});

export const roundClaims = sqliteTable("round_claims", {
  id:text("id").primaryKey(), roundId:text("round_id").notNull(), memberId:text("member_id").notNull(), memberName:text("member_name").notNull(), quantity:integer("quantity").notNull().default(1), claimedAt:text("claimed_at").notNull(),
});

export const shifts = sqliteTable("shifts", { id:text("id").primaryKey(), openedBy:text("opened_by").notNull(), openedByName:text("opened_by_name").notNull(), openedAt:text("opened_at").notNull(), openingCash:real("opening_cash").notNull(), closedBy:text("closed_by"), closedAt:text("closed_at"), expectedCash:real("expected_cash"), countedCash:real("counted_cash"), difference:real("difference"), status:text("status").notNull() });
export const reversals = sqliteTable("reversals", { id:text("id").primaryKey(), saleId:text("sale_id").notNull(), reason:text("reason").notNull(), amount:real("amount").notNull(), operatorId:text("operator_id").notNull(), operatorName:text("operator_name").notNull(), createdAt:text("created_at").notNull() });
export const accountTransactions = sqliteTable("account_transactions", { id:text("id").primaryKey(), memberId:text("member_id").notNull(), memberName:text("member_name").notNull(), saleId:text("sale_id"), type:text("type").notNull(), amount:real("amount").notNull(), note:text("note").notNull(), operatorId:text("operator_id").notNull(), createdAt:text("created_at").notNull() });
