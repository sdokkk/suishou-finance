import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const financeLedgers = sqliteTable('finance_ledgers', {
  owner: text('owner').primaryKey(),
  revision: integer('revision').notNull(),
  document: text('document').notNull(),
  updatedAt: text('updated_at').notNull(),
});
