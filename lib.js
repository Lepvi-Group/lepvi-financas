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


  /* Ritmo do orçamento (só no mês corrente): quanto já devia ter gasto e para onde caminha. */
  function ritmoOrcamento(o, mes, hoje) {
    if (mesDe(hoje) !== mes) return null;
    const [a, m] = mes.split('-').map(Number); const dias = new Date(a, m, 0).getDate(); const dia = Math.min(dias, Number(hoje.slice(8, 10)));
    const esperado = arred(o.limite * dia / dias); const projecao = arred(o.gasto / dia * dias);
    return { esperado, projecao, adiantado: o.pct < 100 && projecao > o.limite };
  }
  /* 13º salário e férias, valores brutos (antes de INSS e IR). */
  function decimoTerceiro(salario, meses) {
    const m = Math.max(0, Math.min(12, Math.floor(meses))); const total = arred(salario * m / 12);
    const primeira = arred(total / 2); return { total, primeira, segunda: arred(total - primeira) };
  }
  function ferias(salario, dias, vender) {
    const gozo = vender ? Math.min(dias, 30) - 10 : Math.min(dias, 30);
    const base = arred(salario / 30 * Math.max(0, gozo)); const terco = arred(base / 3);
    const abono = vender ? arred(salario / 30 * 10 * 4 / 3) : 0;
    return { gozo: Math.max(0, gozo), base, terco, abono, total: arred(base + terco + abono) };
  }
  /* Meu desempenho do mês: quanto sobrou da renda e há quantos dias seguidos você lança. */
  function desempenho(lancs, mes, hoje) {
    const r = resumoMes(lancs, mes);
    const taxa = r.receitas > 0 ? Math.round((r.saldo / r.receitas) * 100) : null;
    const dias = new Set(lancs.map((l) => l.data)); let seq = 0; const d = new Date(hoje + 'T12:00:00');
    if (!dias.has(hoje)) d.setDate(d.getDate() - 1);
    while (dias.has(d.toISOString().slice(0, 10))) { seq++; d.setDate(d.getDate() - 1); }
    const nota = taxa === null ? null : taxa >= 20 ? 'ótimo' : taxa >= 10 ? 'bom' : taxa >= 0 ? 'atenção' : 'no vermelho';
    return { receitas: r.receitas, despesas: r.despesas, saldo: r.saldo, taxa, sequencia: seq, nota };
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
  /* Saldo inicial que faz a conta do app bater com o saldo real do banco (o que já foi lançado continua valendo). */
  function acertarSaldoInicial(lancs, conta, saldoBanco) {
    return arred((Number(saldoBanco) || 0) - (saldoConta(lancs, conta) - conta.saldoInicial));
  }
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

  /* ---------- lançar por texto ou voz: "gastei 45 no mercado ontem" ---------- */
  function interpretarTexto(texto, hoje = hojeISO(), lancs = []) {
    const t = String(texto || '').trim(); if (!t) return null;
    const m = t.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/); if (!m) return null;
    const bruto = m[1]; const valor = /^\d+\.\d{1,2}$/.test(bruto) ? Number(bruto) : /^\d{1,3}(\.\d{3})+$/.test(bruto) ? Number(bruto.replace(/\./g, '')) : numeroBR(bruto);
    if (!(valor > 0)) return null;
    const n = normalizar(t);
    const tipo = /\b(recebi|ganhei|entrou|vendi|venda|salario|recebimento|deposito|reembolso|me pagaram|me pagou)\b/.test(n) ? 'receita' : 'despesa';
    let data = hoje;
    const dd = (k) => { const d = new Date(hoje + 'T12:00:00'); d.setDate(d.getDate() - k); return hojeISO(d); };
    const bar = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    const dia = n.match(/\bdia (\d{1,2})\b/);
    if (/\banteontem\b/.test(n)) data = dd(2); else if (/\bontem\b/.test(n)) data = dd(1);
    else if (bar && +bar[2] >= 1 && +bar[2] <= 12 && +bar[1] >= 1 && +bar[1] <= 31) { const a = bar[3] ? (bar[3].length === 2 ? '20' + bar[3] : bar[3]) : hoje.slice(0, 4); data = `${a}-${pad(+bar[2])}-${pad(diaValido(`${a}-${pad(+bar[2])}`, +bar[1]))}`; }
    else if (dia && +dia[1] >= 1 && +dia[1] <= 31) data = `${mesDe(hoje)}-${pad(diaValido(mesDe(hoje), +dia[1]))}`;
    const boleto = /\b(boleto|vence|vencimento|vai vencer)\b/.test(n);
    const futuro = boleto || /\b(vou pagar|vou receber|a receber|a pagar|receber dia|pagar dia)\b/.test(n);
    let desc = t.replace(m[0], ' ').replace(/R\$|reais|real\b/gi, ' ')
      .replace(/\b(gastei|paguei|comprei|recebi|ganhei|vendi|entrou|me pagaram|me pagou|vou pagar|vou receber|boleto|hoje|ontem|anteontem|vence|vencimento|dia|de|do|da|no|na|em|com|pra|para|um|uma)\b/gi, ' ')
      .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ').replace(/\s+/g, ' ').trim();
    desc = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : (tipo === 'receita' ? 'Receita' : 'Despesa');
    return { tipo, valor: arred(valor), desc: desc.slice(0, 60), data, categoria: sugerirCategoria(desc, tipo, lancs), pago: !futuro, boleto: tipo === 'despesa' && boleto };
  }

  /* ---------- projeção de saldo: com o que já está cadastrado (contas, parcelas, faturas) ---------- */
  function projecaoSaldo(lancs, contas, cartoes, hoje = hojeISO(), n = 4) {
    let saldo = arred(contas.filter((c) => !c.fora && c.tipo !== 'investimento').reduce((t, c) => t + saldoConta(lancs, c), 0));
    const mesAtual = mesDe(hoje); const meses = [];
    const faturasAbertas = faturas(lancs, cartoes).filter((f) => !f.paga);
    for (let i = 0; i < n; i++) {
      const mes = somaMes(mesAtual, i);
      const noMes = (data) => (i === 0 ? mesDe(data) <= mes : mesDe(data) === mes);
      const abertos = lancs.filter((l) => !l.pago && !l.ignorar && (l.tipo === 'receita' || l.tipo === 'despesa') && !ehCartao(l) && noMes(l.data));
      const entradas = arred(abertos.filter((l) => l.tipo === 'receita').reduce((t, l) => t + l.valor, 0));
      const saidas = arred(abertos.filter((l) => l.tipo === 'despesa').reduce((t, l) => t + l.valor, 0) + faturasAbertas.filter((f) => noMes(f.vencimento)).reduce((t, f) => t + f.total, 0));
      saldo = arred(saldo + entradas - saidas);
      meses.push({ mes, entradas, saidas, saldoFim: saldo });
    }
    return meses;
  }

  /* ---------- gasto fora do normal: categoria que já passou de 1,5x a média dos 3 meses anteriores ---------- */
  function gastosAnormais(lancs, mes) {
    const porMes = (mm) => resumoMes(lancs, mm).porCategoria;
    const atual = porMes(mes); const ant = [1, 2, 3].map((k) => porMes(somaMes(mes, -k)));
    return Object.keys(atual).map((cat) => {
      const media = arred(ant.reduce((t, x) => t + (x[cat] || 0), 0) / 3);
      return { categoria: cat, gasto: atual[cat], media, vezes: media ? Math.round((atual[cat] / media) * 10) / 10 : 0 };
    }).filter((x) => x.media >= 30 && x.gasto > x.media * 1.5 && x.gasto - x.media >= 50).sort((a, b) => (b.gasto - b.media) - (a.gasto - a.media));
  }

  /* ---------- reserva de emergência: quantos meses o dinheiro guardado cobre ---------- */
  function reservaEmergencia(lancs, contas, hoje = hojeISO()) {
    const mesAtual = mesDe(hoje);
    const totais = [1, 2, 3].map((k) => resumoMes(lancs, somaMes(mesAtual, -k)).despesas).filter((v) => v > 0);
    const media = totais.length ? arred(totais.reduce((t, v) => t + v, 0) / totais.length) : 0;
    const disponivel = arred(contas.filter((c) => !c.fora).reduce((t, c) => t + saldoConta(lancs, c), 0));
    const meses = media ? Math.max(0, Math.round((disponivel / media) * 10) / 10) : null;
    return { media, disponivel, meses, meta: arred(media * 6), falta: arred(Math.max(0, media * 6 - disponivel)) };
  }

  /* ---------- dívidas: bola de neve (menor saldo primeiro) ou avalanche (maior juro primeiro) ---------- */
  function simularDividas(dividas, extra, metodo) {
    let ds = dividas.map((d) => ({ nome: d.nome, saldo: Number(d.saldo) || 0, juros: (Number(d.juros) || 0) / 100, minimo: Number(d.minimo) || 0 })).filter((d) => d.saldo > 0);
    if (!ds.length) return { meses: 0, jurosTotal: 0, total: 0, ordem: [] };
    const ordenar = (a, b) => (metodo === 'bola' ? a.saldo - b.saldo : b.juros - a.juros);
    let meses = 0; let jurosTotal = 0; let pagoTotal = 0; const ordem = [];
    const orcamento = ds.reduce((t, d) => t + d.minimo, 0) + (Number(extra) || 0);
    if (ds.some((d) => d.saldo * d.juros >= orcamento) || orcamento <= 0) return { meses: null, jurosTotal: null, total: null, ordem: [], semSolucao: true };
    while (ds.some((d) => d.saldo > 0.005) && meses < 600) {
      meses += 1;
      ds.forEach((d) => { if (d.saldo > 0) { const j = arred(d.saldo * d.juros); d.saldo = arred(d.saldo + j); jurosTotal += j; } });
      let sobra = orcamento;
      ds.filter((d) => d.saldo > 0).forEach((d) => { const p = Math.min(d.minimo, d.saldo); d.saldo = arred(d.saldo - p); sobra -= p; pagoTotal += p; });
      ds.filter((d) => d.saldo > 0).sort(ordenar).forEach((d) => { const p = Math.min(sobra, d.saldo); if (p > 0) { d.saldo = arred(d.saldo - p); sobra -= p; pagoTotal += p; } });
      ds.forEach((d) => { if (d.saldo <= 0.005 && !ordem.some((o) => o.nome === d.nome)) ordem.push({ nome: d.nome, mes: meses }); });
    }
    return { meses: meses >= 600 ? null : meses, jurosTotal: arred(jurosTotal), total: arred(pagoTotal), ordem, semSolucao: meses >= 600 };
  }

  /* ---------- contas a receber: receitas ainda não recebidas ---------- */
  function aReceber(lancs, hoje = hojeISO()) {
    const itens = lancs.filter((l) => l.tipo === 'receita' && !l.pago && !l.ignorar && !ehCartao(l))
      .map((l) => ({ id: l.id, titulo: l.desc || l.categoria, valor: l.valor, vencimento: l.data, atrasado: l.data < hoje, dias: Math.round((new Date(l.data) - new Date(hoje)) / 86400000) }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    return { itens, total: arred(itens.reduce((t, i) => t + i.valor, 0)), atrasado: arred(itens.filter((i) => i.atrasado).reduce((t, i) => t + i.valor, 0)) };
  }

  /* ---------- resultado do mês (DRE simples) ---------- */
  function dreMes(lancs, mes) {
    const doMes = lancs.filter((l) => mesDe(l.data) === mes && conta_(l));
    const porCat = (tipo) => { const o = {}; doMes.filter((l) => l.tipo === tipo).forEach((l) => { o[l.categoria] = arred((o[l.categoria] || 0) + l.valor); }); return Object.entries(o).map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor); };
    const receitas = arred(doMes.filter((l) => l.tipo === 'receita').reduce((t, l) => t + l.valor, 0));
    const despesas = arred(doMes.filter((l) => l.tipo === 'despesa').reduce((t, l) => t + l.valor, 0));
    return { receitas, despesas, resultado: arred(receitas - despesas), margem: receitas ? Math.round(((receitas - despesas) / receitas) * 1000) / 10 : null, linhasReceita: porCat('receita'), linhasDespesa: porCat('despesa') };
  }

  /* ---------- MEI: faturamento do ano contra o limite (R$ 81 mil por padrão) ---------- */
  function limiteMei(lancs, ano, limite = 81000, hoje = hojeISO()) {
    const fat = arred(lancs.filter((l) => l.tipo === 'receita' && !l.ignorar && l.data.slice(0, 4) === String(ano) && ['Vendas', 'Serviços'].includes(l.categoria)).reduce((t, l) => t + l.valor, 0));
    const mesesPassados = String(ano) === hoje.slice(0, 4) ? Number(hoje.slice(5, 7)) : 12;
    const projecao = arred((fat / Math.max(1, mesesPassados)) * 12);
    return { faturamento: fat, limite, restante: arred(limite - fat), pct: limite ? Math.round((fat / limite) * 1000) / 10 : 0, projecao, vaiEstourar: projecao > limite, estourou: fat > limite };
  }

  /* saldo (bancos e carteiras que somam) ao fim de um dia, só com o que já foi pago ou recebido */
  function saldoAteDia(lancs, contas, dia) {
    const ate = lancs.filter((l) => l.data <= dia);
    return arred(contas.filter((c) => !c.fora && c.tipo !== 'investimento').reduce((t, c) => t + saldoConta(ate, c), 0));
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
  /* "Ana" divide em partes iguais (com você); "Ana:30" é a porcentagem da Ana (o resto é seu). Vale o mesmo para os outros nomes. */
  function dividir(nomes, valor, antiga) {
    const vistos = new Set();
    const lista = (nomes || []).map((n) => String(n).trim()).filter(Boolean).map((t) => { const m = t.match(/^(.*?)[:=]\s*(\d{1,3}(?:[.,]\d+)?)\s*%?$/); return m && m[1].trim() ? { nome: m[1].trim(), pct: Math.min(100, Number(m[2].replace(',', '.'))) } : { nome: t }; })
      .filter((x) => !vistos.has(x.nome.toLowerCase()) && vistos.add(x.nome.toLowerCase())).slice(0, 6);
    if (!lista.length) return undefined;
    const comPct = lista.filter((x) => x.pct !== undefined); const somaPct = comPct.reduce((t, x) => t + x.pct, 0);
    const iguais = lista.filter((x) => x.pct === undefined);
    const restoPct = Math.max(0, 100 - somaPct);
    const parteIgual = iguais.length ? arred(((valor * restoPct) / 100) / (iguais.length + 1)) : 0;
    return lista.map((x) => ({ nome: x.nome, valor: x.pct !== undefined ? arred((valor * Math.min(x.pct, 100)) / 100) : (comPct.length ? parteIgual : arred(valor / (lista.length + 1))), ...(x.pct !== undefined ? { pct: x.pct } : {}), pago: !!((antiga || []).find((o) => o.nome === x.nome) || {}).pago }));
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

  /* Quanto sobra por dia até o fim do mês: balanço previsto ÷ dias que faltam (contando hoje). Só vale para o mês atual. */
  function sobraPorDia(resumo, mes, hoje = hojeISO()) {
    if (mesDe(hoje) !== mes) return null;
    const [a, m] = mes.split('-').map(Number);
    const restam = new Date(a, m, 0).getDate() - Number(hoje.slice(8, 10)) + 1;
    return { restam, porDia: arred(Math.max(0, resumo.saldo) / restam), negativo: resumo.saldo < 0 };
  }

  /* Assinaturas: despesas que se repetem em 3 meses ou mais com valor parecido e ainda ativas (última cobrança há até 2 meses). */
  function assinaturas(lancs, hoje = hojeISO()) {
    const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
    const chave = (t) => semAcento(t).toLowerCase().replace(/\d+/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const grupos = {};
    lancs.filter((l) => l.tipo === 'despesa' && !l.ignorar && !/\d+\s*\/\s*\d+|parcela/i.test(l.desc || '')).forEach((l) => {
      const k = chave(l.desc); if (k.length < 3) return;
      (grupos[k] = grupos[k] || []).push(l);
    });
    const limite = somaMes(mesDe(hoje), -2);
    return Object.values(grupos).map((g) => {
      const porMes = {}; g.forEach((l) => { const x = porMes[mesDe(l.data)]; if (!x || l.data > x.data) porMes[mesDe(l.data)] = l; });
      const meses = Object.keys(porMes).sort(); const ult = porMes[meses[meses.length - 1]];
      const vals = meses.map((k) => porMes[k].valor).sort((a, b) => a - b); const mediana = vals[Math.floor(vals.length / 2)];
      if (meses.length < 3 || meses[meses.length - 1] < limite || Math.abs(ult.valor - mediana) > mediana * 0.15) return null;
      return { desc: ult.desc, valor: ult.valor, categoria: ult.categoria, meses: meses.length, ultima: ult.data, porAno: arred(ult.valor * 12) };
    }).filter(Boolean).sort((a, b) => b.valor - a.valor);
  }

  /* Juros compostos com aporte mensal (simulador de meta). Taxa em % ao mês. */
  function jurosCompostos(inicial, aporte, taxaMes, meses) {
    const i = (Number(taxaMes) || 0) / 100; const n = Math.max(0, Math.round(Number(meses) || 0));
    const f = Math.pow(1 + i, n);
    const total = arred((Number(inicial) || 0) * f + (Number(aporte) || 0) * (i ? (f - 1) / i : n));
    const aportado = arred((Number(inicial) || 0) + (Number(aporte) || 0) * n);
    return { total, aportado, juros: arred(total - aportado) };
  }

  /* Desafio das 52 semanas: na semana k guarda k vezes o valor base. */
  function desafio52(base) {
    const b = Number(base) || 0; let acum = 0;
    const semanas = Array.from({ length: 52 }, (_, i) => { acum = arred(acum + b * (i + 1)); return { n: i + 1, valor: arred(b * (i + 1)), acum }; });
    return { semanas, total: acum };
  }

  /* Junta duas edições feitas ao mesmo tempo (duas pessoas no mesmo espaço): base = o último que o app sincronizou, local = o que esta pessoa fez,
     remoto = o que está no servidor. Lista com id (ou nome): cada item é decidido sozinho; o que só um lado mexeu vale; no mesmo campo vale o local. */
  function juntarDados(base, local, remoto) {
    const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    const chave = (x) => (obj(x) ? (x.id !== undefined ? x.id : x.nome) : undefined);
    const mapa = (l) => { const m = new Map(); (l || []).forEach((x) => m.set(chave(x), x)); return m; };
    const juntar = (b, l, r) => {
      if (igual(l, b)) return r;
      if (igual(r, b)) return l;
      if (Array.isArray(l) && Array.isArray(r) && (b === undefined || Array.isArray(b)) && [...(b || []), ...l, ...r].every((x) => chave(x) !== undefined)) {
        const mb = mapa(b); const ml = mapa(l); const mr = mapa(r);
        const ordem = [...mr.keys(), ...[...ml.keys()].filter((k) => !mr.has(k))];
        return ordem.filter((k) => !(mb.has(k) && (!ml.has(k) || !mr.has(k)))).map((k) => (ml.has(k) && mr.has(k) ? juntar(mb.get(k), ml.get(k), mr.get(k)) : (ml.get(k) || mr.get(k))));
      }
      if (obj(l) && obj(r) && (b === undefined || obj(b))) {
        const out = {};
        [...new Set([...Object.keys(l), ...Object.keys(r)])].forEach((k) => { const v = juntar(b ? b[k] : undefined, l[k], r[k]); if (v !== undefined) out[k] = v; });
        return out;
      }
      return l;
    };
    return juntar(base, local, remoto);
  }

  const api = { ritmoOrcamento, decimoTerceiro, ferias, desempenho, acertarSaldoInicial, saldoAteDia, interpretarTexto, projecaoSaldo, gastosAnormais, reservaEmergencia, simularDividas, aReceber, dreMes, limiteMei, juntarDados, sobraPorDia, assinaturas, jurosCompostos, desafio52, contasDoMes, dividir, saldosDivisao, metaObjetivo, CATEGORIAS, catInfo, fluxoMes, sugerirCategoria, comparativo, maioresGastos, resumoPorTag, evolucao, orcamentoMes, arred, brl, mesDe, somaMes, hojeISO, faturaDe, resumoMes, faturas, aPagar, limiteUsado, saldoConta, lerOFX, lerCSV, numeroBR, ehCartao, idCartao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Fin = api;
})(typeof window !== 'undefined' ? window : globalThis);
