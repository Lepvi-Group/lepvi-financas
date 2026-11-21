# Lepvi Finanças

Produto próprio da Lepvi Group, separado do Lepvi Hub: gestão financeira para pessoa física e jurídica (contas, vários cartões, boletos, vencimentos), no estilo do Mobills.

- Tudo em português do Brasil. Marca ATUAL do lepvi.com.br (não usar o guia antigo da gota): preto `#0D0D0F`, azul `#2D4BFF`, violeta `#8A3DFF`, magenta `#C04DFF`, degradê `#3A7BFF→#2D4BFF→#8A3DFF→#C04DFF`, papel `#F2F1EE`; fonte Outfit; símbolo em "L" de `site/assets/img/favicon.svg`.
- Mobile primeiro, também funciona no computador. "Desenvolvido por Lepvi Group" (link para https://lepvi.com.br em outra aba) fica no rodapé.
- Versão atual: app estático instalável (PWA), dados só no aparelho (`localStorage`, chave `lepvi-financas-v1`). Regras de cálculo em `lib.js` (testadas), telas em `app.js`.
- Testes: `npm test`. Servidor local: `npm start` (porta 4180).
- Próximos passos desenhados: login e nuvem (dados em vários aparelhos), Open Finance (Pluggy) para ler bancos e cartões, lembretes por WhatsApp/e-mail, orçamento por categoria, relatórios.

Bases e repositórios de referência da Larissa: consulte a seção "Repositórios de referência" em https://github.com/Lepvi-Group/lepvi-solutions/blob/master/CLAUDE.md (se a sessão tiver o repositório `lepvi-solutions`, leia o `CLAUDE.md` dele).
