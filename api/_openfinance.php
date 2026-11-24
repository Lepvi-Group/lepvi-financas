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
        'cartao' => !empty($t['cartao']), // veio da conta de cartão de crédito: é fatura, nunca sai do saldo da conta
        'conexao' => isset($t['conexao']) ? substr((string) $t['conexao'], 0, 64) : null,
        'data' => $data, 'texto' => mb_substr(trim($instituicao . ' ' . $desc), 0, 300), 'origem' => 'openfinance',
    ];
}

function of_conexoes(string $dono): array
{
    $s = db()->prepare('SELECT id, provedor, instituicao, status, ultima_sync, saldo, saldo_em, criado_em FROM conexoes WHERE usuario_id = ? ORDER BY criado_em DESC');
    $s->execute([$dono]);
    return array_map(fn($r) => ['id' => $r['id'], 'provedor' => $r['provedor'], 'instituicao' => $r['instituicao'], 'status' => $r['status'],
        'ultima_sync' => $r['ultima_sync'] !== null ? (int) $r['ultima_sync'] : null, 'saldo' => $r['saldo'] !== null ? (float) $r['saldo'] : null, 'saldo_em' => $r['saldo_em'] !== null ? (int) $r['saldo_em'] : null, 'criado_em' => (int) $r['criado_em']], $s->fetchAll());
}

/* Recebe as movimentações de uma conexão (aviso do agregador). */
function of_importar(string $item_id, array $trans): int
{
    $s = db()->prepare('SELECT id, usuario_id, instituicao FROM conexoes WHERE item_id = ?');
    $s->execute([$item_id]);
    $cx = $s->fetch();
    return $cx ? of_importar_conexao($cx, $trans) : -1;
}
/* Cada id externo entra uma única vez (mesmo depois de lançado ou descartado). */
function of_importar_conexao(array $cx, array $trans): int
{
    $novas = 0;
    foreach (array_slice($trans, 0, 1000) as $t) {
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

/* ---------- Meu Pluggy (uso pessoal, grátis): a pessoa guarda o Client ID/Secret da própria aplicação e o código de cada banco ---------- */
function pluggy_url(): string { return rtrim((string) (getenv('LEPVI_FINANCAS_PLUGGY_URL') ?: 'https://api.pluggy.ai'), '/'); }

function pluggy_http(string $metodo, string $caminho, ?array $corpo = null, ?string $chave = null): array
{
    $ch = curl_init(pluggy_url() . $caminho);
    $h = ['Accept: application/json'];
    if ($chave !== null) $h[] = 'X-API-KEY: ' . $chave;
    if ($corpo !== null) { $h[] = 'Content-Type: application/json'; curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($corpo)); }
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $metodo, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => $h]);
    $r = curl_exec($ch); $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $j = is_string($r) ? json_decode($r, true) : null;
    return [$st, is_array($j) ? $j : []];
}

function pluggy_cred_salvar(string $dono, string $id, string $segredo): void
{
    $c = cifrar((string) json_encode(['id' => $id, 'segredo' => $segredo]));
    $s = db()->prepare('SELECT 1 FROM of_pluggy WHERE usuario_id = ?'); $s->execute([$dono]);
    if ($s->fetchColumn()) db()->prepare('UPDATE of_pluggy SET conteudo = ? WHERE usuario_id = ?')->execute([$c, $dono]);
    else db()->prepare('INSERT INTO of_pluggy (usuario_id, conteudo, criado_em) VALUES (?,?,?)')->execute([$dono, $c, agora()]);
}
function pluggy_cred(string $dono): ?array
{
    $s = db()->prepare('SELECT conteudo FROM of_pluggy WHERE usuario_id = ?'); $s->execute([$dono]);
    $c = $s->fetchColumn();
    $j = $c ? json_decode((string) decifrar((string) $c), true) : null;
    return is_array($j) && !empty($j['id']) && !empty($j['segredo']) ? $j : null;
}
/* Troca o Client ID/Secret por uma chave de 2 horas. Lança exceção com texto em português se falhar. */
function pluggy_chave(string $id, string $segredo): string
{
    [$st, $j] = pluggy_http('POST', '/auth', ['clientId' => $id, 'clientSecret' => $segredo]);
    if ($st === 0) throw new RuntimeException('Não consegui falar com o Pluggy agora. Tente de novo em instantes.');
    if ($st >= 400 || empty($j['apiKey'])) throw new RuntimeException('O Pluggy não aceitou o Client ID e o Client Secret. Confira se copiou certo (o Secret só aparece uma vez; se perdeu, gere outro no painel).');
    return (string) $j['apiKey'];
}
function pluggy_contas(string $chave, string $item): array
{
    [$st, $j] = pluggy_http('GET', '/accounts?itemId=' . rawurlencode($item), null, $chave);
    if ($st === 404 || $st === 403 || $st === 400) throw new RuntimeException('Não achei esse banco com o código informado. Copie de novo o id do item no painel do Pluggy (Aplicações → Demo → Itens conectados).');
    if ($st !== 200) throw new RuntimeException('O Pluggy não respondeu como esperado (código ' . $st . '). Tente de novo.');
    return is_array($j['results'] ?? null) ? $j['results'] : [];
}
/* Tira o que não é gasto de verdade: pagamento da fatura aparece na conta e no cartão e duplicaria. */
function pluggy_ignorar(string $desc): bool { return (bool) preg_match('/pagamento (recebido|de fatura|da fatura|fatura)|pagto\.? ?(da )?fatura|pgto\.? ?(da )?fatura/iu', $desc); }

function pluggy_sincronizar_conexao(array $cx, string $chave): int
{
    $contas = pluggy_contas($chave, (string) $cx['item_id']);
    $de = date('Y-m-d', ($cx['ultima_sync'] !== null ? (int) $cx['ultima_sync'] - 4 * 86400 : agora() - 30 * 86400));
    $lista = []; $saldo = null;
    foreach (array_slice($contas, 0, 10) as $conta) {
        if (empty($conta['id'])) continue;
        // saldo de verdade do banco: só conta corrente/poupança (o "saldo" do cartão de crédito é a fatura, não dinheiro)
        if (($conta['type'] ?? '') === 'BANK' && isset($conta['balance']) && is_numeric($conta['balance'])) $saldo = ($saldo ?? 0) + (float) $conta['balance'];
        $credito = ($conta['type'] ?? '') === 'CREDIT';
        $final = isset($conta['number']) && $credito && preg_match('/(\d{4})$/', (string) $conta['number'], $m) ? $m[1] : null;
        // O Pluggy aposentou o GET /transactions (responde 410): usa a versão v2, paginada por cursor ("next" já vem pronto para anexar).
        $url = '/v2/transactions?accountId=' . rawurlencode((string) $conta['id']) . '&dateFrom=' . $de;
        for ($pg = 1; $pg <= 6 && $url !== null; $pg++) {
            [$st, $j] = pluggy_http('GET', $url, null, $chave);
            if ($st !== 200) throw new RuntimeException('Não consegui ler as movimentações (código ' . $st . ').');
            foreach (($j['results'] ?? []) as $t) {
                if (!is_array($t) || ($t['status'] ?? 'POSTED') === 'PENDING' || pluggy_ignorar((string) ($t['description'] ?? ''))) continue;
                $lista[] = ['id' => $t['id'] ?? '', 'descricao' => $t['description'] ?? '', 'valor' => $t['amount'] ?? 0, 'tipo' => $t['type'] ?? '', 'data' => $t['date'] ?? '', 'final' => $final, 'cartao' => $credito, 'conexao' => $cx['id']];
            }
            $url = !empty($j['next']) ? '/v2/transactions' . $j['next'] : null;
        }
    }
    if ($saldo !== null) db()->prepare('UPDATE conexoes SET saldo = ?, saldo_em = ? WHERE id = ?')->execute([round($saldo, 2), agora(), $cx['id']]);
    return of_importar_conexao($cx, $lista);
}

/* Sincroniza uma conexão (ou todas as da pessoa). Devolve [novas, erro|null]. */
function pluggy_sincronizar(string $dono, ?string $conexaoId = null): array
{
    $cred = pluggy_cred($dono);
    if (!$cred) return [0, 'Cadastre o Client ID e o Client Secret primeiro.'];
    $q = 'SELECT * FROM conexoes WHERE usuario_id = ? AND provedor = ?' . ($conexaoId ? ' AND id = ?' : '');
    $s = db()->prepare($q); $s->execute($conexaoId ? [$dono, 'meupluggy', $conexaoId] : [$dono, 'meupluggy']);
    $total = 0; $erro = null;
    try {
        $chave = pluggy_chave($cred['id'], $cred['segredo']);
        foreach ($s->fetchAll() as $cx) {
            try { $total += pluggy_sincronizar_conexao($cx, $chave); }
            catch (Throwable $e) { db()->prepare('UPDATE conexoes SET status = ? WHERE id = ?')->execute(['erro', $cx['id']]); $erro = $e->getMessage(); }
        }
    } catch (Throwable $e) { db()->prepare('UPDATE conexoes SET status = ? WHERE usuario_id = ? AND provedor = ?')->execute(['erro', $dono, 'meupluggy']); $erro = $e->getMessage(); }
    return [$total, $erro];
}
/* Rotina diária (cron-avisos.php): o Meu Pluggy atualiza o banco a cada 24 h. */
function pluggy_sincronizar_todos(): int
{
    $n = 0;
    foreach (db()->query("SELECT DISTINCT usuario_id FROM conexoes WHERE provedor = 'meupluggy'")->fetchAll() as $r) $n += max(0, pluggy_sincronizar((string) $r['usuario_id'])[0]);
    return $n;
}
