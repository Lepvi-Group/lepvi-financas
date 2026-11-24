/* Cópia de segurança em PDF com a marca da Lepvi Finanças.
   Sem biblioteca: escreve o PDF na mão (fontes Helvetica do próprio leitor de PDF). Os dados completos vão junto,
   numa linha de comentário do arquivo (%LFDADOS:), e "Restaurar uma cópia" lê o PDF de volta com LFPdf.lerDados. */
(function (raiz) {
  'use strict';
  const L = 595; const A = 842; const MG = 40;
  const COR = { preto: '0D0D0F', azul: '2D4BFF', violeta: '8A3DFF', magenta: 'C04DFF', papel: 'F2F1EE', verde: '0F8A5F', verm: 'D92D20', cinza: '6B6B72', branco: 'FFFFFF', linha: 'E3E1DC' };
  const rgb = (h) => [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

  /* larguras Helvetica (1000 = corpo inteiro) de 32 a 126 */
  const LARG = {
    n: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
    b: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
  };
  const sem = (s) => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}️‍]/gu, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/−/g, '-').replace(/→/g, '>');
  const CP = { '–': 150, '—': 151, '…': 133, '•': 149, '€': 128 };
  const byte = (ch) => { const c = ch.codePointAt(0); return CP[ch] != null ? CP[ch] : (c < 256 ? c : 63); };
  const larg = (s, tam, neg) => Array.from(s).reduce((t, ch) => { const base = ch.normalize('NFD')[0]; const c = base.charCodeAt(0); return t + (c >= 32 && c <= 126 ? (neg ? LARG.b : LARG.n)[c - 32] : 556); }, 0) * tam / 1000;
  const esc = (s) => Array.from(s).map((ch) => { const x = String.fromCharCode(byte(ch)); return x === '(' || x === ')' || x === '\\' ? '\\' + x : x; }).join('');
  const corta = (s, max, tam, neg) => { s = sem(s); if (larg(s, tam, neg) <= max) return s; while (s.length > 1 && larg(s + '…', tam, neg) > max) s = s.slice(0, -1); return s.trimEnd() + '…'; };
  const num = (n) => Number(n).toFixed(2);

  function gerar(S, usuario, F) {
    const paginas = []; let c = null; let y = 0;
    const nova = () => { c = []; paginas.push(c); cabecalho(paginas.length === 1); };
    const ret = (x, yt, w, h, cor) => c.push(`${rgb(cor)} rg ${num(x)} ${num(A - yt - h)} ${num(w)} ${num(h)} re f`);
    const txt = (x, yt, s, tam, cor, neg, alin) => {
      s = sem(s); if (!s) return; const w = larg(s, tam, neg); const px = alin === 'd' ? x - w : alin === 'c' ? x - w / 2 : x;
      c.push(`BT /${neg ? 'F2' : 'F1'} ${tam} Tf ${rgb(cor)} rg ${num(px)} ${num(A - yt)} Td (${esc(s)}) Tj ET`);
    };
    const logo = (x, yt, tam, cor) => { // o "L" da marca, desenhado em 100x100
      const k = tam / 100; const P = (px, py) => `${num(x + px * k)} ${num(A - yt - py * k)}`;
      c.push(`${rgb(cor)} rg ${P(10, 24)} m ${P(34, 0)} l ${P(34, 64)} l ${P(46, 76)} l ${P(90, 76)} l ${P(66, 100)} l ${P(10, 100)} l h f`);
      c.push(`${rgb(cor)} rg ${num(x + 60 * k)} ${num(A - yt - 50 * k)} ${num(24 * k)} ${num(24 * k)} re f`);
    };
    const faixa = (yt, h) => ['azul', 'violeta', 'magenta'].forEach((k, i) => ret(i * (L / 3), yt, L / 3 + 1, h, COR[k]));
    function cabecalho(primeira) {
      if (primeira) {
        ret(0, 0, L, 132, COR.preto); faixa(132, 5);
        logo(MG, 34, 34, COR.branco); txt(MG + 46, 60, 'Lepvi', 24, COR.branco, false); txt(MG + 46 + larg('Lepvi ', 24), 60, 'Finanças', 24, COR.magenta, true);
        txt(MG, 108, 'Cópia de segurança', 13, 'C9C8D6', false);
        y = 168;
      } else {
        ret(0, 0, L, 34, COR.preto); faixa(34, 3);
        logo(MG, 9, 16, COR.branco); txt(MG + 24, 22, 'Lepvi', 11, COR.branco, false); txt(MG + 24 + larg('Lepvi ', 11), 22, 'Finanças', 11, COR.magenta, true);
        txt(L - MG, 22, 'Cópia de segurança', 9, 'C9C8D6', false, 'd');
        y = 62;
      }
    }
    const espaco = (h) => { if (y + h > A - 56) nova(); };
    const titulo = (s, cor) => { espaco(60); ret(MG, y, 4, 18, COR[cor || 'azul']); txt(MG + 12, y + 14, s, 15, COR.preto, true); y += 32; };
    const dinheiro = (n) => F.brl(n).replace(/ /g, ' ');
    const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

    nova();
    const agora = new Date();
    txt(MG, 156, `Gerada em ${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}  ·  ${(usuario && usuario.nome) || ''}  ·  ${(usuario && usuario.email) || ''}`, 9.5, COR.cinza, false);
    y = 184;
    ret(MG, y, L - 2 * MG, 46, COR.papel);
    txt(MG + 14, y + 19, 'Este arquivo guarda todos os seus dados.', 10.5, COR.preto, true);
    txt(MG + 14, y + 35, 'Para voltar a eles: Mais opções > Restaurar uma cópia e escolha este PDF. Guarde em local seguro: ele mostra seus lançamentos.', 8.5, COR.cinza, false);
    y += 72;

    [['pessoal', 'Pessoal', 'azul'], ['empresa', 'Empresa', 'violeta']].forEach(([chave, nome, cor]) => {
      const d = S.dados[chave]; if (!d) return;
      const lancs = (d.lancs || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)));
      if (chave === 'empresa' && !lancs.length && !(d.cartoes || []).length && (d.contas || []).every((x) => !x.saldoInicial)) return;
      const contasSaldo = (d.contas || []).filter((x) => !x.fora && x.tipo !== 'investimento').reduce((t, x) => t + F.saldoConta(d.lancs || [], x), 0);
      titulo(`${nome}: resumo`, cor);
      const cards = [['Saldo geral', dinheiro(contasSaldo)], ['Lançamentos', String(lancs.length)], ['Contas', String((d.contas || []).length)], ['Cartões', String((d.cartoes || []).length)]];
      espaco(60); const cw = (L - 2 * MG - 24) / 4;
      cards.forEach(([t, v], i) => { const x = MG + i * (cw + 8); ret(x, y, cw, 50, COR.papel); txt(x + 10, y + 18, t, 8.5, COR.cinza, false); txt(x + 10, y + 38, v, 13, COR.preto, true); });
      y += 70;

      if ((d.contas || []).length) {
        titulo('Contas e saldos', cor);
        (d.contas || []).forEach((x, i) => { espaco(22); if (i % 2 === 0) ret(MG, y - 13, L - 2 * MG, 22, COR.papel); ret(MG + 8, y - 6, 8, 8, x.cor ? x.cor.replace('#', '') : COR.azul); txt(MG + 24, y + 2, corta(x.nome, 300, 10), 10, COR.preto, false); const s = F.saldoConta(d.lancs || [], x); txt(L - MG - 8, y + 2, dinheiro(s) + (x.fora ? '  (fora do saldo geral)' : ''), 10, s < 0 ? COR.verm : COR.preto, true, 'd'); y += 22; });
        y += 14;
      }
      if ((d.cartoes || []).length) {
        titulo('Cartões de crédito', cor);
        (d.cartoes || []).forEach((x, i) => { espaco(22); if (i % 2 === 0) ret(MG, y - 13, L - 2 * MG, 22, COR.papel); txt(MG + 10, y + 2, corta(x.nome, 300, 10), 10, COR.preto, false); const det = [x.limite ? `limite ${dinheiro(x.limite)}` : '', x.fechamento ? `fecha dia ${x.fechamento}` : '', x.vencimento ? `vence dia ${x.vencimento}` : ''].filter(Boolean).join('  ·  '); txt(L - MG - 8, y + 2, det, 9, COR.cinza, false, 'd'); y += 22; });
        y += 14;
      }

      titulo(`Lançamentos (${lancs.length})`, cor);
      if (!lancs.length) { txt(MG + 4, y, 'Nenhum lançamento.', 10, COR.cinza, false); y += 24; return; }
      const cab = () => { espaco(36); ret(MG, y - 13, L - 2 * MG, 20, COR.preto); [['Data', MG + 8], ['Descrição', MG + 62], ['Categoria', MG + 270], ['Conta', MG + 372]].forEach(([t, x]) => txt(x, y + 1, t, 8.5, COR.branco, true)); txt(L - MG - 8, y + 1, 'Valor', 8.5, COR.branco, true, 'd'); y += 20; };
      cab();
      const nomeConta = (id) => { const k = (d.contas || []).find((z) => z.id === id); return k ? k.nome : ''; };
      lancs.forEach((l, i) => {
        if (y + 18 > A - 56) { nova(); cab(); }
        if (i % 2 === 0) ret(MG, y - 12, L - 2 * MG, 18, COR.papel);
        const sinal = l.tipo === 'receita' ? '+ ' : l.tipo === 'despesa' ? '- ' : '';
        const cor2 = l.tipo === 'receita' ? COR.verde : l.tipo === 'despesa' ? COR.verm : COR.cinza;
        txt(MG + 8, y, dataBR(l.data), 8.5, COR.cinza, false); txt(MG + 62, y, corta(l.desc || '', 200, 8.5), 8.5, COR.preto, false);
        txt(MG + 270, y, corta(l.categoria || '', 96, 8.5), 8.5, COR.cinza, false); txt(MG + 372, y, corta(nomeConta(l.conta), 80, 8.5), 8.5, COR.cinza, false);
        txt(L - MG - 8, y, sinal + dinheiro(l.valor), 8.5, cor2, true, 'd'); y += 18;
      });
      y += 18;
    });

    /* rodapé e numeração em todas as páginas */
    paginas.forEach((p, i) => {
      c = p; ret(MG, A - 44, L - 2 * MG, 0.6, COR.linha);
      txt(MG, A - 28, 'Lepvi Finanças  ·  financas.lepvi.com.br', 8, COR.cinza, false); txt(L / 2 + 40, A - 28, 'Desenvolvido por Lepvi Group  ·  lepvi.com.br', 8, COR.cinza, false, 'c');
      txt(L - MG, A - 28, `Página ${i + 1} de ${paginas.length}`, 8, COR.cinza, false, 'd');
    });

    /* monta o arquivo */
    const objs = []; const nPag = paginas.length; const primeiraPag = 5;
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push(`<< /Type /Pages /Kids [${paginas.map((_, i) => `${primeiraPag + i * 2} 0 R`).join(' ')}] /Count ${nPag} >>`);
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    paginas.forEach((p, i) => {
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${L} ${A}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${primeiraPag + i * 2 + 1} 0 R >>`);
      const fluxo = p.join('\n'); objs.push(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
    });
    objs.push(`<< /Title (Copia de seguranca - Lepvi Financas) /Author (Lepvi Financas) /Creator (Lepvi Financas) >>`);

    const dados = btoa(Array.from(new TextEncoder().encode(JSON.stringify(S)), (b) => String.fromCharCode(b)).join(''));
    let out = '%PDF-1.4\n%âãÏÓ\n'; const pos = [];
    objs.forEach((o, i) => { pos.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    out += `%LFDADOS:${dados}\n`;
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => String(p).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* lê os dados de dentro de um PDF gerado por gerar(); devolve o objeto ou lança erro */
  function lerDados(buffer) {
    const u = new Uint8Array(buffer); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    const m = /%LFDADOS:([A-Za-z0-9+/=]+)/.exec(s); if (!m) throw new Error('sem dados');
    const bin = atob(m[1]); return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  }

  raiz.LFPdf = { gerar, lerDados };
})(typeof window !== 'undefined' ? window : globalThis);
