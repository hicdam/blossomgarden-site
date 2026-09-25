import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from service import create_app, deliver_one, check_turnstile


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.messages = []
        self.cfg = dict(database=str(Path(self.temp.name) / 'db.sqlite3'),
                        public_url='https://enquiries.example.com', origins=['https://blossomgarden.design'],
                        site_hostnames=['blossomgarden.design'], rate_secret='test-only',
                        recipient='owner@example.com', turnstile_secret='test-only')
        self.app = create_app(self.cfg, verifier=lambda *args: True,
                              sender=lambda *args: self.messages.append(args))
        self.client = self.app.test_client()
        self.headers = {'Origin': 'https://blossomgarden.design', 'CF-Connecting-IP': '192.0.2.1'}
        self.data = dict(name='Damo', email='visitor@example.com', location='Bordon',
                         message='Need my hedge cut', consent='on', **{'cf-turnstile-response': 'test'})

    def tearDown(self):
        self.temp.cleanup()

    def submit(self, **changes):
        return self.client.post('/enquiries', json={**self.data, **changes}, headers=self.headers)

    def link(self):
        self.assertEqual(self.submit().status_code, 202)
        deliver_one(self.app)
        return re.search(r'/confirm\?token=([A-Za-z0-9_-]+)', self.messages[-1][2]).group(1)

    def confirm(self, token):
        return self.client.post('/confirm', data={'token': token}, headers={'Origin': self.cfg['public_url']})

    def test_pending_never_forwarded_and_email_has_no_user_content(self):
        self.assertEqual(self.submit().status_code, 202)
        deliver_one(self.app)
        self.assertEqual(len(self.messages), 1)
        self.assertEqual(self.messages[0][0], self.data['email'])
        self.assertNotIn(self.data['message'], self.messages[0][2])
        self.assertNotIn(self.cfg['recipient'], [m[0] for m in self.messages])

    def test_get_does_not_confirm_and_post_forwards_once(self):
        token = self.link()
        self.assertEqual(self.client.get('/confirm?token=' + token).status_code, 200)
        deliver_one(self.app)
        self.assertEqual(len(self.messages), 1)
        self.assertEqual(self.confirm(token).status_code, 200)
        self.confirm(token)
        deliver_one(self.app)
        deliver_one(self.app)
        self.assertEqual(len(self.messages), 2)
        self.assertEqual(self.messages[1][0], self.cfg['recipient'])
        self.assertEqual(self.messages[1][4], self.data['email'])
        with self.app.store.db() as db:
            row = db.execute('SELECT * FROM enquiries').fetchone()
            self.assertEqual(row['payload'], '{}')
            self.assertEqual(row['digest'], hashlib.sha256(token.encode()).hexdigest())

    def test_expired_pending_is_deleted_and_not_forwarded(self):
        token = self.link()
        with self.app.store.db() as db:
            db.execute('UPDATE enquiries SET expires=?', (time.time() - 1,))
        self.assertEqual(self.confirm(token).status_code, 410)
        with self.app.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM enquiries').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0], 0)

    def test_wrong_origin_and_missing_tunnel_header(self):
        self.assertEqual(self.client.post('/enquiries', json=self.data).status_code, 403)
        self.assertEqual(self.client.post('/enquiries', json=self.data, headers={'Origin': self.headers['Origin']}).status_code, 403)
        token = self.link()
        self.assertEqual(self.client.post('/confirm', data={'token': token}, headers={'Origin': 'https://evil.example'}).status_code, 403)

    def test_turnstile_fails_closed(self):
        app = create_app(self.cfg, verifier=lambda *args: False)
        self.assertEqual(app.test_client().post('/enquiries', json=self.data, headers=self.headers).status_code, 400)
        def outage(*args):
            raise OSError('unavailable')
        app = create_app(self.cfg, verifier=outage)
        self.assertEqual(app.test_client().post('/enquiries', json=self.data, headers=self.headers).status_code, 503)

    def test_validation_honeypot_and_bad_json(self):
        for change in ({'email': 'not-an-email'}, {'consent': ''}, {'message': 'dadada'},
                       {'location': 'dadada'}, {'_honey': 'robot'}, {'message': 'x' * 4001},
                       {'email': 'a@example.com\nBcc: bad@example.com'}):
            self.assertEqual(self.submit(**change).status_code, 400, change)
        self.assertEqual(self.client.post('/enquiries', json=[], headers=self.headers).status_code, 400)
        self.assertEqual(self.client.post('/enquiries', json={'message': 'x' * 25000}, headers=self.headers).status_code, 413)

    def test_unverified_plausible_email_can_only_be_pending(self):
        self.assertEqual(self.submit(email='madeup@example.com').status_code, 202)
        deliver_one(self.app)
        self.assertEqual([m[0] for m in self.messages], ['madeup@example.com'])

    def test_three_email_limit_and_persistent_quota(self):
        for _ in range(3):
            self.assertEqual(self.submit().status_code, 202)
        app = create_app(self.cfg, verifier=lambda *args: True)
        self.assertEqual(app.test_client().post('/enquiries', json=self.data, headers=self.headers).status_code, 429)

    def test_global_quota(self):
        self.app.cfg['daily_enquiries'] = 1
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(self.submit(email='other@example.com').status_code, 429)

    def test_smtp_failure_keeps_queue_and_retries(self):
        self.submit()
        def fail(*args):
            raise OSError('simulated failure')
        self.app.sender = fail
        self.assertFalse(deliver_one(self.app))
        with self.app.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0], 1)
            db.execute('UPDATE outbox SET due=0')
        self.app.sender = lambda *args: self.messages.append(args)
        self.assertTrue(deliver_one(self.app))

    def test_daily_send_cap(self):
        self.submit()
        self.app.cfg['daily_email_attempts'] = 0
        self.assertFalse(deliver_one(self.app))
        self.assertEqual(len(self.messages), 0)

    def test_concurrent_confirmation_queues_once(self):
        token = self.link()
        def confirm(_):
            with self.app.test_client() as client:
                return client.post('/confirm', data={'token': token}, headers={'Origin': self.cfg['public_url']}).status_code
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(confirm, range(4))), [200] * 4)
        with self.app.store.db() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM outbox WHERE kind='notify'").fetchone()[0], 1)

    def test_restart_does_not_lose_pending_enquiry(self):
        token = self.link()
        app = create_app(self.cfg, sender=lambda *args: self.messages.append(args))
        response = app.test_client().post('/confirm', data={'token': token}, headers={'Origin': self.cfg['public_url']})
        self.assertEqual(response.status_code, 200)
        deliver_one(app)
        self.assertEqual(self.messages[-1][0], self.cfg['recipient'])

    def test_security_headers_and_preflight(self):
        response = self.client.options('/enquiries', headers=self.headers)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], self.headers['Origin'])
        page = self.client.get('/confirm?token=' + 'a' * 43)
        self.assertEqual(page.headers['Cache-Control'], 'no-store')
        self.assertEqual(page.headers['Referrer-Policy'], 'no-referrer')
        self.assertIn("frame-ancestors 'none'", page.headers['Content-Security-Policy'])

    def test_turnstile_checks_hostname_and_action(self):
        import io
        for hostname, action, expected in [('evil.example', 'enquiry', False), ('blossomgarden.design', 'login', False), ('blossomgarden.design', 'enquiry', True)]:
            result = io.BytesIO(json.dumps(dict(success=True, hostname=hostname, action=action)).encode())
            with patch('urllib.request.urlopen', return_value=result):
                self.assertEqual(check_turnstile('token', '192.0.2.1', self.cfg), expected)


if __name__ == '__main__':
    unittest.main()
