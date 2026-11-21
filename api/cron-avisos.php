<?php
declare(strict_types=1);
/* Lepvi Finanças: avisos de vencimento por e-mail. Roda todo dia de manhã pelo agendador da Hostinger (só linha de comando).
   Uso: php cron-avisos.php [--hoje=AAAA-MM-DD] */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/_lib.php';
date_default_timezone_set('America/Sao_Paulo');

$hoje = date('Y-m-d');
foreach ($argv as $a) if (preg_match('/^--hoje=(\d{4}-\d{2}-\d{2})$/', $a, $m)) $hoje = $m[1];

function soma_mes(string $mes, int $d): string { [$a, $m] = array_map('intval', explode('-', $mes)); $t = $a * 12 + ($m - 1) + $d; return sprintf('%04d-%02d', intdiv($t, 12), $t % 12 + 1); }
/* Mesma regra do app (lib.js, faturaDe): compra depois do fechamento cai na fatura seguinte. */
function fatura_de(array $c, string $data): array
{
    $dia = (int) substr($data, 8, 2);
    $mesCompra = substr($data, 0, 7);
    $mesFecha = $dia > (int) $c['fechamento'] ? soma_mes($mesCompra, 1) : $mesCompra;
    $mesVenc = (int) $c['vencimento'] > (int) $c['fechamento'] ? $mesFecha : soma_mes($mesFecha, 1);
    $ult = (int) date('t', strtotime("$mesVenc-01"));
    return [$mesVenc, sprintf('%s-%02d', $mesVenc, min((int) $c['vencimento'], $ult))];
}
function ehCartao(array $l): bool { return str_starts_with((string) ($l['conta'] ?? ''), 'c:'); }
function brl(float $v): string { return 'R$ ' . number_format($v, 2, ',', '.'); }
function data_br(string $iso): string { return substr($iso, 8, 2) . '/' . substr($iso, 5, 2); }

/* Itens a pagar de um perfil: boletos/contas pendentes e faturas abertas. */
function itens_a_pagar(array $d): array
{
    $itens = [];
    $cartoes = $d['cartoes'] ?? [];
    foreach (($d['lancs'] ?? []) as $l) {
        if (($l['tipo'] ?? '') === 'despesa' && !ehCartao($l) && empty($l['pago']) && empty($l['ignorar'])) {
            $itens[] = ['id' => (string) $l['id'], 'titulo' => (string) ($l['desc'] ?? 'Conta'), 'valor' => (float) $l['valor'], 'venc' => (string) $l['data']];
        }
    }
    $faturas = [];
    foreach (($d['lancs'] ?? []) as $l) {
        if (!(($l['tipo'] ?? '') === 'despesa' && ehCartao($l)) || !empty($l['ignorar'])) continue;
        $cid = substr((string) $l['conta'], 2);
        $c = null; foreach ($cartoes as $x) if (($x['id'] ?? '') === $cid) $c = $x;
        if (!$c) continue;
        [$mes, $venc] = fatura_de($c, (string) $l['data']);
        $k = "$cid|$mes";
        $faturas[$k] ??= ['id' => $k, 'titulo' => 'Fatura ' . $c['nome'], 'valor' => 0.0, 'venc' => $venc, 'aberta' => false];
        $faturas[$k]['valor'] += (float) $l['valor'];
        if (empty($l['pago'])) $faturas[$k]['aberta'] = true;
    }
    foreach ($faturas as $f) if ($f['aberta']) $itens[] = $f;
    return $itens;
}

$usuarios = db()->query('SELECT * FROM usuarios WHERE avisos = 1 AND email_verificado = 1')->fetchAll();
$enviados = 0;
foreach ($usuarios as $u) {
    $s = db()->prepare('SELECT conteudo FROM dados WHERE usuario_id = ?');
    $s->execute([$u['id']]);
    $bruto = $s->fetchColumn();
    $S = $bruto ? json_decode((string) decifrar($bruto), true) : null;
    if (!is_array($S)) continue;

    $secoes = ['hoje' => [], 'breve' => [], 'atrasado' => []]; $marcar = [];
    foreach (['pessoal' => 'Pessoal', 'empresa' => 'Empresa'] as $perfil => $rotulo) {
        foreach (itens_a_pagar($S['dados'][$perfil] ?? []) as $i) {
            $dias = (int) round((strtotime($i['venc']) - strtotime($hoje)) / 86400);
            $tipo = null; $chave = null;
            if ($dias === 0) { $tipo = 'hoje'; $chave = "$perfil|{$i['id']}|hoje"; }
            elseif ($dias > 0 && $dias <= 3) { $tipo = 'breve'; $chave = "$perfil|{$i['id']}|breve"; }
            elseif ($dias < 0 && in_array(-$dias, [1, 3, 7], true)) { $tipo = 'atrasado'; $chave = "$perfil|{$i['id']}|atraso" . (-$dias); }
            if (!$tipo) continue;
            $j = db()->prepare('SELECT 1 FROM avisos WHERE usuario_id = ? AND chave = ?');
            $j->execute([$u['id'], $chave]);
            if ($j->fetchColumn()) continue;
            $secoes[$tipo][] = ['perfil' => $rotulo, 'dias' => $dias] + $i;
            $marcar[] = $chave;
        }
    }
    $total = count($secoes['hoje']) + count($secoes['breve']) + count($secoes['atrasado']);
    if ($total === 0) continue;

    $bloco = function (string $tit, string $cor, array $lista) {
        if (!$lista) return '';
        $h = '<h2 style="font-size:17px;margin:22px 0 8px;color:' . $cor . '">' . $tit . '</h2><table style="width:100%;border-collapse:collapse">';
        foreach ($lista as $i) {
            $h .= '<tr><td style="padding:10px 0;border-top:1px solid #E6E5E0"><b>' . htmlspecialchars($i['titulo']) . '</b><br><span style="color:#4A4944;font-size:14px">' . $i['perfil'] . ' · vence ' . data_br($i['venc'])
                . ($i['dias'] < 0 ? ' · atrasado há ' . (-$i['dias']) . ($i['dias'] === -1 ? ' dia' : ' dias') : ($i['dias'] === 0 ? ' · é hoje' : ' · em ' . $i['dias'] . ($i['dias'] === 1 ? ' dia' : ' dias')))
                . '</span></td><td style="padding:10px 0;border-top:1px solid #E6E5E0;text-align:right;white-space:nowrap"><b>' . brl($i['valor']) . '</b></td></tr>';
        }
        return $h . '</table>';
    };
    $nome = explode(' ', trim($u['nome']))[0];
    $corpo = '<p>Olá, ' . htmlspecialchars($nome) . '! Estes são os seus vencimentos que precisam de atenção:</p>'
        . $bloco('Vencem hoje', '#B54708', $secoes['hoje'])
        . $bloco('Já venceram', '#B42318', $secoes['atrasado'])
        . $bloco('Vencem em breve', '#2D4BFF', $secoes['breve'])
        . '<p style="font-size:14px;color:#4A4944;margin-top:22px">Depois de pagar, marque como pago no app para o aviso parar. Para desligar estes e-mails: Mais opções → Minha conta.</p>';
    $assunto = ($secoes['hoje'] ? '⏰ Vence hoje' : ($secoes['atrasado'] ? '⚠️ Vencimento atrasado' : '🔔 Vence em breve')) . ' · ' . $total . ($total === 1 ? ' item' : ' itens') . ' no Lepvi Finanças';
    if (enviar_email($u['email'], $assunto, email_html('Seus vencimentos', $corpo, 'Abrir o Lepvi Finanças', rtrim(cfg()['site_url'], '/') . '/'))) {
        foreach ($marcar as $ch) db()->prepare('INSERT INTO avisos (usuario_id, chave, enviado_em) VALUES (?,?,?)')->execute([$u['id'], $ch, agora()]);
        $enviados++;
    }
}
echo date('c') . " avisos enviados: $enviados\n";
