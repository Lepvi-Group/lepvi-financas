<?php
declare(strict_types=1);
/* Lepvi Finanças: API. Uma ação por chamada: /api/?a=entrar etc. Produto separado do site e do Hub. */
require __DIR__ . '/_oauth.php';
require __DIR__ . '/_captura.php';

$acao = (string) ($_GET['a'] ?? '');
$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$link = fn(string $q) => rtrim(cfg()['site_url'], '/') . '/?' . $q;

try {
    if ($metodo === 'GET' && $acao === 'config') resp(['turnstile' => turnstile_config()['site_key'] ?? null]);
    // Entrada com Google/Microsoft: dados da pessoa que ainda precisa aceitar a Política e os Termos
    if ($metodo === 'GET' && $acao === 'oauth_pendente') {
        $pend = ler_assinado((string) ($_COOKIE['lf_novo'] ?? ''));
        if (!$pend) erro('Pedido expirado. Entre de novo.', 404);
        resp(['provedor' => oauth_provedores()[$pend['p']]['nome'] ?? '', 'email' => $pend['email'], 'nome' => $pend['nome']]);
    }
    // Leitura sem efeito colateral (exportar baixa um arquivo).
    if ($metodo === 'GET' && in_array($acao, ['eu', 'dados', 'exportar', 'capturas', 'anexos', 'anexo'], true)) {
        $u = exigir_usuario();
        if ($acao === 'eu') resp(['usuario' => usuario_publico($u)]);
        if ($acao === 'capturas') {
            $k = db()->prepare('SELECT criado_em, ultimo_uso FROM chaves_captura WHERE usuario_id = ?');
            $k->execute([$u['id']]);
            $ch = $k->fetch();
            resp(['capturas' => capturas_listar($u['id']), 'chave' => $ch ? ['criada_em' => (int) $ch['criado_em'], 'ultimo_uso' => $ch['ultimo_uso'] !== null ? (int) $ch['ultimo_uso'] : null] : null]);
        }
        if ($acao === 'anexos') {
            $s = db()->prepare('SELECT id, criado_em FROM anexos WHERE usuario_id = ? AND lanc_id = ? ORDER BY criado_em');
            $s->execute([$u['id'], substr((string) ($_GET['lanc'] ?? ''), 0, 64)]);
            resp(['anexos' => $s->fetchAll()]);
        }
        if ($acao === 'anexo') {
            $s = db()->prepare('SELECT conteudo FROM anexos WHERE usuario_id = ? AND id = ?');
            $s->execute([$u['id'], substr((string) ($_GET['id'] ?? ''), 0, 32)]);
            $c = $s->fetchColumn();
            if ($c === false) erro('Anexo não encontrado.', 404);
            resp(['dataUrl' => decifrar((string) $c)]);
        }
        if ($acao === 'dados') {
            $s = db()->prepare('SELECT conteudo, versao FROM dados WHERE usuario_id = ?');
            $s->execute([$u['id']]);
            $l = $s->fetch();
            resp(['versao' => $l ? (int) $l['versao'] : 0, 'conteudo' => $l ? json_decode((string) decifrar($l['conteudo']), true) : null]);
        }
        // exportar: todos os dados da pessoa (LGPD, direito de acesso e portabilidade)
        $s = db()->prepare('SELECT conteudo, versao, atualizado_em FROM dados WHERE usuario_id = ?');
        $s->execute([$u['id']]);
        $d = $s->fetch();
        $c = db()->prepare('SELECT tipo, versao, quando FROM consentimentos WHERE usuario_id = ? ORDER BY quando');
        $c->execute([$u['id']]);
        $an = db()->prepare('SELECT id, lanc_id, conteudo, criado_em FROM anexos WHERE usuario_id = ? ORDER BY criado_em');
        $an->execute([$u['id']]);
        $fotos = array_map(fn($x) => ['id' => $x['id'], 'lancamento' => $x['lanc_id'], 'em' => date('c', (int) $x['criado_em']), 'imagem' => decifrar((string) $x['conteudo'])], $an->fetchAll());
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('Content-Disposition: attachment; filename="meus-dados-lepvi-financas.json"');
        echo json_encode([
            'gerado_em' => date('c'),
            'conta' => ['email' => $u['email'], 'nome' => $u['nome'], 'tem_foto' => !empty($u['foto']), 'criada_em' => date('c', (int) $u['criado_em']), 'avisos_por_email' => (bool) $u['avisos'], 'email_confirmado' => (bool) $u['email_verificado']],
            'consentimentos' => array_map(fn($x) => ['tipo' => $x['tipo'], 'versao' => $x['versao'], 'em' => date('c', (int) $x['quando'])], $c->fetchAll()),
            'dados_financeiros' => $d ? json_decode((string) decifrar($d['conteudo']), true) : null,
            'avisos_do_banco_para_revisar' => capturas_listar($u['id']),
            'fotos_de_comprovantes' => $fotos,
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    if ($metodo !== 'POST') erro('Método não permitido.', 405);
    exigir_origem();
    $b = corpo();

    switch ($acao) {
        case 'oauth_concluir': {
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
            if (password_needs_rehash($u['senha_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
                db()->prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')->execute([gerar_hash($senha), $u['id']]);
            }
            db()->prepare('UPDATE usuarios SET ultimo_login = ? WHERE id = ?')->execute([agora(), $u['id']]);
            abrir_sessao($u['id']);
            resp(['usuario' => usuario_publico($u)]);
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
                    enviar_email($email, 'Crie uma nova senha para o Lepvi Finanças', email_html('Redefinir senha', '<p style="margin:0 0 12px">Recebemos um pedido para criar uma nova senha para a sua conta.</p><p style="margin:0">O link vale por <b>1 hora</b>. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>', 'Criar nova senha', $link('redefinir=' . $t), 'Link para criar uma nova senha (vale por 1 hora).'));
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
    switch ($acao) {
        case 'dados': {
            $esperada = (int) ($b['versao'] ?? -1);
            $conteudo = $b['conteudo'] ?? null;
            if (!is_array($conteudo)) erro('Dados inválidos.', 422);
            $json = json_encode($conteudo, JSON_UNESCAPED_UNICODE);
            if ($json === false || strlen($json) > 1500000) erro('Dados grandes demais.', 413);
            $cif = cifrar($json);
            $pdo = db();
            $pdo->beginTransaction();
            $s = $pdo->prepare('SELECT versao FROM dados WHERE usuario_id = ?');
            $s->execute([$u['id']]);
            $atual = $s->fetchColumn();
            if ($atual === false) {
                if ($esperada !== 0) { $pdo->rollBack(); resp(['conflito' => true, 'versao' => 0], 409); }
                $pdo->prepare('INSERT INTO dados (usuario_id, conteudo, versao, atualizado_em) VALUES (?,?,1,?)')->execute([$u['id'], $cif, agora()]);
                $nova = 1;
            } else {
                if ((int) $atual !== $esperada) { $pdo->rollBack(); resp(['conflito' => true, 'versao' => (int) $atual], 409); }
                $nova = (int) $atual + 1;
                $pdo->prepare('UPDATE dados SET conteudo = ?, versao = ?, atualizado_em = ? WHERE usuario_id = ?')->execute([$cif, $nova, agora(), $u['id']]);
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
            resp(['captura' => ['id' => captura_guardar($u['id'], $c)] + $c]);
        }
        case 'capturas_resolver': {
            $ids = isset($b['ids']) && is_array($b['ids']) ? array_slice(array_map('strval', $b['ids']), 0, 200) : [];
            foreach ($ids as $id) db()->prepare('DELETE FROM capturas WHERE usuario_id = ? AND id = ?')->execute([$u['id'], substr($id, 0, 32)]);
            resp(['ok' => true]);
        }
        case 'anexo_enviar': {
            $lanc = substr((string) ($b['lanc'] ?? ''), 0, 64); $d = (string) ($b['dataUrl'] ?? '');
            if ($lanc === '') erro('Lançamento inválido.', 422);
            if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $d, $m) || strlen($d) > 900000) erro('Imagem inválida ou grande demais.', 422);
            $bin = base64_decode($m[2], true); $info = $bin !== false ? @getimagesizefromstring($bin) : false;
            if (!$info || $info[0] > 2400 || $info[1] > 2400) erro('Imagem inválida.', 422);
            $n = db()->prepare('SELECT COUNT(*) FROM anexos WHERE usuario_id = ? AND lanc_id = ?'); $n->execute([$u['id'], $lanc]);
            if ((int) $n->fetchColumn() >= 5) erro('Cada lançamento aceita até 5 fotos.', 422);
            $t = db()->prepare('SELECT COUNT(*) FROM anexos WHERE usuario_id = ?'); $t->execute([$u['id']]);
            if ((int) $t->fetchColumn() >= 300) erro('Você chegou ao limite de fotos guardadas.', 422);
            $id = novo_id();
            db()->prepare('INSERT INTO anexos (id, usuario_id, lanc_id, conteudo, criado_em) VALUES (?,?,?,?,?)')->execute([$id, $u['id'], $lanc, cifrar($d), agora()]);
            resp(['id' => $id]);
        }
        case 'anexo_excluir': {
            if (!empty($b['id'])) db()->prepare('DELETE FROM anexos WHERE usuario_id = ? AND id = ?')->execute([$u['id'], substr((string) $b['id'], 0, 32)]);
            elseif (!empty($b['lanc'])) db()->prepare('DELETE FROM anexos WHERE usuario_id = ? AND lanc_id = ?')->execute([$u['id'], substr((string) $b['lanc'], 0, 64)]);
            resp(['ok' => true]);
        }
        case 'preferencias': {
            $nome = isset($b['nome']) ? trim((string) $b['nome']) : $u['nome'];
            if ($nome === '' || mb_strlen($nome) > 120) erro('Informe seu nome.', 422);
            $avisos = isset($b['avisos']) ? (int) (bool) $b['avisos'] : (int) $u['avisos'];
            $foto = $u['foto'] ?? null;
            if (array_key_exists('foto', $b)) $foto = ($b['foto'] === null || $b['foto'] === '') ? null : validar_foto((string) $b['foto']);
            $resumo = isset($b['resumo']) ? (int) (bool) $b['resumo'] : (int) ($u['resumo'] ?? 1);
            db()->prepare('UPDATE usuarios SET nome = ?, avisos = ?, foto = ?, resumo = ? WHERE id = ?')->execute([$nome, $avisos, $foto, $resumo, $u['id']]);
            $u['nome'] = $nome; $u['avisos'] = $avisos; $u['foto'] = $foto; $u['resumo'] = $resumo;
            resp(['usuario' => usuario_publico($u)]);
        }
        case 'mudar_senha': {
            $k = 'troca:' . $u['id'];
            if (limite_estourou($k, 5, 900)) erro('Muitas tentativas. Espere 15 minutos.', 429);
            if (!senha_confere($u, (string) ($b['atual'] ?? ''))) { registrar_tentativa($k); erro('A senha atual está incorreta.', 401); }
            $nova = (string) ($b['nova'] ?? '');
            validar_senha($nova, $u['email']);
            db()->prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')->execute([gerar_hash($nova), $u['id']]);
            db()->prepare('DELETE FROM sessoes WHERE usuario_id = ? AND hash <> ?')->execute([$u['id'], hash_token((string) $_COOKIE['lf_sessao'])]);
            enviar_email($u['email'], 'Sua senha do Lepvi Finanças foi alterada', email_html('Senha alterada', '<p>A senha da sua conta foi alterada agora. Se não foi você, use "Esqueci minha senha" na tela de entrada e fale com a gente: lepvi@lepvi.com.br.</p>'));
            resp(['ok' => true]);
        }
        case 'excluir': {
            $k = 'excl:' . $u['id'];
            if (limite_estourou($k, 5, 900)) erro('Muitas tentativas. Espere 15 minutos.', 429);
            if (!senha_confere($u, (string) ($b['senha'] ?? ''))) { registrar_tentativa($k); erro('Senha incorreta.', 401); }
            $pdo = db(); $pdo->beginTransaction();
            foreach (['sessoes', 'tokens', 'dados', 'avisos', 'consentimentos', 'identidades', 'chaves_captura', 'capturas', 'anexos'] as $t) $pdo->prepare("DELETE FROM $t WHERE usuario_id = ?")->execute([$u['id']]);
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
