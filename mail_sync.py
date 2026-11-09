#!/usr/bin/env python3
"""
MÜLK Spor Kulübü - Arka Plan Canlı E-Posta Senkronizasyon Servisi
---------------------------------------------------------------
Bu servis, info@mulksporkulubu.com ve mulksporkulubu@gmail.com hesaplarınızı
arka planda kesintisiz olarak dinler, gelen yeni e-postaları yakalar ve
yönetim paneline (panel.html) anında canlı veri olarak aktarır.

Kullanım:
    python3 mail_sync.py
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
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return DEFAULT_CONFIG

def save_config(cfg):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

def load_emails():
    if os.path.exists(EMAILS_FILE):
        try:
            with open(EMAILS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
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

def fetch_account_emails(account):
    new_mails = []
    acc_email = account.get('email')
    host = account.get('host')
    port = account.get('port', 993)
    password = account.get('password')

    if not password:
        # Şifre girilmemişse sessizce geç
        return []

    try:
        mail = imaplib.IMAP4_SSL(host, port, timeout=10)
        mail.login(acc_email, password)
        mail.select('INBOX', readonly=True)

        # Son gelen 20 iletiyi al
        status, messages = mail.search(None, 'ALL')
        if status != 'OK' or not messages[0]:
            mail.close()
            mail.logout()
            return []

        msg_ids = messages[0].split()
        recent_ids = msg_ids[-20:] # Son 20 ileti

        for msg_id in reversed(recent_ids):
            res, data = mail.fetch(msg_id, '(RFC822)')
            if res != 'OK':
                continue

            raw_email = data[0][1]
            msg = email.message_from_bytes(raw_email)

            subject = decode_mime_words(msg.get('Subject', '(Konu Yok)'))
            from_raw = decode_mime_words(msg.get('From', ''))
            to_raw = decode_mime_words(msg.get('To', acc_email))
            date_raw = msg.get('Date', '')

            # Kimden çözümle
            from_name = from_raw
            from_email = from_raw
            if '<' in from_raw and '>' in from_raw:
                parts = from_raw.split('<')
                from_name = parts[0].strip().replace('"', '')
                from_email = parts[1].replace('>', '').strip()

            # Gövde çözümle
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
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    body = payload.decode(msg.get_content_charset() or 'utf-8', errors='replace')

            mail_id = f"LIVE-{acc_email}-{msg_id.decode('ascii')}"

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

        mail.close()
        mail.logout()
    except Exception as e:
        print(f"[{acc_email}] Senkronizasyon hatası: {e}")

    return new_mails

def sync_all():
    cfg = load_config()
    existing = load_emails()
    existing_map = {m['id']: m for m in existing}
    added_count = 0

    for acc in cfg.get('accounts', []):
        if not acc.get('enabled'):
            continue
        mails = fetch_account_emails(acc)
        for m in mails:
            if m['id'] not in existing_map:
                existing.insert(0, m)
                existing_map[m['id']] = m
                added_count += 1
                print(f"[YENİ E-POSTA] {m['account']} -> Kimden: {m['fromName']} | Konu: {m['subject']}")

    if added_count > 0:
        save_emails(existing)
        print(f"Toplam {added_count} yeni e-posta kaydedildi.")

def sync_loop():
    cfg = load_config()
    interval = cfg.get('sync_interval_seconds', 30)
    print(f"Arka plan senkronizasyon döngüsü başlatıldı (Aralık: {interval} saniye).")
    while True:
        try:
            sync_all()
        except Exception as e:
            print(f"Döngü hatası: {e}")
        time.sleep(interval)

# HTTP REST API (Panel ile Canlı İletişim İçin)
class MailAPIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # CORS
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()

        if self.path == '/api/sync' or self.path.startswith('/api/sync'):
            sync_all()

        emails = load_emails()
        resp = {
            "status": "online",
            "count": len(emails),
            "timestamp": time.time(),
            "emails": emails
        }
        self.wfile.write(json.dumps(resp, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        # Logları sessiz tut
        pass

def run_server():
    cfg = load_config()
    port = cfg.get('http_port', 8080)
    server = HTTPServer(('127.0.0.1', port), MailAPIHandler)
    print(f"Canlı E-Posta REST API sunucusu çalışıyor: http://127.0.0.1:{port}/api/emails")
    server.serve_forever()

if __name__ == '__main__':
    # İlk config oluştur
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
    if not os.path.exists(EMAILS_FILE):
        save_emails([])

    # Arka plan senkronizasyon thread'i
    t = threading.Thread(target=sync_loop, daemon=True)
    t.start()

    # REST API
    run_server()

