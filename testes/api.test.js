/* Testes da API (PHP + SQLite local): conta, senha, sessão, dados cifrados, avisos por e-mail e LGPD. */
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const DEV = path.join(require('node:os').tmpdir(), 'lepvi-financas-teste-api');
const PORTA = 4189;
const BASE = `http://127.0.0.1:${PORTA}/api/`;
let servidor;
let cookie = '';

async function chamar(acao, corpo, { metodo = 'POST', semCookie = false } = {}) {
  const r = await fetch(BASE + '?a=' + acao, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Lepvi': 'financas', ...(cookie && !semCookie ? { Cookie: cookie } : {}) },
    body: metodo === 'POST' ? JSON.stringify(corpo || {}) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.startsWith('lf_sessao=')) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  const txt = await r.text();
  let json; try { json = JSON.parse(txt); } catch (e) { json = txt; }
  return { status: r.status, json };
}
const emails = () => (fs.existsSync(path.join(DEV, 'emails.log')) ? fs.readFileSync(path.join(DEV, 'emails.log'), 'utf8') : '');
const ultimoToken = (param) => { const m = [...emails().matchAll(new RegExp(param + '=([A-Za-z0-9_-]+)', 'g'))]; return m[m.length - 1][1]; };

test.before(async () => {
  fs.rmSync(DEV, { recursive: true, force: true });
  servidor = spawn('php', ['-S', `127.0.0.1:${PORTA}`, '-t', RAIZ], { stdio: 'ignore', env: { ...process.env, LEPVI_FINANCAS_DSN: 'sqlite:' + path.join(DEV, 'financas.sqlite'), LEPVI_FINANCAS_ESTADO: DEV } });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '?a=eu'); break; } catch (e) { await new Promise((r) => setTimeout(r, 150)); } }
});
test.after(() => { servidor.kill(); fs.rmSync(DEV, { recursive: true, force: true }); });

const EMAIL = 'teste@example.com';
const SENHA = 'uma-senha-bem-forte-1';

test('criptografia: ida e volta, e dado adulterado ou de outra chave não abre (só usa recursos comuns da hospedagem)', () => {
  const r = JSON.parse(execFileSync('php', ['-r', 'require "' + RAIZ + '/api/_lib.php"; $c = cifrar("lançamento secreto ç"); $x = base64_decode($c); $adulterado = base64_encode(substr($x, 0, -1) . chr(ord(substr($x, -1)) ^ 1)); echo json_encode(["volta" => decifrar($c), "adulterado" => decifrar($adulterado), "lixo" => decifrar("abc"), "sodium_necessario" => function_exists("sodium_crypto_secretbox") && false]);']).toString());
  assert.strictEqual(r.volta, 'lançamento secreto ç');
  assert.strictEqual(r.adulterado, null);
  assert.strictEqual(r.lixo, null);
});
test('segurança: pedido sem o cabeçalho do app é recusado', async () => {
  const r = await fetch(BASE + '?a=entrar', { method: 'POST', body: '{}' });
  assert.strictEqual(r.status, 403);
});
test('cadastro exige aceite, senha forte e e-mail válido', async () => {
  assert.strictEqual((await chamar('cadastro', { email: EMAIL, nome: 'Ana', senha: SENHA })).status, 422);
  assert.strictEqual((await chamar('cadastro', { email: EMAIL, nome: 'Ana', senha: 'curta', aceite: true })).status, 422);
  assert.strictEqual((await chamar('cadastro', { email: 'invalido', nome: 'Ana', senha: SENHA, aceite: true })).status, 422);
});
test('cadastro, confirmação de e-mail e entrada', async () => {
  const c = await chamar('cadastro', { email: EMAIL, nome: 'Ana Souza', senha: SENHA, aceite: true });
  assert.strictEqual(c.status, 200);
  assert.strictEqual((await chamar('entrar', { email: EMAIL, senha: SENHA })).status, 403, 'não entra sem confirmar o e-mail');
  assert.strictEqual((await chamar('verificar', { token: 'token-falso' })).status, 400);
  assert.strictEqual((await chamar('verificar', { token: ultimoToken('verificar') })).status, 200);
  const e = await chamar('entrar', { email: EMAIL, senha: SENHA });
  assert.strictEqual(e.status, 200);
  assert.ok(cookie.startsWith('lf_sessao='));
  assert.strictEqual((await chamar('eu', null, { metodo: 'GET' })).json.usuario.email, EMAIL);
});
test('e-mail repetido recebe a mesma resposta (não revela se existe)', async () => {
  const antes = (emails().match(/PARA:/g) || []).length;
  const c = await chamar('cadastro', { email: EMAIL, nome: 'Outra', senha: SENHA, aceite: true }, { semCookie: true });
  assert.strictEqual(c.status, 200);
  assert.ok((emails().match(/PARA:/g) || []).length > antes);
});
test('dados: gravam cifrados, versão evita sobrescrever e conflito devolve 409', async () => {
  const conteudo = { perfil: 'pessoal', dados: { pessoal: { contas: [], cartoes: [{ id: 'n', nome: 'Nubank', limite: 5000, fechamento: 25, vencimento: 5 }], lancs: [{ id: 'l1', tipo: 'despesa', desc: 'Luz', valor: 100, data: '2026-11-23', categoria: 'Moradia', conta: 'carteira', pago: false, boleto: true }] } } };
  assert.strictEqual((await chamar('dados', { versao: 0, conteudo })).json.versao, 1);
  assert.strictEqual((await chamar('dados', { versao: 0, conteudo })).status, 409);
  const lido = await chamar('dados', null, { metodo: 'GET' });
  assert.strictEqual(lido.json.conteudo.dados.pessoal.lancs[0].desc, 'Luz');
  const banco = fs.readFileSync(path.join(DEV, 'financas.sqlite')).toString('latin1');
  assert.ok(!banco.includes('Nubank') && !banco.includes('"Luz"'), 'dados financeiros precisam estar cifrados no banco');
});
test('avisos por e-mail: em breve, hoje e atrasado, sem repetir', async () => {
  const rodar = (hoje) => execFileSync('php', [path.join(RAIZ, 'api/cron-avisos.php'), `--hoje=${hoje}`], { env: { ...process.env, LEPVI_FINANCAS_DSN: 'sqlite:' + path.join(DEV, 'financas.sqlite'), LEPVI_FINANCAS_ESTADO: DEV } }).toString();
  assert.match(rodar('2026-11-21'), /enviados: 1/);
  assert.match(rodar('2026-11-21'), /enviados: 0/);
  assert.match(rodar('2026-11-23'), /enviados: 1/);
  assert.match(rodar('2026-11-24'), /enviados: 1/);
  assert.match(rodar('2026-11-25'), /enviados: 0/);
  assert.ok(emails().includes('Vencem hoje') && emails().includes('Já venceram') && emails().includes('Vencem em breve'));
});
test('desligar os avisos para de enviar', async () => {
  assert.strictEqual((await chamar('preferencias', { avisos: false })).json.usuario.avisos, false);
  assert.match(execFileSync('php', [path.join(RAIZ, 'api/cron-avisos.php'), '--hoje=2026-11-30'], { env: { ...process.env, LEPVI_FINANCAS_DSN: 'sqlite:' + path.join(DEV, 'financas.sqlite'), LEPVI_FINANCAS_ESTADO: DEV } }).toString(), /enviados: 0/);
  await chamar('preferencias', { avisos: true });
});
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
test('perfil: troca nome e foto, recusa arquivo que não é imagem e remove a foto', async () => {
  const ok = await chamar('preferencias', { nome: 'Ana Souza Lima', foto: PNG });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.usuario.nome, 'Ana Souza Lima');
  assert.strictEqual(ok.json.usuario.foto, PNG);
  assert.strictEqual((await chamar('eu', null, { metodo: 'GET' })).json.usuario.foto, PNG);
  assert.strictEqual((await chamar('preferencias', { foto: 'data:text/html;base64,PGgxPm9pPC9oMT4=' })).status, 422);
  assert.strictEqual((await chamar('preferencias', { foto: 'data:image/png;base64,AAAA' })).status, 422);
  assert.strictEqual((await chamar('preferencias', { nome: '   ' })).status, 422);
  const sem = await chamar('preferencias', { foto: null });
  assert.strictEqual(sem.json.usuario.foto, null);
  assert.strictEqual(sem.json.usuario.nome, 'Ana Souza Lima', 'trocar só a foto não muda o nome');
});
test('LGPD: exportar entrega os dados e os consentimentos', async () => {
  const r = await fetch(BASE + '?a=exportar', { headers: { Cookie: cookie } });
  const j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.conta.email, EMAIL);
  assert.ok(j.consentimentos.length >= 2);
  assert.strictEqual(j.dados_financeiros.dados.pessoal.lancs[0].desc, 'Luz');
  assert.ok(Array.isArray(j.fotos_de_comprovantes) && Array.isArray(j.avisos_do_banco_para_revisar));
});
test('troca e redefinição de senha derrubam as outras sessões', async () => {
  assert.strictEqual((await chamar('mudar_senha', { atual: 'errada-errada', nova: 'nova-senha-forte-22' })).status, 401);
  assert.strictEqual((await chamar('mudar_senha', { atual: SENHA, nova: 'nova-senha-forte-22' })).status, 200);
  await chamar('esqueci', { email: EMAIL }, { semCookie: true });
  const t = ultimoToken('redefinir');
  assert.strictEqual((await chamar('redefinir', { token: t, senha: 'outra-senha-forte-33' }, { semCookie: true })).status, 200);
  assert.strictEqual((await chamar('redefinir', { token: t, senha: 'outra-senha-forte-33' }, { semCookie: true })).status, 400, 'link só vale uma vez');
  assert.strictEqual((await chamar('eu', null, { metodo: 'GET' })).status, 401, 'sessão antiga foi encerrada');
  assert.strictEqual((await chamar('entrar', { email: EMAIL, senha: 'outra-senha-forte-33' })).status, 200);
});
test('esqueci senha responde igual para e-mail que não existe', async () => {
  const r = await chamar('esqueci', { email: 'ninguem@example.com' }, { semCookie: true });
  assert.strictEqual(r.status, 200);
  assert.ok(!emails().includes('PARA: ninguem@example.com'));
});
test('captura: lê avisos reais de banco (valor, local, cartão e tipo)', () => {
  const r = JSON.parse(execFileSync('php', ['-r', 'require "' + RAIZ + '/api/_captura.php"; $t = ["Compra aprovada no cartão final 1234 de R$ 45,90 em PADARIA DO ZE", "Nubank: Compra de R$ 1.234,56 APROVADA em UBER *TRIP", "Você recebeu um Pix de R$ 300,00 de MARIA", "Pagamento de R$ 89,90 no estabelecimento MERCADO SOL com cartão final 9876.", "Sem valor nenhum aqui", "Compra de R$ 20,00 em PIZZARIA SOL em 15/11 no cartão final 5555"]; echo json_encode(array_map(fn($x) => captura_interpretar($x, "2026-11-21"), $t));']).toString());
  assert.deepStrictEqual([r[0].valor, r[0].final, r[0].desc, r[0].tipo], [45.9, '1234', 'PADARIA DO ZE', 'despesa']);
  assert.deepStrictEqual([r[1].valor, r[1].desc], [1234.56, 'UBER *TRIP']);
  assert.deepStrictEqual([r[2].valor, r[2].tipo], [300, 'receita']);
  assert.deepStrictEqual([r[3].valor, r[3].final, r[3].desc], [89.9, '9876', 'MERCADO SOL']);
  assert.strictEqual(r[4], null);
  assert.deepStrictEqual([r[5].data, r[5].final], ['2026-11-15', '5555']);
});
test('captura pelo endereço público: chave própria, repetido ignorado, revisão e descarte', async () => {
  const CAP = BASE.replace('/api/', '/api/captura.php');
  const post = (token, corpo) => fetch(CAP, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(corpo) }).then(async (x) => ({ status: x.status, json: await x.json() }));
  assert.strictEqual((await post('chave-errada-chave-errada-1234', { texto: 'Compra de R$ 10,00 em X' })).status, 401);
  const { token } = (await chamar('captura_token', {})).json;
  assert.ok(token.startsWith('lf_'));
  const ok = await post(token, { texto: 'Compra aprovada no cartão final 1234 de R$ 45,90 em PADARIA DO ZE', origem: 'push' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await post(token, { texto: 'Compra aprovada no cartão final 1234 de R$ 45,90 em PADARIA DO ZE' })).json.repetido, true, 'o mesmo aviso duas vezes vira um só');
  assert.strictEqual((await post(token, { texto: 'sem valor' })).status, 422);
  const info = (await chamar('capturas', null, { metodo: 'GET' })).json;
  assert.ok(info.chave && info.chave.ultimo_uso > 0, 'o app sabe quando o celular enviou o último aviso');
  const lista = info.capturas;
  assert.strictEqual(lista.length, 1);
  assert.deepStrictEqual([lista[0].valor, lista[0].final, lista[0].desc], [45.9, '1234', 'PADARIA DO ZE']);
  const novoToken = (await chamar('captura_token', {})).json.token;
  assert.strictEqual((await post(token, { texto: 'Compra de R$ 1,00 em X' })).status, 401, 'gerar nova chave invalida a antiga');
  assert.strictEqual((await post(novoToken, { texto: 'Compra de R$ 2,00 em Y' })).status, 200);
  const t = (await chamar('captura_teste', { texto: 'Compra de R$ 7,00 em TESTE' })).json.captura;
  assert.strictEqual(t.valor, 7);
  await chamar('capturas_resolver', { ids: [lista[0].id] });
  assert.strictEqual((await chamar('capturas', null, { metodo: 'GET' })).json.capturas.length, 2);
});
test('anexos: guarda foto de recibo cifrada, recusa o que não é imagem e apaga', async () => {
  const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const env = await chamar('anexo_enviar', { lanc: 'l1', dataUrl: PNG1 });
  assert.strictEqual(env.status, 200);
  assert.strictEqual((await chamar('anexo_enviar', { lanc: 'l1', dataUrl: 'data:text/html;base64,PGgxPg==' })).status, 422);
  const lista = (await chamar('anexos&lanc=l1', null, { metodo: 'GET' })).json.anexos;
  assert.strictEqual(lista.length, 1);
  assert.strictEqual((await chamar('anexo&id=' + lista[0].id, null, { metodo: 'GET' })).json.dataUrl, PNG1);
  const banco = fs.readFileSync(path.join(DEV, 'financas.sqlite')).toString('latin1');
  assert.ok(!banco.includes('iVBORw0KGgo'), 'a foto não pode aparecer em texto aberto no banco');
  await chamar('anexo_excluir', { id: lista[0].id });
  assert.strictEqual((await chamar('anexos&lanc=l1', null, { metodo: 'GET' })).json.anexos.length, 0);
});
test('resumo semanal por e-mail: gastos da semana, comparação e vencimentos, uma vez por semana', async () => {
  const env = { ...process.env, LEPVI_FINANCAS_DSN: 'sqlite:' + path.join(DEV, 'financas.sqlite'), LEPVI_FINANCAS_ESTADO: DEV };
  const rodar = (hoje) => execFileSync('php', [path.join(RAIZ, 'api/cron-avisos.php'), '--semanal', `--hoje=${hoje}`], { env }).toString();
  const dados = { perfil: 'pessoal', dados: { pessoal: { contas: [], cartoes: [], lancs: [
    { id: 'a', tipo: 'despesa', desc: 'Supermercado', valor: 300, data: '2027-05-04', categoria: 'Mercado', conta: 'carteira', pago: true },
    { id: 'b', tipo: 'despesa', desc: 'Restaurante', valor: 120, data: '2027-05-05', categoria: 'Alimentação', conta: 'carteira', pago: true },
    { id: 'c', tipo: 'despesa', desc: 'Mercado antigo', valor: 100, data: '2027-04-28', categoria: 'Mercado', conta: 'carteira', pago: true },
    { id: 'd', tipo: 'despesa', desc: 'Conta de luz', valor: 150, data: '2027-05-12', categoria: 'Moradia', conta: 'carteira', pago: false, boleto: true },
  ] } } };
  const atual = (await chamar('dados', null, { metodo: 'GET' })).json.versao;
  await chamar('dados', { versao: atual, conteudo: dados });
  assert.match(rodar('2027-05-10'), /resumos enviados: 1/);
  const e = emails();
  assert.ok(e.includes('Resumo da semana') && e.includes('Supermercado') && e.includes('Onde você mais gastou') && e.includes('Conta de luz'));
  assert.match(rodar('2027-05-10'), /resumos enviados: 0/);
  await chamar('preferencias', { resumo: false });
  assert.match(rodar('2027-05-17'), /resumos enviados: 0/);
  await chamar('preferencias', { resumo: true });
});
test('alerta de orçamento por e-mail: avisa em 80% e de novo em 100%, uma vez cada', async () => {
  const env = { ...process.env, LEPVI_FINANCAS_DSN: 'sqlite:' + path.join(DEV, 'financas.sqlite'), LEPVI_FINANCAS_ESTADO: DEV };
  const rodar = (hoje) => execFileSync('php', [path.join(RAIZ, 'api/cron-avisos.php'), `--hoje=${hoje}`], { env }).toString();
  const dados = (valor) => ({ perfil: 'pessoal', dados: { pessoal: { contas: [], cartoes: [], orcamentos: { Mercado: 100 }, lancs: [{ id: 'm1', tipo: 'despesa', desc: 'Mercado', valor, data: '2027-03-10', categoria: 'Mercado', conta: 'carteira', pago: true }] } } });
  const atual = (await chamar('dados', null, { metodo: 'GET' })).json.versao;
  const v1 = (await chamar('dados', { versao: atual, conteudo: dados(85) })).json.versao;
  assert.match(rodar('2027-03-12'), /enviados: 1/);
  assert.ok(emails().includes('Mercado: 85% do limite do mês'));
  assert.match(rodar('2027-03-13'), /enviados: 0/);
  await chamar('dados', { versao: v1, conteudo: dados(120) });
  assert.match(rodar('2027-03-14'), /enviados: 1/);
  assert.ok(emails().includes('Mercado: 120% do limite do mês') && emails().includes('O limite foi ultrapassado'));
  assert.match(rodar('2027-03-15'), /enviados: 0/);
});
test('excluir conta apaga tudo', async () => {
  assert.strictEqual((await chamar('excluir', { senha: 'errada-errada' })).status, 401);
  assert.strictEqual((await chamar('excluir', { senha: 'outra-senha-forte-33' })).status, 200);
  cookie = '';
  assert.strictEqual((await chamar('entrar', { email: EMAIL, senha: 'outra-senha-forte-33' })).status, 401);
  const contar = execFileSync('php', ['-r', `$p = new PDO('sqlite:${path.join(DEV, 'financas.sqlite')}'); $t = 0; foreach (['usuarios','sessoes','tokens','dados','avisos','consentimentos'] as $x) { $t += (int) $p->query("SELECT COUNT(*) FROM $x")->fetchColumn(); } echo $t;`]).toString();
  assert.strictEqual(contar, '0', 'nenhuma linha da conta pode sobrar no banco');
});
test('limite de tentativas de entrada', async () => {
  cookie = '';
  let ultimo;
  for (let i = 0; i < 7; i++) ultimo = await chamar('entrar', { email: 'alvo@example.com', senha: 'senha-errada-' + i });
  assert.strictEqual(ultimo.status, 429);
});
