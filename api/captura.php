<?php
declare(strict_types=1);
/* Lepvi Finanças: recebe o aviso de compra do banco (notificação, SMS ou e-mail) e cria um item "para revisar".
   Uso: POST https://<endereço>/api/captura.php  com a chave da pessoa (cabeçalho Authorization: Bearer <chave> ou campo "token")
   e o texto do aviso em "texto" (JSON, formulário ou texto puro). */
require __DIR__ . '/_captura.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$sai = function (array $d, int $c = 200): never { http_response_code($c); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; };
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') $sai(['erro' => 'Use POST.'], 405);
    $bruto = (string) file_get_contents('php://input', false, null, 0, 40001);
    if (strlen($bruto) > 40000) $sai(['erro' => 'Texto grande demais.'], 413);
    $ct = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
    $dados = str_contains($ct, 'json') ? (json_decode($bruto, true) ?: []) : ($_POST ?: []);
    if (!$dados && $bruto !== '' && !str_contains($ct, 'json') && !str_contains($ct, 'form')) $dados = ['texto' => $bruto];
    $auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    $token = preg_match('/^Bearer\s+(\S{20,120})$/', $auth, $m) ? $m[1] : (string) ($_SERVER['HTTP_X_CAPTURA_TOKEN'] ?? ($dados['token'] ?? ''));
    $kIp = 'capip:' . ip_hash();
    if (limite_estourou($kIp, 120, 600)) $sai(['erro' => 'Muitas tentativas.'], 429);
    $s = db()->prepare('SELECT usuario_id FROM chaves_captura WHERE hash = ?');
    $s->execute([hash_token($token)]);
    $uid = $token !== '' && strlen($token) <= 120 ? $s->fetchColumn() : false;
    if (!$uid) { registrar_tentativa($kIp); $sai(['erro' => 'Chave inválida.'], 401); }
    $dono = espaco_dono((string) $uid);
    if (limite_estourou('cap:' . $uid, 60, 60)) $sai(['erro' => 'Muitos avisos em pouco tempo.'], 429);
    registrar_tentativa('cap:' . $uid);
    db()->prepare('UPDATE chaves_captura SET ultimo_uso = ? WHERE hash = ?')->execute([agora(), hash_token($token)]);

    $texto = '';
    foreach (['texto', 'text', 'body', 'message', 'mensagem', 'corpo'] as $k) if (!empty($dados[$k]) && is_string($dados[$k])) { $texto = $dados[$k]; break; }
    if (!empty($dados['assunto']) && is_string($dados['assunto'])) $texto = $dados['assunto'] . ' ' . $texto;
    $c = captura_interpretar($texto);
    if (!$c) $sai(['erro' => 'Não achei um valor em reais no texto.'], 422);
    $c['origem'] = in_array($dados['origem'] ?? '', ['email', 'sms', 'push'], true) ? $dados['origem'] : 'aviso';
    $c['h'] = sha1($c['texto'] . $c['valor']);
    foreach (capturas_listar($dono) as $x) if (($x['h'] ?? '') === $c['h']) $sai(['ok' => true, 'repetido' => true]);
    $sai(['ok' => true, 'id' => captura_guardar($dono, $c), 'valor' => $c['valor'], 'desc' => $c['desc']]);
} catch (Throwable $e) {
    error_log('[lepvi-financas captura] ' . $e->getMessage());
    $sai(['erro' => 'Não foi possível registrar agora.'], 500);
}
