<?php
declare(strict_types=1);
/* Lepvi Finanças: captura automática. Lê o texto de um aviso do banco (notificação, SMS ou e-mail) e transforma em um lançamento "para revisar". */
require_once __DIR__ . '/_lib.php';

/* Interpreta o texto de um aviso. Devolve null se não achar um valor em reais. */
function captura_interpretar(string $texto, ?string $hoje = null): ?array
{
    $t = trim(preg_replace('/\s+/u', ' ', strip_tags($texto)) ?? '');
    if ($t === '' || mb_strlen($t) > 2000) return null;
    if (!preg_match('/(?:R\$|BRL)\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+,[0-9]{2})/iu', $t, $m)) return null;
    $valor = (float) str_replace(',', '.', str_replace('.', '', $m[1]));
    if ($valor <= 0) return null;
    $tipo = preg_match('/recebid|recebeu|cr[eé]dito em conta|dep[oó]sito|estorno|reembolso|cashback/iu', $t) ? 'receita' : 'despesa';
    $final = preg_match('/final\s*(\d{4})/iu', $t, $f) || preg_match('/cart[aã]o[^0-9]{0,15}(\d{4})/iu', $t, $f) ? $f[1] : null;
    $desc = '';
    if (preg_match_all('/\b(?:em|no|na|estabelecimento|local)[:\s]+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 *&\'\-\.]{2,40}?)(?=\s*(?:\.|,|;|\s-\s|\s(?:com|no|na|às|as|em|valor|de|via|aprovad|final|hoje|ontem)\b|$))/iu', $t, $mm) && !empty($mm[1])) $desc = trim(end($mm[1]), " .-*");
    $desc = trim(preg_replace('/^(?:estabelecimento|local)[:\s]+/iu', '', $desc), " .-*");
    if ($desc === '' || preg_match('/^(cart[aã]o|conta|sua|seu|r\$)/iu', $desc)) $desc = $tipo === 'receita' ? 'Valor recebido' : 'Compra no cartão';
    $data = $hoje ?? date('Y-m-d');
    if (preg_match('/\b(\d{2})\/(\d{2})(?:\/(\d{4}))?\b/', $t, $d) && (int) $d[2] >= 1 && (int) $d[2] <= 12 && (int) $d[1] >= 1 && (int) $d[1] <= 31) {
        $ano = $d[3] ?? substr($data, 0, 4);
        $data = sprintf('%04d-%02d-%02d', (int) $ano, (int) $d[2], (int) $d[1]);
    }
    return ['valor' => round($valor, 2), 'desc' => mb_substr($desc, 0, 60), 'tipo' => $tipo, 'final' => $final, 'data' => $data, 'texto' => mb_substr($t, 0, 300)];
}

function captura_guardar(string $uid, array $c): string
{
    $id = novo_id();
    db()->prepare('INSERT INTO capturas (id, usuario_id, conteudo, criado_em) VALUES (?,?,?,?)')->execute([$id, $uid, cifrar((string) json_encode($c, JSON_UNESCAPED_UNICODE)), agora()]);
    // evita acúmulo: guarda no máximo 200 pendentes por pessoa
    db()->prepare('DELETE FROM capturas WHERE usuario_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM capturas WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT 200) t)')->execute([$uid, $uid]);
    return $id;
}
function capturas_listar(string $uid): array
{
    $s = db()->prepare('SELECT id, conteudo, criado_em FROM capturas WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT 200');
    $s->execute([$uid]);
    return array_values(array_filter(array_map(function ($r) {
        $j = json_decode((string) decifrar($r['conteudo']), true);
        return is_array($j) ? ['id' => $r['id']] + $j : null;
    }, $s->fetchAll())));
}
