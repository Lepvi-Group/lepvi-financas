/* Lepvi Finanças: telas e ações. As regras de cálculo ficam em lib.js (window.Fin). */
(function () {
  const F = window.Fin;
  const CHAVE = 'lepvi-financas-v1';
  const vazio = () => ({ contas: [{ id: 'carteira', nome: 'Carteira', saldoInicial: 0 }], cartoes: [], lancs: [] });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);

  function carregar() {
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE));
      if (s && s.dados) return s;
    } catch (e) { /* sem armazenamento: começa vazio */ }
    return { perfil: 'pessoal', dados: { pessoal: vazio(), empresa: vazio() } };
  }
  const S = carregar();
  const V = { tela: 'inicio', mes: F.mesDe(F.hojeISO()), filtro: 'todos' };
  const D = () => S.dados[S.perfil];
  function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(S)); } catch (e) { aviso('Não consegui salvar neste navegador.'); } }

  function aviso(t) {
    const el = $('#aviso'); el.textContent = t; el.classList.add('on');
    clearTimeout(aviso.t); aviso.t = setTimeout(() => el.classList.remove('on'), 2600);
  }

  const NOME_MES = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long' }) + ' ' + m.slice(0, 4);
  const DATA_CURTA = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const ICONES = {
    inicio: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    lancs: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    boletos: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    cartoes: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/>',
    mais: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  };
  const TELAS = [['inicio', 'Início'], ['lancs', 'Lançamentos'], ['boletos', 'Boletos'], ['cartoes', 'Cartões'], ['mais', 'Mais']];
  const nomeConta = (id) => {
    if (F.ehCartao({ conta: id })) { const c = D().cartoes.find((x) => x.id === id.slice(2)); return c ? 'Cartão ' + c.nome : 'Cartão'; }
    const c = D().contas.find((x) => x.id === id); return c ? c.nome : 'Conta';
  };

  /* ---------- telas ---------- */
  function seletorMes() {
    return `<div class="mes"><button type="button" data-acao="mes" data-d="-1" aria-label="Mês anterior">‹</button><strong>${esc(NOME_MES(V.mes))}</strong><button type="button" data-acao="mes" data-d="1" aria-label="Próximo mês">›</button></div>`;
  }
  function vazioTela(msg) {
    return `<div class="vazio"><p>${msg}</p><button class="btn" type="button" data-acao="novo">Novo lançamento</button> <button class="btn sec" type="button" data-acao="exemplo">Ver com dados de exemplo</button></div>`;
  }
  function itemPagar(i) {
    const selo = i.atrasado ? `<span class="selo atraso">Atrasado ${Math.abs(i.dias)}d</span>` : i.dias === 0 ? '<span class="selo hoje">Vence hoje</span>' : `<span class="selo">Em ${i.dias}d</span>`;
    const ico = i.tipo === 'fatura' ? '💳' : i.tipo === 'boleto' ? '🧾' : '📌';
    return `<li class="item"><span class="icone" aria-hidden="true">${ico}</span><div class="txt"><strong>${esc(i.titulo)}</strong><span>Vence ${DATA_CURTA(i.vencimento)} · ${selo}</span></div><div><div class="val">${F.brl(i.valor)}</div><button class="btn mini" type="button" data-acao="pagar" data-tipo="${i.tipo}" data-id="${esc(i.id)}">Paguei</button></div></li>`;
  }

  function telaInicio() {
    const d = D();
    if (!d.lancs.length && !d.cartoes.length) return `<div class="cabeca"><h1>Início</h1></div>` + vazioTela('Nada por aqui ainda. Lance sua primeira conta, boleto ou compra no cartão.');
    const r = F.resumoMes(d.lancs, V.mes);
    const pagar = F.aPagar(d.lancs, d.cartoes);
    const total = F.arred(pagar.reduce((s, i) => s + i.valor, 0));
    const saldoContas = F.arred(d.contas.reduce((s, c) => s + F.saldoConta(d.lancs, c), 0));
    const cats = Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1]);
    const max = cats.length ? cats[0][1] : 1;
    return `<div class="cabeca"><h1>Início</h1>${seletorMes()}</div>
    <div class="grade">
      <div class="card destaque"><small>Resultado do mês</small><b class="${r.saldo >= 0 ? 'pos' : 'neg'}">${F.brl(r.saldo)}</b></div>
      <div class="card"><small>Receitas</small><b class="pos">${F.brl(r.receitas)}</b></div>
      <div class="card"><small>Despesas</small><b class="neg">${F.brl(r.despesas)}</b></div>
      <div class="card"><small>Saldo nas contas</small><b>${F.brl(saldoContas)}</b></div>
      <div class="card"><small>Total a pagar</small><b>${F.brl(total)}</b></div>
    </div>
    <h2>Próximos vencimentos</h2>
    ${pagar.length ? `<ul class="lista">${pagar.slice(0, 6).map(itemPagar).join('')}</ul>` : '<div class="vazio"><p>Tudo pago. Nenhum vencimento pendente. 🎉</p></div>'}
    <h2>Para onde foi o dinheiro</h2>
    ${cats.length ? cats.map(([n, v]) => `<div class="cat"><div><span>${esc(n)}</span><b>${F.brl(v)}</b></div><div class="barra"><i style="width:${Math.max(4, (v / max) * 100)}%"></i></div></div>`).join('') : '<p class="nota">Sem despesas neste mês.</p>'}`;
  }

  function telaLancs() {
    const d = D();
    let lista = d.lancs.filter((l) => F.mesDe(l.data) === V.mes);
    if (V.filtro !== 'todos') lista = lista.filter((l) => l.tipo === V.filtro);
    lista.sort((a, b) => b.data.localeCompare(a.data));
    const chip = (v, t) => `<button type="button" data-acao="filtro" data-v="${v}" aria-pressed="${V.filtro === v}">${t}</button>`;
    return `<div class="cabeca"><h1>Lançamentos</h1>${seletorMes()}</div>
    <div class="chips">${chip('todos', 'Todos')}${chip('receita', 'Receitas')}${chip('despesa', 'Despesas')}</div>
    ${lista.length ? `<ul class="lista">${lista.map((l) => `<li><button class="item" type="button" data-acao="editar" data-id="${l.id}"><span class="icone" aria-hidden="true">${l.tipo === 'receita' ? '↗' : '↘'}</span><div class="txt"><strong>${esc(l.desc)}</strong><span>${DATA_CURTA(l.data)} · ${esc(l.categoria)} · ${esc(nomeConta(l.conta))}${l.pago ? '' : ' · <span class="selo hoje">Pendente</span>'}</span></div><div class="val ${l.tipo === 'receita' ? 'pos' : 'neg'}">${l.tipo === 'receita' ? '+' : '−'} ${F.brl(l.valor)}</div></button></li>`).join('')}</ul>` : vazioTela('Nenhum lançamento neste mês.')}`;
  }

  function telaBoletos() {
    const d = D();
    const pagar = F.aPagar(d.lancs, d.cartoes);
    const grupos = [['Atrasados', pagar.filter((i) => i.atrasado)], ['Próximos 7 dias', pagar.filter((i) => !i.atrasado && i.dias <= 7)], ['Depois', pagar.filter((i) => i.dias > 7)]];
    return `<div class="cabeca"><h1>Boletos e contas</h1><button class="btn" type="button" data-acao="novo-boleto">Novo boleto</button></div>
    ${pagar.length ? grupos.filter((g) => g[1].length).map((g) => `<h2>${g[0]}</h2><ul class="lista">${g[1].map(itemPagar).join('')}</ul>`).join('') : '<div class="vazio"><p>Nenhum boleto ou fatura pendente.</p><button class="btn" type="button" data-acao="novo-boleto">Cadastrar boleto</button></div>'}`;
  }

  function telaCartoes() {
    const d = D();
    const fats = F.faturas(d.lancs, d.cartoes);
    return `<div class="cabeca"><h1>Cartões</h1><button class="btn" type="button" data-acao="novo-cartao">Novo cartão</button></div>
    ${d.cartoes.length ? d.cartoes.map((c) => {
      const usado = F.limiteUsado(d.lancs, c.id); const pct = c.limite ? Math.min(100, (usado / c.limite) * 100) : 0;
      const fs = fats.filter((f) => f.cartaoId === c.id).slice(-4).reverse();
      return `<section class="cartao-bloco" aria-label="Cartão ${esc(c.nome)}"><h3>${esc(c.nome)}</h3>
        <div class="linha"><span>Usado ${F.brl(usado)}</span><span>Disponível ${F.brl(c.limite - usado)}</span></div>
        <div class="barra ${pct >= 90 ? 'cheia' : ''}" role="img" aria-label="${Math.round(pct)}% do limite usado"><i style="width:${pct}%"></i></div>
        <div class="linha"><span>Fecha dia ${c.fechamento}</span><span>Vence dia ${c.vencimento}</span></div>
        ${fs.map((f) => `<div class="fatura"><span>Fatura ${f.mes.slice(5)}/${f.mes.slice(0, 4)} · ${F.brl(f.total)}</span>${f.paga ? '<span class="selo ok">Paga</span>' : `<button class="btn mini" type="button" data-acao="pagar" data-tipo="fatura" data-id="${c.id}|${f.mes}">Paguei</button>`}</div>`).join('')}
        <div class="acoes"><button class="btn mini" type="button" data-acao="novo-no-cartao" data-id="${c.id}">Lançar compra</button><button class="btn mini sec" type="button" data-acao="editar-cartao" data-id="${c.id}">Editar</button></div></section>`;
    }).join('') : '<div class="vazio"><p>Cadastre seus cartões para acompanhar limite, fechamento e vencimento de cada fatura.</p><button class="btn" type="button" data-acao="novo-cartao">Cadastrar cartão</button></div>'}`;
  }

  function telaMais() {
    const d = D();
    return `<div class="cabeca"><h1>Mais</h1></div>
    <h2>Contas e carteiras</h2>
    <ul class="lista">${d.contas.map((c) => `<li><button class="item" type="button" data-acao="editar-conta" data-id="${c.id}"><span class="icone" aria-hidden="true">🏦</span><div class="txt"><strong>${esc(c.nome)}</strong><span>Saldo atual</span></div><div class="val">${F.brl(F.saldoConta(d.lancs, c))}</div></button></li>`).join('')}</ul>
    <p><button class="btn sec" type="button" data-acao="nova-conta">Adicionar conta</button></p>
    <h2>Importar extrato</h2>
    <p class="nota">Baixe o extrato ou a fatura no app do banco em OFX ou CSV (data;descrição;valor) e importe aqui. Você escolhe a conta antes de confirmar.</p>
    <p><label class="btn sec" style="display:inline-block;cursor:pointer">Escolher arquivo<input id="arq" type="file" accept=".ofx,.csv,.txt" hidden></label></p>
    <h2>Seus dados</h2>
    <p class="nota">Tudo fica salvo só neste aparelho. Faça uma cópia de segurança de vez em quando.</p>
    <p><button class="btn sec" type="button" data-acao="backup">Baixar cópia de segurança</button> <label class="btn sec" style="display:inline-block;cursor:pointer">Restaurar cópia<input id="rest" type="file" accept=".json" hidden></label></p>
    <p><button class="btn sec" type="button" data-acao="exemplo">Carregar dados de exemplo</button> <button class="btn perigo" type="button" data-acao="apagar">Apagar dados do perfil ${S.perfil === 'pessoal' ? 'pessoal' : 'da empresa'}</button></p>`;
  }

  const VISTAS = { inicio: telaInicio, lancs: telaLancs, boletos: telaBoletos, cartoes: telaCartoes, mais: telaMais };
  function render() {
    document.querySelectorAll('[data-perfil]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.perfil === S.perfil)));
    $('#menu').innerHTML = TELAS.map(([id, t]) => `<button type="button" data-tela="${id}" ${V.tela === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[id]}</svg>${t}</button>`).join('');
    $('#tela').innerHTML = VISTAS[V.tela]();
  }

  /* ---------- formulários ---------- */
  const dlg = $('#dlg');
  function abrir(html, ok) {
    dlg.innerHTML = `<form id="f">${html}</form>`;
    const f = $('#f', dlg);
    f.addEventListener('submit', (ev) => { ev.preventDefault(); if (ok(new FormData(f)) !== false) { dlg.close(); } });
    dlg.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.showModal();
  }
  const opts = (arr, sel) => arr.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');

  function formLanc(base = {}) {
    const d = D();
    const novo = !base.id;
    const tipo = base.tipo || 'despesa';
    const contas = [...d.contas.map((c) => [c.id, c.nome]), ...d.cartoes.map((c) => ['c:' + c.id, 'Cartão ' + c.nome])];
    const catsOpts = (t) => F.CATEGORIAS[t].map((c) => [c, c]);
    abrir(`<h2>${novo ? 'Novo lançamento' : 'Editar lançamento'}</h2>
      <div class="seg" role="radiogroup" aria-label="Tipo"><label><input type="radio" name="tipo" value="despesa" ${tipo === 'despesa' ? 'checked' : ''}><span>Despesa</span></label><label><input type="radio" name="tipo" value="receita" ${tipo === 'receita' ? 'checked' : ''}><span>Receita</span></label></div>
      <label>Descrição<input name="desc" required maxlength="80" value="${esc(base.desc || '')}" placeholder="Ex.: Mercado, Aluguel, Venda"></label>
      <div class="dupla"><label>Valor (R$)<input name="valor" required inputmode="decimal" value="${base.valor != null ? String(base.valor).replace('.', ',') : ''}" placeholder="0,00"></label>
      <label>Data${base.boleto ? ' de vencimento' : ''}<input name="data" type="date" required value="${base.data || F.hojeISO()}"></label></div>
      <div class="dupla"><label>Categoria<select name="categoria">${opts(catsOpts(tipo), base.categoria)}</select></label>
      <label>Conta ou cartão<select name="conta">${opts(contas, base.conta || (d.contas[0] && d.contas[0].id))}</select></label></div>
      ${novo ? '<label>Parcelas<input name="parcelas" type="number" min="1" max="48" value="1"></label>' : ''}
      <label class="marcar"><input type="checkbox" name="boleto" ${base.boleto ? 'checked' : ''}> É um boleto</label>
      <label class="marcar"><input type="checkbox" name="pago" ${base.pago ? 'checked' : ''}> Já está pago ou recebido</label>
      <div class="botoes">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const valor = F.arred(F.numeroBR(fd.get('valor')));
      if (!(valor > 0)) { aviso('Informe um valor maior que zero.'); return false; }
      const conta = fd.get('conta');
      const cartao = F.ehCartao({ conta });
      const reg = { tipo: fd.get('tipo'), desc: fd.get('desc').trim(), data: fd.get('data'), categoria: fd.get('categoria'), conta, boleto: !!fd.get('boleto') && !cartao && fd.get('tipo') === 'despesa', pago: !cartao && !!fd.get('pago') };
      if (novo) {
        const n = Math.max(1, Math.min(48, parseInt(fd.get('parcelas'), 10) || 1));
        const parte = F.arred(valor / n);
        for (let i = 0; i < n; i++) {
          const dia = Number(reg.data.slice(8, 10)); const mes = F.somaMes(F.mesDe(reg.data), i);
          const ult = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
          const v = i === n - 1 ? F.arred(valor - parte * (n - 1)) : parte;
          d.lancs.push({ ...reg, id: uid(), valor: v, desc: n > 1 ? `${reg.desc} (${i + 1}/${n})` : reg.desc, data: `${mes}-${String(Math.min(dia, ult)).padStart(2, '0')}`, pago: i === 0 ? reg.pago : false });
        }
      } else Object.assign(d.lancs.find((x) => x.id === base.id), reg, { valor });
      salvar(); render(); aviso('Lançamento salvo.');
    });
    const exc = $('#exc', dlg);
    if (exc) exc.onclick = () => { d.lancs = d.lancs.filter((x) => x.id !== base.id); salvar(); dlg.close(); render(); aviso('Lançamento excluído.'); };
    dlg.querySelectorAll('input[name=tipo]').forEach((r) => r.addEventListener('change', () => {
      $('select[name=categoria]', dlg).innerHTML = opts(catsOpts(r.value), '');
    }));
  }

  function formCartao(c = {}) {
    const novo = !c.id;
    abrir(`<h2>${novo ? 'Novo cartão' : 'Editar cartão'}</h2>
      <label>Nome do cartão<input name="nome" required maxlength="30" value="${esc(c.nome || '')}" placeholder="Ex.: Nubank, Itaú Empresa"></label>
      <label>Limite (R$)<input name="limite" required inputmode="decimal" value="${c.limite != null ? String(c.limite).replace('.', ',') : ''}"></label>
      <div class="dupla"><label>Dia do fechamento<input name="fechamento" type="number" min="1" max="31" required value="${c.fechamento || ''}"></label>
      <label>Dia do vencimento<input name="vencimento" type="number" min="1" max="31" required value="${c.vencimento || ''}"></label></div>
      <div class="botoes">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), limite: F.arred(F.numeroBR(fd.get('limite'))), fechamento: +fd.get('fechamento'), vencimento: +fd.get('vencimento') };
      if (!(reg.limite >= 0)) { aviso('Limite inválido.'); return false; }
      if (novo) D().cartoes.push({ id: uid(), ...reg }); else Object.assign(D().cartoes.find((x) => x.id === c.id), reg);
      salvar(); render(); aviso('Cartão salvo.');
    });
    const exc = $('#exc', dlg);
    if (exc) exc.onclick = () => {
      if (!confirm('Excluir este cartão e as compras dele?')) return;
      const d = D(); d.cartoes = d.cartoes.filter((x) => x.id !== c.id); d.lancs = d.lancs.filter((l) => l.conta !== 'c:' + c.id);
      salvar(); dlg.close(); render(); aviso('Cartão excluído.');
    };
  }

  function formConta(c = {}) {
    const novo = !c.id;
    abrir(`<h2>${novo ? 'Nova conta' : 'Editar conta'}</h2>
      <label>Nome<input name="nome" required maxlength="30" value="${esc(c.nome || '')}" placeholder="Ex.: Banco do Brasil, Caixa da loja"></label>
      <label>Saldo inicial (R$)<input name="saldo" inputmode="decimal" value="${c.saldoInicial != null ? String(c.saldoInicial).replace('.', ',') : '0'}"></label>
      <div class="botoes">${novo || D().contas.length < 2 ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), saldoInicial: F.arred(F.numeroBR(fd.get('saldo') || '0')) };
      if (novo) D().contas.push({ id: uid(), ...reg }); else Object.assign(D().contas.find((x) => x.id === c.id), reg);
      salvar(); render(); aviso('Conta salva.');
    });
    const exc = $('#exc', dlg);
    if (exc) exc.onclick = () => {
      if (!confirm('Excluir esta conta e os lançamentos dela?')) return;
      const d = D(); d.contas = d.contas.filter((x) => x.id !== c.id); d.lancs = d.lancs.filter((l) => l.conta !== c.id);
      salvar(); dlg.close(); render(); aviso('Conta excluída.');
    };
  }

  function importar(texto, nome) {
    const lista = /\.csv$|\.txt$/i.test(nome) ? F.lerCSV(texto) : F.lerOFX(texto);
    if (!lista.length) { aviso('Não encontrei lançamentos nesse arquivo.'); return; }
    const d = D();
    const contas = [...d.contas.map((c) => [c.id, c.nome]), ...d.cartoes.map((c) => ['c:' + c.id, 'Cartão ' + c.nome])];
    abrir(`<h2>Importar ${lista.length} lançamentos</h2>
      <p class="nota">Primeiros itens: ${lista.slice(0, 3).map((l) => esc(l.desc)).join(', ')}…<br>Lançamentos repetidos (mesma data, valor e descrição) são ignorados.</p>
      <label>Importar para<select name="conta">${opts(contas, '')}</select></label>
      <div class="botoes"><button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn" type="submit">Importar</button></div>`,
    (fd) => {
      const conta = fd.get('conta'); const cartao = F.ehCartao({ conta });
      const chave = (l) => `${l.data}|${l.valor}|${l.desc}|${l.conta}`;
      const ja = new Set(d.lancs.map(chave)); let n = 0;
      lista.forEach((l) => {
        const novo = { ...l, id: uid(), conta, boleto: false, pago: cartao ? false : true };
        if (cartao && novo.tipo === 'receita') return;
        if (ja.has(chave(novo))) return; ja.add(chave(novo)); d.lancs.push(novo); n++;
      });
      salvar(); render(); aviso(`${n} lançamentos importados.`);
    });
  }

  /* ---------- exemplo ---------- */
  function exemplo() {
    const hoje = new Date(); const m = F.mesDe(F.hojeISO()); const ant = F.somaMes(m, -1); const prox = F.somaMes(m, 1);
    const dia = (mes, n) => `${mes}-${String(n).padStart(2, '0')}`;
    const mk = (o) => ({ id: uid(), boleto: false, pago: true, ...o });
    const cNu = uid(); const cIt = uid();
    const pes = {
      contas: [{ id: 'banco', nome: 'Conta corrente', saldoInicial: 1200 }, { id: 'carteira', nome: 'Carteira', saldoInicial: 150 }],
      cartoes: [{ id: cNu, nome: 'Nubank', limite: 6000, fechamento: 25, vencimento: 5 }, { id: cIt, nome: 'Itaú Platinum', limite: 9000, fechamento: 10, vencimento: 17 }],
      lancs: [
        mk({ tipo: 'receita', desc: 'Salário', valor: 5800, data: dia(m, 5), categoria: 'Salário', conta: 'banco' }),
        mk({ tipo: 'despesa', desc: 'Aluguel', valor: 1650, data: dia(m, 8), categoria: 'Moradia', conta: 'banco' }),
        mk({ tipo: 'despesa', desc: 'Conta de luz', valor: 189.4, data: dia(m, Math.min(28, hoje.getDate() + 3)), categoria: 'Moradia', conta: 'banco', boleto: true, pago: false }),
        mk({ tipo: 'despesa', desc: 'Internet', valor: 119.9, data: dia(m, Math.max(1, hoje.getDate() - 2)), categoria: 'Moradia', conta: 'banco', boleto: true, pago: false }),
        mk({ tipo: 'despesa', desc: 'Supermercado', valor: 412.35, data: dia(m, 12), categoria: 'Mercado', conta: 'c:' + cNu, pago: false }),
        mk({ tipo: 'despesa', desc: 'Restaurante', valor: 96.5, data: dia(m, 14), categoria: 'Lazer', conta: 'c:' + cNu, pago: false }),
        mk({ tipo: 'despesa', desc: 'Netflix', valor: 55.9, data: dia(m, 3), categoria: 'Assinaturas', conta: 'c:' + cIt, pago: false }),
        mk({ tipo: 'despesa', desc: 'Farmácia', valor: 134.2, data: dia(ant, 20), categoria: 'Saúde', conta: 'c:' + cIt, pago: true }),
        mk({ tipo: 'despesa', desc: 'Notebook (1/3)', valor: 1100, data: dia(m, 9), categoria: 'Outros', conta: 'c:' + cIt, pago: false }),
        mk({ tipo: 'despesa', desc: 'Notebook (2/3)', valor: 1100, data: dia(prox, 9), categoria: 'Outros', conta: 'c:' + cIt, pago: false }),
      ],
    };
    const cEm = uid();
    const emp = {
      contas: [{ id: 'pj', nome: 'Conta PJ', saldoInicial: 8000 }],
      cartoes: [{ id: cEm, nome: 'Cartão Empresa', limite: 15000, fechamento: 20, vencimento: 28 }],
      lancs: [
        mk({ tipo: 'receita', desc: 'Vendas da semana', valor: 12400, data: dia(m, 6), categoria: 'Vendas', conta: 'pj' }),
        mk({ tipo: 'receita', desc: 'Serviço de manutenção', valor: 3200, data: dia(m, 11), categoria: 'Serviços', conta: 'pj' }),
        mk({ tipo: 'despesa', desc: 'Fornecedor de peças', valor: 4300, data: dia(m, Math.min(28, hoje.getDate() + 5)), categoria: 'Fornecedores', conta: 'pj', boleto: true, pago: false }),
        mk({ tipo: 'despesa', desc: 'Pró-labore', valor: 3500, data: dia(m, 5), categoria: 'Folha e pró-labore', conta: 'pj' }),
        mk({ tipo: 'despesa', desc: 'Anúncios online', valor: 780, data: dia(m, 10), categoria: 'Marketing', conta: 'c:' + cEm, pago: false }),
        mk({ tipo: 'despesa', desc: 'Imposto do Simples', valor: 1250, data: dia(m, Math.min(28, hoje.getDate() + 1)), categoria: 'Impostos', conta: 'pj', boleto: true, pago: false }),
      ],
    };
    S.dados.pessoal = pes; S.dados.empresa = emp;
    salvar(); render(); aviso('Dados de exemplo carregados nos dois perfis.');
  }

  /* ---------- eventos ---------- */
  function pagarItem(tipo, id) {
    const d = D();
    if (tipo === 'fatura') {
      const [cid, mes] = id.split('|'); const c = d.cartoes.find((x) => x.id === cid);
      d.lancs.forEach((l) => { if (F.ehCartao(l) && F.idCartao(l) === cid && l.tipo === 'despesa' && F.faturaDe(c, l.data).mes === mes) l.pago = true; });
    } else { const l = d.lancs.find((x) => x.id === id); if (l) l.pago = true; }
    salvar(); render(); aviso('Marcado como pago.');
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-acao],[data-tela],[data-perfil]'); if (!t) return;
    if (t.dataset.tela) { V.tela = t.dataset.tela; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.perfil) { S.perfil = t.dataset.perfil; salvar(); render(); return; }
    const d = D(); const id = t.dataset.id;
    switch (t.dataset.acao) {
      case 'mes': V.mes = F.somaMes(V.mes, +t.dataset.d); render(); break;
      case 'filtro': V.filtro = t.dataset.v; render(); break;
      case 'novo': formLanc(); break;
      case 'novo-boleto': formLanc({ boleto: true, pago: false, tipo: 'despesa', data: F.hojeISO() }); break;
      case 'novo-no-cartao': formLanc({ conta: 'c:' + id, tipo: 'despesa' }); break;
      case 'editar': formLanc(d.lancs.find((l) => l.id === id)); break;
      case 'novo-cartao': formCartao(); break;
      case 'editar-cartao': formCartao(d.cartoes.find((c) => c.id === id)); break;
      case 'nova-conta': formConta(); break;
      case 'editar-conta': formConta(d.contas.find((c) => c.id === id)); break;
      case 'pagar': pagarItem(t.dataset.tipo, id); break;
      case 'exemplo': if (!d.lancs.length || confirm('Isso substitui os dados dos dois perfis. Continuar?')) exemplo(); break;
      case 'apagar': if (confirm('Apagar todos os dados deste perfil? Não dá para desfazer.')) { S.dados[S.perfil] = vazio(); salvar(); render(); aviso('Dados apagados.'); } break;
      case 'backup': {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
        a.download = `lepvi-financas-${F.hojeISO()}.json`; a.click(); URL.revokeObjectURL(a.href); break;
      }
    }
  });
  $('#novo').addEventListener('click', () => formLanc());
  document.addEventListener('change', (ev) => {
    const el = ev.target; if (!el.files || !el.files[0]) return;
    const arq = el.files[0]; const r = new FileReader();
    r.onload = () => {
      if (el.id === 'arq') importar(String(r.result), arq.name);
      if (el.id === 'rest') {
        try { const n = JSON.parse(r.result); if (!n.dados) throw 0; Object.assign(S, n); salvar(); render(); aviso('Cópia restaurada.'); } catch (e) { aviso('Arquivo de cópia inválido.'); }
      }
    };
    r.readAsText(arq); el.value = '';
  });

  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
