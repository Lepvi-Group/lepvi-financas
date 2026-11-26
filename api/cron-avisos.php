<?php
declare(strict_types=1);
/* Lepvi Finanças: avisos de vencimento por e-mail. Roda todo dia de manhã pelo agendador da Hostinger (só linha de comando).
   Uso: php cron-avisos.php [--hoje=AAAA-MM-DD] */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/_openfinance.php';
require __DIR__ . '/_assinatura.php';
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

/* Lembrete de manhã para quem ligou: ontem ficou sem nenhum lançamento (só para quem usa de verdade: 5 lançamentos ou mais e algum nos últimos 14 dias). */
function lembrete_lancar_rodar(string $hoje): int
{
    $enviados = 0; $ontem = date('Y-m-d', strtotime("$hoje -1 day")); $limite = date('Y-m-d', strtotime("$hoje -14 days"));
    foreach (db()->query('SELECT * FROM usuarios WHERE lembrete = 1 AND email_verificado = 1')->fetchAll() as $u) {
        $chave = 'lembrete|' . $hoje;
        $j = db()->prepare('SELECT 1 FROM avisos WHERE usuario_id = ? AND chave = ?'); $j->execute([$u['id'], $chave]);
        if ($j->fetchColumn()) continue;
        $s = db()->prepare('SELECT conteudo FROM dados WHERE usuario_id = ?'); $s->execute([espaco_dono($u['id'])]);
        $bruto = $s->fetchColumn(); $S = $bruto ? json_decode((string) decifrar($bruto), true) : null;
        if (!is_array($S)) continue;
        $total = 0; $teveOntem = false; $recente = false;
        foreach (($S['dados'] ?? []) as $perfil) foreach (($perfil['lancs'] ?? []) as $l) {
            $d = (string) ($l['data'] ?? ''); $total++;
            if ($d === $ontem) $teveOntem = true;
            if ($d >= $limite && $d <= $hoje) $recente = true;
        }
        if ($teveOntem || !$recente || $total < 5) continue;
        $nome = explode(' ', trim($u['nome']))[0];
        $corpo = '<p>Olá, ' . htmlspecialchars($nome) . '! Ontem ficou sem nenhum lançamento no Lepvi Finanças.</p><p>Gastou ou recebeu alguma coisa? Leva menos de um minuto: toque em <b>+</b> e escreva, por exemplo, <i>gastei 45 no mercado</i>.</p><p style="font-size:14px;color:#4A4944;margin-top:22px">Para desligar este lembrete: Meu perfil → Lembrete se esquecer de lançar.</p>';
        if (enviar_email($u['email'], '📝 Ontem ficou sem lançamentos', email_html('Você lançou ontem?', $corpo, 'Abrir o Lepvi Finanças', rtrim(cfg()['site_url'], '/') . '/'))) {
            db()->prepare('INSERT INTO avisos (usuario_id, chave, enviado_em) VALUES (?,?,?)')->execute([$u['id'], $chave, agora()]); $enviados++;
        }
    }
    return $enviados;
}

/* Resumo da semana (rodado às segundas): quanto gastou, o que mudou, onde mais gastou e o que vence nos próximos 7 dias. */
function resumo_semanal_rodar(string $hoje): int
{
    $enviados = 0; $semana = date('o-\WW', strtotime($hoje));
    $dia = fn(int $n) => date('Y-m-d', strtotime("$hoje $n days"));
    $ini = $dia(-7); $fim = $dia(-1); $iniAnt = $dia(-14); $fimAnt = $dia(-8);
    foreach (db()->query('SELECT * FROM usuarios WHERE resumo = 1 AND email_verificado = 1')->fetchAll() as $u) {
        $chave = 'semanal|' . $semana;
        $j = db()->prepare('SELECT 1 FROM avisos WHERE usuario_id = ? AND chave = ?'); $j->execute([$u['id'], $chave]);
        if ($j->fetchColumn()) continue;
        $s = db()->prepare('SELECT conteudo FROM dados WHERE usuario_id = ?'); $s->execute([espaco_dono($u['id'])]);
        $bruto = $s->fetchColumn(); $S = $bruto ? json_decode((string) decifrar($bruto), true) : null;
        if (!is_array($S)) continue;
        $tot = 0.0; $ant = 0.0; $rec = 0.0; $cats = []; $lista = []; $proximos = [];
        foreach (($S['dados'] ?? []) as $d) {
            foreach (($d['lancs'] ?? []) as $l) {
                if (!empty($l['ignorar']) || ($l['tipo'] ?? '') === 'transf') continue;
                $v = (float) ($l['valor'] ?? 0); $dt = (string) ($l['data'] ?? '');
                if (($l['tipo'] ?? '') === 'despesa') {
                    if ($dt >= $ini && $dt <= $fim) { $tot += $v; $cats[$l['categoria'] ?? 'Outros'] = ($cats[$l['categoria'] ?? 'Outros'] ?? 0) + $v; $lista[] = ['t' => (string) ($l['desc'] ?? ''), 'v' => $v, 'd' => $dt]; }
                    elseif ($dt >= $iniAnt && $dt <= $fimAnt) $ant += $v;
                } elseif (($l['tipo'] ?? '') === 'receita' && $dt >= $ini && $dt <= $fim) $rec += $v;
            }
            foreach (itens_a_pagar($d) as $i) { $dias = (int) round((strtotime($i['venc']) - strtotime($hoje)) / 86400); if ($dias >= 0 && $dias <= 7) $proximos[] = $i + ['dias' => $dias]; }
        }
        if ($tot == 0.0 && $rec == 0.0 && !$proximos) continue;
        arsort($cats); usort($lista, fn($a, $b) => $b['v'] <=> $a['v']); usort($proximos, fn($a, $b) => strcmp($a['venc'], $b['venc']));
        $dif = $tot - $ant; $nome = explode(' ', trim($u['nome']))[0];
        $tr = fn(string $a, string $b, string $cor = '#0D0D0F') => '<tr><td style="padding:9px 0;border-top:1px solid #E6E5E0">' . $a . '</td><td style="padding:9px 0;border-top:1px solid #E6E5E0;text-align:right;white-space:nowrap;color:' . $cor . '"><b>' . $b . '</b></td></tr>';
        $corpo = '<p>Olá, ' . htmlspecialchars($nome) . '! Veja como foi a sua semana (' . data_br($ini) . ' a ' . data_br($fim) . '):</p>'
            . '<table style="width:100%;border-collapse:collapse;margin:8px 0 4px">' . $tr('Você gastou', brl($tot)) . $tr('Semana anterior', brl($ant), '#4A4944') . $tr($dif > 0 ? 'A mais que na semana anterior' : 'A menos que na semana anterior', brl(abs($dif)), $dif > 0 ? '#B42318' : '#0A7656') . ($rec > 0 ? $tr('Entrou', brl($rec), '#0A7656') : '') . '</table>';
        if ($cats) { $corpo .= '<h2 style="font-size:17px;margin:20px 0 6px">Onde você mais gastou</h2><table style="width:100%;border-collapse:collapse">'; foreach (array_slice($cats, 0, 3, true) as $k => $v) $corpo .= $tr(htmlspecialchars((string) $k), brl($v)); $corpo .= '</table>'; }
        if ($lista) { $corpo .= '<h2 style="font-size:17px;margin:20px 0 6px">Maiores gastos</h2><table style="width:100%;border-collapse:collapse">'; foreach (array_slice($lista, 0, 3) as $x) $corpo .= $tr(htmlspecialchars($x['t']) . ' <span style="color:#4A4944;font-size:13px">' . data_br($x['d']) . '</span>', brl($x['v'])); $corpo .= '</table>'; }
        if ($proximos) { $corpo .= '<h2 style="font-size:17px;margin:20px 0 6px;color:#2D4BFF">Vence nos próximos 7 dias</h2><table style="width:100%;border-collapse:collapse">'; foreach (array_slice($proximos, 0, 8) as $x) $corpo .= $tr(htmlspecialchars($x['titulo']) . ' <span style="color:#4A4944;font-size:13px">' . ($x['dias'] === 0 ? 'hoje' : 'em ' . $x['dias'] . ($x['dias'] === 1 ? ' dia' : ' dias')) . '</span>', brl($x['valor'])); $corpo .= '</table>'; }
        $corpo .= '<p style="font-size:14px;color:#4A4944;margin-top:22px">Para desligar este resumo: Meu perfil → Resumo semanal.</p>';
        if (enviar_email($u['email'], '📊 Seu resumo da semana · ' . brl($tot) . ' gastos', email_html('Resumo da semana', $corpo, 'Abrir o Lepvi Finanças', rtrim(cfg()['site_url'], '/') . '/'))) {
            db()->prepare('INSERT INTO avisos (usuario_id, chave, enviado_em) VALUES (?,?,?)')->execute([$u['id'], $chave, agora()]); $enviados++;
        }
    }
    return $enviados;
}
if (in_array('--lembrete', $argv, true)) { echo date('c') . ' lembretes enviados: ' . lembrete_lancar_rodar($hoje) . "\n"; exit; }
if (in_array('--semanal', $argv, true)) { echo date('c') . ' resumos enviados: ' . resumo_semanal_rodar($hoje) . "\n"; exit; }

$usuarios = db()->query('SELECT * FROM usuarios WHERE avisos = 1 AND email_verificado = 1')->fetchAll();
$enviados = 0;
foreach ($usuarios as $u) {
    $s = db()->prepare('SELECT conteudo FROM dados WHERE usuario_id = ?');
    $s->execute([espaco_dono($u['id'])]);
    $bruto = $s->fetchColumn();
    $S = $bruto ? json_decode((string) decifrar($bruto), true) : null;
    if (!is_array($S)) continue;

    $secoes = ['hoje' => [], 'breve' => [], 'atrasado' => [], 'orc' => []]; $marcar = [];
    foreach (['pessoal' => '', 'empresa' => ''] as $perfil => $rotulo) {
        // Limite por categoria: avisa quando passa de 80% e de 100% do mês
        $mesAtual = substr($hoje, 0, 7); $gastos = [];
        foreach (($S['dados'][$perfil]['lancs'] ?? []) as $l) {
            if (($l['tipo'] ?? '') === 'despesa' && empty($l['ignorar']) && substr((string) $l['data'], 0, 7) === $mesAtual) $gastos[$l['categoria']] = ($gastos[$l['categoria']] ?? 0) + (float) $l['valor'];
        }
        foreach (($S['dados'][$perfil]['orcamentos'] ?? []) as $cat => $limite) {
            $limite = (float) $limite; if ($limite <= 0) continue;
            $pct = (int) floor((($gastos[$cat] ?? 0) / $limite) * 100);
            $nivel = $pct >= 100 ? '100' : ($pct >= 80 ? '80' : null); if (!$nivel) continue;
            $chave = "orc|$cat|$mesAtual|$nivel";
            $j = db()->prepare('SELECT 1 FROM avisos WHERE usuario_id = ? AND chave = ?'); $j->execute([$u['id'], $chave]);
            if ($j->fetchColumn()) continue;
            $secoes['orc'][] = ['titulo' => $cat . ': ' . $pct . '% do limite do mês', 'valor' => (float) ($gastos[$cat] ?? 0), 'limite' => $limite, 'nivel' => $nivel];
            $marcar[] = $chave;
        }
        foreach (itens_a_pagar($S['dados'][$perfil] ?? []) as $i) {
            $dias = (int) round((strtotime($i['venc']) - strtotime($hoje)) / 86400);
            $tipo = null; $chave = null;
            if ($dias === 0) { $tipo = 'hoje'; $chave = "$perfil|{$i['id']}|hoje"; }
            elseif ($dias === 1) { $tipo = 'breve'; $chave = "$perfil|{$i['id']}|vespera"; } // regra da Larissa: avisa 1 dia antes e no dia, sempre no e-mail cadastrado
            elseif ($dias < 0 && in_array(-$dias, [1, 3, 7], true)) { $tipo = 'atrasado'; $chave = "$perfil|{$i['id']}|atraso" . (-$dias); }
            if (!$tipo) continue;
            $j = db()->prepare('SELECT 1 FROM avisos WHERE usuario_id = ? AND chave = ?');
            $j->execute([$u['id'], $chave]);
            if ($j->fetchColumn()) continue;
            $secoes[$tipo][] = ['perfil' => $rotulo, 'dias' => $dias] + $i;
            $marcar[] = $chave;
        }
    }
    $total = count($secoes['hoje']) + count($secoes['breve']) + count($secoes['atrasado']) + count($secoes['orc']);
    if ($total === 0) continue;

    $bloco = function (string $tit, string $cor, array $lista) {
        if (!$lista) return '';
        $h = '<h2 style="font-size:17px;margin:22px 0 8px;color:' . $cor . '">' . $tit . '</h2><table style="width:100%;border-collapse:collapse">';
        foreach ($lista as $i) {
            $h .= '<tr><td style="padding:10px 0;border-top:1px solid #E6E5E0"><b>' . htmlspecialchars($i['titulo']) . '</b><br><span style="color:#4A4944;font-size:14px">' . ($i['perfil'] !== '' ? $i['perfil'] . ' · ' : '') . 'vence ' . data_br($i['venc'])
                . ($i['dias'] < 0 ? ' · atrasado há ' . (-$i['dias']) . ($i['dias'] === -1 ? ' dia' : ' dias') : ($i['dias'] === 0 ? ' · é hoje' : ' · em ' . $i['dias'] . ($i['dias'] === 1 ? ' dia' : ' dias')))
                . '</span></td><td style="padding:10px 0;border-top:1px solid #E6E5E0;text-align:right;white-space:nowrap"><b>' . brl($i['valor']) . '</b></td></tr>';
        }
        return $h . '</table>';
    };
    $blocoOrc = function (array $lista) {
        if (!$lista) return '';
        $h = '<h2 style="font-size:17px;margin:22px 0 8px;color:#8A3DFF">Orçamento do mês</h2><table style="width:100%;border-collapse:collapse">';
        foreach ($lista as $i) $h .= '<tr><td style="padding:10px 0;border-top:1px solid #E6E5E0"><b>' . htmlspecialchars($i['titulo']) . '</b><br><span style="color:#4A4944;font-size:14px">' . ($i['nivel'] === '100' ? 'O limite foi ultrapassado.' : 'Está chegando no limite.') . '</span></td><td style="padding:10px 0;border-top:1px solid #E6E5E0;text-align:right;white-space:nowrap"><b>' . brl($i['valor']) . '</b><br><span style="color:#4A4944;font-size:14px">de ' . brl($i['limite']) . '</span></td></tr>';
        return $h . '</table>';
    };
    $nome = explode(' ', trim($u['nome']))[0];
    $corpo = '<p>Olá, ' . htmlspecialchars($nome) . '! Estes são os seus vencimentos que precisam de atenção:</p>'
        . $bloco('Vencem hoje', '#B54708', $secoes['hoje'])
        . $bloco('Já venceram', '#B42318', $secoes['atrasado'])
        . $bloco('Vencem amanhã', '#2D4BFF', $secoes['breve'])
        . $blocoOrc($secoes['orc'])
        . '<p style="font-size:14px;color:#4A4944;margin-top:22px">Depois de pagar, marque como pago no app para o aviso parar. Para desligar estes e-mails: Mais opções → Minha conta.</p>';
    $assunto = ($secoes['hoje'] ? '⏰ Vence hoje' : ($secoes['atrasado'] ? '⚠️ Vencimento atrasado' : ($secoes['breve'] ? '🔔 Vence amanhã' : '📊 Orçamento do mês'))) . ' · ' . $total . ($total === 1 ? ' item' : ' itens') . ' no Lepvi Finanças';
    if (enviar_email($u['email'], $assunto, email_html('Seus vencimentos', $corpo, 'Abrir o Lepvi Finanças', rtrim(cfg()['site_url'], '/') . '/'))) {
        foreach ($marcar as $ch) db()->prepare('INSERT INTO avisos (usuario_id, chave, enviado_em) VALUES (?,?,?)')->execute([$u['id'], $ch, agora()]);
        $enviados++;
    }
}
$lembretes = lembrete_lancar_rodar($hoje);
$assin = assinatura_avisos_rodar($hoje);
try { $bancos = pluggy_sincronizar_todos(); } catch (Throwable $e) { $bancos = 0; error_log('[lepvi-financas pluggy] ' . $e->getMessage()); }
echo date('c') . " avisos enviados: $enviados, lembretes: $lembretes, assinatura: $assin, movimentações do banco: $bancos\n";
