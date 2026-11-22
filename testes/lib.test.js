const test = require('node:test');
const assert = require('node:assert');
const F = require('../lib.js');

const nu = { id: 'n', nome: 'Nubank', limite: 5000, fechamento: 25, vencimento: 5 };
const it = { id: 'i', nome: 'Itaú', limite: 9000, fechamento: 10, vencimento: 17 };

test('fatura: compra até o fechamento vai para o vencimento do mês seguinte', () => {
  assert.deepStrictEqual(F.faturaDe(nu, '2026-11-20'), { mes: '2026-12', vencimento: '2026-12-05' });
});
test('fatura: compra depois do fechamento pula uma fatura', () => {
  assert.deepStrictEqual(F.faturaDe(nu, '2026-11-26'), { mes: '2027-01', vencimento: '2027-01-05' });
});
test('fatura: vencimento depois do fechamento fica no mesmo mês', () => {
  assert.deepStrictEqual(F.faturaDe(it, '2026-11-09'), { mes: '2026-11', vencimento: '2026-11-17' });
  assert.deepStrictEqual(F.faturaDe(it, '2026-11-11'), { mes: '2026-12', vencimento: '2026-12-17' });
});
test('vencimento 31 em mês curto usa o último dia', () => {
  const c = { id: 'x', nome: 'X', limite: 1, fechamento: 1, vencimento: 31 };
  assert.strictEqual(F.faturaDe(c, '2026-02-01').vencimento, '2026-02-28');
});
test('resumo do mês soma receitas, despesas e categorias', () => {
  const l = [
    { tipo: 'receita', valor: 1000, data: '2026-11-02', categoria: 'Salário', conta: 'a' },
    { tipo: 'despesa', valor: 300.1, data: '2026-11-05', categoria: 'Mercado', conta: 'a' },
    { tipo: 'despesa', valor: 99.9, data: '2026-11-06', categoria: 'Mercado', conta: 'a' },
    { tipo: 'despesa', valor: 50, data: '2026-10-06', categoria: 'Lazer', conta: 'a' },
  ];
  const r = F.resumoMes(l, '2026-11');
  assert.strictEqual(r.saldo, 600);
  assert.strictEqual(r.porCategoria.Mercado, 400);
});
test('a pagar junta boletos e faturas, atrasados primeiro', () => {
  const l = [
    { id: '1', tipo: 'despesa', valor: 100, data: '2026-11-25', desc: 'Luz', conta: 'a', pago: false, boleto: true },
    { id: '2', tipo: 'despesa', valor: 80, data: '2026-11-10', desc: 'Net', conta: 'a', pago: false, boleto: true },
    { id: '3', tipo: 'despesa', valor: 200, data: '2026-11-12', desc: 'Compra', conta: 'c:n', pago: false },
    { id: '4', tipo: 'despesa', valor: 70, data: '2026-11-13', desc: 'Já paga', conta: 'a', pago: true },
  ];
  const p = F.aPagar(l, [nu], '2026-11-21');
  assert.deepStrictEqual(p.map((i) => i.tipo), ['boleto', 'boleto', 'fatura']);
  assert.strictEqual(p[0].atrasado, true);
  assert.strictEqual(p[2].valor, 200);
});
test('limite usado ignora compras já pagas', () => {
  const l = [
    { tipo: 'despesa', valor: 300, data: '2026-11-01', conta: 'c:n', pago: false },
    { tipo: 'despesa', valor: 100, data: '2026-10-01', conta: 'c:n', pago: true },
  ];
  assert.strictEqual(F.limiteUsado(l, 'n'), 300);
});
test('saldo da conta conta só o que foi pago', () => {
  const l = [
    { tipo: 'receita', valor: 500, conta: 'a', pago: true },
    { tipo: 'despesa', valor: 120, conta: 'a', pago: true },
    { tipo: 'despesa', valor: 999, conta: 'a', pago: false },
  ];
  assert.strictEqual(F.saldoConta(l, { id: 'a', saldoInicial: 100 }), 480);
});
test('lê OFX de banco', () => {
  const ofx = '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105120000[-3:BRT]<TRNAMT>-45.90<FITID>1<MEMO>PADARIA CENTRAL</STMTTRN><STMTTRN><DTPOSTED>20261106<TRNAMT>2500.00<MEMO>PIX RECEBIDO</STMTTRN>';
  const r = F.lerOFX(ofx);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual([r[0].tipo, r[0].valor, r[0].data], ['despesa', 45.9, '2026-11-05']);
  assert.strictEqual(r[1].tipo, 'receita');
});
test('transferência move saldo entre contas e fica fora do resumo', () => {
  const l = [{ tipo: 'transf', valor: 200, conta: 'a', destino: 'b', data: '2026-11-03', pago: true }];
  assert.strictEqual(F.saldoConta(l, { id: 'a', saldoInicial: 500 }), 300);
  assert.strictEqual(F.saldoConta(l, { id: 'b', saldoInicial: 0 }), 200);
  assert.strictEqual(F.resumoMes(l, '2026-11').despesas, 0);
});
test('pagamento de fatura (ignorar) não duplica a despesa no resumo', () => {
  const l = [
    { tipo: 'despesa', valor: 300, data: '2026-11-03', categoria: 'Mercado', conta: 'c:n', pago: true },
    { tipo: 'despesa', valor: 300, data: '2026-11-20', categoria: 'Cartão', conta: 'a', pago: true, ignorar: true },
  ];
  assert.strictEqual(F.resumoMes(l, '2026-11').despesas, 300);
  assert.strictEqual(F.saldoConta(l, { id: 'a', saldoInicial: 1000 }), 700);
});
test('orçamento mostra gasto, restante e percentual por categoria', () => {
  const l = [{ tipo: 'despesa', valor: 450, data: '2026-11-03', categoria: 'Mercado', conta: 'a', pago: true }];
  const o = F.orcamentoMes(l, { Mercado: 500, Lazer: 200 }, '2026-11');
  assert.deepStrictEqual([o[0].categoria, o[0].pct, o[0].restante], ['Mercado', 90, 50]);
});
test('evolução devolve os últimos meses em ordem', () => {
  const e = F.evolucao([], '2026-02', 3);
  assert.deepStrictEqual(e.map((x) => x.mes), ['2025-12', '2026-01', '2026-02']);
});
test('fluxo de caixa: saldo previsto dia a dia, fatura no vencimento e aviso de saldo negativo', () => {
  const contas = [{ id: 'a', nome: 'Banco', saldoInicial: 1000 }];
  const cartoes = [{ id: 'n', nome: 'Nubank', limite: 5000, fechamento: 25, vencimento: 5 }];
  const l = [
    { id: '1', tipo: 'receita', valor: 500, data: '2026-12-02', conta: 'a', pago: false, categoria: 'Vendas', desc: 'Venda' },
    { id: '2', tipo: 'despesa', valor: 1200, data: '2026-12-03', conta: 'a', pago: false, categoria: 'Moradia', desc: 'Aluguel' },
    { id: '3', tipo: 'despesa', valor: 700, data: '2026-11-20', conta: 'c:n', pago: false, categoria: 'Mercado', desc: 'Compra' },
    { id: '4', tipo: 'despesa', valor: 100, data: '2026-11-10', conta: 'a', pago: true, categoria: 'Lazer', desc: 'Cinema' },
  ];
  const f = F.fluxoMes(l, contas, cartoes, '2026-12');
  assert.strictEqual(f.saldoInicial, 900, 'saldo no começo do mês considera o que já foi pago');
  assert.strictEqual(f.dias[1].saldo, 1400);
  assert.strictEqual(f.dias[2].saldo, 200);
  assert.strictEqual(f.dias[4].saldo, -500, 'fatura entra no dia do vencimento (05/12)');
  assert.strictEqual(f.primeiroNegativo.dia, 5);
  assert.strictEqual(f.saldoFinal, -500);
});
test('sugere categoria pelo histórico da pessoa e, sem histórico, por regras prontas', () => {
  const hist = [{ tipo: 'despesa', desc: 'PADARIA DO ZE 123', categoria: 'Alimentação' }, { tipo: 'despesa', desc: 'Padaria do Ze', categoria: 'Alimentação' }, { tipo: 'despesa', desc: 'Padaria do Ze', categoria: 'Outros' }];
  assert.strictEqual(F.sugerirCategoria('PADARIA DO ZE - SP', 'despesa', hist), 'Alimentação');
  assert.strictEqual(F.sugerirCategoria('UBER *TRIP', 'despesa', []), 'Transporte');
  assert.strictEqual(F.sugerirCategoria('NETFLIX.COM', 'despesa', []), 'Assinaturas');
  assert.strictEqual(F.sugerirCategoria('SUPERMERCADO BH', 'despesa', []), 'Mercado');
  assert.strictEqual(F.sugerirCategoria('DROGARIA SAO PAULO', 'despesa', []), 'Saúde');
  assert.strictEqual(F.sugerirCategoria('PIX RECEBIDO JOAO', 'receita', []), 'Vendas');
  assert.strictEqual(F.sugerirCategoria('XPTO 999', 'despesa', []), 'Outros');
});
test('comparativo com o mês anterior, maiores gastos e gastos por etiqueta', () => {
  const l = [
    { tipo: 'despesa', valor: 500, data: '2026-10-05', categoria: 'Mercado', conta: 'a' },
    { tipo: 'despesa', valor: 650, data: '2026-11-05', categoria: 'Mercado', conta: 'a', tags: ['casa'] },
    { tipo: 'despesa', valor: 80, data: '2026-11-06', categoria: 'Lazer', conta: 'a', tags: ['casa', 'viagem'] },
    { tipo: 'receita', valor: 3000, data: '2026-11-02', categoria: 'Salário', conta: 'a' },
  ];
  const c = F.comparativo(l, '2026-11');
  assert.deepStrictEqual([c.atual.despesas, c.anterior.despesas, c.categorias[0].categoria, c.categorias[0].diff, c.categorias[0].pct], [730, 500, 'Mercado', 150, 30]);
  assert.strictEqual(F.maioresGastos(l, '2026-11', 1)[0].valor, 650);
  assert.deepStrictEqual(F.resumoPorTag(l, '2026-11'), { casa: 730, viagem: 80 });
});
test('lê CSV com data brasileira e valor com vírgula', () => {
  const r = F.lerCSV('data;descricao;valor\n05/11/2026;Mercado;-1.234,56\n06/11/2026;Venda;300,00');
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual([r[0].tipo, r[0].valor, r[0].data], ['despesa', 1234.56, '2026-11-05']);
});

test('dividir: parte igual para cada pessoa e mantém quem já acertou', () => {
  const d = F.dividir(['Ana', 'Beto', 'ana '], 90, [{ nome: 'Ana', valor: 30, pago: true }]);
  assert.deepStrictEqual(d.map((x) => [x.nome, x.valor, x.pago]), [['Ana', 30, true], ['Beto', 30, false]]);
  assert.strictEqual(F.dividir([], 90), undefined);
});
test('saldosDivisao: soma só o que ainda não foi acertado, por pessoa', () => {
  const l = [{ id: '1', tipo: 'despesa', desc: 'Jantar', data: '2026-11-01', valor: 90, divisao: [{ nome: 'Ana', valor: 45, pago: false }] }, { id: '2', tipo: 'despesa', desc: 'Luz', data: '2026-11-02', valor: 80, divisao: [{ nome: 'Ana', valor: 40, pago: false }, { nome: 'Beto', valor: 40, pago: true }] }];
  const s = F.saldosDivisao(l);
  assert.strictEqual(s.length, 1); assert.strictEqual(s[0].nome, 'Ana'); assert.strictEqual(s[0].total, 85);
});
test('metaObjetivo: sugere o valor mensal pelo prazo e acompanha o mês', () => {
  const o = { meta: 6000, guardado: 2400, prazo: '2027-06', aportes: [{ data: '2026-11-05', valor: 200 }, { data: '2026-10-05', valor: 999 }] };
  const r = F.metaObjetivo(o, '2026-11');
  assert.strictEqual(r.falta, 3600); assert.strictEqual(r.restam, 8); assert.strictEqual(r.sugerido, 450);
  assert.strictEqual(r.noMes, 200); assert.strictEqual(r.pctMes, 44); assert.strictEqual(r.noAlvo, false);
  assert.strictEqual(F.metaObjetivo({ ...o, mensal: 100 }, '2026-11').noAlvo, true);
});
