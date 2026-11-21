/* Lepvi Finanças: telas e ações. As regras de cálculo ficam em lib.js (window.Fin). */
(function () {
  const F = window.Fin;
  const CHAVE = 'lepvi-financas-v1';
  const CORES = ['#2D4BFF', '#8A3DFF', '#C04DFF', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#0D0D0F'];
  const vazio = () => ({ contas: [{ id: 'carteira', nome: 'Carteira', saldoInicial: 0, cor: '#10B981' }], cartoes: [], lancs: [], orcamentos: {}, objetivos: [] });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);

  function norm(s) {
    s.dados = s.dados || {};
    ['pessoal', 'empresa'].forEach((p) => {
      const d = (s.dados[p] = Object.assign(vazio(), s.dados[p] || {}));
      d.contas.forEach((c, i) => { c.cor = c.cor || CORES[i % CORES.length]; });
      d.cartoes.forEach((c, i) => { c.cor = c.cor || CORES[(i + 1) % CORES.length]; });
    });
    s.perfil = s.perfil || 'pessoal';
    return s;
  }
  function carregar() {
    try { const s = JSON.parse(localStorage.getItem(CHAVE)); if (s && s.dados) return norm(s); } catch (e) { /* começa vazio */ }
    return norm({ perfil: 'pessoal', dados: {} });
  }
  const S = carregar();
  const V = { tela: 'inicio', mes: F.mesDe(F.hojeISO()), filtro: 'todos', sub: 'todos', q: '', plano: 'orc', reltipo: 'despesa', cartao: null, fmes: null };
  const D = () => S.dados[S.perfil];
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(S)); } catch (e) { aviso('Não consegui salvar neste navegador.'); } };
  const m = (v) => (S.oculto ? 'R$ •••' : F.brl(v));
  function aviso(t) { const el = $('#aviso'); el.textContent = t; el.classList.add('on'); clearTimeout(aviso.t); aviso.t = setTimeout(() => el.classList.remove('on'), 2600); }

  const NOME_MES = (x) => new Date(x + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long' }) + ' ' + x.slice(0, 4);
  const MES_CURTO = (x) => new Date(x + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const DIA_LONGO = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '');
  const DATA_CURTA = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const ontem = () => { const x = new Date(); x.setDate(x.getDate() - 1); return F.hojeISO(x); };
  const fundo = (cor) => `background:linear-gradient(135deg,${cor},#0D0D0F 150%)`;
  const ICONES = {
    inicio: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    lancs: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    cartoes: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/>',
    planejar: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  };

  const nomeConta = (id) => {
    if (!id) return '';
    if (F.ehCartao({ conta: id })) { const c = D().cartoes.find((x) => x.id === id.slice(2)); return c ? c.nome : 'Cartão'; }
    const c = D().contas.find((x) => x.id === id); return c ? c.nome : 'Conta';
  };

  /* ---------- peças ---------- */
  function seletorMes() {
    return `<div class="mes"><button type="button" data-acao="mes" data-d="-1" aria-label="Mês anterior">‹</button><strong>${esc(NOME_MES(V.mes))}</strong><button type="button" data-acao="mes" data-d="1" aria-label="Próximo mês">›</button></div>`;
  }
  function rosca(entradas, centro) {
    const total = entradas.reduce((s, e) => s + e[1], 0) || 1;
    let acc = 0; const stops = [];
    entradas.forEach(([n, v, cor]) => { const a = (acc / total) * 100; acc += v; stops.push(`${cor} ${a}% ${(acc / total) * 100}%`); });
    return `<div class="rosca-bloco"><div class="rosca" role="img" aria-label="Gráfico de ${esc(centro)}" style="background:conic-gradient(${stops.join(',') || '#ECEBE6 0 100%'})"><span>${esc(centro)}<br>${m(total === 1 && !entradas.length ? 0 : total)}</span></div>
      <div class="legenda">${entradas.slice(0, 6).map(([n, v, cor]) => `<div><i style="background:${cor}"></i><span>${esc(n)}</span><b class="num">${Math.round((v / total) * 100)}% · ${m(v)}</b></div>`).join('')}</div></div>`;
  }
  const entradasCat = (porCat, tipo) => {
    const lista = Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v, F.catInfo(n, tipo).cor]);
    if (lista.length > 6) { const resto = lista.slice(5).reduce((s, e) => s + e[1], 0); return lista.slice(0, 5).concat([['Outras', resto, '#94A3B8']]); }
    return lista;
  };
  function itemLanc(l) {
    const transf = l.tipo === 'transf';
    const info = transf ? { icone: '🔁', cor: '#2D4BFF' } : F.catInfo(l.categoria, l.tipo);
    const cartao = F.ehCartao(l);
    const sub = transf ? `${esc(nomeConta(l.conta))} → ${esc(nomeConta(l.destino))}` : `${esc(l.categoria)} · ${cartao ? '💳 ' : ''}${esc(nomeConta(l.conta))}`;
    const sinal = l.tipo === 'receita' ? '+ ' : transf ? '' : '− ';
    const cor = l.tipo === 'receita' ? 'pos' : transf ? '' : 'neg';
    const visto = cartao ? '' : `<button class="visto ${l.pago ? 'on' : ''}" type="button" data-acao="alternar" data-id="${l.id}" aria-label="${l.pago ? 'Marcar como pendente' : 'Marcar como pago ou recebido'}" aria-pressed="${!!l.pago}">${l.pago ? '✓' : ''}</button>`;
    return `<li><div class="item"><button class="item" style="border:0;padding:0;flex:1;min-width:0" type="button" data-acao="editar" data-id="${l.id}"><span class="ic" style="background:${info.cor}22">${info.icone}</span><span class="txt"><strong>${esc(l.desc || (transf ? 'Transferência' : l.categoria))}</strong><span>${sub}${!l.pago && !cartao ? ' · <span class="selo hoje">Pendente</span>' : ''}</span></span><span class="val num ${cor}">${sinal}${m(l.valor)}</span></button>${visto}</div></li>`;
  }
  function itemPagar(i) {
    const selo = i.atrasado ? `<span class="selo atraso">Atrasado ${Math.abs(i.dias)}d</span>` : i.dias === 0 ? '<span class="selo hoje">Vence hoje</span>' : `<span class="selo">Em ${i.dias}d</span>`;
    return `<li><div class="item"><span class="ic" style="background:#EEF0FF">${i.tipo === 'fatura' ? '💳' : i.tipo === 'boleto' ? '🧾' : '📌'}</span><div class="txt"><strong>${esc(i.titulo)}</strong><span>Vence ${DATA_CURTA(i.vencimento)} · ${selo}</span></div><div class="val num">${m(i.valor)}<br><button class="btn mini" type="button" data-acao="pagar" data-tipo="${i.tipo}" data-id="${esc(i.id)}">Paguei</button></div></div></li>`;
  }

  /* ---------- telas ---------- */
  function telaInicio() {
    const d = D();
    const saldo = F.arred(d.contas.filter((c) => !c.fora).reduce((s, c) => s + F.saldoConta(d.lancs, c), 0));
    const r = F.resumoMes(d.lancs, V.mes);
    const feito = [d.contas.some((c) => c.saldoInicial !== 0), d.cartoes.length > 0, d.lancs.length > 0];
    const guia = !S.guia && !feito.every(Boolean) ? `<section class="card"><h2 class="secao">Vamos organizar suas finanças 🚀</h2><p class="mut">Três passos e o painel já funciona para você.</p><div class="passos">
      ${[['Cadastre sua conta e o saldo de hoje', 'editar-conta-1'], ['Cadastre seus cartões de crédito', 'novo-cartao'], ['Lance sua primeira despesa ou receita', 'novo']].map((p, i) => `<button class="passo ${feito[i] ? 'feito' : ''}" type="button" data-acao="${p[1]}" data-id="${d.contas[0].id}"><span class="n">${feito[i] ? '✓' : i + 1}</span><strong>${p[0]}</strong></button>`).join('')}</div>
      <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec mini" type="button" data-acao="exemplo">Ver com dados de exemplo</button><button class="link" type="button" data-acao="fechar-guia">Dispensar</button></p></section>` : '';
    const pagar = F.aPagar(d.lancs, d.cartoes);
    const cats = entradasCat(r.porCategoria, 'despesa');
    const orc = F.orcamentoMes(d.lancs, d.orcamentos, V.mes).filter((o) => o.pct >= 80).slice(0, 2);
    const fats = F.faturas(d.lancs, d.cartoes).filter((f) => !f.paga);
    const ult = d.lancs.filter((l) => F.mesDe(l.data) === V.mes).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);
    return `<div class="hero"><small>Saldo geral</small><span class="grande num">${m(saldo)}</span>
      <div class="duo"><div><small>Receitas do mês</small><b class="verde num">${m(r.receitas)}</b></div><div><small>Despesas do mês</small><b class="verm num">${m(r.despesas)}</b></div></div></div>
    <div class="contas" aria-label="Suas contas">${d.contas.map((c) => `<button class="conta" type="button" data-acao="editar-conta" data-id="${c.id}"><span class="mut"><i style="background:${c.cor}"></i>${esc(c.nome)}</span><b class="num">${m(F.saldoConta(d.lancs, c))}</b></button>`).join('')}<button class="conta nova" type="button" data-acao="nova-conta">+ Conta</button></div>
    ${guia}
    ${seletorMes()}
    <div class="duas"><div class="card mini"><small>Receitas</small><b class="pos num">${m(r.receitas)}</b><div class="barra ok" role="img" aria-label="Recebido"><i style="width:${r.receitas ? Math.min(100, (r.recebido / r.receitas) * 100) : 0}%"></i></div><small>Recebido ${m(r.recebido)}</small></div>
      <div class="card mini"><small>Despesas</small><b class="neg num">${m(r.despesas)}</b><div class="barra estourou" role="img" aria-label="Pago"><i style="width:${r.despesas ? Math.min(100, (r.pago / r.despesas) * 100) : 0}%"></i></div><small>Pago ${m(r.pago)}</small></div></div>
    <div class="card" style="display:flex;justify-content:space-between;align-items:center"><span class="mut">Balanço previsto do mês</span><b class="num ${r.saldo >= 0 ? 'pos' : 'neg'}" style="font-size:20px">${m(r.saldo)}</b></div>
    <section class="card"><div class="sec-h"><h2 class="secao">Contas a pagar</h2><button class="link" type="button" data-acao="ir-pagar">Ver todas</button></div>
      ${pagar.length ? `<ul class="lista">${pagar.slice(0, 3).map(itemPagar).join('')}</ul>` : '<p class="mut" style="padding:8px 0">Tudo em dia. Nenhum boleto ou fatura pendente. 🎉</p>'}</section>
    ${orc.length ? `<section class="card"><h2 class="secao">Atenção no orçamento</h2><ul class="lista">${orc.map(rowOrc).join('')}</ul></section>` : ''}
    <section class="card"><div class="sec-h"><h2 class="secao">Despesas por categoria</h2><button class="link" type="button" data-acao="ir-rel">Relatórios</button></div>
      ${cats.length ? rosca(cats, 'Despesas') : '<p class="mut" style="padding:8px 0">Sem despesas neste mês.</p>'}</section>
    ${d.cartoes.length ? `<section class="card"><div class="sec-h"><h2 class="secao">Cartões</h2><button class="link" type="button" data-acao="ir-cartoes">Abrir</button></div><ul class="lista">${d.cartoes.map((c) => { const f = fats.find((x) => x.cartaoId === c.id); const u = F.limiteUsado(d.lancs, c.id); return `<li><div class="item"><span class="ic" style="${fundo(c.cor)};color:#fff">💳</span><div class="txt"><strong>${esc(c.nome)}</strong><span>${f ? `Fatura vence ${DATA_CURTA(f.vencimento)}` : 'Sem fatura aberta'} · limite livre ${m(c.limite - u)}</span></div><div class="val num">${f ? m(f.total) : m(0)}</div></div></li>`; }).join('')}</ul></section>` : ''}
    <section class="card"><div class="sec-h"><h2 class="secao">Últimos lançamentos</h2><button class="link" type="button" data-acao="ir-lancs">Ver todos</button></div>
      ${ult.length ? `<ul class="lista">${ult.map(itemLanc).join('')}</ul>` : '<p class="mut" style="padding:8px 0">Nenhum lançamento neste mês.</p>'}</section>`;
  }

  function listaLancs() {
    const d = D();
    let l = d.lancs.filter((x) => F.mesDe(x.data) === V.mes);
    if (V.filtro !== 'todos') l = l.filter((x) => x.tipo === V.filtro);
    const q = V.q.trim().toLowerCase();
    if (q) l = l.filter((x) => `${x.desc} ${x.categoria} ${nomeConta(x.conta)}`.toLowerCase().includes(q));
    if (!l.length) return '<div class="card vazio"><span class="emoji">🗒️</span><p>Nenhum lançamento aqui.</p><button class="btn" type="button" data-acao="novo">Novo lançamento</button></div>';
    const dias = {}; l.sort((a, b) => b.data.localeCompare(a.data)).forEach((x) => { (dias[x.data] = dias[x.data] || []).push(x); });
    return Object.entries(dias).map(([dia, itens]) => {
      const t = F.arred(itens.filter((x) => x.tipo !== 'transf' && !x.ignorar).reduce((s, x) => s + (x.tipo === 'receita' ? x.valor : -x.valor), 0));
      return `<div class="dia"><span style="text-transform:capitalize">${esc(DIA_LONGO(dia))}</span><span class="num">${m(t)}</span></div><div class="card" style="padding:4px 14px"><ul class="lista">${itens.map(itemLanc).join('')}</ul></div>`;
    }).join('');
  }
  function telaLancs() {
    const d = D();
    const abas = `<div class="abas" role="group"><button type="button" data-acao="sub" data-v="todos" aria-pressed="${V.sub === 'todos'}">Lançamentos</button><button type="button" data-acao="sub" data-v="apagar" aria-pressed="${V.sub === 'apagar'}">A pagar</button></div>`;
    if (V.sub === 'apagar') {
      const p = F.aPagar(d.lancs, d.cartoes);
      const g = [['Atrasados', p.filter((i) => i.atrasado)], ['Próximos 7 dias', p.filter((i) => !i.atrasado && i.dias <= 7)], ['Depois', p.filter((i) => i.dias > 7)]];
      return `<div class="tit"><h1>Lançamentos</h1><button class="btn mini" type="button" data-acao="novo-boleto">+ Boleto</button></div>${abas}
      ${p.length ? g.filter((x) => x[1].length).map((x) => `<h2 class="secao">${x[0]}</h2><div class="card" style="padding:4px 14px"><ul class="lista">${x[1].map(itemPagar).join('')}</ul></div>`).join('') : '<div class="card vazio"><span class="emoji">🎉</span><p>Nenhum boleto ou fatura pendente.</p><button class="btn" type="button" data-acao="novo-boleto">Cadastrar boleto</button></div>'}`;
    }
    const chip = (v, t) => `<button type="button" data-acao="filtro" data-v="${v}" aria-pressed="${V.filtro === v}">${t}</button>`;
    return `<div class="tit"><h1>Lançamentos</h1></div>${abas}${seletorMes()}
      <input class="busca" id="busca" type="search" placeholder="Buscar por descrição, categoria ou conta" value="${esc(V.q)}" aria-label="Buscar lançamentos">
      <div class="chips">${chip('todos', 'Todos')}${chip('receita', 'Receitas')}${chip('despesa', 'Despesas')}${chip('transf', 'Transferências')}</div>
      <div id="lista-lancs">${listaLancs()}</div>`;
  }

  function telaCartoes() {
    const d = D();
    if (!d.cartoes.length) return `<div class="tit"><h1>Cartões</h1></div><div class="card vazio"><span class="emoji">💳</span><p>Cadastre todos os seus cartões e veja a fatura, o limite e o vencimento de cada um em um só lugar.</p><button class="btn" type="button" data-acao="novo-cartao">Cadastrar cartão</button></div>`;
    if (!d.cartoes.some((c) => c.id === V.cartao)) V.cartao = d.cartoes[0].id;
    const c = d.cartoes.find((x) => x.id === V.cartao);
    if (!V.fmes) V.fmes = F.faturaDe(c, F.hojeISO()).mes;
    const usado = F.limiteUsado(d.lancs, c.id);
    const f = F.faturas(d.lancs, d.cartoes).find((x) => x.cartaoId === c.id && x.mes === V.fmes);
    const total = f ? f.total : 0; const venc = f ? f.vencimento : `${V.fmes}-${String(c.vencimento).padStart(2, '0')}`;
    const status = f && f.paga ? '<span class="selo ok">Paga</span>' : !f ? '<span class="selo">Sem compras</span>' : venc < F.hojeISO() ? '<span class="selo atraso">Vencida</span>' : '<span class="selo hoje">Aberta</span>';
    const itens = f ? f.itens.slice().sort((a, b) => b.data.localeCompare(a.data)) : [];
    return `<div class="tit"><h1>Cartões</h1><button class="btn mini" type="button" data-acao="novo-cartao">+ Cartão</button></div>
    <div class="cartoes">${d.cartoes.map((x) => { const u = F.limiteUsado(d.lancs, x.id); const p = x.limite ? Math.min(100, (u / x.limite) * 100) : 0; return `<button class="cc ${x.id === c.id ? 'sel' : ''}" type="button" style="${fundo(x.cor)}" data-acao="sel-cartao" data-id="${x.id}" aria-pressed="${x.id === c.id}"><h3>${esc(x.nome)}</h3><div><div class="linha"><span>Usado</span><b class="num">${m(u)}</b></div><div class="barra" style="margin:8px 0" role="img" aria-label="${Math.round(p)}% do limite"><i style="width:${p}%"></i></div><div class="linha"><span>Disponível</span><span class="num">${m(x.limite - u)}</span></div></div></button>`; }).join('')}</div>
    <div class="mes"><button type="button" data-acao="fmes" data-d="-1" aria-label="Fatura anterior">‹</button><strong>Fatura de ${esc(MES_CURTO(V.fmes))}/${V.fmes.slice(0, 4)}</strong><button type="button" data-acao="fmes" data-d="1" aria-label="Próxima fatura">›</button></div>
    <section class="card"><div class="sec-h"><div><small>Valor da fatura</small><b class="num" style="font-size:28px;font-weight:600;display:block">${m(total)}</b></div>${status}</div>
      <p class="mut" style="margin:6px 0 12px">Fecha dia ${c.fechamento} · vence ${DATA_CURTA(venc)}</p>
      <div class="botoes">${f && !f.paga ? `<button class="btn" type="button" data-acao="pagar-fatura" data-id="${c.id}|${V.fmes}">Pagar fatura</button>` : ''}<button class="btn sec" type="button" data-acao="novo-no-cartao" data-id="${c.id}">Nova compra</button><button class="btn sec" type="button" data-acao="editar-cartao" data-id="${c.id}">Editar</button></div></section>
    ${itens.length ? `<div class="card" style="padding:4px 14px"><ul class="lista">${itens.map(itemLanc).join('')}</ul></div>` : ''}`;
  }

  function rowOrc(o) {
    const info = F.catInfo(o.categoria, 'despesa'); const cls = o.pct >= 100 ? 'estourou' : o.pct >= 80 ? 'alerta' : 'ok';
    return `<li><button class="item" type="button" data-acao="editar-orc" data-id="${esc(o.categoria)}"><span class="ic" style="background:${info.cor}22">${info.icone}</span><span class="txt"><strong>${esc(o.categoria)}</strong><span class="num">${m(o.gasto)} de ${m(o.limite)}</span><div class="barra ${cls}" style="margin-top:6px"><i style="width:${Math.min(100, o.pct)}%"></i></div></span><span class="val num ${o.restante < 0 ? 'neg' : ''}">${o.pct}%<small>${o.restante >= 0 ? 'faltam ' + m(o.restante) : 'acima ' + m(-o.restante)}</small></span></button></li>`;
  }
  function telaPlanejar() {
    const d = D();
    const abas = `<div class="abas" role="group">${[['orc', 'Orçamento'], ['obj', 'Objetivos'], ['rel', 'Relatórios']].map(([v, t]) => `<button type="button" data-acao="plano" data-v="${v}" aria-pressed="${V.plano === v}">${t}</button>`).join('')}</div>`;
    let corpo = '';
    if (V.plano === 'orc') {
      const o = F.orcamentoMes(d.lancs, d.orcamentos, V.mes);
      const tl = o.reduce((s, x) => s + x.limite, 0); const tg = o.reduce((s, x) => s + x.gasto, 0);
      corpo = `${seletorMes()}${o.length ? `<div class="card"><small>Orçamento total do mês</small><b class="num" style="font-size:22px;display:block">${m(tg)} <span class="mut" style="font-weight:400">de ${m(tl)}</span></b><div class="barra ${tg > tl ? 'estourou' : 'ok'}" style="margin-top:8px"><i style="width:${tl ? Math.min(100, (tg / tl) * 100) : 0}%"></i></div></div><div class="card" style="padding:4px 14px"><ul class="lista">${o.map(rowOrc).join('')}</ul></div>` : '<div class="card vazio"><span class="emoji">🎯</span><p>Defina quanto você quer gastar por categoria e acompanhe se está dentro do limite.</p></div>'}<button class="btn bloco" type="button" data-acao="novo-orc">Definir limite de categoria</button>`;
    } else if (V.plano === 'obj') {
      corpo = `${d.objetivos.length ? d.objetivos.map((o) => { const p = o.meta ? Math.min(100, (o.guardado / o.meta) * 100) : 0; return `<section class="card"><div class="sec-h"><h2 class="secao">🎯 ${esc(o.nome)}</h2><b class="num">${Math.round(p)}%</b></div><p class="mut num" style="margin:4px 0 10px">${m(o.guardado)} de ${m(o.meta)}${o.prazo ? ' · até ' + esc(NOME_MES(o.prazo)) : ''}</p><div class="barra"><i style="width:${p}%"></i></div><div class="botoes" style="margin-top:12px"><button class="btn mini" type="button" data-acao="aporte" data-id="${o.id}">Guardar dinheiro</button><button class="btn mini sec" type="button" data-acao="editar-obj" data-id="${o.id}">Editar</button></div></section>`; }).join('') : '<div class="card vazio"><span class="emoji">✈️</span><p>Crie um objetivo (viagem, reserva de emergência, caixa da empresa) e acompanhe quanto já guardou.</p></div>'}<button class="btn bloco" type="button" data-acao="novo-obj">Novo objetivo</button>`;
    } else {
      const r = F.resumoMes(d.lancs, V.mes); const ev = F.evolucao(d.lancs, V.mes, 6);
      const max = Math.max(1, ...ev.flatMap((e) => [e.receitas, e.despesas]));
      const ent = entradasCat(V.reltipo === 'despesa' ? r.porCategoria : receitaCat(d.lancs, V.mes), V.reltipo);
      corpo = `${seletorMes()}<div class="chips"><button type="button" data-acao="reltipo" data-v="despesa" aria-pressed="${V.reltipo === 'despesa'}">Despesas</button><button type="button" data-acao="reltipo" data-v="receita" aria-pressed="${V.reltipo === 'receita'}">Receitas</button></div>
      <section class="card"><h2 class="secao" style="margin-bottom:10px">Por categoria</h2>${ent.length ? rosca(ent, V.reltipo === 'despesa' ? 'Despesas' : 'Receitas') : '<p class="mut">Sem lançamentos neste mês.</p>'}</section>
      <section class="card"><h2 class="secao">Receitas x despesas</h2><div class="evol">${ev.map((e) => `<div class="col"><div class="par"><i style="height:${(e.receitas / max) * 100}%;background:var(--verde)" title="Receitas ${F.brl(e.receitas)}"></i><i style="height:${(e.despesas / max) * 100}%;background:var(--vermelho)" title="Despesas ${F.brl(e.despesas)}"></i></div><small>${esc(MES_CURTO(e.mes))}</small></div>`).join('')}</div><table class="tab"><caption class="so-leitor">Receitas e despesas dos últimos 6 meses</caption><thead><tr><th scope="col">Mês</th><th scope="col">Receitas</th><th scope="col">Despesas</th></tr></thead><tbody>${ev.map((e) => `<tr><th scope="row">${esc(MES_CURTO(e.mes))}</th><td class="num pos">${m(e.receitas)}</td><td class="num neg">${m(e.despesas)}</td></tr>`).join('')}</tbody></table></section>
      <button class="btn sec bloco" type="button" data-acao="exportar">Exportar ${esc(NOME_MES(V.mes))} em CSV</button>`;
    }
    return `<div class="tit"><h1>Planejar</h1></div>${abas}${corpo}`;
  }
  function receitaCat(lancs, mes) {
    const o = {}; lancs.filter((l) => l.tipo === 'receita' && !l.ignorar && F.mesDe(l.data) === mes).forEach((l) => { o[l.categoria] = F.arred((o[l.categoria] || 0) + l.valor); }); return o;
  }

  function telaMais() {
    const d = D();
    return `<div class="tit"><h1>Mais opções</h1></div>
    <section class="card"><div class="sec-h"><h2 class="secao">Contas e carteiras</h2><button class="link" type="button" data-acao="nova-conta">+ Adicionar</button></div><ul class="lista">${d.contas.map((c) => `<li><button class="item" type="button" data-acao="editar-conta" data-id="${c.id}"><span class="ic" style="background:${c.cor}22"><i style="width:14px;height:14px;border-radius:50%;background:${c.cor}"></i></span><span class="txt"><strong>${esc(c.nome)}</strong><span>${c.fora ? 'Fora do saldo geral' : 'Soma no saldo geral'}</span></span><span class="val num">${m(F.saldoConta(d.lancs, c))}</span></button></li>`).join('')}</ul></section>
    <section class="card"><h2 class="secao">Importar extrato</h2><p class="mut" style="margin:4px 0 12px">Baixe o extrato ou a fatura no app do banco em OFX ou CSV (data;descrição;valor) e importe. Você escolhe a conta antes de confirmar.</p><label class="btn sec" style="display:inline-block;cursor:pointer">Escolher arquivo<input id="arq" type="file" accept=".ofx,.csv,.txt" hidden></label></section>
    <section class="card"><h2 class="secao">Seus dados</h2><p class="mut" style="margin:4px 0 12px">Tudo fica salvo só neste aparelho. Faça uma cópia de segurança de vez em quando.</p><div class="botoes" style="flex-wrap:wrap"><button class="btn sec" type="button" data-acao="backup">Baixar cópia</button><label class="btn sec" style="cursor:pointer;text-align:center">Restaurar cópia<input id="rest" type="file" accept=".json" hidden></label></div></section>
    <section class="card"><h2 class="secao">Outros</h2><div class="botoes" style="flex-wrap:wrap;margin-top:10px"><button class="btn sec" type="button" data-acao="exemplo">Carregar dados de exemplo</button><button class="btn perigo" type="button" data-acao="apagar">Apagar dados ${S.perfil === 'pessoal' ? 'pessoais' : 'da empresa'}</button></div></section>`;
  }

  const VISTAS = { inicio: telaInicio, lancs: telaLancs, cartoes: telaCartoes, planejar: telaPlanejar, mais: telaMais };
  function render() {
    document.querySelectorAll('[data-perfil]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.perfil === S.perfil)));
    const olho = $('[data-acao=olho]'); olho.setAttribute('aria-pressed', String(!!S.oculto)); olho.setAttribute('aria-label', S.oculto ? 'Mostrar valores' : 'Ocultar valores');
    const nav = (id, t) => `<button type="button" data-tela="${id}" ${V.tela === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[id]}</svg>${t}</button>`;
    $('#menu').innerHTML = nav('inicio', 'Início') + nav('lancs', 'Lançamentos') + '<button class="mais-novo" type="button" data-acao="menu-novo" aria-label="Novo lançamento">+</button>' + nav('cartoes', 'Cartões') + nav('planejar', 'Planejar');
    $('#tela').innerHTML = VISTAS[V.tela]();
  }
  const ir = (t) => { V.tela = t; render(); window.scrollTo(0, 0); };

  /* ---------- sheets e formulários ---------- */
  const dlg = $('#dlg');
  function abrir(titulo, html, ok, extra) {
    dlg.setAttribute('aria-labelledby', 'dlg-t');
    dlg.innerHTML = `<form id="f"><div class="sheet-h"><h2 id="dlg-t">${esc(titulo)}</h2><button class="icbtn" type="button" data-fechar aria-label="Fechar">✕</button></div>${html}</form>`;
    const f = $('#f', dlg);
    if (ok) f.addEventListener('submit', (ev) => { ev.preventDefault(); if (ok(new FormData(f)) !== false) dlg.close(); });
    dlg.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    if (extra) extra(f);
    if (!dlg.open) dlg.showModal();
  }
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  const radios = (nome, arr, sel, cls = '') => `<div class="opcoes ${cls}" role="radiogroup">${arr.map(([v, t, ic]) => `<label><input type="radio" name="${nome}" value="${esc(v)}" ${v === sel ? 'checked' : ''}><span>${ic ? `<em>${ic}</em>` : ''}${esc(t)}</span></label>`).join('')}</div>`;
  const troca = (nome, rot, on) => `<label class="troca"><span>${rot}</span><input type="checkbox" name="${nome}" ${on ? 'checked' : ''}></label>`;
  const campo = (rot, html) => `<label class="campo"><span>${rot}</span>${html}</label>`;
  const sele = (nome, arr, sel) => `<select name="${nome}">${arr.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const val2 = (v) => (v != null ? String(v).replace('.', ',') : '');

  function menuNovo() {
    abrir('O que você quer lançar?', `<div class="duas" style="gap:10px">${[['despesa', '🔻', 'Despesa'], ['receita', '🔺', 'Receita'], ['transf', '🔁', 'Transferência'], ['cartao', '💳', 'Compra no cartão']].map(([k, i, t]) => `<button class="card" type="button" data-novo="${k}" style="border:0;text-align:center;padding:20px 10px"><span style="font-size:30px;display:block">${i}</span><b style="font-weight:600">${t}</b></button>`).join('')}</div>`, null, (f) => {
      f.querySelectorAll('[data-novo]').forEach((b) => b.addEventListener('click', () => formLanc({}, b.dataset.novo)));
    });
  }

  function formLanc(base = {}, modo) {
    const d = D(); const novo = !base.id;
    const tipo = base.tipo === 'transf' || modo === 'transf' ? 'transf' : base.tipo || (modo === 'receita' ? 'receita' : 'despesa');
    const contas = d.contas.map((c) => [c.id, c.nome]); const cartoes = d.cartoes.map((c) => ['c:' + c.id, '💳 ' + c.nome]);
    if (tipo === 'despesa' && modo === 'cartao' && !cartoes.length) { aviso('Cadastre um cartão primeiro.'); dlg.close(); return formCartao(); }
    const opcContas = tipo === 'despesa' ? (modo === 'cartao' ? cartoes : contas.concat(cartoes)) : contas;
    const contaSel = base.conta || (modo === 'cartao' ? cartoes[0][0] : contas[0][0]);
    const titulo = { despesa: 'Despesa', receita: 'Receita', transf: 'Transferência' }[tipo];
    const catsHtml = tipo === 'transf' ? '' : campo('Categoria', radios('categoria', F.CATEGORIAS[tipo].filter((c) => c.nome !== 'Cartão' || base.categoria === 'Cartão').map((c) => [c.nome, c.nome, c.icone]), base.categoria || F.CATEGORIAS[tipo][0].nome, 'cats'));
    const contaHtml = tipo === 'transf'
      ? `<div class="dupla">${campo('Sai de', sele('conta', contas, base.conta))}${campo('Entra em', sele('destino', contas, base.destino || (contas[1] || contas[0])[0]))}</div>`
      : campo(tipo === 'receita' ? 'Receber em' : 'Pagar com', radios('conta', opcContas, contaSel));
    const rotPago = tipo === 'receita' ? 'Já recebi' : tipo === 'transf' ? 'Já foi feita' : 'Já paguei';
    abrir((novo ? 'Nova ' : 'Editar ') + titulo.toLowerCase(), `
      <div class="valor-box ${tipo}"><label for="v">Valor</label><input id="v" name="valor" inputmode="decimal" required autocomplete="off" placeholder="0,00" value="${val2(base.valor)}"></div>
      ${tipo === 'transf' ? '' : campo('Descrição', `<input name="desc" required maxlength="80" value="${esc(base.desc || '')}" placeholder="Ex.: Mercado, Aluguel, Venda de peças">`)}
      <div class="campo"><span>Data</span><div class="dupla" style="grid-template-columns:auto auto 1fr"><button class="btn sec mini" type="button" data-data="${F.hojeISO()}">Hoje</button><button class="btn sec mini" type="button" data-data="${ontem()}">Ontem</button><input name="data" type="date" required value="${base.data || F.hojeISO()}"></div></div>
      ${F.ehCartao({ conta: contaSel }) && tipo === 'despesa' ? '' : troca('pago', rotPago, novo ? true : !!base.pago)}
      ${catsHtml}${contaHtml}
      ${novo && tipo !== 'transf' ? `<div class="dupla">${campo('Repetir', sele('rep', [['nao', 'Não repete'], ['parcelado', 'Parcelado'], ['fixo', 'Fixo todo mês']], 'nao'))}<div id="repn" hidden>${campo('Quantas vezes', '<input name="n" type="number" min="2" max="60" value="2">')}</div></div>` : ''}
      ${tipo === 'despesa' ? troca('boleto', 'É um boleto', !!base.boleto) : ''}
      ${tipo === 'transf' ? '' : campo('Nota (opcional)', `<textarea name="nota" maxlength="300">${esc(base.nota || '')}</textarea>`)}
      <div class="botoes">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const valor = F.arred(F.numeroBR(fd.get('valor')));
      if (!(valor > 0)) { aviso('Informe um valor maior que zero.'); return false; }
      const conta = fd.get('conta'); const cartao = F.ehCartao({ conta });
      if (tipo === 'transf' && conta === fd.get('destino')) { aviso('Escolha contas diferentes.'); return false; }
      const reg = tipo === 'transf'
        ? { tipo, desc: 'Transferência', data: fd.get('data'), categoria: 'Transferência', conta, destino: fd.get('destino'), pago: !!fd.get('pago'), boleto: false }
        : { tipo, desc: fd.get('desc').trim(), data: fd.get('data'), categoria: fd.get('categoria'), conta, boleto: !!fd.get('boleto') && !cartao, pago: !cartao && !!fd.get('pago'), nota: (fd.get('nota') || '').trim() };
      if (novo) {
        const rep = fd.get('rep') || 'nao'; const n = rep === 'nao' ? 1 : Math.max(2, Math.min(60, parseInt(fd.get('n'), 10) || 2));
        const parte = rep === 'parcelado' ? F.arred(valor / n) : valor;
        for (let i = 0; i < n; i++) {
          const dia = Number(reg.data.slice(8, 10)); const mes = F.somaMes(F.mesDe(reg.data), i);
          const ult = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
          const v = rep === 'parcelado' && i === n - 1 ? F.arred(valor - parte * (n - 1)) : parte;
          d.lancs.push({ ...reg, id: uid(), valor: v, desc: rep === 'parcelado' ? `${reg.desc} (${i + 1}/${n})` : reg.desc, data: `${mes}-${String(Math.min(dia, ult)).padStart(2, '0')}`, pago: i === 0 ? reg.pago : false });
        }
      } else Object.assign(d.lancs.find((x) => x.id === base.id), reg, { valor });
      V.mes = F.mesDe(reg.data); salvar(); render(); aviso('Lançamento salvo.');
    }, (f) => {
      const exc = $('#exc', f); if (exc) exc.onclick = () => { d.lancs = d.lancs.filter((x) => x.id !== base.id); salvar(); dlg.close(); render(); aviso('Lançamento excluído.'); };
      f.querySelectorAll('[data-data]').forEach((b) => b.addEventListener('click', () => { f.data.value = b.dataset.data; }));
      if (f.rep) f.rep.addEventListener('change', () => { $('#repn', f).hidden = f.rep.value === 'nao'; });
      if (f.boleto && f.pago) f.boleto.addEventListener('change', () => { if (f.boleto.checked) f.pago.checked = false; });
      setTimeout(() => { if (novo) f.valor.focus(); }, 60);
    });
  }

  function formCartao(c = {}) {
    const novo = !c.id;
    abrir(novo ? 'Novo cartão' : 'Editar cartão', `${campo('Nome do cartão', `<input name="nome" required maxlength="30" value="${esc(c.nome || '')}" placeholder="Ex.: Nubank, Itaú Empresa">`)}
      ${campo('Limite (R$)', `<input name="limite" required inputmode="decimal" value="${val2(c.limite)}" placeholder="0,00">`)}
      <div class="dupla">${campo('Dia do fechamento', `<input name="fechamento" type="number" min="1" max="31" required value="${c.fechamento || ''}">`)}${campo('Dia do vencimento', `<input name="vencimento" type="number" min="1" max="31" required value="${c.vencimento || ''}">`)}</div>
      ${campo('Cor', radios('cor', CORES.map((x) => [x, '']), c.cor || CORES[d_cartoes() % CORES.length], 'cores').replace(/<span>/g, '<span>'))}
      <div class="botoes">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), limite: F.arred(F.numeroBR(fd.get('limite'))), fechamento: +fd.get('fechamento'), vencimento: +fd.get('vencimento'), cor: fd.get('cor') };
      if (!(reg.limite >= 0)) { aviso('Limite inválido.'); return false; }
      if (novo) { const n = { id: uid(), ...reg }; D().cartoes.push(n); V.cartao = n.id; V.fmes = null; } else Object.assign(D().cartoes.find((x) => x.id === c.id), reg);
      salvar(); render(); aviso('Cartão salvo.');
    }, (f) => {
      f.querySelectorAll('.cores span').forEach((s) => { s.style.background = s.previousElementSibling.value; });
      const exc = $('#exc', f); if (exc) exc.onclick = () => { if (!confirm('Excluir este cartão e as compras dele?')) return; const d = D(); d.cartoes = d.cartoes.filter((x) => x.id !== c.id); d.lancs = d.lancs.filter((l) => l.conta !== 'c:' + c.id); V.cartao = null; salvar(); dlg.close(); render(); aviso('Cartão excluído.'); };
    });
  }
  const d_cartoes = () => D().cartoes.length;

  function formConta(c = {}) {
    const novo = !c.id;
    abrir(novo ? 'Nova conta' : 'Editar conta', `${campo('Nome', `<input name="nome" required maxlength="30" value="${esc(c.nome || '')}" placeholder="Ex.: Banco do Brasil, Caixa da loja">`)}
      ${campo('Saldo inicial (R$)', `<input name="saldo" inputmode="decimal" value="${val2(c.saldoInicial != null ? c.saldoInicial : 0)}">`)}
      ${campo('Cor', radios('cor', CORES.map((x) => [x, '']), c.cor || CORES[D().contas.length % CORES.length], 'cores'))}
      ${troca('soma', 'Somar no saldo geral', !c.fora)}
      <div class="botoes">${novo || D().contas.length < 2 ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), saldoInicial: F.arred(F.numeroBR(fd.get('saldo') || '0')), cor: fd.get('cor'), fora: !fd.get('soma') };
      if (novo) D().contas.push({ id: uid(), ...reg }); else Object.assign(D().contas.find((x) => x.id === c.id), reg);
      salvar(); render(); aviso('Conta salva.');
    }, (f) => {
      f.querySelectorAll('.cores span').forEach((s) => { s.style.background = s.previousElementSibling.value; });
      const exc = $('#exc', f); if (exc) exc.onclick = () => { if (!confirm('Excluir esta conta e os lançamentos dela?')) return; const d = D(); d.contas = d.contas.filter((x) => x.id !== c.id); d.lancs = d.lancs.filter((l) => l.conta !== c.id && l.destino !== c.id); salvar(); dlg.close(); render(); aviso('Conta excluída.'); };
    });
  }

  function formPagarFatura(id) {
    const d = D(); const [cid, mes] = id.split('|'); const c = d.cartoes.find((x) => x.id === cid);
    const f = F.faturas(d.lancs, d.cartoes).find((x) => x.cartaoId === cid && x.mes === mes); if (!f) return;
    abrir('Pagar fatura', `<div class="card"><small>${esc(c.nome)} · ${esc(MES_CURTO(mes))}/${mes.slice(0, 4)}</small><b class="num" style="font-size:28px;display:block">${F.brl(f.total)}</b></div>
      ${campo('Pagar com a conta', radios('conta', d.contas.map((x) => [x.id, x.nome]), d.contas[0].id))}
      <button class="btn" type="submit">Confirmar pagamento</button>`,
    (fd) => {
      f.itens.forEach((l) => { l.pago = true; });
      d.lancs.push({ id: uid(), tipo: 'despesa', desc: `Fatura ${c.nome} ${mes.slice(5)}/${mes.slice(0, 4)}`, valor: f.total, data: F.hojeISO(), categoria: 'Cartão', conta: fd.get('conta'), pago: true, ignorar: true, boleto: false });
      salvar(); render(); aviso('Fatura paga. O valor saiu da conta escolhida.');
    });
  }

  function formOrc(cat) {
    const d = D(); const lista = F.CATEGORIAS.despesa.filter((c) => c.nome !== 'Cartão');
    abrir('Limite por categoria', `${campo('Categoria', radios('categoria', lista.map((c) => [c.nome, c.nome, c.icone]), cat || lista[0].nome, 'cats'))}
      ${campo('Limite mensal (R$)', `<input name="limite" required inputmode="decimal" value="${val2(cat ? d.orcamentos[cat] : '')}" placeholder="0,00">`)}
      <div class="botoes">${cat ? '<button class="btn perigo" type="button" id="exc">Remover</button>' : ''}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => { const v = F.arred(F.numeroBR(fd.get('limite'))); if (!(v > 0)) { aviso('Informe um limite maior que zero.'); return false; } d.orcamentos[fd.get('categoria')] = v; salvar(); render(); aviso('Limite salvo.'); },
    (f) => { const exc = $('#exc', f); if (exc) exc.onclick = () => { delete d.orcamentos[cat]; salvar(); dlg.close(); render(); }; });
  }

  function formObj(o = {}) {
    const d = D(); const novo = !o.id;
    abrir(novo ? 'Novo objetivo' : 'Editar objetivo', `${campo('Nome', `<input name="nome" required maxlength="40" value="${esc(o.nome || '')}" placeholder="Ex.: Viagem, Reserva de emergência">`)}
      <div class="dupla">${campo('Quanto precisa (R$)', `<input name="meta" required inputmode="decimal" value="${val2(o.meta)}">`)}${campo('Já guardado (R$)', `<input name="guardado" inputmode="decimal" value="${val2(o.guardado || 0)}">`)}</div>
      ${campo('Prazo (opcional)', `<input name="prazo" type="month" value="${esc(o.prazo || '')}">`)}
      <div class="botoes">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), meta: F.arred(F.numeroBR(fd.get('meta'))), guardado: F.arred(F.numeroBR(fd.get('guardado') || '0')), prazo: fd.get('prazo') || '' };
      if (!(reg.meta > 0)) { aviso('Informe quanto precisa guardar.'); return false; }
      if (novo) d.objetivos.push({ id: uid(), ...reg }); else Object.assign(d.objetivos.find((x) => x.id === o.id), reg);
      salvar(); render(); aviso('Objetivo salvo.');
    }, (f) => { const exc = $('#exc', f); if (exc) exc.onclick = () => { d.objetivos = d.objetivos.filter((x) => x.id !== o.id); salvar(); dlg.close(); render(); }; });
  }
  function formAporte(o) {
    abrir('Guardar dinheiro', `<p class="mut">${esc(o.nome)}: ${F.brl(o.guardado)} de ${F.brl(o.meta)}</p>${campo('Quanto guardar agora (R$)', '<input name="v" inputmode="decimal" required placeholder="0,00">')}<button class="btn" type="submit">Guardar</button>`,
      (fd) => { const v = F.arred(F.numeroBR(fd.get('v'))); if (!(v > 0)) { aviso('Informe um valor.'); return false; } o.guardado = F.arred(o.guardado + v); salvar(); render(); aviso(o.guardado >= o.meta ? 'Objetivo alcançado! 🎉' : 'Valor guardado.'); });
  }

  function importar(texto, nome) {
    const lista = /\.csv$|\.txt$/i.test(nome) ? F.lerCSV(texto) : F.lerOFX(texto);
    if (!lista.length) { aviso('Não encontrei lançamentos nesse arquivo.'); return; }
    const d = D(); const contas = d.contas.map((c) => [c.id, c.nome]).concat(d.cartoes.map((c) => ['c:' + c.id, '💳 ' + c.nome]));
    abrir(`Importar ${lista.length} lançamentos`, `<p class="mut">Primeiros itens: ${lista.slice(0, 3).map((l) => esc(l.desc)).join(', ')}…<br>Repetidos (mesma data, valor e descrição) são ignorados.</p>${campo('Importar para', radios('conta', contas, contas[0][0]))}<button class="btn" type="submit">Importar</button>`,
      (fd) => {
        const conta = fd.get('conta'); const cartao = F.ehCartao({ conta }); const chave = (l) => `${l.data}|${l.valor}|${l.desc}|${l.conta}`;
        const ja = new Set(d.lancs.map(chave)); let n = 0;
        lista.forEach((l) => { const x = { ...l, id: uid(), conta, boleto: false, pago: !cartao }; if (cartao && x.tipo === 'receita') return; if (ja.has(chave(x))) return; ja.add(chave(x)); d.lancs.push(x); n++; });
        salvar(); render(); aviso(`${n} lançamentos importados.`);
      });
  }

  /* ---------- exemplo ---------- */
  function exemplo() {
    const hoje = new Date(); const mes = F.mesDe(F.hojeISO()); const ant = F.somaMes(mes, -1); const prox = F.somaMes(mes, 1);
    const dia = (x, n) => `${x}-${String(n).padStart(2, '0')}`; const hd = hoje.getDate();
    const mk = (o) => ({ id: uid(), boleto: false, pago: true, nota: '', ...o });
    const cNu = uid(); const cIt = uid(); const cEm = uid();
    S.dados.pessoal = { ...vazio(), contas: [{ id: 'banco', nome: 'Conta corrente', saldoInicial: 1200, cor: '#2D4BFF' }, { id: 'carteira', nome: 'Carteira', saldoInicial: 150, cor: '#10B981' }, { id: 'poup', nome: 'Poupança', saldoInicial: 3000, cor: '#8A3DFF' }],
      cartoes: [{ id: cNu, nome: 'Nubank', limite: 6000, fechamento: 25, vencimento: 5, cor: '#8A3DFF' }, { id: cIt, nome: 'Itaú Platinum', limite: 9000, fechamento: 10, vencimento: 17, cor: '#F59E0B' }],
      orcamentos: { Mercado: 800, Lazer: 300, Transporte: 400 }, objetivos: [{ id: uid(), nome: 'Viagem de férias', meta: 6000, guardado: 2400, prazo: F.somaMes(mes, 8) }, { id: uid(), nome: 'Reserva de emergência', meta: 15000, guardado: 3000, prazo: '' }],
      lancs: [
        mk({ tipo: 'receita', desc: 'Salário', valor: 5800, data: dia(mes, 5), categoria: 'Salário', conta: 'banco' }),
        mk({ tipo: 'despesa', desc: 'Aluguel', valor: 1650, data: dia(mes, 8), categoria: 'Moradia', conta: 'banco' }),
        mk({ tipo: 'despesa', desc: 'Conta de luz', valor: 189.4, data: dia(mes, Math.min(28, hd + 3)), categoria: 'Moradia', conta: 'banco', boleto: true, pago: false }),
        mk({ tipo: 'despesa', desc: 'Internet', valor: 119.9, data: dia(mes, Math.max(1, hd - 2)), categoria: 'Moradia', conta: 'banco', boleto: true, pago: false }),
        mk({ tipo: 'despesa', desc: 'Supermercado', valor: 412.35, data: dia(mes, 12), categoria: 'Mercado', conta: 'c:' + cNu, pago: false }),
        mk({ tipo: 'despesa', desc: 'Restaurante', valor: 96.5, data: dia(mes, 14), categoria: 'Alimentação', conta: 'c:' + cNu, pago: false }),
        mk({ tipo: 'despesa', desc: 'Netflix', valor: 55.9, data: dia(mes, 3), categoria: 'Assinaturas', conta: 'c:' + cIt, pago: false }),
        mk({ tipo: 'despesa', desc: 'Combustível', valor: 210, data: dia(mes, 9), categoria: 'Transporte', conta: 'c:' + cIt, pago: false }),
        mk({ tipo: 'despesa', desc: 'Cinema', valor: 78, data: dia(mes, 15), categoria: 'Lazer', conta: 'carteira' }),
        mk({ tipo: 'despesa', desc: 'Farmácia', valor: 134.2, data: dia(ant, 20), categoria: 'Saúde', conta: 'c:' + cIt }),
        mk({ tipo: 'receita', desc: 'Salário', valor: 5800, data: dia(ant, 5), categoria: 'Salário', conta: 'banco' }),
        mk({ tipo: 'despesa', desc: 'Aluguel', valor: 1650, data: dia(ant, 8), categoria: 'Moradia', conta: 'banco' }),
        mk({ tipo: 'despesa', desc: 'Notebook (1/3)', valor: 1100, data: dia(mes, 9), categoria: 'Outros', conta: 'c:' + cIt, pago: false }),
        mk({ tipo: 'despesa', desc: 'Notebook (2/3)', valor: 1100, data: dia(prox, 9), categoria: 'Outros', conta: 'c:' + cIt, pago: false }),
        mk({ tipo: 'transf', desc: 'Transferência', valor: 500, data: dia(mes, 6), categoria: 'Transferência', conta: 'banco', destino: 'poup' }),
      ] };
    S.dados.empresa = { ...vazio(), contas: [{ id: 'pj', nome: 'Conta PJ', saldoInicial: 8000, cor: '#2D4BFF' }, { id: 'caixa', nome: 'Caixa da loja', saldoInicial: 600, cor: '#10B981' }],
      cartoes: [{ id: cEm, nome: 'Cartão Empresa', limite: 15000, fechamento: 20, vencimento: 28, cor: '#0D0D0F' }],
      orcamentos: { Marketing: 1000, Fornecedores: 5000 }, objetivos: [{ id: uid(), nome: 'Caixa para expansão', meta: 30000, guardado: 8000, prazo: '' }],
      lancs: [
        mk({ tipo: 'receita', desc: 'Vendas da semana', valor: 12400, data: dia(mes, 6), categoria: 'Vendas', conta: 'pj' }),
        mk({ tipo: 'receita', desc: 'Serviço de manutenção', valor: 3200, data: dia(mes, 11), categoria: 'Serviços', conta: 'pj' }),
        mk({ tipo: 'despesa', desc: 'Fornecedor de peças', valor: 4300, data: dia(mes, Math.min(28, hd + 5)), categoria: 'Fornecedores', conta: 'pj', boleto: true, pago: false }),
        mk({ tipo: 'despesa', desc: 'Pró-labore', valor: 3500, data: dia(mes, 5), categoria: 'Folha e pró-labore', conta: 'pj' }),
        mk({ tipo: 'despesa', desc: 'Anúncios online', valor: 780, data: dia(mes, 10), categoria: 'Marketing', conta: 'c:' + cEm, pago: false }),
        mk({ tipo: 'despesa', desc: 'Imposto do Simples', valor: 1250, data: dia(mes, Math.min(28, hd + 1)), categoria: 'Impostos', conta: 'pj', boleto: true, pago: false }),
        mk({ tipo: 'receita', desc: 'Vendas do mês anterior', valor: 14800, data: dia(ant, 10), categoria: 'Vendas', conta: 'pj' }),
        mk({ tipo: 'despesa', desc: 'Fornecedor de peças', valor: 3900, data: dia(ant, 12), categoria: 'Fornecedores', conta: 'pj' }),
      ] };
    S.guia = true; V.cartao = null; V.fmes = null; salvar(); render(); aviso('Dados de exemplo carregados nos dois perfis.');
  }

  /* ---------- ações ---------- */
  function pagarItem(tipo, id) {
    const d = D();
    if (tipo === 'fatura') { formPagarFatura(id); return; }
    const l = d.lancs.find((x) => x.id === id); if (l) l.pago = true;
    salvar(); render(); aviso('Marcado como pago.');
  }
  function exportar() {
    const d = D(); const linhas = ['data;descricao;categoria;conta;tipo;valor;pago'];
    d.lancs.filter((l) => F.mesDe(l.data) === V.mes).sort((a, b) => a.data.localeCompare(b.data)).forEach((l) => linhas.push([l.data, `"${(l.desc || '').replace(/"/g, '""')}"`, l.categoria, nomeConta(l.conta), l.tipo, String(l.valor).replace('.', ','), l.pago ? 'sim' : 'não'].join(';')));
    baixar(new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' }), `lepvi-financas-${V.mes}.csv`);
  }
  function baixar(blob, nome) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-acao],[data-tela],[data-perfil]'); if (!t) return;
    if (t.dataset.tela) { ir(t.dataset.tela); return; }
    if (t.dataset.perfil) { S.perfil = t.dataset.perfil; V.cartao = null; V.fmes = null; salvar(); render(); return; }
    const d = D(); const id = t.dataset.id; const a = t.dataset.acao;
    const acoes = {
      acess: () => formAcess(),
      olho: () => { S.oculto = !S.oculto; salvar(); render(); },
      mais: () => ir('mais'),
      mes: () => { V.mes = F.somaMes(V.mes, +t.dataset.d); render(); },
      fmes: () => { V.fmes = F.somaMes(V.fmes, +t.dataset.d); render(); },
      filtro: () => { V.filtro = t.dataset.v; render(); },
      sub: () => { V.sub = t.dataset.v; render(); },
      plano: () => { V.plano = t.dataset.v; render(); },
      reltipo: () => { V.reltipo = t.dataset.v; render(); },
      'menu-novo': () => menuNovo(),
      novo: () => formLanc({}, 'despesa'),
      'novo-boleto': () => formLanc({ boleto: true, pago: false, tipo: 'despesa' }, 'despesa'),
      'novo-no-cartao': () => formLanc({ conta: 'c:' + id }, 'cartao'),
      editar: () => formLanc(d.lancs.find((l) => l.id === id)),
      alternar: () => { const l = d.lancs.find((x) => x.id === id); l.pago = !l.pago; salvar(); render(); aviso(l.pago ? 'Marcado como pago/recebido.' : 'Voltou para pendente.'); },
      'novo-cartao': () => formCartao(),
      'editar-cartao': () => formCartao(d.cartoes.find((c) => c.id === id)),
      'sel-cartao': () => { V.cartao = id; V.fmes = null; render(); },
      'nova-conta': () => formConta(),
      'editar-conta': () => formConta(d.contas.find((c) => c.id === id)),
      'editar-conta-1': () => formConta(d.contas[0]),
      pagar: () => pagarItem(t.dataset.tipo, id),
      'pagar-fatura': () => formPagarFatura(id),
      'novo-orc': () => formOrc(),
      'editar-orc': () => formOrc(id),
      'novo-obj': () => formObj(),
      'editar-obj': () => formObj(d.objetivos.find((o) => o.id === id)),
      aporte: () => formAporte(d.objetivos.find((o) => o.id === id)),
      'ir-pagar': () => { V.sub = 'apagar'; ir('lancs'); },
      'ir-lancs': () => { V.sub = 'todos'; ir('lancs'); },
      'ir-cartoes': () => ir('cartoes'),
      'ir-rel': () => { V.plano = 'rel'; ir('planejar'); },
      'fechar-guia': () => { S.guia = true; salvar(); render(); },
      exportar,
      exemplo: () => { if (!d.lancs.length || confirm('Isso substitui os dados dos dois perfis. Continuar?')) exemplo(); },
      apagar: () => { if (confirm('Apagar todos os dados deste perfil? Não dá para desfazer.')) { S.dados[S.perfil] = vazio(); V.cartao = null; salvar(); render(); aviso('Dados apagados.'); } },
      backup: () => baixar(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), `lepvi-financas-${F.hojeISO()}.json`),
    };
    if (acoes[a]) acoes[a]();
  });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'busca') { V.q = ev.target.value; $('#lista-lancs').innerHTML = listaLancs(); } });
  document.addEventListener('change', (ev) => {
    const el = ev.target; if (!el.files || !el.files[0]) return;
    const arq = el.files[0]; const r = new FileReader();
    r.onload = () => {
      if (el.id === 'arq') importar(String(r.result), arq.name);
      if (el.id === 'rest') { try { const n = JSON.parse(r.result); if (!n.dados) throw 0; Object.assign(S, norm(n)); salvar(); render(); aviso('Cópia restaurada.'); } catch (e) { aviso('Arquivo de cópia inválido.'); } }
    };
    r.readAsText(arq); el.value = '';
  });

  /* ---------- acessibilidade (baixa visão) ---------- */
  function aplicarAcess() {
    const h = document.documentElement;
    h.dataset.texto = S.texto || 'normal';
    const forte = S.contraste != null ? S.contraste : window.matchMedia && matchMedia('(prefers-contrast: more)').matches;
    h.dataset.contraste = forte ? 'alto' : 'normal';
  }
  function formAcess() {
    abrir('Acessibilidade', `${campo('Tamanho do texto', radios('texto', [['normal', 'Normal'], ['grande', 'Grande'], ['enorme', 'Muito grande']], S.texto || 'normal'))}
      ${troca('contraste', 'Alto contraste (preto, branco e bordas fortes)', document.documentElement.dataset.contraste === 'alto')}
      ${troca('oculto', 'Ocultar valores na tela', !!S.oculto)}
      <p class="mut">As mudanças valem na hora e ficam salvas neste aparelho. Você também pode ampliar a página com o zoom do navegador.</p>`, null, (f) => {
      f.addEventListener('change', () => { S.texto = f.texto.value; S.contraste = f.contraste.checked; S.oculto = f.oculto.checked; salvar(); aplicarAcess(); render(); });
    });
  }
  aplicarAcess();
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
