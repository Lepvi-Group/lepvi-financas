<?php
declare(strict_types=1);
/* Lepvi Finanças: avisos de pagamento do Asaas (webhook). Cadastrar no painel do Asaas → Integrações → Webhooks:
   URL https://financas.lepvi.com.br/api/asaas.php, token = "webhook_token" do financas-dados/asaas.json,
   eventos de cobrança (Pagamento confirmado e Pagamento recebido). Sempre responde 200 quando o token confere, para o Asaas não pausar a fila. */
require __DIR__ . '/_assinatura.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// Não-POST responde 405 (não 404): o Asaas testa a URL ao cadastrar o webhook e recusa endereço que dá 404.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); header('Allow: POST'); echo '{}'; exit; }
$c = asaas_config();
if ($c === null) { http_response_code(404); echo '{}'; exit; }
$token = (string) ($_SERVER['HTTP_ASAAS_ACCESS_TOKEN'] ?? '');
if ($token === '' || !hash_equals((string) $c['webhook_token'], $token)) { http_response_code(401); echo '{}'; exit; }
$ev = json_decode((string) file_get_contents('php://input', false, null, 0, 200000), true);
try { $liberou = is_array($ev) ? assinatura_webhook($ev) : false; }
catch (Throwable $e) { error_log('[lepvi-financas asaas] ' . $e->getMessage()); http_response_code(500); echo '{}'; exit; }
echo json_encode(['ok' => true, 'liberou' => $liberou]);
