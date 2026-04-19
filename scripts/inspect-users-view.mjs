import fs from 'node:fs'
const ENV = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^"(.*)"$/,'$1')]))
const ref = new URL(ENV.SUPABASE_URL).hostname.split('.')[0]
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {method:'POST', headers:{Authorization:`Bearer ${ENV.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'}, body: JSON.stringify({query:sql})})
  return await r.json()
}
console.log('users VIEW columns:')
console.log(await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position`))
console.log('\nstaff columns (auth_user_id expected):')
console.log(await q(`SELECT column_name FROM information_schema.columns WHERE table_name='staff' AND column_name IN ('auth_user_id','supabase_id')`))
console.log('\nusers VIEW definition:')
console.log(await q(`SELECT view_definition FROM information_schema.views WHERE table_name='users'`))
