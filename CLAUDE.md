# Lepvi Finanças

Produto próprio da Lepvi Group, separado do Lepvi Hub: gestão financeira para pessoa física e jurídica (contas, vários cartões, boletos, vencimentos), no estilo do Mobills.

- Tudo em português do Brasil. Cores e fontes do guia de marca (`../lepvi-solutions/marca/guia-de-marca.html`): marinho `#0E2238`, verde-água `#4A9DA2` e `#2C767B`, névoa `#F1F5FA`; Bricolage Grotesque e Public Sans.
- Mobile primeiro, também funciona no computador. "Desenvolvido por Lepvi Group" (link para https://lepvi.com.br em outra aba) fica no rodapé.
- Versão atual: app estático instalável (PWA), dados só no aparelho (`localStorage`, chave `lepvi-financas-v1`). Regras de cálculo em `lib.js` (testadas), telas em `app.js`.
- Testes: `npm test`. Servidor local: `npm start` (porta 4180).
- Próximos passos desenhados: login e nuvem (dados em vários aparelhos), Open Finance (Pluggy) para ler bancos e cartões, lembretes por WhatsApp/e-mail, orçamento por categoria, relatórios.

Bases e repositórios de referência da Larissa: consulte a seção "Repositórios de referência" em https://github.com/Lepvi-Group/lepvi-solutions/blob/master/CLAUDE.md (se a sessão tiver o repositório `lepvi-solutions`, leia o `CLAUDE.md` dele).
