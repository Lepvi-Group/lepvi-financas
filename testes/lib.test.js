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

test('contasDoMes: junta boletos, contas fixas e faturas do mês, com o que já foi pago e o que falta', () => {
  const cartoes = [{ id: 'k', nome: 'Nubank', fechamento: 5, vencimento: 10, limite: 1000 }];
  const l = [
    { id: '1', tipo: 'despesa', desc: 'Internet', valor: 100, data: '2026-12-10', conta: 'c1', serie: 's', pago: false },
    { id: '2', tipo: 'despesa', desc: 'Água', valor: 150, data: '2026-12-12', conta: 'c1', serie: 't', pago: true },
    { id: '3', tipo: 'despesa', desc: 'Mercado', valor: 80, data: '2026-12-03', conta: 'c1', pago: true },
    { id: '4', tipo: 'despesa', desc: 'Internet', valor: 100, data: '2027-01-10', conta: 'c1', serie: 's', pago: false },
    { id: '5', tipo: 'despesa', desc: 'Compra', valor: 200, data: '2026-11-20', conta: 'c:k', pago: false },
  ];
  const r = F.contasDoMes(l, cartoes, '2026-12', '2026-12-05');
  assert.deepStrictEqual(r.itens.map((i) => i.titulo), ['Internet', 'Água', 'Fatura Nubank'].sort((a, b) => 0) && r.itens.map((i) => i.titulo));
  assert.ok(!r.itens.some((i) => i.titulo === 'Mercado'), 'compra à vista já paga não é conta do mês');
  assert.strictEqual(r.pago, 150); assert.strictEqual(r.total, r.pago + r.falta);
  assert.ok(r.itens.some((i) => i.tipo === 'fatura' && i.valor === 200));
});

test('sobra por dia: divide o balanço previsto pelos dias que faltam, só no mês atual', () => {
  assert.deepStrictEqual(F.sobraPorDia({ saldo: 300 }, '2026-11', '2026-11-21'), { restam: 10, porDia: 30, negativo: false });
  assert.strictEqual(F.sobraPorDia({ saldo: 300 }, '2026-10', '2026-11-21'), null);
  assert.deepStrictEqual(F.sobraPorDia({ saldo: -50 }, '2026-11', '2026-11-30'), { restam: 1, porDia: 0, negativo: true });
});
test('assinaturas: acha cobrança mensal parecida, ignora parcelas e as que acabaram', () => {
  const mk = (desc, mes, valor) => ({ tipo: 'despesa', desc, valor, data: `${mes}-05`, categoria: 'Assinaturas', conta: 'a' });
  const l = [mk('Netflix', '2026-08', 39.9), mk('NETFLIX', '2026-09', 39.9), mk('Netflix', '2026-10', 41.9), mk('Netflix', '2026-11', 41.9),
    mk('Celular 1/10', '2026-09', 200), mk('Celular 2/10', '2026-10', 200), mk('Celular 3/10', '2026-11', 200),
    mk('Academia', '2026-01', 100), mk('Academia', '2026-02', 100), mk('Academia', '2026-03', 100), mk('Mercado', '2026-10', 80)];
  const a = F.assinaturas(l, '2026-11-20');
  assert.strictEqual(a.length, 1);
  assert.deepStrictEqual([a[0].desc, a[0].valor, a[0].meses, a[0].porAno], ['Netflix', 41.9, 4, 502.8]);
});
test('juros compostos com aporte e desafio das 52 semanas', () => {
  assert.deepStrictEqual(F.jurosCompostos(0, 100, 0, 12), { total: 1200, aportado: 1200, juros: 0 });
  const j = F.jurosCompostos(1000, 100, 1, 12);
  assert.strictEqual(j.aportado, 2200); assert.ok(j.total > 2200 && j.total < 2400);
  const d = F.desafio52(1);
  assert.strictEqual(d.semanas.length, 52); assert.strictEqual(d.total, 1378); assert.strictEqual(d.semanas[51].valor, 52);
});

test('juntar edições: o que cada pessoa fez em lançamentos diferentes fica, apagar e editar o mesmo item respeita o apagar', () => {
  const l = (id, v) => ({ id, desc: id, valor: v });
  const base = { pessoal: { lancs: [l('a', 1), l('b', 2), l('c', 3)], orcamentos: { Mercado: 100 }, contas: [{ id: 'x', nome: 'Banco', saldoInicial: 0 }] } };
  const local = { pessoal: { lancs: [l('a', 1), l('b', 20), l('c', 3), l('d', 4)], orcamentos: { Mercado: 100 }, contas: [{ id: 'x', nome: 'Banco', saldoInicial: 0 }] } };
  const remoto = { pessoal: { lancs: [l('a', 1), l('b', 2), l('e', 5)], orcamentos: { Mercado: 100, Lazer: 50 }, contas: [{ id: 'x', nome: 'Banco', saldoInicial: 10 }] } };
  const r = F.juntarDados(base, local, remoto).pessoal;
  assert.deepStrictEqual(r.lancs.map((x) => x.id).sort(), ['a', 'b', 'd', 'e'], 'c foi apagado por quem está no servidor, d e e foram criados por cada um');
  assert.strictEqual(r.lancs.find((x) => x.id === 'b').valor, 20, 'edição local de b vale');
  assert.deepStrictEqual(r.orcamentos, { Mercado: 100, Lazer: 50 });
  assert.strictEqual(r.contas[0].saldoInicial, 10, 'só o servidor mexeu na conta');
});
test('juntar edições: sem mudança local vale o servidor; sem mudança no servidor vale o local; mesmo campo vale o local', () => {
  assert.deepStrictEqual(F.juntarDados({ n: 1 }, { n: 1 }, { n: 2 }), { n: 2 });
  assert.deepStrictEqual(F.juntarDados({ n: 1 }, { n: 3 }, { n: 1 }), { n: 3 });
  assert.deepStrictEqual(F.juntarDados({ n: 1 }, { n: 3 }, { n: 2 }), { n: 3 });
});

test('texto livre: valor, tipo, data, descrição e categoria', () => {
  const a = F.interpretarTexto('gastei 45,90 no mercado ontem', '2026-11-23', []);
  assert.deepStrictEqual([a.tipo, a.valor, a.data, a.desc, a.categoria, a.pago], ['despesa', 45.9, '2026-11-22', 'Mercado', 'Mercado', true]);
  const b = F.interpretarTexto('recebi 1.200 de salário dia 5', '2026-11-23', []);
  assert.deepStrictEqual([b.tipo, b.valor, b.data, b.categoria], ['receita', 1200, '2026-11-05', 'Salário']);
  const c = F.interpretarTexto('boleto da luz 150 vence 28/11', '2026-11-23', []);
  assert.deepStrictEqual([c.valor, c.data, c.boleto, c.pago], [150, '2026-11-28', true, false]);
  assert.strictEqual(F.interpretarTexto('sem número nenhum', '2026-11-23', []), null);
  assert.strictEqual(F.interpretarTexto('paguei 12.50 de uber', '2026-11-23', []).valor, 12.5);
});
test('projeção de saldo: parte do saldo de hoje e soma só o que ainda não foi pago', () => {
  const contas = [{ id: 'c', nome: 'Banco', saldoInicial: 1000 }];
  const l = [
    { id: '1', tipo: 'receita', valor: 500, data: '2026-11-25', categoria: 'Vendas', conta: 'c', pago: false },
    { id: '2', tipo: 'despesa', valor: 200, data: '2026-11-26', categoria: 'Moradia', conta: 'c', pago: false },
    { id: '3', tipo: 'despesa', valor: 300, data: '2026-12-10', categoria: 'Moradia', conta: 'c', pago: false },
    { id: '4', tipo: 'despesa', valor: 99, data: '2026-11-01', categoria: 'Moradia', conta: 'c', pago: true },
  ];
  const p = F.projecaoSaldo(l, contas, [], '2026-11-23', 3);
  assert.deepStrictEqual(p.map((x) => x.saldoFim), [1201, 901, 901]);
  assert.strictEqual(p[0].entradas, 500); assert.strictEqual(p[1].saidas, 300);
});
test('gasto fora do normal e reserva de emergência', () => {
  const mk = (mes, v, cat = 'Lazer') => ({ id: mes + cat, tipo: 'despesa', valor: v, data: `${mes}-10`, categoria: cat, conta: 'c', pago: true });
  const l = [mk('2026-08', 100), mk('2026-09', 100), mk('2026-10', 100), mk('2026-11', 400), mk('2026-08', 500, 'Moradia'), mk('2026-09', 500, 'Moradia'), mk('2026-10', 500, 'Moradia'), mk('2026-11', 520, 'Moradia')];
  const a = F.gastosAnormais(l, '2026-11');
  assert.deepStrictEqual(a.map((x) => x.categoria), ['Lazer']); assert.strictEqual(a[0].vezes, 4);
  const r = F.reservaEmergencia(l, [{ id: 'c', nome: 'B', saldoInicial: 3600 }], '2026-11-23');
  assert.strictEqual(r.media, 600); assert.strictEqual(r.meta, 3600);
  assert.ok(r.meses !== null);
});
test('dívidas: bola de neve e avalanche quitam; avalanche paga menos juros; mínimo que não cobre juros não tem solução', () => {
  const ds = [{ nome: 'Cartão', saldo: 2000, juros: 12, minimo: 100 }, { nome: 'Loja', saldo: 500, juros: 4, minimo: 50 }, { nome: 'Carro', saldo: 5000, juros: 2, minimo: 200 }];
  const av = F.simularDividas(ds, 300, 'avalanche'); const bola = F.simularDividas(ds, 300, 'bola');
  assert.ok(av.meses > 0 && bola.meses > 0);
  assert.ok(av.jurosTotal <= bola.jurosTotal);
  assert.strictEqual(av.ordem.length, 3);
  assert.strictEqual(F.simularDividas([{ nome: 'x', saldo: 10000, juros: 10, minimo: 50 }], 0, 'bola').semSolucao, true);
});
test('a receber, resultado do mês (DRE) e limite do MEI', () => {
  const l = [
    { id: 'r1', tipo: 'receita', desc: 'Cliente A', valor: 800, data: '2026-11-10', categoria: 'Serviços', conta: 'c', pago: false },
    { id: 'r2', tipo: 'receita', desc: 'Cliente B', valor: 400, data: '2026-11-30', categoria: 'Vendas', conta: 'c', pago: false },
    { id: 'r3', tipo: 'receita', desc: 'Cliente C', valor: 1000, data: '2026-11-02', categoria: 'Vendas', conta: 'c', pago: true },
    { id: 'd1', tipo: 'despesa', desc: 'Material', valor: 300, data: '2026-11-03', categoria: 'Fornecedores', conta: 'c', pago: true },
  ];
  const r = F.aReceber(l, '2026-11-23');
  assert.deepStrictEqual([r.itens.length, r.total, r.atrasado, r.itens[0].atrasado], [2, 1200, 800, true]);
  const d = F.dreMes(l, '2026-11');
  assert.deepStrictEqual([d.receitas, d.despesas, d.resultado, d.margem], [2200, 300, 1900, 86.4]);
  const m = F.limiteMei(l, 2026, 81000, '2026-11-23');
  assert.strictEqual(m.faturamento, 2200); assert.strictEqual(m.vaiEstourar, false);
  assert.strictEqual(F.limiteMei(l, 2026, 2000, '2026-11-23').estourou, true);
});
test('divisão: partes iguais continuam e porcentagem por pessoa funciona', () => {
  assert.deepStrictEqual(F.dividir(['Ana', 'Beto'], 90).map((x) => x.valor), [30, 30]);
  const p = F.dividir(['Ana:60'], 100); assert.deepStrictEqual([p[0].nome, p[0].valor, p[0].pct], ['Ana', 60, 60]);
  const q = F.dividir(['Ana:50', 'Beto'], 100); assert.deepStrictEqual(q.map((x) => x.valor), [50, 25]);
});

test('saldo ao fim do dia soma só o que já foi pago até aquele dia', () => {
  const contas = [{ id: 'c', nome: 'B', saldoInicial: 100 }];
  const l = [{ id: '1', tipo: 'receita', valor: 50, data: '2026-11-02', conta: 'c', pago: true, categoria: 'x' }, { id: '2', tipo: 'despesa', valor: 30, data: '2026-11-05', conta: 'c', pago: true, categoria: 'x' }, { id: '3', tipo: 'despesa', valor: 999, data: '2026-11-03', conta: 'c', pago: false, categoria: 'x' }];
  assert.deepStrictEqual(['2026-11-01', '2026-11-04', '2026-11-05'].map((d) => F.saldoAteDia(l, contas, d)), [100, 150, 120]);
});
