import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey(), name: text("name").notNull(), price: real("price").notNull(),
  profileId: text("profile_id").notNull().default("darts"),
  memberPrice: real("member_price"),
  includedItemsJson: text("included_items_json").notNull().default("[]"),
  isOffer: integer("is_offer",{mode:"boolean"}).notNull().default(false),
  icon: text("icon").notNull(), category: text("category").notNull(), color: text("color").notNull(),
  updatedAt: text("updated_at").notNull(),
},table=>[index("products_profile_category_idx").on(table.profileId,table.category)]);
export const discountRules=sqliteTable("discount_rules",{id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"),name:text("name").notNull(),percent:real("percent").notNull(),active:integer("active",{mode:"boolean"}).notNull().default(false),updatedAt:text("updated_at").notNull()});

export const profiles=sqliteTable("profiles",{id:text("id").primaryKey(),name:text("name").notNull(),shortName:text("short_name").notNull(),color:text("color").notNull().default("#1d5b4c"),pinSalt:text("pin_salt").notNull(),pinHash:text("pin_hash").notNull(),mustChangePin:integer("must_change_pin",{mode:"boolean"}).notNull().default(false),failedAttempts:integer("failed_attempts").notNull().default(0),lockedUntil:text("locked_until"),recoveryFailedAttempts:integer("recovery_failed_attempts").notNull().default(0),recoveryLockedUntil:text("recovery_locked_until"),active:integer("active",{mode:"boolean"}).notNull().default(true),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()});
export const profileRecoveryKeys=sqliteTable("profile_recovery_keys",{id:text("id").primaryKey(),profileId:text("profile_id").notNull(),slot:integer("slot").notNull(),salt:text("salt").notNull(),hash:text("hash").notNull(),createdAt:text("created_at").notNull(),usedAt:text("used_at")},table=>[index("profile_recovery_keys_profile_active_idx").on(table.profileId,table.usedAt,table.slot)]);
export const profileSessions=sqliteTable("profile_sessions",{token:text("token").primaryKey(),profileId:text("profile_id").notNull(),expiresAt:text("expires_at").notNull(),createdAt:text("created_at").notNull()});

export const members = sqliteTable("members", {
  id: text("id").primaryKey(), name: text("name").notNull(), role: text("role").notNull(),
  code: text("code").notNull().unique(), initials: text("initials").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
  whatsappNumber: text("whatsapp_number"), whatsappConsentAt: text("whatsapp_consent_at"),
});

export const memberLifecycle=sqliteTable("member_lifecycle",{
  memberId:text("member_id").primaryKey(),status:text("status").notNull().default("active"),
  leftAt:text("left_at"),privacyReviewAt:text("privacy_review_at"),retiredBy:text("retired_by"),
  note:text("note").notNull().default(""),updatedAt:text("updated_at").notNull(),
},table=>[index("member_lifecycle_status_review_idx").on(table.status,table.privacyReviewAt)]);

export const rfidDevices=sqliteTable("rfid_devices",{
  id:text("id").primaryKey(),profileId:text("profile_id").notNull(),name:text("name").notNull(),
  tokenHash:text("token_hash").notNull(),active:integer("active",{mode:"boolean"}).notNull().default(true),
  lastSeenAt:text("last_seen_at"),createdBy:text("created_by").notNull(),createdAt:text("created_at").notNull(),
},table=>[uniqueIndex("rfid_devices_token_hash_unique").on(table.tokenHash),index("rfid_devices_profile_active_idx").on(table.profileId,table.active)]);

export const rfidCards=sqliteTable("rfid_cards",{
  id:text("id").primaryKey(),profileId:text("profile_id").notNull(),uid:text("uid").notNull(),
  memberId:text("member_id").notNull(),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull(),
},table=>[uniqueIndex("rfid_cards_profile_uid_unique").on(table.profileId,table.uid),index("rfid_cards_profile_member_idx").on(table.profileId,table.memberId)]);

export const rfidScans=sqliteTable("rfid_scans",{
  id:text("id").primaryKey(),profileId:text("profile_id").notNull(),deviceId:text("device_id").notNull(),
  uid:text("uid").notNull(),cardType:text("card_type"),blocks:integer("blocks"),createdAt:text("created_at").notNull(),
  expiresAt:text("expires_at").notNull(),consumedAt:text("consumed_at"),
},table=>[index("rfid_scans_profile_pending_idx").on(table.profileId,table.consumedAt,table.createdAt),index("rfid_scans_device_uid_idx").on(table.deviceId,table.uid,table.createdAt)]);

export const rfidWriteCommands=sqliteTable("rfid_write_commands",{
  id:text("id").primaryKey(),profileId:text("profile_id").notNull(),deviceId:text("device_id").notNull(),
  uid:text("uid").notNull(),block:integer("block").notNull(),payloadHex:text("payload_hex").notNull(),
  status:text("status").notNull().default("pending"),error:text("error"),createdBy:text("created_by").notNull(),
  createdAt:text("created_at").notNull(),expiresAt:text("expires_at").notNull(),claimedAt:text("claimed_at"),completedAt:text("completed_at"),
},table=>[index("rfid_write_commands_device_status_idx").on(table.deviceId,table.status,table.createdAt),index("rfid_write_commands_profile_created_idx").on(table.profileId,table.createdAt)]);

export const rfidDisplayStates=sqliteTable("rfid_display_states",{
  profileId:text("profile_id").primaryKey(),state:text("state").notNull().default("idle"),
  customerName:text("customer_name"),itemsText:text("items_text"),itemCount:integer("item_count").notNull().default(0),
  totalCents:integer("total_cents").notNull().default(0),revision:text("revision").notNull(),
  updatedAt:text("updated_at").notNull(),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  profileId: text("profile_id").notNull().default("darts"),
  startsAt: text("starts_at").notNull(), endsAt: text("ends_at"), status: text("status").notNull().default("active"),
  notes: text("notes"), createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(),
},table=>[index("events_profile_status_starts_idx").on(table.profileId,table.status,table.startsAt)]);

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(), total: real("total").notNull(), items: integer("items").notNull(),
  time: text("time").notNull(), member: text("member").notNull(), memberId: text("member_id").notNull(),
  method: text("method").notNull(), profileId:text("profile_id").notNull().default("darts"),eventId: text("event_id"), cartJson: text("cart_json").notNull(), backupKey: text("backup_key"),
},table=>[index("sales_profile_time_idx").on(table.profileId,table.time),index("sales_profile_event_idx").on(table.profileId,table.eventId)]);
export const saleItems = sqliteTable("sale_items", { id:text("id").primaryKey(),saleId:text("sale_id").notNull(),productId:integer("product_id").notNull(),productName:text("product_name").notNull(),quantity:integer("quantity").notNull(),unitPrice:real("unit_price").notNull(),total:real("total").notNull(),countsForConsumption:integer("counts_for_consumption",{mode:"boolean"}).notNull().default(true) },table=>[index("sale_items_sale_consumption_idx").on(table.saleId,table.countsForConsumption)]);
export const payments = sqliteTable("payments", { id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"),saleId:text("sale_id"),memberId:text("member_id"),method:text("method").notNull(),amount:real("amount").notNull(),tendered:real("tendered"),changeDue:real("change_due"),note:text("note").notNull(),operatorId:text("operator_id").notNull(),createdAt:text("created_at").notNull() },table=>[index("payments_profile_member_created_idx").on(table.profileId,table.memberId,table.createdAt)]);
export const auditLogs = sqliteTable("audit_logs", { id:text("id").primaryKey(),action:text("action").notNull(),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),operatorId:text("operator_id").notNull(),detailsJson:text("details_json").notNull(),createdAt:text("created_at").notNull() });
export const authSessions = sqliteTable("auth_sessions", { token:text("token").primaryKey(),memberId:text("member_id").notNull(),role:text("role").notNull(),expiresAt:text("expires_at").notNull(),createdAt:text("created_at").notNull() });
export const guestAccounts = sqliteTable("guest_accounts", { id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"),name:text("name").notNull(),type:text("type").notNull(),parentId:text("parent_id"),visitDate:text("visit_date"),active:integer("active",{mode:"boolean"}).notNull().default(true),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull() },table=>[index("guest_accounts_profile_parent_active_idx").on(table.profileId,table.parentId,table.active),index("guest_accounts_profile_visit_idx").on(table.profileId,table.visitDate)]);

export const saleAllocations = sqliteTable("sale_allocations", {
  id: text("id").primaryKey(), profileId:text("profile_id").notNull().default("darts"),saleId: text("sale_id").notNull(), memberId: text("member_id").notNull(),
  memberName: text("member_name").notNull(), amount: real("amount").notNull(), kind: text("kind").notNull(),
},table=>[index("sale_allocations_profile_sale_member_idx").on(table.profileId,table.saleId,table.memberId)]);

export const rounds = sqliteTable("rounds", {
  id:text("id").primaryKey(), profileId:text("profile_id").notNull().default("darts"),saleId:text("sale_id").notNull(), sponsorId:text("sponsor_id").notNull(), sponsorName:text("sponsor_name").notNull(),
  label:text("label").notNull(), totalUnits:integer("total_units").notNull(), remaining:integer("remaining").notNull(), maxPerMember:integer("max_per_member").notNull().default(1),
  active:integer("active",{mode:"boolean"}).notNull().default(true), createdAt:text("created_at").notNull(),
});

export const roundClaims = sqliteTable("round_claims", {
  id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"), roundId:text("round_id").notNull(), memberId:text("member_id").notNull(), memberName:text("member_name").notNull(), quantity:integer("quantity").notNull().default(1), claimedAt:text("claimed_at").notNull(),
},table=>[index("round_claims_profile_round_member_idx").on(table.profileId,table.roundId,table.memberId)]);

export const shifts = sqliteTable("shifts", { id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"), openedBy:text("opened_by").notNull(), openedByName:text("opened_by_name").notNull(), openedAt:text("opened_at").notNull(), openingCash:real("opening_cash").notNull(), closedBy:text("closed_by"), closedAt:text("closed_at"), expectedCash:real("expected_cash"), countedCash:real("counted_cash"), difference:real("difference"), status:text("status").notNull() });
export const reversals = sqliteTable("reversals", { id:text("id").primaryKey(), saleId:text("sale_id").notNull(), reason:text("reason").notNull(), amount:real("amount").notNull(), operatorId:text("operator_id").notNull(), operatorName:text("operator_name").notNull(), createdAt:text("created_at").notNull() },table=>[index("reversals_sale_idx").on(table.saleId)]);
export const accountTransactions = sqliteTable("account_transactions", { id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"), memberId:text("member_id").notNull(), memberName:text("member_name").notNull(), saleId:text("sale_id"), type:text("type").notNull(), amount:real("amount").notNull(), note:text("note").notNull(), operatorId:text("operator_id").notNull(), createdAt:text("created_at").notNull() },table=>[index("account_transactions_profile_member_created_idx").on(table.profileId,table.memberId,table.createdAt),index("account_transactions_sale_idx").on(table.saleId)]);

export const monthlyClosures=sqliteTable("monthly_closures",{
  id:text("id").primaryKey(),profileId:text("profile_id").notNull(),month:text("month").notNull(),
  statementNumber:text("statement_number").notNull(),snapshotJson:text("snapshot_json").notNull(),
  checksum:text("checksum").notNull(),closedBy:text("closed_by").notNull(),closedByName:text("closed_by_name").notNull(),
  closedAt:text("closed_at").notNull(),
},table=>[uniqueIndex("monthly_closures_profile_month_unique").on(table.profileId,table.month),uniqueIndex("monthly_closures_statement_number_unique").on(table.statementNumber)]);

export const restoreRequests=sqliteTable("restore_requests",{
  id:text("id").primaryKey(),profileId:text("profile_id").notNull(),backupKey:text("backup_key").notNull(),
  checksum:text("checksum").notNull(),status:text("status").notNull(),requestedBy:text("requested_by").notNull(),
  requestedByName:text("requested_by_name").notNull(),approvedBy:text("approved_by"),approvedByName:text("approved_by_name"),
  previewJson:text("preview_json").notNull(),createdAt:text("created_at").notNull(),expiresAt:text("expires_at").notNull(),
  approvedAt:text("approved_at"),completedAt:text("completed_at"),error:text("error"),
},table=>[index("restore_requests_profile_status_created_idx").on(table.profileId,table.status,table.createdAt)]);

export const randomRewardCampaigns = sqliteTable("random_reward_campaigns", {
  id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"),name:text("name").notNull(),
  rewardType:text("reward_type").notNull(),rewardValue:real("reward_value").notNull().default(0),
  totalWins:integer("total_wins").notNull(),remainingWins:integer("remaining_wins").notNull(),
  startsAt:text("starts_at").notNull(),endsAt:text("ends_at").notNull(),status:text("status").notNull().default("active"),
  createdBy:text("created_by").notNull(),createdAt:text("created_at").notNull(),
},table=>[index("random_reward_campaigns_profile_status_time_idx").on(table.profileId,table.status,table.startsAt,table.endsAt)]);

export const randomRewardSlots = sqliteTable("random_reward_slots", {
  id:text("id").primaryKey(),profileId:text("profile_id").notNull().default("darts"),campaignId:text("campaign_id").notNull(),
  triggerAt:text("trigger_at").notNull(),claimedAt:text("claimed_at"),saleId:text("sale_id"),winnerName:text("winner_name"),
  rewardAmount:real("reward_amount"),rewardLabel:text("reward_label"),
},table=>[index("random_reward_slots_profile_campaign_trigger_idx").on(table.profileId,table.campaignId,table.triggerAt),index("random_reward_slots_sale_idx").on(table.saleId)]);
