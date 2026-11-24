/* Lepvi Finanças: telas e ações. As regras de cálculo ficam em lib.js (window.Fin). */
(function () {
  const F = window.Fin;
  const CHAVE = 'lepvi-financas-v1';
  const CORES = ['#2D4BFF', '#8A3DFF', '#C04DFF', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#0D0D0F'];
  const vazio = () => ({ cats: { despesa: [], receita: [] }, contas: [{ id: 'carteira', nome: 'Carteira', saldoInicial: 0, cor: '#10B981' }], cartoes: [], lancs: [], orcamentos: {}, objetivos: [] });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);

  /* Antes havia dois espaços (Pessoal e Empresa). Agora é um só: o que já existia em "Empresa" passa para o principal. */
  function mesclarEmpresa(s) {
    const e = s.dados.empresa; const p = s.dados.pessoal; if (!e || !p) return;
    const usaCarteira = e.lancs.some((l) => l.conta === 'carteira' || l.destino === 'carteira');
    const temAlgo = e.lancs.length || e.cartoes.length || (e.objetivos || []).length || Object.keys(e.orcamentos || {}).length || e.contas.some((c) => c.id !== 'carteira' || c.saldoInicial !== 0);
    if (!temAlgo) return;
    e.contas.forEach((c) => {
      if (c.id === 'carteira' && c.saldoInicial === 0 && !usaCarteira) return;
      if (p.contas.some((x) => x.id === c.id)) { const novo = uid(); e.lancs.forEach((l) => { if (l.conta === c.id) l.conta = novo; if (l.destino === c.id) l.destino = novo; }); c.id = novo; c.nome = c.nome + ' (empresa)'; }
      p.contas.push(c);
    });
    p.cartoes.push(...e.cartoes); p.lancs.push(...e.lancs); p.objetivos.push(...(e.objetivos || []));
    Object.entries(e.orcamentos || {}).forEach(([k, v]) => { p.orcamentos[k] = F.arred((p.orcamentos[k] || 0) + v); });
    ['despesa', 'receita'].forEach((t) => { ((e.cats && e.cats[t]) || []).forEach((c) => { if (!p.cats[t].some((x) => x.nome === c.nome)) p.cats[t].push(c); }); });
    s.dados.empresa = vazio();
  }
  function norm(s) {
    s.dados = s.dados || {};
    ['pessoal', 'empresa'].forEach((p) => {
      const d = (s.dados[p] = Object.assign(vazio(), s.dados[p] || {}));
      d.contas.forEach((c, i) => { c.cor = c.cor || CORES[i % CORES.length]; });
      d.cartoes.forEach((c, i) => { c.cor = c.cor || CORES[(i + 1) % CORES.length]; });
    });
    mesclarEmpresa(s);
    s.perfil = 'pessoal';
    return s;
  }
  const PREFS = 'lepvi-financas-prefs';
  const CONVITE = 'lepvi-financas-convite';
  const S = norm({ perfil: 'pessoal', dados: {} }); // dados financeiros: só em memória e no servidor (nunca no aparelho)
  const USER = { logado: false, info: null };
  try { const p = JSON.parse(localStorage.getItem(PREFS)); if (p) { S.texto = p.texto; S.escala = p.escala; S.tema = p.tema; S.semMovimento = p.semMovimento; S.destacar = p.destacar; S.contraste = p.contraste; S.oculto = p.oculto; S.ordem = p.ordem; S.saldoDiario = p.saldoDiario; S.sugestoes = p.sugestoes; S.dispensados = Array.isArray(p.dispensados) ? p.dispensados : []; } } catch (e) { /* sem preferências guardadas */ }
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
  /* Topo só mostra problema (não salvou, conflito). Confirmação de salvo vira aviso rápido embaixo, 2s */
  function status(estado) {
    const el = document.getElementById('status-salvo'); if (!el) return;
    clearTimeout(status.t);
    const t = { erro: 'Não salvou', conflito: 'Atualizado de outro aparelho' }[estado] || '';
    el.dataset.estado = estado; el.querySelector('b').textContent = t; el.hidden = !t; el.title = t;
  }
  let versaoServidor = 0; let enviando = false; let precisaEnviar = false; let tmr = null;
  function limparMemoria() { status(''); const n = norm({ perfil: 'pessoal', dados: {} }); S.dados = n.dados; S.perfil = 'pessoal'; S.guia = false; versaoServidor = 0; V.cartao = null; V.fmes = null; V.tela = 'inicio'; V.esp = null; baseDados = null; }
  async function sessaoExpirou() { aba.limpar(); USER.logado = false; limparMemoria(); V.auth = 'entrar'; V.msg = 'Sua sessão terminou. Entre de novo.'; await carregarTurnstile(); render(); }
  function salvar() {
    try { localStorage.setItem(PREFS, JSON.stringify({ texto: S.texto, escala: S.escala, tema: S.tema, semMovimento: S.semMovimento, destacar: S.destacar, contraste: S.contraste, oculto: S.oculto, ordem: S.ordem, saldoDiario: S.saldoDiario, sugestoes: S.sugestoes, dispensados: (S.dispensados || []).slice(-200) })); } catch (e) { /* sem armazenamento */ }
    if (!USER.logado) return;
    precisaEnviar = true; status('salvando'); clearTimeout(tmr); tmr = setTimeout(enviarDados, 600);
  }
  const clonar = (x) => JSON.parse(JSON.stringify(x));
  let baseDados = null; // o último estado que o servidor confirmou (base para juntar edições)
  async function enviarDados() {
    if (enviando || !USER.logado) return;
    enviando = true;
    while (precisaEnviar && USER.logado) {
      precisaEnviar = false;
      const enviado = clonar(S.dados);
      try { versaoServidor = (await api('dados', { versao: versaoServidor, conteudo: { perfil: S.perfil, guia: !!S.guia, inicio: S.inicio || {}, dados: S.dados } })).versao; baseDados = enviado; if (!precisaEnviar) { status('ok'); if (!document.getElementById('aviso').classList.contains('on')) aviso('Salvo ✓', 2000); } }
      catch (e) {
        if (e.conflito && baseDados) { // duas pessoas (ou duas janelas) salvaram ao mesmo tempo: junta as duas alterações
          try { const antes = clonar(S.dados); const r = await api('dados'); if (r.conteudo && r.conteudo.dados) { versaoServidor = r.versao; S.dados = norm({ perfil: S.perfil, dados: F.juntarDados(baseDados, antes, r.conteudo.dados) }).dados; baseDados = clonar(r.conteudo.dados); precisaEnviar = true; if (!dlg.open) render(); aviso('Outra pessoa também mexeu ao mesmo tempo. Juntamos as duas alterações.'); continue; } } catch (e2) { /* cai na recarga abaixo */ }
        }
        if (e.conflito) { await carregarDados(); render(); status('conflito'); aviso('Seus dados foram alterados em outra janela ou aparelho. Mostramos a versão mais recente: confira se o seu último lançamento está aí.'); break; }
        if (e.rede) { precisaEnviar = true; status('erro'); aviso('Sem conexão. Vamos tentar salvar de novo.'); await new Promise((ok) => setTimeout(ok, 5000)); continue; }
        status('erro'); aviso('Não consegui salvar: ' + e.message); break;
      }
    }
    enviando = false;
  }
  window.addEventListener('online', () => { if (precisaEnviar) enviarDados(); });
  window.addEventListener('beforeunload', (ev) => { if (USER.logado && (precisaEnviar || enviando)) { ev.preventDefault(); ev.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && precisaEnviar && USER.logado) { clearTimeout(tmr); enviarDados(); } });
  async function carregarDados() {
    const r = await api('dados');
    versaoServidor = r.versao;
    if (r.conteudo && r.conteudo.dados) { const n = norm({ perfil: r.conteudo.perfil, dados: r.conteudo.dados }); S.perfil = n.perfil; S.dados = n.dados; baseDados = clonar(n.dados); S.guia = !!r.conteudo.guia; S.inicio = r.conteudo.inicio || S.inicio || {}; status('ok'); return; }
    limparMemoria(); baseDados = clonar(S.dados);
    try { // dados da versão antiga do app, que ficavam só neste aparelho: sobem para a conta
      const antigo = JSON.parse(localStorage.getItem(CHAVE));
      if (antigo && antigo.dados) { const n = norm(antigo); S.perfil = n.perfil; S.dados = n.dados; S.guia = !!antigo.guia; localStorage.removeItem(CHAVE); salvar(); aviso('Trouxemos para a sua conta os dados que estavam neste aparelho.'); }
    } catch (e) { /* nada para importar */ }
  }

  /* ---------- entrar, criar conta, esqueci a senha ---------- */
  /* Regra: abrir o app (aba nova, endereço digitado, app instalado) sempre pede login. Só esta aba, depois de entrar, continua logada ao recarregar. */
  const ABA = 'lf-aba'; const IDA_OAUTH = 'lf-oauth';
  const aba = {
    marcar() { try { sessionStorage.setItem(ABA, '1'); } catch (e) { /* sem armazenamento */ } },
    tem() { try { return sessionStorage.getItem(ABA) === '1'; } catch (e) { return false; } },
    limpar() { try { sessionStorage.removeItem(ABA); } catch (e) { /* sem armazenamento */ } },
  };
  function voltouDoOauth() { try { const v = sessionStorage.getItem(IDA_OAUTH); sessionStorage.removeItem(IDA_OAUTH); return v === '1'; } catch (e) { return false; } }
  let tsId = null;
  async function carregarTurnstile() {
    try { const cf = await api('config'); V.ts = cf.turnstile || null; V.cadastro = cf.cadastro !== false; } catch (e) { V.ts = null; }
    if (V.ts && !window.turnstile && !document.getElementById('ts-script')) {
      const sc = document.createElement('script'); sc.id = 'ts-script'; sc.async = true; sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.onload = montarTurnstile; document.head.appendChild(sc);
    }
  }
  function montarTurnstile() {
    const box = document.getElementById('ts-box'); if (!box || !V.ts || !window.turnstile) return;
    box.innerHTML = ''; V.tsTok = '';
    tsId = window.turnstile.render(box, { sitekey: V.ts, language: 'pt-br', theme: document.documentElement.dataset.esquema === 'escuro' ? 'dark' : 'light', callback: (t) => { V.tsTok = t; }, 'expired-callback': () => { V.tsTok = ''; }, 'error-callback': () => { V.tsTok = ''; } });
  }
  function telaAuth() {
    const modo = V.auth; const msg = V.msg ? `<p class="${V.msgErro ? 'erro' : 'ok-msg'}" role="${V.msgErro ? 'alert' : 'status'}">${esc(V.msg)}</p>` : '';
    const erro = `${V.ts ? '<div id="ts-box" class="ts-box"></div>' : ''}<p class="erro" role="alert" id="auth-erro" tabindex="-1" hidden></p>`;
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
    } else if (modo === 'dois-passos') {
      titulo = 'Código de verificação';
      corpo = `<form id="auth" class="auth-f" novalidate><p class="mut">Abra o app autenticador no celular e digite o código de 6 dígitos do Lepvi Finanças. Perdeu o celular? Use um código de reserva.</p>${campo('Código', '<input name="codigo" required autocomplete="one-time-code" inputmode="text" maxlength="12" autofocus>')}<p class="erro" role="alert" id="auth-erro" tabindex="-1" hidden></p><button class="btn bloco" type="submit">Confirmar</button></form><p class="mut">${link('auth-entrar', 'Voltar')}</p>`;
    } else if (modo === 'esqueci') {
      titulo = 'Esqueci minha senha';
      corpo = `<form id="auth" class="auth-f" novalidate><p class="mut">Informe o e-mail da sua conta. Se ele existir, enviamos um link para criar uma nova senha.</p>${campo('E-mail', '<input name="email" type="email" required autocomplete="username" inputmode="email">')}${erro}<button class="btn bloco" type="submit">Enviar link</button></form><p class="mut">${link('auth-entrar', 'Voltar para entrar')}</p>`;
    } else if (modo === 'redefinir') {
      titulo = 'Criar nova senha';
      corpo = `<form id="auth" class="auth-f" novalidate>${campoSenha('Nova senha (mínimo 10 caracteres)', 'name="senha" type="password" required minlength="10" autocomplete="new-password"')}${mostrar}${erro}<button class="btn bloco" type="submit">Salvar nova senha</button></form>`;
    } else {
      titulo = 'Entrar';
      corpo = `${msg}${social('Entrar')}<form id="auth" class="auth-f" novalidate>${campo('E-mail', '<input name="email" type="email" required autocomplete="username" inputmode="email">')}${campoSenha('Senha', 'name="senha" type="password" required autocomplete="current-password"')}${mostrar}${erro}<button class="btn bloco" type="submit">Entrar</button></form>
        <p class="mut">${link('auth-esqueci', 'Esqueci minha senha')}</p>${V.cadastro === false ? '' : `<p class="mut">Ainda não tem conta? ${link('auth-cadastro', 'Criar conta grátis')}</p>`}`;
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
        <div class="vit-marca" role="img" aria-label="Lepvi Finanças"><svg viewBox="0 0 100 100" aria-hidden="true" fill="currentColor"><path d="M10 24L34 0V64L46 76H90L66 100H10Z"/><path d="M60 26H84V50H60Z"/></svg><span>Lepvi <b>Finanças</b></span></div>
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
    if (V.ts && ['entrar', 'cadastro', 'esqueci'].includes(V.auth) && !V.tsTok) { er.textContent = 'Confirme que você não é um robô (marque a caixa acima do botão).'; er.hidden = false; er.focus(); return; }
    const v = Object.fromEntries(new FormData(f)); const rotulo = btn.textContent; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = V.auth === 'entrar' ? 'Entrando…' : 'Enviando…';
    try {
      if (V.auth === 'entrar') { const r = await api('entrar', { email: v.email, senha: v.senha, turnstile: V.tsTok }); if (r.passo2) { V.auth = 'dois-passos'; V.ticket = r.ticket; V.msg = ''; render(); return; } USER.logado = true; USER.info = r.usuario; aba.marcar(); await carregarDados(); carregarEspaco(); aceitarConvite(); V.msg = ''; V.tela = 'inicio'; render(); window.scrollTo(0, 0); }
      else if (V.auth === 'dois-passos') { const r = await api('entrar_2fa', { ticket: V.ticket, codigo: v.codigo }); V.ticket = ''; USER.logado = true; USER.info = r.usuario; aba.marcar(); await carregarDados(); carregarEspaco(); aceitarConvite(); V.msg = ''; V.auth = 'entrar'; V.tela = 'inicio'; render(); window.scrollTo(0, 0); }
      else if (V.auth === 'cadastro') { const r = await api('cadastro', { nome: v.nome, email: v.email, senha: v.senha, aceite: !!v.aceite, turnstile: V.tsTok }); V.auth = 'enviado'; V.msg = r.mensagem; render(); }
      else if (V.auth === 'oauth-aceite') { const r = await api('oauth_concluir', { aceite: !!v.aceite }); if (r.usuario) { USER.logado = true; USER.info = r.usuario; aba.marcar(); await carregarDados(); carregarEspaco(); aceitarConvite(); V.msg = ''; V.tela = 'inicio'; render(); window.scrollTo(0, 0); } else { V.auth = 'enviado'; V.msg = r.mensagem; render(); } }
      else if (V.auth === 'esqueci') { const r = await api('esqueci', { email: v.email, turnstile: V.tsTok }); V.auth = 'enviado'; V.msg = r.mensagem; render(); }
      else if (V.auth === 'redefinir') { await api('redefinir', { token: V.token, senha: v.senha }); V.auth = 'entrar'; V.token = ''; V.msg = 'Senha alterada. Entre com a nova senha.'; render(); }
    } catch (e) { er.textContent = e.message + (V.auth === 'entrar' && /incorretos/.test(e.message) ? ' O navegador pode ter preenchido uma senha antiga: apague o campo, marque "Mostrar senha" e digite de novo.' : ''); er.hidden = false; er.focus(); btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = rotulo; if (window.turnstile && tsId !== null) { window.turnstile.reset(tsId); V.tsTok = ''; } }
  }
  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'auth') { ev.preventDefault(); enviarAuth(ev.target); }
    if (ev.target.id === 'perfil-f') { ev.preventDefault(); const nome = ev.target.nome.value.trim(); api('preferencias', { nome }).then((r) => { USER.info = r.usuario; render(); aviso('Perfil salvo.'); }).catch((e) => aviso(e.message)); }
  });
  const semMov = () => !!S.semMovimento || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function abertura() { // animação de abertura (uma vez por sessão do navegador); quem reduz animações não vê
    const sp = $('#splash'); if (!sp) return;
    let visto = false; try { visto = !!sessionStorage.getItem('lf-splash'); sessionStorage.setItem('lf-splash', '1'); } catch (e) { /* sem armazenamento */ }
    if (semMov() || visto) { sp.remove(); return; }
    sp.addEventListener('animationend', (ev) => { if (ev.animationName === 'spFora') sp.remove(); });
    setTimeout(() => { if (sp.isConnected) sp.remove(); }, 2600);
  }
  function entradaDaTela() { // anima a chegada de uma tela (não a cada atualização dos dados)
    const chave = USER.logado ? 'app-' + V.tela : 'auth-' + V.auth;
    if (V.vista === chave) return; V.vista = chave;
    if (semMov()) return;
    const t = $('#tela'); t.classList.remove('anima'); void t.offsetWidth; t.classList.add('anima');
    setTimeout(() => t.classList.remove('anima'), 1400);
    const g = USER.logado && !S.oculto ? $('#tela .hero .grande[data-v]') : null;
    if (g) { const alvo = Number(g.dataset.v); const t0 = performance.now(); const passo = (agora) => { const k = Math.min(1, (agora - t0) / 900); const e = 1 - Math.pow(1 - k, 4); g.textContent = F.brl(alvo * e); if (k < 1 && g.isConnected) requestAnimationFrame(passo); else g.textContent = F.brl(alvo); }; requestAnimationFrame(passo); }
  }
  async function iniciar() {
    abertura();
    $('#tela').innerHTML = '<div class="carrega" role="status"><svg class="car-logo" viewBox="0 0 100 100" aria-hidden="true" fill="currentColor"><path d="M10 24L34 0V64L46 76H90L66 100H10Z"/><path d="M60 26H84V50H60Z"/></svg><p class="car-nome">Lepvi <b>Finanças</b></p><span class="car-barra" aria-hidden="true"></span><p class="mut">Carregando suas contas…</p></div>';
    const q = new URLSearchParams(location.search); const tv = q.get('verificar'); const tr = q.get('redefinir');
    if (tv || tr) history.replaceState(null, '', location.pathname);
    const oa = q.get('oauth'); const op = q.get('p');
    if (oa) history.replaceState(null, '', location.pathname);
    const NOME_P = op === 'google' ? 'Google' : 'Microsoft';
    const MENS = { 'nao-configurado': `Entrar com ${NOME_P} ainda não está ativo. Use seu e-mail e senha por enquanto.`, erro: 'Não foi possível entrar. Tente de novo.', cancelado: 'Você cancelou a entrada.', muitas: 'Muitas tentativas. Espere alguns minutos.', 'erro-2fa': 'Sua conta tem verificação em dois passos. Entre com e-mail, senha e o código do app autenticador.', 'erro-cadastro-fechado': 'Novas contas estão fechadas no momento. Quem já tem conta entra normalmente.', 'erro-conta-existente': 'Já existe uma conta com este e-mail. Entre com a senha e tente de novo.', 'erro-confirme-email': 'Confirme seu e-mail pelo link que enviamos antes de entrar.', 'erro-sem-email': 'O provedor não informou seu e-mail. Use e-mail e senha.', 'erro-dados': 'Não foi possível entrar. Tente de novo.' };
    if (oa === 'aceite') { try { V.pend = await api('oauth_pendente'); V.auth = 'oauth-aceite'; } catch (e) { V.msg = e.message; V.msgErro = true; } }
    else if (oa === '2fa') { V.auth = 'dois-passos'; V.ticket = ''; } /* Google/Microsoft confirmaram a pessoa; o ticket vem em cookie e o código do app é obrigatório */
    else if (oa && oa !== 'ok') { V.msg = MENS[oa] || MENS.erro; V.msgErro = true; }
    if (tv) { try { await api('verificar', { token: tv }); V.msg = 'E-mail confirmado! Agora é só entrar.'; } catch (e) { V.msg = e.message; } }
    if (tr) { V.auth = 'redefinir'; V.token = tr; }
    const cv = q.get('convite');
    if (cv) { history.replaceState(null, '', location.pathname); try { localStorage.setItem(CONVITE, cv); } catch (e) { /* sem armazenamento */ } }
    if (cv && !V.msg) V.msg = 'Você recebeu um convite para compartilhar um espaço. Entre ou crie a sua conta para aceitar.';
    /* Link de "criar nova senha" do e-mail: mostra o formulário mesmo que este navegador ainda tenha uma sessão aberta (senão o app abria direto e o link se perdia). */
    const doOauth = voltouDoOauth();
    if (!tr && (aba.tem() || (oa === 'ok' && doOauth))) { try { const r = await api('eu'); USER.logado = true; USER.info = r.usuario; aba.marcar(); await carregarDados(); } catch (e) { /* sem sessão: mostra a entrada */ } }
    else { try { await api('sair', {}); } catch (e) { /* já estava fora */ } } // abriu o app de novo: encerra a sessão guardada e pede login
    if (!USER.logado) await carregarTurnstile();
    render();
    if (USER.logado) { carregarCapturas(); carregarConexoes(); carregarEspaco(); travar(); aceitarConvite(); }
  }

  /* ---------- compras automáticas (avisos do banco) ---------- */
  async function carregarCapturas() {
    try { const r = await api('capturas'); V.rev = r.capturas || []; V.chave = r.chave || null; } catch (e) { V.rev = V.rev || []; }
    if (USER.logado && !dlg.open && (V.tela === 'inicio' || V.tela === 'mais')) render();
  }
  const catOpts = (tipo, sel) => catsDe(tipo).filter((c) => c.nome !== 'Cartão').map((c) => `<option value="${esc(c.nome)}" ${c.nome === sel ? 'selected' : ''}>${esc(c.icone)} ${esc(c.nome)}</option>`).join('');
  function formRevisar() {
    const d = D(); const lista = V.rev || [];
    if (!lista.length) {
      abrir('Para revisar', '<p class="mut">Nada para revisar agora. Quando o banco avisar uma compra, ela aparece aqui para você conferir e lançar com um toque.</p><div class="botoes rodape-form"><button class="btn sec" type="button" data-acao="captura-config">Configurar avisos automáticos</button></div>');
      return;
    }
    const opcConta = (tipo, sel) => (tipo === 'receita' ? d.contas.map((c) => [c.id, c.nome]) : d.contas.map((c) => [c.id, c.nome]).concat(d.cartoes.map((c) => ['c:' + c.id, '💳 ' + c.nome])))
      .map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const contaPadrao = (l) => { if (l.tipo === 'receita' || !d.cartoes.length || !l.final) return d.contas[0].id; const c = d.cartoes.find((x) => x.final && x.final === l.final); return 'c:' + (c || d.cartoes[0]).id; };
    const linhas = lista.map((l, i) => `<div class="imp-lin rev-lin"><label class="imp-sel"><input type="checkbox" name="sel-${i}" checked aria-label="Lançar ${esc(l.desc)}"><span class="imp-d"><b>${esc(l.desc)}</b><small>${new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR')} · <span class="num ${l.tipo === 'receita' ? 'pos' : 'neg'}">${l.tipo === 'receita' ? '+' : '−'} ${F.brl(l.valor)}</span></small></span></label><span class="rev-sel"><select name="cat-${i}" aria-label="Categoria de ${esc(l.desc)}">${catOpts(l.tipo, F.sugerirCategoria(l.desc, l.tipo, d.lancs))}</select><select name="conta-${i}" aria-label="Conta de ${esc(l.desc)}">${opcConta(l.tipo, contaPadrao(l))}</select></span></div>`).join('');
    abrir('Para revisar', `<p class="mut">Estes avisos vieram do seu banco. Confira a categoria e a conta e lance as que estão certas.</p><div class="card imp-lista">${linhas}</div>
      <div class="botoes rodape-form"><button class="btn sec" type="button" id="rev-descartar">Descartar marcadas</button><button class="btn" type="submit">Lançar marcadas</button></div>`,
    (fd) => {
      const ids = []; const novos = [];
      lista.forEach((l, i) => {
        if (!fd.get('sel-' + i)) return;
        const conta = fd.get('conta-' + i); const cartao = F.ehCartao({ conta });
        novos.push({ id: uid(), tipo: l.tipo, desc: l.desc, valor: l.valor, data: l.data, categoria: fd.get('cat-' + i), conta, boleto: false, pago: !cartao, nota: 'Veio de um aviso do banco', tags: [], ignorar: false });
        ids.push(l.id);
      });
      if (!ids.length) { aviso('Marque ao menos um item.'); return false; }
      d.lancs.push(...novos); V.rev = V.rev.filter((x) => !ids.includes(x.id)); salvar();
      api('capturas_resolver', { ids }).catch(() => {}); render(); aviso(`${novos.length} lançamento(s) criado(s).`);
    }, (f) => {
      $('#rev-descartar', f).onclick = async () => {
        const ids = lista.filter((l, i) => f['sel-' + i] && f['sel-' + i].checked).map((l) => l.id);
        if (!ids.length) { aviso('Marque ao menos um item.'); return; }
        if (!(await confirmar('Descartar avisos?', `${ids.length} aviso(s) do banco serão descartados e não viram lançamento.`, 'Descartar'))) return;
        V.rev = V.rev.filter((x) => !ids.includes(x.id)); api('capturas_resolver', { ids }).catch(() => {}); dlg.close(); render(); aviso('Descartado.');
      };
    });
  }
  function formCaptura() {
    const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'api/captura.php';
    abrir('Compras automáticas', `<p class="mut">Seu celular manda o aviso de compra do banco para cá e o app cria um item em <b>Para revisar</b>. Você não precisa dar a senha do banco a ninguém e não paga nada.</p>
      <section class="card cap-passo"><h3>1. Gere sua chave</h3><p class="mut">É como uma senha só para este recurso. Ela aparece uma vez só; gerar outra desliga a anterior.</p>
        <button class="btn sec" type="button" id="cap-gerar">Gerar chave</button>
        <div id="cap-chave" hidden><label class="campo"><span>Sua chave (guarde agora)</span><input id="cap-token" readonly></label><button class="btn sec mini" type="button" data-copiar="#cap-token">Copiar chave</button></div></section>
      <section class="card cap-passo"><h3>2. Endereço para onde enviar</h3><label class="campo"><span>Endereço</span><input id="cap-url" readonly value="${esc(url)}"></label><button class="btn sec mini" type="button" data-copiar="#cap-url">Copiar endereço</button></section>
      <section class="card cap-passo"><h3>3. Configure no celular</h3>
        <details><summary>iPhone (app Atalhos)</summary><ol class="cap-ol"><li>Abra Atalhos → Automação → Nova automação → <b>Mensagem</b> (ou <b>E-mail</b>) e escolha o remetente do banco.</li><li>Ação <b>Obter conteúdo de URL</b>: coloque o endereço acima, método <b>POST</b>.</li><li>Cabeçalho <b>Authorization</b> com o valor <b>Bearer</b>, um espaço e a sua chave.</li><li>Corpo da solicitação em <b>JSON</b>: campo <b>texto</b> = Conteúdo da mensagem.</li><li>Marque <b>Executar imediatamente</b>.</li></ol></details>
        <details><summary>Android (app MacroDroid, grátis)</summary><ol class="cap-ol"><li>Novo macro → gatilho <b>Notificação recebida</b> e escolha o app do seu banco.</li><li>Ação <b>Requisição HTTP</b>, método <b>POST</b>, o endereço acima.</li><li>Cabeçalho <b>Authorization: Bearer</b> e a sua chave.</li><li>Corpo em JSON com o campo <b>texto</b> recebendo o texto da notificação (use a variável de texto da notificação do app).</li></ol></details>
        <details><summary>Banco que avisa por e-mail</summary><p class="mut">Se o seu e-mail permite regra de encaminhamento automático para um serviço de webhook, aponte para o endereço acima. Se precisar de ajuda, escreva para lepvi@lepvi.com.br.</p></details></section>
      <section class="card cap-passo"><h3>4. Confira se o celular está enviando</h3><p id="cap-status" class="mut" role="status" aria-live="polite"></p><button class="btn sec" type="button" id="cap-verificar">Verificar agora</button><p class="mut">Faça uma compra pequena ou peça ao banco um aviso de teste: quando o celular enviar, aqui aparece "recebido".</p></section>
      <section class="card cap-passo"><h3>5. Teste o texto do aviso</h3><p class="mut">Cole um aviso real do banco (ou use o exemplo) e veja se o app entende.</p>
        <label class="campo"><span>Texto do aviso</span><textarea id="cap-texto" maxlength="600">Compra aprovada R$ 89,90 no estabelecimento MERCADO SOL com cartão final 1234.</textarea></label>
        <button class="btn sec" type="button" id="cap-testar">Testar</button><p id="cap-res" class="mut" role="status"></p></section>`, null, (f) => {
      const quando = (t) => { const min = Math.max(0, Math.round((Date.now() / 1000 - t) / 60)); return min < 1 ? 'agora há pouco' : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dia(s)`; };
      const pintarStatus = () => { const c = V.chave; $('#cap-status', f).textContent = !c ? 'Nenhuma chave criada ainda. Faça o passo 1.' : c.ultimo_uso ? `✅ O celular enviou um aviso ${quando(c.ultimo_uso)}. Está funcionando.` : '⏳ Chave criada, mas nenhum aviso chegou ainda do celular.'; };
      pintarStatus();
      $('#cap-verificar', f).onclick = async () => { await carregarCapturas(); pintarStatus(); };
      $('#cap-gerar', f).onclick = async () => {
        if (!(await confirmar('Gerar uma chave nova?', 'A chave anterior, se existir, deixa de funcionar e você precisará atualizar o celular.', 'Gerar chave', false))) return;
        try { const r = await api('captura_token', {}); $('#cap-token', f).value = r.token; $('#cap-chave', f).hidden = false; V.chave = { criada_em: Math.floor(Date.now() / 1000), ultimo_uso: null }; pintarStatus(); aviso('Chave gerada. Copie e guarde agora: ela não aparece de novo.'); } catch (e) { aviso(e.message); }
      };
      f.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => { const el = $(b.dataset.copiar, f); try { await navigator.clipboard.writeText(el.value); aviso('Copiado.'); } catch (e) { el.select(); aviso('Selecione e copie manualmente.'); } }));
      $('#cap-testar', f).onclick = async () => {
        const res = $('#cap-res', f); res.textContent = 'Testando…';
        try { const r = await api('captura_teste', { texto: $('#cap-texto', f).value }); V.rev = [r.captura].concat(V.rev || []); const c = r.captura; res.textContent = `Entendi: ${c.tipo === 'receita' ? 'receita' : 'compra'} de ${F.brl(c.valor)} em "${c.desc}". Ela já está em Para revisar.`; } catch (e) { res.textContent = e.message; }
      };
    });
  }
  /* ---------- Open Finance pelo Meu Pluggy (grátis, uso pessoal) ---------- */
  async function carregarConexoes() {
    try { V.of = await api('conexoes'); } catch (e) { V.of = V.of || { ativo: true, tem_credencial: false, conexoes: [] }; }
    return V.of;
  }
  async function formOpenFinance() {
    const of = V.of || await carregarConexoes();
    const quando = (t) => { if (!t) return 'ainda não sincronizou'; const min = Math.max(0, Math.round((Date.now() / 1000 - t) / 60)); return min < 1 ? 'atualizado agora há pouco' : min < 60 ? `atualizado há ${min} min` : min < 1440 ? `atualizado há ${Math.round(min / 60)} h` : `atualizado há ${Math.round(min / 1440)} dia(s)`; };
    const renova = of.conexoes.length ? new Date(Math.min(...of.conexoes.map((c) => c.criado_em)) * 1000 + 365 * 86400000).toLocaleDateString('pt-BR') : '';
    const lista = of.conexoes.map((c) => `<div class="of-cx"><span class="of-ic" aria-hidden="true">🏦</span><span class="of-t"><b>${esc(c.instituicao)}</b><small>${c.status === 'erro' ? '⚠️ precisa de atenção, toque em Atualizar agora' : esc(quando(c.ultima_sync))}</small>${c.saldo != null ? `<small>Saldo no banco: <b class="num">${F.brl(c.saldo)}</b></small><button class="link" type="button" data-of-saldo="${esc(c.id)}">Usar como saldo do app</button>` : ''}</span><button class="btn sec mini" type="button" data-of-sair="${esc(c.id)}" aria-label="Desconectar ${esc(c.instituicao)}">Desconectar</button></div>`).join('');
    const campoCred = of.tem_credencial ? '' : `<label class="campo"><span>Client ID</span><input name="client_id" autocomplete="off" autocapitalize="off" spellcheck="false" required></label><label class="campo"><span>Client Secret</span><input name="client_secret" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>`;
    const formulario = of.conexoes.length < 5 ? `<section class="card cap-passo"><h3>${of.conexoes.length ? 'Adicionar outro banco' : '3. Cole os códigos aqui'}</h3>
        <label class="campo"><span>Nome do banco (como você quer ver)</span><input name="instituicao" maxlength="60" placeholder="Ex.: Nubank" required></label>
        <label class="campo"><span>Código do item (itemId)</span><input name="item_id" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
        ${campoCred}
        <button class="btn" type="submit">Conectar e trazer os últimos 30 dias</button></section>` : '<p class="mut">Você chegou ao limite de 5 bancos do Meu Pluggy gratuito.</p>';
    abrir('Bancos conectados', `<p class="mut">Conexão pelo <b>Meu Pluggy</b>, o caminho gratuito do Open Finance para uso pessoal. As compras do banco chegam sozinhas em <b>Para revisar</b>, todo dia.</p>
      ${lista ? `<section class="card">${lista}</section><div class="botoes"><button class="btn sec" type="button" id="of-atualizar">Atualizar agora</button></div>` : ''}
      ${renova ? `<p class="mut">A autorização do Meu Pluggy vale 1 ano. Renove por volta de <b>${esc(renova)}</b>.</p>` : ''}
      ${of.conexoes.length ? '' : `<section class="card cap-passo"><h3>1. Conecte seu banco no Meu Pluggy</h3><p class="mut">Crie sua conta em <a href="https://meu.pluggy.ai" target="_blank" rel="noopener">meu.pluggy.ai</a> e autorize seu banco lá. A senha do banco fica só com eles.</p></section>
      <section class="card cap-passo"><h3>2. Pegue seus códigos no painel do Pluggy</h3><ol class="cap-ol"><li>Entre em <a href="https://dashboard.pluggy.ai" target="_blank" rel="noopener">dashboard.pluggy.ai</a> com a mesma conta.</li><li>Abra <b>Aplicações → sua aplicação → Demo → Conectar Conta</b> e escolha <b>MeuPluggy</b> (não o seu banco).</li><li>Copie o <b>itemId</b> do banco em <i>Itens conectados</i>.</li><li>Em Aplicações, copie o <b>Client ID</b> e gere o <b>Client Secret</b> (ele só aparece uma vez).</li></ol><p class="mut"><a href="https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use" target="_blank" rel="noopener">Guia oficial com as telas</a></p></section>`}
      ${formulario}
      <section class="card cap-passo"><h3>Sua segurança</h3><ul class="cap-ol"><li>Os códigos ficam <b>criptografados</b> e só servem para <b>ler</b>: não movem dinheiro.</li><li>Cada movimentação entra uma vez só. O pagamento da fatura do cartão é ignorado para não duplicar.</li><li>Você desconecta a qualquer momento, aqui ou no Meu Pluggy.</li></ul>${of.tem_credencial ? '<button class="link" type="button" id="of-esquecer">Apagar meus códigos do Pluggy daqui</button>' : ''}</section>`,
    (fd) => {
      const corpo = { instituicao: fd.get('instituicao'), item_id: fd.get('item_id'), client_id: fd.get('client_id') || '', client_secret: fd.get('client_secret') || '' };
      const bt = dlg.querySelector('button[type="submit"]'); bt.disabled = true; bt.textContent = 'Conectando…';
      api('pluggy_conectar', corpo).then(async (r) => { await carregarConexoes(); await carregarCapturas(); dlg.close(); render(); aviso(r.aviso ? r.aviso : `Banco conectado. ${r.novas} movimentação(ões) em Para revisar.`); })
        .catch((e) => { aviso(e.message); bt.disabled = false; bt.textContent = 'Conectar e trazer os últimos 30 dias'; });
      return false;
    }, (f) => {
      const at = $('#of-atualizar', f);
      if (at) at.onclick = async () => { at.disabled = true; at.textContent = 'Atualizando…'; try { const r = await api('conexao_sincronizar', {}); await carregarConexoes(); await carregarCapturas(); dlg.close(); render(); aviso(r.aviso ? r.aviso : `${r.novas} movimentação(ões) nova(s) em Para revisar.`); } catch (e) { aviso(e.message); at.disabled = false; at.textContent = 'Atualizar agora'; } };
      f.querySelectorAll('[data-of-saldo]').forEach((b) => b.addEventListener('click', () => formAcertarSaldo(of.conexoes.find((c) => c.id === b.dataset.ofSaldo))));
      f.querySelectorAll('[data-of-sair]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmar('Desconectar este banco?', 'Os lançamentos já feitos continuam. Novas movimentações deixam de chegar.', 'Desconectar'))) return;
        try { await api('conexao_remover', { id: b.dataset.ofSair }); await carregarConexoes(); dlg.close(); render(); aviso('Banco desconectado.'); } catch (e) { aviso(e.message); }
      }));
      const es = $('#of-esquecer', f);
      if (es) es.onclick = async () => { if (!(await confirmar('Apagar os códigos do Pluggy?', 'Os bancos conectados por eles também saem daqui. Os lançamentos já feitos continuam.', 'Apagar'))) return; try { await api('pluggy_esquecer', {}); await carregarConexoes(); dlg.close(); render(); aviso('Códigos apagados.'); } catch (e) { aviso(e.message); } };
    });
  }
  /* Faz o saldo do app bater com o saldo real do banco (guardado pelo Pluggy na última atualização). */
  function formAcertarSaldo(c) {
    if (!c) return;
    const d = D();
    abrir('Usar o saldo do banco', `<p class="mut">Saldo de <b>${esc(c.instituicao)}</b> no banco: <b class="num">${F.brl(c.saldo)}</b>. Escolha qual conta do app deve mostrar esse valor.</p>
      <label class="campo"><span>Conta do app</span><select name="conta">${d.contas.map((x) => `<option value="${esc(x.id)}">${esc(x.nome)} (hoje ${F.brl(F.saldoConta(d.lancs, x))})</option>`).join('')}</select></label>
      <p class="mut">Dica: antes, aprove ou descarte tudo em <b>Para revisar</b>, porque o saldo do banco já inclui essas compras. Os lançamentos continuam; só o saldo inicial da conta é ajustado.</p>
      <div class="botoes"><button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn" type="submit">Acertar saldo</button></div>`, (fd) => {
      const conta = d.contas.find((x) => x.id === fd.get('conta')); if (!conta) return false;
      conta.saldoInicial = F.acertarSaldoInicial(d.lancs, conta, c.saldo);
      salvar(); render(); aviso(`${conta.nome} agora mostra ${F.brl(c.saldo)}.`);
    });
  }
  /* Saldo diferente do banco: a pessoa digita o saldo real de hoje de cada conta (ou usa o que o banco conectado informou). Os lançamentos ficam; só o saldo inicial muda. */
  function formCorrigirSaldo() {
    const d = D();
    const banco = ((V.of && V.of.conexoes) || []).filter((c) => c.saldo != null);
    const dica = banco.length ? `<p class="mut">Seu banco conectado informou: ${banco.map((c) => `<b>${esc(c.instituicao)}</b> <b class="num">${F.brl(c.saldo)}</b>`).join(', ')}.</p>` : '';
    abrir('Corrigir saldo', `<p class="mut">Abra o app do banco e digite quanto tem <b>hoje</b> em cada conta. Os lançamentos continuam iguais; o app só acerta o ponto de partida para o saldo bater.</p>${dica}
      ${d.contas.map((x) => { const sug = d.contas.length === 1 && banco.length === 1 ? banco[0].saldo : F.saldoConta(d.lancs, x); return `<label class="campo"><span>${esc(x.nome)} (hoje no app ${F.brl(F.saldoConta(d.lancs, x))})</span><input name="s-${esc(x.id)}" inputmode="decimal" value="${esc(String(sug).replace('.', ','))}" required></label>`; }).join('')}
      <p class="mut">Tem compra em <b>Para revisar</b>? Aprove ou descarte antes, porque o saldo do banco já inclui essas compras.</p>
      <div class="botoes"><button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn" type="submit">Corrigir saldo</button></div>`, (fd) => {
      let mudou = 0;
      d.contas.forEach((x) => { const v = F.numeroBR(String(fd.get('s-' + x.id) || '')); if (!Number.isFinite(v)) return; if (F.arred(v - F.saldoConta(d.lancs, x)) !== 0) { x.saldoInicial = F.acertarSaldoInicial(d.lancs, x, v); mudou++; } });
      salvar(); render(); aviso(mudou ? 'Saldo corrigido.' : 'Nada mudou: o saldo já batia.');
    });
  }
  /* ---------- divisão de despesas e meta mensal ---------- */
  function formDivisoes() {
    const d = D(); const s = F.saldosDivisao(d.lancs);
    abrir('Divisão de despesas', s.length ? `<p class="mut">Quando você paga uma despesa e divide com alguém (em Mais opções do lançamento), a parte dela aparece aqui até ser acertada.</p>${s.map((x, i) => `<section class="card cap-passo"><div class="sec-h"><h3>${esc(x.nome)}</h3><b class="num">${F.brl(x.total)}</b></div><ul class="lista">${x.itens.map((it) => `<li><div class="item"><div class="txt"><strong>${esc(it.desc)}</strong><span>${new Date(it.data + 'T12:00:00').toLocaleDateString('pt-BR')}</span></div><div class="val num">${F.brl(it.valor)}</div></div></li>`).join('')}</ul><button class="btn sec" type="button" data-acerto="${i}">${esc(x.nome)} me pagou tudo</button></section>`).join('')}`
      : '<p class="mut">Ninguém deve nada agora. Para dividir uma despesa, abra ou crie o lançamento, toque em <b>Mais opções</b> e preencha <b>Dividir com</b>.</p>', null, (f) => {
      f.querySelectorAll('[data-acerto]').forEach((b) => b.addEventListener('click', async () => {
        const x = s[+b.dataset.acerto]; if (!(await confirmar('Marcar como acertado?', `${x.nome} pagou tudo o que devia (${F.brl(x.total)}).`, 'Sim, acertado', false))) return;
        d.lancs.forEach((l) => (l.divisao || []).forEach((p) => { if (p.nome === x.nome) p.pago = true; }));
        salvar(); render(); formDivisoes(); aviso('Acertado.');
      }));
    });
  }
  function metaMes(o) {
    const r = F.metaObjetivo(o, F.mesDe(F.hojeISO())); if (!r.falta) return '';
    if (!r.planejado) return '<p class="mut" style="margin:10px 0 0">Defina um prazo ou um valor por mês para acompanhar mês a mês.</p>';
    return `<div style="margin-top:12px"><p class="mut num" style="margin:0 0 6px">Este mês: ${m(r.noMes)} de ${m(r.planejado)} ${o.mensal > 0 ? 'planejados' : 'sugeridos'}${r.restam ? ` · faltam ${r.restam} ${r.restam === 1 ? 'mês' : 'meses'}` : ''}</p><div class="barra ${r.noAlvo ? 'ok' : ''}" role="img" aria-label="${r.pctMes}% da meta do mês"><i style="width:${r.pctMes}%"></i></div><p class="mut" style="margin:6px 0 0">${r.noAlvo ? 'Meta do mês batida. 🎉' : `Faltam ${m(F.arred(r.planejado - r.noMes))} para a meta deste mês.`}</p></div>`;
  }
  /* ---------- fotos de comprovante ---------- */
  async function reduzirFoto(arq) {
    const bmp = await createImageBitmap(arq, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  }
  function montarAnexos(f, lancId) {
    const lista = $('#anexos-lista', f);
    const pintar = async () => {
      try {
        const r = await api('anexos&lanc=' + encodeURIComponent(lancId));
        lista.innerHTML = r.anexos.length ? r.anexos.map((a) => `<figure class="anexo" data-an="${a.id}"><img alt="Foto do comprovante (toque para ampliar)" tabindex="0"><button class="link" type="button" data-del-an="${a.id}">Remover</button></figure>`).join('') : '<small class="mut">Nenhuma foto ainda.</small>';
        r.anexos.forEach(async (a) => { try { const x = await api('anexo&id=' + a.id); const im = $(`[data-an="${a.id}"] img`, lista); if (im) im.src = x.dataUrl; } catch (e) { /* miniatura indisponível */ } });
      } catch (e) { lista.innerHTML = `<small class="mut">${esc(e.message)}</small>`; }
    };
    lista.addEventListener('click', async (ev) => {
      const im = ev.target.closest('img'); if (im) { im.classList.toggle('grande'); return; }
      const del = ev.target.closest('[data-del-an]'); if (!del) return;
      if (!(await confirmar('Remover esta foto?', 'A foto do comprovante será apagada.', 'Remover'))) return;
      try { await api('anexo_excluir', { id: del.dataset.delAn }); await pintar(); } catch (e) { aviso(e.message); }
    });
    $('#anexo-arq', f).addEventListener('change', async (ev) => {
      const arq = ev.target.files && ev.target.files[0]; ev.target.value = '';
      if (!arq || !/^image\//.test(arq.type)) { aviso('Escolha uma foto (JPG, PNG ou WebP).'); return; }
      try { aviso('Enviando a foto…'); await api('anexo_enviar', { lanc: lancId, dataUrl: await reduzirFoto(arq) }); aviso('Foto guardada.'); await pintar(); }
      catch (e) { aviso(e.message && !/bitmap|decode|source/i.test(e.message) ? e.message : 'Não consegui usar essa foto. Tente um JPG ou PNG.'); }
    });
    pintar();
  }
  const soltarAnexos = (lancs) => { lancs.forEach((l) => api('anexo_excluir', { lanc: l.id }).catch(() => {})); };

  const m = (v) => (S.oculto ? 'R$ •••' : F.brl(v));
  function aviso(t, ms) {
    /* janela aberta (dialog) fica acima do aviso da página: mostra a mensagem dentro dela, senão o erro some */
    const dl = document.getElementById('dlg');
    if (dl && dl.open && ms === undefined) { /* avisos com tempo (ex.: "Salvo ✓" do salvamento automático) seguem na página */
      let b = dl.querySelector('.erro-dlg');
      if (!b) { b = document.createElement('p'); b.className = 'erro-dlg'; b.setAttribute('role', 'alert'); const f = dl.querySelector('form'); (f || dl).appendChild(b); }
      b.textContent = t; b.scrollIntoView({ block: 'nearest' }); return;
    }
    const el = $('#aviso'); el.textContent = t; el.classList.add('on'); clearTimeout(aviso.t); aviso.t = setTimeout(() => el.classList.remove('on'), ms || 6000); }

  const NOME_MES = (x) => new Date(x + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long' }) + ' ' + x.slice(0, 4);
  const MES_CURTO = (x) => new Date(x + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const DIA_LONGO = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '');
  const DATA_CURTA = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
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
    const viz = (d) => { const x = F.somaMes(V.mes, d); return `<button type="button" class="viz" data-acao="mes" data-d="${d}" aria-label="Ir para ${esc(NOME_MES(x))}">${esc(new Date(x + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''))}</button>`; };
    return `<div class="mes"><button type="button" data-acao="mes" data-d="-1" aria-label="Mês anterior">‹</button>${viz(-1)}<strong>${esc(NOME_MES(V.mes))}</strong>${viz(1)}<button type="button" data-acao="mes" data-d="1" aria-label="Próximo mês">›</button></div>`;
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
    if (lista.length > 6) { const resto = lista.slice(5).reduce((s, e) => s + e[1], 0); return lista.slice(0, 5).concat([['Demais categorias', resto, '#94A3B8']]); }
    return lista;
  };
  function itemLanc(l) {
    const transf = l.tipo === 'transf';
    const info = transf ? { icone: '🔁', cor: '#2D4BFF' } : catInfo(l.categoria, l.tipo);
    const cartao = F.ehCartao(l);
    const sub = transf ? `${esc(nomeConta(l.conta))} → ${esc(nomeConta(l.destino))}` : `${esc(l.categoria)} · ${cartao ? '💳 ' : ''}${esc(nomeConta(l.conta))}${(l.tags || []).map((t) => ` <span class="tag">#${esc(t)}</span>`).join('')}${l.por && V.esp && V.esp.papel !== 'sozinho' ? ` · ${esc(l.por)}` : ''}${(l.coment || []).length ? ` · 💬 ${l.coment.length}` : ''}`;
    const sinal = l.tipo === 'receita' ? '+ ' : transf ? '' : '− ';
    const cor = l.tipo === 'receita' ? 'pos' : transf ? '' : 'neg';
    const visto = cartao ? '' : `<button class="visto ${l.pago ? 'on' : ''}" type="button" data-acao="alternar" data-id="${l.id}" aria-label="Pago ou recebido: ${esc(l.desc || l.categoria)}" aria-pressed="${!!l.pago}">${l.pago ? '✓' : ''}</button>`;
    return `<li><div class="item"><button class="item" style="border:0;padding:0;flex:1;min-width:0" type="button" data-acao="editar" data-id="${l.id}"><span class="ic" style="background:${info.cor}22">${info.icone}</span><span class="txt"><strong>${esc(l.desc || (transf ? 'Transferência' : l.categoria))}</strong><span>${sub}${!l.pago && !cartao ? ' · <span class="selo hoje">Pendente</span>' : ''}</span></span><span class="val num ${cor}">${sinal}${m(l.valor)}</span></button>${visto}</div></li>`;
  }
  /* ícone do item: o da categoria da conta (internet, água, assinatura...); fatura usa o cartão */
  function icItem(i) {
    if (i.tipo === 'fatura') return '<span class="ic" style="background:#EEF0FF">💳</span>';
    const info = catInfo(i.categoria, 'despesa');
    const d = String(i.titulo || '').toLowerCase();
    const ic = /internet|wi-?fi|banda larga|fibra/.test(d) ? '🌐' : /luz|energia/.test(d) ? '💡' : /[aá]gua/.test(d) ? '💧' : /telefone|celular|plano/.test(d) ? '📱' : info.icone;
    return `<span class="ic" style="background:${info.cor}22">${ic}</span>`;
  }
  function itemPagar(i) {
    const selo = i.atrasado ? `<span class="selo atraso">Atrasado ${Math.abs(i.dias)}d</span>` : i.dias === 0 ? '<span class="selo hoje">Vence hoje</span>' : `<span class="selo">Em ${i.dias}d</span>`;
    return `<li><div class="item">${icItem(i)}<div class="txt"><strong>${esc(i.titulo)}</strong><span>Vence ${DATA_CURTA(i.vencimento)} · ${selo}</span></div><div class="val num">${m(i.valor)}<br><button class="btn mini" type="button" data-acao="pagar" data-tipo="${i.tipo}" data-id="${esc(i.id)}">Paguei</button></div></div></li>`;
  }

  function itemPago(i) {
    return `<li><div class="item pago-item">${icItem(i)}<div class="txt"><strong>${esc(i.titulo)}</strong><span>Venceu ${DATA_CURTA(i.vencimento)} · <span class="selo ok">Pago</span></span></div><div class="val num">${m(i.valor)}</div></div></li>`;
  }

  /* ---------- telas ---------- */
  function telaInicio() {
    const d = D();
    const somaContas = (f) => F.arred(d.contas.filter((c) => !c.fora && f(c)).reduce((t, c) => t + F.saldoConta(d.lancs, c), 0));
    const saldo = somaContas((c) => c.tipo !== 'investimento'); const investido = somaContas((c) => c.tipo === 'investimento');
    const r = F.resumoMes(d.lancs, V.mes);
    const feito = [d.contas.some((c) => c.saldoInicial !== 0), d.cartoes.length > 0, d.lancs.length > 0];
    const guia = !S.guia && !feito.every(Boolean) ? `<section class="card"><h2 class="secao">Vamos organizar suas finanças 🚀</h2><p class="mut">Três passos e o painel já funciona para você.</p><div class="passos">
      ${[['Cadastre onde está seu dinheiro e o saldo de hoje', 'editar-conta-1'], ['Cadastre seus cartões de crédito', 'novo-cartao'], ['Lance sua primeira despesa ou receita', 'novo']].map((p, i) => `<button class="passo ${feito[i] ? 'feito' : ''}" type="button" data-acao="${p[1]}" data-id="${d.contas[0].id}"><span class="n">${feito[i] ? '✓' : i + 1}</span><strong>${p[0]}</strong></button>`).join('')}</div>
      <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec mini" type="button" data-acao="exemplo">Ver com dados de exemplo</button><button class="link" type="button" data-acao="fechar-guia">Dispensar</button></p></section>` : '';
    const pagar = F.aPagar(d.lancs, d.cartoes);
    const cats = entradasCat(r.porCategoria, 'despesa');
    const orc = F.orcamentoMes(d.lancs, d.orcamentos, V.mes).filter((o) => o.pct >= 80).slice(0, 2);
    const fats = F.faturas(d.lancs, d.cartoes).filter((f) => !f.paga);
    const ult = d.lancs.filter((l) => F.mesDe(l.data) === V.mes).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);
    const hora = new Date().getHours(); const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const vazio = (ic, tit, txt, acao, bt, bloco) => `<section class="card vazio"${bloco ? ` data-bloco="${bloco}"` : ''}><span class="vazio-ic" aria-hidden="true">${ic}</span><h2 class="secao">${tit}</h2><p class="mut">${txt}</p><button class="btn sec" type="button" data-acao="${acao}">${bt}</button></section>`;
    const contasVazio = d.contas.length === 1 && d.contas[0].saldoInicial === 0 && !d.lancs.length;
    return `<p class="saudacao">${saud},<br><b>${esc(String((USER.info && USER.info.nome) || '').split(' ')[0])}</b> 👋</p><div class="hero"><small>Saldo geral</small><span class="grande num" data-v="${saldo}">${m(saldo)}</span><button class="link hero-corrigir" type="button" data-acao="corrigir-saldo">${saldo < 0 ? 'Saldo negativo? Se no banco está diferente, corrija aqui' : 'Saldo diferente do banco? Corrigir'}</button>${investido ? `<small class="hero-inv">Investido <b class="num">${m(investido)}</b> · Patrimônio total <b class="num">${m(F.arred(saldo + investido))}</b></small>` : ''}
      <div class="duo"><div><small>Receitas do mês</small><b class="verde num">${m(r.receitas)}</b></div><div><small>Despesas do mês</small><b class="verm num">${m(r.despesas)}</b></div></div></div>
    <div class="contas" aria-label="Seus bancos e carteiras">${d.contas.map((c) => `<button class="conta" type="button" data-acao="editar-conta" data-id="${c.id}"><span class="mut"><i style="background:${c.cor}"></i>${esc(c.nome)}</span><b class="num">${m(F.saldoConta(d.lancs, c))}</b></button>`).join('')}<button class="conta nova" type="button" data-acao="nova-conta">+ Banco ou carteira</button></div>
    <div class="rapidas" role="group" aria-label="Ações rápidas">${[['rap-despesa', '🔻', 'Despesa'], ['rap-receita', '🔺', 'Receita'], ['rap-transf', '🔁', 'Transferir'], ['rap-fatura', '💳', 'Pagar fatura']].map(([a, i, t]) => `<button type="button" class="rap" data-acao="${a}"><span aria-hidden="true">${i}</span><b>${t}</b></button>`).join('')}</div>
    ${guia}
    ${seletorMes()}
    <div class="duas"><div class="card kpi"><span class="kpi-t">Receitas do mês</span><b class="pos num">${m(r.receitas)}</b><div class="barra ok" role="img" aria-label="Recebido"><i style="width:${r.receitas ? Math.min(100, (r.recebido / r.receitas) * 100) : 0}%"></i></div><span class="kpi-s">Já recebido: <b class="num">${m(r.recebido)}</b></span></div>
      <div class="card kpi"><span class="kpi-t">Despesas do mês</span><b class="neg num">${m(r.despesas)}</b><div class="barra estourou" role="img" aria-label="Pago"><i style="width:${r.despesas ? Math.min(100, (r.pago / r.despesas) * 100) : 0}%"></i></div><span class="kpi-s">Já pago: <b class="num">${m(r.pago)}</b></span></div></div>
    <div class="card" style="display:flex;justify-content:space-between;align-items:center"><span class="mut">Balanço previsto do mês</span><b class="num ${r.saldo >= 0 ? 'pos' : 'neg'}" style="font-size:20px">${m(r.saldo)}</b></div>
    ${(() => { const sd = F.sobraPorDia(r, V.mes); return sd ? `<section class="card" data-bloco="diario"><span class="mut">Pode gastar por dia até o fim do mês</span><b class="num ${sd.negativo ? 'neg' : 'pos'}" style="font-size:22px;display:block;margin-top:4px">${sd.negativo ? 'Nada: o mês está no vermelho' : m(sd.porDia)}</b><small class="mut">${sd.negativo ? `Faltam ${m(Math.abs(r.saldo))} para fechar o mês.` : `Sobram ${m(r.saldo)} para ${sd.restam} ${sd.restam === 1 ? 'dia' : 'dias'}, já descontando o que ainda vence.`}</small></section>` : ''; })()}
    ${(() => {
      const al = []; const hojeI = F.hojeISO();
      F.gastosAnormais(d.lancs, V.mes).slice(0, 2).forEach((x) => al.push(`📈 <b>${esc(x.categoria)}</b> está em ${m(x.gasto)}, ${String(x.vezes).replace('.', ',')}x a sua média de ${m(x.media)}.`));
      const neg = F.mesDe(hojeI) === V.mes ? F.projecaoSaldo(d.lancs, d.contas, d.cartoes, hojeI, 3).find((x) => x.saldoFim < 0) : null;
      if (neg) al.push(`⚠️ Pela sua agenda, o saldo fica negativo em <b>${esc(nomeMes(neg.mes))}</b>. Veja em Mais opções → Projeção de saldo.`);
      if (d.mei && d.mei.ativo) { const r = F.limiteMei(d.lancs, new Date().getFullYear(), d.mei.limite || 81000); if (r.pct >= 80) al.push(`🧾 MEI: você já faturou <b>${r.pct}%</b> do limite do ano.${r.estourou ? ' Passou do limite.' : ''}`); }
      const rc = F.aReceber(d.lancs); if (rc.atrasado > 0) al.push(`💰 Você tem <b>${m(rc.atrasado)}</b> a receber em atraso. Veja em Mais opções → Contas a receber.`);
      return al.length ? `<section class="card" data-bloco="alertas"><h2 class="secao">Fique de olho</h2><ul class="lista">${al.map((t) => `<li style="padding:8px 0">${t}</li>`).join('')}</ul></section>` : '';
    })()}
    <section class="card" data-bloco="pagar"><div class="sec-h"><h2 class="secao">Vencimentos</h2><button class="link" type="button" data-acao="ir-pagar">Ver todas</button></div>
      ${pagar.length ? `<ul class="lista">${pagar.slice(0, 3).map(itemPagar).join('')}</ul>` : '<p class="mut" style="padding:8px 0">Tudo em dia. Nenhum boleto ou fatura pendente. 🎉</p>'}</section>
    ${orc.length ? `<section class="card" data-bloco="orcamento"><h2 class="secao">Atenção no orçamento</h2><ul class="lista">${orc.map(rowOrc).join('')}</ul></section>` : ''}
    <section class="card" data-bloco="categorias"><div class="sec-h"><h2 class="secao">Despesas por categoria</h2><button class="link" type="button" data-acao="ir-rel">Relatórios</button></div>
      ${cats.length ? rosca(cats, 'Despesas') : '<p class="mut" style="padding:8px 0">Sem despesas neste mês.</p>'}</section>
    ${d.cartoes.length ? `<section class="card" data-bloco="cartoes"><div class="sec-h"><h2 class="secao">Cartões</h2><button class="link" type="button" data-acao="ir-cartoes">Abrir</button></div><ul class="lista">${d.cartoes.map((c) => { const f = fats.find((x) => x.cartaoId === c.id); const u = F.limiteUsado(d.lancs, c.id); return `<li><div class="item"><span class="ic" style="${fundo(c.cor)};color:#fff">💳</span><div class="txt"><strong>${esc(c.nome)}</strong><span>${f ? `Fatura vence ${DATA_CURTA(f.vencimento)}` : 'Sem fatura aberta'} · limite livre ${m(c.limite - u)}</span></div><div class="val num">${f ? m(f.total) : m(0)}</div></div></li>`; }).join('')}</ul></section>` : vazio('💳', 'Acompanhe suas faturas', 'Cadastre seus cartões e veja o limite livre, a fatura aberta e o vencimento de cada um.', 'novo-cartao', 'Adicionar cartão', 'cartoes')}
    <section class="card" data-bloco="ultimos"><div class="sec-h"><h2 class="secao">Últimos lançamentos</h2><button class="link" type="button" data-acao="ir-lancs">Ver todos</button></div>
      ${ult.length ? `<ul class="lista">${ult.map(itemLanc).join('')}</ul>` : '<p class="mut" style="padding:8px 0">Nenhum lançamento neste mês.</p>'}</section>
    ${contasVazio ? vazio('🏦', 'Acompanhe suas contas', 'Cadastre o seu banco e o saldo de hoje para o app mostrar o quanto você tem de verdade.', 'nova-conta', 'Adicionar conta') : ''}
    <div class="card linhas">${linha({ icone: LI.mais, titulo: 'Personalizar categorias', desc: 'Toque para criar e editar as suas categorias', attrs: 'data-acao="categorias"' })}</div>
    <p class="centro"><button class="link" type="button" data-acao="personalizar">Personalizar os cards da tela inicial</button></p>`;
  }

  function listaLancs() {
    const d = D();
    let l = d.lancs.filter((x) => F.mesDe(x.data) === V.mes);
    if (V.filtro !== 'todos') l = l.filter((x) => x.tipo === V.filtro);
    const q = V.q.trim().toLowerCase();
    if (q) l = l.filter((x) => `${x.desc} ${x.categoria} ${nomeConta(x.conta)} ${(x.tags || []).join(' ')}`.toLowerCase().includes(q));
    if (!l.length) return '<div class="card vazio"><span class="emoji">🗒️</span><p>Nenhum lançamento aqui.</p><button class="btn" type="button" data-acao="novo">Novo lançamento</button></div>';
    const ord = S.ordem === 'asc';
    const blocoDias = (arr, crescente) => {
      const dias = {}; arr.sort((a, b) => (crescente ? a.data.localeCompare(b.data) : b.data.localeCompare(a.data))).forEach((x) => { (dias[x.data] = dias[x.data] || []).push(x); });
      return Object.entries(dias).map(([dia, itens]) => {
        const t = F.arred(itens.filter((x) => x.tipo !== 'transf' && !x.ignorar).reduce((s, x) => s + (x.tipo === 'receita' ? x.valor : -x.valor), 0));
        const saldoDia = S.saldoDiario ? ` <small class="mut">· saldo ${m(F.saldoAteDia(d.lancs, d.contas, dia))}</small>` : '';
        return `<div class="dia"><span class="dia-nome">${esc(DIA_LONGO(dia))}${saldoDia}</span><span class="num">${m(t)}</span></div><div class="card" style="padding:4px 14px"><ul class="lista">${itens.map(itemLanc).join('')}</ul></div>`;
      }).join('');
    };
    /* o que ainda falta pagar ou receber vem primeiro, do vencimento mais próximo para o mais distante; o que já foi vem depois, do mais recente para o mais antigo */
    const pend = l.filter((x) => !x.pago && x.tipo !== 'transf' && !F.ehCartao(x)); const feitos = l.filter((x) => !pend.includes(x));
    if (!pend.length) return blocoDias(feitos, ord);
    return `<h2 class="secao">Falta pagar ou receber <small class="mut">· o que vence primeiro vem primeiro</small></h2>${blocoDias(pend, true)}${feitos.length ? `<h2 class="secao">Já pagos e recebidos</h2>${blocoDias(feitos, ord)}` : ''}`;
  }
  function listaSeries() {
    const d = D(); const hoje = F.hojeISO(); const mapa = {};
    d.lancs.filter((l) => l.serie).forEach((l) => { (mapa[l.serie] = mapa[l.serie] || []).push(l); });
    const series = Object.values(mapa).map((itens) => {
      itens.sort((a, b) => a.data.localeCompare(b.data));
      const futuros = itens.filter((l) => l.data >= hoje); const prox = futuros[0] || itens[itens.length - 1];
      return { itens, futuros, prox, base: String(prox.desc).replace(/ \(\d+\/\d+\)$/, '') };
    }).sort((a, b) => a.prox.data.localeCompare(b.prox.data));
    if (!series.length) return '<div class="card vazio"><span class="emoji">🔁</span><p>Aqui aparecem as contas que se repetem, como aluguel, internet e assinaturas. Ao lançar, abra "Mais opções" e escolha "Fixo todo mês" ou "Parcelado".</p><button class="btn" type="button" data-acao="novo">Novo lançamento</button></div>';
    return `<p class="mut">Suas contas fixas do dia a dia (internet, água, luz, aluguel) e as compras parceladas. Para ver o que vence em cada mês, use a aba <b>A pagar</b>. Ao encerrar uma conta, só os meses ainda não pagos são removidos.</p><div class="card linhas">${series.map((x) => {
      const info = catInfo(x.prox.categoria, x.prox.tipo); const parc = x.prox.modoSerie === 'parcelado';
      return `<div class="linha serie-lin"><span class="l-ic" style="background:${info.cor}22">${info.icone}</span><span class="l-t"><b>${esc(x.base)}</b><small>${parc ? 'Parcelado' : 'Conta fixa · ' + ROT_FREQ[x.prox.freq || 'mes']} · <span class="num">${m(x.prox.valor)}</span></small><small class="serie-fim">${x.futuros.length ? `<b>Faltam ${x.futuros.length}</b> · próximo ${DATA_CURTA(x.prox.data)} · <b>termina em ${esc(MES_ANO(x.itens[x.itens.length - 1].data))}</b>` : 'Terminou'}</small><span class="lt-mini" aria-hidden="true">${x.itens.length <= 36 ? x.itens.map((i) => `<i class="${i.data < hoje || i.pago ? 'feito' : 'falta'}"></i>`).join('') : ''}</span></span><span class="serie-bt"><button class="btn mini sec" type="button" data-acao="editar" data-id="${x.prox.id}">Editar</button>${x.futuros.length ? `<button class="btn mini sec" type="button" data-acao="encerrar-serie" data-id="${x.prox.serie}">Encerrar</button>` : ''}</span></div>`;
    }).join('')}</div>`;
  }
  function telaLancs() {
    const d = D();
    const abas = `<div class="abas" role="group"><button type="button" data-acao="sub" data-v="todos" aria-pressed="${V.sub === 'todos'}">Lançamentos</button><button type="button" data-acao="sub" data-v="apagar" aria-pressed="${V.sub === 'apagar'}">A pagar</button><button type="button" data-acao="sub" data-v="series" aria-pressed="${V.sub === 'series'}">Recorrentes</button></div>`;
    if (V.sub === 'series') return `<div class="tit"><h1>Lançamentos</h1></div>${abas}${listaSeries()}`;
    if (V.sub === 'apagar') {
      const c = F.contasDoMes(d.lancs, d.cartoes, V.mes); const hojeMes = F.mesDe(F.hojeISO());
      const antes = V.mes === hojeMes ? F.aPagar(d.lancs, d.cartoes).filter((i) => i.atrasado && F.mesDe(i.vencimento) < V.mes) : [];
      const pend = c.itens.filter((i) => !i.pago); const pagas = c.itens.filter((i) => i.pago);
      const pct = c.total ? Math.round((c.pago / c.total) * 100) : 0;
      const grupo = (t, arr, fn) => (arr.length ? `<h2 class="secao">${t}</h2><div class="card" style="padding:4px 14px"><ul class="lista">${arr.map(fn).join('')}</ul></div>` : '');
      return `<div class="tit"><h1>Lançamentos</h1><button class="btn mini" type="button" data-acao="novo-boleto">+ Boleto</button></div>${abas}${seletorMes()}
      <section class="card mes-resumo"><span class="kpi-t">Contas de ${esc(NOME_MES(V.mes))}</span><b class="num">${m(c.total)}</b><div class="barra ok" role="img" aria-label="${pct}% pago"><i style="width:${pct}%"></i></div><div class="mes-duas"><span>Já pago<b class="num pos">${m(c.pago)}</b></span><span>Falta pagar<b class="num ${c.falta > 0 ? 'neg' : 'pos'}">${m(c.falta)}</b></span></div></section>
      ${grupo('Atrasadas de meses anteriores', antes, itemPagar)}${grupo('Falta pagar', pend, itemPagar)}${grupo('Já pagas', pagas, itemPago)}
      ${c.itens.length || antes.length ? '' : '<div class="card vazio"><span class="emoji">🎉</span><p>Nenhuma conta ou fatura neste mês. Cadastre as contas fixas (internet, água, luz) em Novo lançamento → Mais opções → Fixo todo mês.</p><button class="btn" type="button" data-acao="novo-boleto">Cadastrar boleto</button></div>'}`;
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

  function ritmoTxt(o) {
    const r = F.ritmoOrcamento(o, V.mes, F.hojeISO()); if (!r || o.pct >= 100) return '';
    return r.adiantado ? `<small class="neg">Neste ritmo você chega a ${m(r.projecao)} no fim do mês (limite ${m(o.limite)}).</small>` : `<small class="mut">Até hoje o esperado era ${m(r.esperado)}. Você está dentro do ritmo.</small>`;
  }
  function rowOrc(o) {
    const info = catInfo(o.categoria, 'despesa'); const cls = o.pct >= 100 ? 'estourou' : o.pct >= 80 ? 'alerta' : 'ok';
    return `<li><button class="item" type="button" data-acao="editar-orc" data-id="${esc(o.categoria)}"><span class="ic" style="background:${info.cor}22">${info.icone}</span><span class="txt"><strong>${esc(o.categoria)}</strong><span class="num">${m(o.gasto)} de ${m(o.limite)}</span><div class="barra ${cls}" style="margin-top:6px"><i style="width:${Math.min(100, o.pct)}%"></i></div>${ritmoTxt(o)}</span><span class="val num ${o.restante < 0 ? 'neg' : ''}">${o.pct}%<small>${o.restante >= 0 ? 'faltam ' + m(o.restante) : 'acima ' + m(-o.restante)}</small></span></button></li>`;
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
      corpo = `${d.objetivos.length ? d.objetivos.map((o) => { const p = o.meta ? Math.min(100, (o.guardado / o.meta) * 100) : 0; return `<section class="card"><div class="sec-h"><h2 class="secao">🎯 ${esc(o.nome)}</h2><b class="num">${Math.round(p)}%</b></div><p class="mut num" style="margin:4px 0 10px">${m(o.guardado)} de ${m(o.meta)}${o.prazo ? ' · até ' + esc(NOME_MES(o.prazo)) : ''}</p><div class="barra"><i style="width:${p}%"></i></div>${metaMes(o)}<div class="botoes" style="margin-top:12px"><button class="btn mini" type="button" data-acao="aporte" data-id="${o.id}">Guardar dinheiro</button><button class="btn mini sec" type="button" data-acao="editar-obj" data-id="${o.id}">Editar</button></div></section>`; }).join('') : '<div class="card vazio"><span class="emoji">✈️</span><p>Crie um objetivo (viagem, reserva de emergência, caixa da empresa) e acompanhe quanto já guardou.</p></div>'}<button class="btn bloco" type="button" data-acao="novo-obj">Novo objetivo</button>`;
    } else if (V.plano === 'fluxo') {
      corpo = telaFluxo();
    } else {
      const r = F.resumoMes(d.lancs, V.mes); const ev = F.evolucao(d.lancs, V.mes, 6);
      const max = Math.max(1, ...ev.flatMap((e) => [e.receitas, e.despesas]));
      const ent = entradasCat(V.reltipo === 'despesa' ? r.porCategoria : receitaCat(d.lancs, V.mes), V.reltipo);
      corpo = `${seletorMes()}<div class="chips"><button type="button" data-acao="reltipo" data-v="despesa" aria-pressed="${V.reltipo === 'despesa'}">Despesas</button><button type="button" data-acao="reltipo" data-v="receita" aria-pressed="${V.reltipo === 'receita'}">Receitas</button></div>
      <section class="card"><h2 class="secao" style="margin-bottom:10px">Por categoria</h2>${ent.length ? rosca(ent, V.reltipo === 'despesa' ? 'Despesas' : 'Receitas') : '<p class="mut">Sem lançamentos neste mês.</p>'}</section>
      <section class="card"><h2 class="secao">Receitas x despesas</h2><div class="evol">${ev.map((e) => `<div class="col"><div class="par"><i style="height:${(e.receitas / max) * 100}%;background:var(--verde)" title="Receitas ${F.brl(e.receitas)}"></i><i style="height:${(e.despesas / max) * 100}%;background:var(--vermelho)" title="Despesas ${F.brl(e.despesas)}"></i></div><small>${esc(MES_CURTO(e.mes))}</small></div>`).join('')}</div><table class="tab"><caption class="so-leitor">Receitas e despesas dos últimos 6 meses</caption><thead><tr><th scope="col">Mês</th><th scope="col">Receitas</th><th scope="col">Despesas</th></tr></thead><tbody>${ev.map((e) => `<tr><th scope="row">${esc(MES_CURTO(e.mes))}</th><td class="num pos">${m(e.receitas)}</td><td class="num neg">${m(e.despesas)}</td></tr>`).join('')}</tbody></table></section>
      ${blocoComparativo(d)}
      ${blocoDre(d)}
      <p class="mut" style="text-align:center">ℹ️ Compras no cartão entram pela <b>data da compra</b>, e não pela data da fatura.</p>
      <div class="botoes sem-imprimir"><button class="btn sec" type="button" data-acao="exportar">Exportar em CSV</button><button class="btn sec" type="button" data-acao="imprimir">Salvar em PDF / imprimir</button></div>`;
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
  function blocoDre(d) {
    const r = F.dreMes(d.lancs, V.mes); if (!r.receitas && !r.despesas) return '';
    const lin = (a) => a.map((x) => `<tr><td>${esc(x.categoria)}</td><td class="num">${m(x.valor)}</td></tr>`).join('');
    return `<section class="card"><h2 class="secao">Resultado do mês (DRE)</h2><div class="tabela-rolagem"><table class="tab"><tbody><tr><th scope="row">Receitas</th><td class="num pos"><b>${m(r.receitas)}</b></td></tr>${lin(r.linhasReceita)}<tr><th scope="row">Despesas</th><td class="num neg"><b>${m(r.despesas)}</b></td></tr>${lin(r.linhasDespesa)}<tr><th scope="row">Resultado</th><td class="num ${r.resultado >= 0 ? 'pos' : 'neg'}"><b>${m(r.resultado)}</b></td></tr>${r.margem !== null ? `<tr><th scope="row">Margem</th><td class="num">${String(r.margem).replace('.', ',')}%</td></tr>` : ''}</tbody></table></div><p class="mut sem-imprimir">Use "Salvar em PDF / imprimir" abaixo para mandar ao contador.</p></section>`;
  }
  function blocoComparativo(d) {
    const c = F.comparativo(d.lancs, V.mes); const ant = NOME_MES(F.somaMes(V.mes, -1));
    const seta = (diff, bomSeSobe) => (diff === 0 ? '' : `<span class="${(diff > 0) === bomSeSobe ? 'pos' : 'neg'}">${diff > 0 ? '▲' : '▼'} ${m(Math.abs(diff))}</span>`);
    const linha3 = (t, at, an, bom) => `<tr><th scope="row">${t}</th><td class="num">${m(at)}</td><td class="num mut">${m(an)}</td><td class="num">${seta(F.arred(at - an), bom)}</td></tr>`;
    const maiores = F.maioresGastos(d.lancs, V.mes, 8); const tags = Object.entries(F.resumoPorTag(d.lancs, V.mes)).sort((a, b) => b[1] - a[1]);
    return `<section class="card"><h2 class="secao">Comparado com ${esc(ant)}</h2><table class="tab comp"><caption class="so-leitor">Comparação com o mês anterior</caption><thead><tr><th scope="col"></th><th scope="col">Este mês</th><th scope="col">Mês passado</th><th scope="col">Diferença</th></tr></thead><tbody>${linha3('Receitas', c.atual.receitas, c.anterior.receitas, true)}${linha3('Despesas', c.atual.despesas, c.anterior.despesas, false)}${linha3('Balanço', c.atual.saldo, c.anterior.saldo, true)}</tbody></table>
      ${c.categorias.length ? `<h3 class="a11y-t" style="margin-top:18px">O que mais mudou nas despesas</h3><ul class="lista">${c.categorias.slice(0, 5).map((x) => { const i = catInfo(x.categoria, 'despesa'); return `<li><div class="item"><span class="ic" style="background:${i.cor}22">${i.icone}</span><div class="txt"><strong>${esc(x.categoria)}</strong><span class="num">${m(x.anterior)} → ${m(x.atual)}</span></div><div class="val num">${seta(x.diff, false)}${x.pct !== null ? `<small>${x.pct > 0 ? '+' : ''}${x.pct}%</small>` : '<small>novo</small>'}</div></div></li>`; }).join('')}</ul>` : ''}</section>
    <section class="card"><h2 class="secao">Maiores gastos do mês</h2>${maiores.length ? `<ul class="lista">${maiores.map((l) => `<li><div class="item"><span class="ic" style="background:${catInfo(l.categoria, 'despesa').cor}22">${catInfo(l.categoria, 'despesa').icone}</span><div class="txt"><strong>${esc(l.desc)}</strong><span>${DATA_CURTA(l.data)} · ${esc(l.categoria)}</span></div><div class="val num neg">${m(l.valor)}</div></div></li>`).join('')}</ul>` : '<p class="mut">Sem despesas neste mês.</p>'}</section>
    ${tags.length ? `<section class="card"><h2 class="secao">Gastos por etiqueta</h2><ul class="lista">${tags.map(([t, v]) => `<li><div class="item"><span class="ic" style="background:rgba(138,61,255,.12)">🏷️</span><div class="txt"><strong>#${esc(t)}</strong></div><div class="val num">${m(v)}</div></div></li>`).join('')}</ul></section>` : ''}`;
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

  function versaoApp() {
    try { const v = new URL(document.querySelector('script[src*="app.js"]').src).searchParams.get('v'); return v ? `Versão ${esc(v)}` : ''; } catch (e) { return ''; }
  }
  function telaMais() {
    const d = D(); const u = USER.info; const grupo = grupoHtml;
    return `<div class="tit"><h1>Mais opções</h1></div>
    <section><div class="card linhas">${linha({ icone: `<span class="mini-av">${avatarHtml('peq')}</span>`, titulo: esc(u.nome), desc: 'Meu perfil, foto e dados da conta', attrs: 'data-acao="perfil"' })}</div></section>
    <section><div class="sec-h"><h2 class="grupo">Bancos e carteiras</h2><button class="link" type="button" data-acao="nova-conta">+ Adicionar</button></div><div class="card linhas">${d.contas.map((c) => linha({ icone: `<span class="bolinha" style="background:${c.cor}"></span>`, cor: c.cor, titulo: esc(c.nome), desc: c.fora ? 'Fora do saldo geral' : 'Soma no saldo geral', fim: `<span class="num">${m(F.saldoConta(d.lancs, c))}</span>`, attrs: `data-acao="editar-conta" data-id="${c.id}"` })).join('')}</div></section>
    ${grupo('Compras automáticas',
      linha({ icone: LI.bell, titulo: 'Para revisar', desc: (V.rev && V.rev.length) ? `${V.rev.length} aviso(s) do banco esperando você` : 'Avisos do banco que viram lançamento', attrs: 'data-acao="revisar"' })
      + linha({ icone: LI.chave, titulo: 'Conectar avisos do banco', desc: 'Chave e passo a passo, sem dar a senha do banco', attrs: 'data-acao="captura-config"' }))}
    ${grupo('Open Finance',
      linha({ icone: LI.escudo, titulo: 'Bancos conectados', desc: V.of && V.of.conexoes.length ? `${V.of.conexoes.length} banco(s) conectado(s)` : 'Conecte o banco grátis pelo Meu Pluggy', attrs: 'data-acao="openfinance"' }))}
    ${grupo('Divisão de despesas',
      linha({ icone: LI.copia, titulo: 'Quem deve a sua parte', desc: (() => { const s = F.saldosDivisao(d.lancs); return s.length ? `${s.length} pessoa(s) a acertar · ${m(s.reduce((t, x) => t + x.total, 0))}` : 'Despesas divididas com casal ou sócios'; })(), attrs: 'data-acao="divisoes"' }))}
    ${grupo('Configurações',
      linha({ icone: LI.texto, titulo: 'Configurações do app', desc: 'Ordem dos lançamentos, saldo diário, sugestões', attrs: 'data-acao="config"' }))}
    ${grupo('Compartilhar',
      linha({ icone: LI.user, titulo: 'Compartilhar com outra pessoa', desc: !V.esp || V.esp.papel === 'sozinho' ? 'Cônjuge ou sócio vê e edita com você' : V.esp.papel === 'membro' ? `Você está no espaço de ${esc(V.esp.dono.nome)}` : `Compartilhando com ${esc(V.esp.membros[0].nome)}`, attrs: 'data-acao="compartilhar"' }))}
    ${grupo('Ferramentas',
      linha({ icone: LI.user, titulo: 'Contas a receber', desc: (() => { const r = F.aReceber(d.lancs); return r.itens.length ? `${r.itens.length} a receber · ${m(r.total)}` : 'Clientes que ainda vão pagar'; })(), attrs: 'data-acao="receber"' })
      + linha({ icone: LI.brilho, titulo: 'Projeção de saldo', desc: 'Como ficam os próximos 6 meses', attrs: 'data-acao="projecao"' })
      + linha({ icone: LI.escudo, titulo: 'Reserva de emergência', desc: 'Quantos meses você aguenta sem renda', attrs: 'data-acao="reserva"' })
      + linha({ icone: LI.brilho, titulo: 'Meu desempenho', desc: 'Quanto da renda sobrou e dias seguidos lançando', attrs: 'data-acao="desempenho"' })
      + linha({ icone: LI.arquivo, titulo: '13º e férias', desc: 'Quanto você recebe, antes dos descontos', attrs: 'data-acao="calc-trabalho"' })
      + linha({ icone: LI.lixo, titulo: 'Simulador de dívidas', desc: 'Qual dívida pagar primeiro', attrs: 'data-acao="dividas"' })
      + linha({ icone: LI.arquivo, titulo: 'MEI: limite e DAS', desc: 'Faturamento do ano e lembrete do imposto', attrs: 'data-acao="mei"' })
      + linha({ icone: LI.copia, titulo: 'Modelos de lançamento', desc: `${(d.modelos || []).length} salvo(s)`, attrs: 'data-acao="modelos"' })
      + linha({ icone: LI.bell, titulo: 'Assinaturas', desc: 'Cobranças que se repetem todo mês', attrs: 'data-acao="assinaturas"' })
      + linha({ icone: LI.brilho, titulo: 'Simulador de juros e metas', desc: 'Quanto vira se guardar todo mês', attrs: 'data-acao="simulador"' })
      + linha({ icone: LI.copia, titulo: 'Desafio das 52 semanas', desc: 'Guarde um pouco mais a cada semana', attrs: 'data-acao="desafio"' })
      + linha({ icone: LI.chave, titulo: 'Bloqueio com PIN', desc: PIN.ativo() ? 'Ligado neste aparelho' : 'Peça um PIN ao abrir o app', attrs: 'data-acao="pin"' }))}
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
    ${grupo('Zona de risco', linha({ icone: LI.lixo, titulo: 'Apagar todos os meus lançamentos', desc: 'Remove contas, cartões e lançamentos', perigo: true, attrs: 'data-acao="apagar"' }))}
    <button class="btn sec bloco" type="button" data-acao="sair">${svg(LI.sair)}&nbsp; Sair</button>
    <p class="mut centro versao-app">${versaoApp()}</p>`;
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
    ${grupo('Configure',
      linha({ icone: LI.escudo, titulo: 'Contas e bancos', desc: 'Em Mais opções', attrs: 'data-acao="ir-contas"' })
      + linha({ icone: LI.copia, titulo: 'Cartões de crédito', attrs: 'data-acao="ir-cartoes"' })
      + linha({ icone: LI.mais, titulo: 'Categorias', attrs: 'data-acao="categorias"' })
      + linha({ icone: LI.texto, titulo: 'Etiquetas (tags)', desc: 'Renomear ou apagar', attrs: 'data-acao="tags"' })
      + linha({ icone: LI.brilho, titulo: 'Ver guia de passos iniciais', attrs: 'data-acao="ver-guia"' })
      + linha({ icone: LI.user, titulo: 'Indicar o Lepvi Finanças a um amigo', attrs: 'data-acao="indicar"' })
      + linha({ icone: LI.bell, titulo: 'Central de ajuda e contato', desc: 'Perguntas e respostas, e-mail e WhatsApp', attrs: 'data-acao="ajuda"' }))}
    ${grupo('Preferências',
      linha({ tag: 'label', icone: LI.bell, titulo: 'Avisos de vencimento por e-mail', desc: 'Vence em breve, vence hoje e já venceu', fim: '', dentro: `<input id="avisos-sw" type="checkbox" role="switch" ${u.avisos ? 'checked' : ''}>` })
      + linha({ tag: 'label', icone: LI.bell, titulo: 'Lembrete se esquecer de lançar', desc: 'E-mail de manhã se ontem ficou sem nenhum lançamento', fim: '', dentro: `<input id="lembrete-sw" type="checkbox" role="switch" ${u.lembrete ? 'checked' : ''}>` })
      + linha({ tag: 'label', icone: LI.bell, titulo: 'Resumo semanal por e-mail', desc: 'Toda segunda: quanto gastou, o que mudou e o que vence', fim: '', dentro: `<input id="resumo-sw" type="checkbox" role="switch" ${u.resumo ? 'checked' : ''}>` })
      + linha({ icone: LI.texto, titulo: 'Tamanho do texto e contraste', desc: 'Facilita a leitura', attrs: 'data-acao="acess"' }))}
    ${grupo('Segurança e privacidade',
      linha({ icone: LI.chave, titulo: 'Alterar senha', attrs: 'data-acao="senha"' })
      + linha({ icone: LI.escudo, titulo: 'Verificação em dois passos', desc: u.dois_passos ? 'Ativada: pede um código do celular ao entrar' : 'Recomendado: pede um código do celular ao entrar', fim: u.dois_passos ? '<span class="selo ok">Ativa</span>' : '›', attrs: 'data-acao="dois-passos"' })
      + linha({ tag: 'a', icone: LI.baixar, titulo: 'Baixar meus dados', desc: 'Arquivo completo da sua conta (LGPD)', attrs: 'href="api/?a=exportar" download' })
      + linha({ tag: 'a', icone: LI.escudo, titulo: 'Política de Privacidade', attrs: 'href="privacidade.html" target="_blank" rel="noopener"' }))}
    ${grupo('Zona de risco', linha({ icone: LI.lixo, titulo: 'Excluir meu cadastro', desc: 'Apaga o cadastro e todos os dados, para sempre', perigo: true, attrs: 'data-acao="excluir-conta"' }))}
    <button class="btn sec bloco" type="button" data-acao="sair">${svg(LI.sair)}&nbsp; Sair</button>`;
  }

  /* menu da conta (avatar no topo) */
  function menuConta() {
    const u = USER.info;
    abrir('Meu perfil', `<div class="conta-card" style="margin:0">${avatarHtml('grande')}<div class="conta-info"><h2>${esc(u.nome)}</h2><p>${esc(u.email)}</p></div></div>
      <div class="card linhas">${linha({ icone: LI.user, titulo: 'Meu perfil', desc: 'Foto, nome e dados da conta', attrs: 'data-sheet="perfil"' })}${linha({ icone: LI.texto, titulo: 'Tamanho do texto e contraste', attrs: 'data-sheet="acess"' })}${linha({ icone: LI.brilho, titulo: 'Atalhos e inteligências', desc: 'Ache qualquer função do app', attrs: 'data-sheet="busca"' })}${linha({ icone: LI.chave, titulo: 'Alterar senha', attrs: 'data-sheet="senha"' })}${linha({ icone: LI.escudo, titulo: 'Verificação em dois passos', desc: u.dois_passos ? 'Ativada' : 'Recomendado: proteja sua conta', attrs: 'data-sheet="dois"' })}${linha({ icone: LI.mais, titulo: 'Mais opções', desc: 'Contas, importar, cópia de segurança', attrs: 'data-sheet="mais"' })}</div>
      <button class="btn bloco" type="button" data-sheet="sair">${svg(LI.sair)}&nbsp; Sair</button>`, null, (f) => {
      f.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => { const a = b.dataset.sheet; dlg.close(); if (a === 'perfil' || a === 'mais') ir(a); else if (a === 'acess') formAcess(); else if (a === 'busca') formBusca(); else if (a === 'senha') formSenha(); else if (a === 'dois') formDoisPassos(); else sair(); }));
    });
  }
  async function sair() { try { await api('sair', {}); } catch (e) { /* já saiu */ } aba.limpar(); PIN.remover(); USER.logado = false; limparMemoria(); V.auth = 'entrar'; V.msg = 'Você saiu. Até logo!'; await carregarTurnstile(); render(); window.scrollTo(0, 0); }
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
    document.body.classList.remove('carregando');
    document.body.classList.toggle('deslogado', !USER.logado);
    if (!USER.logado) { $('#menu').innerHTML = ''; $('#tela').innerHTML = telaAuth(); montarTurnstile(); entradaDaTela(); return; }
    document.querySelectorAll('[data-perfil]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.perfil === S.perfil)));
    const olho = $('[data-acao=olho]'); olho.innerHTML = svg(S.oculto ? EYE_OFF : EYE); olho.setAttribute('aria-pressed', String(!!S.oculto)); olho.setAttribute('aria-label', S.oculto ? 'Mostrar valores' : 'Ocultar valores');
    const nav = (id, t) => `<button type="button" data-tela="${id}" ${V.tela === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[id]}</svg>${t}</button>`;
    const ab = $('[data-acao=conta-menu]'); ab.innerHTML = avatarHtml(); ab.setAttribute('aria-label', 'Meu perfil: ' + USER.info.nome);
    $('#menu').innerHTML = nav('inicio', 'Início') + nav('lancs', 'Lançamentos') + '<button class="mais-novo" type="button" data-acao="menu-novo" aria-label="Novo lançamento">+</button>' + nav('cartoes', 'Cartões') + nav('planejar', 'Planejar')
      + `<div class="menu-fim"><button type="button" class="mf-mais" data-acao="mais"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>Mais opções</button><div class="menu-user"><button type="button" class="mu-perfil" data-acao="perfil">${avatarHtml('peq')}<span><b>${esc(USER.info.nome)}</b><small>Meu perfil</small></span></button><button type="button" class="mu-sair" data-acao="sair">Sair</button></div></div>`;
    $('#tela').innerHTML = VISTAS[V.tela]();
    if (V.tela === 'inicio' && V.rev && V.rev.length) $('#tela').insertAdjacentHTML('afterbegin', `<section class="card rev-card" role="status"><h2 class="secao">🔔 ${V.rev.length} ${V.rev.length === 1 ? 'compra para revisar' : 'compras para revisar'}</h2><p class="mut">O app leu estes avisos do seu banco. Confira e lance com um toque.</p><button class="btn" type="button" data-acao="revisar">Revisar agora</button></section>`);
    if (V.tela === 'inicio' && S.inicio) document.querySelectorAll('#tela [data-bloco]').forEach((el) => { if (S.inicio[el.dataset.bloco] === false) el.remove(); });
    entradaDaTela(); atualizarSino();
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
  /* confirmação própria do app (no lugar da caixa feia do navegador) */
  function confirmar(titulo, texto, ok = 'Confirmar', perigo = true) {
    return new Promise((resolve) => {
      const c = document.createElement('dialog'); c.className = 'confirma'; c.setAttribute('role', 'alertdialog'); c.setAttribute('aria-labelledby', 'cf-t'); c.setAttribute('aria-describedby', 'cf-d');
      c.innerHTML = `<div class="cf-corpo"><span class="cf-ic ${perigo ? 'perigo' : ''}" aria-hidden="true">${perigo ? '!' : '?'}</span><h2 id="cf-t">${esc(titulo)}</h2><p id="cf-d">${esc(texto)}</p><div class="cf-bt"><button class="btn sec" type="button" data-r="0">Cancelar</button><button class="btn ${perigo ? 'perigo' : ''}" type="button" data-r="1">${esc(ok)}</button></div></div>`;
      const fim = (v) => { c.close(); c.remove(); resolve(v); };
      c.addEventListener('click', (ev) => { const b = ev.target.closest('[data-r]'); if (b) fim(b.dataset.r === '1'); else if (ev.target === c) fim(false); });
      c.addEventListener('cancel', (ev) => { ev.preventDefault(); fim(false); });
      document.body.appendChild(c); c.showModal(); $('[data-r="0"]', c).focus();
    });
  }
  const radios = (nome, arr, sel, cls = '') => `<div class="opcoes ${cls}" role="radiogroup">${arr.map(([v, t, ic]) => `<label><input type="radio" name="${nome}" value="${esc(v)}" ${v === sel ? 'checked' : ''}><span>${ic ? `<em>${ic}</em>` : ''}${esc(t)}</span></label>`).join('')}</div>`;
  const campoSenha = (rot, attrs) => `<label class="campo"><span>${rot}</span><span class="senha-wrap"><input ${attrs}><button type="button" class="olho-senha" data-olho aria-label="Mostrar a senha" aria-pressed="false">${svg(EYE)}</button></span></label>`;
  const troca = (nome, rot, on) => `<label class="troca"><span>${rot}</span><input type="checkbox" role="switch" name="${nome}" ${on ? 'checked' : ''}></label>`;
  const campo = (rot, html) => `<label class="campo"><span>${rot}</span>${html}</label>`;
  const sele = (nome, arr, sel) => `<select name="${nome}">${arr.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const val2 = (v) => (v != null ? String(v).replace('.', ',') : '');

  function menuNovo() {
    const d = D(); const mods = d.modelos || [];
    const temVoz = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    abrir('O que você quer lançar?', `<div class="campo"><span>Escreva ou fale</span><div class="valor-lin" style="gap:8px"><input id="txt-rap" maxlength="160" autocomplete="off" placeholder="Ex.: gastei 45 no mercado ontem" aria-label="Escreva o lançamento em uma frase" style="flex:1;min-width:0">${temVoz ? '<button class="btn sec mini" type="button" data-voz aria-label="Falar o lançamento">🎤 Falar</button>' : ''}</div><button class="btn" type="button" data-txt-ok>Preencher o lançamento</button><small class="mut">O app lê o valor, o dia e a categoria e deixa você conferir antes de salvar.</small></div>
      <div class="duas" style="gap:10px">${[['despesa', '🔻', 'Despesa'], ['receita', '🔺', 'Receita'], ['transf', '🔁', 'Transferência'], ['cartao', '💳', 'Compra no cartão']].map(([k, i, t]) => `<button class="card" type="button" data-novo="${k}" style="border:0;text-align:center;padding:20px 10px"><span style="font-size:30px;display:block">${i}</span><b style="font-weight:600">${t}</b></button>`).join('')}</div>
      ${mods.length ? `<h3 class="grupo">Modelos</h3><div class="chips grade" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${mods.map((x) => `<button type="button" class="chip" data-modelo="${esc(x.id)}">${esc(catInfo(x.categoria, x.tipo).icone)} ${esc(x.desc)}<br><b class="num">${m(x.valor)}</b></button>`).join('')}</div>` : ''}`, null, (f) => {
      f.querySelectorAll('[data-novo]').forEach((b) => b.addEventListener('click', () => formLanc({}, b.dataset.novo)));
      f.querySelectorAll('[data-modelo]').forEach((b) => b.addEventListener('click', () => { const x = mods.find((y) => y.id === b.dataset.modelo); if (x) formLanc({ tipo: x.tipo, desc: x.desc, valor: x.valor, categoria: x.categoria, conta: x.conta, boleto: x.boleto, data: F.hojeISO(), pago: false }, x.tipo); }));
      const campoTxt = f.querySelector('#txt-rap');
      const usar = () => {
        const r = F.interpretarTexto(campoTxt.value, F.hojeISO(), D().lancs);
        if (!r) { aviso('Não achei o valor. Escreva assim: gastei 45 no mercado.'); campoTxt.focus(); return; }
        formLanc({ tipo: r.tipo, desc: r.desc, valor: r.valor, data: r.data, categoria: r.categoria, pago: r.pago, boleto: r.boleto }, r.tipo);
      };
      f.querySelector('[data-txt-ok]').addEventListener('click', usar);
      campoTxt.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); usar(); } });
      const v = f.querySelector('[data-voz]');
      if (v) v.addEventListener('click', () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = false;
        v.textContent = '🎤 Ouvindo…'; v.disabled = true;
        const fim = () => { v.textContent = '🎤 Falar'; v.disabled = false; };
        rec.onresult = (ev) => { campoTxt.value = ev.results[0][0].transcript; fim(); usar(); };
        rec.onerror = (ev) => { fim(); const e = ev && ev.error; aviso(e === 'not-allowed' || e === 'service-not-allowed' ? 'O microfone está bloqueado. Libere o microfone para este site nas permissões do navegador (cadeado ao lado do endereço).' : e === 'no-speech' ? 'Não ouvi nada. Fale perto do microfone e tente de novo.' : e === 'audio-capture' ? 'Não encontrei um microfone neste aparelho.' : e === 'network' ? 'A voz precisa de internet. Tente de novo ou escreva a frase.' : 'Não consegui ouvir. Tente de novo ou escreva a frase.'); };
        rec.onend = fim;
        try { rec.start(); } catch (e) { fim(); }
      });
    });
  }

  /* data do i-ésimo lançamento de uma série: semana, 15 dias, mês ou ano (dia 31 em mês curto vira o último dia) */
  function dataSerie(iso, freq, i) {
    if (freq === 'semana' || freq === 'quinzena') { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + i * (freq === 'semana' ? 7 : 14)); return F.hojeISO(x); }
    const mes = F.somaMes(F.mesDe(iso), freq === 'ano' ? 12 * i : i); const ult = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
    return `${mes}-${String(Math.min(Number(iso.slice(8, 10)), ult)).padStart(2, '0')}`;
  }
  const MES_ANO = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  /* linha do tempo de uma conta que se repete: bolinhas cheias = já passou, anel azul = esta, vazias = faltam */
  function linhaTempo(itens, atualId, hoje) {
    if (itens.length > 36) return '';
    return `<div class="lt" role="img" aria-label="${itens.filter((x) => x.data >= hoje).length} de ${itens.length} ainda faltam">${itens.map((x) => `<i class="${x.id === atualId ? 'atual' : x.data < hoje || x.pago ? 'feito' : 'falta'}" title="${esc(new Date(x.data + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }))}"></i>`).join('')}</div><div class="lt-leg"><span><i class="feito"></i>já foi</span><span><i class="atual"></i>esta</span><span><i class="falta"></i>faltam</span></div>`;
  }
  function ajustarSerie(alvo, restam, semSufixo) {
    const d = D(); const lista = d.lancs.filter((x) => x.serie === alvo.serie).sort((a, b) => a.data.localeCompare(b.data));
    const aPartir = lista.slice(lista.findIndex((x) => x.id === alvo.id));
    if (restam < aPartir.length) { const fora = aPartir.slice(restam); soltarAnexos(fora); d.lancs = d.lancs.filter((x) => !fora.includes(x)); }
    else if (restam > aPartir.length) { const modelo = aPartir[aPartir.length - 1]; for (let i = aPartir.length; i < restam; i++) d.lancs.push({ ...modelo, id: uid(), data: dataSerie(alvo.data, modelo.freq || 'mes', i), pago: false, divisao: undefined }); }
    const final = d.lancs.filter((x) => x.serie === alvo.serie).sort((a, b) => a.data.localeCompare(b.data));
    final.forEach((x, i) => { x.n = i + 1; x.de = final.length; if (x.modoSerie === 'parcelado') x.desc = semSufixo(x.desc) + ` (${i + 1}/${final.length})`; });
  }
  const ROT_FREQ = { semana: 'toda semana', quinzena: 'a cada 15 dias', mes: 'todo mês', ano: 'todo ano' };
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
      ? `<p class="rep-resumo"><b>O que é transferência?</b> É mover dinheiro entre os seus bancos ou carteiras (por exemplo, do banco para a carteira). Não é gasto nem ganho: não entra nos relatórios, só muda o saldo de cada um.${contas.length < 2 ? ' <b>Você ainda tem só um banco ou carteira.</b> Cadastre outro em Mais opções → Bancos e carteiras para poder transferir.' : ''}</p><div class="dupla">${campo('Sai de', sele('conta', contas, base.conta))}${campo('Entra em', sele('destino', contas, base.destino || (contas[1] || contas[0])[0]))}</div>`
      : campo(tipo === 'receita' ? 'Receber em' : 'Pagar com', radios('conta', opcContas, contaSel));
    const rotPago = tipo === 'receita' ? 'Já recebi' : tipo === 'transf' ? 'Já foi feita' : 'Já paguei';
    const abas = novo ? `<div class="abas3" role="group" aria-label="Tipo de lançamento">${[['despesa', 'Despesa'], ['receita', 'Receita'], ['transf', 'Transferência']].map(([k, t]) => `<button type="button" data-aba="${k}" aria-pressed="${tipo === k}" class="${k}">${t}</button>`).join('')}</div>` : '';
    const extras = tipo === 'transf' ? '' : `<details class="mais-campos"${base.tags && base.tags.length || base.nota || base.ignorar || base.divisao || (base.coment && base.coment.length) ? ' open' : ''}><summary>Mais opções</summary><div class="mais-corpo">
        ${novo ? `${campo('Repetir', radios('rep', [['nao', 'Não repete'], ['parcelado', 'Parcelado'], ['fixo', 'Fixo todo mês']], 'nao'))}<div id="repn" class="rep-bloco" hidden><div id="freq-box">${campo('De quanto em quanto tempo', radios('freq', [['semana', 'Toda semana'], ['quinzena', 'A cada 15 dias'], ['mes', 'Todo mês'], ['ano', 'Todo ano']], 'mes'))}</div>${campo('<span id="n-rot">Quantas vezes no total (contando este)</span>', '<input name="n" type="number" min="2" max="120" value="12" inputmode="numeric">')}<p class="rep-resumo" id="rep-resumo" aria-live="polite"></p></div>` : ''}
        ${tipo === 'despesa' ? troca('boleto', 'É um boleto', !!base.boleto) : ''}
        ${tipo === 'despesa' ? campo('Dividir com (casal, sócios)', `<input name="dividir" maxlength="80" placeholder="Ex.: Ana, Beto ou Ana:40" value="${esc((base.divisao || []).map((x) => (x.pct !== undefined ? `${x.nome}:${x.pct}` : x.nome)).join(', '))}"><small class="mut">Você pagou tudo e eles devolvem a parte deles. Só o nome divide em partes iguais; <b>Ana:40</b> faz a Ana pagar 40%. Veja quem deve em Mais opções → Divisão de despesas.</small>`) : ''}
        ${campo('Etiquetas', `<input name="tags" maxlength="80" placeholder="Ex.: viagem, casal, projeto" value="${esc((base.tags || []).join(', '))}">`)}${troca('ignorar', 'Não contar nos relatórios', !!base.ignorar)}
        ${campo('Nota', `<textarea name="nota" maxlength="300">${esc(base.nota || '')}</textarea>`)}
        ${novo ? troca('modelo', 'Salvar como modelo (lançar de novo com um toque)', false) : `<div class="conversa"><b>Conversa</b>${(base.coment || []).map((c) => `<p class="coment"><b>${esc(c.por || '')}</b> <small class="mut">${esc(c.em || '')}</small><br>${esc(c.texto)}</p>`).join('') || '<p class="mut">Nenhum comentário ainda.</p>'}${campo('Novo comentário', '<input name="coment" maxlength="200" placeholder="Ex.: esse foi o presente da mamãe" autocomplete="off">')}</div>`}</div></details>`;
    abrir((novo ? 'Novo lançamento' : 'Editar ' + titulo.toLowerCase()), `
      ${abas}
      <div class="valor-box ${tipo}"><label for="v">Valor</label><div class="valor-lin"><span aria-hidden="true">R$</span><input id="v" name="valor" inputmode="decimal" required autocomplete="off" placeholder="0,00" value="${val2(base.valor)}"></div></div>
      ${base.serie ? (() => {
        const todos = d.lancs.filter((x) => x.serie === base.serie).sort((a, b) => a.data.localeCompare(b.data)); const aPartir = todos.filter((x) => x.data >= base.data);
        return `<div class="serie-aviso"><b>Este lançamento se repete.</b><p class="serie-res" id="serie-res" aria-live="polite"></p>${linhaTempo(todos, base.id, F.hojeISO())}
          ${campo('Quantas faltam, contando este', `<input name="restam" type="number" min="1" max="120" inputmode="numeric" value="${aPartir.length}" data-orig="${aPartir.length}"><small class="mut">Mude aqui se a conta termina antes (ou depois) do previsto. As que sobrarem além do número são apagadas.</small>`)}
          ${campo('Aplicar as outras mudanças a', radios('aplicar', [['este', 'Só este'], ['proximos', 'Este e os próximos'], ['todos', 'Todos da série']], 'este'))}</div>`;
      })() : ''}
      ${tipo === 'transf' ? '' : campo('Descrição', `<input name="desc" required maxlength="80" value="${esc(base.desc || '')}" placeholder="Ex.: Mercado, Aluguel, Venda de peças"${S.sugestoes !== false ? ' list="sug-desc" autocomplete="off"' : ''}>${S.sugestoes !== false ? `<datalist id="sug-desc">${[...new Set(d.lancs.filter((x) => x.tipo === tipo && x.desc).sort((a, b) => b.data.localeCompare(a.data)).map((x) => x.desc.replace(/ \(\d+\/\d+\)$/, '')))].slice(0, 40).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`)}
      <div class="campo"><span>Data</span><div class="data-lin"><input name="data" type="date" required value="${base.data || F.hojeISO()}"></div></div>
      ${F.ehCartao({ conta: contaSel }) && tipo === 'despesa' ? '' : troca('pago', rotPago, novo ? true : !!base.pago)}
      ${catsHtml}${contaHtml}
      ${extras}
      ${novo ? '<p class="mut">Depois de salvar, abra o lançamento para anexar a foto da nota ou do recibo.</p>' : '<div class="campo anexos-box"><span>Foto da nota ou do recibo</span><div id="anexos-lista" class="anexos" aria-live="polite"><small class="mut">Carregando…</small></div><label class="btn sec mini">Adicionar foto<input id="anexo-arq" type="file" accept="image/*" hidden></label></div>'}
      <div class="botoes rodape-form">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar lançamento</button></div>`,
    (fd) => {
      const valor = F.arred(F.numeroBR(fd.get('valor')));
      if (!(valor > 0)) { aviso('Informe um valor maior que zero.'); $('#v').focus(); return false; }
      const conta = fd.get('conta'); const cartao = F.ehCartao({ conta });
      if (tipo === 'transf' && conta === fd.get('destino')) { aviso('Escolha contas diferentes.'); return false; }
      const reg = tipo === 'transf'
        ? { tipo, desc: 'Transferência', data: fd.get('data'), categoria: 'Transferência', conta, destino: fd.get('destino'), pago: !!fd.get('pago'), boleto: false }
        : { tipo, desc: fd.get('desc').trim(), data: fd.get('data'), categoria: fd.get('categoria'), conta, boleto: !!fd.get('boleto') && !cartao, pago: !cartao && !!fd.get('pago'), nota: (fd.get('nota') || '').trim(), tags: [...new Set(String(fd.get('tags') || '').split(',').map((x) => x.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 5), ignorar: !!fd.get('ignorar') };
      const nomes = tipo === 'despesa' ? String(fd.get('dividir') || '').split(',') : [];
      if (novo && fd.get('modelo') && tipo !== 'transf') (d.modelos = d.modelos || []).push({ id: uid(), tipo, desc: reg.desc, valor, categoria: reg.categoria, conta: reg.conta, boleto: reg.boleto });
      if (novo) {
        const rep = fd.get('rep') || 'nao'; const n = rep === 'nao' ? 1 : Math.max(2, Math.min(120, parseInt(fd.get('n'), 10) || 2)); const freq = rep === 'parcelado' ? 'mes' : (fd.get('freq') || 'mes');
        const parte = rep === 'parcelado' ? F.arred(valor / n) : valor; const serie = n > 1 ? uid() : undefined;
        for (let i = 0; i < n; i++) {
          const v = rep === 'parcelado' && i === n - 1 ? F.arred(valor - parte * (n - 1)) : parte;
          d.lancs.push({ ...reg, ...(serie ? { serie, n: i + 1, de: n, modoSerie: rep, freq } : {}), id: uid(), por: String((USER.info && USER.info.nome) || '').split(' ')[0] || undefined, valor: v, divisao: F.dividir(nomes, v), desc: rep === 'parcelado' ? `${reg.desc} (${i + 1}/${n})` : reg.desc, data: dataSerie(reg.data, freq, i), pago: i === 0 ? reg.pago : false });
        }
      } else {
        const alvo = d.lancs.find((x) => x.id === base.id); const cmt = String(fd.get('coment') || '').trim();
        if (cmt && alvo) (alvo.coment = alvo.coment || []).push({ por: String((USER.info && USER.info.nome) || '').split(' ')[0], texto: cmt.slice(0, 200), em: F.hojeISO() });
        const aplicar = base.serie ? (fd.get('aplicar') || 'este') : 'este';
        const afetados = aplicar === 'este' ? [alvo] : d.lancs.filter((x) => x.serie === base.serie && (aplicar === 'todos' || x.data >= base.data));
        const semSufixo = (t) => String(t).replace(/ \(\d+\/\d+\)$/, '');
        const restamNovo = base.serie && fd.get('restam') ? Math.max(1, Math.min(120, parseInt(fd.get('restam'), 10) || 1)) : 0;
        afetados.forEach((x) => { const sufixo = (String(x.desc).match(/ \(\d+\/\d+\)$/) || [''])[0]; const eu = x === alvo; Object.assign(x, { ...reg, valor, desc: semSufixo(reg.desc) + sufixo, data: eu ? reg.data : x.data, pago: eu ? reg.pago : x.pago }); x.divisao = F.dividir(nomes, x.valor, x.divisao); });
        if (restamNovo) ajustarSerie(alvo, restamNovo, semSufixo);
      }
      V.mes = F.mesDe(reg.data); salvar(); render(); aviso('Lançamento salvo.');
    }, (f) => {
      const lerForm = () => ({ valor: f.valor.value, desc: f.desc ? f.desc.value : '', data: f.data.value, conta: base.conta && base.conta.startsWith('c:') ? base.conta : undefined });
      f.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.aba !== tipo) formLanc(lerForm(), b.dataset.aba); }));
      const nc = $('[data-nova-cat]', f); if (nc) nc.addEventListener('click', () => formCategoria(tipo, (nome) => formLanc({ ...lerForm(), categoria: nome }, modo)));
      if (!novo) montarAnexos(f, base.id);
      if (f.restam) {
        const res = () => { const n = Math.max(1, Math.min(120, parseInt(f.restam.value, 10) || 1)); const fr = base.freq || 'mes'; const fim = dataSerie(f.data.value || base.data, fr, n - 1); $('#serie-res', f).innerHTML = `Faltam <b>${n}</b> ${n === 1 ? 'vez' : 'vezes'}, contando esta. A última será em <b>${esc(MES_ANO(fim))}</b> (${new Date(fim + 'T12:00:00').toLocaleDateString('pt-BR')}).`; };
        ['restam', 'data'].forEach((k) => f[k].addEventListener('input', res)); res();
      }
      const exc = $('#exc', f); if (exc) exc.onclick = () => { if (base.serie) { excluirSerie(base); return; } soltarAnexos([base]); d.lancs = d.lancs.filter((x) => x.id !== base.id); salvar(); dlg.close(); render(); aviso('Lançamento excluído.'); };
      const resumo = () => {
        if (!f.rep) return; const v = f.rep.value; $('#repn', f).hidden = v === 'nao'; if (v === 'nao') return;
        const n = Math.max(2, Math.min(120, parseInt(f.n.value, 10) || 2)); const val = F.numeroBR(f.valor.value) || 0; const fr = v === 'parcelado' ? 'mes' : (f.freq ? f.freq.value : 'mes');
        const fmt = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR'); const ini = f.data.value || F.hojeISO(); const fim = dataSerie(ini, fr, n - 1);
        $('#freq-box', f).hidden = v === 'parcelado'; $('#n-rot', f).textContent = v === 'parcelado' ? 'Número de parcelas' : 'Quantas vezes no total (contando este)';
        $('#rep-resumo', f).textContent = v === 'parcelado' ? `Vai criar ${n} parcelas de ${F.brl(F.arred(val / n))} (total ${F.brl(val)}), ${ROT_FREQ[fr]}, de ${fmt(ini)} até ${fmt(fim)}.` : `Vai criar ${n} lançamentos de ${F.brl(val)}, ${ROT_FREQ[fr]}, de ${fmt(ini)} até ${fmt(fim)}.`;
      };
      f.querySelectorAll('input[name=rep]').forEach((r) => r.addEventListener('change', () => { const v = f.rep.value; if (v === 'fixo' && f.n.value === '2') f.n.value = '12'; if (v === 'parcelado' && f.n.value === '12') f.n.value = '2'; resumo(); }));
      f.querySelectorAll('input[name=freq]').forEach((r) => r.addEventListener('change', resumo));
      ['n', 'valor', 'data'].forEach((k) => f[k] && f[k].addEventListener('input', resumo));
      if (f.boleto && f.pago) f.boleto.addEventListener('change', () => { if (f.boleto.checked) f.pago.checked = false; });
      setTimeout(() => { if (novo) f.valor.focus(); }, 60);
    });
  }

  const EMOJIS = ['🏠', '💡', '💧', '🚰', '🚿', '🌊', '🔥', '🌐', '📶', '📱', '💻', '📺', '🔌', '🧾', '🏦', '🍔', '🍕', '🍽️', '☕', '🍺', '🛒', '🥖', '🍎', '🚗', '🚌', '⛽', '🚲', '✈️', '🚕', '🚇', '🛵', '💊', '🏥', '🦷', '🧴', '💇', '💅', '🏋️', '🧘', '👶', '🐶', '🐱', '🎁', '🧸', '🎓', '📚', '✏️', '🎮', '🎬', '🎵', '🎟️', '🏖️', '🎉', '⚽', '🎨', '💼', '💰', '💳', '📈', '🛠️', '📦', '📣', '🧹', '🧼', '🧺', '🪴', '🌱', '🐷', '🪙', '✂️', '🐟', '🐠', '🦐', '🪸'];
  function formCategoria(tipo, depois) {
    const d = D(); d.cats = d.cats || { despesa: [], receita: [] };
    abrir(`Nova categoria de ${tipo === 'receita' ? 'receita' : 'despesa'}`, `${campo('Nome', '<input name="nome" required maxlength="24" placeholder="Ex.: Pet, Academia, Presentes">')}
      ${campo('Ícone', radios('icone', EMOJIS.map((e) => [e, '', e]), EMOJIS[0], 'emojis'))}
      ${campo('Não achou? Digite ou cole qualquer emoji', '<input name="icone_outro" maxlength="8" placeholder="Ex.: 🌐" autocomplete="off">')}
      ${campo('Cor', radios('cor', CORES.map((x) => [x, '']), CORES[0], 'cores'))}
      <div class="botoes rodape-form"><button class="btn sec" type="button" id="cat-voltar">Voltar</button><button class="btn" type="submit">Salvar categoria</button></div>`,
    (fd) => {
      const nome = fd.get('nome').trim();
      if (!nome) { aviso('Dê um nome para a categoria.'); return false; }
      if (catsDe(tipo).some((c) => c.nome.toLowerCase() === nome.toLowerCase())) { aviso('Você já tem uma categoria com esse nome.'); return false; }
      const outro = String(fd.get('icone_outro') || '').trim(); const icone = outro ? ([...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(outro)][0] || { segment: fd.get('icone') }).segment : fd.get('icone');
      d.cats[tipo].push({ nome, icone, cor: fd.get('cor') });
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
  function excluirSerie(base) {
    const d = D();
    abrir('Excluir lançamento que se repete', `<p class="mut">Este lançamento faz parte de uma série (${base.n || '?'} de ${base.de || '?'}). O que você quer excluir?</p><div class="card linhas">${linha({ icone: LI.lixo, titulo: 'Só este', attrs: 'data-ex="este"' })}${linha({ icone: LI.lixo, titulo: 'Este e os próximos', attrs: 'data-ex="proximos"' })}${linha({ icone: LI.lixo, titulo: 'Todos da série', perigo: true, attrs: 'data-ex="todos"' })}</div>`, null, (f) => {
      f.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { const m = b.dataset.ex; soltarAnexos(d.lancs.filter((x) => x.id === base.id || (x.serie === base.serie && (m === 'todos' || (m === 'proximos' && x.data >= base.data))))); d.lancs = d.lancs.filter((x) => !(x.id === base.id || (x.serie === base.serie && (m === 'todos' || (m === 'proximos' && x.data >= base.data))))); salvar(); dlg.close(); render(); aviso('Excluído.'); }));
    });
  }
  function formCartao(c = {}) {
    const novo = !c.id;
    abrir(novo ? 'Novo cartão' : 'Editar cartão', `${campo('Nome do cartão', `<input name="nome" required maxlength="30" value="${esc(c.nome || '')}" placeholder="Ex.: Nubank, Itaú Empresa">`)}
      ${campo('Limite (R$)', `<input name="limite" required inputmode="decimal" value="${val2(c.limite)}" placeholder="0,00">`)}
      <p class="rep-resumo"><b>Como funciona:</b> você lança cada compra no cartão e o app monta a fatura sozinho. Compras até o <b>dia do fechamento</b> entram na fatura que vence neste mês; as feitas depois vão para a fatura do mês seguinte. Os dois dias estão no app do seu banco, na tela do cartão.</p>
      <div class="dupla">${campo('Dia do fechamento', `<input name="fechamento" type="number" min="1" max="31" required value="${c.fechamento || ''}" placeholder="Ex.: 5"><small class="mut">Dia em que a fatura fecha.</small>`)}${campo('Dia do vencimento', `<input name="vencimento" type="number" min="1" max="31" required value="${c.vencimento || ''}" placeholder="Ex.: 12"><small class="mut">Dia de pagar a fatura.</small>`)}</div>
      ${campo('Final do cartão (opcional)', `<input name="final" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" value="${esc(c.final || '')}" placeholder="4 últimos números"><small class="mut">Ajuda o app a achar o cartão certo nos avisos do banco.</small>`)}
      ${campo('Cor', radios('cor', CORES.map((x) => [x, '']), c.cor || CORES[d_cartoes() % CORES.length], 'cores').replace(/<span>/g, '<span>'))}
      <div class="botoes">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), limite: F.arred(F.numeroBR(fd.get('limite'))), fechamento: +fd.get('fechamento'), vencimento: +fd.get('vencimento'), cor: fd.get('cor'), final: String(fd.get('final') || '').replace(/\D/g, '').slice(0, 4) };
      if (!(reg.limite >= 0)) { aviso('Limite inválido.'); return false; }
      if (novo) { const n = { id: uid(), ...reg }; D().cartoes.push(n); V.cartao = n.id; V.fmes = null; } else Object.assign(D().cartoes.find((x) => x.id === c.id), reg);
      salvar(); render(); aviso('Cartão salvo.');
    }, (f) => {
      f.querySelectorAll('.cores span').forEach((s) => { s.style.background = s.previousElementSibling.value; });
      const exc = $('#exc', f); if (exc) exc.onclick = async () => { if (!(await confirmar('Excluir este cartão?', 'O cartão e todas as compras dele serão apagados. Não dá para desfazer.', 'Excluir'))) return; const d = D(); soltarAnexos(d.lancs.filter((l) => l.conta === 'c:' + c.id)); d.cartoes = d.cartoes.filter((x) => x.id !== c.id); d.lancs = d.lancs.filter((l) => l.conta !== 'c:' + c.id); V.cartao = null; salvar(); dlg.close(); render(); aviso('Cartão excluído.'); };
    });
  }
  const d_cartoes = () => D().cartoes.length;

  function formConta(c = {}) {
    const novo = !c.id;
    abrir(novo ? 'Novo banco ou carteira' : 'Editar banco ou carteira', `${campo('Nome', `<input name="nome" required maxlength="30" value="${esc(c.nome || '')}" placeholder="Ex.: Banco do Brasil, Caixa da loja">`)}
      ${campo('Tipo', radios('tipoConta', [['corrente', 'Conta corrente', '🏦'], ['poupanca', 'Poupança', '🐷'], ['carteira', 'Carteira', '👛'], ['vale', 'Vale-refeição', '🍽️'], ['investimento', 'Investimentos', '📈']], c.tipo || 'corrente'))}
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
      const exc = $('#exc', f); if (exc) exc.onclick = async () => { if (!(await confirmar('Excluir este banco ou carteira?', 'Os lançamentos dele também serão apagados. Não dá para desfazer.', 'Excluir'))) return; const d = D(); soltarAnexos(d.lancs.filter((l) => l.conta === c.id || l.destino === c.id)); d.contas = d.contas.filter((x) => x.id !== c.id); d.lancs = d.lancs.filter((l) => l.conta !== c.id && l.destino !== c.id); salvar(); dlg.close(); render(); aviso('Conta excluída.'); };
    });
  }

  function pagarFaturaRapido() {
    const d = D(); const abertas = F.faturas(d.lancs, d.cartoes).filter((f) => !f.paga && f.total > 0);
    if (!abertas.length) { aviso('Nenhuma fatura em aberto. 🎉'); return; }
    if (abertas.length === 1) { formPagarFatura(`${abertas[0].cartaoId}|${abertas[0].mes}`); return; }
    abrir('Qual fatura você quer pagar?', `<div class="card linhas">${abertas.map((f) => linha({ icone: '<span class="bolinha" style="background:#2D4BFF"></span>', titulo: esc(f.cartao), desc: `Vence ${DATA_CURTA(f.vencimento)}`, fim: `<span class="num">${m(f.total)}</span>`, attrs: `data-fat="${f.cartaoId}|${f.mes}"` })).join('')}</div>`, null, (fm) => {
      fm.querySelectorAll('[data-fat]').forEach((b) => b.addEventListener('click', () => formPagarFatura(b.dataset.fat)));
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
      ${campo('Quanto guardar por mês (opcional)', `<input name="mensal" inputmode="decimal" value="${val2(o.mensal)}" placeholder="Em branco: o app sugere pelo prazo"><small class="mut">Você acompanha, mês a mês, se está no caminho.</small>`)}
      <div class="botoes">${novo ? '' : '<button class="btn perigo" type="button" id="exc">Excluir</button>'}<button class="btn" type="submit">Salvar</button></div>`,
    (fd) => {
      const reg = { nome: fd.get('nome').trim(), meta: F.arred(F.numeroBR(fd.get('meta'))), guardado: F.arred(F.numeroBR(fd.get('guardado') || '0')), prazo: fd.get('prazo') || '', mensal: F.arred(F.numeroBR(fd.get('mensal') || '0')) || 0 };
      if (!(reg.meta > 0)) { aviso('Informe quanto precisa guardar.'); return false; }
      if (novo) d.objetivos.push({ id: uid(), ...reg }); else Object.assign(d.objetivos.find((x) => x.id === o.id), reg);
      salvar(); render(); aviso('Objetivo salvo.');
    }, (f) => { const exc = $('#exc', f); if (exc) exc.onclick = () => { d.objetivos = d.objetivos.filter((x) => x.id !== o.id); salvar(); dlg.close(); render(); }; });
  }
  function formAporte(o) {
    abrir('Guardar dinheiro', `<p class="mut">${esc(o.nome)}: ${F.brl(o.guardado)} de ${F.brl(o.meta)}</p>${campo('Quanto guardar agora (R$)', '<input name="v" inputmode="decimal" required placeholder="0,00">')}<button class="btn" type="submit">Guardar</button>`,
      (fd) => { const v = F.arred(F.numeroBR(fd.get('v'))); if (!(v > 0)) { aviso('Informe um valor.'); return false; } o.guardado = F.arred(o.guardado + v); (o.aportes = o.aportes || []).push({ data: F.hojeISO(), valor: v }); salvar(); render(); aviso(o.guardado >= o.meta ? 'Objetivo alcançado! 🎉' : 'Valor guardado.'); });
  }

  /* ---------- notificações dentro do app e configurações ---------- */
  function alertasApp() {
    const d = D(); const hoje = F.hojeISO(); const lista = [];
    F.aPagar(d.lancs, d.cartoes).filter((i) => i.atrasado || i.dias <= 3).slice(0, 8).forEach((i) => lista.push({ ic: i.atrasado ? '⚠️' : i.dias === 0 ? '⏰' : '🔔', t: `${esc(i.titulo)}: ${m(i.valor)} ${i.atrasado ? `venceu há ${-i.dias} ${i.dias === -1 ? 'dia' : 'dias'}` : i.dias === 0 ? 'vence hoje' : `vence em ${i.dias} ${i.dias === 1 ? 'dia' : 'dias'}`}`, a: 'ir-pagar' }));
    F.orcamentoMes(d.lancs, d.orcamentos, F.mesDe(hoje)).filter((o) => o.pct >= 80).forEach((o) => lista.push({ ic: '🎯', t: `Orçamento de ${esc(o.categoria)}: ${Math.round(o.pct)}% do limite do mês`, a: 'plano-orc' }));
    F.gastosAnormais(d.lancs, F.mesDe(hoje)).slice(0, 2).forEach((x) => lista.push({ ic: '📈', t: `${esc(x.categoria)} está ${String(x.vezes).replace('.', ',')}x acima da sua média`, a: 'ir-rel' }));
    const neg = F.projecaoSaldo(d.lancs, d.contas, d.cartoes, hoje, 3).find((x) => x.saldoFim < 0); if (neg) lista.push({ ic: '⚠️', t: `O saldo previsto fica negativo em ${esc(nomeMes(neg.mes))}`, a: 'projecao' });
    const rc = F.aReceber(d.lancs, hoje); if (rc.atrasado > 0) lista.push({ ic: '💰', t: `${m(rc.atrasado)} a receber em atraso`, a: 'receber' });
    if (V.rev && V.rev.length) lista.push({ ic: '🧾', t: `${V.rev.length} compra(s) do banco para revisar`, a: 'revisar' });
    return lista.filter((x) => !(S.dispensados || []).includes(x.t));
  }
  function formNotif() {
    const l = alertasApp(); const u = USER.info;
    abrir('Notificações', `${u.avisos ? '' : '<div class="card"><b>Os avisos por e-mail estão desligados.</b><p class="mut">Ligue para receber de manhã o que vence hoje, em breve ou já venceu.</p><button class="btn" type="button" data-liga>Ligar avisos por e-mail</button></div>'}
      ${l.length ? `<div class="botoes"><button class="btn sec" type="button" data-limpar>Limpar notificações</button></div><ul class="lista">${l.map((x, i) => `<li><button class="item" type="button" data-n="${i}"><span class="ic" aria-hidden="true">${x.ic}</span><span class="txt"><strong>${x.t}</strong></span><span aria-hidden="true">›</span></button></li>`).join('')}</ul>` : '<div class="card vazio"><span class="vazio-ic" aria-hidden="true">🔔</span><h2 class="secao">Nenhum aviso por enquanto :)</h2><p class="mut">Quando uma conta estiver perto de vencer ou um limite estourar, ele aparece aqui.</p></div>'}`, null, (f) => {
      f.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => { const a = l[+b.dataset.n].a; dlg.close(); ({ 'ir-pagar': () => { V.sub = 'apagar'; ir('lancs'); }, 'plano-orc': () => { V.plano = 'orc'; ir('planejar'); }, 'ir-rel': () => { V.plano = 'rel'; ir('planejar'); }, projecao: () => formProjecao(), receber: () => formReceber(), revisar: () => formRevisar() })[a](); }));
      const lp = f.querySelector('[data-limpar]'); if (lp) lp.addEventListener('click', () => { S.dispensados = [...(S.dispensados || []), ...l.map((x) => x.t)]; salvar(); atualizarSino(); formNotif(); aviso('Notificações limpas.'); });
      const lg = f.querySelector('[data-liga]'); if (lg) lg.addEventListener('click', async () => { try { const r = await api('preferencias', { avisos: true }); USER.info = r.usuario; dlg.close(); render(); aviso('Avisos por e-mail ligados.'); } catch (e) { aviso(e.message); } });
    });
  }
  function atualizarSino() { const b = $('.sino-n'); if (!b) return; const n = USER.logado ? alertasApp().length : 0; b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); }
  function formConfig() {
    abrir('Configurações', `<section><h3 class="grupo">Ordem dos lançamentos</h3>${radios('ordem', [['desc', 'Do mais recente para o mais antigo'], ['asc', 'Do mais antigo para o mais recente']], S.ordem === 'asc' ? 'asc' : 'desc')}</section>
      ${troca('saldoDiario', 'Mostrar o saldo de cada dia na lista de lançamentos', !!S.saldoDiario)}${troca('sugestoes', 'Sugestões ao digitar a descrição', S.sugestoes !== false)}
      <div class="card linhas">${linha({ icone: LI.texto, titulo: 'Cores, tamanho do texto e contraste', attrs: 'data-cf="acess"' })}${linha({ icone: LI.chave, titulo: 'Bloqueio com PIN', desc: PIN.ativo() ? 'Ligado neste aparelho' : 'Desligado', attrs: 'data-cf="pin"' })}${linha({ icone: LI.bell, titulo: 'Avisos por e-mail', desc: 'Em Meu perfil → Preferências', attrs: 'data-cf="perfil"' })}</div>`, null, (f) => {
      f.addEventListener('change', () => { S.ordem = f.ordem.value; S.saldoDiario = f.saldoDiario.checked; S.sugestoes = f.sugestoes.checked; salvar(); render(); });
      f.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => { const a = b.dataset.cf; dlg.close(); if (a === 'acess') formAcess(); else if (a === 'pin') formPin(); else ir('perfil'); }));
    });
  }

  /* ---------- etiquetas (tags), indicar, ajuda ---------- */
  function formTags() {
    const desenha = (f) => {
      const d = D(); const o = {};
      d.lancs.forEach((l) => (l.tags || []).forEach((t) => { const x = (o[t] = o[t] || { n: 0, total: 0 }); x.n += 1; if (l.tipo === 'despesa' && !l.ignorar) x.total = F.arred(x.total + l.valor); }));
      const nomes = Object.keys(o).sort((a, b) => o[b].n - o[a].n);
      f.querySelector('#tag-c').innerHTML = nomes.length ? `<ul class="lista">${nomes.map((t) => `<li><div class="item"><span class="txt"><strong>#${esc(t)}</strong><span>${o[t].n} ${o[t].n === 1 ? 'lançamento' : 'lançamentos'} · ${m(o[t].total)} em despesas</span></span><button class="btn sec mini" type="button" data-ren="${esc(t)}">Renomear</button><button class="btn sec mini" type="button" data-del="${esc(t)}" aria-label="Apagar a etiqueta ${esc(t)}">Apagar</button></div></li>`).join('')}</ul>` : '<p class="mut">Nenhuma etiqueta ainda. Ao lançar, abra <b>Mais opções</b> e escreva etiquetas como <i>viagem</i> ou <i>casal</i>. Depois veja quanto cada uma custou em Planejar → Relatórios.</p>';
      f.querySelectorAll('[data-ren]').forEach((b) => b.addEventListener('click', () => {
        const velho = b.dataset.ren; const novoNome = (window.prompt ? '' : '');
        const li = b.closest('.item'); const campoNovo = document.createElement('div');
        campoNovo.className = 'campo'; campoNovo.innerHTML = `<span>Novo nome de #${esc(velho)}</span><input maxlength="30" value="${esc(velho)}" aria-label="Novo nome da etiqueta"><button class="btn mini" type="button">Salvar</button>`;
        li.replaceWith(campoNovo); const inp = campoNovo.querySelector('input'); inp.focus(); inp.select();
        const ok = () => { const n = inp.value.trim().toLowerCase().replace(/^#/, ''); if (!n) { aviso('Digite um nome.'); return; } d_aplicar(velho, n); salvar(); desenha(f); aviso('Etiqueta renomeada.'); };
        campoNovo.querySelector('button').addEventListener('click', ok); inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } });
      }));
      f.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmar('Apagar a etiqueta?', `A etiqueta #${b.dataset.del} sai de todos os lançamentos. Os lançamentos continuam.`, 'Apagar'))) return; d_aplicar(b.dataset.del, null); salvar(); desenha(f); }));
    };
    const d_aplicar = (velho, novo) => D().lancs.forEach((l) => { if (!(l.tags || []).includes(velho)) return; l.tags = [...new Set(l.tags.map((t) => (t === velho ? novo : t)).filter(Boolean))]; });
    abrir('Etiquetas (tags)', '<div id="tag-c"></div>', null, desenha);
  }
  function formAjuda() {
    const fq = [
      ['Como lanço uma despesa rápido?', 'Toque em + e escreva uma frase, como "gastei 45 no mercado ontem". Você também pode tocar em Falar. O app preenche e você confere antes de salvar.'],
      ['Como funciona o cartão de crédito?', 'Cadastre o cartão com o dia de fechamento e de vencimento. Cada compra entra na fatura certa sozinha, e você paga a fatura quando ela vencer.'],
      ['Como o app avisa dos vencimentos?', 'Por e-mail, de manhã: vence hoje, vence em breve e atrasado. Você liga e desliga em Meu perfil.'],
      ['Posso usar com outra pessoa?', 'Sim. Em Mais opções → Compartilhar, convide uma pessoa por link. Vocês dois veem e editam os mesmos dados, cada um com a própria senha.'],
      ['Como o app lê os avisos do banco?', 'Em Mais opções → Conectar avisos do banco você pega uma chave e segue o passo a passo no celular. As compras viram lançamentos "para revisar", sem você dar a senha do banco.'],
      ['Meus dados estão seguros?', 'Os dados ficam cifrados no servidor, a senha é guardada de forma irreversível e você pode baixar ou apagar tudo quando quiser, em Meu perfil. Dá para ligar um PIN neste aparelho.'],
      ['Como importo o extrato do banco?', 'Em Mais opções → Importar extrato ou fatura, envie o arquivo OFX ou CSV do banco. Você revisa e escolhe o que entra.'],
    ];
    abrir('Central de ajuda', `${fq.map(([q, r]) => `<details class="mais-campos"><summary>${esc(q)}</summary><div class="mais-corpo"><p>${esc(r)}</p></div></details>`).join('')}
      <p class="mut">Não achou? Fale com a gente:</p><div class="botoes"><a class="btn sec" href="mailto:lepvi@lepvi.com.br">Enviar e-mail</a><a class="btn sec" target="_blank" rel="noopener" href="https://wa.me/5535910024730?text=${encodeURIComponent('Olá! Preciso de ajuda com o Lepvi Finanças.')}">Falar no WhatsApp</a></div>`, null);
  }
  async function indicarAmigo() {
    const dados = { title: 'Lepvi Finanças', text: 'Estou usando o Lepvi Finanças para controlar contas, cartões e vencimentos. Dá uma olhada:', url: location.origin + location.pathname };
    try { if (navigator.share) { await navigator.share(dados); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(dados.text + ' ' + dados.url), '_blank', 'noopener');
  }

  /* ---------- espaço compartilhado (duas pessoas, mesmos dados) ---------- */
  async function carregarEspaco() {
    try { V.esp = await api('espaco'); } catch (e) { V.esp = V.esp || { papel: 'sozinho', membros: [], dono: null, max: 1 }; }
    if (USER.logado && !dlg.open && ['inicio', 'lancs', 'mais'].includes(V.tela)) render();
  }
  async function aceitarConvite() {
    let t = null; try { t = localStorage.getItem(CONVITE); } catch (e) { /* sem armazenamento */ }
    if (!t || !USER.logado) return;
    try { localStorage.removeItem(CONVITE); } catch (e) { /* sem armazenamento */ }
    if (!(await confirmar('Entrar num espaço compartilhado?', 'Você vai ver e editar os mesmos lançamentos, contas e cartões da pessoa que convidou, e ela vai ver os seus lançamentos novos. O que você já tinha fica guardado e volta se você sair do espaço.', 'Entrar no espaço', false))) return;
    try { const r = await api('convite_aceitar', { token: t }); await carregarDados(); await carregarEspaco(); render(); aviso(`Pronto! Você entrou no espaço de ${r.dono}.`); } catch (e) { aviso(e.message); }
  }
  async function atualizarDoServidor() { // vê o que a outra pessoa lançou, sem precisar recarregar a página
    if (!USER.logado || enviando || precisaEnviar || dlg.open || !V.esp || V.esp.papel === 'sozinho' || document.hidden) return;
    try { const r = await api('dados'); if (r.versao !== versaoServidor && r.conteudo && r.conteudo.dados && !precisaEnviar && !enviando) { versaoServidor = r.versao; const n = norm({ perfil: S.perfil, dados: r.conteudo.dados }); S.dados = n.dados; baseDados = clonar(n.dados); if (!dlg.open) render(); } } catch (e) { /* tenta de novo no próximo ciclo */ }
  }
  setInterval(atualizarDoServidor, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarDoServidor(); });
  function formCompartilhar() {
    const e = V.esp || { papel: 'sozinho', membros: [] }; let link = '';
    const corpo = () => {
      if (e.papel === 'membro') return `<p>Você está no espaço de <b>${esc(e.dono.nome)}</b>. Vocês veem e editam os mesmos lançamentos, contas e cartões.</p><p class="mut">Ao sair, você volta aos seus dados de antes e deixa de ver os dela.</p><button class="btn sec" type="button" data-sair>Sair do espaço</button>`;
      const membros = e.membros.map((x) => `<div class="troca"><span><b>${esc(x.nome)}</b><br><small class="mut">${esc(x.email)}</small></span><button class="btn sec mini" type="button" data-rem="${esc(x.id)}">Remover</button></div>`).join('');
      const convite = !e.membros.length ? (link ? `<label class="campo"><span>Link do convite (vale 7 dias, uma pessoa só)</span><input readonly value="${esc(link)}" id="conv-link"></label><div class="botoes"><button class="btn" type="button" data-copiar>Copiar link</button><a class="btn sec" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Entra no nosso espaço do Lepvi Finanças: ' + link)}">Enviar pelo WhatsApp</a></div>` : '<button class="btn" type="button" data-convidar>Convidar uma pessoa</button>') : '';
      return `<p>Compartilhe com outra pessoa (cônjuge, sócio): vocês dois entram com o próprio e-mail e senha e veem os <b>mesmos</b> lançamentos, contas, cartões e metas, quase em tempo real.</p>${membros}${convite}<p class="mut">Cabem duas pessoas. Quem entra vê tudo, inclusive o que já foi lançado. Você pode remover a pessoa quando quiser. Se você excluir a sua conta, os dados compartilhados são apagados.</p>`;
    };
    const desenha = (f) => {
      f.querySelector('#comp-c').innerHTML = corpo();
      const q = (x) => f.querySelector(x);
      if (q('[data-convidar]')) q('[data-convidar]').addEventListener('click', async () => { try { const r = await api('convite_criar', {}); link = `${location.origin}${location.pathname}?convite=${r.token}`; desenha(f); } catch (er) { aviso(er.message); } });
      if (q('[data-copiar]')) q('[data-copiar]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); aviso('Link copiado.'); } catch (er) { q('#conv-link').select(); aviso('Selecione e copie o link.'); } });
      f.querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmar('Remover essa pessoa?', 'Ela deixa de ver e editar os seus dados. Os lançamentos continuam com você.', 'Remover'))) return; try { await api('espaco_remover', { id: b.dataset.rem }); await carregarEspaco(); Object.assign(e, V.esp); link = ''; desenha(f); } catch (er) { aviso(er.message); } }));
      if (q('[data-sair]')) q('[data-sair]').addEventListener('click', async () => { if (!(await confirmar('Sair do espaço?', 'Você volta aos seus dados de antes e deixa de ver os da outra pessoa.', 'Sair'))) return; try { await api('espaco_sair', {}); dlg.close(); await carregarDados(); await carregarEspaco(); render(); aviso('Você saiu do espaço.'); } catch (er) { aviso(er.message); } });
    };
    abrir('Compartilhar com outra pessoa', '<div id="comp-c"></div>', null, desenha);
  }

  /* ---------- mais ferramentas: a receber, projeção, reserva, dívidas, MEI, modelos ---------- */
  const nomeMes = (mes) => new Date(+mes.slice(0, 4), +mes.slice(5, 7) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  function formReceber() {
    const desenha = (f) => {
      const r = F.aReceber(D().lancs);
      f.querySelector('#rec-c').innerHTML = r.itens.length ? `<p>Falta receber <b class="num">${m(r.total)}</b>${r.atrasado ? `, sendo <b class="num neg">${m(r.atrasado)}</b> em atraso` : ''}.</p><ul class="lista">${r.itens.map((i) => `<li><div class="item"><span class="txt"><strong>${esc(i.titulo)}</strong><span>${i.atrasado ? `<span class="selo atraso">Atrasado ${-i.dias} ${i.dias === -1 ? 'dia' : 'dias'}</span> · ` : ''}${DIA_LONGO(i.vencimento)}</span></span><b class="val num">${m(i.valor)}</b><button class="btn sec mini" type="button" data-rec="${esc(i.id)}">Recebi</button></div></li>`).join('')}</ul>` : '<p class="mut">Nada a receber. Para controlar o que clientes ainda vão pagar, lance uma <b>receita</b> sem marcar "Já recebi".</p>';
      f.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', () => { const l = D().lancs.find((x) => x.id === b.dataset.rec); if (l) { l.pago = true; salvar(); render(); desenha(f); aviso('Marcado como recebido.'); } }));
    };
    abrir('Contas a receber', '<div id="rec-c"></div>', null, desenha);
  }
  function formProjecao() {
    const d = D(); const p = F.projecaoSaldo(d.lancs, d.contas, d.cartoes, F.hojeISO(), 6); const neg = p.find((x) => x.saldoFim < 0);
    abrir('Projeção de saldo', `<p class="mut">Com o que já está cadastrado (contas a pagar e receber, parcelas e faturas). Lançamentos que você ainda não fez não entram.</p>
      ${neg ? `<p class="rep-resumo" role="alert"><b>Atenção:</b> o saldo fica negativo em <b>${esc(nomeMes(neg.mes))}</b>. Dá tempo de ajustar.</p>` : '<p class="rep-resumo"><b>Tudo certo:</b> o saldo não fica negativo nos próximos 6 meses.</p>'}
      <div class="tabela-rolagem"><table class="tab"><thead><tr><th scope="col">Mês</th><th scope="col">Entra</th><th scope="col">Sai</th><th scope="col">Saldo no fim</th></tr></thead><tbody>${p.map((x) => `<tr><th scope="row">${esc(nomeMes(x.mes))}</th><td class="num pos">${m(x.entradas)}</td><td class="num neg">${m(x.saidas)}</td><td class="num ${x.saldoFim < 0 ? 'neg' : ''}"><b>${m(x.saldoFim)}</b></td></tr>`).join('')}</tbody></table></div>`, null);
  }
  function formCalcTrabalho() {
    abrir('13º e férias', `<p class="mut">Valores brutos, antes de INSS e Imposto de Renda.</p>
      ${campo('Salário mensal (R$)', '<input name="sal" inputmode="decimal" placeholder="3000,00">')}
      ${campo('Meses trabalhados no ano (para o 13º)', '<input name="mes" inputmode="numeric" value="12">')}
      ${campo('Dias de férias', '<input name="dias" inputmode="numeric" value="30">')}
      ${troca('vender', 'Vender 10 dias (abono)', false)}
      <div class="card" id="ct-res" role="status" aria-live="polite"></div>`, null, (f) => {
      const calc = () => {
        const sal = F.numeroBR(f.sal.value || '0') || 0; const alvo = $('#ct-res', f);
        if (sal <= 0) { alvo.innerHTML = '<small class="mut">Informe o salário para calcular.</small>'; return; }
        const dt = F.decimoTerceiro(sal, +f.mes.value || 0); const fe = F.ferias(sal, +f.dias.value || 0, f.vender.checked);
        alvo.innerHTML = `<b>13º salário: <span class="num">${F.brl(dt.total)}</span></b><br><small class="mut">1ª parcela (até 30/11): ${F.brl(dt.primeira)} · 2ª parcela (até 20/12): ${F.brl(dt.segunda)}</small>
          <hr><b>Férias: <span class="num">${F.brl(fe.total)}</span></b><br><small class="mut">${fe.gozo} dias: ${F.brl(fe.base)} + 1/3: ${F.brl(fe.terco)}${fe.abono ? ` + abono: ${F.brl(fe.abono)}` : ''}</small>`;
      };
      f.addEventListener('input', calc); f.addEventListener('change', calc); calc();
    });
  }
  function formDesempenho() {
    const d = D(); const r = F.desempenho(d.lancs, V.mes, F.hojeISO());
    const msg = { ótimo: 'Você guardou 20% ou mais da renda. 🎉', bom: 'Você guardou de 10% a 20% da renda.', atenção: 'Sobrou pouco. Veja onde dá para cortar.', 'no vermelho': 'Você gastou mais do que ganhou neste mês.' };
    abrir('Meu desempenho', r.taxa === null ? '<p class="mut">Ainda não há receitas neste mês para calcular. Lance suas entradas e volte aqui.</p>'
      : `<p class="mut">${esc(NOME_MES(V.mes))}</p><div class="card"><small>Quanto da renda sobrou</small><b class="num ${r.taxa < 0 ? 'neg' : 'pos'}" style="font-size:28px;display:block">${r.taxa}%</b><small>${msg[r.nota]}</small></div>
        <p>Entrou <b class="num">${F.brl(r.receitas)}</b>, saiu <b class="num">${F.brl(r.despesas)}</b>, ficou <b class="num">${F.brl(r.saldo)}</b>.</p>
        <p class="mut">Dias seguidos lançando: <b>${r.sequencia}</b>${r.sequencia >= 3 ? ' 🔥' : ''}</p>`, null);
  }
  function formReserva() {
    const d = D(); const r = F.reservaEmergencia(d.lancs, d.contas);
    abrir('Reserva de emergência', r.meses === null ? '<p class="mut">Ainda não há três meses de despesas para calcular a sua média. Continue lançando e volte aqui.</p>'
      : `<p>Você gasta em média <b class="num">${m(r.media)}</b> por mês. O que você tem hoje nos bancos e carteiras (${m(r.disponivel)}) cobre <b>${String(r.meses).replace('.', ',')} ${r.meses === 1 ? 'mês' : 'meses'}</b> sem nenhuma renda.</p>
        <div class="barra ${r.meses >= 6 ? 'ok' : r.meses >= 3 ? 'alerta' : 'estourou'}" role="img" aria-label="${r.meses} de 6 meses"><i style="width:${Math.min(100, (r.meses / 6) * 100)}%"></i></div>
        <p class="mut">${r.meses >= 6 ? 'Você já tem uma reserva de 6 meses, a meta mais comum. 🎉' : `A meta mais comum é 6 meses: ${m(r.meta)}. Faltam <b class="num">${m(r.falta)}</b>. Crie um objetivo em Planejar para guardar aos poucos.`}</p>`, null);
  }
  function formDividas() {
    abrir('Simulador de dívidas', `<p class="mut">Um por linha: <b>nome; quanto deve; juros ao mês (%); pagamento mínimo</b>. Mostra em quanto tempo você quita e quanto paga de juros em cada jeito de pagar.</p>
      ${campo('Suas dívidas', '<textarea name="lista" rows="5" placeholder="Cartão; 2000; 12; 100&#10;Loja; 500; 4; 50"></textarea>')}${campo('Quanto pode pagar a mais por mês (R$)', '<input name="extra" inputmode="decimal" placeholder="0,00" value="200">')}<div id="div-res" role="status" aria-live="polite"></div>`, null, (f) => {
      const calc = () => {
        const ds = f.lista.value.split('\n').map((l) => l.split(';').map((x) => x.trim())).filter((x) => x.length >= 3 && x[0]).map((x) => ({ nome: x[0], saldo: F.numeroBR(x[1]), juros: F.numeroBR(x[2]), minimo: x[3] ? F.numeroBR(x[3]) : 0 })).filter((x) => x.saldo > 0);
        const extra = F.numeroBR(f.extra.value || '0') || 0; const alvo = $('#div-res', f);
        if (!ds.length) { alvo.innerHTML = ''; return; }
        const cartao = (tit, r) => r.semSolucao ? `<div class="card"><b>${tit}</b><p class="neg">Com esse pagamento a dívida não diminui: os juros são maiores que o que você paga. Aumente o valor.</p></div>` : `<div class="card"><b>${tit}</b><p>Quita tudo em <b>${r.meses} ${r.meses === 1 ? 'mês' : 'meses'}</b>, pagando <b class="num">${m(r.jurosTotal)}</b> de juros.</p><small class="mut">Ordem: ${r.ordem.map((o) => `${esc(o.nome)} (mês ${o.mes})`).join(' → ')}</small></div>`;
        const av = F.simularDividas(ds, extra, 'avalanche'); const bo = F.simularDividas(ds, extra, 'bola');
        alvo.innerHTML = cartao('Maior juro primeiro (paga menos juros)', av) + cartao('Menor dívida primeiro (vitórias rápidas)', bo);
      };
      f.addEventListener('input', calc); calc();
    });
  }
  function formMei() {
    const d = D(); const cfg = d.mei = d.mei || { ativo: false, limite: 81000, das: 0 }; const ano = new Date().getFullYear();
    const desenha = (f) => {
      const r = F.limiteMei(d.lancs, ano, cfg.limite || 81000);
      f.querySelector('#mei-c').innerHTML = `<div class="card"><small class="mut">Faturamento de ${ano} (categorias Vendas e Serviços)</small><b class="num" style="font-size:22px;display:block">${m(r.faturamento)}</b><div class="barra ${r.pct >= 100 ? 'estourou' : r.pct >= 80 ? 'alerta' : 'ok'}" role="img" aria-label="${r.pct}% do limite"><i style="width:${Math.min(100, r.pct)}%"></i></div><small class="mut">${r.pct}% do limite de ${m(cfg.limite || 81000)}. ${r.estourou ? '<b class="neg">Você passou do limite.</b>' : `Restam ${m(r.restante)}.`}${r.vaiEstourar && !r.estourou ? ` <b class="neg">No ritmo de hoje você chega a ${m(r.projecao)} no ano.</b>` : ''}</small></div>`;
    };
    abrir('MEI: limite e imposto (DAS)', `<p class="mut">Para quem é Microempreendedor Individual. O app soma o que você recebeu em <b>Vendas</b> e <b>Serviços</b> no ano e avisa quando chega perto do limite. Confira o limite e o valor do DAS no portal do governo (Portal do Empreendedor).</p>
      ${troca('mei-ativo', 'Sou MEI: mostrar avisos no Início', !!cfg.ativo)}${campo('Limite anual de faturamento (R$)', `<input name="limite" inputmode="decimal" value="${val2(cfg.limite || 81000)}">`)}<div id="mei-c"></div>
      ${campo('Valor do DAS do mês (R$)', `<input name="das" inputmode="decimal" placeholder="0,00" value="${cfg.das ? val2(cfg.das) : ''}">`)}<button class="btn" type="button" data-das>Lembrar do DAS todo dia 20 (12 meses)</button><small class="mut">Cria 12 boletos de "DAS MEI" na categoria Impostos, que aparecem nos vencimentos e nos avisos por e-mail.</small>`, null, (f) => {
      desenha(f);
      f.addEventListener('input', () => { cfg.ativo = f['mei-ativo'].checked; const l = F.numeroBR(f.limite.value || '0'); if (l > 0) cfg.limite = l; cfg.das = F.numeroBR(f.das.value || '0') || 0; salvar(); desenha(f); });
      f.querySelector('[data-das]').addEventListener('click', () => {
        const v = F.numeroBR(f.das.value || '0'); if (!(v > 0)) { aviso('Digite o valor do DAS.'); return; }
        if (d.lancs.some((x) => x.desc === 'DAS MEI' && !x.pago && x.data >= F.hojeISO())) { aviso('Você já tem DAS futuros cadastrados.'); return; }
        const hoje = new Date(); const ini = hoje.getDate() <= 20 ? F.hojeISO(new Date(hoje.getFullYear(), hoje.getMonth(), 20)) : F.hojeISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 20)); const serie = uid();
        for (let i = 0; i < 12; i++) d.lancs.push({ id: uid(), tipo: 'despesa', desc: 'DAS MEI', valor: v, data: dataSerie(ini, 'mes', i), categoria: 'Impostos', conta: d.contas[0].id, pago: false, boleto: true, serie, n: i + 1, de: 12, modoSerie: 'fixo', freq: 'mes', por: String((USER.info && USER.info.nome) || '').split(' ')[0] || undefined });
        cfg.ativo = true; cfg.das = v; salvar(); render(); aviso('Pronto! 12 lembretes do DAS criados.');
      });
    });
  }
  function formModelos() {
    const desenha = (f) => {
      const mods = D().modelos || [];
      f.querySelector('#mod-c').innerHTML = mods.length ? `<ul class="lista">${mods.map((x) => `<li><div class="item"><span class="ic" style="background:${catInfo(x.categoria, x.tipo).cor}22" aria-hidden="true">${catInfo(x.categoria, x.tipo).icone}</span><span class="txt"><strong>${esc(x.desc)}</strong><span>${esc(x.categoria)}</span></span><b class="val num">${m(x.valor)}</b><button class="btn sec mini" type="button" data-del="${esc(x.id)}" aria-label="Apagar o modelo ${esc(x.desc)}">Apagar</button></div></li>`).join('')}</ul>` : '<p class="mut">Nenhum modelo ainda. Ao criar um lançamento, abra <b>Mais opções</b> e ligue <b>Salvar como modelo</b>. Depois é só tocar no modelo em <b>+</b> para lançar de novo.</p>';
      f.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { D().modelos = (D().modelos || []).filter((x) => x.id !== b.dataset.del); salvar(); desenha(f); }));
    };
    abrir('Modelos de lançamento', '<div id="mod-c"></div>', null, desenha);
  }

  /* ---------- ferramentas (como Mobills e Organizze) ---------- */
  function formAssinaturas() {
    const a = F.assinaturas(D().lancs); const mes = a.reduce((t, x) => t + x.valor, 0);
    abrir('Assinaturas', a.length ? `<p class="mut">O app achou ${a.length} ${a.length === 1 ? 'cobrança' : 'cobranças'} que se repetem todo mês. Somam <b class="num">${m(F.arred(mes))}</b> por mês, ou <b class="num">${m(F.arred(mes * 12))}</b> por ano. Vale rever se você ainda usa todas.</p>
      <ul class="lista">${a.map((x) => { const c = F.catInfo(x.categoria, 'despesa'); return `<li><div class="item"><span class="ic" style="background:${c.cor}22" aria-hidden="true">${c.icone}</span><span class="txt"><strong>${esc(x.desc)}</strong><span>${x.meses} meses · ${m(x.porAno)} por ano</span></span><b class="val num">${m(x.valor)}</b></div></li>`; }).join('')}</ul>`
      : '<p class="mut">Ainda não achei cobranças mensais repetidas. Elas aparecem aqui depois de três meses com o mesmo nome e valor parecido.</p>', null);
  }
  function formSimulador() {
    abrir('Simulador de juros e metas', `<p class="mut">Veja quanto o seu dinheiro vira guardando um valor todo mês. É uma conta de exemplo: o rendimento real muda.</p>
      ${campo('Já tenho (R$)', '<input name="ini" inputmode="decimal" placeholder="0,00">')}${campo('Guardo por mês (R$)', '<input name="apo" inputmode="decimal" placeholder="0,00">')}
      ${campo('Rendimento ao mês (%)', '<input name="tx" inputmode="decimal" value="0,8">')}${campo('Por quantos meses', '<input name="n" inputmode="numeric" value="24">')}
      <div class="card" id="sim-res" role="status" aria-live="polite"></div>`, null, (f) => {
      const calc = () => {
        const r = F.jurosCompostos(F.numeroBR(f.ini.value), F.numeroBR(f.apo.value), F.numeroBR(f.tx.value), f.n.value);
        $('#sim-res', f).innerHTML = `<small class="mut">Você teria</small><b class="num pos" style="font-size:24px;display:block">${F.brl(r.total)}</b><small class="mut">Guardado por você: ${F.brl(r.aportado)} · Rendimento: ${F.brl(r.juros)}</small>`;
      };
      f.addEventListener('input', calc); calc();
    });
  }
  function formDesafio() {
    const salvo = D().desafio || { base: 5, feitas: [] }; const feitas = new Set(salvo.feitas);
    const desenha = (f) => {
      const d = F.desafio52(salvo.base); const guardado = F.arred(d.semanas.filter((s) => feitas.has(s.n)).reduce((t, s) => t + s.valor, 0));
      $('#des-res', f).innerHTML = `<small class="mut">Meta do ano: ${F.brl(d.total)}</small><b class="num pos" style="font-size:22px;display:block">${F.brl(guardado)} guardados</b><small class="mut">${feitas.size} de 52 semanas feitas</small>`;
      $('#des-sem', f).innerHTML = d.semanas.map((s) => `<button type="button" class="chip${feitas.has(s.n) ? ' on' : ''}" data-sem="${s.n}" aria-pressed="${feitas.has(s.n)}" aria-label="Semana ${s.n}, ${F.brl(s.valor)}">Semana ${s.n}<br><b class="num">${F.brl(s.valor)}</b></button>`).join('');
    };
    abrir('Desafio das 52 semanas', `<p class="mut">Na semana 1 você guarda o valor base, na semana 2 guarda o dobro, e assim até a 52. Toque na semana para marcar como feita.</p>
      ${campo('Valor base (R$)', `<input name="base" inputmode="decimal" value="${String(salvo.base).replace('.', ',')}">`)}<div class="card" id="des-res" role="status" aria-live="polite"></div><div id="des-sem" class="chips"></div>`, null, (f) => {
      desenha(f);
      f.base.addEventListener('input', () => { const v = F.numeroBR(f.base.value); if (v > 0) { salvo.base = v; D().desafio = salvo; salvar(); desenha(f); } });
      $('#des-sem', f).addEventListener('click', (ev) => { const b = ev.target.closest('[data-sem]'); if (!b) return; const n = +b.dataset.sem; if (feitas.has(n)) feitas.delete(n); else feitas.add(n); salvo.feitas = [...feitas]; D().desafio = salvo; salvar(); desenha(f); });
    });
  }

  /* ---------- bloqueio com PIN (só neste aparelho; o PIN nunca vai para o servidor) ---------- */
  const PIN = (() => {
    const K = 'lepvi-financas-pin'; let falhas = 0; let saiu = 0;
    const ler = () => { try { return JSON.parse(localStorage.getItem(K)); } catch (e) { return null; } };
    const hash = async (pin, sal) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sal + ':' + pin)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return {
      ativo: () => !!ler(),
      async definir(pin) { const sal = Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem(K, JSON.stringify({ sal, h: await hash(pin, sal) })); return true; } catch (e) { return false; } },
      remover: () => { try { localStorage.removeItem(K); } catch (e) { /* sem armazenamento */ } },
      async conferir(pin) { const p = ler(); if (!p) return true; if (await hash(pin, p.sal) === p.h) { falhas = 0; return true; } falhas += 1; return false; },
      falhas: () => falhas,
      marcarSaida: () => { saiu = Date.now(); }, ausenteHa: () => (saiu ? Date.now() - saiu : 0),
    };
  })();
  function travar() {
    if (!PIN.ativo() || !USER.logado || document.getElementById('trava')) return;
    const t = document.createElement('div'); t.id = 'trava'; t.setAttribute('role', 'dialog'); t.setAttribute('aria-modal', 'true'); t.setAttribute('aria-labelledby', 'trava-t');
    t.innerHTML = `<form class="trava-c"><h2 id="trava-t">App bloqueado 🔒</h2><p class="mut">Digite o seu PIN para continuar.</p><label class="campo"><span>PIN</span><input name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" required></label><p id="trava-e" class="erro" role="alert"></p><div class="botoes"><button class="btn" type="submit">Desbloquear</button><button class="link" type="button" data-esqueci>Esqueci o PIN (sair da conta)</button></div></form>`;
    document.body.appendChild(t); t.querySelector('input').focus();
    t.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = ev.target;
      if (await PIN.conferir(f.pin.value)) { t.remove(); return; }
      f.pin.value = ''; $('#trava-e', t).textContent = PIN.falhas() >= 5 ? 'PIN errado várias vezes. Use "Esqueci o PIN" para entrar de novo com a senha.' : 'PIN errado. Tente de novo.'; f.pin.focus();
    });
    t.querySelector('[data-esqueci]').addEventListener('click', () => { PIN.remover(); t.remove(); sair(); });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) PIN.marcarSaida(); else if (PIN.ausenteHa() > 60000) travar(); });
  function formPin() {
    const on = PIN.ativo();
    abrir('Bloqueio com PIN', on ? `<p class="mut">O bloqueio está ligado neste aparelho. O app pede o PIN quando você volta depois de 1 minuto fora.</p><button class="btn sec" type="button" data-troca>Trocar o PIN</button><button class="btn sec" type="button" data-tirar>Desligar o bloqueio</button>`
      : `<p class="mut">Crie um PIN de 4 a 8 números. O app pede o PIN ao abrir e quando você volta depois de 1 minuto fora. O PIN fica só neste aparelho.</p>${campo('Novo PIN', '<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" required autocomplete="off">')}<button class="btn" type="submit">Ligar o bloqueio</button>`,
    on ? null : async (fd) => { const v = String(fd.get('pin') || ''); if (!/^\d{4,8}$/.test(v)) { aviso('Use de 4 a 8 números.'); return false; } if (await PIN.definir(v)) { aviso('Bloqueio ligado.'); render(); } else aviso('Este aparelho não deixou guardar o PIN.'); },
    (f) => { const t = f.querySelector('[data-tirar]'); if (t) t.addEventListener('click', () => { PIN.remover(); dlg.close(); aviso('Bloqueio desligado.'); render(); }); const c = f.querySelector('[data-troca]'); if (c) c.addEventListener('click', () => { PIN.remover(); dlg.close(); formPin(); }); });
  }

  function formPersonalizar() {
    const blocos = [['alertas', 'Fique de olho (avisos)'], ['diario', 'Quanto posso gastar por dia'], ['pagar', 'Vencimentos'], ['orcamento', 'Atenção no orçamento'], ['categorias', 'Despesas por categoria'], ['cartoes', 'Cartões'], ['ultimos', 'Últimos lançamentos']];
    S.inicio = S.inicio || {};
    abrir('Personalizar tela inicial', `<p class="mut">Escolha o que você quer ver no Início. O saldo e o resumo do mês sempre aparecem.</p>${blocos.map(([k, t]) => troca('b-' + k, t, S.inicio[k] !== false)).join('')}`, null, (f) => {
      f.addEventListener('change', () => { blocos.forEach(([k]) => { S.inicio[k] = f['b-' + k].checked; }); salvar(); render(); });
    });
  }
  /* ---------- verificação em dois passos (app autenticador) ---------- */
  function copiarTexto(txt) { return navigator.clipboard.writeText(txt).then(() => aviso('Copiado.')).catch(() => aviso('Selecione e copie manualmente.')); }
  function d2Reservas(lista) {
    abrir('Guarde seus códigos de reserva', `<p class="mut">Se perder o celular, cada código abaixo entra <b>uma vez</b> no lugar do código do app. Eles <b>não aparecem de novo</b>: guarde num lugar seguro (gerenciador de senhas ou papel).</p>
      <div class="card"><div class="d2-reservas" id="d2-lista">${lista.map((c) => `<code>${esc(c)}</code>`).join('')}</div></div>
      <div class="botoes rodape-form"><button class="btn sec" type="button" id="d2-copiar">Copiar todos</button><button class="btn" type="submit">Guardei os códigos</button></div>`, () => { render(); aviso('Verificação em dois passos ativada.'); }, (f) => {
      $('#d2-copiar', f).onclick = () => copiarTexto(lista.join('\n'));
    });
  }
  function d2Chave(r) {
    abrir('Adicionar no app autenticador', `<ol class="cap-ol"><li>No celular, abra o app autenticador e toque em <b>+</b> (Adicionar conta) → <b>Ler QR code</b>.</li><li>Aponte a câmera para o QR code abaixo. Sem câmera à mão? Use a chave escrita (tipo: baseada em tempo).</li><li>Digite aqui o código de 6 dígitos que o app mostrar.</li></ol>
      <div class="d2-qr" id="d2-qr" role="img" aria-label="QR code para adicionar no app autenticador"></div>
      <section class="card cap-passo"><h3>Sua chave</h3><p class="d2-chave" id="d2-seg">${esc(r.segredo.match(/.{1,4}/g).join(' '))}</p><div class="botoes"><button class="btn sec mini" type="button" id="d2-cp">Copiar chave</button><a class="btn sec mini" href="${esc(r.uri)}">Abrir no app autenticador (celular)</a></div></section>
      <label class="campo"><span>Código de 6 dígitos</span><input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>
      <div class="botoes rodape-form"><button class="btn" type="submit">Ativar</button></div>`, (fd) => {
      const bt = dlg.querySelector('button[type="submit"]'); bt.disabled = true;
      api('totp_ativar', { codigo: fd.get('codigo') }).then((r2) => { USER.info = r2.usuario; d2Reservas(r2.reservas); }).catch((e) => { aviso(e.message); bt.disabled = false; });
      return false;
    }, (f) => {
      $('#d2-cp', f).onclick = () => copiarTexto(r.segredo);
      try { const qr = qrcode(0, 'M'); qr.addData(r.uri); qr.make(); $('#d2-qr', f).innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { $('#d2-qr', f).remove(); }
    });
  }
  function formDoisPassos() {
    const u = USER.info;
    if (!u.dois_passos) {
      abrir('Verificação em dois passos', `<p class="mut">Mesmo que alguém descubra sua senha, não consegue entrar sem o código do seu celular. Leva uns 2 minutos.</p>
        <ol class="cap-ol"><li>Instale um app autenticador (Google Authenticator, Microsoft Authenticator, Authy ou 1Password).</li><li>Toque em <b>Começar</b> e adicione a chave no app.</li><li>Digite o código de 6 dígitos que o app mostrar e guarde os códigos de reserva.</li></ol>
        <div class="botoes rodape-form"><button class="btn" type="button" id="d2-comecar">Começar</button></div>`, null, (f) => {
        $('#d2-comecar', f).onclick = async () => { try { d2Chave(await api('totp_iniciar', {})); } catch (e) { aviso(e.message); } };
      });
      return;
    }
    abrir('Verificação em dois passos', `<p class="of-selo on">● Ativada</p><p class="mut">Ao entrar, o app pede a senha e depois o código do app autenticador. Para mudar algo, confirme a senha e um código atual (do app ou de reserva).</p>
      <section class="card cap-passo"><label class="campo"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
      <label class="campo"><span>Código</span><input name="codigo" autocomplete="one-time-code" maxlength="12" required></label>
      <div class="botoes rodape-form"><button class="btn sec" type="button" id="d2-novos">Gerar novos códigos de reserva</button><button class="btn perigo" type="button" id="d2-off">Desativar</button></div></section>`, null, (f) => {
      const dados = () => ({ senha: f.senha.value, codigo: f.codigo.value });
      const ok = () => { const d = dados(); if (!d.senha || !d.codigo) { aviso('Informe a senha e o código.'); return null; } return d; };
      $('#d2-novos', f).onclick = async () => { const d = ok(); if (!d) return; try { const r = await api('totp_gerenciar', { ...d, acao: 'novos' }); d2Reservas(r.reservas); } catch (e) { aviso(e.message); } };
      $('#d2-off', f).onclick = async () => {
        const d = ok(); if (!d) return;
        if (!(await confirmar('Desativar os dois passos?', 'Sua conta volta a entrar só com e-mail e senha, o que é menos seguro.', 'Desativar'))) return;
        try { const r = await api('totp_gerenciar', { ...d, acao: 'desativar' }); USER.info = r.usuario; dlg.close(); render(); aviso('Dois passos desativados.'); } catch (e) { aviso(e.message); }
      };
    });
  }
  /* ---------- atalhos e inteligências: busca de funções (botão da lupa ou Ctrl/Cmd + K) ---------- */
  const ATALHOS = [
    ['Inteligências', 'Para revisar', 'Compras do banco viram lançamento depois do seu OK', 'data-acao="revisar"', 'compras automaticas aviso banco pix cartao revisar'],
    ['Inteligências', 'Bancos conectados (Open Finance)', 'Importa as movimentações do banco sozinho', 'data-acao="openfinance"', 'open finance pluggy banco conectar extrato automatico'],
    ['Inteligências', 'Projeção de saldo', 'Como ficam os próximos 6 meses', 'data-acao="projecao"', 'previsao futuro saldo negativo meses'],
    ['Inteligências', 'Assinaturas', 'Cobranças que se repetem todo mês', 'data-acao="assinaturas"', 'recorrente mensal streaming'],
    ['Inteligências', 'Reserva de emergência', 'Quantos meses você aguenta sem renda', 'data-acao="reserva"', 'poupanca emergencia'],
    ['Inteligências', 'Meu desempenho', 'Quanto da renda sobrou e dias seguidos lançando', 'data-acao="desempenho"', 'desempenho taxa poupanca sobrou sequencia'],
    ['Inteligências', '13º e férias', 'Quanto você recebe, antes dos descontos', 'data-acao="calc-trabalho"', 'decimo terceiro 13 ferias abono calculadora salario'],
    ['Inteligências', 'Simulador de dívidas', 'Qual dívida pagar primeiro', 'data-acao="dividas"', 'divida juros quitar'],
    ['Inteligências', 'Simulador de juros e metas', 'Quanto vira se guardar todo mês', 'data-acao="simulador"', 'investir guardar juros compostos meta'],
    ['Inteligências', 'MEI: limite e DAS', 'Faturamento do ano e lembrete do imposto', 'data-acao="mei"', 'mei das imposto faturamento limite'],
    ['Inteligências', 'Contas a receber', 'Clientes que ainda vão pagar', 'data-acao="receber"', 'cliente receber cobranca'],
    ['Atalhos', 'Novo gasto', 'Lançar uma despesa', 'data-acao="rap-despesa"', 'despesa gasto lancar adicionar'],
    ['Atalhos', 'Nova entrada', 'Lançar uma receita', 'data-acao="rap-receita"', 'receita entrada salario ganho'],
    ['Atalhos', 'Transferência', 'Entre suas contas', 'data-acao="rap-transf"', 'transferir mover dinheiro'],
    ['Atalhos', 'Pagar fatura do cartão', '', 'data-acao="rap-fatura"', 'fatura cartao pagar'],
    ['Atalhos', 'Novo boleto', '', 'data-acao="novo-boleto"', 'boleto conta a pagar'],
    ['Atalhos', 'Início', '', 'data-tela="inicio"', 'resumo painel home'],
    ['Atalhos', 'Lançamentos', '', 'data-tela="lancs"', 'extrato lista movimentos'],
    ['Atalhos', 'Cartões', 'Faturas mês a mês', 'data-tela="cartoes"', 'cartao credito fatura'],
    ['Atalhos', 'Planejar: orçamento, objetivos e relatórios', '', 'data-tela="planejar"', 'orcamento objetivo meta relatorio'],
    ['Atalhos', 'Categorias', 'Crie as suas, com ícone e cor', 'data-acao="categorias"', 'categoria etiqueta cor'],
    ['Atalhos', 'Modelos de lançamento', '', 'data-acao="modelos"', 'modelo repetir salvo'],
    ['Atalhos', 'Compartilhar com outra pessoa', 'Cônjuge ou sócio', 'data-acao="compartilhar"', 'conjuge socio convite espaco'],
    ['Atalhos', 'Cópia de segurança', 'Baixar seus lançamentos', 'data-acao="backup"', 'backup exportar baixar'],
    ['Atalhos', 'Bloqueio com PIN', '', 'data-acao="pin"', 'pin senha bloqueio travar'],
    ['Atalhos', 'Tamanho do texto e contraste', '', 'data-acao="acess"', 'acessibilidade fonte letra escuro'],
    ['Conta e segurança', 'Alterar senha', '', 'data-acao="senha"', 'trocar senha seguranca'],
    ['Conta e segurança', 'Verificação em dois passos', 'Código do celular ao entrar', 'data-acao="dois-passos"', '2fa autenticador qr codigo seguranca'],
    ['Conta e segurança', 'Meu perfil', 'Foto, nome e dados', 'data-acao="perfil"', 'foto nome conta'],
    ['Conta e segurança', 'Central de ajuda e contato', '', 'data-acao="ajuda"', 'ajuda suporte whatsapp duvida'],
    ['Conta e segurança', 'Indicar a um amigo', '', 'data-acao="indicar"', 'indicar convidar amigo'],
    ['Conta e segurança', 'Sair', '', 'data-acao="sair"', 'logout encerrar']
  ];
  const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function formBusca() {
    abrir('Atalhos e inteligências', `<label class="campo"><span>O que você procura?</span><input id="bq" type="search" autocomplete="off" placeholder="Ex.: senha, fatura, projeção, MEI"></label><div id="bl"></div>`, null, (f) => {
      const caixa = $('#bq', f); const lista = $('#bl', f);
      const desenhar = () => {
        const q = semAcento(caixa.value).split(/\s+/).filter(Boolean);
        const ach = ATALHOS.filter((x) => q.every((p) => semAcento(x[1] + ' ' + x[2] + ' ' + x[4]).includes(p)));
        const grupos = ['Inteligências', 'Atalhos', 'Conta e segurança'].map((g) => [g, ach.filter((x) => x[0] === g)]).filter((x) => x[1].length);
        lista.innerHTML = grupos.length ? grupos.map(([g, it]) => grupoHtml(g, it.map((x) => linha({ icone: g === 'Inteligências' ? LI.brilho : g === 'Atalhos' ? LI.mais : LI.escudo, titulo: esc(x[1]), desc: esc(x[2]), attrs: x[3] })).join(''))).join('') : '<p class="mut" role="status">Nada encontrado. Tente outra palavra.</p>';
      };
      caixa.addEventListener('input', desenhar);
      lista.addEventListener('click', (ev) => { if (ev.target.closest('[data-acao],[data-tela]')) dlg.close(); });
      desenhar(); caixa.focus();
    });
  }
  document.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k' && USER.logado) { ev.preventDefault(); if (!dlg.open) formBusca(); } });
  function formSenha() {
    abrir('Alterar senha', `${campoSenha('Senha atual', 'name="atual" type="password" required autocomplete="current-password"')}${campoSenha('Nova senha (mínimo 10 caracteres)', 'name="nova" type="password" required minlength="10" autocomplete="new-password"')}<div class="botoes"><button class="btn" type="submit">Salvar nova senha</button></div>
      <p class="mut" style="margin-top:14px">Entrou com Google ou Microsoft, ou não lembra a senha atual?<br><button class="link" type="button" data-senha-link>Enviar um link para o meu e-mail</button></p>`, null, (f) => {
      f.querySelector('[data-senha-link]').addEventListener('click', async (ev) => { ev.target.disabled = true; try { const r = await api('senha_link', {}); ev.target.closest('p').innerHTML = `✅ Enviamos o link para <b>${esc(r.email)}</b>. Abra o e-mail e crie a nova senha (vale por 1 hora).`; } catch (e) { aviso(e.message); ev.target.disabled = false; } });
      f.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('mudar_senha', { atual: f.atual.value, nova: f.nova.value }); dlg.close(); aviso('Senha alterada. Enviamos um e-mail de confirmação.'); } catch (e) { aviso(e.message); } });
    });
  }
  function formExcluirConta() {
    abrir('Excluir meu cadastro', `<p>Isso apaga o seu cadastro e <b>todos</b> os seus dados financeiros do servidor, de forma definitiva. Não dá para desfazer. Antes, se quiser, baixe uma cópia em "Baixar meus dados".</p>${campoSenha('Digite sua senha para confirmar', 'name="senha" type="password" required autocomplete="current-password"')}<div class="botoes"><button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn perigo" type="submit">Excluir para sempre</button></div>`, null, (f) => {
      f.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('excluir', { senha: f.senha.value }); dlg.close(); USER.logado = false; limparMemoria(); V.auth = 'entrar'; V.msg = 'Seu cadastro e todos os seus dados foram apagados.'; await carregarTurnstile(); render(); } catch (e) { aviso(e.message); } });
    });
  }

  function importar(texto, nome) {
    const lista = (/\.csv$|\.txt$/i.test(nome) ? F.lerCSV(texto) : F.lerOFX(texto)).slice(0, 400);
    if (!lista.length) { aviso('Não encontrei lançamentos nesse arquivo.'); return; }
    const d = D(); const contas = d.contas.map((c) => [c.id, c.nome]).concat(d.cartoes.map((c) => ['c:' + c.id, '💳 ' + c.nome]));
    const opcCat = (tipo, sel) => catsDe(tipo).filter((c) => c.nome !== 'Cartão').map((c) => `<option value="${esc(c.nome)}" ${c.nome === sel ? 'selected' : ''}>${esc(c.icone)} ${esc(c.nome)}</option>`).join('');
    const linhas = lista.map((l, i) => { const sug = F.sugerirCategoria(l.desc, l.tipo, d.lancs); return `<div class="imp-lin"><label class="imp-sel"><input type="checkbox" name="sel-${i}" checked aria-label="Importar ${esc(l.desc)}"><span class="imp-d"><b>${esc(l.desc)}</b><small>${DATA_CURTA(l.data)} · <span class="num ${l.tipo === 'receita' ? 'pos' : 'neg'}">${l.tipo === 'receita' ? '+' : '−'} ${F.brl(l.valor)}</span></small></span></label><select name="cat-${i}" aria-label="Categoria de ${esc(l.desc)}">${opcCat(l.tipo, sug)}</select></div>`; }).join('');
    abrir(`Importar ${lista.length} lançamentos`, `<p class="mut">Revise antes de importar. Sugerimos a categoria pelo seu histórico e por palavras comuns (mercado, posto, farmácia…). Desmarque o que não quiser. Itens repetidos são ignorados.</p>
      ${campo('Importar para', radios('conta', contas, contas[0][0]))}
      ${troca('inverter', 'Neste arquivo as compras do cartão aparecem como valores positivos', false)}
      <div class="card linhas imp-lista">${linhas}</div>
      <div class="botoes rodape-form"><button class="btn sec" type="button" data-fechar>Cancelar</button><button class="btn" type="submit">Importar selecionados</button></div>`,
    (fd) => {
      const conta = fd.get('conta'); const cartao = F.ehCartao({ conta }); const inverter = !!fd.get('inverter');
      const chave = (l) => `${l.data}|${l.valor}|${l.desc}|${l.conta}`; const ja = new Set(d.lancs.map(chave)); let n = 0; let ignorados = 0;
      lista.forEach((l, i) => {
        if (!fd.get('sel-' + i)) return;
        const tipo = inverter ? (l.tipo === 'receita' ? 'despesa' : 'receita') : l.tipo;
        if (cartao && tipo === 'receita') return;
        const x = { ...l, tipo, id: uid(), conta, boleto: false, pago: !cartao, categoria: fd.get('cat-' + i) || 'Outros' };
        if (ja.has(chave(x))) { ignorados++; return; }
        ja.add(chave(x)); d.lancs.push(x); n++;
      });
      salvar(); render(); aviso(`${n} lançamentos importados${ignorados ? ` (${ignorados} repetidos ignorados)` : ''}.`);
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
    mesclarEmpresa(S); S.guia = true; V.cartao = null; V.fmes = null; salvar(); render(); aviso('Dados de exemplo carregados.');
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
      busca: () => formBusca(),
      compartilhar: () => formCompartilhar(),
      notif: () => formNotif(),
      config: () => formConfig(),
      tags: () => formTags(),
      ajuda: () => formAjuda(),
      indicar: () => indicarAmigo(),
      'ver-guia': () => { S.guia = false; salvar(); ir('inicio'); },
      'ir-contas': () => ir('mais'),
      receber: () => formReceber(),
      projecao: () => formProjecao(),
      reserva: () => formReserva(),
      'calc-trabalho': () => formCalcTrabalho(),
      desempenho: () => formDesempenho(),
      dividas: () => formDividas(),
      mei: () => formMei(),
      modelos: () => formModelos(),
      assinaturas: () => formAssinaturas(),
      simulador: () => formSimulador(),
      desafio: () => formDesafio(),
      pin: () => formPin(),
      revisar: () => formRevisar(),
      divisoes: () => formDivisoes(),
      'captura-config': () => formCaptura(),
      openfinance: () => formOpenFinance(),
      sair: () => sair(),
      'conta-menu': () => menuConta(),
      perfil: () => ir('perfil'),
      'trocar-foto': () => $('#foto-arq').click(),
      'remover-foto': async () => { try { const r = await api('preferencias', { foto: null }); USER.info = r.usuario; render(); aviso('Foto removida.'); } catch (e) { aviso(e.message); } },
      senha: () => formSenha(),
      'dois-passos': () => formDoisPassos(),
      'corrigir-saldo': () => formCorrigirSaldo(),
      personalizar: () => formPersonalizar(),
      categorias: () => formCategorias(),
      oauth: () => { try { sessionStorage.setItem(IDA_OAUTH, '1'); } catch (e) { /* sem armazenamento */ } window.location.href = 'api/oauth.php?a=iniciar&p=' + encodeURIComponent(t.dataset.p); },
      'excluir-conta': () => formExcluirConta(),
      'auth-entrar': () => { V.auth = 'entrar'; V.msg = ''; render(); },
      'auth-esqueci': () => { V.auth = 'esqueci'; V.msg = ''; render(); },
      'auth-cadastro': () => { V.auth = 'cadastro'; V.msg = ''; render(); },
      olho: () => { S.oculto = !S.oculto; salvar(); render(); },
      mais: () => ir('mais'),
      mes: () => { V.mes = F.somaMes(V.mes, +t.dataset.d); render(); },
      fmes: () => { V.fmes = F.somaMes(V.fmes, +t.dataset.d); render(); },
      dia: () => { V.dia = t.dataset.d; render(); },
      'encerrar-serie': async () => { if (!(await confirmar('Encerrar esta conta?', 'Os meses que ainda não foram pagos serão removidos. Os já pagos continuam.', 'Encerrar'))) return; const hoje = F.hojeISO(); d.lancs = d.lancs.filter((l) => !(l.serie === id && l.data >= hoje && !l.pago)); salvar(); render(); aviso('Série encerrada.'); },
      'rap-despesa': () => formLanc({}, 'despesa'),
      'rap-receita': () => formLanc({}, 'receita'),
      'rap-transf': () => formLanc({}, 'transf'),
      'rap-fatura': () => pagarFaturaRapido(),
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
      imprimir: () => { window.print(); },
      exemplo: async () => { if (!d.lancs.length || await confirmar('Carregar dados de exemplo?', 'Isso substitui os seus dados atuais pelos de exemplo.', 'Substituir')) exemplo(); },
      apagar: async () => { if (await confirmar('Apagar tudo?', 'Todos os seus lançamentos, contas e cartões serão apagados. Não dá para desfazer.', 'Apagar tudo')) { S.dados[S.perfil] = vazio(); V.cartao = null; salvar(); render(); aviso('Dados apagados.'); } },
      backup: () => baixar(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), `lepvi-financas-${F.hojeISO()}.json`),
    };
    if (acoes[a]) acoes[a]();
  });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'busca') { V.q = ev.target.value; $('#lista-lancs').innerHTML = listaLancs(); } });
  document.addEventListener('change', (ev) => {
    const alvo = ev.target;
    if (alvo.id === 'foto-arq') { processarFoto(alvo.files && alvo.files[0]); alvo.value = ''; return; }
    if (alvo.id === 'avisos-sw') { api('preferencias', { avisos: alvo.checked }).then((r) => { USER.info = r.usuario; aviso(r.usuario.avisos ? 'Avisos por e-mail ligados.' : 'Avisos por e-mail desligados.'); }).catch((e) => { alvo.checked = !alvo.checked; aviso(e.message); }); return; }
    if (alvo.id === 'lembrete-sw') { api('preferencias', { lembrete: alvo.checked }).then((r) => { USER.info = r.usuario; aviso(r.usuario.lembrete ? 'Lembrete ligado.' : 'Lembrete desligado.'); }).catch((e) => { alvo.checked = !alvo.checked; aviso(e.message); }); return; }
    if (alvo.id === 'resumo-sw') { api('preferencias', { resumo: alvo.checked }).then((r) => { USER.info = r.usuario; aviso(r.usuario.resumo ? 'Resumo semanal ligado.' : 'Resumo semanal desligado.'); }).catch((e) => { alvo.checked = !alvo.checked; aviso(e.message); }); return; }
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
  const ESCALAS = [100, 115, 130, 150, 175];
  const idxEscala = () => (S.escala != null ? S.escala : ({ normal: 0, grande: 2, enorme: 4 }[S.texto] ?? 0));
  function aplicarAcess() {
    const h = document.documentElement;
    const base = window.matchMedia && matchMedia('(min-width: 900px)').matches ? 1.2 : 1; // no computador o padrão já vem maior
    h.style.setProperty('--z', String(Math.round(base * ESCALAS[idxEscala()]) / 100));
    const tema = S.tema || 'claro';
    const escuro = tema === 'escuro' || (tema === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    h.dataset.esquema = escuro ? 'escuro' : 'claro';
    const forte = S.contraste != null ? S.contraste : window.matchMedia && matchMedia('(prefers-contrast: more)').matches;
    h.dataset.contraste = forte ? 'alto' : 'normal';
    h.dataset.movimento = S.semMovimento ? 'reduzido' : 'normal';
    h.dataset.destacar = S.destacar ? '1' : '0';
    const mt = document.querySelector('meta[name=theme-color]'); if (mt) mt.content = escuro ? '#111216' : '#F2F1EE';
  }
  if (window.matchMedia) { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((S.tema || 'claro') === 'auto') aplicarAcess(); }); matchMedia('(min-width: 900px)').addEventListener('change', aplicarAcess); }
  function formAcess(foco) {
    const sol = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
    const lua = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
    const tela = '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>';
    const volta = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
    const tema = S.tema || 'claro'; const i = idxEscala();
    abrir('Acessibilidade', `
      <section><h3 class="a11y-t" id="a11y-tam">Tamanho do texto</h3><div class="a11y-passo" role="group" aria-labelledby="a11y-tam"><button type="button" data-z="-1" aria-label="Diminuir o texto" ${i === 0 ? 'disabled' : ''}>− A</button><output aria-live="polite">${ESCALAS[i]}%</output><button type="button" data-z="1" aria-label="Aumentar o texto" ${i === ESCALAS.length - 1 ? 'disabled' : ''}>A +</button></div></section>
      <section><h3 class="a11y-t" id="a11y-cor">Cores do app</h3><div class="a11y-temas" role="radiogroup" aria-labelledby="a11y-cor">${[['claro', 'Claro', sol], ['escuro', 'Escuro', lua], ['auto', 'Automático', tela]].map(([k, t, d]) => `<button type="button" role="radio" aria-checked="${tema === k}" data-t="${k}">${svg(d)}${t}</button>`).join('')}</div></section>
      ${troca('semMovimento', 'Reduzir animações', !!S.semMovimento)}${troca('destacar', 'Destacar links e foco do teclado', !!S.destacar)}${troca('contraste', 'Alto contraste (preto, branco e bordas fortes)', document.documentElement.dataset.contraste === 'alto')}
      <button type="button" class="a11y-rest" data-a="padrao">${svg(volta)} Restaurar padrão</button>
      <p class="mut">As mudanças valem na hora e ficam salvas neste aparelho. Você também pode ampliar a página com o zoom do navegador.</p>`, null, (f) => {
      const aplica = (alvo) => { salvar(); aplicarAcess(); render(); formAcess(alvo); };
      f.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { S.escala = Math.max(0, Math.min(ESCALAS.length - 1, idxEscala() + Number(b.dataset.z))); S.texto = undefined; aplica(`[data-z="${b.dataset.z}"]`); }));
      f.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { S.tema = b.dataset.t; aplica(`[data-t="${b.dataset.t}"]`); }));
      f.addEventListener('change', () => { S.semMovimento = f.semMovimento.checked; S.destacar = f.destacar.checked; S.contraste = f.contraste.checked; salvar(); aplicarAcess(); render(); });
      $('[data-a=padrao]', f).addEventListener('click', () => { S.escala = undefined; S.texto = undefined; S.tema = undefined; S.semMovimento = undefined; S.destacar = undefined; S.contraste = undefined; aplica('[data-a=padrao]'); });
      if (foco) { const el = $(foco, f); if (el && !el.disabled) el.focus(); }
    });
  }
  aplicarAcess();
  iniciar();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
