<?php
declare(strict_types=1);
/* Lepvi Finanças: peças compartilhadas da API (banco, segurança, e-mail). Produto separado do site e do Hub. */

const VERSAO_TERMOS = '2026-11-21';
const SESSAO_DIAS = 14;

function cfg(): array
{
    static $c = null;
    if ($c === null) {
        $arq = __DIR__ . '/_config.php';
        $c = is_file($arq) ? (array) require $arq : [];
        // Produção (Hostinger): o servidor gera o próprio segredo e guarda banco e segredo FORA da pasta pública
        // (…/domains/<dominio>/financas-dados), onde nenhum endereço da internet alcança e que os envios do site não apagam.
        if (!$c && preg_match('#^(.*/domains/([^/]+))/public_html#', str_replace('\\', '/', __DIR__), $m)) {
            $estado = $m[1] . '/financas-dados';
            if (!is_dir($estado)) @mkdir($estado, 0700, true);
            $arqSegredo = $estado . '/segredo.txt';
            if (!is_file($arqSegredo) && ($f = @fopen($arqSegredo, 'x'))) { fwrite($f, bin2hex(random_bytes(32))); fclose($f); @chmod($arqSegredo, 0600); }
            $c = [
                'db_dsn' => 'sqlite:' . $estado . '/financas.sqlite',
                'segredo' => trim((string) @file_get_contents($arqSegredo)),
                // O app responde em mais de um endereço; cada pessoa usa o que abriu. Rotinas sem navegador (avisos por e-mail) usam o principal.
                'hosts' => array_values(array_unique([strtolower($m[2]), 'financas.lepvi.com.br'])),
                'site_url' => 'https://' . (in_array(strtolower($_SERVER['HTTP_HOST'] ?? ''), [strtolower($m[2]), 'financas.lepvi.com.br'], true) ? strtolower($_SERVER['HTTP_HOST']) : 'financas.lepvi.com.br'),
                'email_modo' => 'enviar',
                'cookie_seguro' => true,
                'estado' => $estado,
            ];
        }
        $c += [
            'db_dsn' => 'sqlite:' . dirname(__DIR__) . '/.dev/financas.sqlite',
            'db_usuario' => null, 'db_senha' => null,
            'segredo' => 'segredo-so-para-testes-locais-0123456789abcdef',
            'site_url' => 'http://localhost:4180',
            'email_de' => 'lepvi@lepvi.com.br',
            'email_modo' => 'log',      // 'log' (testes) ou 'enviar' (produção)
            'cookie_seguro' => false,
            'estado' => dirname(__DIR__) . '/.dev',
        ];
        if (getenv('LEPVI_FINANCAS_DSN')) $c['db_dsn'] = (string) getenv('LEPVI_FINANCAS_DSN');
        if (getenv('LEPVI_FINANCAS_ESTADO')) $c['estado'] = (string) getenv('LEPVI_FINANCAS_ESTADO');
    }
    return $c;
}

/* Chaves derivadas do segredo: uma para cada uso. */
function chave(string $uso): string { return hash_hmac('sha256', $uso, cfg()['segredo'], true); }

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = cfg();
    if (str_starts_with($c['db_dsn'], 'sqlite:')) {
        $arq = substr($c['db_dsn'], 7);
        if (!is_dir(dirname($arq))) mkdir(dirname($arq), 0700, true);
    }
    $pdo = new PDO($c['db_dsn'], $c['db_usuario'], $c['db_senha'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    if (str_starts_with($c['db_dsn'], 'sqlite:')) { $pdo->exec('PRAGMA journal_mode = WAL'); $pdo->exec('PRAGMA busy_timeout = 5000'); $pdo->exec('PRAGMA secure_delete = ON'); }
    try {
        $pdo->query('SELECT 1 FROM usuarios LIMIT 1');
    } catch (Throwable $e) {
        foreach (array_filter(array_map('trim', explode(';', (string) file_get_contents(__DIR__ . '/schema.sql')))) as $sql) {
            try { $pdo->exec($sql); } catch (Throwable $e2) { /* já existe */ }
        }
    }
    try { $pdo->query('SELECT 1 FROM identidades LIMIT 1'); } catch (Throwable $e) { try { $pdo->exec('CREATE TABLE IF NOT EXISTS identidades (provedor VARCHAR(20) NOT NULL, sub VARCHAR(190) NOT NULL, usuario_id VARCHAR(32) NOT NULL, criado_em INTEGER NOT NULL, PRIMARY KEY (provedor, sub))'); } catch (Throwable $e2) { /* já existe */ } }
    try { $pdo->query('SELECT foto FROM usuarios LIMIT 1'); } catch (Throwable $e) { try { $pdo->exec('ALTER TABLE usuarios ADD COLUMN foto LONGTEXT NULL'); } catch (Throwable $e2) { /* já existe */ } }
    return $pdo;
}

function agora(): int { return (int) ($GLOBALS['AGORA_TESTE'] ?? time()); }
function novo_id(): string { return bin2hex(random_bytes(16)); }
function token_aleatorio(): string { return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); }
function hash_token(string $t): string { return hash('sha256', $t); }
function ip_hash(): string { return substr(hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? 'cli', chave('ip')), 0, 32); }

/* ---------- resposta e entrada ---------- */
function cabecalhos_seguros(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
}
function resp(array $d, int $codigo = 200): never
{
    http_response_code($codigo);
    cabecalhos_seguros();
    echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function erro(string $msg, int $codigo = 400): never { resp(['erro' => $msg], $codigo); }

/* Exige pedido vindo do próprio app: cabeçalho próprio + origem igual ao site (proteção contra CSRF). */
function exigir_origem(): void
{
    if (($_SERVER['HTTP_X_LEPVI'] ?? '') !== 'financas') erro('Pedido não permitido.', 403);
    $origem = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origem !== '') {
        $esperados = cfg()['hosts'] ?? [parse_url(cfg()['site_url'], PHP_URL_HOST)];
        if (!in_array(parse_url($origem, PHP_URL_HOST), $esperados, true)) erro('Origem não permitida.', 403);
    }
}
function corpo(int $max = 2000000): array
{
    $bruto = file_get_contents('php://input', false, null, 0, $max + 1);
    if ($bruto === false || strlen($bruto) > $max) erro('Dados grandes demais.', 413);
    $j = json_decode($bruto, true);
    if (!is_array($j)) erro('Pedido inválido.', 400);
    return $j;
}

/* ---------- limite de tentativas ---------- */
function limite_estourou(string $chave, int $max, int $janela): bool
{
    $s = db()->prepare('SELECT COUNT(*) FROM tentativas WHERE chave = ? AND quando > ?');
    $s->execute([$chave, agora() - $janela]);
    return (int) $s->fetchColumn() >= $max;
}
function registrar_tentativa(string $chave): void
{
    db()->prepare('INSERT INTO tentativas (chave, quando) VALUES (?, ?)')->execute([$chave, agora()]);
    if (random_int(1, 50) === 1) db()->prepare('DELETE FROM tentativas WHERE quando < ?')->execute([agora() - 86400]);
}

/* ---------- senhas e sessões ---------- */
function validar_email(string $e): string
{
    $e = mb_strtolower(trim($e));
    if (strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) erro('Informe um e-mail válido.', 422);
    return $e;
}
function validar_senha(string $s, string $email = ''): void
{
    if (mb_strlen($s) < 10) erro('A senha precisa ter pelo menos 10 caracteres.', 422);
    if (mb_strlen($s) > 200) erro('Senha grande demais.', 422);
    if ($email !== '' && mb_strtolower($s) === $email) erro('A senha não pode ser igual ao e-mail.', 422);
    if (preg_match('/^(.)\1+$/u', $s) || in_array(mb_strtolower($s), ['1234567890', 'senha12345', 'password123', 'qwertyuiop', '0123456789'], true)) erro('Escolha uma senha menos previsível.', 422);
}
function gerar_hash(string $senha): string
{
    return password_hash($senha, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
}
function senha_confere(?array $usuario, string $senha): bool
{
    // Sempre faz uma verificação (mesmo sem usuário) para o tempo de resposta não revelar se o e-mail existe.
    static $falso = null;
    $falso ??= gerar_hash('senha-falsa-para-igualar-tempo');
    $ok = password_verify($senha, $usuario['senha_hash'] ?? $falso);
    return $usuario !== null && $ok;
}
function abrir_sessao(string $uid): void
{
    $t = token_aleatorio();
    db()->prepare('INSERT INTO sessoes (hash, usuario_id, expira_em, criado_em) VALUES (?,?,?,?)')
        ->execute([hash_token($t), $uid, agora() + SESSAO_DIAS * 86400, agora()]);
    setcookie('lf_sessao', $t, ['expires' => agora() + SESSAO_DIAS * 86400, 'path' => '/', 'secure' => (bool) cfg()['cookie_seguro'], 'httponly' => true, 'samesite' => 'Lax']);
}
function fechar_cookie(): void
{
    setcookie('lf_sessao', '', ['expires' => 1, 'path' => '/', 'secure' => (bool) cfg()['cookie_seguro'], 'httponly' => true, 'samesite' => 'Lax']);
}
function usuario_atual(): ?array
{
    $t = $_COOKIE['lf_sessao'] ?? '';
    if ($t === '' || strlen($t) > 100) return null;
    $s = db()->prepare('SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.hash = ? AND s.expira_em > ?');
    $s->execute([hash_token($t), agora()]);
    return $s->fetch() ?: null;
}
/* Foto de perfil: o app já reduz e recomprime (isso também tira dados de localização da imagem); aqui só conferimos. */
function validar_foto(string $d): string
{
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $d, $m)) erro('Foto inválida. Use uma imagem JPG, PNG ou WebP.', 422);
    if (strlen($d) > 250000) erro('A foto é grande demais.', 413);
    $bin = base64_decode($m[2], true);
    $info = $bin !== false ? @getimagesizefromstring($bin) : false;
    if (!$info || !in_array($info['mime'], ['image/jpeg', 'image/png', 'image/webp'], true) || $info[0] > 1024 || $info[1] > 1024) erro('Foto inválida.', 422);
    return $d;
}
function exigir_usuario(): array { return usuario_atual() ?? erro('Entre para continuar.', 401); }
function usuario_publico(array $u): array
{
    return ['email' => $u['email'], 'nome' => $u['nome'], 'foto' => $u['foto'] ?? null, 'avisos' => (bool) $u['avisos'], 'email_verificado' => (bool) $u['email_verificado'], 'aceite_versao' => $u['aceite_versao'], 'criado_em' => (int) $u['criado_em']];
}
function criar_token(string $uid, string $tipo, int $segundos): string
{
    db()->prepare('DELETE FROM tokens WHERE usuario_id = ? AND tipo = ?')->execute([$uid, $tipo]);
    $t = token_aleatorio();
    db()->prepare('INSERT INTO tokens (hash, usuario_id, tipo, expira_em) VALUES (?,?,?,?)')->execute([hash_token($t), $uid, $tipo, agora() + $segundos]);
    return $t;
}
function consumir_token(string $t, string $tipo): ?string
{
    if ($t === '' || strlen($t) > 100) return null;
    $s = db()->prepare('SELECT usuario_id FROM tokens WHERE hash = ? AND tipo = ? AND expira_em > ?');
    $s->execute([hash_token($t), $tipo, agora()]);
    $uid = $s->fetchColumn();
    if ($uid === false) return null;
    db()->prepare('DELETE FROM tokens WHERE hash = ?')->execute([hash_token($t)]);
    return (string) $uid;
}

/* ---------- dados financeiros cifrados (AES-256-GCM, do OpenSSL: existe em qualquer hospedagem PHP) ---------- */
function cifrar(string $texto): string
{
    $iv = random_bytes(12); $tag = '';
    $c = openssl_encrypt($texto, 'aes-256-gcm', chave('dados'), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    if ($c === false || strlen($tag) !== 16) throw new RuntimeException('Falha ao cifrar os dados.');
    return base64_encode('G1' . $iv . $tag . $c);
}
function decifrar(string $b64): ?string
{
    $bin = base64_decode($b64, true);
    if ($bin === false || strlen($bin) < 31 || substr($bin, 0, 2) !== 'G1') return null;
    $r = openssl_decrypt(substr($bin, 30), 'aes-256-gcm', chave('dados'), OPENSSL_RAW_DATA, substr($bin, 2, 12), substr($bin, 14, 16));
    return $r === false ? null : $r;
}

/* ---------- e-mail ---------- */
function email_html(string $titulo, string $corpo, string $botaoTexto = '', string $botaoLink = '', string $pre = ''): string
{
    $site = rtrim(cfg()['site_url'], '/');
    $fonte = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    $botao = '';
    if ($botaoLink !== '') {
        $l = htmlspecialchars($botaoLink, ENT_QUOTES);
        $botao = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr><td align="center" bgcolor="#0D0D0F" style="border-radius:12px">'
            . '<a href="' . $l . '" style="' . $fonte . ';display:inline-block;padding:16px 34px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px">' . htmlspecialchars($botaoTexto) . '</a></td></tr></table>'
            . '<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#5A5954">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="' . $l . '" style="color:#2D4BFF;word-break:break-all">' . $l . '</a></p>';
    }
    $faixa = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="25%" height="5" bgcolor="#3A7BFF" style="font-size:0;line-height:0">&nbsp;</td><td width="25%" bgcolor="#2D4BFF" style="font-size:0;line-height:0">&nbsp;</td><td width="25%" bgcolor="#8A3DFF" style="font-size:0;line-height:0">&nbsp;</td><td width="25%" bgcolor="#C04DFF" style="font-size:0;line-height:0">&nbsp;</td></tr></table>';
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' . htmlspecialchars($titulo) . '</title></head>'
        . '<body style="margin:0;padding:0;background:#F2F1EE;' . $fonte . ';color:#0D0D0F">'
        . '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' . htmlspecialchars($pre !== '' ? $pre : $titulo) . '&#847; &#847; &#847;</div>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F2F1EE"><tr><td align="center" style="padding:28px 14px">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:20px;overflow:hidden">'
        . '<tr><td bgcolor="#0D0D0F" style="padding:28px 36px"><span style="' . $fonte . ';font-size:24px;font-weight:700;letter-spacing:-.3px;color:#FFFFFF">Lepvi <span style="color:#7FA6FF">Finanças</span></span><br><span style="' . $fonte . ';font-size:13px;color:#B9B8B2">Suas contas, cartões e boletos em um só lugar</span></td></tr>'
        . '<tr><td>' . $faixa . '</td></tr>'
        . '<tr><td style="padding:36px 36px 30px;' . $fonte . '"><h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-.4px;color:#0D0D0F">' . htmlspecialchars($titulo) . '</h1>'
        . '<div style="font-size:16px;line-height:1.65;color:#2E2D2A">' . $corpo . '</div>' . $botao . '</td></tr>'
        . '<tr><td style="padding:0 36px"><table role="presentation" width="100%"><tr><td style="border-top:1px solid #E6E5E0;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>'
        . '<tr><td style="padding:22px 36px 30px;' . $fonte . ';font-size:13px;line-height:1.6;color:#5A5954">'
        . '<b style="color:#0D0D0F">Lepvi Group</b> · <a href="https://lepvi.com.br" style="color:#2D4BFF;text-decoration:none">lepvi.com.br</a><br>'
        . 'Dúvidas? Responda este e-mail ou escreva para <a href="mailto:lepvi@lepvi.com.br" style="color:#2D4BFF;text-decoration:none">lepvi@lepvi.com.br</a>.<br>'
        . 'Você recebeu esta mensagem por causa de uma conta no Lepvi Finanças. <a href="' . htmlspecialchars($site, ENT_QUOTES) . '/privacidade.html" style="color:#2D4BFF">Política de Privacidade</a></td></tr>'
        . '</table></td></tr></table></body></html>';
}
function enviar_email(string $para, string $assunto, string $html): bool
{
    $c = cfg();
    if ($c['email_modo'] !== 'enviar') {
        $dir = (string) cfg()['estado'];
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        file_put_contents($dir . '/emails.log', "=== " . date('c') . " PARA: $para | $assunto\n$html\n\n", FILE_APPEND);
        return true;
    }
    $texto = trim(html_entity_decode(preg_replace(['/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s', '/<(br|\/p|\/h1|\/div|\/li)[^>]*>/i', '/<[^>]+>/', "/\n\s*\n+/"], ['$2 ($1)', "\n", '', "\n\n"], $html) ?? '', ENT_QUOTES, 'UTF-8'));
    $f = 'lepvi_' . bin2hex(random_bytes(8));
    $cab = ['From' => "Lepvi Finanças <{$c['email_de']}>", 'Reply-To' => $c['email_de'], 'MIME-Version' => '1.0', 'Content-Type' => "multipart/alternative; boundary=\"$f\"", 'X-Mailer' => 'Lepvi Financas'];
    $corpo = "--$f\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($texto))
        . "--$f\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$f--";
    $subj = '=?UTF-8?B?' . base64_encode($assunto) . '?=';
    return @mail($para, $subj, $corpo, $cab, '-f' . $c['email_de']);
}
