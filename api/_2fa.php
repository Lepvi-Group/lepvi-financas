<?php
declare(strict_types=1);
/* Lepvi Finanças: verificação em dois passos (TOTP, RFC 6238). Funciona com Google Authenticator, Microsoft Authenticator, Authy, 1Password etc.
   O segredo fica cifrado no banco; os códigos de reserva ficam só como hash (aparecem uma única vez, na hora de criar). */
require_once __DIR__ . '/_oauth.php';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32_cod(string $bin): string
{
    $bits = '';
    foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    $out = '';
    foreach (str_split($bits, 5) as $g) $out .= B32[bindec(str_pad($g, 5, '0'))];
    return $out;
}
function b32_dec(string $s): string
{
    $bits = '';
    foreach (str_split(strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s) ?? '')) as $c) $bits .= str_pad(decbin((int) strpos(B32, $c)), 5, '0', STR_PAD_LEFT);
    $out = '';
    foreach (str_split($bits, 8) as $g) if (strlen($g) === 8) $out .= chr(bindec($g));
    return $out;
}
/* Código de 6 dígitos para o passo de 30 segundos informado. */
function totp_codigo(string $segredoB32, int $passo): string
{
    $h = hash_hmac('sha1', pack('J', $passo), b32_dec($segredoB32), true);
    $o = ord($h[19]) & 0x0F;
    $n = ((ord($h[$o]) & 0x7F) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string) ($n % 1000000), 6, '0', STR_PAD_LEFT);
}
/* Confere o código com tolerância de 30 s para cada lado. Devolve o passo usado (para não aceitar o mesmo código de novo) ou null. */
function totp_conferir_passo(string $segredoB32, string $codigo, int $ultimoPasso, ?int $agora = null): ?int
{
    $codigo = preg_replace('/\D/', '', $codigo) ?? '';
    if (strlen($codigo) !== 6) return null;
    $atual = intdiv($agora ?? agora(), 30);
    for ($d = -1; $d <= 1; $d++) {
        $p = $atual + $d;
        if ($p > $ultimoPasso && hash_equals(totp_codigo($segredoB32, $p), $codigo)) return $p;
    }
    return null;
}
function totp_novo_segredo(): string { return b32_cod(random_bytes(20)); }
function totp_uri(string $email, string $segredo): string
{
    return 'otpauth://totp/' . rawurlencode('Lepvi Finanças:' . $email) . '?secret=' . $segredo . '&issuer=' . rawurlencode('Lepvi Finanças') . '&algorithm=SHA1&digits=6&period=30';
}
/* 8 códigos de reserva (uso único). Devolve [os códigos para mostrar, os hashes para guardar]. */
function totp_novos_reservas(): array
{
    $mostrar = []; $hashes = [];
    for ($i = 0; $i < 8; $i++) {
        $c = strtolower(bin2hex(random_bytes(4)));
        $mostrar[] = substr($c, 0, 4) . '-' . substr($c, 4);
        $hashes[] = hash('sha256', $c);
    }
    return [$mostrar, $hashes];
}
function totp_ativo(array $u): bool { return !empty($u['totp_ativo']) && !empty($u['totp_segredo']); }

/* Aceita o código do app ou um código de reserva. Grava o passo usado / consome a reserva. */
function totp_validar_usuario(array $u, string $codigo): bool
{
    $seg = $u['totp_segredo'] ? (string) decifrar((string) $u['totp_segredo']) : '';
    if ($seg === '') return false;
    $limpo = strtolower(preg_replace('/[^0-9a-zA-Z]/', '', $codigo) ?? '');
    if (preg_match('/^\d{6}$/', $limpo)) {
        $p = totp_conferir_passo($seg, $limpo, (int) ($u['totp_passo'] ?? 0));
        if ($p === null) return false;
        // Gravação condicional: dois pedidos ao mesmo tempo com o mesmo código não entram os dois (só um avança o passo).
        $q = db()->prepare('UPDATE usuarios SET totp_passo = ? WHERE id = ? AND totp_passo < ?');
        $q->execute([$p, $u['id'], $p]);
        return $q->rowCount() === 1;
    }
    if (!preg_match('/^[0-9a-f]{8}$/', $limpo)) return false;
    $lista = json_decode((string) ($u['totp_reservas'] ?? '[]'), true);
    $h = hash('sha256', $limpo);
    if (!is_array($lista) || !in_array($h, $lista, true)) return false;
    // Só consome se a lista ainda for a mesma que lemos: a mesma reserva usada duas vezes ao mesmo tempo vale uma só.
    $q = db()->prepare('UPDATE usuarios SET totp_reservas = ? WHERE id = ? AND totp_reservas = ?');
    $q->execute([json_encode(array_values(array_diff($lista, [$h]))), $u['id'], (string) $u['totp_reservas']]);
    return $q->rowCount() === 1;
}
function totp_usuario(string $uid): ?array
{
    $s = db()->prepare('SELECT * FROM usuarios WHERE id = ?'); $s->execute([$uid]);
    return $s->fetch() ?: null;
}
