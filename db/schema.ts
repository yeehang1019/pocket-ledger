import {integer,sqliteTable,text,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const transactions=sqliteTable('transactions',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),title:text('title').notNull(),amount:integer('amount').notNull(),currency:text('currency').notNull(),kind:text('kind').notNull(),category:text('category').notNull(),date:text('date').notNull(),note:text('note').notNull().default(''),ruleId:text('rule_id'),occurrence:text('occurrence'),deleted:integer('deleted').notNull().default(0),createdAt:text('created_at').notNull()
},t=>[index('tx_owner_date').on(t.owner,t.date),uniqueIndex('tx_occurrence').on(t.owner,t.ruleId,t.occurrence)]);
export const rules=sqliteTable('rules',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),title:text('title').notNull(),amount:integer('amount').notNull(),currency:text('currency').notNull(),kind:text('kind').notNull(),category:text('category').notNull(),start:text('start').notNull(),frequency:text('frequency').notNull(),monthDays:text('month_days').notNull().default(''),revision:integer('revision').notNull().default(0),mode:text('mode').notNull(),status:text('status').notNull().default('active'),processedThrough:text('processed_through').notNull().default(''),createdAt:text('created_at').notNull()
},t=>[index('rule_owner').on(t.owner)]);
export const occurrences=sqliteTable('occurrences',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),ruleId:text('rule_id').notNull(),due:text('due').notNull(),status:text('status').notNull(),title:text('title').notNull(),amount:integer('amount').notNull(),currency:text('currency').notNull(),kind:text('kind').notNull(),category:text('category').notNull()
},t=>[uniqueIndex('occ_unique').on(t.owner,t.ruleId,t.due),index('occ_owner_due').on(t.owner,t.due)]);
export const budgets=sqliteTable('budgets',{
 owner:text('owner').notNull(),month:text('month').notNull(),currency:text('currency').notNull(),category:text('category').notNull(),amount:integer('amount').notNull()
},t=>[uniqueIndex('budget_scope').on(t.owner,t.month,t.currency,t.category)]);
export const tripEntries=sqliteTable('trip_entries',{
 owner:text('owner').notNull(),groupId:text('group_id').notNull(),recordId:text('record_id').notNull(),memberId:text('member_id').notNull(),recordType:text('record_type').notNull(),groupType:text('group_type').notNull().default(''),date:text('date').notNull(),title:text('title').notNull().default(''),category:text('category').notNull().default(''),currency:text('currency').notNull(),consumed:integer('consumed').notNull().default(0),paid:integer('paid').notNull().default(0),amount:integer('amount').notNull().default(0),fromMember:text('from_member').notNull().default(''),toMember:text('to_member').notNull().default(''),deleted:integer('deleted').notNull().default(0),seenRun:text('seen_run').notNull().default(''),paylater:text('paylater').notNull().default('')
},t=>[uniqueIndex('trip_entry_key').on(t.owner,t.recordType,t.groupId,t.recordId,t.memberId),index('trip_entry_owner_date').on(t.owner,t.date)]);
export const tripSync=sqliteTable('trip_sync',{
 owner:text('owner').primaryKey(),cursor:text('cursor').notNull().default(''),run:text('run').notNull().default(''),mode:text('mode').notNull().default('full'),status:text('status').notNull().default('idle'),lastCompleted:text('last_completed').notNull().default(''),lockUntil:integer('lock_until').notNull().default(0)
});
export const tripGroupLabels=sqliteTable('trip_group_labels',{
 owner:text('owner').notNull(),groupId:text('group_id').notNull(),label:text('label').notNull()
},t=>[uniqueIndex('trip_group_label_key').on(t.owner,t.groupId)]);
export const pocketBills=sqliteTable('pocket_bills',{
 owner:text('owner').notNull(),id:text('id').notNull(),title:text('title').notNull(),mode:text('mode').notNull(),category:text('category').notNull(),amount:integer('amount').notNull(),currency:text('currency').notNull(),consumptionDate:text('consumption_date').notNull(),dueDate:text('due_date').notNull().default(''),paidDate:text('paid_date').notNull().default(''),status:text('status').notNull().default('active'),accountId:text('account_id').notNull().default(''),parentId:text('parent_id').notNull().default(''),createdAt:text('created_at').notNull()
},t=>[uniqueIndex('pocket_bill_key').on(t.owner,t.id),index('pocket_bill_owner_parent').on(t.owner,t.parentId),index('pocket_bill_owner_date').on(t.owner,t.consumptionDate)]);
export const pocketAccounts=sqliteTable('pocket_accounts',{
 owner:text('owner').notNull(),id:text('id').notNull(),title:text('title').notNull(),currency:text('currency').notNull(),statementDay:integer('statement_day').notNull(),dueDay:integer('due_day').notNull()
},t=>[uniqueIndex('pocket_account_key').on(t.owner,t.id)]);
export const pocketTemplates=sqliteTable('pocket_templates',{
 owner:text('owner').notNull(),id:text('id').notNull(),title:text('title').notNull(),currency:text('currency').notNull(),category:text('category').notNull(),amount:integer('amount').notNull()
},t=>[uniqueIndex('pocket_template_key').on(t.owner,t.id)]);
export const pocketGoals=sqliteTable('pocket_goals',{
 owner:text('owner').notNull(),id:text('id').notNull(),title:text('title').notNull(),currency:text('currency').notNull(),target:integer('target').notNull(),saved:integer('saved').notNull().default(0)
},t=>[uniqueIndex('pocket_goal_key').on(t.owner,t.id)]);
export const pocketCategories=sqliteTable('pocket_categories',{
 owner:text('owner').notNull(),name:text('name').notNull()
},t=>[uniqueIndex('pocket_category_key').on(t.owner,t.name)]);
export const rangeBudgets=sqliteTable('range_budgets',{
 owner:text('owner').notNull(),id:text('id').notNull(),title:text('title').notNull(),start:text('start').notNull(),end:text('end').notNull(),currency:text('currency').notNull(),category:text('category').notNull(),amount:integer('amount').notNull()
},t=>[uniqueIndex('range_budget_key').on(t.owner,t.id)]);
export const pocketCommitments=sqliteTable('pocket_commitments',{
 owner:text('owner').notNull(),id:text('id').notNull(),kind:text('kind').notNull(),title:text('title').notNull(),currency:text('currency').notNull(),sourceKey:text('source_key').notNull().default(''),sourceSignature:text('source_signature').notNull().default(''),data:text('data').notNull(),revision:integer('revision').notNull().default(0),status:text('status').notNull().default('active'),mutation:text('mutation').notNull().default(''),
},t=>[uniqueIndex('commitment_key').on(t.owner,t.id),index('commitment_owner').on(t.owner),
 uniqueIndex('commitment_active_invoice_key').on(t.owner,t.sourceKey,t.currency).where(sql`${t.kind} = 'paylater' AND ${t.status} = 'active' AND ${t.sourceKey} GLOB 'invoice:*'`)]);

// Read-only TripShare debt mirrors, separate from consumption transactions.
export const tripSyncSettings=sqliteTable('trip_sync_settings',{owner:text('owner').primaryKey(),connection:text('connection').notNull().default('tripshare'),activated:integer('activated').notNull().default(0),alsoReceive:integer('also_receive').notNull().default(0),version:text('version').notNull().default(''),lastCompleted:text('last_completed').notNull().default(''),status:text('status').notNull().default('review_required'),error:text('error').notNull().default(''),lease:text('lease').notNull().default(''),lockUntil:integer('lock_until').notNull().default(0)});
export const tripSyncSpaces=sqliteTable('trip_sync_spaces',{owner:text('owner').notNull(),connection:text('connection').notNull(),spaceId:text('space_id').notNull(),name:text('name').notNull(),memberId:text('member_id').notNull(),currency:text('currency').notNull(),enabled:integer('enabled').notNull().default(1)},t=>[uniqueIndex('trip_sync_spaces_key').on(t.owner,t.connection,t.spaceId)]);
export const tripPayables=sqliteTable('trip_payables',{owner:text('owner').notNull(),connection:text('connection').notNull(),key:text('key').notNull(),spaceId:text('space_id').notNull(),billId:text('bill_id').notNull(),memberId:text('member_id').notNull(),direction:text('direction').notNull(),title:text('title').notNull(),date:text('date').notNull(),category:text('category').notNull(),currency:text('currency').notNull(),remaining:integer('remaining').notNull(),paid:integer('paid').notNull(),cancelledOut:integer('cancelled_out').notNull(),share:integer('share').notNull(),status:text('status').notNull(),sourceRevision:integer('source_revision').notNull(),seenRun:text('seen_run').notNull(),deleted:integer('deleted').notNull().default(0)},t=>[uniqueIndex('trip_payables_key').on(t.owner,t.connection,t.key),index('trip_payables_owner_state').on(t.owner,t.deleted,t.status,t.currency)]);
export const tripPayableLegs=sqliteTable('trip_payable_legs',{owner:text('owner').notNull(),connection:text('connection').notNull(),key:text('key').notNull(),legKey:text('leg_key').notNull(),recipientId:text('recipient_id').notNull(),recipientName:text('recipient_name').notNull(),remaining:integer('remaining').notNull(),paid:integer('paid').notNull(),cancelledOut:integer('cancelled_out').notNull()},t=>[uniqueIndex('trip_payable_legs_key').on(t.owner,t.connection,t.legKey)]);
