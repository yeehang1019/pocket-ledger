CREATE TABLE trip_sync_settings(owner TEXT PRIMARY KEY,connection TEXT NOT NULL DEFAULT 'tripshare',activated INTEGER NOT NULL DEFAULT 0,also_receive INTEGER NOT NULL DEFAULT 0,version TEXT NOT NULL DEFAULT '',last_completed TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'review_required',error TEXT NOT NULL DEFAULT '',lease TEXT NOT NULL DEFAULT '',lock_until INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE trip_sync_spaces(owner TEXT NOT NULL,connection TEXT NOT NULL,space_id TEXT NOT NULL,name TEXT NOT NULL,member_id TEXT NOT NULL,currency TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(owner,connection,space_id));
--> statement-breakpoint
CREATE TABLE trip_payables(owner TEXT NOT NULL,connection TEXT NOT NULL,key TEXT NOT NULL,space_id TEXT NOT NULL,bill_id TEXT NOT NULL,member_id TEXT NOT NULL,direction TEXT NOT NULL,title TEXT NOT NULL,date TEXT NOT NULL,category TEXT NOT NULL,currency TEXT NOT NULL,remaining INTEGER NOT NULL,paid INTEGER NOT NULL,cancelled_out INTEGER NOT NULL,share INTEGER NOT NULL,status TEXT NOT NULL,source_revision INTEGER NOT NULL,seen_run TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,connection,key));
--> statement-breakpoint
CREATE INDEX trip_payables_owner_state ON trip_payables(owner,deleted,status,currency);
--> statement-breakpoint
CREATE TABLE trip_payable_legs(owner TEXT NOT NULL,connection TEXT NOT NULL,key TEXT NOT NULL,leg_key TEXT NOT NULL,recipient_id TEXT NOT NULL,recipient_name TEXT NOT NULL,remaining INTEGER NOT NULL,paid INTEGER NOT NULL,cancelled_out INTEGER NOT NULL,PRIMARY KEY(owner,connection,leg_key));
