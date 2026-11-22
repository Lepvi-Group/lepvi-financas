/* Lepvi Finanças: telas e ações. As regras de cálculo ficam em lib.js (window.Fin). */
(function () {
  const F = window.Fin;
  const CHAVE = 'lepvi-financas-v1';
  const CORES = ['#2D4BFF', '#8A3DFF', '#C04DFF', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#0D0D0F'];
  const vazio = () => ({ cats: { despesa: [], receita: [] }, contas: [{ id: 'carteira', nome: 'Carteira', saldoInicial: 0, cor: '#10B981' }], cartoes: [], lancs: [], orcamentos: {}, objetivos: [] });
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
  const PREFS = 'lepvi-financas-prefs';
  const S = norm({ perfil: 'pessoal', dados: {} }); // dados financeiros: só em memória e no servidor (nunca no aparelho)
  const USER = { logado: false, info: null };
  try { const p = JSON.parse(localStorage.getItem(PREFS)); if (p) { S.texto = p.texto; S.contraste = p.contraste; S.oculto = p.oculto; } } catch (e) { /* sem preferências guardadas */ }
  const V = { tela: 'inicio', mes: F.mesDe(F.hojeISO()), filtro: 'todos', sub: 'todos', q: '', plano: 'orc', reltipo: 'despesa', cartao: null, fmes: null, auth: 'entrar', token: '', msg: '' };
  const D = () => S.dados[S.perfil];

  /* ---------- servidor: conta, sessão e dados ---------- */
  async function api(acao, corpo) {
    const post = corpo !== undefined; let r;
    try { r = await fetch('api/?a=' + acao, { method: post ? 'POST' : 'GET', headers: post ? { 'Content-Type': 'application/json', 'X-Lepvi': 'financas' } : { 'X-Lepvi': 'financas' }, body: post ? JSON.stringify(corpo) : undefined }); }
    catch (e) { const x = new Error('Sem conexão com o servidor. Confira a internet e tente de novo.'); x.rede = true; throw x; }
    let j = {}; try { j = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) { const x = new Error(j.erro || 'Algo deu errado. Tente de novo.'); x.status = r.status; x.conflito = !!j.conflito; if (r.status === 401 && USER.logado) sessaoExpirou(); throw x; }
    return j;
  }
  let versaoServidor = 0; let enviando = false; let precisaEnviar = false; let tmr = null;
  function limparMemoria() { const n = norm({ perfil: 'pessoal', dados: {} }); S.dados = n.dados; S.perfil = 'pessoal'; S.guia = false; versaoServidor = 0; V.cartao = null; V.fmes = null; V.tela = 'inicio'; }
  function sessaoExpirou() { USER.logado = false; limparMemoria(); V.auth = 'entrar'; V.msg = 'Sua sessão terminou. Entre de novo.'; render(); }
  function salvar() {
    try { localStorage.setItem(PREFS, JSON.stringify({ texto: S.texto, contraste: S.contraste, oculto: S.oculto })); } catch (e) { /* sem armazenamento */ }
    if (!USER.logado) return;
    precisaEnviar = true; clearTimeout(tmr); tmr = setTimeout(enviarDados, 600);
  }
  async function enviarDados() {
    if (enviando || !USER.logado) return;
    enviando = true;
    while (precisaEnviar && USER.logado) {
      precisaEnviar = false;
      try { versaoServidor = (await api('dados', { versao: versaoServidor, conteudo: { perfil: S.perfil, guia: !!S.guia, dados: S.dados } })).versao; }
      catch (e) {
        if (e.conflito) { await carregarDados(); render(); aviso('Seus dados foram alterados em outro aparelho. Mostramos a versão mais recente.'); break; }
        if (e.rede) { precisaEnviar = true; aviso('Sem conexão. Vamos tentar salvar de novo.'); await new Promise((ok) => setTimeout(ok, 5000)); continue; }
        aviso(e.message); break;
      }
    }
    enviando = false;
  }
  window.addEventListener('online', () => { if (precisaEnviar) enviarDados(); });
  async function carregarDados() {
    const r = await api('dados');
    versaoServidor = r.versao;
    if (r.conteudo && r.conteudo.dados) { const n = norm({ perfil: r.conteudo.perfil, dados: r.conteudo.dados }); S.perfil = n.perfil; S.dados = n.dados; S.guia = !!r.conteudo.guia; return; }
    limparMemoria();
    try { // dados da versão antiga do app, que ficavam só neste aparelho: sobem para a conta
      const antigo = JSON.parse(localStorage.getItem(CHAVE));
      if (antigo && antigo.dados) { const n = norm(antigo); S.perfil = n.perfil; S.dados = n.dados; S.guia = !!antigo.guia; localStorage.removeItem(CHAVE); salvar(); aviso('Trouxemos para a sua conta os dados que estavam neste aparelho.'); }
    } catch (e) { /* nada para importar */ }
  }

  /* ---------- entrar, criar conta, esqueci a senha ---------- */
  function telaAuth() {
    const modo = V.auth; const msg = V.msg ? `<p class="${V.msgErro ? 'erro' : 'ok-msg'}" role="${V.msgErro ? 'alert' : 'status'}">${esc(V.msg)}</p>` : '';
    const erro = '<p class="erro" role="alert" id="auth-erro" tabindex="-1" hidden></p>';
    const mostrar = '';
    const link = (a, t) => `<button class="link" type="button" data-acao="${a}">${t}</button>`;
    const gIc = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.4-4.7 3.4-7.9z"/><path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.5-2.7c-1 .6-2.2 1-3.7 1-2.8 0-5.2-1.9-6-4.5H2.4v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M6 14.2a6.6 6.6 0 0 1 0-4.4V7H2.4a11 11 0 0 0 0 10z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.4 7L6 9.8c.8-2.6 3.2-4.4 6-4.4z"/></svg>';
    const mIc = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>';
    const social = (rotulo) => `<div class="sociais"><button class="btn-social" type="button" data-acao="oauth" data-p="google">${gIc}<span>${rotulo} com Google</span></button><button class="btn-social" type="button" data-acao="oauth" data-p="microsoft">${mIc}<span>${rotulo} com Microsoft</span></button></div><p class="ou"><span>ou use seu e-mail</span></p>`;
    let titulo; let corpo;
    if (modo === 'enviado') { titulo = 'Confira seu e-mail'; corpo = `${msg}<button class="btn" type="button" data-acao="auth-entrar">Voltar para entrar</button>`; }
    else if (modo === 'oauth-aceite') {
      const pd = V.pend || {};
      titulo = 'Quase lá';
      corpo = `<p>Você entrou com <b>${esc(pd.provedor || '')}</b> como <b>${esc(pd.email || '')}</b>. Para criar sua conta, aceite a Política de Privacidade e os Termos de Uso.</p><form id="auth" class="auth-f" novalidate>
        <label class="troca"><span>Li e aceito a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> e os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a></span><input type="checkbox" role="switch" name="aceite" required></label>${erro}
        <button class="btn bloco" type="submit">Criar minha conta</button></form><p class="mut">${link('auth-entrar', 'Cancelar')}</p>`;
    } else if (modo === 'cadastro') {
      titulo = 'Criar sua conta';
      corpo = `${social('Cadastrar')}<form id="auth" class="auth-f" novalidate>${campo('Seu nome', '<input name="nome" required maxlength="120" autocomplete="name">')}${campo('E-mail', '<input name="email" type="email" required autocomplete="username" inputmode="email">')}${campoSenha('Senha (mínimo 10 caracteres)', 'name="senha" type="password" required minlength="10" autocomplete="new-password"')}${mostrar}
        <label class="troca"><span>Li e aceito a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> e os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a></span><input type="checkbox" role="switch" name="aceite" required></label>${erro}
        <button class="btn bloco" type="submit">Criar conta</button></form><p class="mut">Já tem conta? ${link('auth-entrar', 'Entrar')}</p>`;
    } else if (modo === 'esqueci') {
      titulo = 'Esqueci minha senha';
      corpo = `<form id="auth" class="auth-f" novalidate><p class="mut">Informe o e-mail da sua conta. Se ele existir, enviamos um link para criar uma nova senha.</p>${campo('E-mail', '<input name="email" type="email" required autocomplete="username" inputmode="email">')}${erro}<button class="btn bloco" type="submit">Enviar link</button></form><p class="mut">${link('auth-entrar', 'Voltar para entrar')}</p>`;
    } else if (modo === 'redefinir') {
      titulo = 'Criar nova senha';
      corpo = `<form id="auth" class="auth-f" novalidate>${campoSenha('Nova senha (mínimo 10 caracteres)', 'name="senha" type="password" required minlength="10" autocomplete="new-password"')}${mostrar}${erro}<button class="btn bloco" type="submit">Salvar nova senha</button></form>`;
    } else {
      titulo = 'Entrar';
      corpo = `${msg}${social('Entrar')}<form id="auth" class="auth-f" novalidate>${campo('E-mail', '<input name="email" type="email" required autocomplete="username" inputmode="email">')}${campoSenha('Senha', 'name="senha" type="password" required autocomplete="current-password"')}${mostrar}${erro}<button class="btn bloco" type="submit">Entrar</button></form>
        <p class="mut">${link('auth-esqueci', 'Esqueci minha senha')}</p><p class="mut">Ainda não tem conta? ${link('auth-cadastro', 'Criar conta grátis')}</p>`;
    }
    const ic = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const selos = [
      [ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'), 'Dados cifrados', 'Seus lançamentos ficam ilegíveis para qualquer outra pessoa.'],
      [ic('<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'), 'Em conformidade com a LGPD', 'Você baixa ou apaga tudo quando quiser.'],
      [ic('<path d="M3 21h18M5 21V10m14 11V10M9 21v-7m6 7v-7M3 10l9-6 9 6"/><path d="M4 4l16 16" stroke-width="2.2"/>'), 'Sem acesso ao seu banco', 'Nunca pedimos senha de banco nem movimentamos dinheiro.'],
    ];
    return `<section class="entrada">
      <aside class="vitrine">
        <span class="vit-luz l1" aria-hidden="true"></span><span class="vit-luz l2" aria-hidden="true"></span>
        <div class="vit-marca" role="img" aria-label="Lepvi Finanças"><svg viewBox="0 0 100 100" aria-hidden="true" fill="currentColor"><path d="M10 24L34 0V64L46 76H90L66 100H10Z"/><path d="M60 26H84V50H60Z"/></svg><span>lepvi <b>finanças</b></span></div>
        <h2>Suas finanças,<br><em>sem susto.</em></h2>
        <p class="vit-p">Contas, cartões e boletos de você e da sua empresa em um só lugar, com aviso por e-mail antes de cada vencimento.</p>
        <ul class="vit-lista"><li><i aria-hidden="true">✓</i>Fatura de cada cartão, mês a mês</li><li><i aria-hidden="true">✓</i>Aviso antes, no dia e depois de vencer</li><li><i aria-hidden="true">✓</i>Orçamento por categoria e objetivos</li></ul>
        <div class="vit-cards" aria-hidden="true">
          <div class="mini c1"><small>Saldo geral</small><b>R$ 12.572,00</b><div class="mini-barra"><i></i></div></div>
          <div class="mini c2"><span class="ponto"></span><span class="mini-t"><b>Fatura Nubank</b><small>vence em 3 dias</small></span><b>R$ 1.250,00</b></div>
          <div class="mini c3"><span class="mini-rosca"></span><span class="mini-t"><small>Gastos do mês</small><b>Mercado 32%</b></span></div>
        </div>
      </aside>
      <div class="auth">
        <div class="card auth-c"><h1>${titulo}</h1>${modo === 'entrar' ? '<p class="mut">Que bom ter você aqui. Entre para ver suas contas.</p>' : ''}${corpo}</div>
        <ul class="selos">${selos.map(([i, t, d]) => `<li>${i}<span><b>${t}</b><small>${d}</small></span></li>`).join('')}</ul>
        <p class="mut auth-seg"><a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> · <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a></p>
      </div></section>`;
  }
  async function enviarAuth(f) {
    const btn = f.querySelector('button[type=submit]'); const er = $('#auth-erro'); er.hidden = true;
    if (!f.checkValidity()) { er.textContent = 'Preencha todos os campos corretamente' + (f.aceite && !f.aceite.checked ? ' e aceite a Política de Privacidade e os Termos.' : '.'); er.hidden = false; er.focus(); return; }
    const v = Object.fromEntries(new FormData(f)); const rotulo = btn.textContent; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = V.auth === 'entrar' ? 'Entrando…' : 'Enviando…';
    try {
      if (V.auth === 'entrar') { const r = await api('entrar', { email: v.email, senha: v.senha }); USER.logado = true; USER.info = r.usuario; await carregarDados(); V.msg = ''; V.tela = 'inicio'; render(); window.scrollTo(0, 0); }
      else if (V.auth === 'cadastro') { const r = await api('cadastro', { nome: v.nome, email: v.email, senha: v.senha, aceite: !!v.aceite }); V.auth = 'enviado'; V.msg = r.mensagem; render(); }
      else if (V.auth === 'oauth-aceite') { const r = await api('oauth_concluir', { aceite: !!v.aceite }); if (r.usuario) { USER.logado = true; USER.info = r.usuario; await carregarDados(); V.msg = ''; V.tela = 'inicio'; render(); window.scrollTo(0, 0); } else { V.auth = 'enviado'; V.msg = r.mensagem; render(); } }
      else if (V.auth === 'esqueci') { const r = await api('esqueci', { email: v.email }); V.auth = 'enviado'; V.msg = r.mensagem; render(); }
      else if (V.auth === 'redefinir') { await api('redefinir', { token: V.token, senha: v.senha }); V.auth = 'entrar'; V.token = ''; V.msg = 'Senha alterada. Entre com a nova senha.'; render(); }
    } catch (e) { er.textContent = e.message; er.hidden = false; er.focus(); btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = rotulo; }
  }
  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'auth') { ev.preventDefault(); enviarAuth(ev.target); }
    if (ev.target.id === 'perfil-f') { ev.preventDefault(); const nome = ev.target.nome.value.trim(); api('preferencias', { nome }).then((r) => { USER.info = r.usuario; render(); aviso('Perfil salvo.'); }).catch((e) => aviso(e.message)); }
  });
  async function iniciar() {
    $('#tela').innerHTML = '<p class="mut" role="status">Carregando…</p>';
    const q = new URLSearchParams(location.search); const tv = q.get('verificar'); const tr = q.get('redefinir');
    if (tv || tr) history.replaceState(null, '', location.pathname);
    const oa = q.get('oauth'); const op = q.get('p');
    if (oa) history.replaceState(null, '', location.pathname);
    const NOME_P = op === 'google' ? 'Google' : 'Microsoft';
    const MENS = { 'nao-configurado': `Entrar com ${NOME_P} ainda não está ativo. Use seu e-mail e senha por enquanto.`, erro: 'Não foi possível entrar. Tente de novo.', cancelado: 'Você cancelou a entrada.', muitas: 'Muitas tentativas. Espere alguns minutos.', 'erro-conta-existente': 'Já existe uma conta com este e-mail. Entre com a senha e tente de novo.', 'erro-confirme-email': 'Confirme seu e-mail pelo link que enviamos antes de entrar.', 'erro-sem-email': 'O provedor não informou seu e-mail. Use e-mail e senha.', 'erro-dados': 'Não foi possível entrar. Tente de novo.' };
    if (oa === 'aceite') { try { V.pend = await api('oauth_pendente'); V.auth = 'oauth-aceite'; } catch (e) { V.msg = e.message; V.msgErro = true; } }
    else if (oa && oa !== 'ok') { V.msg = MENS[oa] || MENS.erro; V.msgErro = true; }
    if (tv) { try { await api('verificar', { token: tv }); V.msg = 'E-mail confirmado! Agora é só entrar.'; } catch (e) { V.msg = e.message; } }
    if (tr) { V.auth = 'redefinir'; V.token = tr; }
    try { const r = await api('eu'); USER.logado = true; USER.info = r.usuario; await carregarDados(); } catch (e) { /* sem sessão: mostra a entrada */ }
    render();
  }

  const m = (v) => (S.oculto ? 'R$ •••' : F.brl(v));
  function aviso(t) { const el = $('#aviso'); el.textContent = t; el.classList.add('on'); clearTimeout(aviso.t); aviso.t = setTimeout(() => el.classList.remove('on'), 6000); }

  const NOME_MES = (x) => new Date(x + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long' }) + ' ' + x.slice(0, 4);
  const MES_CURTO = (x) => new Date(x + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const DIA_LONGO = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '');
  const DATA_CURTA = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const ontem = () => { const x = new Date(); x.setDate(x.getDate() - 1); return F.hojeISO(x); };
  const fundo = (cor) => `background:linear-gradient(135deg,${cor},#0D0D0F 150%)`;
  const EYE = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_OFF = '<path d="M9.9 4.2A10.6 10.6 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-3.2 4.3M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a10.4 10.4 0 0 0 5.4-1.5"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/><path d="M2 2l20 20"/>';
  const ICONES = {
    inicio: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    lancs: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    cartoes: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/>',
    planejar: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  };

  const catInfo = (n, t) => { const d = D(); const c = [...((d.cats && d.cats.despesa) || []), ...((d.cats && d.cats.receita) || [])].find((x) => x.nome === n); return c ? { nome: c.nome, icone: c.icone, cor: c.cor } : F.catInfo(n, t); };
  const catsDe = (tipo) => F.CATEGORIAS[tipo].concat((D().cats && D().cats[tipo]) || []);
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
    const lista = Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, v, catInfo(n, tipo).cor]);
    if (lista.length > 6) { const resto = lista.slice(5).reduce((s, e) => s + e[1], 0); return lista.slice(0, 5).concat([['Outras', resto, '#94A3B8']]); }
    return lista;
  };
  function itemLanc(l) {
    const transf = l.tipo === 'transf';
    const info = transf ? { icone: '🔁', cor: '#2D4BFF' } : catInfo(l.categoria, l.tipo);
    const cartao = F.ehCartao(l);
    const sub = transf ? `${esc(nomeConta(l.conta))} → ${esc(nomeConta(l.destino))}` : `${esc(l.categoria)} · ${cartao ? '💳 ' : ''}${esc(nomeConta(l.conta))}${(l.tags || []).map((t) => ` <span class="tag">#${esc(t)}</span>`).join('')}`;
    const sinal = l.tipo === 'receita' ? '+ ' : transf ? '' : '− ';
    const cor = l.tipo === 'receita' ? 'pos' : transf ? '' : 'neg';
    const visto = cartao ? '' : `<button class="visto ${l.pago ? 'on' : ''}" type="button" data-acao="alternar" data-id="${l.id}" aria-label="Pago ou recebido: ${esc(l.desc || l.categoria)}" aria-pressed="${!!l.pago}">${l.pago ? '✓' : ''}</button>`;
    return `<li><div class="item"><button class="item" style="border:0;padding:0;flex:1;min-width:0" type="button" data-acao="editar" data-id="${l.id}"><span class="ic" style="background:${info.cor}22">${info.icone}</span><span class="txt"><strong>${esc(l.desc || (transf ? 'Transferência' : l.categoria))}</strong><span>${sub}${!l.pago && !cartao ? ' · <span class="selo hoje">Pendente</span>' : ''}</span></span><span class="val num ${cor}">${sinal}${m(l.valor)}</span></button>${visto}</div></li>`;
  }
  function itemPagar(i) {
    const selo = i.atrasado ? `<span class="selo atraso">Atrasado ${Math.abs(i.dias)}d</span>` : i.dias === 0 ? '<span class="selo hoje">Vence hoje</span>' : `<span class="selo">Em ${i.dias}d</span>`;
    return `<li><div class="item"><span class="ic" style="background:#EEF0FF">${i.tipo === 'fatura' ? '💳' : i.tipo === 'boleto' ? '🧾' : '📌'}</span><div class="txt"><strong>${esc(i.titulo)}</strong><span>Vence ${DATA_CURTA(i.vencimento)} · ${selo}</span></div><div class="val num">${m(i.valor)}<br><button class="btn mini" type="button" data-acao="pagar" data-tipo="${i.tipo}" data-id="${esc(i.id)}">Paguei</button></div></div></li>`;
  }

  /* ---------- telas ---------- */
  function telaInicio() {
    const d = D();
    const somaContas = (f) => F.arred(d.contas.filter((c) => !c.fora && f(c)).reduce((t, c) => t + F.saldoConta(d.lancs, c), 0));
    const saldo = somaContas((c) => c.tipo !== 'investimento'); const investido = somaContas((c) => c.tipo === 'investimento');
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
    return `<div class="hero"><small>Saldo geral</small><span class="grande num">${m(saldo)}</span>${investido ? `<small class="hero-inv">Investido <b class="num">${m(investido)}</b> · Patrimônio total <b class="num">${m(F.arred(saldo + investido))}</b></small>` : ''}
      <div class="duo"><div><small>Receitas do mês</small><b class="verde num">${m(r.receitas)}</b></div><div><small>Despesas do mês</small><b class="verm num">${m(r.despesas)}</b></div></div></div>
    <div class="contas" aria-label="Suas contas">${d.contas.map((c) => `<button class="conta" type="button" data-acao="editar-conta" data-id="${c.id}"><span class="mut"><i style="background:${c.cor}"></i>${esc(c.nome)}</span><b class="num">${m(F.saldoConta(d.lancs, c))}</b></button>`).join('')}<button class="conta nova" type="button" data-acao="nova-conta">+ Conta</button></div>
    ${guia}
    ${seletorMes()}
    <div class="duas"><div class="card mini"><small>Receitas</small><b class="pos num">${m(r.receitas)}</b><div class="barra ok" role="img" aria-label="Recebido"><i style="width:${r.receitas ? Math.min(100, (r.recebido / r.receitas) * 100) : 0}%"></i></div><small>Recebido ${m(r.recebido)}</small></div>
      <div class="card mini"><small>Despesas</small><b class="neg num">${m(r.despesas)}</b><div class="barra estourou" role="img" aria-label="Pago"><i style="width:${r.despesas ? Math.min(100, (r.pago / r.despesas) * 100) : 0}%"></i></div><small>Pago ${m(r.pago)}</small></div></div>
    <div class="card" style="display:flex;justify-content:space-between;align-items:center"><span class="mut">Balanço previsto do mês</span><b class="num ${r.saldo >= 0 ? 'pos' : 'neg'}" style="font-size:20px">${m(r.saldo)}</b></div>
    <section class="card" data-bloco="pagar"><div class="sec-h"><h2 class="secao">Contas a pagar</h2><button class="link" type="button" data-acao="ir-pagar">Ver todas</button></div>
      ${pagar.length ? `<ul class="lista">${pagar.slice(0, 3).map(itemPagar).join('')}</ul>` : '<p class="mut" style="padding:8px 0">Tudo em dia. Nenhum boleto ou fatura pendente. 🎉</p>'}</section>
    ${orc.length ? `<section class="card" data-bloco="orcamento"><h2 class="secao">Atenção no orçamento</h2><ul class="lista">${orc.map(rowOrc).join('')}</ul></section>` : ''}
    <section class="card" data-bloco="categorias"><div class="sec-h"><h2 class="secao">Despesas por categoria</h2><button class="link" type="button" data-acao="ir-rel">Relatórios</button></div>
      ${cats.length ? rosca(cats, 'Despesas') : '<p class="mut" style="padding:8px 0">Sem despesas neste mês.</p>'}</section>
    ${d.cartoes.length ? `<section class="card" data-bloco="cartoes"><div class="sec-h"><h2 class="secao">Cartões</h2><button class="link" type="button" data-acao="ir-cartoes">Abrir</button></div><ul class="lista">${d.cartoes.map((c) => { const f = fats.find((x) => x.cartaoId === c.id); const u = F.limiteUsado(d.lancs, c.id); return `<li><div class="item"><span class="ic" style="${fundo(c.cor)};color:#fff">💳</span><div class="txt"><strong>${esc(c.nome)}</strong><span>${f ? `Fatura vence ${DATA_CURTA(f.vencimento)}` : 'Sem fatura aberta'} · limite livre ${m(c.limite - u)}</span></div><div class="val num">${f ? m(f.total) : m(0)}</div></div></li>`; }).join('')}</ul></section>` : ''}
    <section class="card" data-bloco="ultimos"><div class="sec-h"><h2 class="secao">Últimos lançamentos</h2><button class="link" type="button" data-acao="ir-lancs">Ver todos</button></div>
      ${ult.length ? `<ul class="lista">${ult.map(itemLanc).join('')}</ul>` : '<p class="mut" style="padding:8px 0">Nenhum lançamento neste mês.</p>'}</section>`;
  }

  function listaLancs() {
    const d = D();
    let l = d.lancs.filter((x) => F.mesDe(x.data) === V.mes);
    if (V.filtro !== 'todos') l = l.filter((x) => x.tipo === V.filtro);
    const q = V.q.trim().toLowerCase();
    if (q) l = l.filter((x) => `${x.desc} ${x.categoria} ${nomeConta(x.conta)} ${(x.tags || []).join(' ')}`.toLowerCase().includes(q));
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
    const info = catInfo(o.categoria, 'despesa'); const cls = o.pct >= 100 ? 'estourou' : o.pct >= 80 ? 'alerta' : 'ok';
    return `<li><button class="item" type="button" data-acao="editar-orc" data-id="${esc(o.categoria)}"><span class="ic" style="background:${info.cor}22">${info.icone}</span><span class="txt"><strong>${esc(o.categoria)}</strong><span class="num">${m(o.gasto)} de ${m(o.limite)}</span><div class="barra ${cls}" style="margin-top:6px"><i style="width:${Math.min(100, o.pct)}%"></i></div></span><span class="val num ${o.restante < 0 ? 'neg' : ''}">${o.pct}%<small>${o.restante >= 0 ? 'faltam ' + m(o.restante) : 'acima ' + m(-o.restante)}</small></span></button></li>`;
  }
  function telaPlanejar() {
    const d = D();
    const abas = `<div class="abas" role="group">${[['orc', 'Orçamento'], ['fluxo', 'Fluxo'], ['obj', 'Objetivos'], ['rel', 'Relatórios']].map(([v, t]) => `<button type="button" data-acao="plano" data-v="${v}" aria-pressed="${V.plano === v}">${t}</button>`).join('')}</div>`;
    let corpo = '';
    if (V.plano === 'orc') {
      const o = F.orcamentoMes(d.lancs, d.orcamentos, V.mes);
      const tl = o.reduce((s, x) => s + x.limite, 0); const tg = o.reduce((s, x) => s + x.gasto, 0);
      corpo = `${seletorMes()}${o.length ? `<div class="card"><small>Orçamento total do mês</small><b class="num" style="font-size:22px;display:block">${m(tg)} <span class="mut" style="font-weight:400">de ${m(tl)}</span></b><div class="barra ${tg > tl ? 'estourou' : 'ok'}" style="margin-top:8px"><i style="width:${tl ? Math.min(100, (tg / tl) * 100) : 0}%"></i></div><p class="mut" style="margin-top:10px">${tg > tl ? `Você passou ${m(tg - tl)} do limite total.` : `Ainda dá para gastar ${m(tl - tg)} nas categorias com limite.`}${F.resumoMes(d.lancs, V.mes).despesas - tg > 0.009 ? ` Gastos em outras categorias: ${m(F.resumoMes(d.lancs, V.mes).despesas - tg)}.` : ''}</p></div><div class="card" style="padding:4px 14px"><ul class="lista">${o.map(rowOrc).join('')}</ul></div>` : '<div class="card vazio"><span class="emoji">🎯</span><p>Defina quanto você quer gastar por categoria e acompanhe se está dentro do limite.</p></div>'}<button class="btn bloco" type="button" data-acao="novo-orc">Definir limite de categoria</button>`;
    } else if (V.plano === 'obj') {
      corpo = `${d.objetivos.length ? d.objetivos.map((o) => { const p = o.meta ? Math.min(100, (o.guardado / o.meta) * 100) : 0; return `<section class="card"><div class="sec-h"><h2 class="secao">🎯 ${esc(o.nome)}</h2><b class="num">${Math.round(p)}%</b></div><p class="mut num" style="margin:4px 0 10px">${m(o.guardado)} de ${m(o.meta)}${o.prazo ? ' · até ' + esc(NOME_MES(o.prazo)) : ''}</p><div class="barra"><i style="width:${p}%"></i></div><div class="botoes" style="margin-top:12px"><button class="btn mini" type="button" data-acao="aporte" data-id="${o.id}">Guardar dinheiro</button><button class="btn mini sec" type="button" data-acao="editar-obj" data-id="${o.id}">Editar</button></div></section>`; }).join('') : '<div class="card vazio"><span class="emoji">✈️</span><p>Crie um objetivo (viagem, reserva de emergência, caixa da empresa) e acompanhe quanto já guardou.</p></div>'}<button class="btn bloco" type="button" data-acao="novo-obj">Novo objetivo</button>`;
    } else if (V.plano === 'fluxo') {
      corpo = telaFluxo();
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
  function telaFluxo() {
    const d = D(); const f = F.fluxoMes(d.lancs, d.contas, d.cartoes, V.mes); const hoje = F.hojeISO();
    const [ano, mm] = V.mes.split('-').map(Number); const primeiro = new Date(ano, mm - 1, 1).getDay();
    const sel = V.dia && F.mesDe(V.dia) === V.mes ? V.dia : (F.mesDe(hoje) === V.mes ? hoje : `${V.mes}-01`);
    const dsel = f.dias.find((x) => x.data === sel);
    const est = (n, t, cls = '') => `<div class="card est"><b class="num ${cls}">${n}</b><small>${t}</small></div>`;
    const saldos = f.dias.map((x) => x.saldo); const mn = Math.min(0, ...saldos); const mx = Math.max(1, ...saldos); const faixa = mx - mn || 1;
    const pts = f.dias.map((x, i) => `${(i / Math.max(1, f.dias.length - 1)) * 300},${110 - ((x.saldo - mn) / faixa) * 100}`).join(' ');
    const zeroY = 110 - ((0 - mn) / faixa) * 100;
    const alerta = f.primeiroNegativo ? `<div class="alerta-fluxo" role="alert"><b>Atenção:</b> pelo que está lançado, seu saldo fica negativo no dia ${f.primeiroNegativo.dia}/${String(mm).padStart(2, '0')} (${m(f.primeiroNegativo.saldo)}). Dá tempo de se organizar.</div>` : '';
    const celulas = Array.from({ length: primeiro }, () => '<span></span>').concat(f.dias.map((x) => `<button type="button" class="dia-cal${x.data === sel ? ' sel' : ''}${x.data === hoje ? ' hoje' : ''}${x.saldo < 0 ? ' neg' : ''}" data-acao="dia" data-d="${x.data}" aria-pressed="${x.data === sel}" aria-label="Dia ${x.dia}: ${x.itens.length ? x.itens.length + (x.itens.length === 1 ? ' lançamento' : ' lançamentos') + ', saldo previsto ' + F.brl(x.saldo) : 'sem lançamentos'}"><b>${x.dia}</b><span class="pontos">${x.entradas ? '<i class="p-ent"></i>' : ''}${x.saidas ? '<i class="p-sai"></i>' : ''}</span></button>`));
    return `${seletorMes()}${alerta}
    <div class="estatisticas">${est(m(f.saldoInicial), 'Saldo no começo do mês')}${est(m(f.entradas), 'Entradas previstas', 'pos')}${est(m(f.saidas), 'Saídas previstas', 'neg')}${est(m(f.saldoFinal), 'Saldo previsto no fim', f.saldoFinal < 0 ? 'neg' : '')}</div>
    <section class="card"><h2 class="secao">Saldo previsto dia a dia</h2><svg class="linha-saldo" viewBox="0 0 300 120" role="img" aria-label="Gráfico do saldo previsto: começa em ${F.brl(f.saldoInicial)} e termina em ${F.brl(f.saldoFinal)}"><line x1="0" x2="300" y1="${zeroY}" y2="${zeroY}" stroke="#8C8B85" stroke-dasharray="4 4"/><polyline points="${pts}" fill="none" stroke="url(#gs)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><defs><linearGradient id="gs" x1="0" x2="1"><stop offset="0" stop-color="#3A7BFF"/><stop offset="1" stop-color="#C04DFF"/></linearGradient></defs></svg>
      <p class="mut">A linha tracejada é o zero. Considera tudo que está lançado, pago ou não. Fatura de cartão entra no dia do vencimento.</p></section>
    <section class="card"><h2 class="secao">Calendário</h2><div class="cal" role="group" aria-label="Calendário de ${esc(NOME_MES(V.mes))}">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((x) => `<span class="cal-s">${x}</span>`).join('')}${celulas.join('')}</div>
      <p class="mut" style="margin-top:10px"><i class="p-ent"></i> entra dinheiro &nbsp; <i class="p-sai"></i> sai dinheiro</p></section>
    <section class="card"><h2 class="secao">${dsel ? `Dia ${dsel.dia}` : 'Dia'}</h2>${dsel && dsel.itens.length ? `<ul class="lista">${dsel.itens.map((i) => `<li><div class="item"><span class="ic" style="background:${i.tipo === 'receita' ? '#D9F2EA' : '#FDE7E4'}">${i.tipo === 'receita' ? '↗' : '↘'}</span><div class="txt"><strong>${esc(i.titulo)}</strong><span>${i.pago ? 'Pago' : 'Pendente'}</span></div><div class="val num ${i.tipo === 'receita' ? 'pos' : 'neg'}">${i.tipo === 'receita' ? '+ ' : '− '}${m(i.valor)}</div></div></li>`).join('')}</ul><p class="mut" style="margin-top:8px">Saldo previsto ao fim do dia: <b class="num">${m(dsel.saldo)}</b></p>` : '<p class="mut" style="padding:8px 0">Nada lançado neste dia.</p>'}</section>`;
  }
  function receitaCat(lancs, mes) {
    const o = {}; lancs.filter((l) => l.tipo === 'receita' && !l.ignorar && F.mesDe(l.data) === mes).forEach((l) => { o[l.categoria] = F.arred((o[l.categoria] || 0) + l.valor); }); return o;
  }

  const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const LI = {
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    texto: '<path d="M3 19l5-14 5 14M5 14h6M15 19l3.5-9 3.5 9M16.5 16h4"/>',
    chave: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    baixar: '<path d="M12 4v11m-4-4l4 4 4-4M5 20h14"/>',
    subir: '<path d="M12 16V5m-4 4l4-4 4 4M5 20h14"/>',
    arquivo: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    escudo: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    sair: '<path d="M10 4H5v16h5M15 8l5 4-5 4M20 12H9"/>',
    brilho: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
    copia: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  };
  const linha = ({ tag = 'button', icone, cor = '', titulo, desc = '', attrs = '', perigo = false, fim = '›', dentro = '' }) =>
    `<${tag} class="linha${perigo ? ' perigo' : ''}" ${tag === 'button' ? 'type="button"' : ''} ${attrs}><span class="l-ic"${cor ? ` style="background:${cor}22;color:${cor}"` : ''}>${icone.startsWith('<') && icone.startsWith('<span') ? icone : svg(icone)}</span><span class="l-t"><b>${titulo}</b>${desc ? `<small>${desc}</small>` : ''}</span><span class="l-fim"${fim === '›' ? ' aria-hidden="true"' : ''}>${fim}</span>${dentro}</${tag}>`;

  const iniciais = (n) => (n || '').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
  const avatarHtml = (cls = '') => (USER.info && USER.info.foto ? `<img class="avatar-img ${cls}" src="${esc(USER.info.foto)}" alt="">` : `<span class="avatar-ini ${cls}" aria-hidden="true">${esc(iniciais(USER.info && USER.info.nome))}</span>`);
  const grupoHtml = (t, corpo) => `<section><h2 class="grupo">${t}</h2><div class="card linhas">${corpo}</div></section>`;

  function telaMais() {
    const d = D(); const u = USER.info; const grupo = grupoHtml;
    return `<div class="tit"><h1>Mais opções</h1></div>
    <section><div class="card linhas">${linha({ icone: `<span class="mini-av">${avatarHtml('peq')}</span>`, titulo: esc(u.nome), desc: 'Meu perfil, foto e dados da conta', attrs: 'data-acao="perfil"' })}</div></section>
    <section><div class="sec-h"><h2 class="grupo">Contas e carteiras</h2><button class="link" type="button" data-acao="nova-conta">+ Adicionar</button></div><div class="card linhas">${d.contas.map((c) => linha({ icone: `<span class="bolinha" style="background:${c.cor}"></span>`, cor: c.cor, titulo: esc(c.nome), desc: c.fora ? 'Fora do saldo geral' : 'Soma no saldo geral', fim: `<span class="num">${m(F.saldoConta(d.lancs, c))}</span>`, attrs: `data-acao="editar-conta" data-id="${c.id}"` })).join('')}</div></section>
    ${grupo('Seus dados',
      linha({ tag: 'label', icone: LI.subir, titulo: 'Importar extrato ou fatura', desc: 'Arquivo OFX ou CSV do seu banco', dentro: '<input id="arq" type="file" accept=".ofx,.csv,.txt" hidden>' })
      + linha({ icone: LI.copia, titulo: 'Cópia de segurança', desc: 'Baixar um arquivo com seus lançamentos', attrs: 'data-acao="backup"' })
      + linha({ tag: 'label', icone: LI.arquivo, titulo: 'Restaurar uma cópia', desc: 'Voltar os dados de um arquivo', dentro: '<input id="rest" type="file" accept=".json" hidden>' })
      + linha({ icone: LI.texto, titulo: 'Personalizar tela inicial', desc: 'Escolha o que aparece no Início', attrs: 'data-acao="personalizar"' })
      + linha({ icone: LI.mais, titulo: 'Categorias personalizadas', desc: 'Crie as suas, com ícone e cor', attrs: 'data-acao="categorias"' })
      + linha({ icone: LI.brilho, titulo: 'Carregar dados de exemplo', desc: 'Para conhecer o app preenchido', attrs: 'data-acao="exemplo"' }))}
    ${grupo('Sobre',
      linha({ icone: LI.texto, titulo: 'Tamanho do texto e contraste', desc: 'Facilita a leitura', attrs: 'data-acao="acess"' })
      + linha({ tag: 'a', icone: LI.escudo, titulo: 'Política de Privacidade', attrs: 'href="privacidade.html" target="_blank" rel="noopener"' })
      + linha({ tag: 'a', icone: LI.arquivo, titulo: 'Termos de Uso', attrs: 'href="termos.html" target="_blank" rel="noopener"' }))}
    ${grupo('Zona de risco', linha({ icone: LI.lixo, titulo: `Apagar dados ${S.perfil === 'pessoal' ? 'pessoais' : 'da empresa'}`, desc: 'Remove os lançamentos deste perfil', perigo: true, attrs: 'data-acao="apagar"' }))}
    <button class="btn sec bloco" type="button" data-acao="sair">${svg(LI.sair)}&nbsp; Sair da conta</button>
    <p class="mut centro">Lepvi Finanças · um produto Lepvi Group</p>`;
  }

  function telaPerfil() {
    const u = USER.info; const grupo = grupoHtml;
    const desde = u.criado_em ? new Date(u.criado_em * 1000).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
    const soma = (k) => ['pessoal', 'empresa'].reduce((t, x) => t + S.dados[x][k].length, 0);
    const est = (n, t) => `<div class="card est"><b class="num">${n}</b><small>${t}</small></div>`;
    return `<div class="tit"><h1>Meu perfil</h1></div>
    <section class="perfil-topo"><div class="foto-grande">${avatarHtml('grande')}<button class="foto-edit" type="button" data-acao="trocar-foto" aria-label="Alterar foto do perfil">${svg(LI.camera)}</button><input id="foto-arq" type="file" accept="image/*" hidden></div>
      <div class="perfil-nome"><h2>${esc(u.nome)}</h2><p>${esc(u.email)}</p><span class="selo ok">E-mail confirmado</span>${u.foto ? '<br><button class="link" type="button" data-acao="remover-foto">Remover foto</button>' : ''}</div></section>
    <div class="estatisticas">${est(soma('lancs'), 'Lançamentos')}${est(soma('cartoes'), 'Cartões')}${est(soma('contas'), 'Contas')}${est(desde ? esc(desde) : '—', 'Membro desde')}</div>
    <section class="card"><h2 class="secao">Dados pessoais</h2><form id="perfil-f" class="auth-f" style="margin-top:16px">${campo('Nome completo', `<input name="nome" required maxlength="120" autocomplete="name" value="${esc(u.nome)}">`)}
      ${campo('E-mail', `<input value="${esc(u.email)}" disabled aria-describedby="email-dica"><small id="email-dica" class="mut">Para trocar o e-mail, escreva para lepvi@lepvi.com.br.</small>`)}<button class="btn" type="submit">Salvar alterações</button></form></section>
    ${grupo('Preferências',
      linha({ tag: 'label', icone: LI.bell, titulo: 'Avisos de vencimento por e-mail', desc: 'Vence em breve, vence hoje e já venceu', fim: '', dentro: `<input id="avisos-sw" type="checkbox" role="switch" ${u.avisos ? 'checked' : ''}>` })
      + linha({ icone: LI.texto, titulo: 'Tamanho do texto e contraste', desc: 'Facilita a leitura', attrs: 'data-acao="acess"' }))}
    ${grupo('Segurança e privacidade',
      linha({ icone: LI.chave, titulo: 'Alterar senha', attrs: 'data-acao="senha"' })
      + linha({ tag: 'a', icone: LI.baixar, titulo: 'Baixar meus dados', desc: 'Arquivo completo da sua conta (LGPD)', attrs: 'href="api/?a=exportar" download' })
      + linha({ tag: 'a', icone: LI.escudo, titulo: 'Política de Privacidade', attrs: 'href="privacidade.html" target="_blank" rel="noopener"' }))}
    ${grupo('Zona de risco', linha({ icone: LI.lixo, titulo: 'Excluir minha conta', desc: 'Apaga a conta e todos os dados, para sempre', perigo: true, attrs: 'data-acao="excluir-conta"' }))}
    <button class="btn sec bloco" type="button" data-acao="sair">${svg(LI.sair)}&nbsp; Sair da conta</button>`;
  }

  /* menu da conta (avatar no topo) */
  function menuConta() {
    const u = USER.info;
    abrir('Minha conta', `<div class="conta-card" style="margin:0">${avatarHtml('grande')}<div class="conta-info"><h2>${esc(u.nome)}</h2><p>${esc(u.email)}</p></div></div>
      <div class="card linhas">${linha({ icone: LI.user, titulo: 'Meu perfil', desc: 'Foto, nome e dados da conta', attrs: 'data-sheet="perfil"' })}${linha({ icone: LI.texto, titulo: 'Tamanho do texto e contraste', attrs: 'data-sheet="acess"' })}${linha({ icone: LI.mais, titulo: 'Mais opções', desc: 'Contas, importar, cópia de segurança', attrs: 'data-sheet="mais"' })}</div>
      <button class="btn bloco" type="button" data-sheet="sair">${svg(LI.sair)}&nbsp; Sair da conta</button>`, null, (f) => {
      f.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => { const a = b.dataset.sheet; dlg.close(); if (a === 'perfil' || a === 'mais') ir(a); else if (a === 'acess') formAcess(); else sair(); }));
    });
  }
  async function sair() { try { await api('sair', {}); } catch (e) { /* já saiu */ } USER.logado = false; limparMemoria(); V.auth = 'entrar'; V.msg = 'Você saiu. Até logo!'; render(); window.scrollTo(0, 0); }
  async function processarFoto(arq) {
    if (!arq || !/^image\//.test(arq.type)) { aviso('Escolha um arquivo de imagem (JPG, PNG ou WebP).'); return; }
    try {
      const bmp = await createImageBitmap(arq, { imageOrientation: 'from-image' });
      const lado = Math.min(bmp.width, bmp.height); const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      c.getContext('2d').drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, 256, 256);
      const r = await api('preferencias', { foto: c.toDataURL('image/jpeg', 0.85) }); USER.info = r.usuario; render(); aviso('Foto atualizada.');
    } catch (e) { aviso(e.message && !/bitmap|decode|source/i.test(e.message) ? e.message : 'Não consegui usar essa foto. Tente um JPG ou PNG.'); }
  }

  const VISTAS = { inicio: telaInicio, lancs: telaLancs, cartoes: telaCartoes, planejar: telaPlanejar, mais: telaMais, perfil: telaPerfil };
  function render() {
    document.body.classList.toggle('deslogado', !USER.logado);
    if (!USER.logado) { $('#menu').innerHTML = ''; $('#tela').innerHTML = telaAuth(); return; }
    document.querySelectorAll('[data-perfil]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.perfil === S.perfil)));
    const olho = $('[data-acao=olho]'); olho.innerHTML = svg(S.oculto ? EYE_OFF : EYE); olho.setAttribute('aria-pressed', String(!!S.oculto)); olho.setAttribute('aria-label', S.oculto ? 'Mostrar valores' : 'Ocultar valores');
    const nav = (id, t) => `<button type="button" data-tela="${id}" ${V.tela === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[id]}</svg>${t}</button>`;
    const ab = $('[data-acao=conta-menu]'); ab.innerHTML = avatarHtml(); ab.setAttribute('aria-label', 'Minha conta: ' + USER.info.nome);
    $('#menu').innerHTML = nav('inicio', 'Início') + nav('lancs', 'Lançamentos') + '<button class="mais-novo" type="button" data-acao="menu-novo" aria-label="Novo lançamento">+</button>' + nav('cartoes', 'Cartões') + nav('planejar', 'Planejar')
      + `<div class="menu-fim"><button type="button" class="mf-mais" data-acao="mais">Mais opções</button><div class="menu-user"><button type="button" class="mu-perfil" data-acao="perfil">${avatarHtml('peq')}<span><b>${esc(USER.info.nome)}</b><small>Meu perfil</small></span></button><button type="button" class="mu-sair" data-acao="sair">Sair</button></div></div>`;
    $('#tela').innerHTML = VISTAS[V.tela]();
    if (V.tela === 'inicio' && S.inicio) document.querySelectorAll('#tela [data-bloco]').forEach((el) => { if (S.inicio[el.dataset.bloco] === false) el.remove(); });
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
  const campoSenha = (rot, attrs) => `<label class="campo"><span>${rot}</span><span class="senha-wrap"><input ${attrs}><button type="button" class="olho-senha" data-olho aria-label="Mostrar a senha" aria-pressed="false">${svg(EYE)}</button></span></label>`;
  const troca = (nome, rot, on) => `<label class="troca"><span>${rot}</span><input type="checkbox" role="switch" name="${nome}" ${on ? 'checked' : ''}></label>`;
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
    const catsHtml = tipo === 'transf' ? '' : campo('Categoria', radios('categoria', catsDe(tipo).filter((c) => c.nome !== 'Cartão' || base.categoria === 'Cartão').map((c) => [c.nome, c.nome, c.icone]), base.categoria || F.CATEGORIAS[tipo][0].nome, 'cats').replace(/<\/div>$/, '<button type="button" class="nova-cat" data-nova-cat><em>＋</em>Nova categoria</button></div>'));
    const contaHtml = tipo === 'transf'
      ? `<div class="dupla">${campo('Sai de', sele('conta', contas, base.conta))}${campo('Entra em', sele('destino', contas, base.destino || (contas[1] || contas[0])[0]))}</div>`
      : campo(tipo === 'receita' ? 'Receber em' : 'Pagar com', radios('conta', opcContas, contaSel));
    const rotPago = tipo === 'receita' ? 'Já recebi' : tipo === 'transf' ? 'Já foi feita' : 'Já paguei';
    const abas = novo ? `<div class="abas3" role="group" aria-label="Tipo de lançamento">${[['despesa', 'Despesa'], ['receita', 'Receita'], ['transf', 'Transferência']].map(([k, t]) => `<button type="button" data-aba="${k}" aria-pressed="${tipo === k}" class="${k}">${t}</button>`).join('')}</div>` : '';
    const extras = tipo === 'transf' ? '' : `<details class="mais-campos"${base.tags && base.tags.length || base.nota || base.ignorar ? ' open' : ''}><summary>Mais opções</summary><div class="mais-corpo">
        ${novo ? `<div class="dupla">${campo('Repetir', sele('rep', [['nao', 'Não repete'], ['parcelado', 'Parcelado'], ['fixo', 'Fixo todo mês']], 'nao'))}<div id="repn" hidden>${campo('Quantas vezes', '<input name="n" type="number" min="2" max="60" value="2">')}</div></div>` : ''}
        ${tipo === 'despesa' ? troca('boleto', 'É um boleto', !!base.boleto) : ''}
        ${campo('Etiquetas', `<input name="tags" maxlength="80" placeholder="Ex.: viagem, casal, projeto" value="${esc((base.tags || []).join(', '))}">`)}${troca('ignorar', 'Não contar nos relatórios', !!base.ignorar)}
        ${campo('Nota', `<textarea name="nota" maxlength="300">${esc(base.nota || '')}</textarea>`)}</div></details>`;
    abrir((novo ? 'Novo lançamento' : 'Editar ' + titulo.toLowerCase()), `
      ${abas}
      <div class="valor-box ${tipo}"><label for="v">Valor</label><div class="valor-lin"><span aria-hidden="true">R$</span><input id="v" name="valor" inputmode="decimal" required autocomplete="off" placeholder="0,00" value="${val2(base.valor)}"></div></div>
      ${tipo === 'transf' ? '' : campo('Descrição', `<input name="desc" required maxlength="80" value="${esc(base.desc || '')}" placeholder="Ex.: Mercado, Aluguel, Venda de peças">`)}
      <div class="campo"><span>Data</span><div class="data-lin"><button class="btn sec mini" type="button" data-data="${F.hojeISO()}">Hoje</button><button class="btn sec mini" type="button" data-data="${ontem()}">Ontem</button><input name="data" type="date" required value="${base.data || F.hojeISO()}"></div></div>
      ${F.ehCartao({ conta: contaSel }) && tipo === 'despesa' ? '' : troca('pago', rotPago, novo ? true : !!base.pago)}
      ${catsHtml}${contaHtml}
      ${extras}
      <div class="botoes rodape-form">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar lançamento</button></div>`,
    (fd) => {
      const valor = F.arred(F.numeroBR(fd.get('valor')));
      if (!(valor > 0)) { aviso('Informe um valor maior que zero.'); $('#v').focus(); return false; }
      const conta = fd.get('conta'); const cartao = F.ehCartao({ conta });
      if (tipo === 'transf' && conta === fd.get('destino')) { aviso('Escolha contas diferentes.'); return false; }
      const reg = tipo === 'transf'
        ? { tipo, desc: 'Transferência', data: fd.get('data'), categoria: 'Transferência', conta, destino: fd.get('destino'), pago: !!fd.get('pago'), boleto: false }
        : { tipo, desc: fd.get('desc').trim(), data: fd.get('data'), categoria: fd.get('categoria'), conta, boleto: !!fd.get('boleto') && !cartao, pago: !cartao && !!fd.get('pago'), nota: (fd.get('nota') || '').trim(), tags: [...new Set(String(fd.get('tags') || '').split(',').map((x) => x.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 5), ignorar: !!fd.get('ignorar') };
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
      const lerForm = () => ({ valor: f.valor.value, desc: f.desc ? f.desc.value : '', data: f.data.value, conta: base.conta && base.conta.startsWith('c:') ? base.conta : undefined });
      f.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.aba !== tipo) formLanc(lerForm(), b.dataset.aba); }));
      const nc = $('[data-nova-cat]', f); if (nc) nc.addEventListener('click', () => formCategoria(tipo, (nome) => formLanc({ ...lerForm(), categoria: nome }, modo)));
      const exc = $('#exc', f); if (exc) exc.onclick = () => { d.lancs = d.lancs.filter((x) => x.id !== base.id); salvar(); dlg.close(); render(); aviso('Lançamento excluído.'); };
      f.querySelectorAll('[data-data]').forEach((b) => b.addEventListener('click', () => { f.data.value = b.dataset.data; }));
      if (f.rep) f.rep.addEventListener('change', () => { $('#repn', f).hidden = f.rep.value === 'nao'; });
      if (f.boleto && f.pago) f.boleto.addEventListener('change', () => { if (f.boleto.checked) f.pago.checked = false; });
      setTimeout(() => { if (novo) f.valor.focus(); }, 60);
    });
  }

  const EMOJIS = ['🍔', '☕', '🐶', '🧴', '🎁', '🏋️', '✈️', '🚌', '⛽', '📱', '💡', '🧾', '👶', '🏥', '🎮', '📚', '🛠️', '🌱', '🎵', '🧹', '💼', '🏠', '🚗', '💰'];
  function formCategoria(tipo, depois) {
    const d = D(); d.cats = d.cats || { despesa: [], receita: [] };
    abrir(`Nova categoria de ${tipo === 'receita' ? 'receita' : 'despesa'}`, `${campo('Nome', '<input name="nome" required maxlength="24" placeholder="Ex.: Pet, Academia, Presentes">')}
      ${campo('Ícone', radios('icone', EMOJIS.map((e) => [e, '', e]), EMOJIS[0], 'emojis'))}
      ${campo('Cor', radios('cor', CORES.map((x) => [x, '']), CORES[0], 'cores'))}
      <div class="botoes rodape-form"><button class="btn sec" type="button" id="cat-voltar">Voltar</button><button class="btn" type="submit">Salvar categoria</button></div>`,
    (fd) => {
      const nome = fd.get('nome').trim();
      if (!nome) { aviso('Dê um nome para a categoria.'); return false; }
      if (catsDe(tipo).some((c) => c.nome.toLowerCase() === nome.toLowerCase())) { aviso('Você já tem uma categoria com esse nome.'); return false; }
      d.cats[tipo].push({ nome, icone: fd.get('icone'), cor: fd.get('cor') });
      salvar(); aviso('Categoria criada.');
      if (depois) { depois(nome); return false; }
      render();
    }, (f) => {
      f.querySelectorAll('.cores span').forEach((x) => { x.style.background = x.previousElementSibling.value; });
      $('#cat-voltar', f).onclick = () => { if (depois) depois(null); else dlg.close(); };
    });
  }
  function formCategorias() {
    const d = D(); d.cats = d.cats || { despesa: [], receita: [] };
    const lista = (tipo, t) => `<h3 class="grupo" style="margin-top:6px">${t}</h3>${d.cats[tipo].length ? `<div class="card linhas">${d.cats[tipo].map((c, i) => `<div class="linha"><span class="l-ic" style="background:${c.cor}22">${esc(c.icone)}</span><span class="l-t"><b>${esc(c.nome)}</b></span><button class="link" type="button" data-del-cat="${tipo}|${i}">Excluir</button></div>`).join('')}</div>` : '<p class="mut">Nenhuma criada ainda.</p>'}<button class="btn sec" type="button" data-add-cat="${tipo}">+ Nova categoria de ${t.toLowerCase()}</button>`;
    abrir('Categorias personalizadas', `<p class="mut">As categorias padrão ficam sempre disponíveis. Excluir uma sua não apaga os lançamentos que já usam o nome dela.</p>${lista('despesa', 'Despesas')}${lista('receita', 'Receitas')}`, null, (f) => {
      f.querySelectorAll('[data-del-cat]').forEach((b) => b.addEventListener('click', () => { const [t, i] = b.dataset.delCat.split('|'); d.cats[t].splice(+i, 1); salvar(); formCategorias(); }));
      f.querySelectorAll('[data-add-cat]').forEach((b) => b.addEventListener('click', () => formCategoria(b.dataset.addCat, () => formCategorias())));
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
      ${campo('Tipo de conta', radios('tipoConta', [['corrente', 'Conta corrente', '🏦'], ['poupanca', 'Poupança', '🐷'], ['carteira', 'Carteira', '👛'], ['vale', 'Vale-refeição', '🍽️'], ['investimento', 'Investimentos', '📈']], c.tipo || 'corrente'))}
      ${novo ? campo('Saldo inicial (R$)', '<input name="saldo" inputmode="decimal" value="0">') : campo('Saldo atual (R$)', `<input name="saldo" inputmode="decimal" value="${val2(F.saldoConta(D().lancs, c))}"><small class="mut">Se não bater com o do banco, corrija aqui. Criamos um ajuste que não entra nos relatórios.</small>`)}
      ${campo('Cor', radios('cor', CORES.map((x) => [x, '']), c.cor || CORES[D().contas.length % CORES.length], 'cores'))}
      ${troca('soma', 'Somar no saldo geral', !c.fora)}
      <div class="botoes">${novo || D().contas.length < 2 ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), cor: fd.get('cor'), fora: !fd.get('soma'), tipo: fd.get('tipoConta') || 'corrente' };
      const valorSaldo = F.arred(F.numeroBR(fd.get('saldo') || '0'));
      if (novo) D().contas.push({ id: uid(), saldoInicial: valorSaldo, ...reg });
      else {
        const alvo = D().contas.find((x) => x.id === c.id); const diff = F.arred(valorSaldo - F.saldoConta(D().lancs, alvo));
        Object.assign(alvo, reg);
        if (diff !== 0) D().lancs.push({ id: uid(), tipo: diff > 0 ? 'receita' : 'despesa', desc: 'Ajuste de saldo', valor: Math.abs(diff), data: F.hojeISO(), categoria: 'Ajuste de saldo', conta: alvo.id, pago: true, ignorar: true, boleto: false });
      }
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
    const d = D(); const lista = catsDe('despesa').filter((c) => c.nome !== 'Cartão');
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

  function formPersonalizar() {
    const blocos = [['pagar', 'Contas a pagar'], ['orcamento', 'Atenção no orçamento'], ['categorias', 'Despesas por categoria'], ['cartoes', 'Cartões'], ['ultimos', 'Últimos lançamentos']];
    S.inicio = S.inicio || {};
    abrir('Personalizar tela inicial', `<p class="mut">Escolha o que você quer ver no Início. O saldo e o resumo do mês sempre aparecem.</p>${blocos.map(([k, t]) => troca('b-' + k, t, S.inicio[k] !== false)).join('')}`, null, (f) => {
      f.addEventListener('change', () => { blocos.forEach(([k]) => { S.inicio[k] = f['b-' + k].checked; }); salvar(); render(); });
    });
  }
  function formSenha() {
    abrir('Alterar senha', `${campoSenha('Senha atual', 'name="atual" type="password" required autocomplete="current-password"')}${campoSenha('Nova senha (mínimo 10 caracteres)', 'name="nova" type="password" required minlength="10" autocomplete="new-password"')}<div class="botoes"><button class="btn" type="submit">Salvar nova senha</button></div>`, null, (f) => {
      f.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('mudar_senha', { atual: f.atual.value, nova: f.nova.value }); dlg.close(); aviso('Senha alterada. Enviamos um e-mail de confirmação.'); } catch (e) { aviso(e.message); } });
    });
  }
  function formExcluirConta() {
    abrir('Excluir minha conta', `<p>Isso apaga a sua conta e <b>todos</b> os seus dados financeiros do servidor, de forma definitiva. Não dá para desfazer. Antes, se quiser, baixe uma cópia em "Baixar meus dados".</p>${campoSenha('Digite sua senha para confirmar', 'name="senha" type="password" required autocomplete="current-password"')}<div class="botoes"><button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn perigo" type="submit">Excluir para sempre</button></div>`, null, (f) => {
      f.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('excluir', { senha: f.senha.value }); dlg.close(); USER.logado = false; limparMemoria(); V.auth = 'entrar'; V.msg = 'Sua conta e todos os seus dados foram apagados.'; render(); } catch (e) { aviso(e.message); } });
    });
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
    const ol = ev.target.closest('[data-olho]');
    if (ol) { const i = ol.parentElement.querySelector('input'); const ver = i.type === 'password'; i.type = ver ? 'text' : 'password'; ol.setAttribute('aria-pressed', String(ver)); ol.setAttribute('aria-label', ver ? 'Ocultar a senha' : 'Mostrar a senha'); ol.innerHTML = svg(ver ? EYE_OFF : EYE); return; }
    const t = ev.target.closest('[data-acao],[data-tela],[data-perfil]'); if (!t) return;
    if (t.dataset.tela) { ir(t.dataset.tela); return; }
    if (t.dataset.perfil) { S.perfil = t.dataset.perfil; V.cartao = null; V.fmes = null; salvar(); render(); return; }
    const d = D(); const id = t.dataset.id; const a = t.dataset.acao;
    const acoes = {
      acess: () => formAcess(),
      sair: () => sair(),
      'conta-menu': () => menuConta(),
      perfil: () => ir('perfil'),
      'trocar-foto': () => $('#foto-arq').click(),
      'remover-foto': async () => { try { const r = await api('preferencias', { foto: null }); USER.info = r.usuario; render(); aviso('Foto removida.'); } catch (e) { aviso(e.message); } },
      senha: () => formSenha(),
      personalizar: () => formPersonalizar(),
      categorias: () => formCategorias(),
      oauth: () => { window.location.href = 'api/oauth.php?a=iniciar&p=' + encodeURIComponent(t.dataset.p); },
      'excluir-conta': () => formExcluirConta(),
      'auth-entrar': () => { V.auth = 'entrar'; V.msg = ''; render(); },
      'auth-esqueci': () => { V.auth = 'esqueci'; V.msg = ''; render(); },
      'auth-cadastro': () => { V.auth = 'cadastro'; V.msg = ''; render(); },
      olho: () => { S.oculto = !S.oculto; salvar(); render(); },
      mais: () => ir('mais'),
      mes: () => { V.mes = F.somaMes(V.mes, +t.dataset.d); render(); },
      fmes: () => { V.fmes = F.somaMes(V.fmes, +t.dataset.d); render(); },
      dia: () => { V.dia = t.dataset.d; render(); },
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
    const alvo = ev.target;
    if (alvo.id === 'foto-arq') { processarFoto(alvo.files && alvo.files[0]); alvo.value = ''; return; }
    if (alvo.id === 'avisos-sw') { api('preferencias', { avisos: alvo.checked }).then((r) => { USER.info = r.usuario; aviso(r.usuario.avisos ? 'Avisos por e-mail ligados.' : 'Avisos por e-mail desligados.'); }).catch((e) => { alvo.checked = !alvo.checked; aviso(e.message); }); return; }
    if (alvo.matches && alvo.matches('[data-mostrar]')) { alvo.closest('form').querySelectorAll('input[name=senha],input[name=nova],input[name=atual]').forEach((i) => { i.type = alvo.checked ? 'text' : 'password'; }); return; }
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
  iniciar();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
