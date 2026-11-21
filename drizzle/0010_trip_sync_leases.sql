ALTER TABLE trip_sync ADD COLUMN lease text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE trip_sync ADD COLUMN staging integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE trip_entry_stage (
 owner text NOT NULL,
 group_id text NOT NULL,
 record_id text NOT NULL,
 member_id text NOT NULL,
 record_type text NOT NULL,
 group_type text NOT NULL DEFAULT '',
 date text NOT NULL,
 title text NOT NULL DEFAULT '',
 category text NOT NULL DEFAULT '',
 currency text NOT NULL,
 consumed integer NOT NULL DEFAULT 0,
 paid integer NOT NULL DEFAULT 0,
 amount integer NOT NULL DEFAULT 0,
 from_member text NOT NULL DEFAULT '',
 to_member text NOT NULL DEFAULT '',
 deleted integer NOT NULL DEFAULT 0,
 seen_run text NOT NULL DEFAULT '',
 paylater text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX trip_entry_stage_key ON trip_entry_stage(owner,record_type,group_id,record_id,member_id);
