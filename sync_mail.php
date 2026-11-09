<?php
/**
 * MÜLK Spor Kulübü - cPanel / Web Sunucu Canlı E-Posta Senkronizasyon Motoru
 * ------------------------------------------------------------------------
 * Bu dosya, web sunucunuzda (cPanel / Apache / Nginx) arka planda veya
 * panel.html üzerinden tetiklenerek mail.mulksporkulubu.com IMAP sunucusundan
 * gerçek e-postaları çeker ve JSON formatında güvenli bir şekilde sunar.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$dataFile = __DIR__ . '/emails.json';
$configFile = __DIR__ . '/mail_config.json';

// Varsayılan Yapılandırma
$config = [
    'info' => [
        'host' => 'mail.mulksporkulubu.com',
        'port' => 993,
        'user' => 'info@mulksporkulubu.com',
        'pass' => '', // Sunucu cPanel e-posta şifresi
        'flags' => '/imap/ssl/novalidate-cert'
    ],
    'gmail' => [
        'host' => 'imap.gmail.com',
        'port' => 993,
        'user' => 'mulksporkulubu@gmail.com',
        'pass' => '', // Google Uygulama Şifresi
        'flags' => '/imap/ssl/novalidate-cert'
    ]
];

if (file_exists($configFile)) {
    $saved = json_decode(file_get_contents($configFile), true);
    if (is_array($saved)) {
        if (!empty($saved['info_password'])) $config['info']['pass'] = $saved['info_password'];
        if (!empty($saved['gmail_password'])) $config['gmail']['pass'] = $saved['gmail_password'];
    }
}

// POST ile şifre güncelleme
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if ($input) {
        if (!empty($input['info_password'])) $config['info']['pass'] = $input['info_password'];
        if (!empty($input['gmail_password'])) $config['gmail']['pass'] = $input['gmail_password'];
        file_put_contents($configFile, json_encode([
            'info_password' => $config['info']['pass'],
            'gmail_password' => $config['gmail']['pass'],
            'updated_at' => date('Y-m-d H:i:s')
        ], JSON_PRETTY_PRINT));
    }
}

// IMAP Fonksiyonu Varsa Gerçek E-postaları Çek
$fetchedMails = [];
$errorMsg = null;

function fetchAccountImap($accountConfig, $accountEmail) {
    $mails = [];
    if (empty($accountConfig['pass']) || !function_exists('imap_open')) {
        return $mails;
    }

    $mailbox = "{" . $accountConfig['host'] . ":" . $accountConfig['port'] . $accountConfig['flags'] . "}INBOX";
    $inbox = @imap_open($mailbox, $accountConfig['user'], $accountConfig['pass']);
    if (!$inbox) {
        return $mails;
    }

    $numMessages = imap_num_msg($inbox);
    $start = max(1, $numMessages - 19); // Son 20 ileti

    for ($i = $numMessages; $i >= $start; $i--) {
        $header = imap_headerinfo($inbox, $i);
        $structure = imap_fetchstructure($inbox, $i);

        $subject = isset($header->subject) ? mb_decode_mimeheader($header->subject) : '(Konu Yok)';
        $fromName = isset($header->from[0]->personal) ? mb_decode_mimeheader($header->from[0]->personal) : '';
        $fromEmail = isset($header->from[0]->mailbox, $header->from[0]->host) ? $header->from[0]->mailbox . '@' . $header->from[0]->host : '';
        $date = isset($header->date) ? date('d M Y H:i', strtotime($header->date)) : 'Bugün';

        // Gövdeyi al (düz metin)
        $body = imap_fetchbody($inbox, $i, '1');
        if ($structure && isset($structure->parts[0]->encoding) && $structure->parts[0]->encoding == 3) {
            $body = base64_decode($body);
        } elseif ($structure && isset($structure->parts[0]->encoding) && $structure->parts[0]->encoding == 4) {
            $body = quoted_printable_decode($body);
        }

        $mails[] = [
            'id' => 'IMAP-' . md5($accountEmail . $header->message_id . $date),
            'account' => $accountEmail,
            'folder' => 'inbox',
            'fromName' => $fromName ?: $fromEmail,
            'fromEmail' => $fromEmail,
            'to' => $accountEmail,
            'subject' => $subject,
            'date' => $date,
            'unread' => ($header->Unseen == 'U' || $header->Recent == 'N'),
            'starred' => ($header->Flagged == 'F'),
            'athleteName' => '',
            'body' => strip_tags($body) ?: '(E-posta içeriği okundu)'
        ];
    }

    imap_close($inbox);
    return $mails;
}

// 1. info@ hesabı
$infoMails = fetchAccountImap($config['info'], 'info@mulksporkulubu.com');
// 2. gmail hesabı
$gmailMails = fetchAccountImap($config['gmail'], 'mulksporkulubu@gmail.com');

$allLiveMails = array_merge($infoMails, $gmailMails);

// Mevcut dosyayı oku veya güncelle
$existingEmails = [];
if (file_exists($dataFile)) {
    $existingEmails = json_decode(file_get_contents($dataFile), true) ?: [];
}

if (!empty($allLiveMails)) {
    $existingMap = [];
    foreach ($existingEmails as $em) {
        $existingMap[$em['id']] = true;
    }
    foreach ($allLiveMails as $lm) {
        if (!isset($existingMap[$lm['id']])) {
            array_unshift($existingEmails, $lm);
        }
    }
    file_put_contents($dataFile, json_encode($existingEmails, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

echo json_encode([
    'status' => 'success',
    'timestamp' => date('Y-m-d H:i:s'),
    'count' => count($existingEmails),
    'imap_supported' => function_exists('imap_open'),
    'emails' => $existingEmails
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

