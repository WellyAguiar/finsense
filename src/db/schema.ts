import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const connections = pgTable("connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  pluggyItemId: text("pluggy_item_id").notNull().unique(),
  institutionName: text("institution_name").notNull(),
  institutionLogoUrl: text("institution_logo_url"),
  status: text("status").notNull().default("CONNECTED"), // CONNECTED | UPDATING | LOGIN_ERROR | OUTDATED
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    pluggyAccountId: text("pluggy_account_id").unique(),
    name: text("name").notNull(),
    institutionName: text("institution_name").notNull().default("Manual"),
    type: text("type").notNull(), // CHECKING | SAVINGS | CREDIT_CARD | CASH
    subtype: text("subtype"),
    balanceCents: bigint("balance_cents", { mode: "number" }).notNull().default(0),
    creditLimitCents: bigint("credit_limit_cents", { mode: "number" }),
    availableCreditLimitCents: bigint("available_credit_limit_cents", { mode: "number" }),
    closingDay: integer("closing_day"),
    dueDay: integer("due_day"),
    currencyCode: text("currency_code").notNull().default("BRL"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("accounts_type_idx").on(table.type)]
);

export const creditCardBills = pgTable(
  "credit_card_bills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").unique(),
    referenceMonth: text("reference_month").notNull(), // YYYY-MM
    closingDate: date("closing_date"),
    dueDate: date("due_date").notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    minimumPaymentCents: bigint("minimum_payment_cents", { mode: "number" }),
    status: text("status").notNull().default("OPEN"), // OPEN | CLOSED | PAID
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cc_bills_account_month_idx").on(table.accountId, table.referenceMonth),
  ]
);

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull(), // INCOME | EXPENSE
  icon: text("icon").notNull().default("tag"),
  color: text("color").notNull().default("#6366f1"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const categorizationRules = pgTable(
  "categorization_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pattern: text("pattern").notNull(),
    matchType: text("match_type").notNull().default("CONTAINS"), // CONTAINS | EXACT | REGEX
    cleanMerchant: text("clean_merchant").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    kindOverride: text("kind_override"), // INCOME | EXPENSE | TRANSFER | CC_PAYMENT | null
    priority: integer("priority").notNull().default(100),
    hitsCount: integer("hits_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("cat_rules_priority_idx").on(table.priority)]
);

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull().default(0),
  documentType: text("document_type").notNull().default("RECEIPT"), // RECEIPT | CREDIT_CARD_BILL | PIX | BOLETO | INVOICE
  extractedPayload: jsonb("extracted_payload").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("PENDING_REVIEW"), // PENDING_REVIEW | IMPORTED | DISCARDED
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const recurringItems = pgTable("recurring_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  merchantName: text("merchant_name").notNull(),
  matchPattern: text("match_pattern"),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  accountId: uuid("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  expectedCents: bigint("expected_cents", { mode: "number" }).notNull(),
  previousCents: bigint("previous_cents", { mode: "number" }),
  expectedDay: integer("expected_day").notNull().default(1),
  frequency: text("frequency").notNull().default("MONTHLY"), // MONTHLY | YEARLY
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | PAUSED | CANCELLED
  lastSeenAt: date("last_seen_at"),
  detectedByAi: boolean("detected_by_ai").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    billId: uuid("bill_id").references(() => creditCardBills.id, {
      onDelete: "set null",
    }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    recurringItemId: uuid("recurring_item_id").references(() => recurringItems.id, {
      onDelete: "set null",
    }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id").unique(),
    fingerprint: text("fingerprint"),
    source: text("source").notNull().default("MANUAL"), // PLUGGY | DOCUMENT_AI | MANUAL
    kind: text("kind").notNull(), // INCOME | EXPENSE | TRANSFER | CC_PAYMENT
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(), // Always positive integer
    occurredAt: date("occurred_at").notNull(), // YYYY-MM-DD
    rawDescription: text("raw_description").notNull(),
    cleanMerchant: text("clean_merchant").notNull(),
    notes: text("notes"),
    installmentNumber: integer("installment_number"),
    installmentTotal: integer("installment_total"),
    aiConfidence: doublePrecision("ai_confidence"),
    reviewed: boolean("reviewed").notNull().default(false),
    transferPairId: uuid("transfer_pair_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tx_occurred_at_idx").on(table.occurredAt),
    index("tx_account_idx").on(table.accountId),
    index("tx_category_idx").on(table.categoryId),
    index("tx_kind_idx").on(table.kind),
    index("tx_fingerprint_idx").on(table.fingerprint),
  ]
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    referenceMonth: text("reference_month").notNull().default("DEFAULT"), // YYYY-MM or DEFAULT
    limitCents: bigint("limit_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("budgets_cat_month_idx").on(table.categoryId, table.referenceMonth),
  ]
);

export const goals = pgTable("goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  targetCents: bigint("target_cents", { mode: "number" }).notNull(),
  currentCents: bigint("current_cents", { mode: "number" }).notNull().default(0),
  targetDate: date("target_date"),
  linkedAccountId: uuid("linked_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  color: text("color").notNull().default("#10b981"),
  icon: text("icon").notNull().default("target"),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | COMPLETED | ARCHIVED
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aiInsights = pgTable(
  "ai_insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(), // MONTHLY_REPORT | ANOMALY | SUBSCRIPTION_ALERT | BUDGET_PACE
    severity: text("severity").notNull().default("INFO"), // INFO | WARNING | CRITICAL
    title: text("title").notNull(),
    summaryMd: text("summary_md").notNull(),
    referenceMonth: text("reference_month"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    dismissed: boolean("dismissed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ai_insights_created_idx").on(table.createdAt)]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: text("session_id").notNull().default("default"),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    charts: jsonb("charts").$type<Array<Record<string, unknown>>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("chat_session_idx").on(table.sessionId, table.createdAt)]
);

export type Connection = typeof connections.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type CreditCardBill = typeof creditCardBills.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type CategorizationRule = typeof categorizationRules.$inferSelect;
export type DocumentRecord = typeof documents.$inferSelect;
export type RecurringItem = typeof recurringItems.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type AiInsight = typeof aiInsights.$inferSelect;
