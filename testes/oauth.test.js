/* Entrada com Google e Microsoft: testes com provedor falso (sem rede e sem chaves reais). */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const r = JSON.parse(execFileSync('php', [path.join(__dirname, 'oauth-cenarios.php')]).toString());

test('dados assinados não podem ser forjados nem usados depois de vencer', () => {
  assert.strictEqual(r.assina_ok, 1);
  assert.strictEqual(r.assina_adulterada, null);
  assert.strictEqual(r.assina_vencida, null);
});
test('sem chaves o botão não funciona; com chaves monta o endereço seguro (PKCE + state)', () => {
  assert.strictEqual(r.sem_chaves, null);
  assert.deepStrictEqual(r.com_chaves, ['gid', true]);
  assert.deepStrictEqual(r.url, ['S256', 'code', true, true]);
  assert.strictEqual(r.state_confere, true);
});
test('só aceita o token certo: do nosso app, do emissor certo, não vencido e com o nonce da ida', () => {
  assert.strictEqual(r.token_ok, 'g-1');
  for (const k of ['token_nonce_errado', 'token_aud_errado', 'token_emissor_errado', 'token_vencido', 'token_sem_resposta']) assert.strictEqual(r[k], null, k);
});
test('Google: conta nova só nasce depois do aceite e já vem com e-mail confirmado', () => {
  assert.deepStrictEqual(r.google_novo, ['aceite', true]);
  assert.deepStrictEqual(r.google_criado, ['ana@example.com', 1, false, 2]);
  assert.strictEqual(r.google_volta, 'login');
});
test('Google liga a conta que já existe só quando o e-mail é verificado', () => {
  assert.strictEqual(r.google_liga_conta_existente, 'login');
  assert.strictEqual(r.google_nao_verificado, 'conta-existente');
});
test('Microsoft nunca liga sozinha a conta existente e conta nova precisa confirmar o e-mail', () => {
  assert.strictEqual(r.microsoft_conta_existente, 'conta-existente');
  assert.deepStrictEqual(r.microsoft_novo, ['aceite', 0, true]);
  assert.strictEqual(r.microsoft_volta_sem_confirmar, 'confirme-email');
});
test('recusa resposta sem e-mail ou sem identificador', () => {
  assert.strictEqual(r.sem_email, 'sem-email');
  assert.strictEqual(r.sem_sub, 'dados');
});
