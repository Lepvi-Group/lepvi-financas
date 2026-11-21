/* Lepvi Finanças: regras puras (sem tela), testadas em testes/lib.test.js */
(function (raiz) {
  /* Categorias com ícone e cor (como o Mobills). */
  const C = (nome, icone, cor) => ({ nome, icone, cor });
  const CATEGORIAS = {
    despesa: [C('Moradia', '🏠', '#5B6CFF'), C('Mercado', '🛒', '#F59E0B'), C('Alimentação', '🍽️', '#EF6C3C'), C('Transporte', '🚗', '#0EA5E9'), C('Saúde', '💊', '#10B981'), C('Educação', '🎓', '#8A3DFF'), C('Lazer', '🎬', '#EC4899'), C('Assinaturas', '📺', '#6366F1'), C('Impostos', '🏛️', '#64748B'), C('Fornecedores', '📦', '#0D9488'), C('Folha e pró-labore', '👥', '#7C3AED'), C('Marketing', '📣', '#C04DFF'), C('Cartão', '💳', '#334155'), C('Outros', '🧩', '#94A3B8')],
    receita: [C('Salário', '💼', '#10B981'), C('Vendas', '🛍️', '#2D4BFF'), C('Serviços', '🧰', '#0EA5E9'), C('Rendimentos', '📈', '#8A3DFF'), C('Reembolso', '↩️', '#F59E0B'), C('Outros', '🧩', '#94A3B8')],
  };
  const catInfo = (nome, tipo) => (CATEGORIAS[tipo] || CATEGORIAS.despesa).concat(CATEGORIAS.despesa, CATEGORIAS.receita).find((c) => c.nome === nome) || C(nome || 'Outros', '🧩', '#94A3B8');

  const arred = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const brl = (n) => arred(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pad = (n) => String(n).padStart(2, '0');
  const mesDe = (iso) => String(iso).slice(0, 7);
  const hojeISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function somaMes(mes, delta) {
    const [a, m] = mes.split('-').map(Number);
    const t = a * 12 + (m - 1) + delta;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  }

  function diaValido(mes, dia) {
    const [a, m] = mes.split('-').map(Number);
    return Math.min(dia, new Date(a, m, 0).getDate());
  }

  /* Compra no cartão: depois do fechamento cai na fatura do mês seguinte. Devolve mês e data de vencimento. */
  function faturaDe(cartao, dataISO) {
    const dia = Number(dataISO.slice(8, 10));
    const mesCompra = mesDe(dataISO);
    const mesFecha = dia > cartao.fechamento ? somaMes(mesCompra, 1) : mesCompra;
    // vencimento depois do fechamento fica no mesmo mês; senão, no mês seguinte
    const mesVenc = cartao.vencimento > cartao.fechamento ? mesFecha : somaMes(mesFecha, 1);
    return { mes: mesVenc, vencimento: `${mesVenc}-${pad(diaValido(mesVenc, cartao.vencimento))}` };
  }

  const ehCartao = (l) => typeof l.conta === 'string' && l.conta.startsWith('c:');
  const idCartao = (l) => l.conta.slice(2);

  /* Resumo do mês pela data da compra (competência). */
  const conta_ = (l) => (l.tipo === 'receita' || l.tipo === 'despesa') && !l.ignorar;
  function resumoMes(lancs, mes) {
    const doMes = lancs.filter((l) => mesDe(l.data) === mes && conta_(l));
    const soma = (f) => arred(doMes.filter(f).reduce((s, l) => s + l.valor, 0));
    const receitas = soma((l) => l.tipo === 'receita');
    const despesas = soma((l) => l.tipo === 'despesa');
    const porCategoria = {};
    doMes.filter((l) => l.tipo === 'despesa').forEach((l) => {
      porCategoria[l.categoria] = arred((porCategoria[l.categoria] || 0) + l.valor);
    });
    return {
      receitas, despesas, saldo: arred(receitas - despesas), porCategoria,
      recebido: soma((l) => l.tipo === 'receita' && l.pago), pago: soma((l) => l.tipo === 'despesa' && (l.pago || ehCartao(l))),
    };
  }

  /* Últimos n meses terminando em mesFim: para o gráfico de evolução. */
  function evolucao(lancs, mesFim, n = 6) {
    const meses = Array.from({ length: n }, (_, i) => somaMes(mesFim, i - (n - 1)));
    return meses.map((mes) => ({ mes, ...resumoMes(lancs, mes) }));
  }

  /* Orçamento por categoria: gasto do mês x limite. */
  function orcamentoMes(lancs, orcamentos, mes) {
    const gasto = resumoMes(lancs, mes).porCategoria;
    return Object.entries(orcamentos || {}).filter(([, v]) => v > 0).map(([cat, limite]) => {
      const g = gasto[cat] || 0;
      return { categoria: cat, limite, gasto: g, restante: arred(limite - g), pct: Math.round((g / limite) * 100) };
    }).sort((a, b) => b.pct - a.pct);
  }

  /* Faturas de cartão, agrupadas por cartão e mês de vencimento. */
  function faturas(lancs, cartoes) {
    const mapa = {};
    lancs.filter((l) => ehCartao(l) && l.tipo === 'despesa').forEach((l) => {
      const c = cartoes.find((x) => x.id === idCartao(l));
      if (!c) return;
      const f = faturaDe(c, l.data);
      const chave = `${c.id}|${f.mes}`;
      mapa[chave] = mapa[chave] || { cartaoId: c.id, cartao: c.nome, mes: f.mes, vencimento: f.vencimento, total: 0, itens: [], paga: true };
      mapa[chave].total = arred(mapa[chave].total + l.valor);
      mapa[chave].itens.push(l);
      if (!l.pago) mapa[chave].paga = false;
    });
    return Object.values(mapa).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  /* Tudo que ainda precisa ser pago: boletos/contas pendentes e faturas abertas. Ordenado por vencimento. */
  function aPagar(lancs, cartoes, hoje = hojeISO()) {
    const itens = [];
    lancs.filter((l) => l.tipo === 'despesa' && !ehCartao(l) && !l.pago).forEach((l) => {
      itens.push({ tipo: l.boleto ? 'boleto' : 'conta', id: l.id, titulo: l.desc, valor: l.valor, vencimento: l.data });
    });
    faturas(lancs, cartoes).filter((f) => !f.paga).forEach((f) => {
      itens.push({ tipo: 'fatura', id: `${f.cartaoId}|${f.mes}`, titulo: `Fatura ${f.cartao}`, valor: f.total, vencimento: f.vencimento });
    });
    return itens
      .map((i) => ({ ...i, atrasado: i.vencimento < hoje, dias: Math.round((new Date(i.vencimento) - new Date(hoje)) / 86400000) }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  /* Limite usado = soma das compras ainda não pagas do cartão. */
  function limiteUsado(lancs, cartaoId) {
    return arred(lancs.filter((l) => ehCartao(l) && idCartao(l) === cartaoId && l.tipo === 'despesa' && !l.pago).reduce((s, l) => s + l.valor, 0));
  }

  /* Saldo de uma conta: saldo inicial + receitas pagas - despesas pagas (fora de cartão). */
  function saldoConta(lancs, conta) {
    let mov = 0;
    lancs.forEach((l) => {
      if (!l.pago) return;
      if (l.tipo === 'transf') { if (l.conta === conta.id) mov -= l.valor; if (l.destino === conta.id) mov += l.valor; return; }
      if (l.conta !== conta.id) return;
      mov += l.tipo === 'receita' ? l.valor : -l.valor;
    });
    return arred(conta.saldoInicial + mov);
  }

  function numeroBR(txt) {
    let s = String(txt).trim().replace(/[R$\s]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return Number(s);
  }

  /* Extrato OFX (formato dos bancos brasileiros): devolve lançamentos prontos para revisar. */
  function lerOFX(texto) {
    const blocos = texto.split(/<STMTTRN>/i).slice(1);
    return blocos.map((b) => {
      const pega = (tag) => { const m = b.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')); return m ? m[1].trim() : ''; };
      const v = Number(pega('TRNAMT').replace(',', '.'));
      const d = pega('DTPOSTED').slice(0, 8);
      if (!d || Number.isNaN(v)) return null;
      return {
        tipo: v < 0 ? 'despesa' : 'receita',
        valor: arred(Math.abs(v)),
        data: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        desc: pega('MEMO') || pega('NAME') || 'Lançamento importado',
        categoria: 'Outros',
        pago: true,
      };
    }).filter(Boolean);
  }

  /* CSV simples: data;descrição;valor (negativo = despesa). Aceita vírgula ou ponto e vírgula. */
  function lerCSV(texto) {
    return texto.split(/\r?\n/).map((linha) => {
      const col = linha.split(linha.includes(';') ? ';' : ',').map((c) => c.replace(/^"|"$/g, '').trim());
      if (col.length < 3) return null;
      let data = col[0];
      const br = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (br) data = `${br[3]}-${br[2]}-${br[1]}`;
      const v = numeroBR(col[2]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(v)) return null;
      return { tipo: v < 0 ? 'despesa' : 'receita', valor: arred(Math.abs(v)), data, desc: col[1] || 'Lançamento importado', categoria: 'Outros', pago: true };
    }).filter(Boolean);
  }

  const api = { CATEGORIAS, catInfo, evolucao, orcamentoMes, arred, brl, mesDe, somaMes, hojeISO, faturaDe, resumoMes, faturas, aPagar, limiteUsado, saldoConta, lerOFX, lerCSV, numeroBR, ehCartao, idCartao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Fin = api;
})(typeof window !== 'undefined' ? window : globalThis);
