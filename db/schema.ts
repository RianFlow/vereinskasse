import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey(), name: text("name").notNull(), price: real("price").notNull(),
  icon: text("icon").notNull(), category: text("category").notNull(), color: text("color").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(), name: text("name").notNull(), role: text("role").notNull(),
  code: text("code").notNull().unique(), initials: text("initials").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(), total: real("total").notNull(), items: integer("items").notNull(),
  time: text("time").notNull(), member: text("member").notNull(), memberId: text("member_id").notNull(),
  method: text("method").notNull(), cartJson: text("cart_json").notNull(), backupKey: text("backup_key"),
});

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
