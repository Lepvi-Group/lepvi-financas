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
                'site_url' => 'https://' . $m[2],
                'email_modo' => 'enviar',
                'cookie_seguro' => true,
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
        ];
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
        $esperado = parse_url(cfg()['site_url'], PHP_URL_HOST);
        if (parse_url($origem, PHP_URL_HOST) !== $esperado) erro('Origem não permitida.', 403);
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
function exigir_usuario(): array { return usuario_atual() ?? erro('Entre para continuar.', 401); }
function usuario_publico(array $u): array
{
    return ['email' => $u['email'], 'nome' => $u['nome'], 'avisos' => (bool) $u['avisos'], 'email_verificado' => (bool) $u['email_verificado'], 'aceite_versao' => $u['aceite_versao']];
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

/* ---------- dados financeiros cifrados (libsodium) ---------- */
function cifrar(string $texto): string
{
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return base64_encode($nonce . sodium_crypto_secretbox($texto, $nonce, chave('dados')));
}
function decifrar(string $b64): ?string
{
    $bin = base64_decode($b64, true);
    if ($bin === false || strlen($bin) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return null;
    $r = sodium_crypto_secretbox_open(substr($bin, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($bin, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), chave('dados'));
    return $r === false ? null : $r;
}

/* ---------- e-mail ---------- */
function email_html(string $titulo, string $corpo, string $botaoTexto = '', string $botaoLink = ''): string
{
    $b = $botaoLink !== '' ? '<p style="margin:24px 0"><a href="' . htmlspecialchars($botaoLink) . '" style="background:#0D0D0F;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:600;display:inline-block">' . htmlspecialchars($botaoTexto) . '</a></p>' : '';
    return '<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F2F1EE;font-family:Arial,Helvetica,sans-serif;color:#0D0D0F"><div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:18px;padding:28px">'
        . '<p style="margin:0 0 16px;font-size:18px;font-weight:700">lepvi <span style="color:#2D4BFF">finanças</span></p><h1 style="font-size:22px;margin:0 0 12px">' . htmlspecialchars($titulo) . '</h1>'
        . '<div style="font-size:16px;line-height:1.55">' . $corpo . '</div>' . $b
        . '</div><p style="font-size:13px;color:#4A4944;text-align:center;margin-top:16px">Lepvi Group · lepvi.com.br<br>Você recebe este e-mail porque tem uma conta no Lepvi Finanças.</p></div></body></html>';
}
function enviar_email(string $para, string $assunto, string $html): bool
{
    $c = cfg();
    if ($c['email_modo'] !== 'enviar') {
        $dir = dirname(__DIR__) . '/.dev';
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
