<?php
declare(strict_types=1);
/* Roda os cenários da entrada com Google/Microsoft com um provedor FALSO (sem rede, sem chaves reais) e imprime JSON. */
$estado = sys_get_temp_dir() . '/lepvi-oauth-test-' . getmypid();
@mkdir($estado, 0700, true);
putenv('LEPVI_FINANCAS_DSN=sqlite:' . $estado . '/t.sqlite');
putenv('LEPVI_FINANCAS_ESTADO=' . $estado);
require __DIR__ . '/../api/_oauth.php';

$out = [];
$b64 = fn(array $a) => rtrim(strtr(base64_encode(json_encode($a)), '+/', '-_'), '=');
$jwt = fn(array $c) => 'x.' . $b64($c) . '.y';

// 1. assinatura
$s = assinar(['a' => 1], 60);
$out['assina_ok'] = ler_assinado($s)['a'] ?? null;
$out['assina_adulterada'] = ler_assinado(substr($s, 0, 10) . 'X' . substr($s, 11));
$GLOBALS['AGORA_TESTE'] = time() + 120;
$out['assina_vencida'] = ler_assinado($s);
unset($GLOBALS['AGORA_TESTE']);

// 2. configuração do provedor
$out['sem_chaves'] = oauth_provedor('google');
file_put_contents($estado . '/oauth.json', json_encode(['google' => ['client_id' => 'gid', 'client_secret' => 'gsec'], 'microsoft' => ['client_id' => 'mid', 'client_secret' => 'msec', 'tenant' => 'common']]));
$g = oauth_provedor('google'); $m = oauth_provedor('microsoft');
$out['com_chaves'] = [$g['client_id'] ?? null, str_contains($m['auth'] ?? '', '/common/')];
[$url, $cookie] = oauth_iniciar('google', $g);
parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
$out['url'] = [$q['code_challenge_method'] ?? null, $q['response_type'] ?? null, isset($q['state']), str_contains($q['redirect_uri'] ?? '', '/api/oauth.php')];
$lembrado = ler_assinado($cookie);
$out['state_confere'] = ($lembrado['s'] ?? '') === ($q['state'] ?? 'x');

// 3. conferência do id_token
$agora = time();
$bom = ['sub' => 'g-1', 'email' => 'ana@example.com', 'email_verified' => true, 'name' => 'Ana Souza', 'aud' => 'gid', 'iss' => 'https://accounts.google.com', 'exp' => $agora + 600, 'nonce' => $lembrado['n']];
$GLOBALS['OAUTH_HTTP'] = fn($u, $c) => ['id_token' => $jwt($bom)];
$out['token_ok'] = oauth_claims('google', $g, 'codigo', $lembrado)['sub'] ?? null;
$GLOBALS['OAUTH_HTTP'] = fn($u, $c) => ['id_token' => $jwt(['nonce' => 'outro'] + $bom)];
$out['token_nonce_errado'] = oauth_claims('google', $g, 'codigo', $lembrado);
$GLOBALS['OAUTH_HTTP'] = fn($u, $c) => ['id_token' => $jwt(['aud' => 'de-outro-app'] + $bom)];
$out['token_aud_errado'] = oauth_claims('google', $g, 'codigo', $lembrado);
$GLOBALS['OAUTH_HTTP'] = fn($u, $c) => ['id_token' => $jwt(['iss' => 'https://site-falso.com'] + $bom)];
$out['token_emissor_errado'] = oauth_claims('google', $g, 'codigo', $lembrado);
$GLOBALS['OAUTH_HTTP'] = fn($u, $c) => ['id_token' => $jwt(['exp' => $agora - 10] + $bom)];
$out['token_vencido'] = oauth_claims('google', $g, 'codigo', $lembrado);
$GLOBALS['OAUTH_HTTP'] = fn($u, $c) => [];
$out['token_sem_resposta'] = oauth_claims('google', $g, 'codigo', $lembrado);

// 4. quem é a pessoa
$r = oauth_resolver('google', $bom);
$out['google_novo'] = [$r['acao'], $r['pendente']['v'] ?? null];
[$u, $confirmar] = oauth_criar($r['pendente']);
$out['google_criado'] = [$u['email'], (int) $u['email_verificado'], $confirmar, (int) db()->query('SELECT COUNT(*) FROM consentimentos')->fetchColumn()];
$out['google_volta'] = oauth_resolver('google', $bom)['acao'];

// conta criada com senha + Google com e-mail verificado: liga e entra
db()->prepare("INSERT INTO usuarios (id, email, nome, senha_hash, email_verificado, avisos, aceite_versao, aceite_em, criado_em) VALUES ('u2','bia@example.com','Bia','x',1,1,'v',1,1)")->execute();
$out['google_liga_conta_existente'] = oauth_resolver('google', ['sub' => 'g-2', 'email' => 'bia@example.com', 'email_verified' => true])['acao'];
// Google com e-mail NÃO verificado nunca liga a uma conta existente
$out['google_nao_verificado'] = oauth_resolver('google', ['sub' => 'g-3', 'email' => 'bia@example.com', 'email_verified' => false])['erro'] ?? null;
// Microsoft nunca liga automaticamente a conta existente (risco de tomada de conta)
$out['microsoft_conta_existente'] = oauth_resolver('microsoft', ['sub' => 'm-1', 'email' => 'bia@example.com'])['erro'] ?? null;
// Microsoft novo: cria sem e-mail confirmado e não entra antes de confirmar
$rm = oauth_resolver('microsoft', ['sub' => 'm-2', 'preferred_username' => 'caio@example.com', 'name' => 'Caio']);
[$uc, $conf] = oauth_criar($rm['pendente']);
$out['microsoft_novo'] = [$rm['acao'], (int) $uc['email_verificado'], $conf];
$out['microsoft_volta_sem_confirmar'] = oauth_resolver('microsoft', ['sub' => 'm-2'])['erro'] ?? null;
$out['sem_email'] = oauth_resolver('google', ['sub' => 'g-9'])['erro'] ?? null;
$out['sem_sub'] = oauth_resolver('google', ['email' => 'a@b.com'])['erro'] ?? null;

// 5. Cloudflare Turnstile
$out['ts_sem_chaves'] = turnstile_verificar(null);
file_put_contents($estado . '/turnstile.json', json_encode(['site_key' => 'sk', 'secret' => 'segredo']));
$out['ts_config'] = turnstile_config()['site_key'] ?? null;
$GLOBALS['TURNSTILE_HTTP'] = fn($c) => ['success' => $c['response'] === 'token-bom' && $c['secret'] === 'segredo'];
$out['ts_token_bom'] = turnstile_verificar('token-bom');
$out['ts_token_ruim'] = turnstile_verificar('token-ruim');
$out['ts_sem_token'] = turnstile_verificar('');
$GLOBALS['TURNSTILE_HTTP'] = fn($c) => null;
$out['ts_cloudflare_fora_do_ar'] = turnstile_verificar('qualquer');
echo json_encode($out);
array_map('unlink', glob($estado . '/*') ?: []);
@rmdir($estado);
