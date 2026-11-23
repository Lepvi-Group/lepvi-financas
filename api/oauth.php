<?php
declare(strict_types=1);
/* Lepvi Finanças: ponto de entrada do Google e da Microsoft.
   /api/oauth.php?a=iniciar&p=google  -> leva a pessoa ao provedor
   /api/oauth.php?code=...&state=...  -> volta do provedor (este é o endereço que se cadastra no painel do Google/Microsoft) */
require __DIR__ . '/_oauth.php';
require_once __DIR__ . '/_2fa.php';

$volta = function (string $q): never {
    header('Location: ' . rtrim(cfg()['site_url'], '/') . '/?' . $q);
    header('Cache-Control: no-store');
    exit;
};
$opcoes = fn(int $exp) => ['expires' => $exp, 'path' => '/', 'secure' => (bool) cfg()['cookie_seguro'], 'httponly' => true, 'samesite' => 'Lax'];

try {
    if (($_GET['a'] ?? '') === 'iniciar') {
        $p = (string) ($_GET['p'] ?? '');
        $prov = oauth_provedor($p);
        if (!$prov) $volta('oauth=nao-configurado&p=' . rawurlencode($p));
        if (limite_estourou('oauth:' . ip_hash(), 30, 600)) $volta('oauth=muitas');
        registrar_tentativa('oauth:' . ip_hash());
        [$url, $cookie] = oauth_iniciar($p, $prov);
        setcookie('lf_oauth', $cookie, $opcoes(agora() + 600));
        header('Location: ' . $url);
        header('Cache-Control: no-store');
        exit;
    }

    // Volta do provedor
    $lembrado = ler_assinado((string) ($_COOKIE['lf_oauth'] ?? ''));
    setcookie('lf_oauth', '', $opcoes(1));
    if (!$lembrado || !hash_equals((string) $lembrado['s'], (string) ($_GET['state'] ?? ''))) $volta('oauth=erro');
    if (isset($_GET['error'])) $volta('oauth=cancelado');
    $code = (string) ($_GET['code'] ?? '');
    $p = (string) $lembrado['p'];
    $prov = oauth_provedor($p);
    if (!$prov || $code === '' || strlen($code) > 2000) $volta('oauth=erro');
    $claims = oauth_claims($p, $prov, $code, $lembrado);
    if (!$claims) $volta('oauth=erro');
    $r = oauth_resolver($p, $claims);
    if (isset($r['erro'])) $volta('oauth=erro-' . $r['erro']);
    if ($r['acao'] === 'login') {
        // quem ativou os dois passos entra só com e-mail, senha e código (o Google/Microsoft não substituem o código)
        if (($uu = totp_usuario((string) $r['usuario']['id'])) && totp_ativo($uu)) $volta('oauth=erro-2fa');
        db()->prepare('UPDATE usuarios SET ultimo_login = ? WHERE id = ?')->execute([agora(), $r['usuario']['id']]);
        abrir_sessao($r['usuario']['id']);
        $volta('oauth=ok');
    }
    setcookie('lf_novo', assinar($r['pendente'], 900), $opcoes(agora() + 900));
    $volta('oauth=aceite');
} catch (Throwable $e) {
    error_log('[lepvi-financas oauth] ' . $e->getMessage());
    $volta('oauth=erro');
}
