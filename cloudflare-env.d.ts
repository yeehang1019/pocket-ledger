declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    POCKET_SYNC_TOKEN?: string;
    POCKET_SYNC_EMAIL?: string;
    LEDGER_OWNER_EMAIL?: string;
  }
}
