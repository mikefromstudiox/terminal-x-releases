// Helper: run a single SQL query via Supabase Management API and print JSON result.
// Usage: node scripts/_audit_query.mjs "SELECT ..."
import 'dotenv/config';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJ = 'csppjsoirjflumaiipqw';
const sql = process.argv.slice(2).join(' ');
const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const t = await r.text();
console.log(t);
