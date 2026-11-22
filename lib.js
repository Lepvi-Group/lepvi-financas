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
      itens.push({ tipo: l.boleto ? 'boleto' : 'conta', id: l.id, titulo: l.desc, valor: l.valor, vencimento: l.data, categoria: l.categoria });
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

  /* Fluxo de caixa do mês (ideia do Organizze, refeita): saldo no começo do mês e saldo previsto dia a dia.
     Cartão entra pelo vencimento da fatura, não pela data da compra. */
  function fluxoMes(lancs, contas, cartoes, mes) {
    const [a, mm] = mes.split('-').map(Number);
    const totalDias = new Date(a, mm, 0).getDate();
    const contaDe = (id) => contas.find((c) => c.id === id);
    let saldo = contas.filter((c) => !c.fora).reduce((s, c) => s + c.saldoInicial, 0);
    lancs.forEach((l) => {
      if (!l.pago || l.data >= `${mes}-01` || l.tipo === 'transf' || ehCartao(l)) return;
      const c = contaDe(l.conta);
      if (c && !c.fora) saldo += l.tipo === 'receita' ? l.valor : -l.valor;
    });
    saldo = arred(saldo);
    const porDia = {};
    const add = (data, tipo, valor, titulo, pago) => { if (mesDe(data) === mes) (porDia[data] = porDia[data] || []).push({ tipo, valor, titulo, pago }); };
    lancs.forEach((l) => {
      if (l.tipo === 'transf' || ehCartao(l)) return;
      const c = contaDe(l.conta);
      if (c && !c.fora) add(l.data, l.tipo, l.valor, l.desc || l.categoria, !!l.pago);
    });
    faturas(lancs, cartoes).filter((f) => !f.paga).forEach((f) => add(f.vencimento, 'despesa', f.total, 'Fatura ' + f.cartao, false));
    let acum = saldo; let ent = 0; let sai = 0; const dias = [];
    for (let d = 1; d <= totalDias; d++) {
      const data = `${mes}-${pad(d)}`; const itens = porDia[data] || [];
      const e = arred(itens.filter((x) => x.tipo === 'receita').reduce((s, x) => s + x.valor, 0));
      const s = arred(itens.filter((x) => x.tipo === 'despesa').reduce((t, x) => t + x.valor, 0));
      acum = arred(acum + e - s); ent += e; sai += s;
      dias.push({ dia: d, data, entradas: e, saidas: s, saldo: acum, itens });
    }
    const negativo = dias.find((x) => x.saldo < 0) || null;
    return { saldoInicial: saldo, entradas: arred(ent), saidas: arred(sai), saldoFinal: acum, dias, primeiroNegativo: negativo };
  }

  /* ---------- sugestão de categoria ao importar (histórico da própria pessoa + regras prontas) ---------- */
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const REGRAS_DESPESA = [
    [/super|mercad|atacad|hortifruti|sacolao|assai|carrefour|acougue|feira/, 'Mercado'],
    [/ifood|restaur|lanchon|padaria|pizza|burger|cafe |cafeteria|sorvet|bar /, 'Alimentacao'],
    [/uber|99 ?pop|99app|posto|shell|ipiranga|combust|estacion|pedagio|sem parar|metro|onibus|passagem|gasolina/, 'Transporte'],
    [/netflix|spotify|prime|disney|hbo|youtube|apple com|google one|google play|deezer|globoplay|assinatura/, 'Assinaturas'],
    [/farmacia|drogaria|drogasil|raia|pacheco|hospital|clinica|laborat|dentista|consulta|unimed|plano de saude/, 'Saude'],
    [/escola|faculdade|curso|udemy|livraria|mensalidade/, 'Educacao'],
    [/cinema|teatro|show|ingresso|steam|playstation|xbox|hotel|airbnb|booking|viagem/, 'Lazer'],
    [/aluguel|condominio|energia|enel|cemig|luz |agua|sabesp|copasa|internet|vivo|claro|tim |oi |gas /, 'Moradia'],
    [/imposto|iptu|ipva|darf|simples|taxa/, 'Impostos'],
  ];
  const REGRAS_RECEITA = [[/salario|pro labore|folha/, 'Salário'], [/venda|pix recebido|recebimento/, 'Vendas'], [/rendimento|juros|dividendo/, 'Rendimentos'], [/reembolso|estorno/, 'Reembolso']];
  const SEM_ACENTO = { Alimentacao: 'Alimentação', Saude: 'Saúde', Educacao: 'Educação' };
  function sugerirCategoria(desc, tipo, lancs) {
    const n = normalizar(desc); if (!n) return 'Outros';
    const chave = n.split(' ').slice(0, 2).join(' '); const cont = {};
    (lancs || []).forEach((l) => { if (l.tipo === tipo && l.categoria && l.categoria !== 'Outros' && normalizar(l.desc).split(' ').slice(0, 2).join(' ') === chave) cont[l.categoria] = (cont[l.categoria] || 0) + 1; });
    const top = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
    if (top) return top[0];
    for (const [re, cat] of (tipo === 'receita' ? REGRAS_RECEITA : REGRAS_DESPESA)) if (re.test(n + ' ')) return SEM_ACENTO[cat] || cat;
    return 'Outros';
  }

  /* ---------- relatórios ---------- */
  function comparativo(lancs, mes) {
    const at = resumoMes(lancs, mes); const an = resumoMes(lancs, somaMes(mes, -1));
    const cats = [...new Set([...Object.keys(at.porCategoria), ...Object.keys(an.porCategoria)])].map((c) => {
      const a = at.porCategoria[c] || 0; const b = an.porCategoria[c] || 0;
      return { categoria: c, atual: a, anterior: b, diff: arred(a - b), pct: b ? Math.round(((a - b) / b) * 100) : null };
    }).filter((x) => x.diff !== 0).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
    return { atual: at, anterior: an, categorias: cats };
  }
  const maioresGastos = (lancs, mes, n = 10) => lancs.filter((l) => l.tipo === 'despesa' && !l.ignorar && mesDe(l.data) === mes).sort((a, b) => b.valor - a.valor).slice(0, n);
  function resumoPorTag(lancs, mes) {
    const o = {};
    lancs.filter((l) => l.tipo === 'despesa' && !l.ignorar && mesDe(l.data) === mes).forEach((l) => (l.tags || []).forEach((t) => { o[t] = arred((o[t] || 0) + l.valor); }));
    return o;
  }

  /* divisão de despesa: quem ainda deve a sua parte (a despesa fica inteira no lançamento, a parte dos outros é um valor a receber) */
  function dividir(nomes, valor, antiga) {
    const vistos = new Set(); const lista = (nomes || []).map((n) => String(n).trim()).filter((n) => n && !vistos.has(n.toLowerCase()) && vistos.add(n.toLowerCase())).slice(0, 6);
    if (!lista.length) return undefined;
    const parte = arred(valor / (lista.length + 1));
    return lista.map((nome) => ({ nome, valor: parte, pago: !!((antiga || []).find((x) => x.nome === nome) || {}).pago }));
  }
  function saldosDivisao(lancs) {
    const m = {};
    lancs.filter((l) => l.tipo === 'despesa' && l.divisao).forEach((l) => l.divisao.filter((x) => !x.pago).forEach((x) => {
      const o = (m[x.nome] = m[x.nome] || { nome: x.nome, total: 0, itens: [] });
      o.total = arred(o.total + x.valor); o.itens.push({ id: l.id, desc: l.desc, data: l.data, valor: x.valor });
    }));
    return Object.values(m).sort((a, b) => b.total - a.total);
  }
  /* meta de economia: quanto falta, quanto guardar por mês e como está o mês atual (aportes têm data) */
  function metaObjetivo(o, mes) {
    const falta = Math.max(0, arred(o.meta - o.guardado));
    const restam = o.prazo ? Math.max(1, (Number(o.prazo.slice(0, 4)) - Number(mes.slice(0, 4))) * 12 + Number(o.prazo.slice(5, 7)) - Number(mes.slice(5, 7)) + 1) : 0;
    const sugerido = restam ? arred(falta / restam) : 0;
    const planejado = o.mensal > 0 ? o.mensal : sugerido;
    const noMes = arred((o.aportes || []).filter((a) => mesDe(a.data) === mes).reduce((t, a) => t + a.valor, 0));
    return { falta, restam, sugerido, planejado, noMes, pctMes: planejado ? Math.min(100, Math.round((noMes / planejado) * 100)) : 0, noAlvo: !planejado || noMes >= planejado };
  }

  /* visão de um mês: boletos, contas fixas/parceladas, pendências e faturas que vencem nele (pagas e não pagas) */
  function contasDoMes(lancs, cartoes, mes, hoje = hojeISO()) {
    const itens = [];
    lancs.filter((l) => l.tipo === 'despesa' && !ehCartao(l) && mesDe(l.data) === mes && (l.boleto || l.serie || !l.pago))
      .forEach((l) => itens.push({ tipo: l.boleto ? 'boleto' : 'conta', id: l.id, titulo: l.desc, valor: l.valor, vencimento: l.data, pago: !!l.pago, categoria: l.categoria }));
    faturas(lancs, cartoes).filter((f) => mesDe(f.vencimento) === mes)
      .forEach((f) => itens.push({ tipo: 'fatura', id: `${f.cartaoId}|${f.mes}`, titulo: `Fatura ${f.cartao}`, valor: f.total, vencimento: f.vencimento, pago: !!f.paga }));
    const lista = itens.map((i) => ({ ...i, atrasado: !i.pago && i.vencimento < hoje, dias: Math.round((new Date(i.vencimento) - new Date(hoje)) / 86400000) })).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const total = arred(lista.reduce((t, i) => t + i.valor, 0)); const pago = arred(lista.filter((i) => i.pago).reduce((t, i) => t + i.valor, 0));
    return { itens: lista, total, pago, falta: arred(total - pago) };
  }

  const api = { contasDoMes, dividir, saldosDivisao, metaObjetivo, CATEGORIAS, catInfo, fluxoMes, sugerirCategoria, comparativo, maioresGastos, resumoPorTag, evolucao, orcamentoMes, arred, brl, mesDe, somaMes, hojeISO, faturaDe, resumoMes, faturas, aPagar, limiteUsado, saldoConta, lerOFX, lerCSV, numeroBR, ehCartao, idCartao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Fin = api;
})(typeof window !== 'undefined' ? window : globalThis);
