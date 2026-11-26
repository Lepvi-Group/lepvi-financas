<?php
declare(strict_types=1);
/* Lepvi Finanças: assinatura mensal de R$ 9,99 pelo Asaas.
   Regra da Larissa: paga primeiro; o 1º pagamento libera 37 dias (30 + 7 de bônus) e cada pagamento seguinte soma 30 dias.
   Sem pagamento em dia, a conta fica SÓ LEITURA (vê e exporta, não grava). Nada é apagado.
   A cobrança só liga quando existir financas-dados/asaas.json ({"chave":"$aact_...","webhook_token":"...","ambiente":"producao"}),
   criado pelo gerenciador de arquivos da Hostinger, FORA da pasta pública. Sem o arquivo, todo mundo usa normalmente.
   Contas que já existiam quando a assinatura foi criada ficam isentas (a da Larissa e as primeiras). */
require_once __DIR__ . '/_lib.php';

const ASSINATURA_VALOR = 9.99;
const ASSINATURA_DIAS = 30;
const ASSINATURA_BONUS_DIAS = 7;
/* Estorno ou contestação do cartão: tira os dias que aquele pagamento tinha liberado. */
const ASSINATURA_EVENTOS_ESTORNO = ['PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE'];
/* Só não paga quem criou a conta antes da assinatura existir (25/11/2026 00:00, horário de Brasília). */
function assinatura_inicio(): int { return (int) (getenv('LEPVI_FINANCAS_ASSINATURA_INICIO') ?: 1795575600); }

function asaas_config(): ?array
{
    if (getenv('LEPVI_FINANCAS_ASAAS_CHAVE')) {
        return ['chave' => (string) getenv('LEPVI_FINANCAS_ASAAS_CHAVE'), 'webhook_token' => (string) getenv('LEPVI_FINANCAS_ASAAS_WEBHOOK'), 'url' => (string) (getenv('LEPVI_FINANCAS_ASAAS_URL') ?: 'https://api-sandbox.asaas.com/v3')];
    }
    $arq = rtrim((string) cfg()['estado'], '/') . '/asaas.json';
    $j = is_file($arq) ? json_decode((string) @file_get_contents($arq), true) : null;
    if (!is_array($j) || empty($j['chave']) || empty($j['webhook_token'])) return null;
    $j['url'] = ($j['ambiente'] ?? 'producao') === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
    return $j;
}

function assinatura_tabelas(): void
{
    static $ok = false;
    if ($ok) return;
    $pdo = db();
    try { $pdo->query('SELECT 1 FROM assinaturas LIMIT 1'); }
    catch (Throwable $e) {
        foreach (['CREATE TABLE IF NOT EXISTS assinaturas (usuario_id VARCHAR(32) NOT NULL PRIMARY KEY, isento INTEGER NOT NULL DEFAULT 0, acesso_ate INTEGER NOT NULL DEFAULT 0, cliente_id VARCHAR(60) NULL, assinatura_id VARCHAR(60) NULL, cancelada INTEGER NOT NULL DEFAULT 0, avisado_em INTEGER NOT NULL DEFAULT 0, atualizado_em INTEGER NOT NULL)',
                  'CREATE TABLE IF NOT EXISTS assinatura_pagamentos (pagamento_id VARCHAR(60) NOT NULL PRIMARY KEY, usuario_id VARCHAR(32) NOT NULL, valor DOUBLE NOT NULL, pago_em INTEGER NOT NULL)'] as $sql) {
            try { $pdo->exec($sql); } catch (Throwable $e2) { /* já existe */ }
        }
        // Quem já tinha conta antes da assinatura existir continua sem pagar (pela data de criação da conta).
        try { $pdo->prepare('INSERT INTO assinaturas (usuario_id, isento, atualizado_em) SELECT id, 1, ? FROM usuarios WHERE criado_em < ? AND id NOT IN (SELECT usuario_id FROM assinaturas)')->execute([agora(), assinatura_inicio()]); } catch (Throwable $e2) { /* outra chamada fez ao mesmo tempo */ }
    }
    // Conserta isenção dada por engano (a regra antiga isentava quem existia no 1º acesso, mesmo conta criada depois).
    try { $pdo->prepare('UPDATE assinaturas SET isento = 0 WHERE isento = 1 AND usuario_id IN (SELECT id FROM usuarios WHERE criado_em >= ?)')->execute([assinatura_inicio()]); } catch (Throwable $e) { /* sem efeito */ }
    assinatura_limpar_lancs_indevidos();
    // Estorno: cada pagamento guarda quantos dias liberou, para tirar exatamente esses dias se for estornado.
    try { $pdo->query('SELECT dias, estornado FROM assinatura_pagamentos LIMIT 1'); }
    catch (Throwable $e) {
        try { $pdo->exec('ALTER TABLE assinatura_pagamentos ADD COLUMN dias INTEGER NOT NULL DEFAULT 0'); } catch (Throwable $e2) { /* já existe */ }
        try { $pdo->exec('ALTER TABLE assinatura_pagamentos ADD COLUMN estornado INTEGER NOT NULL DEFAULT 0'); } catch (Throwable $e2) { /* já existe */ }
    }
    $ok = true;
}

/* Autorizado pela Larissa (25/11/2026), roda uma vez só (marca no estado): apaga os lançamentos gravados por contas criadas depois do início da
   assinatura que nunca pagaram (gravados enquanto a isenção estava errada). Contas, cartões e o resto ficam; só a lista "lancs" de cada perfil é esvaziada. */
function assinatura_limpar_lancs_indevidos(): void
{
    $marca = rtrim((string) cfg()['estado'], '/') . '/limpeza-lancs-sem-assinatura-1';
    if (is_file($marca) || getenv('LEPVI_FINANCAS_ASAAS_CHAVE')) return; // nos testes não roda
    $pdo = db();
    try {
        $s = $pdo->prepare('SELECT d.usuario_id, d.conteudo FROM dados d JOIN usuarios u ON u.id = d.usuario_id JOIN assinaturas a ON a.usuario_id = d.usuario_id WHERE u.criado_em >= ? AND a.isento = 0 AND a.acesso_ate = 0');
        $s->execute([assinatura_inicio()]);
        foreach ($s->fetchAll() as $r) {
            $S = json_decode((string) decifrar((string) $r['conteudo']), true);
            if (!is_array($S)) continue;
            $n = 0;
            foreach (['pessoal', 'empresa'] as $p) if (!empty($S['dados'][$p]['lancs'])) { $n += count($S['dados'][$p]['lancs']); $S['dados'][$p]['lancs'] = []; }
            if ($n === 0) continue;
            $pdo->prepare('UPDATE dados SET conteudo = ?, versao = versao + 1, atualizado_em = ? WHERE usuario_id = ?')->execute([cifrar((string) json_encode($S, JSON_UNESCAPED_UNICODE)), agora(), $r['usuario_id']]);
            error_log('[lepvi-financas] limpeza: ' . $n . ' lançamento(s) de conta sem assinatura removido(s)');
        }
        @file_put_contents($marca, (string) agora());
    } catch (Throwable $e) { error_log('[lepvi-financas] limpeza falhou: ' . $e->getMessage()); }
}

function assinatura_linha(string $dono): array
{
    assinatura_tabelas();
    $s = db()->prepare('SELECT * FROM assinaturas WHERE usuario_id = ?'); $s->execute([$dono]);
    return $s->fetch() ?: ['usuario_id' => $dono, 'isento' => 0, 'acesso_ate' => 0, 'cliente_id' => null, 'assinatura_id' => null, 'cancelada' => 0];
}

/* Situação para a tela: cobranca = a cobrança está ligada no servidor; ativa = pode gravar. */
function assinatura_situacao(string $dono): array
{
    $a = assinatura_linha($dono);
    $cobranca = asaas_config() !== null;
    $isento = (bool) $a['isento'];
    $ate = (int) $a['acesso_ate'];
    return ['cobranca' => $cobranca, 'ativa' => !$cobranca || $isento || $ate > agora(), 'isento' => $isento, 'acesso_ate' => $ate ?: null,
        'assinou' => !empty($a['assinatura_id']) && !$a['cancelada'], 'cancelada' => (bool) $a['cancelada'], 'valor' => ASSINATURA_VALOR, 'bonus_dias' => ASSINATURA_BONUS_DIAS];
}

/* Gravar exige assinatura em dia (do dono do espaço: quem foi convidado usa a assinatura de quem convidou). 402 = pagamento necessário. */
function exigir_assinatura(string $dono): void
{
    if (!assinatura_situacao($dono)['ativa']) erro('Sua assinatura está vencida: o app está só para consulta. Assine por R$ 9,99 por mês para voltar a lançar e importar.', 402);
}

function asaas_http(string $metodo, string $caminho, ?array $corpo = null): array
{
    $c = asaas_config();
    if (!$c) throw new RuntimeException('A cobrança ainda não está configurada.');
    $ch = curl_init(rtrim($c['url'], '/') . $caminho);
    $h = ['Accept: application/json', 'access_token: ' . $c['chave'], 'User-Agent: LepviFinancas/1.0'];
    if ($corpo !== null) { $h[] = 'Content-Type: application/json'; curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($corpo, JSON_UNESCAPED_UNICODE)); }
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $metodo, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => $h]);
    $r = curl_exec($ch); $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $j = is_string($r) ? json_decode($r, true) : null;
    $j = is_array($j) ? $j : [];
    if ($st < 200 || $st >= 300) {
        $msg = (string) ($j['errors'][0]['description'] ?? '');
        throw new RuntimeException($msg !== '' ? 'Pagamento: ' . $msg : 'Não foi possível falar com o sistema de pagamento agora. Tente de novo em alguns minutos.');
    }
    return $j;
}

function cpf_cnpj_valido(string $doc): bool
{
    $d = preg_replace('/\D/', '', $doc) ?? '';
    if ($d === '' || preg_match('/^(\d)\1+$/', $d)) return false;
    $dv = function (string $base, array $pesos): int { $s = 0; foreach ($pesos as $i => $p) $s += (int) $base[$i] * $p; $r = $s % 11; return $r < 2 ? 0 : 11 - $r; };
    if (strlen($d) === 11) return $dv($d, range(10, 2)) === (int) $d[9] && $dv($d, range(11, 2)) === (int) $d[10];
    if (strlen($d) === 14) return $dv($d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === (int) $d[12] && $dv($d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === (int) $d[13];
    return false;
}

/* Cria (ou reaproveita) o cliente e a assinatura no Asaas e devolve o link da cobrança em aberto (Pix, boleto ou cartão: a pessoa escolhe). */
function assinatura_assinar(string $dono, string $nome, string $email, string $cpf): string
{
    $a = assinatura_linha($dono);
    $doc = preg_replace('/\D/', '', $cpf) ?? '';
    $cliente = (string) ($a['cliente_id'] ?? '');
    if ($cliente === '') {
        $cliente = (string) (asaas_http('POST', '/customers', ['name' => $nome, 'cpfCnpj' => $doc, 'email' => $email, 'externalReference' => $dono])['id'] ?? '');
        if ($cliente === '') throw new RuntimeException('Não foi possível cadastrar você no sistema de pagamento.');
    }
    $assin = !empty($a['cancelada']) ? '' : (string) ($a['assinatura_id'] ?? '');
    if ($assin === '') {
        $assin = (string) (asaas_http('POST', '/subscriptions', ['customer' => $cliente, 'billingType' => 'UNDEFINED', 'value' => ASSINATURA_VALOR, 'nextDueDate' => date('Y-m-d'), 'cycle' => 'MONTHLY',
            'description' => 'Lepvi Finanças: assinatura mensal (o 1º pagamento libera 37 dias)', 'externalReference' => $dono])['id'] ?? '');
        if ($assin === '') throw new RuntimeException('Não foi possível criar a assinatura.');
    }
    db()->prepare('INSERT INTO assinaturas (usuario_id, isento, acesso_ate, cliente_id, assinatura_id, cancelada, atualizado_em) VALUES (?,0,?,?,?,0,?) ON CONFLICT(usuario_id) DO UPDATE SET cliente_id = excluded.cliente_id, assinatura_id = excluded.assinatura_id, cancelada = 0, atualizado_em = excluded.atualizado_em')
        ->execute([$dono, (int) $a['acesso_ate'], $cliente, $assin, agora()]);
    $pags = asaas_http('GET', '/subscriptions/' . rawurlencode($assin) . '/payments')['data'] ?? [];
    foreach ($pags as $p) if (in_array($p['status'] ?? '', ['PENDING', 'OVERDUE'], true) && !empty($p['invoiceUrl'])) return (string) $p['invoiceUrl'];
    throw new RuntimeException('A assinatura está em dia: não há cobrança em aberto agora.');
}

function assinatura_cancelar(string $dono): void
{
    $a = assinatura_linha($dono);
    if (empty($a['assinatura_id']) || $a['cancelada']) return;
    asaas_http('DELETE', '/subscriptions/' . rawurlencode((string) $a['assinatura_id']));
    db()->prepare('UPDATE assinaturas SET cancelada = 1, atualizado_em = ? WHERE usuario_id = ?')->execute([agora(), $dono]);
}

/* E-mail 1 dia antes e no dia em que o acesso pago termina, sempre para o e-mail cadastrado da conta (regra da Larissa).
   Cada aviso sai uma vez só (tabela avisos). Quem pagou antes da hora já tem o acesso estendido e não recebe nada. Devolve quantos e-mails saíram. */
function assinatura_avisos_rodar(string $hoje): int
{
    if (asaas_config() === null) return 0;
    assinatura_tabelas();
    $s = db()->query('SELECT a.usuario_id, a.acesso_ate, u.email, u.nome FROM assinaturas a JOIN usuarios u ON u.id = a.usuario_id WHERE a.isento = 0 AND a.acesso_ate > 0');
    $n = 0;
    foreach ($s->fetchAll() as $a) {
        $fim = date('Y-m-d', (int) $a['acesso_ate']);
        $dias = (int) round((strtotime($fim) - strtotime($hoje)) / 86400);
        if ($dias !== 0 && $dias !== 1) continue;
        $chave = 'assin|' . $fim . '|' . ($dias === 1 ? 'vespera' : 'hoje');
        $j = db()->prepare('SELECT 1 FROM avisos WHERE usuario_id = ? AND chave = ?'); $j->execute([$a['usuario_id'], $chave]);
        if ($j->fetchColumn()) continue;
        $quando = $dias === 1 ? 'amanhã' : 'hoje';
        $corpo = '<p style="margin:0 0 12px">Olá, ' . htmlspecialchars(explode(' ', (string) $a['nome'])[0]) . '! Sua assinatura do Lepvi Finanças vence <b>' . $quando . '</b> (' . date('d/m/Y', (int) $a['acesso_ate']) . ').</p>'
            . '<p style="margin:0">Para continuar lançando e importando o extrato, pague a mensalidade de <b>R$ 9,99</b>. Se não pagar, seus dados continuam guardados e você ainda consegue ver e exportar tudo, só não consegue lançar.</p>';
        if (enviar_email((string) $a['email'], $dias === 1 ? '🔔 Sua assinatura vence amanhã' : '⏰ Sua assinatura vence hoje', email_html('Sua assinatura', $corpo, 'Abrir e pagar', rtrim(cfg()['site_url'], '/') . '/?assinar=1'))) {
            db()->prepare('INSERT INTO avisos (usuario_id, chave, enviado_em) VALUES (?,?,?)')->execute([$a['usuario_id'], $chave, agora()]);
            $n++;
        }
    }
    return $n;
}

/* Aviso do Asaas (webhook). Pagamento confirmado: 1º pagamento = 37 dias, os seguintes = 30 dias, contados a partir do fim do acesso atual.
   Cada pagamento conta uma vez só (o Asaas reenvia avisos). Devolve true se liberou dias. */
/* Uma vez só por pagamento: volta o acesso_ate pelos dias que ele liberou. Se o acesso acabar, o app fica só para consulta na hora. */
function assinatura_estornar(string $pid): bool
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $s = $pdo->prepare('SELECT usuario_id, dias FROM assinatura_pagamentos WHERE pagamento_id = ? AND estornado = 0'); $s->execute([$pid]);
        $pg = $s->fetch();
        $marcou = $pg ? $pdo->prepare('UPDATE assinatura_pagamentos SET estornado = 1 WHERE pagamento_id = ? AND estornado = 0') : null;
        if (!$pg || !$marcou->execute([$pid]) || $marcou->rowCount() !== 1) { $pdo->rollBack(); return false; }
        $dias = (int) $pg['dias'] ?: ASSINATURA_DIAS;
        $pdo->prepare('UPDATE assinaturas SET acesso_ate = MAX(0, acesso_ate - ?), atualizado_em = ? WHERE usuario_id = ?')->execute([$dias * 86400, agora(), $pg['usuario_id']]);
        $pdo->commit();
        error_log('[lepvi-financas assinatura] estorno ' . $pid . ': -' . $dias . ' dias');
        return true;
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}

function assinatura_webhook(array $ev): bool
{
    assinatura_tabelas();
    $evento = (string) ($ev['event'] ?? '');
    $p = is_array($ev['payment'] ?? null) ? $ev['payment'] : [];
    $pid = (string) ($p['id'] ?? ''); $sub = (string) ($p['subscription'] ?? '');
    if (in_array($evento, ASSINATURA_EVENTOS_ESTORNO, true)) { if ($pid !== '') assinatura_estornar($pid); return false; }
    if (!in_array($evento, ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'], true)) return false;
    if ($pid === '' || $sub === '') return false;
    $s = db()->prepare('SELECT usuario_id FROM assinaturas WHERE assinatura_id = ?'); $s->execute([$sub]);
    $uid = $s->fetchColumn();
    if (!$uid) return false;
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare('INSERT INTO assinatura_pagamentos (pagamento_id, usuario_id, valor, pago_em) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM assinatura_pagamentos WHERE pagamento_id = ?)');
        $ins->execute([$pid, $uid, (float) ($p['value'] ?? 0), agora(), $pid]);
        if ($ins->rowCount() !== 1) { $pdo->rollBack(); return false; }
        $n = $pdo->prepare('SELECT COUNT(*) FROM assinatura_pagamentos WHERE usuario_id = ?'); $n->execute([$uid]);
        $dias = ASSINATURA_DIAS + ((int) $n->fetchColumn() === 1 ? ASSINATURA_BONUS_DIAS : 0);
        $pdo->prepare('UPDATE assinatura_pagamentos SET dias = ? WHERE pagamento_id = ?')->execute([$dias, $pid]);
        $atual = $pdo->prepare('SELECT acesso_ate FROM assinaturas WHERE usuario_id = ?'); $atual->execute([$uid]);
        $base = max(agora(), (int) $atual->fetchColumn());
        $pdo->prepare('UPDATE assinaturas SET acesso_ate = ?, atualizado_em = ? WHERE usuario_id = ?')->execute([$base + $dias * 86400, agora(), $uid]);
        $pdo->commit();
        return true;
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}
