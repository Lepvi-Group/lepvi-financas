<?php
declare(strict_types=1);
/* Lepvi Finanças: aviso do agregador de Open Finance (webhook).
   POST com o cabeçalho X-OF-Segredo e JSON {"item_id": "...", "transacoes": [{"id","descricao","valor","data"}]}. Desligado até o segredo existir. */
require __DIR__ . '/_openfinance.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$sai = function (array $d, int $c = 200): never { http_response_code($c); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; };
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') $sai(['erro' => 'Use POST.'], 405);
    $conf = of_config();
    if (!$conf) $sai(['erro' => 'Open Finance ainda não está ativado.'], 503);
    $kIp = 'ofip:' . ip_hash();
    if (limite_estourou($kIp, 60, 600)) $sai(['erro' => 'Muitas tentativas.'], 429);
    if (!hash_equals($conf['segredo'], (string) ($_SERVER['HTTP_X_OF_SEGREDO'] ?? ''))) { registrar_tentativa($kIp); $sai(['erro' => 'Segredo inválido.'], 401); }
    $bruto = (string) file_get_contents('php://input', false, null, 0, 1000001);
    if (strlen($bruto) > 1000000) $sai(['erro' => 'Aviso grande demais.'], 413);
    $d = json_decode($bruto, true);
    if (!is_array($d) || !isset($d['item_id']) || !is_array($d['transacoes'] ?? null)) $sai(['erro' => 'Formato inválido.'], 422);
    $n = of_importar(substr((string) $d['item_id'], 0, 120), $d['transacoes']);
    if ($n < 0) $sai(['erro' => 'Conexão desconhecida.'], 404);
    $sai(['ok' => true, 'novas' => $n]);
} catch (Throwable $e) {
    error_log('[lepvi-financas openfinance] ' . $e->getMessage());
    $sai(['erro' => 'Não foi possível registrar agora.'], 500);
}
