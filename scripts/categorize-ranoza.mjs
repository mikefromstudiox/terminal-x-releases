import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: 'A:/Studio X HUB/Terminal X/.env' })

const SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const BUSINESS_ID = '4f789f41-76d2-4402-838f-5fe20a91641f'

// Rules are matched IN ORDER. First match wins.
// Specific brand rules FIRST, then keyword patterns.
// Extra brand coverage added 2026-04-19 after dry-run review of "Otros" bucket.
const RULES = [
  // Higiene / Farmacia (Trojan + condoms + personal care)
  { cat: 'Higiene',     patterns: [/trojan/i, /durex/i, /cond[oó]n/i, /preservat/i, /\btroyano\b/i] },
  // Sexual / Wellness (adult-only items common in DR licorerías)
  { cat: 'Sexual',      patterns: [/estimulante\s*sexual/i, /honey\s*power/i, /miel\s*del\s*amor/i, /potenciador/i, /afrodis/i, /viagra/i, /vigorousman/i, /vigoro\s*\w+/i] },
  // Cognac / Brandy
  { cat: 'Cognac',      patterns: [/hennessy/i, /\bremy\s*martin\b/i, /martell\b/i, /courvoisier/i, /napoleon\s*le/i, /\bcognac\b/i, /\bbrandy\b/i, /torres\s*\d+/i, /carlos\s*i\b/i] },
  // Mamajuana (DR traditional macerate)
  { cat: 'Mamajuana',   patterns: [/mamajuana/i, /mama\s*juana/i] },
  // Tabaquería — cigars, rolling papers, tips
  { cat: 'Tabaquería',  patterns: [/\braw\s*(natural|tips|king|wide|pequeno|cono|papel)/i, /rolling\s*paper/i, /\bocb\b/i, /zig\s*zag/i, /papel\s*filtro/i, /la\s*aurora/i, /principes?\s*(chico|chicos)/i, /principe\s*chico/i, /\btaino\b.*robusto/i, /robusto\s*(claro|maduro|belicoso)/i, /belicoso/i, /\bkora\b/i, /cameroon/i, /\b1903\s*leon\s*jimenez/i, /\b1906\b/i, /\bkatae\b/i, /leon\s*jimenez/i] },
  // Panadería / Repostería (lunch counter items some licorerías keep)
  { cat: 'Panadería',   patterns: [/\bpollito\b/i, /\bbrownie/i, /coconetico/i, /bizcocho/i, /pan\s+de/i, /empanada/i, /\bquipe\b/i, /\bdona\b/i, /croissant/i, /cupcake/i] },
  // Regalos / Bolsas
  { cat: 'Regalos',     patterns: [/bolsa\s*de\s*regalo/i, /\bregalo\s*grande/i, /tarjeta\s*regalo/i, /globo\s*(fiesta|n[uú]mero)/i] },
  // Mixers (bar syrups / sour mixes)
  { cat: 'Mixers',      patterns: [/^mixer\s/i, /\bsweet.?n.?sour\b/i, /\bmargarita\s*1\s*l/i, /pi[ñn]a\s*colada\s*1\s*l/i, /^mojito\s/i, /mango\s*1\s*litro/i, /\bclamato\b/i, /bloody\s*mary\s*mix/i, /\bgrenadine\b/i, /granadina/i] },
  // Coolers / Ready-to-drink cocktails
  { cat: 'Coolers',     patterns: [/buzzballz?/i, /buzz\s*ballz/i, /seagram/i, /smirnoff\s*ice/i, /mike.?s\s*hard/i, /mike.?s\s*ice/i, /palm\s*bay/i, /twisted\s*tea/i, /white\s*claw/i, /truly\b/i, /sparkling\s*ice/i, /strawberry\s*rita/i, /jamaican\s*me\s*happy/i, /calypso\s*colada/i, /\bkarma\s+(pi[ñn]a|mojito|strawberry|daiquiri)/i, /cuba\s*libre\s*(mojito|original)/i, /la\s*famosa\s*pi[ñn]a\s*colada/i, /four\s*loko/i, /mamitas\b/i, /island\s*crush/i] },
  // Sidras
  { cat: 'Sidras',      patterns: [/\bsidra\b/i, /\bcider\b/i, /la\s*guinchera/i] },
  // Deportivas (Gatorade + Powerade)
  { cat: 'Deportivas',  patterns: [/gatorade/i, /powerade/i, /pedialyte/i, /electrolit/i, /suerox/i, /propel/i, /vitamin\s*water/i] },
  // Maltas
  { cat: 'Maltas',      patterns: [/\bmalta\b/i, /malta\s*morena/i, /maltin/i, /vitamalt/i] },
  // Bebidas típicas DR
  { cat: 'Bebidas típicas', patterns: [/morir\s*so[ñn]ando/i, /\bchinola\s*\d+/i, /jugo\s*de\s*chinola/i] },

  // Vapers / electrónicos (keep above "strawberry" etc so Airis flavors stay here)
  { cat: 'Vapers',      patterns: [/\bairis\b/i, /\bvape\b/i, /\bjuul\b/i, /\bpod\b/i, /\blost\s+(mary|strawberry|vape)\b/i, /\blost\s+\w+\s+summertime/i, /\belf\s*bar/i, /\bdel\s*rey\s*tornado/i, /iqos/i, /heets/i, /\bvladdin(g)?\b/i, /hyde\s+(edge|retro)/i, /\bgeek\s*bar\b/i, /\bpuff\s*bar\b/i, /\besco\s*bar\b/i, /\bvuse\s*go\b/i, /\bvuse\b/i, /gooba\s*squa[rd]/i] },
  // Energéticas
  { cat: 'Energéticas', patterns: [/red\s*bull/i, /monster/i, /rockstar/i, /energy\s*drink/i, /\b911\s/i, /volt/i, /sting/i, /vive\s*10?0\b/i, /\bvive\s*1oo\b/i, /celsius\b/i, /bang\b/i, /ghost\s*energy/i] },
  // Medicamentos
  { cat: 'Medicamentos', patterns: [/alka/i, /aspirina/i, /tylenol/i, /advil/i, /pepto/i, /panadol/i, /winasorb/i, /dolofin/i, /ibuprofen/i, /vick/i, /\bgripex?\b/i] },
  // Tequilas (put Tequila before Rum because of "anejo" overlap)
  { cat: 'Tequilas',    patterns: [/tequila/i, /jose\s*cuervo/i, /patron\b/i, /\b1800\b/i, /don\s*julio/i, /herradura/i, /casamigos/i, /agavita/i, /espol[óo]n/i, /milagro/i, /hornitos/i, /cazadores/i, /clase\s*azul/i, /margaritaville/i, /tiscaz/i, /tizcaz/i, /el\s*jimador/i, /olmeca/i, /centenario/i, /sauza/i, /cinco\s*de\s*mayo/i, /\bzignum\b/i, /los\s*sundays/i, /\bcicl[oó]n\b/i] },
  // Mezcal
  { cat: 'Tequilas',    patterns: [/mezcal/i, /se[ñn]orio\s*abocado/i, /con\s*gusano/i] },
  // Whiskey
  { cat: 'Whiskey',     patterns: [/whisk(e)?y/i, /jack\s*daniel/i, /johnnie\s*walker/i, /\bjohnnie\s*w\b/i, /chivas/i, /j\s*&\s*b\b/i, /ballant/i, /buchanan/i, /dewar/i, /macallan/i, /glenfidd/i, /glenlivet/i, /jameson/i, /jim\s*beam/i, /maker.?s\s*mark/i, /bulleit/i, /crown\s*royal/i, /wild\s*turkey/i, /woodford/i, /four\s*roses/i, /suntory/i, /yamazaki/i, /hibiki/i, /old\s*parr/i, /red\s*label/i, /black\s*label/i, /blue\s*label/i, /gold\s*label/i, /white\s*horse/i, /famous\s*grouse/i, /fireball/i, /monkey\s*shoulder/i, /something\s*special/i, /evan\s*williams/i, /knob\s*creek/i, /basil\s*hayden/i, /high\s*west/i, /gentleman\s*jack/i, /canadian\s*club/i, /seagram.?s\s*7/i, /tullamore/i, /bushmills/i, /teachers/i, /\bvat\s*69/i, /grant.?s\b/i, /label\s*5/i, /black\s*&\s*white/i, /passport\b/i, /william\s*lawson/i, /mac\s*arthurs?/i, /duggans?/i, /high\s*comissioner/i, /high\s*commissioner/i, /gibson.?s/i, /old\s*smuggler/i] },
  // Vodka
  { cat: 'Vodkas',      patterns: [/vodka/i, /absolut\b/i, /smirnoff/i, /grey\s*goose/i, /ciroc/i, /stoli/i, /svedka/i, /tito.?s/i, /belvedere/i, /beluga/i, /ketel\s*one/i, /moskovskaya/i, /poliakov/i, /luxus/i, /\bsobieski\b/i, /eristoff/i, /deep\s*eddy/i] },
  // Gin / Ginebra
  { cat: 'Ginebras',    patterns: [/\bgin\b/i, /ginebra/i, /tanqueray/i, /bombay/i, /hendrick/i, /beefeater/i, /gordon.?s/i, /\bsilver\s+gin/i, /the\s*london\s*no/i, /elyssia/i, /seagrams?\s*gin/i] },
  // Rons — DR-heavy
  { cat: 'Rones',       patterns: [/\bron\b/i, /\brum\b/i, /bacardi/i, /abuelo/i, /brugal/i, /barcel[oó]/i, /barcelo/i, /captain\s*morgan/i, /havana\s*club/i, /\bflor\s*de\s*ca[nñ]a/i, /don\s*q\b/i, /malibu/i, /matusalem/i, /zacapa/i, /diplom[aá]tico/i, /mount\s*gay/i, /pyrat/i, /bambu/i, /oro\s*solera/i, /palma\s*mulata/i, /a[ñn]ejo/i, /siete\s*le[gu]uas/i, /barbancourt/i, /barbacourt/i, /carta\s*(dorada|blanca|oro|2\s*dorada)/i, /kremas/i, /cremas?\s*de/i, /macorix/i, /presidente\s*1852/i, /canita\s*ligera/i, /culito\s*fruta/i, /king.?s?\s*(pride|fire|label|prinde)/i, /\bla\s*fuerza\b/i, /\bcofresi\b/i, /\bbartender\b/i, /\blolita\b/i, /\bbermudez\b/i, /\bpalo\s*viejo\b/i, /\bcampe[oó]n\b/i, /\bgladiador\b/i, /\bripiao\b/i, /\bscarlett\s*dark/i, /\bcayman\s*blue/i, /\bkalembu/i, /\bguavaberry/i, /\bla\s*benedicta/i, /\bla\s*sichera/i, /\bmack\s*albert/i, /\bmarques\s*de\s*sitche/i, /\bkanel\b/i, /\bvaliente\s*700/i, /\bgitano\s*\d+/i, /\bdon\s*isidro/i, /\blegend\s*gold/i, /\bcontrabando\b/i, /\bpunta\s*cana\b/i, /\bpuntacana\b/i, /\bdon\s*miguel\s*(house|special)/i, /\bsiboney\b/i, /\bvarsov\b/i, /\bjarana\b/i, /\bsix\s*eight\s*nine/i, /\b689\s*blanco/i, /\bspice\s*monkey/i] },
  // Cordiales / Licores
  { cat: 'Licores',     patterns: [/amaretto/i, /disaronno/i, /baileys/i, /kahlua/i, /\blicor\b/i, /aperol/i, /campari/i, /jagermeister/i, /j[aä]ger/i, /sambuca/i, /\banis\b/i, /anisado/i, /anis\s*del\s*mono/i, /gran\s*marnier/i, /grand\s*marnier/i, /cointreau/i, /triple\s*sec/i, /vermouth/i, /vermut/i, /martini/i, /fernet/i, /galliano/i, /frangelico/i, /pernod/i, /pisco/i, /angostura/i, /rumchata/i, /ponche\s*crema/i, /crema\s*de/i, /bitters/i, /amargo/i, /antioque[ñn]o/i, /aguardiente/i, /midori/i, /chambord/i, /st[\.\s-]*germain/i, /drambuie/i, /benedictine/i, /chartreuse/i, /limoncello/i, /grappa/i, /ponche\s*bordas/i, /blue\s*curacao/i, /caripassion/i, /chinola\b/i, /branca\s*menta/i, /boteega/i, /limoncino/i] },
  // Champagne / Espumantes
  { cat: 'Espumantes',  patterns: [/champagne/i, /champa[ñn]a/i, /prosecco/i, /\bcava\b/i, /spumante/i, /moet/i, /veuve/i, /dom\s*perignon/i, /mumm/i, /taittinger/i, /roederer/i, /freixenet/i, /majeur\s*ayala/i, /andr[eé]\b/i, /barefoot\s*bubbly/i, /champell\s*brut/i, /\bbrut\b/i] },
  // Vinos
  { cat: 'Vinos',       patterns: [/vino/i, /cabernet/i, /chardonnay/i, /chandonnay/i, /merlot/i, /malbec/i, /pinot/i, /sauvignon/i, /moscato/i, /tempranillo/i, /syrah/i, /shiraz/i, /riesling/i, /bordeaux/i, /rioja/i, /alamos/i, /apothic/i, /19\s*crimes/i, /concha\s*y\s*toro/i, /trivento/i, /casillero/i, /frontera/i, /j\.?\s*p\.?\s*chenet/i, /yellow\s*tail/i, /robert\s*mondavi/i, /ros[eé]\b/i, /sangria/i, /lambrusco/i, /carmenere/i, /gewurztraminer/i, /barolo/i, /chianti/i, /tinto/i, /blanco\s*seco/i, /barefoot/i, /carlo\s*rossi/i, /tisdale/i, /primal\s*roots/i, /menage\s*a\s*trois/i, /beringer/i, /submission/i, /white\s*zinfandel/i, /zinfandel/i, /red\s*blend/i, /soft\s*red/i, /dark\s*red/i, /fruity\s*red/i, /sweet\s*red/i, /\bbodega/i, /ste.?\s*michelle/i, /kendall.?jackson/i, /la\s*crema/i, /chateau/i, /napa\s*valley/i, /santa\s*carolina/i, /fresita\s*sparkling/i, /garland\s*crest/i, /borsao/i, /ramon\s*bilbao/i, /martin\s*codax/i, /albarino/i, /castillo\s*de\s*rossi/i, /\bprotos\s*crianza/i, /lopez\s*de\s*haro/i, /juve\s*camps/i, /trabuco/i, /cune\b/i, /crianza/i, /reserva\s*imperial/i, /semidulce/i, /semi\s*sweet/i] },
  // Cervezas — brands + beer styles + numeric Belgian beer names
  { cat: 'Cervezas',    patterns: [/\bcerveza\b/i, /\bbeer\b/i, /bohemia/i, /heineken/i, /corona/i, /coronita/i, /presidente/i, /miller/i, /budweiser/i, /coors/i, /stella\s*artois/i, /stellas\s*artois/i, /modelo/i, /michelob/i, /michelot/i, /pacifico/i, /\bbelga\s*star\b/i, /\bbelgian\b/i, /\b8[.,]6\b/i, /\b5[.,]0\b/i, /\b9[.,]0\b/i, /lata\s*500/i, /\bipa\b/i, /\bstout\b/i, /\blager\b/i, /\bporter\b/i, /\bale\b/i, /\bpilsen/i, /pilsner/i, /guinness/i, /negra\s*modelo/i, /dos\s*equis/i, /\bxx\b/i, /amstel/i, /brahma/i, /quilmes/i, /blue\s*moon/i, /franziskaner/i, /hoegaarden/i, /leffe/i, /chimay/i, /duvel/i, /kronenbourg/i, /carling/i, /sol\s*\d/i, /tecate/i, /victoria/i, /\bxxx\b/i, /new\s*castle/i, /lagunitas/i, /desperados/i, /erdinger/i, /schofferhofer/i, /\bclausthaler\b/i, /paulaner/i, /paderborner/i, /\bstanger\b/i, /\bstangen\b/i, /edelmeister/i, /solveza/i, /free\s*damm/i, /free\s*dame/i, /sin\s*alcohol/i, /weiss\s*bier/i, /weiss?bier/i, /dunkel/i, /salvator/i, /\bgallo\b/i, /cibao\s*apgalunas/i, /apgaluna/i, /lowenbrau/i, /canita\s*(rubia|ambar|oktoberfest)/i, /bock\s*damm/i, /estrella\s*damm/i, /estrella\s*galicia/i, /republica\s+bot/i, /republica\s+la\s+tuya/i, /la\s*tuya\s+bot/i, /la\s*tuya\s*lata/i, /ocho\s*cero\s*nueve/i] },
  // Refrescos / Gaseosas
  { cat: 'Refrescos',   patterns: [/coca[-\s]?cola/i, /pepsi/i, /\bcola\b/i, /sprite/i, /\bfanta\b/i, /seven\s*up/i, /\b7\s*up\b/i, /ginger\s*ale/i, /mirinda/i, /country\s*club/i, /red\s*rock/i, /schweppes/i, /canada\s*dry/i, /quinto\s*patio/i, /uva\s*\d/i, /naranja\s*\d/i, /\bsoda\b/i, /gaseosa/i, /enriquillo/i, /\btonica\b/i, /\bt[oó]nica\b/i, /kola\s*real/i, /mont\s*pellier/i, /coco\s*rico/i, /big\s*cola/i] },
  // Jugos
  { cat: 'Jugos',       patterns: [/\bjugo\b/i, /\bn[eé]ctar\b/i, /\bjuice\b/i, /rauch/i, /del\s*valle/i, /\bpulp\b/i, /tampico/i, /mott.?s/i, /minute\s*maid/i, /tropicana/i, /welch.?s/i, /ocean\s*spray/i, /ocean\s*cranberry/i, /petit\s+(manzanias|duraznos|pera)/i, /mistic/i, /capri\s*sun/i, /hawaiian\s*punch/i, /santal\b/i, /salutaris/i, /listamilk/i, /fruit\s*punch\s*\d/i, /mil\s*976/i, /cherry\s+fresa/i] },
  // Aguas
  { cat: 'Aguas',       patterns: [/\bagua\b/i, /planeta/i, /dasani/i, /cristal\b/i, /aquarius/i, /crystal\s*water/i, /evian/i, /perrier/i, /san\s*pellegrino/i] },
  // Cigarrillos
  { cat: 'Cigarrillos', patterns: [/marlboro/i, /malboro/i, /lucky\s*strike/i, /cigarrillo/i, /cigarettes?/i, /\bcamel\b/i, /nacional\s+cigarrillo/i, /rothmans/i, /\bmontecarlo\b/i, /kent\b/i, /\bl\s*&\s*m\b/i, /newport/i, /pall\s*mall/i, /\bthe\s*one\b.*(pequena|mediana|grande|\d+\s*oz|bot)/i, /\blym\b/i, /\blm\b/i, /\bfirt\s*cut\b/i] },
  // Tabaco / Cigarros (premium)
  { cat: 'Cigarrillos', patterns: [/tabaco/i, /cigarro\b/i, /\bhabano/i, /puro\b/i] },
  // Hielo / Insumos
  { cat: 'Insumos',     patterns: [/\bhielo\b/i, /\bvaso/i, /servilleta/i, /funda\b/i, /bolsa\s*plastic/i, /papel\s*toalla/i, /neverita\s*foam/i, /plastifar/i, /\bfoam\s*\d+\s*(oz|litro)/i] },
  // Dulces / Snacks / Confitería
  { cat: 'Snacks',      patterns: [/papita/i, /dorito/i, /chips/i, /galletas?/i, /chocolate/i, /snickers/i, /m&m/i, /kitkat/i, /kit\s*kat/i, /oreo/i, /aloe\s*vera/i, /air\s*heads/i, /chicle/i, /caramelo/i, /bombon/i, /pringles/i, /cheetos/i, /trident/i, /mentos/i, /halls\b/i, /\bdulce/i, /pop\s*corn/i, /palomita/i, /mani\b/i, /nueces/i, /pasas/i, /skittles/i, /doublemint/i, /winterfresh/i, /ice\s*breakers/i, /\bextras?\b.*(pearmint|spearmint|peppermint)/i, /\bextras?$/i, /ruffles/i, /planters/i, /cashews?/i, /semillas\s*tostadas/i, /pistacho/i, /almond/i, /almendra/i, /gummy/i, /gummies/i, /fruit\s*snacks/i, /twix/i, /milky\s*way/i, /hershey/i, /reeses/i, /\btakis\b/i, /lays?\b/i, /crunchaditas/i, /cheese\s*puff/i, /chokis/i, /lay\s*swap/i, /werner/i, /cheeda\s*cheese/i, /pepperoni/i, /hojuelit/i, /\bplatano/i, /\bplatanit/i, /chicharron/i, /chicharon/i, /detodito/i, /de\s*todito/i, /natuchip/i, /\bmofongo\b/i, /gelatinas?\s*fruit/i, /v8\s*splash/i, /crakets?/i, /crackets?/i, /emperador\s+(vainilla|chocolate)/i, /florentinas?/i, /\bquaker\b/i, /\bmamut\b/i, /choco\s*gol/i, /\bmenta\s*\d+g/i, /milka/i, /ferrero/i] },
  // Grocery básicos
  { cat: 'Abarrotes',   patterns: [/\barroz\b/i, /\baz[uú]car\b/i, /\baceite\b/i, /\bpasta\b/i, /\bhabichuela/i, /\blentejas?\b/i, /\bharina\b/i, /\bsal\b/i, /mantequilla/i, /mayonesa/i, /ketchup/i, /mostaza/i, /salsa\s*de\s*tomate/i, /pollo/i, /at[uú]n\b/i, /sardina/i, /\bleche\b/i, /queso/i, /\bhuevo/i] },
  // Lácteos / bebidas lácteas (not strict grocery)
  { cat: 'Lácteos',     patterns: [/\byogur/i, /\byogurt/i, /\bbatido\b/i, /\bmilk\s*shake/i] },
]

const DEFAULT_CAT = 'Otros'

function classify(name) {
  const lower = (name || '').toLowerCase()
  for (const rule of RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(lower)) return rule.cat
    }
  }
  return DEFAULT_CAT
}

async function main() {
  console.log('Fetching products…')
  const { data: rows, error } = await SB.from('inventory_items')
    .select('id, name, category').eq('business_id', BUSINESS_ID)
  if (error) throw error
  console.log(`Got ${rows.length} products`)

  const stats = new Map()
  const updates = []
  for (const r of rows) {
    const cat = classify(r.name)
    stats.set(cat, (stats.get(cat) || 0) + 1)
    if (r.category !== cat) updates.push({ id: r.id, cat })
  }

  console.log('\nCategorization preview:')
  const sorted = [...stats.entries()].sort((a,b) => b[1] - a[1])
  for (const [cat, n] of sorted) console.log(`  ${cat.padEnd(14)} ${n}`)

  const dry = process.argv.includes('--dry')
  if (dry) {
    console.log('\nDRY RUN — no writes.')
    const showOtros = process.argv.includes('--show-otros')
    if (showOtros) {
      console.log('\n--- Products landing in "Otros" (sample 80) ---')
      const otros = rows.filter(r => classify(r.name) === 'Otros').slice(0, 80)
      for (const r of otros) console.log('  ' + r.name)
    }
    console.log('\nPass --apply to write.')
    return
  }

  console.log(`\nApplying ${updates.length} updates…`)
  const CHUNK = 100
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK)
    // Group by category so we can do one UPDATE per category
  }
  // Group by cat, one UPDATE per cat (fast)
  const byCat = new Map()
  for (const u of updates) {
    if (!byCat.has(u.cat)) byCat.set(u.cat, [])
    byCat.get(u.cat).push(u.id)
  }
  for (const [cat, ids] of byCat.entries()) {
    const { error: uErr } = await SB.from('inventory_items')
      .update({ category: cat, updated_at: new Date().toISOString() })
      .in('id', ids).eq('business_id', BUSINESS_ID)
    if (uErr) { console.error('FAIL', cat, uErr); continue }
    console.log(`  ${cat.padEnd(14)} ${ids.length} updated`)
  }
  console.log('\nDone.')
}
main().catch(e => { console.error(e); process.exit(1) })
