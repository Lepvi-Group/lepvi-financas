<?php
declare(strict_types=1);
/* Lepvi Finanças: Open Finance (preparado, ainda desligado).
   Como funciona quando ligar: a pessoa conecta o banco por uma empresa autorizada (Pluggy, Belvo etc., o "agregador"), o agregador avisa
   este servidor (api/openfinance.php) e cada movimentação vira um item em "Para revisar", igual aos avisos do banco. O app nunca vê a senha do banco.
   Para ligar: defina o segredo do aviso (variável LEPVI_FINANCAS_OF_SEGREDO ou 'openfinance' => ['segredo' => …] em _config.php).
   Depois escreva só o adaptador do agregador escolhido: traduzir o aviso dele para o formato de of_importar() e abrir o widget dele na tela. */
require_once __DIR__ . '/_captura.php';

function of_config(): ?array
{
    $c = cfg()['openfinance'] ?? [];
    $seg = (string) (getenv('LEPVI_FINANCAS_OF_SEGREDO') ?: ($c['segredo'] ?? ''));
    if (strlen($seg) < 24) return null;
    return ['segredo' => $seg, 'provedor' => (string) (getenv('LEPVI_FINANCAS_OF_PROVEDOR') ?: ($c['provedor'] ?? 'agregador'))];
}

/* Uma movimentação do agregador -> o mesmo formato dos avisos do banco. Valor negativo (ou DEBIT) é despesa. */
function of_para_captura(array $t, string $instituicao = ''): ?array
{
    $v = $t['valor'] ?? $t['amount'] ?? null;
    if (!is_numeric($v) || (float) $v == 0.0) return null;
    $tipoTxt = strtolower((string) ($t['tipo'] ?? $t['type'] ?? ''));
    $receita = $tipoTxt !== '' ? in_array($tipoTxt, ['credit', 'credito', 'crédito', 'receita'], true) : (float) $v > 0;
    $data = (string) ($t['data'] ?? $t['date'] ?? '');
    $data = preg_match('/^(\d{4}-\d{2}-\d{2})/', $data, $m) ? $m[1] : date('Y-m-d');
    $desc = trim(preg_replace('/\s+/u', ' ', strip_tags((string) ($t['descricao'] ?? $t['description'] ?? ''))) ?? '');
    if ($desc === '') $desc = $receita ? 'Valor recebido' : 'Compra no cartão';
    return [
        'valor' => round(abs((float) $v), 2), 'desc' => mb_substr($desc, 0, 60), 'tipo' => $receita ? 'receita' : 'despesa',
        'final' => isset($t['final']) && preg_match('/^\d{4}$/', (string) $t['final']) ? (string) $t['final'] : null,
        'data' => $data, 'texto' => mb_substr(trim($instituicao . ' ' . $desc), 0, 300), 'origem' => 'openfinance',
    ];
}

function of_conexoes(string $dono): array
{
    $s = db()->prepare('SELECT id, provedor, instituicao, status, ultima_sync, criado_em FROM conexoes WHERE usuario_id = ? ORDER BY criado_em DESC');
    $s->execute([$dono]);
    return array_map(fn($r) => ['id' => $r['id'], 'provedor' => $r['provedor'], 'instituicao' => $r['instituicao'], 'status' => $r['status'],
        'ultima_sync' => $r['ultima_sync'] !== null ? (int) $r['ultima_sync'] : null, 'criado_em' => (int) $r['criado_em']], $s->fetchAll());
}

/* Recebe as movimentações de uma conexão. Cada id externo entra uma única vez (mesmo depois de lançado ou descartado). */
function of_importar(string $item_id, array $trans): int
{
    $s = db()->prepare('SELECT id, usuario_id, instituicao FROM conexoes WHERE item_id = ?');
    $s->execute([$item_id]);
    $cx = $s->fetch();
    if (!$cx) return -1;
    $novas = 0;
    foreach (array_slice($trans, 0, 500) as $t) {
        if (!is_array($t)) continue;
        $ext = substr((string) ($t['id'] ?? ''), 0, 120);
        $c = of_para_captura($t, (string) $cx['instituicao']);
        if ($ext === '' || !$c) continue;
        $h = hash('sha256', $cx['id'] . '|' . $ext);
        try { db()->prepare('INSERT INTO of_vistos (usuario_id, h, criado_em) VALUES (?,?,?)')->execute([$cx['usuario_id'], $h, agora()]); } catch (Throwable $e) { continue; }
        $c['h'] = $h;
        captura_guardar((string) $cx['usuario_id'], $c);
        $novas++;
    }
    db()->prepare('UPDATE conexoes SET ultima_sync = ?, status = ? WHERE id = ?')->execute([agora(), 'ativa', $cx['id']]);
    return $novas;
}
