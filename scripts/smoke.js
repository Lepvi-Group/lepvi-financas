/* Teste de fumaça contra o site NO AR: rode depois de cada publicação.
   Uso: npm run smoke            (confere versão, rotas, proteção e segurança)
        LF_CHAVE=lf_... npm run smoke   (também manda um aviso de teste de verdade, com a chave da pessoa) */
const BASE = (process.env.LF_URL || 'https://financas.lepvi.com.br').replace(/\/$/, '');
const fs = require('node:fs');
const versaoLocal = (fs.readFileSync(__dirname + '/../index.html', 'utf8').match(/app\.js\?v=(\d+)/) || [])[1];
let falhas = 0;
const ok = (cond, msg) => { console.log((cond ? '✔ ' : '✖ ') + msg); if (!cond) falhas++; };
(async () => {
  const get = (p, o) => fetch(BASE + p, { redirect: 'manual', ...o });
  const idx = await (await get('/index.html?x=' + Date.now())).text();
  ok((idx.match(/app\.js\?v=(\d+)/) || [])[1] === versaoLocal, `versão no ar = versão local (v${versaoLocal})`);
  const app = await get(`/app.js?v=${versaoLocal}`); ok(app.status === 200 && /formCaptura/.test(await app.text()), 'app.js novo carrega');
  const eu = await get('/api/?a=eu', { headers: { 'X-Lepvi': 'financas' } }); ok(eu.status === 401, 'API responde e exige login');
  const cfg = await get('/api/?a=config'); ok(cfg.status === 200, 'configuração pública responde');
  ok((await get('/api/captura.php')).status === 405, 'captura recusa GET');
  const ruim = await get('/api/captura.php', { method: 'POST', headers: { Authorization: 'Bearer lf_chave_que_nao_existe_000000', 'Content-Type': 'application/json' }, body: '{"texto":"R$ 1,00"}' });
  ok(ruim.status === 401, 'captura recusa chave inválida');
  for (const p of ['/api/_lib.php', '/api/_captura.php', '/api/schema.sql', '/api/cron-avisos.php', '/.htaccess']) ok([403, 404].includes((await get(p)).status), `arquivo interno protegido: ${p}`);
  if (process.env.LF_CHAVE) {
    const r = await get('/api/captura.php', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.LF_CHAVE, 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: `Teste de publicação: compra aprovada R$ 0,01 no estabelecimento TESTE LEPVI ${Date.now()}`, origem: 'push' }) });
    ok(r.status === 200, 'aviso de teste aceito com a chave real (aparece em "Para revisar"; descarte depois)');
  } else console.log('• sem LF_CHAVE: pulei o envio do aviso de teste real');
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo no ar.'); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('✖ erro:', e.message); process.exit(1); });
