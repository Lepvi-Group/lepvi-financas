# Lepvi Finanças

Produto próprio da Lepvi Group, separado do Lepvi Hub: gestão financeira para pessoa física e jurídica (contas, vários cartões, boletos, vencimentos), no estilo do Mobills.

- Tudo em português do Brasil. Marca ATUAL do lepvi.com.br (não usar o guia antigo da gota): preto `#0D0D0F`, azul `#2D4BFF`, violeta `#8A3DFF`, magenta `#C04DFF`, degradê `#3A7BFF→#2D4BFF→#8A3DFF→#C04DFF`, papel `#F2F1EE`; fonte Outfit; símbolo em "L" de `site/assets/img/favicon.svg`.
- Mobile primeiro, também funciona no computador. "Desenvolvido por Lepvi Group" (link para https://lepvi.com.br em outra aba) fica no rodapé.
- Arquitetura: app estático (`index.html`, `app.js`, `lib.js`, `styles.css`) + API PHP em `api/` (conta, sessão, dados cifrados, exportar e excluir = LGPD) + `api/cron-avisos.php` (e-mails de vencimento, todo dia às 8h de Brasília, via cron da Hostinger `0 11 * * *`). **Produto separado do site e do Hub da Lepvi: banco e código próprios.**
- Dados financeiros só em memória no navegador e cifrados (libsodium) no servidor; no aparelho ficam só as preferências de texto/contraste (`lepvi-financas-prefs`). Senha com argon2id, e-mail precisa ser confirmado, limite de tentativas, cookie `lf_sessao` HttpOnly/Secure/SameSite, cabeçalho `X-Lepvi` + origem contra CSRF.
- Em produção o servidor gera o próprio segredo e guarda banco SQLite + segredo FORA da pasta pública (`…/domains/<dominio>/financas-dados`); o envio do zip não apaga isso e nenhuma senha passa pela conversa. Localmente (`php -S`) usa `.dev/` com e-mails em `.dev/emails.log`.
- Publicar: zip dos arquivos versionados (sem `testes/`, `CLAUDE.md`, `package.json`), TUS + `hosting_websites_deploy-static-site-archive` na Hostinger (grátis). Sempre subir `?v=N` nos arquivos do `index.html` (o servidor guardava cache por 7 dias; o `.htaccess` agora força conferir).
- Testes: `npm test` (regras `lib.js` + API com PHP/SQLite). Servidor local: `php -S 127.0.0.1:4180 -t .`.
- Pendente: Open Finance (Pluggy/Belvo, serviço pago), revisão jurídica da Política de Privacidade e dos Termos, endereço próprio (financas.lepvi.com.br), conferir se o e-mail chega na caixa de entrada.

Bases e repositórios de referência da Larissa: consulte a seção "Repositórios de referência" em https://github.com/Lepvi-Group/lepvi-solutions/blob/master/CLAUDE.md (se a sessão tiver o repositório `lepvi-solutions`, leia o `CLAUDE.md` dele).
