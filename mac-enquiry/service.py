"""Local enquiry verification. Never forwards an enquiry before confirmation."""
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from email.message import EmailMessage
from pathlib import Path

from flask import Flask, jsonify, make_response, render_template_string, request

PAGE = '''<!doctype html><html lang="en-GB"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ title }} | Blossom</title>
<style>body{margin:0;background:#fcfaef;color:#2c3947;font:18px/1.6 system-ui,sans-serif}main{max-width:620px;margin:10vh auto;padding:28px}h1{font-family:Georgia,serif;line-height:1.2}button{font:inherit;padding:12px 22px;border:1px solid #a6ad99;border-radius:6px;background:#f3ebce;cursor:pointer}a{color:#253c31}</style>
<main><p>Blossom</p><h1>{{ title }}</h1><p>{{ message }}</p>
{% if token %}<form method="post" action="/confirm"><input type="hidden" name="token" value="{{ token }}"><button>Confirm my enquiry</button></form>{% endif %}
<p><a href="https://blossomgarden.design/">Back to Blossom</a></p></main></html>'''
EMAIL_RE = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+\Z")
LIMITS = dict(name=100, email=254, location=120, message=4000, phone=100,
              help_with=200, timing=100, budget=100, material_preferences=4000,
              utm_source=200, utm_medium=200, utm_campaign=200, utm_content=200,
              landing_page=1000, referrer=1000)


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('Please check your enquiry details.')
    result = {}
    for name, limit in LIMITS.items():
        value = data.get(name, '')
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError('One of the fields is too long or has an invalid value.')
        if any(ord(c) < 32 and c not in '\n\t\r' for c in value):
            raise ValueError('Please use ordinary text in your enquiry.')
        result[name] = value.strip()
    if not result['name'] or not any(c.isalpha() for c in result['name']):
        raise ValueError('Please enter your name.')
    email = result['email']
    if not EMAIL_RE.fullmatch(email) or len(email.split('@')[0]) > 64:
        raise ValueError('Please enter a complete email address.')
    result['email'] = email.split('@')[0] + '@' + email.split('@')[1].lower()
    for field in ('location', 'message'):
        value = result[field]
        compact = re.sub(r'\s', '', value)
        if not any(c.isalnum() for c in value) or re.fullmatch(r'(.{1,3})\1{2,}', compact, re.I):
            raise ValueError('Please enter your town or postcode and briefly describe the work you need.')
    if len(result['message']) < 8 or not any(c.isalpha() for c in result['message']):
        raise ValueError('Please briefly describe the work you need, for example “Need hedge cut”.')
    if data.get('consent') != 'on':
        raise ValueError('Please confirm we can use your details to respond.')
    result['consent'] = 'Agreed'
    return result


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.db() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS enquiries (
                id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, payload TEXT NOT NULL,
                state TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (
                id TEXT PRIMARY KEY, enquiry TEXT NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
                kind TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL,
                due REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                UNIQUE(enquiry,kind));
            CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS sends (at REAL NOT NULL);
            ''')
        os.chmod(path, 0o600)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA secure_delete=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def clean(self, db, now):
        db.execute('DELETE FROM enquiries WHERE expires <= ?', (now,))
        db.execute('DELETE FROM limits WHERE expires <= ?', (now,))
        db.execute('DELETE FROM sends WHERE at <= ?', (now - 86400,))

    def allowance(self, db, key, maximum, seconds, now):
        row = db.execute('SELECT * FROM limits WHERE key=?', (key,)).fetchone()
        if row and row['expires'] > now and row['count'] >= maximum:
            return False
        db.execute('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END',
                   (key, now + seconds, now, now))
        return True


def check_turnstile(token, ip, cfg):
    encoded = urllib.parse.urlencode({'secret': cfg['turnstile_secret'], 'response': token, 'remoteip': ip}).encode()
    req = urllib.request.Request('https://challenges.cloudflare.com/turnstile/v0/siteverify', data=encoded)
    with urllib.request.urlopen(req, timeout=10) as response:
        result = json.load(response)
    return result.get('success') is True and result.get('hostname') in cfg['site_hostnames'] and result.get('action') == 'enquiry'


def send_smtp(recipient, subject, body, message_id, reply_to, cfg):
    message = EmailMessage()
    message['From'] = cfg['smtp_user']
    message['To'] = recipient
    message['Subject'] = subject
    message['Message-ID'] = '<' + message_id + '@blossomgarden.design>'
    if reply_to:
        message['Reply-To'] = reply_to
    message.set_content(body)
    with smtplib.SMTP_SSL(cfg['smtp_host'], cfg['smtp_port'], context=ssl.create_default_context(), timeout=20) as smtp:
        smtp.login(cfg['smtp_user'], cfg['smtp_password'])
        smtp.send_message(message)


def create_app(cfg, verifier=check_turnstile, sender=send_smtp):
    app = Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=20000)
    store = Store(cfg['database'])
    app.store = store
    app.cfg = cfg
    app.sender = sender
    public = cfg['public_url'].rstrip('/')
    origins = cfg['origins']

    def fingerprint(value):
        return hmac.new(cfg['rate_secret'].encode(), value.encode(), hashlib.sha256).hexdigest()

    def page(title, message, token=None, status=200):
        return make_response(render_template_string(PAGE, title=title, message=message, token=token), status)

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
        if request.path == '/enquiries' and request.headers.get('Origin') in origins:
            response.headers['Access-Control-Allow-Origin'] = request.headers['Origin']
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        return response

    @app.get('/health')
    def health():
        return jsonify(status='ok')

    @app.route('/enquiries', methods=['POST', 'OPTIONS'])
    def enquiry():
        if request.headers.get('Origin') not in origins:
            return jsonify(error='Please use the enquiry form on the Blossom website.'), 403
        if request.method == 'OPTIONS':
            return '', 204
        if not request.is_json:
            return jsonify(error='Please use the enquiry form on the Blossom website.'), 415
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error='Please check your enquiry details.'), 400
        if data.get('_honey'):
            return jsonify(error='Unable to accept this enquiry.'), 400
        try:
            payload = validate(data)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        ip = request.headers.get('CF-Connecting-IP', '')
        # This header is trusted ONLY because the server binds to localhost behind cloudflared.
        if not ip:
            return jsonify(error='Please use the secure enquiry address.'), 403
        now = time.time()
        with store.db() as db:
            db.execute('BEGIN IMMEDIATE')
            store.clean(db, now)
            if not store.allowance(db, 'ip:' + fingerprint(ip), 10, 3600, now):
                return jsonify(error='Too many attempts. Please try again in an hour.'), 429
        token = data.get('cf-turnstile-response', '')
        if not isinstance(token, str) or not 1 <= len(token) <= 2048:
            return jsonify(error='Please complete the spam-protection check.'), 400
        try:
            passed = verifier(token, ip, cfg)
        except Exception:
            return jsonify(error='The spam-protection check is unavailable. Please try again shortly.'), 503
        if not passed:
            return jsonify(error='Please repeat the spam-protection check.'), 400
        with store.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not store.allowance(db, 'email:' + fingerprint(payload['email'].lower()), 3, 86400, now):
                return jsonify(error='Please check your inbox for an earlier confirmation. Try again tomorrow if needed.'), 429
            if not store.allowance(db, 'global', cfg.get('daily_enquiries', 40), 86400, now):
                return jsonify(error='The form has reached its daily limit. Please email hello@blossomgarden.design.'), 429
            secret = secrets.token_urlsafe(32)
            eid = secrets.token_hex(16)
            digest = hashlib.sha256(secret.encode()).hexdigest()
            db.execute('INSERT INTO enquiries VALUES(?,?,?,?,?,?)', (eid, digest, json.dumps(payload), 'pending', now, now + 86400))
            # Fixed content: never relay arbitrary submitted text to an unverified address.
            body = ('Please confirm your Blossom enquiry by opening the link below and selecting “Confirm my enquiry”.\n\n'
                    + public + '/confirm?token=' + secret
                    + '\n\nThe link expires in 24 hours. We will only forward your enquiry to Blossom after you confirm. '
                    'If you did not make this enquiry, ignore this email.\n\nBlossom Garden Design')
            db.execute('INSERT INTO outbox(id,enquiry,kind,recipient,body,due) VALUES(?,?,?,?,?,?)',
                       (secrets.token_hex(16), eid, 'verify', payload['email'], body, now))
        return jsonify(message='Please check your email and confirm your enquiry within 24 hours. Check your spam folder too. Your enquiry has not yet been forwarded to Blossom.'), 202

    @app.route('/confirm', methods=['GET', 'POST'])
    def confirm():
        token = request.args.get('token', '') if request.method == 'GET' else request.form.get('token', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            return page('Link not recognised', 'Please use the full link from your confirmation email.', status=400)
        if request.method == 'POST' and request.headers.get('Origin') != public:
            return page('Please reopen your email link', 'Confirm your enquiry from the secure Blossom confirmation page.', status=403)
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = time.time()
        with store.db() as db:
            db.execute('BEGIN IMMEDIATE')
            store.clean(db, now)
            row = db.execute('SELECT * FROM enquiries WHERE digest=?', (digest,)).fetchone()
            if not row:
                return page('This link has expired', 'Please return to the website and submit your enquiry again.', status=410)
            if row['state'] != 'pending':
                return page('Your email is confirmed', 'Thank you. Your enquiry is already confirmed; there is no need to send it again.')
            if request.method == 'GET':
                return page('Confirm your enquiry', 'One last step: confirm this is your email address so we can pass your enquiry to Blossom.', token)
            payload = json.loads(row['payload'])
            body = 'Email ownership confirmed. Enquiry reference: ' + row['id'] + '\n\n'
            body += '\n\n'.join(k.replace('_', ' ').title() + ':\n' + v for k, v in payload.items() if v)
            db.execute('UPDATE enquiries SET state=?,expires=? WHERE id=?', ('confirmed', now + 7 * 86400, row['id']))
            db.execute('DELETE FROM outbox WHERE enquiry=? AND kind=?', (row['id'], 'verify'))
            db.execute('INSERT INTO outbox(id,enquiry,kind,recipient,body,due) VALUES(?,?,?,?,?,?)',
                       (secrets.token_hex(16), row['id'], 'notify', cfg['recipient'], body, now))
        return page('Thank you, your email is confirmed', 'Your enquiry is queued for delivery to Blossom. We look forward to hearing more about what you have in mind.')

    @app.errorhandler(413)
    def too_large(error):
        return jsonify(error='Your enquiry is too long. Please shorten it and try again.'), 413

    return app


def deliver_one(app):
    """One worker per installation; durable lease also prevents concurrent sends."""
    now = time.time()
    store, cfg = app.store, app.cfg
    with store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        store.clean(db, now)
        if db.execute('SELECT COUNT(*) FROM sends').fetchone()[0] >= cfg.get('daily_email_attempts', 100):
            return False
        row = db.execute('SELECT o.*,e.state,e.payload FROM outbox o JOIN enquiries e ON o.enquiry=e.id WHERE o.due<=? ORDER BY CASE o.kind WHEN \'notify\' THEN 0 ELSE 1 END,o.due LIMIT 1', (now,)).fetchone()
        if not row:
            return False
        if row['kind'] == 'notify' and row['state'] != 'confirmed':
            raise RuntimeError('Refusing to forward an unconfirmed enquiry')
        db.execute('UPDATE outbox SET due=?,attempts=attempts+1 WHERE id=?', (now + 300, row['id']))
        db.execute('INSERT INTO sends VALUES(?)', (now,))
    try:
        reply_to = json.loads(row['payload'])['email'] if row['kind'] == 'notify' else None
        subject = 'New verified Blossom enquiry' if row['kind'] == 'notify' else 'Please confirm your Blossom enquiry'
        app.sender(row['recipient'], subject, row['body'], row['id'], reply_to, cfg)
    except Exception:
        # Never log exception text: SMTP errors can contain addresses or credentials.
        logging.warning('Email delivery failed; queued for retry. Check local service status.')
        with store.db() as db:
            db.execute('UPDATE outbox SET due=? WHERE id=?', (now + min(3600, 60 * 2 ** min(row['attempts'], 6)), row['id']))
        return False
    with store.db() as db:
        db.execute('DELETE FROM outbox WHERE id=?', (row['id'],))
        if row['kind'] == 'notify':
            # Retain a small replay-prevention record, not the customer's details.
            db.execute("UPDATE enquiries SET state='delivered',payload='{}' WHERE id=?", (row['enquiry'],))
    return True


def run(config_path):
    from waitress import serve
    os.umask(0o077)
    with open(config_path) as source:
        cfg = json.load(source)
    for key in ('turnstile_secret', 'smtp_password', 'rate_secret'):
        if not cfg.get(key):
            raise SystemExit('Missing configuration: ' + key)
    if not cfg['public_url'].startswith('https://') or urllib.parse.urlsplit(cfg['public_url']).path not in ('', '/'):
        raise SystemExit('public_url must be an HTTPS origin with no path.')
    app = create_app(cfg)
    def work():
        while True:
            try:
                deliver_one(app)
            except Exception:
                logging.error('Queue processing failed; check local service status.')
            time.sleep(5)
    threading.Thread(target=work, daemon=True).start()
    # Only the local tunnel can reach this listener. No router port forwarding.
    serve(app, host='127.0.0.1', port=8765, threads=4, max_request_body_size=20000,
          clear_untrusted_proxy_headers=True, expose_tracebacks=False)


if __name__ == '__main__':
    import sys
    run(sys.argv[1])
