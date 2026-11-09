#!/usr/bin/env python3
"""
MÜLK Spor Kulübü - Arka Plan Canlı E-Posta Senkronizasyon Servisi
---------------------------------------------------------------
Bu servis, info@mulksporkulubu.com ve mulksporkulubu@gmail.com hesaplarınızı
arka planda kesintisiz olarak dinler, gelen yeni e-postaları yakalar ve
yönetim paneline (panel.html) anında canlı veri olarak aktarır.

Kullanım:
    python3 mail_sync.py
    veya 'E-Posta-Senkronizasyonu-Baslat.command' dosyasına çift tıklayın.
"""

import os
import sys
import time
import json
import email
from email.header import decode_header
import imaplib
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

EMAILS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'emails.json')
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mail_config.json')

DEFAULT_CONFIG = {
    "sync_interval_seconds": 30,
    "http_port": 8080,
    "accounts": [
        {
            "id": "info",
            "email": "info@mulksporkulubu.com",
            "host": "mail.mulksporkulubu.com",
            "port": 993,
            "ssl": True,
            "password": "", # cPanel / Webmail e-posta şifreniz
            "enabled": True
        },
        {
            "id": "gmail",
            "email": "mulksporkulubu@gmail.com",
            "host": "imap.gmail.com",
            "port": 993,
            "ssl": True,
            "password": "", # Google Uygulama Şifresi (App Password)
            "enabled": True
        }
    ]
}

def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    if 'info_password' in data and data['info_password']:
                        cfg['accounts'][0]['password'] = data['info_password']
                    if 'gmail_password' in data and data['gmail_password']:
                        cfg['accounts'][1]['password'] = data['gmail_password']
                    if 'accounts' in data and isinstance(data['accounts'], list):
                        cfg['accounts'] = data['accounts']
                    if 'sync_interval_seconds' in data:
                        cfg['sync_interval_seconds'] = int(data['sync_interval_seconds'])
        except Exception as e:
            print(f"[UYARI] Yapılandırma dosyası okunurken hata: {e}")
    return cfg

def save_config(cfg):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        # Hem Python hem PHP uyumlu formatta kaydet
        save_data = {
            "sync_interval_seconds": cfg.get("sync_interval_seconds", 30),
            "http_port": cfg.get("http_port", 8080),
            "info_password": cfg['accounts'][0].get('password', '') if len(cfg.get('accounts', [])) > 0 else '',
            "gmail_password": cfg['accounts'][1].get('password', '') if len(cfg.get('accounts', [])) > 1 else '',
            "accounts": cfg.get("accounts", []),
            "updated_at": time.strftime('%Y-%m-%d %H:%M:%S')
        }
        json.dump(save_data, f, ensure_ascii=False, indent=2)

def load_emails():
    if os.path.exists(EMAILS_FILE):
        try:
            with open(EMAILS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception:
            pass
    return []

def save_emails(emails_list):
    with open(EMAILS_FILE, 'w', encoding='utf-8') as f:
        json.dump(emails_list, f, ensure_ascii=False, indent=2)

def decode_mime_words(s):
    if not s:
        return ""
    decoded_fragments = []
    for fragment, encoding in decode_header(s):
        if isinstance(fragment, bytes):
            try:
                decoded_fragments.append(fragment.decode(encoding or 'utf-8', errors='replace'))
            except Exception:
                decoded_fragments.append(fragment.decode('latin-1', errors='replace'))
        else:
            decoded_fragments.append(str(fragment))
    return "".join(decoded_fragments)

def test_account_connection(account):
    acc_email = account.get('email')
    host = account.get('host')
    port = account.get('port', 993)
    password = account.get('password', '')

    if not password:
        return {
            "account": acc_email,
            "success": False,
            "error": "Şifre girilmedi. Lütfen 'Senkronizasyon & Şifre' bölümünden şifrenizi girin."
        }

    hosts_to_try = [host]
    if 'mail.' in host:
        hosts_to_try.append(host.replace('mail.', ''))

    last_err = None
    for h in hosts_to_try:
        try:
            mail = imaplib.IMAP4_SSL(h, port, timeout=10)
            mail.login(acc_email, password)
            mail.select('INBOX', readonly=True)
            status, messages = mail.search(None, 'ALL')
            count = len(messages[0].split()) if status == 'OK' and messages[0] else 0
            mail.close()
            mail.logout()
            return {
                "account": acc_email,
                "success": True,
                "count": count,
                "message": f"Bağlantı başarılı! Gelen kutusunda {count} adet e-posta mevcut."
            }
        except Exception as e:
            last_err = e

    err_str = str(last_err)
    if "AUTHENTICATIONFAILED" in err_str and "gmail" in acc_email.lower():
        err_str = "Google kimlik doğrulamasını reddetti. Normal Gmail şifresi yerine Google Hesabı > Güvenlik > 2 Adımlı Doğrulama > 'Uygulama Şifreleri'nden 16 haneli özel şifre almalısınız."
    elif "AUTHENTICATIONFAILED" in err_str:
        err_str = "Kullanıcı adı veya şifre hatalı. Lütfen cPanel e-posta şifrenizi kontrol edin."
    elif "nodename nor servname provided" in err_str or "timed out" in err_str:
        err_str = f"Sunucuya ({host}) bağlanılamadı. İnternet bağlantınızı kontrol ediniz."

    return {
        "account": acc_email,
        "success": False,
        "error": err_str
    }

def fetch_account_emails(account):
    new_mails = []
    acc_email = account.get('email')
    host = account.get('host')
    port = account.get('port', 993)
    password = account.get('password')

    if not password:
        return []

    hosts_to_try = [host]
    if 'mail.' in host:
        hosts_to_try.append(host.replace('mail.', ''))

    mail = None
    connected_host = None
    for h in hosts_to_try:
        try:
            mail = imaplib.IMAP4_SSL(h, port, timeout=10)
            mail.login(acc_email, password)
            connected_host = h
            break
        except Exception as e:
            mail = None

    if not mail:
        print(f"[{acc_email}] E-posta sunucusuna bağlanılamadı veya şifre hatalı.")
        return []

    try:
        mail.select('INBOX', readonly=True)

        status, messages = mail.search(None, 'ALL')
        if status != 'OK' or not messages[0]:
            mail.close()
            mail.logout()
            return []

        msg_ids = messages[0].split()
        recent_ids = msg_ids[-30:] # Son 30 ileti

        for msg_id in reversed(recent_ids):
            try:
                res, data = mail.fetch(msg_id, '(RFC822)')
                if res != 'OK':
                    continue

                raw_email = data[0][1]
                msg = email.message_from_bytes(raw_email)

                subject = decode_mime_words(msg.get('Subject', '(Konu Yok)'))
                from_raw = decode_mime_words(msg.get('From', ''))
                to_raw = decode_mime_words(msg.get('To', acc_email))
                date_raw = msg.get('Date', '')

                from_name = from_raw
                from_email = from_raw
                if '<' in from_raw and '>' in from_raw:
                    parts = from_raw.split('<')
                    from_name = parts[0].strip().replace('"', '')
                    from_email = parts[1].replace('>', '').strip()

                body = ""
                if msg.is_multipart():
                    for part in msg.walk():
                        content_type = part.get_content_type()
                        content_disposition = str(part.get("Content-Disposition"))
                        if content_type == "text/plain" and "attachment" not in content_disposition:
                            payload = part.get_payload(decode=True)
                            if payload:
                                body = payload.decode(part.get_content_charset() or 'utf-8', errors='replace')
                                break
                    if not body:
                        # Düz metin yoksa HTML kısmını al
                        for part in msg.walk():
                            if part.get_content_type() == "text/html":
                                payload = part.get_payload(decode=True)
                                if payload:
                                    body = payload.decode(part.get_content_charset() or 'utf-8', errors='replace')
                                    break
                else:
                    payload = msg.get_payload(decode=True)
                    if payload:
                        body = payload.decode(msg.get_content_charset() or 'utf-8', errors='replace')

                clean_id = msg_id.decode('ascii', errors='ignore')
                mail_id = f"LIVE-{acc_email}-{clean_id}"

                mail_obj = {
                    "id": mail_id,
                    "account": acc_email,
                    "folder": "inbox",
                    "fromName": from_name or from_email,
                    "fromEmail": from_email,
                    "to": to_raw,
                    "subject": subject,
                    "date": date_raw[:25] if date_raw else "Şimdi",
                    "unread": True,
                    "starred": False,
                    "athleteName": "",
                    "body": body.strip() or "(İleti metni bulunamadı)"
                }
                new_mails.append(mail_obj)
            except Exception as item_err:
                continue

        mail.close()
        mail.logout()
    except Exception as e:
        print(f"[{acc_email}] İleti okuma hatası: {e}")

    return new_mails

def sync_all():
    cfg = load_config()
    existing = load_emails()
    existing_map = {m['id']: m for m in existing}
    added_count = 0

    print(f"\n[{time.strftime('%H:%M:%S')}] Canlı e-posta kontrolü yapılıyor...")

    for acc in cfg.get('accounts', []):
        if not acc.get('enabled'):
            continue
        acc_email = acc.get('email')
        if not acc.get('password'):
            print(f"  • {acc_email}: Şifre girilmemiş, atlandı.")
            continue

        print(f"  • {acc_email}: Sunucu taranıyor...")
        mails = fetch_account_emails(acc)
        account_new = 0
        for m in mails:
            if m['id'] not in existing_map:
                existing.insert(0, m)
                existing_map[m['id']] = m
                added_count += 1
                account_new += 1
        print(f"    └ Sonuç: {len(mails)} e-posta incelendi, {account_new} yeni ileti eklendi.")

    if added_count > 0:
        save_emails(existing)
        print(f"✓ Başarılı: Toplam {added_count} yeni e-posta emails.json dosyasına işlendi.")
    else:
        print("✓ Yeni okunmamış e-posta yok, gelen kutusu güncel.")

    return added_count

def sync_loop():
    while True:
        cfg = load_config()
        interval = cfg.get('sync_interval_seconds', 30)
        try:
            sync_all()
        except Exception as e:
            print(f"Döngü hatası: {e}")
        time.sleep(interval)

# HTTP REST API (Panel ile Canlı İletişim)
class MailAPIHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()

        if self.path in ['/api/sync', '/api/sync/']:
            sync_all()

        emails = load_emails()
        resp = {
            "status": "online",
            "count": len(emails),
            "timestamp": time.time(),
            "emails": emails
        }
        self.wfile.write(json.dumps(resp, ensure_ascii=False).encode('utf-8'))

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(length)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

        resp = {"status": "ok"}
        try:
            payload = json.loads(post_data.decode('utf-8')) if post_data else {}
            
            if self.path in ['/api/config', '/api/save_config']:
                cfg = load_config()
                if 'info_password' in payload:
                    cfg['accounts'][0]['password'] = payload['info_password']
                if 'gmail_password' in payload:
                    cfg['accounts'][1]['password'] = payload['gmail_password']
                if 'infoPass' in payload:
                    cfg['accounts'][0]['password'] = payload['infoPass']
                if 'gmailPass' in payload:
                    cfg['accounts'][1]['password'] = payload['gmailPass']
                if 'interval' in payload:
                    cfg['sync_interval_seconds'] = int(payload['interval'])
                save_config(cfg)
                threading.Thread(target=sync_all, daemon=True).start()
                resp = {"status": "ok", "message": "Ayarlar kaydedildi ve tarama başlatıldı."}

            elif self.path in ['/api/test', '/api/test_connections']:
                cfg = load_config()
                if 'info_password' in payload:
                    cfg['accounts'][0]['password'] = payload['info_password']
                if 'gmail_password' in payload:
                    cfg['accounts'][1]['password'] = payload['gmail_password']
                results = []
                for acc in cfg.get('accounts', []):
                    results.append(test_account_connection(acc))
                resp = {"status": "ok", "results": results}
        except Exception as e:
            resp = {"status": "error", "message": str(e)}

        self.wfile.write(json.dumps(resp, ensure_ascii=False).encode('utf-8'))

    def log_message(self, format, *args):
        pass

def run_server():
    cfg = load_config()
    port = cfg.get('http_port', 8080)
    server = HTTPServer(('127.0.0.1', port), MailAPIHandler)
    print(f"✓ Panel Entegrasyon Portu Açıldı: http://127.0.0.1:{port}/api/emails")
    server.serve_forever()

if __name__ == '__main__':
    print("=" * 65)
    print("  MÜLK SPOR KULÜBÜ - CANLI E-POSTA SENKRONİZASYON SERVİSİ")
    print("=" * 65)

    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
    if not os.path.exists(EMAILS_FILE):
        save_emails([])

    cfg = load_config()
    info_pwd = cfg['accounts'][0].get('password')
    gmail_pwd = cfg['accounts'][1].get('password')

    if not info_pwd and not gmail_pwd:
        print("\n[BİLGİ] Yapılandırma dosyasında henüz şifre tanımlanmamış.")
        print("Panel (panel.html) üzerindeki 'Senkronizasyon & Şifre' butonundan")
        print("şifrelerinizi girebilir veya panel içindeki canlı webmail portalını kullanabilirsiniz.\n")

    t_sync = threading.Thread(target=sync_loop, daemon=True)
    t_sync.start()

    run_server()
