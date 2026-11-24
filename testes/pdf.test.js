const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { console, TextEncoder, TextDecoder, btoa, atob, Blob, Uint8Array, JSON, Date, Math, String, Number, Array, Object };
ctx.globalThis = ctx; ctx.window = undefined;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pdf.js'), 'utf8'), ctx);
const F = { brl: (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ','), saldoConta: (lancs, c) => c.saldoInicial || 0 };
const S = { perfil: 'pessoal', dados: { pessoal: { contas: [{ id: 'a', nome: 'Conta (principal) \\ ç', cor: '#2D4BFF', saldoInicial: 100 }], cartoes: [{ id: 'k', nome: 'Nubank', limite: 3000, fechamento: 5, vencimento: 12 }], lancs: Array.from({ length: 120 }, (_, i) => ({ id: 'l' + i, data: '2026-11-' + String((i % 28) + 1).padStart(2, '0'), desc: 'Mercado açaí ✓ ' + i, categoria: 'Alimentação', tipo: i % 5 === 0 ? 'receita' : 'despesa', valor: 10 + i, conta: 'a', pago: true })) }, empresa: { contas: [], cartoes: [], lancs: [] } } };

test('o PDF da cópia de segurança abre e devolve os mesmos dados', async () => {
  const blob = ctx.LFPdf.gerar(S, { nome: 'Larissa', email: 'l@exemplo.com' }, F);
  assert.strictEqual(blob.type, 'application/pdf');
  const buf = Buffer.from(await blob.arrayBuffer());
  const txt = buf.toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'), 'cabeçalho PDF');
  assert.ok(txt.trimEnd().endsWith('%%EOF'), 'fim do PDF');
  assert.ok(/\/Count [2-9]/.test(txt), 'passa de uma página com muitos lançamentos');
  const xref = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.strictEqual(txt.slice(xref, xref + 4), 'xref', 'a tabela de objetos fica onde o PDF diz');
  const volta = ctx.LFPdf.lerDados(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(volta)), JSON.parse(JSON.stringify(S)));
});

test('PDF que não é uma cópia da Lepvi Finanças é recusado', () => {
  assert.throws(() => ctx.LFPdf.lerDados(Buffer.from('%PDF-1.4\nqualquer coisa').buffer));
});
