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
