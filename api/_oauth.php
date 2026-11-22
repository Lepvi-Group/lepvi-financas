<?php
declare(strict_types=1);
/* Lepvi Finanças: entrar com Google e Microsoft (OpenID Connect, fluxo de código com PKCE).
   As chaves ficam em financas-dados/oauth.json, FORA da pasta pública. Nunca vão para o repositório nem para a conversa. */
require_once __DIR__ . '/_lib.php';

function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

/* Dados curtos assinados (cookie de ida e volta): ninguém consegue forjar nem alterar. */
function assinar(array $d, int $ttl): string
{
    $d['exp'] = agora() + $ttl;
    $p = b64u((string) json_encode($d, JSON_UNESCAPED_UNICODE));
    return $p . '.' . b64u(hash_hmac('sha256', $p, chave('oauth'), true));
}
function ler_assinado(string $s): ?array
{
    $partes = explode('.', $s);
    if (count($partes) !== 2 || strlen($s) > 4000) return null;
    if (!hash_equals(b64u(hash_hmac('sha256', $partes[0], chave('oauth'), true)), $partes[1])) return null;
    $d = json_decode(b64u_dec($partes[0]), true);
    return is_array($d) && ($d['exp'] ?? 0) > agora() ? $d : null;
}

function oauth_provedores(): array
{
    return [
        'google' => ['nome' => 'Google', 'auth' => 'https://accounts.google.com/o/oauth2/v2/auth', 'token' => 'https://oauth2.googleapis.com/token'],
        'microsoft' => ['nome' => 'Microsoft', 'auth' => 'https://login.microsoftonline.com/%s/oauth2/v2.0/authorize', 'token' => 'https://login.microsoftonline.com/%s/oauth2/v2.0/token'],
    ];
}
/* Provedor pronto para uso (com chaves) ou null. */
function oauth_provedor(string $p): ?array
{
    $base = oauth_provedores()[$p] ?? null;
    $arq = rtrim((string) cfg()['estado'], '/') . '/oauth.json';
    $j = is_file($arq) ? json_decode((string) file_get_contents($arq), true) : null;
    $c = is_array($j) ? ($j[$p] ?? null) : null;
    if (!$base || !is_array($c) || empty($c['client_id']) || empty($c['client_secret'])) return null;
    $tenant = preg_match('/^[A-Za-z0-9.-]+$/', (string) ($c['tenant'] ?? '')) ? (string) $c['tenant'] : 'common';
    if ($p === 'microsoft') { $base['auth'] = sprintf($base['auth'], $tenant); $base['token'] = sprintf($base['token'], $tenant); }
    return $base + ['client_id' => (string) $c['client_id'], 'client_secret' => (string) $c['client_secret']];
}
function oauth_redirect_uri(): string { return rtrim(cfg()['site_url'], '/') . '/api/oauth.php'; }

/* Endereço de autorização + dados que precisamos lembrar até a volta. */
function oauth_iniciar(string $p, array $prov): array
{
    $estado = token_aleatorio(); $verificador = token_aleatorio(); $nonce = token_aleatorio();
    $q = http_build_query([
        'client_id' => $prov['client_id'], 'redirect_uri' => oauth_redirect_uri(), 'response_type' => 'code',
        'scope' => 'openid email profile', 'state' => $estado, 'nonce' => $nonce,
        'code_challenge' => b64u(hash('sha256', $verificador, true)), 'code_challenge_method' => 'S256',
        'prompt' => 'select_account',
    ]);
    return [$prov['auth'] . '?' . $q, assinar(['p' => $p, 's' => $estado, 'v' => $verificador, 'n' => $nonce], 600)];
}

/* Troca o código por dados do usuário. $GLOBALS['OAUTH_HTTP'] permite simular nos testes. */
function oauth_http_post(string $url, array $campos): array
{
    if (isset($GLOBALS['OAUTH_HTTP'])) return ($GLOBALS['OAUTH_HTTP'])($url, $campos);
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($campos), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
    $r = curl_exec($ch); curl_close($ch);
    $j = is_string($r) ? json_decode($r, true) : null;
    return is_array($j) ? $j : [];
}
function oauth_claims(string $p, array $prov, string $code, array $lembrado): ?array
{
    $t = oauth_http_post($prov['token'], [
        'grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => oauth_redirect_uri(),
        'client_id' => $prov['client_id'], 'client_secret' => $prov['client_secret'], 'code_verifier' => $lembrado['v'],
    ]);
    $partes = explode('.', (string) ($t['id_token'] ?? ''));
    if (count($partes) !== 3) return null;
    $c = json_decode(b64u_dec($partes[1]), true);
    if (!is_array($c)) return null;
    // O id_token veio direto do provedor por conexão segura; conferimos para quem é, quem emitiu, validade e o nonce.
    $aud = $c['aud'] ?? '';
    if (!(is_array($aud) ? in_array($prov['client_id'], $aud, true) : $aud === $prov['client_id'])) return null;
    if (($c['exp'] ?? 0) < agora() || !hash_equals((string) $lembrado['n'], (string) ($c['nonce'] ?? ''))) return null;
    $iss = (string) ($c['iss'] ?? '');
    $okIss = $p === 'google' ? in_array($iss, ['https://accounts.google.com', 'accounts.google.com'], true) : str_starts_with($iss, 'https://login.microsoftonline.com/');
    return $okIss ? $c : null;
}

/* Quem é essa pessoa no nosso sistema? Devolve: login | aceite | erro. */
function oauth_resolver(string $p, array $c): array
{
    $sub = (string) ($c['sub'] ?? '');
    if ($sub === '' || strlen($sub) > 190) return ['erro' => 'dados'];
    $s = db()->prepare('SELECT u.* FROM identidades i JOIN usuarios u ON u.id = i.usuario_id WHERE i.provedor = ? AND i.sub = ?');
    $s->execute([$p, $sub]);
    if ($u = $s->fetch()) return $u['email_verificado'] ? ['acao' => 'login', 'usuario' => $u] : ['erro' => 'confirme-email'];
    $email = mb_strtolower(trim((string) ($c['email'] ?? ($p === 'microsoft' ? ($c['preferred_username'] ?? '') : ''))));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) return ['erro' => 'sem-email'];
    $verificado = $p === 'google' && (($c['email_verified'] ?? false) === true || ($c['email_verified'] ?? '') === 'true');
    $e = db()->prepare('SELECT * FROM usuarios WHERE email = ?');
    $e->execute([$email]);
    if ($u = $e->fetch()) {
        // Só liga a uma conta que já existe se o Google garante que o e-mail é da pessoa.
        // Na Microsoft o e-mail pode não ser verificado (risco de tomada de conta): pede para entrar com a senha.
        if (!$verificado) return ['erro' => 'conta-existente'];
        db()->prepare('INSERT INTO identidades (provedor, sub, usuario_id, criado_em) VALUES (?,?,?,?)')->execute([$p, $sub, $u['id'], agora()]);
        if (!$u['email_verificado']) db()->prepare('UPDATE usuarios SET email_verificado = 1 WHERE id = ?')->execute([$u['id']]);
        $u['email_verificado'] = 1;
        return ['acao' => 'login', 'usuario' => $u];
    }
    return ['acao' => 'aceite', 'pendente' => ['p' => $p, 'sub' => $sub, 'email' => $email, 'nome' => mb_substr(trim((string) ($c['name'] ?? '')) ?: explode('@', $email)[0], 0, 120), 'v' => $verificado]];
}

/* Cria a conta depois que a pessoa aceitou a Política e os Termos. Devolve [usuário, precisaConfirmarEmail]. */
function oauth_criar(array $pend): array
{
    $uid = novo_id();
    db()->prepare('INSERT INTO usuarios (id, email, nome, senha_hash, email_verificado, avisos, aceite_versao, aceite_em, criado_em) VALUES (?,?,?,?,?,1,?,?,?)')
        ->execute([$uid, $pend['email'], $pend['nome'], gerar_hash(token_aleatorio()), $pend['v'] ? 1 : 0, VERSAO_TERMOS, agora(), agora()]);
    foreach (['politica_privacidade', 'termos_de_uso'] as $tipo) {
        db()->prepare('INSERT INTO consentimentos (id, usuario_id, tipo, versao, quando) VALUES (?,?,?,?,?)')->execute([novo_id(), $uid, $tipo, VERSAO_TERMOS, agora()]);
    }
    db()->prepare('INSERT INTO identidades (provedor, sub, usuario_id, criado_em) VALUES (?,?,?,?)')->execute([$pend['p'], $pend['sub'], $uid, agora()]);
    $q = db()->prepare('SELECT * FROM usuarios WHERE id = ?');
    $q->execute([$uid]);
    return [$q->fetch(), !$pend['v']];
}
