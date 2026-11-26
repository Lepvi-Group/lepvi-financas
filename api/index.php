<?php
declare(strict_types=1);
/* Lepvi Finanças: API. Uma ação por chamada: /api/?a=entrar etc. Produto separado do site e do Hub. */
require __DIR__ . '/_oauth.php';
require __DIR__ . '/_openfinance.php';
require __DIR__ . '/_2fa.php';
require __DIR__ . '/_assinatura.php';

$acao = (string) ($_GET['a'] ?? '');
$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$link = fn(string $q) => rtrim(cfg()['site_url'], '/') . '/?' . $q;
/* E-mail com o link para criar uma nova senha (usado por "esqueci" na entrada e por "não sei a senha atual" dentro do app). */
function enviar_link_redefinir(string $email, string $token, callable $link): void
{
    enviar_email($email, 'Crie uma nova senha para o Lepvi Finanças', email_html('Redefinir senha', '<p style="margin:0 0 12px">Recebemos um pedido para criar uma nova senha para a sua conta.</p><p style="margin:0">O link vale por <b>1 hora</b>. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>', 'Criar nova senha', $link('redefinir=' . $token), 'Link para criar uma nova senha (vale por 1 hora).'));
}

try {
    if ($metodo === 'GET' && $acao === 'config') resp(['turnstile' => turnstile_config()['site_key'] ?? null, 'cadastro' => cadastro_aberto()]);
    // Entrada com Google/Microsoft: dados da pessoa que ainda precisa aceitar a Política e os Termos
    if ($metodo === 'GET' && $acao === 'oauth_pendente') {
        $pend = ler_assinado((string) ($_COOKIE['lf_novo'] ?? ''));
        if (!$pend) erro('Pedido expirado. Entre de novo.', 404);
        resp(['provedor' => oauth_provedores()[$pend['p']]['nome'] ?? '', 'email' => $pend['email'], 'nome' => $pend['nome']]);
    }
    // Leitura sem efeito colateral (exportar baixa um arquivo).
    if ($metodo === 'GET' && in_array($acao, ['eu', 'dados', 'exportar', 'capturas', 'anexos', 'anexo', 'espaco', 'conexoes', 'assinatura'], true)) {
        $u = exigir_usuario();
        $dono = espaco_dono($u['id']);
        if ($acao === 'eu') resp(['usuario' => usuario_publico($u)]);
        if ($acao === 'espaco') resp(espaco_info($u, $dono));
        if ($acao === 'assinatura') resp(assinatura_situacao($dono) + ['dono' => $dono === $u['id']]);
        if ($acao === 'conexoes') resp(['ativo' => openfinance_liberado($dono), 'tem_credencial' => pluggy_cred($dono) !== null, 'conexoes' => of_conexoes($dono)]);
        if ($acao === 'capturas') {
            $k = db()->prepare('SELECT criado_em, ultimo_uso FROM chaves_captura WHERE usuario_id = ?');
            $k->execute([$u['id']]);
            $ch = $k->fetch();
            resp(['capturas' => capturas_listar($dono), 'chave' => $ch ? ['criada_em' => (int) $ch['criado_em'], 'ultimo_uso' => $ch['ultimo_uso'] !== null ? (int) $ch['ultimo_uso'] : null] : null]);
        }
        if ($acao === 'anexos') {
            $s = db()->prepare('SELECT id, criado_em FROM anexos WHERE usuario_id = ? AND lanc_id = ? ORDER BY criado_em');
            $s->execute([$dono, substr((string) ($_GET['lanc'] ?? ''), 0, 64)]);
            resp(['anexos' => $s->fetchAll()]);
        }
        if ($acao === 'anexo') {
            $s = db()->prepare('SELECT conteudo FROM anexos WHERE usuario_id = ? AND id = ?');
            $s->execute([$dono, substr((string) ($_GET['id'] ?? ''), 0, 32)]);
            $c = $s->fetchColumn();
            if ($c === false) erro('Anexo não encontrado.', 404);
            resp(['dataUrl' => decifrar((string) $c)]);
        }
        if ($acao === 'dados') {
            $s = db()->prepare('SELECT conteudo, versao FROM dados WHERE usuario_id = ?');
            $s->execute([$dono]);
            $l = $s->fetch();
            resp(['versao' => $l ? (int) $l['versao'] : 0, 'conteudo' => $l ? json_decode((string) decifrar($l['conteudo']), true) : null]);
        }
        // exportar: todos os dados da pessoa (LGPD, direito de acesso e portabilidade)
        $s = db()->prepare('SELECT conteudo, versao, atualizado_em FROM dados WHERE usuario_id = ?');
        $s->execute([$dono]);
        $d = $s->fetch();
        $c = db()->prepare('SELECT tipo, versao, quando FROM consentimentos WHERE usuario_id = ? ORDER BY quando');
        $c->execute([$u['id']]);
        $an = db()->prepare('SELECT id, lanc_id, conteudo, criado_em FROM anexos WHERE usuario_id = ? ORDER BY criado_em');
        $an->execute([$dono]);
        $fotos = array_map(fn($x) => ['id' => $x['id'], 'lancamento' => $x['lanc_id'], 'em' => date('c', (int) $x['criado_em']), 'imagem' => decifrar((string) $x['conteudo'])], $an->fetchAll());
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('Content-Disposition: attachment; filename="meus-dados-lepvi-financas.json"');
        echo json_encode([
            'gerado_em' => date('c'),
            'conta' => ['email' => $u['email'], 'nome' => $u['nome'], 'tem_foto' => !empty($u['foto']), 'criada_em' => date('c', (int) $u['criado_em']), 'avisos_por_email' => (bool) $u['avisos'], 'email_confirmado' => (bool) $u['email_verificado']],
            'consentimentos' => array_map(fn($x) => ['tipo' => $x['tipo'], 'versao' => $x['versao'], 'em' => date('c', (int) $x['quando'])], $c->fetchAll()),
            'dados_financeiros' => $d ? json_decode((string) decifrar($d['conteudo']), true) : null,
            'avisos_do_banco_para_revisar' => capturas_listar($dono),
            'fotos_de_comprovantes' => $fotos,
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    if ($metodo !== 'POST') erro('Método não permitido.', 405);
    exigir_origem();
    $b = corpo();

    switch ($acao) {
        case 'oauth_concluir': {
            if (!cadastro_aberto()) erro('Novas contas estão fechadas no momento.', 403);
            $pend = ler_assinado((string) ($_COOKIE['lf_novo'] ?? ''));
            if (!$pend) erro('Pedido expirado. Entre de novo.', 410);
            if (($b['aceite'] ?? false) !== true) erro('É preciso aceitar a Política de Privacidade e os Termos de Uso.', 422);
            [$novo, $confirmar] = oauth_criar($pend);
            setcookie('lf_novo', '', ['expires' => 1, 'path' => '/', 'secure' => (bool) cfg()['cookie_seguro'], 'httponly' => true, 'samesite' => 'Lax']);
            if ($confirmar) {
                $t = criar_token($novo['id'], 'verificar', 86400);
                enviar_email($novo['email'], 'Confirme seu e-mail para ativar sua conta no Lepvi Finanças', email_html('Confirme seu e-mail', '<p style="margin:0 0 12px">Olá, ' . htmlspecialchars(explode(' ', $novo['nome'])[0]) . '!</p><p style="margin:0">Falta só confirmar que este e-mail é seu. O link vale por <b>24 horas</b>.</p>', 'Confirmar meu e-mail', $link('verificar=' . $t), 'Falta só um passo para ativar sua conta.'));
                resp(['ok' => true, 'mensagem' => 'Enviamos um e-mail para você confirmar o cadastro. Abra o link e depois entre com a Microsoft.']);
            }
            db()->prepare('UPDATE usuarios SET ultimo_login = ? WHERE id = ?')->execute([agora(), $novo['id']]);
            abrir_sessao($novo['id']);
            resp(['usuario' => usuario_publico($novo)]);
        }
        case 'cadastro': {
            if (!cadastro_aberto()) erro('Novas contas estão fechadas no momento. Quem já tem conta continua entrando normalmente.', 403);
            exigir_turnstile($b);
            $ip = 'cad:' . ip_hash();
            if (limite_estourou($ip, 10, 3600)) erro('Muitas tentativas. Tente de novo em alguns minutos.', 429);
            registrar_tentativa($ip);
            $email = validar_email((string) ($b['email'] ?? ''));
            $nome = trim((string) ($b['nome'] ?? ''));
            if ($nome === '' || mb_strlen($nome) > 120) erro('Informe seu nome.', 422);
            $senha = (string) ($b['senha'] ?? '');
            validar_senha($senha, $email);
            if (($b['aceite'] ?? false) !== true) erro('É preciso aceitar a Política de Privacidade e os Termos de Uso.', 422);
            $s = db()->prepare('SELECT id FROM usuarios WHERE email = ?');
            $s->execute([$email]);
            $existente = $s->fetchColumn();
            if ($existente) {
                // Mesma resposta de sempre (não revela se o e-mail já existe); o dono do e-mail é avisado.
                enviar_email($email, 'Alguém tentou criar uma conta com o seu e-mail', email_html('Você já tem uma conta', '<p>Alguém tentou criar uma conta no Lepvi Finanças com este e-mail. Como você já tem conta, nada mudou.</p><p>Se foi você, é só entrar. Se esqueceu a senha, use "Esqueci minha senha".</p>', 'Abrir o Lepvi Finanças', $link('')));
            } else {
                $uid = novo_id();
                db()->prepare('INSERT INTO usuarios (id, email, nome, senha_hash, email_verificado, avisos, aceite_versao, aceite_em, criado_em) VALUES (?,?,?,?,0,1,?,?,?)')
                    ->execute([$uid, $email, $nome, gerar_hash($senha), VERSAO_TERMOS, agora(), agora()]);
                foreach (['politica_privacidade', 'termos_de_uso'] as $tipo) {
                    db()->prepare('INSERT INTO consentimentos (id, usuario_id, tipo, versao, quando) VALUES (?,?,?,?,?)')->execute([novo_id(), $uid, $tipo, VERSAO_TERMOS, agora()]);
                }
                $t = criar_token($uid, 'verificar', 86400);
                enviar_email($email, 'Confirme seu e-mail para ativar sua conta no Lepvi Finanças', email_html('Confirme seu e-mail', '<p style="margin:0 0 12px">Olá, ' . htmlspecialchars(explode(' ', $nome)[0]) . '!</p><p style="margin:0 0 12px">Sua conta no Lepvi Finanças está quase pronta. Falta só um passo: confirmar que este e-mail é seu.</p><p style="margin:0">O link abaixo vale por <b>24 horas</b>. Se você não criou esta conta, ignore este e-mail: nada será ativado.</p>', 'Confirmar meu e-mail', $link('verificar=' . $t), 'Falta só um passo para ativar sua conta.'));
            }
            resp(['ok' => true, 'mensagem' => 'Enviamos um e-mail para você confirmar o cadastro. Abra o link do e-mail e depois entre.']);
        }
        case 'verificar': {
            $uid = consumir_token((string) ($b['token'] ?? ''), 'verificar');
            if (!$uid) erro('Link inválido ou vencido. Peça um novo no cadastro.', 400);
            db()->prepare('UPDATE usuarios SET email_verificado = 1 WHERE id = ?')->execute([$uid]);
            resp(['ok' => true]);
        }
        case 'entrar': {
            exigir_turnstile($b);
            $email = mb_strtolower(trim((string) ($b['email'] ?? '')));
            $senha = (string) ($b['senha'] ?? '');
            $kE = 'login:e:' . hash('sha256', $email); $kI = 'login:i:' . ip_hash();
            if (limite_estourou($kE, 5, 900) || limite_estourou($kI, 30, 900)) erro('Muitas tentativas. Espere 15 minutos e tente de novo.', 429);
            $s = db()->prepare('SELECT * FROM usuarios WHERE email = ?');
            $s->execute([$email]);
            $u = $s->fetch() ?: null;
            if (!senha_confere($u, $senha)) { registrar_tentativa($kE); registrar_tentativa($kI); erro('E-mail ou senha incorretos.', 401); }
            if (!$u['email_verificado']) erro('Confirme seu e-mail pelo link que enviamos antes de entrar.', 403);
            // Verificação em dois passos: a sessão só abre depois do código (ticket assinado vale 5 minutos)
            if (totp_ativo($u)) resp(['passo2' => true, 'ticket' => assinar(['u' => $u['id'], 'a' => '2fa'], 300)]);
            if (password_needs_rehash($u['senha_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
                db()->prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')->execute([gerar_hash($senha), $u['id']]);
            }
            db()->prepare('UPDATE usuarios SET ultimo_login = ? WHERE id = ?')->execute([agora(), $u['id']]);
            abrir_sessao($u['id']);
            resp(['usuario' => usuario_publico($u)]);
        }
        case 'entrar_2fa': {
            $bruto = (string) ($b['ticket'] ?? ''); if ($bruto === '') $bruto = (string) ($_COOKIE['lf_2fa'] ?? ''); // entrada pelo Google/Microsoft deixa o ticket em cookie
            $t = ler_assinado($bruto);
            if (!$t || ($t['a'] ?? '') !== '2fa') erro('O tempo acabou. Entre de novo com e-mail e senha.', 401);
            $kU = '2fa:u:' . $t['u']; $kI = '2fa:i:' . ip_hash();
            if (limite_estourou($kU, 5, 900) || limite_estourou($kI, 30, 900)) erro('Muitas tentativas. Espere 15 minutos e tente de novo.', 429);
            // Teto diário: sem ele, 5 chutes a cada 15 minutos somam quase 500 por dia e o código de 6 dígitos acaba adivinhado com o tempo.
            if (limite_estourou($kU, 15, 86400)) erro('Muitas tentativas de código hoje. Por segurança, tente de novo amanhã.', 429);
            $usr = totp_usuario((string) $t['u']);
            if (!$usr || !totp_ativo($usr) || !totp_validar_usuario($usr, (string) ($b['codigo'] ?? ''))) { registrar_tentativa($kU); registrar_tentativa($kI); erro('Código incorreto ou vencido. Confira o código do app e tente de novo.', 401); }
            db()->prepare('UPDATE usuarios SET ultimo_login = ? WHERE id = ?')->execute([agora(), $usr['id']]);
            setcookie('lf_2fa', '', ['expires' => 1, 'path' => '/', 'secure' => (bool) cfg()['cookie_seguro'], 'httponly' => true, 'samesite' => 'Lax']);
            abrir_sessao($usr['id']);
            resp(['usuario' => usuario_publico(totp_usuario((string) $usr['id']))]);
        }
        case 'sair': {
            $t = $_COOKIE['lf_sessao'] ?? '';
            if ($t !== '') db()->prepare('DELETE FROM sessoes WHERE hash = ?')->execute([hash_token($t)]);
            fechar_cookie();
            resp(['ok' => true]);
        }
        case 'esqueci': {
            exigir_turnstile($b);
            $email = mb_strtolower(trim((string) ($b['email'] ?? '')));
            $kI = 'esq:i:' . ip_hash(); $kE = 'esq:e:' . hash('sha256', $email);
            if (!limite_estourou($kI, 8, 3600) && !limite_estourou($kE, 3, 3600) && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                registrar_tentativa($kI); registrar_tentativa($kE);
                $s = db()->prepare('SELECT * FROM usuarios WHERE email = ?');
                $s->execute([$email]);
                if ($u = $s->fetch()) {
                    $t = criar_token($u['id'], 'redefinir', 3600);
                    enviar_link_redefinir($email, $t, $link);
                }
            }
            resp(['ok' => true, 'mensagem' => 'Se esse e-mail tiver conta, enviamos um link para criar uma nova senha.']);
        }
        case 'redefinir': {
            $senha = (string) ($b['senha'] ?? '');
            validar_senha($senha);
            $uid = consumir_token((string) ($b['token'] ?? ''), 'redefinir');
            if (!$uid) erro('Link inválido ou vencido. Peça um novo em "Esqueci minha senha".', 400);
            db()->prepare('UPDATE usuarios SET senha_hash = ?, email_verificado = 1 WHERE id = ?')->execute([gerar_hash($senha), $uid]);
            db()->prepare('DELETE FROM sessoes WHERE usuario_id = ?')->execute([$uid]);
            resp(['ok' => true]);
        }
    }

    // A partir daqui, só com sessão válida.
    $u = exigir_usuario();
    $dono = espaco_dono($u['id']);
    switch ($acao) {
        case 'dados': {
            exigir_assinatura($dono);
            $esperada = (int) ($b['versao'] ?? -1);
            $conteudo = $b['conteudo'] ?? null;
            if (!is_array($conteudo)) erro('Dados inválidos.', 422);
            $json = json_encode($conteudo, JSON_UNESCAPED_UNICODE);
            if ($json === false || strlen($json) > 1500000) erro('Dados grandes demais.', 413);
            $cif = cifrar($json);
            $pdo = db();
            $pdo->beginTransaction();
            $s = $pdo->prepare('SELECT versao FROM dados WHERE usuario_id = ?');
            $s->execute([$dono]);
            $atual = $s->fetchColumn();
            if ($atual === false) {
                if ($esperada !== 0) { $pdo->rollBack(); resp(['conflito' => true, 'versao' => 0], 409); }
                $pdo->prepare('INSERT INTO dados (usuario_id, conteudo, versao, atualizado_em) VALUES (?,?,1,?)')->execute([$dono, $cif, agora()]);
                $nova = 1;
            } else {
                if ((int) $atual !== $esperada) { $pdo->rollBack(); resp(['conflito' => true, 'versao' => (int) $atual], 409); }
                $nova = (int) $atual + 1;
                $pdo->prepare('UPDATE dados SET conteudo = ?, versao = ?, atualizado_em = ? WHERE usuario_id = ?')->execute([$cif, $nova, agora(), $dono]);
            }
            $pdo->commit();
            resp(['versao' => $nova]);
        }
        case 'captura_token': {
            $t = 'lf_' . token_aleatorio();
            db()->prepare('DELETE FROM chaves_captura WHERE usuario_id = ?')->execute([$u['id']]);
            db()->prepare('INSERT INTO chaves_captura (hash, usuario_id, criado_em) VALUES (?,?,?)')->execute([hash_token($t), $u['id'], agora()]);
            resp(['token' => $t]);
        }
        case 'captura_teste': {
            $c = captura_interpretar((string) ($b['texto'] ?? ''));
            if (!$c) erro('Não achei um valor em reais nesse texto. Cole o aviso completo do banco.', 422);
            $c['origem'] = 'teste'; $c['h'] = sha1($c['texto'] . $c['valor'] . agora());
            resp(['captura' => ['id' => captura_guardar($dono, $c)] + $c]);
        }
        case 'capturas_resolver': {
            exigir_assinatura($dono);
            $ids = isset($b['ids']) && is_array($b['ids']) ? array_slice(array_map('strval', $b['ids']), 0, 200) : [];
            foreach ($ids as $id) db()->prepare('DELETE FROM capturas WHERE usuario_id = ? AND id = ?')->execute([$dono, substr($id, 0, 32)]);
            resp(['ok' => true]);
        }
        case 'conexao_registrar': {
            // chamado depois que a pessoa conclui a conexão no widget do agregador
            if (!of_config()) erro('Open Finance ainda não está ativado.', 503);
            // Sem isto, qualquer conta registrava uma conexão falsa e openfinance_liberado() passava a liberar o Pluggy para ela.
            if (!openfinance_liberado($dono)) erro('A conexão automática com o banco não está disponível. Importe o extrato OFX ou CSV em Mais opções.', 403);
            exigir_assinatura($dono);
            $item = substr(trim((string) ($b['item_id'] ?? '')), 0, 120); $inst = mb_substr(trim(strip_tags((string) ($b['instituicao'] ?? ''))), 0, 80);
            if ($item === '' || $inst === '') erro('Dados da conexão incompletos.', 422);
            $n = db()->prepare('SELECT COUNT(*) FROM conexoes WHERE usuario_id = ?'); $n->execute([$dono]);
            if ((int) $n->fetchColumn() >= 10) erro('Você chegou ao limite de bancos conectados.', 422);
            $id = novo_id();
            db()->prepare('INSERT INTO conexoes (id, usuario_id, provedor, item_id, instituicao, status, criado_em) VALUES (?,?,?,?,?,?,?)')->execute([$id, $dono, of_config()['provedor'], $item, $inst, 'ativa', agora()]);
            resp(['id' => $id]);
        }
        case 'totp_iniciar': {
            if (totp_ativo($u)) erro('A verificação em dois passos já está ativa.', 422);
            if (limite_estourou('totpi:' . $u['id'], 10, 3600)) erro('Muitas tentativas. Tente mais tarde.', 429);
            registrar_tentativa('totpi:' . $u['id']);
            $seg = totp_novo_segredo();
            db()->prepare('UPDATE usuarios SET totp_segredo = ?, totp_ativo = 0, totp_passo = 0, totp_reservas = NULL WHERE id = ?')->execute([cifrar($seg), $u['id']]);
            resp(['segredo' => $seg, 'uri' => totp_uri($u['email'], $seg)]);
        }
        case 'totp_ativar': {
            $atual = totp_usuario($u['id']);
            if (!$atual || totp_ativo($atual) || empty($atual['totp_segredo'])) erro('Comece pela chave: toque em ativar de novo.', 422);
            if (limite_estourou('totpa:' . $u['id'], 8, 900)) erro('Muitas tentativas. Espere 15 minutos.', 429);
            $seg = (string) decifrar((string) $atual['totp_segredo']);
            $p = totp_conferir_passo($seg, (string) ($b['codigo'] ?? ''), 0);
            if ($p === null) { registrar_tentativa('totpa:' . $u['id']); erro('Código incorreto. Confira se o relógio do celular está certo e digite o código atual do app.', 422); }
            [$mostrar, $hashes] = totp_novos_reservas();
            db()->prepare('UPDATE usuarios SET totp_ativo = 1, totp_passo = ?, totp_reservas = ? WHERE id = ?')->execute([$p, json_encode($hashes), $u['id']]);
            resp(['reservas' => $mostrar, 'usuario' => usuario_publico(totp_usuario($u['id']))]);
        }
        case 'totp_gerenciar': {
            // desativar ou gerar novos códigos de reserva: pede a senha e um código atual
            $atual = totp_usuario($u['id']);
            if (!$atual || !totp_ativo($atual)) erro('A verificação em dois passos não está ativa.', 422);
            if (limite_estourou('totpg:' . $u['id'], 8, 900)) erro('Muitas tentativas. Espere 15 minutos.', 429);
            if (!senha_confere($atual, (string) ($b['senha'] ?? '')) || !totp_validar_usuario($atual, (string) ($b['codigo'] ?? ''))) { registrar_tentativa('totpg:' . $u['id']); erro('Senha ou código incorretos.', 401); }
            if (($b['acao'] ?? '') === 'desativar') {
                db()->prepare('UPDATE usuarios SET totp_ativo = 0, totp_segredo = NULL, totp_passo = 0, totp_reservas = NULL WHERE id = ?')->execute([$u['id']]);
                resp(['usuario' => usuario_publico(totp_usuario($u['id']))]);
            }
            [$mostrar, $hashes] = totp_novos_reservas();
            db()->prepare('UPDATE usuarios SET totp_reservas = ? WHERE id = ?')->execute([json_encode($hashes), $u['id']]);
            resp(['reservas' => $mostrar]);
        }
        case 'pluggy_conectar': {
            // Meu Pluggy (uso pessoal): guarda o Client ID/Secret cifrados, confere no Pluggy e já traz os últimos 30 dias para "Para revisar"
            $item = substr(trim((string) ($b['item_id'] ?? '')), 0, 120); $inst = mb_substr(trim(strip_tags((string) ($b['instituicao'] ?? ''))), 0, 80);
            $cid = substr(trim((string) ($b['client_id'] ?? '')), 0, 120); $seg = substr(trim((string) ($b['client_secret'] ?? '')), 0, 200);
            if (!openfinance_liberado($dono)) erro('A conexão automática com o banco não está disponível. Importe o extrato OFX ou CSV em Mais opções.', 403);
            exigir_assinatura($dono);
            if ($item === '' || $inst === '') erro('Informe o nome do banco e o código do item.', 422);
            if (limite_estourou('ofcx:' . $u['id'], 10, 3600)) erro('Muitas tentativas. Tente de novo mais tarde.', 429);
            registrar_tentativa('ofcx:' . $u['id']);
            $cred = pluggy_cred($dono);
            if ($cid !== '' && $seg !== '') $cred = ['id' => $cid, 'segredo' => $seg];
            if (!$cred) erro('Informe o Client ID e o Client Secret do Pluggy.', 422);
            $n = db()->prepare('SELECT COUNT(*) FROM conexoes WHERE usuario_id = ?'); $n->execute([$dono]);
            if ((int) $n->fetchColumn() >= 5) erro('O Meu Pluggy gratuito aceita até 5 bancos.', 422);
            $dup = db()->prepare('SELECT 1 FROM conexoes WHERE usuario_id = ? AND item_id = ?'); $dup->execute([$dono, $item]);
            if ($dup->fetchColumn()) erro('Esse banco já está conectado.', 422);
            try { $chave = pluggy_chave($cred['id'], $cred['segredo']); pluggy_contas($chave, $item); } catch (RuntimeException $e) { erro($e->getMessage(), 422); }
            pluggy_cred_salvar($dono, $cred['id'], $cred['segredo']);
            $id = novo_id();
            db()->prepare('INSERT INTO conexoes (id, usuario_id, provedor, item_id, instituicao, status, criado_em) VALUES (?,?,?,?,?,?,?)')->execute([$id, $dono, 'meupluggy', $item, $inst, 'ativa', agora()]);
            [$novas, $err] = pluggy_sincronizar($dono, $id);
            resp(['id' => $id, 'novas' => $novas, 'aviso' => $err]);
        }
        case 'conexao_sincronizar': {
            if (limite_estourou('ofsync:' . $u['id'], 6, 3600)) erro('Você já atualizou várias vezes. O Meu Pluggy só traz novidades a cada 24 horas; tente mais tarde.', 429);
            registrar_tentativa('ofsync:' . $u['id']);
            [$novas, $err] = pluggy_sincronizar($dono);
            if ($err !== null && $novas === 0) erro($err, 422);
            resp(['novas' => $novas, 'aviso' => $err]);
        }
        case 'pluggy_esquecer': {
            db()->prepare('DELETE FROM of_pluggy WHERE usuario_id = ?')->execute([$dono]);
            db()->prepare("DELETE FROM conexoes WHERE usuario_id = ? AND provedor = 'meupluggy'")->execute([$dono]);
            resp(['ok' => true]);
        }
        case 'conexao_remover': {
            db()->prepare('DELETE FROM conexoes WHERE usuario_id = ? AND id = ?')->execute([$dono, substr((string) ($b['id'] ?? ''), 0, 32)]);
            resp(['ok' => true]);
        }
        case 'anexo_enviar': {
            exigir_assinatura($dono);
            $lanc = substr((string) ($b['lanc'] ?? ''), 0, 64); $d = (string) ($b['dataUrl'] ?? '');
            if ($lanc === '') erro('Lançamento inválido.', 422);
            if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $d, $m) || strlen($d) > 900000) erro('Imagem inválida ou grande demais.', 422);
            $bin = base64_decode($m[2], true); $info = $bin !== false ? @getimagesizefromstring($bin) : false;
            if (!$info || $info[0] > 2400 || $info[1] > 2400) erro('Imagem inválida.', 422);
            $n = db()->prepare('SELECT COUNT(*) FROM anexos WHERE usuario_id = ? AND lanc_id = ?'); $n->execute([$dono, $lanc]);
            if ((int) $n->fetchColumn() >= 5) erro('Cada lançamento aceita até 5 fotos.', 422);
            $t = db()->prepare('SELECT COUNT(*) FROM anexos WHERE usuario_id = ?'); $t->execute([$dono]);
            if ((int) $t->fetchColumn() >= 300) erro('Você chegou ao limite de fotos guardadas.', 422);
            $id = novo_id();
            db()->prepare('INSERT INTO anexos (id, usuario_id, lanc_id, conteudo, criado_em) VALUES (?,?,?,?,?)')->execute([$id, $dono, $lanc, cifrar($d), agora()]);
            resp(['id' => $id]);
        }
        case 'anexo_excluir': {
            if (!empty($b['id'])) db()->prepare('DELETE FROM anexos WHERE usuario_id = ? AND id = ?')->execute([$dono, substr((string) $b['id'], 0, 32)]);
            elseif (!empty($b['lanc'])) db()->prepare('DELETE FROM anexos WHERE usuario_id = ? AND lanc_id = ?')->execute([$dono, substr((string) $b['lanc'], 0, 64)]);
            resp(['ok' => true]);
        }
        case 'preferencias': {
            $nome = isset($b['nome']) ? trim((string) $b['nome']) : $u['nome'];
            if ($nome === '' || mb_strlen($nome) > 120) erro('Informe seu nome.', 422);
            $avisos = isset($b['avisos']) ? (int) (bool) $b['avisos'] : (int) $u['avisos'];
            $foto = $u['foto'] ?? null;
            if (array_key_exists('foto', $b)) $foto = ($b['foto'] === null || $b['foto'] === '') ? null : validar_foto((string) $b['foto']);
            $resumo = isset($b['resumo']) ? (int) (bool) $b['resumo'] : (int) ($u['resumo'] ?? 1);
            $lembrete = isset($b['lembrete']) ? (int) (bool) $b['lembrete'] : (int) ($u['lembrete'] ?? 0);
            db()->prepare('UPDATE usuarios SET nome = ?, avisos = ?, foto = ?, resumo = ?, lembrete = ? WHERE id = ?')->execute([$nome, $avisos, $foto, $resumo, $lembrete, $u['id']]);
            $u['nome'] = $nome; $u['avisos'] = $avisos; $u['foto'] = $foto; $u['resumo'] = $resumo; $u['lembrete'] = $lembrete;
            resp(['usuario' => usuario_publico($u)]);
        }
        case 'senha_link': {
            // Conta criada pelo Google/Microsoft nasce com senha aleatória que ninguém conhece: quem está logado pode pedir o link por e-mail para criar a sua.
            $k = 'senhalink:' . $u['id'];
            if (limite_estourou($k, 3, 3600)) erro('Muitos pedidos. Tente de novo em 1 hora.', 429);
            registrar_tentativa($k);
            enviar_link_redefinir($u['email'], criar_token($u['id'], 'redefinir', 3600), $link);
            resp(['ok' => true, 'email' => $u['email']]);
        }
        case 'mudar_senha': {
            $k = 'troca:' . $u['id'];
            if (limite_estourou($k, 5, 900)) erro('Muitas tentativas. Espere 15 minutos.', 429);
            if (!senha_confere($u, (string) ($b['atual'] ?? ''))) { registrar_tentativa($k); erro('A senha atual está incorreta.', 401); }
            $nova = (string) ($b['nova'] ?? '');
            validar_senha($nova, $u['email']);
            db()->prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')->execute([gerar_hash($nova), $u['id']]);
            db()->prepare('DELETE FROM sessoes WHERE usuario_id = ? AND hash <> ?')->execute([$u['id'], hash_token((string) $_COOKIE['lf_sessao'])]);
            db()->prepare("DELETE FROM tokens WHERE usuario_id = ? AND tipo = 'redefinir'")->execute([$u['id']]); // link de nova senha pedido antes não vale mais
            enviar_email($u['email'], 'Sua senha do Lepvi Finanças foi alterada', email_html('Senha alterada', '<p>A senha da sua conta foi alterada agora. Se não foi você, use "Esqueci minha senha" na tela de entrada e fale com a gente: lepvi@lepvi.com.br.</p>'));
            resp(['ok' => true]);
        }
        case 'convite_criar': {
            if ($dono !== $u['id']) erro('Só quem criou o espaço pode convidar.', 403);
            if (limite_estourou('conv:' . $u['id'], 10, 3600)) erro('Muitos convites. Tente de novo mais tarde.', 429);
            registrar_tentativa('conv:' . $u['id']);
            if (count(espaco_membros($u['id'])) >= ESPACO_MAX_MEMBROS) erro('O espaço já tem duas pessoas. Remova a outra pessoa para convidar alguém.', 422);
            resp(['token' => criar_token($u['id'], 'convite', 7 * 86400)]);
        }
        case 'convite_aceitar': {
            $k = 'convacc:' . $u['id'];
            if (limite_estourou($k, 10, 900)) erro('Muitas tentativas. Espere alguns minutos.', 429);
            registrar_tentativa($k);
            $t = (string) ($b['token'] ?? '');
            $s = db()->prepare('SELECT usuario_id FROM tokens WHERE hash = ? AND tipo = ? AND expira_em > ?');
            $s->execute([hash_token($t), 'convite', agora()]);
            $de = strlen($t) <= 100 ? $s->fetchColumn() : false;
            if (!$de) erro('Este convite não vale mais. Peça um novo link para a outra pessoa.', 422);
            $de = (string) $de;
            if ($de === $u['id']) erro('Este convite é da sua própria conta.', 422);
            if ($dono !== $u['id']) erro('Você já está num espaço compartilhado. Saia dele antes de entrar em outro.', 422);
            if (count(espaco_membros($u['id'])) > 0) erro('Você já compartilha o seu espaço. Encerre o compartilhamento antes de entrar no de outra pessoa.', 422);
            if (espaco_dono($de) !== $de) erro('Este convite não vale mais. Peça um novo link.', 422);
            if (count(espaco_membros($de)) >= ESPACO_MAX_MEMBROS) erro('O espaço já tem duas pessoas.', 422);
            $q = db()->prepare('SELECT nome, email FROM usuarios WHERE id = ?'); $q->execute([$de]); $o = $q->fetch();
            if (!$o) erro('Este convite não vale mais.', 422);
            // O convite vale uma vez: só entra quem conseguiu apagá-lo (dois aceites ao mesmo tempo não passam do limite de pessoas).
            $pdo = db(); $pdo->beginTransaction();
            $del = $pdo->prepare('DELETE FROM tokens WHERE hash = ? AND tipo = ?'); $del->execute([hash_token($t), 'convite']);
            if ($del->rowCount() !== 1) { $pdo->rollBack(); erro('Este convite não vale mais. Peça um novo link para a outra pessoa.', 422); }
            $pdo->prepare('INSERT INTO membros (usuario_id, dono_id, entrou_em) VALUES (?,?,?)')->execute([$u['id'], $de, agora()]);
            $pdo->commit();
            enviar_email($o['email'], $u['nome'] . ' entrou no seu espaço do Lepvi Finanças', email_html('Nova pessoa no seu espaço', '<p><b>' . htmlspecialchars($u['nome']) . '</b> aceitou o seu convite e agora vê e edita os mesmos lançamentos que você. Você pode remover essa pessoa quando quiser, em Mais opções → Compartilhar.</p>'));
            resp(['ok' => true, 'dono' => $o['nome']]);
        }
        case 'espaco_sair': {
            if ($dono === $u['id']) erro('Você não está no espaço de outra pessoa.', 422);
            $q = db()->prepare('SELECT email FROM usuarios WHERE id = ?'); $q->execute([$dono]); $em = $q->fetchColumn();
            db()->prepare('DELETE FROM membros WHERE usuario_id = ?')->execute([$u['id']]);
            if ($em) enviar_email((string) $em, $u['nome'] . ' saiu do seu espaço do Lepvi Finanças', email_html('Uma pessoa saiu do seu espaço', '<p><b>' . htmlspecialchars($u['nome']) . '</b> saiu do espaço compartilhado. Os seus lançamentos continuam com você.</p>'));
            resp(['ok' => true]);
        }
        case 'espaco_remover': {
            $id = substr((string) ($b['id'] ?? ''), 0, 32);
            $q = db()->prepare('SELECT usuario_id FROM membros WHERE usuario_id = ? AND dono_id = ?'); $q->execute([$id, $u['id']]);
            if (!$q->fetchColumn()) erro('Essa pessoa não está no seu espaço.', 404);
            db()->prepare('DELETE FROM membros WHERE usuario_id = ? AND dono_id = ?')->execute([$id, $u['id']]);
            resp(['ok' => true]);
        }
        case 'assinar': {
            // Paga primeiro: abre a cobrança do Asaas (Pix, boleto ou cartão). O 1º pagamento libera 37 dias.
            if ($dono !== $u['id']) erro('Quem paga a assinatura é a pessoa que criou este espaço compartilhado.', 403);
            if (asaas_config() === null) erro('A assinatura ainda não está disponível. Seu acesso continua liberado.', 409);
            if (assinatura_situacao($dono)['isento']) erro('Sua conta já é liberada: não precisa assinar.', 409);
            $cpf = (string) ($b['cpf'] ?? '');
            if (!cpf_cnpj_valido($cpf)) erro('Confira o CPF ou CNPJ: ele é exigido para emitir a cobrança.', 422);
            if (limite_estourou('assin:' . $u['id'], 10, 3600)) erro('Muitas tentativas. Tente de novo mais tarde.', 429);
            registrar_tentativa('assin:' . $u['id']);
            try { $url = assinatura_assinar($dono, (string) $u['nome'], (string) $u['email'], $cpf); } catch (RuntimeException $e) { erro($e->getMessage(), 422); }
            resp(['url' => $url]);
        }
        case 'assinatura_cancelar': {
            // Cancela as próximas cobranças; o acesso já pago continua até o fim.
            if ($dono !== $u['id']) erro('Quem cancela a assinatura é a pessoa que criou este espaço compartilhado.', 403);
            try { assinatura_cancelar($dono); } catch (RuntimeException $e) { erro($e->getMessage(), 422); }
            resp(assinatura_situacao($dono) + ['dono' => true]);
        }
        case 'excluir': {
            $k = 'excl:' . $u['id'];
            if (limite_estourou($k, 5, 900)) erro('Muitas tentativas. Espere 15 minutos.', 429);
            if (!senha_confere($u, (string) ($b['senha'] ?? ''))) { registrar_tentativa($k); erro('Senha incorreta.', 401); }
            // Excluir a conta também para a cobrança: nada é cobrado depois.
            if (asaas_config() !== null) { try { assinatura_cancelar($u['id']); } catch (Throwable $e) { error_log('[lepvi-financas assinatura] ' . $e->getMessage()); } }
            assinatura_tabelas();
            $pdo = db(); $pdo->beginTransaction();
            foreach (['assinaturas', 'sessoes', 'tokens', 'dados', 'avisos', 'consentimentos', 'identidades', 'chaves_captura', 'capturas', 'anexos', 'conexoes', 'of_vistos', 'of_pluggy'] as $t) $pdo->prepare("DELETE FROM $t WHERE usuario_id = ?")->execute([$u['id']]);
            $pdo->prepare('DELETE FROM membros WHERE usuario_id = ? OR dono_id = ?')->execute([$u['id'], $u['id']]);
            $pdo->prepare('DELETE FROM usuarios WHERE id = ?')->execute([$u['id']]);
            $pdo->commit();
            fechar_cookie();
            enviar_email($u['email'], 'Sua conta do Lepvi Finanças foi excluída', email_html('Conta excluída', '<p>Sua conta e todos os seus dados foram apagados, como você pediu. Obrigado por ter usado o Lepvi Finanças.</p>'));
            resp(['ok' => true]);
        }
    }
    erro('Ação desconhecida.', 404);
} catch (Throwable $e) {
    error_log('[lepvi-financas] ' . $e->getMessage() . ' em ' . $e->getFile() . ':' . $e->getLine());
    erro('Algo deu errado do nosso lado. Tente de novo em instantes.', 500);
}
