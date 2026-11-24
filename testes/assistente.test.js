const test = require('node:test');
const assert = require('node:assert');
const F = require('../lib.js');
const ctx = { hoje: '2026-11-24', mes: '2026-11', contas: [{ id: 'a', nome: 'Mercado Pago', saldoInicial: 100, tipo: 'corrente' }], cartoes: [{ id: 'k', nome: 'MP Cartão', limite: 5000, fechamento: 25, vencimento: 2 }], conexoes: [{ saldo: 850 }],
  atalhos: [['Inteligências', 'Projeção de saldo', 'Como ficam os próximos 6 meses', 'data-acao="projecao"', 'previsao futuro']],
  lancs: [
    { id: 1, data: '2026-11-03', desc: 'Mercado Extra', categoria: 'Mercado', tipo: 'despesa', valor: 200, conta: 'a', pago: true },
    { id: 2, data: '2026-11-05', desc: 'Pix recebido JOAO', categoria: 'Vendas', tipo: 'receita', valor: 120, conta: 'a', pago: true },
    { id: 3, data: '2026-11-06', desc: 'Pix enviado MARIA', categoria: 'Outros', tipo: 'despesa', valor: 50, conta: 'a', pago: true },
    { id: 4, data: '2026-11-10', desc: 'Loja', categoria: 'Lazer', tipo: 'despesa', valor: 80, conta: 'c:k', pago: false },
    { id: 5, data: '2026-10-10', desc: 'Mercado Velho', categoria: 'Mercado', tipo: 'despesa', valor: 999, conta: 'a', pago: true },
    { id: 6, data: '2026-11-07', desc: 'Pagamento de fatura', categoria: 'Cartão', tipo: 'despesa', valor: 777, conta: 'a', pago: true, ignorar: true },
  ] };
const r = (q) => F.responder(q, ctx).texto.replace(/\s/g, ' ');

test('assistente: gastos do mês somam só o mês e ignoram o que não conta', () => {
  assert.match(r('quanto gastei este mês?'), /R\$ 330,00/);
  assert.doesNotMatch(r('quanto gastei este mês?'), /999|777/);
});
test('assistente: categoria, mês passado e PIX', () => {
  assert.match(r('quanto gastei com mercado'), /Em Mercado você gastou R\$ 200,00 neste mês/);
  assert.match(r('quanto gastei com mercado no mês passado'), /R\$ 999,00/);
  assert.match(r('quanto entrou de pix'), /Recebido: R\$ 120,00[\s\S]*Enviado: R\$ 50,00/);
});
test('assistente: saldo, fatura e função do app com botão de atalho', () => {
  assert.match(r('qual é o meu saldo'), /Saldo real informado pelos bancos: R\$ 850,00/);
  assert.match(r('quando vence a fatura'), /vence 02\/12\/2026/);
  const x = F.responder('onde vejo a projeção', ctx);
  assert.deepStrictEqual(x.acoes.map((a) => a.attrs), ['data-acao="projecao"']);
});
test('assistente: pergunta sem sentido pede para reformular, sem inventar número', () => {
  assert.match(r('xyz abc'), /Não entendi/);
});
test('bancos: reconhece pelo nome mesmo sem acento e abreviado', () => {
  assert.strictEqual(F.bancoVisual('mercado pago').id, 'mercadopago');
  assert.strictEqual(F.bancoVisual('Itau Empresas').id, 'itau');
  assert.strictEqual(F.bancoVisual('NUBANK').id, 'nubank');
  assert.strictEqual(F.bancoVisual('Caixa da loja').id, 'caixa');
  assert.strictEqual(F.bancoVisual('Carteira'), null);
  assert.strictEqual(F.bancoVisual('a'), null);
});
