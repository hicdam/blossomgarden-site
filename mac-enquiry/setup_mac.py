"""Run on the Mac that will host the service. Secrets stay on that Mac."""
import getpass
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import sys
import urllib.parse

if sys.platform != 'darwin':
    raise SystemExit('Run this installer on your Mac, not on a cloud computer.')
if sys.version_info < (3, 10):
    raise SystemExit('Python 3.10 or newer is required. Install a current Python with Homebrew.')
cloudflared = shutil.which('cloudflared')
if not cloudflared:
    raise SystemExit('Install Cloudflare Tunnel first: brew install cloudflared')
os.umask(0o077)
root = Path.home() / 'Library' / 'Application Support' / 'BlossomEnquiries'
root.mkdir(parents=True, exist_ok=True, mode=0o700)
config_path = root / 'config.json'
if config_path.exists():
    raise SystemExit('Already configured. Use manage.py status/start/stop; do not overwrite your credentials.')
print('Enter the public hostname you created for this tunnel, for example enquiries.blossomgarden.design.')
host = input('Tunnel hostname: ').strip().lower()
if not host or urllib.parse.urlsplit('https://' + host).hostname != host or '.' not in host:
    raise SystemExit('Enter a hostname only, without https:// or a path.')
site_key = input('Turnstile public site key: ').strip()
turnstile_secret = getpass.getpass('Turnstile secret key (hidden): ').strip()
tunnel_token = getpass.getpass('Cloudflare tunnel token (hidden): ').strip()
print('The mailbox password is saved only in the protected local configuration file.')
smtp_password = getpass.getpass('hello@blossomgarden.design SMTP/application password (hidden): ')
if not all((site_key, turnstile_secret, tunnel_token, smtp_password)):
    raise SystemExit('All four credentials are needed. Nothing has been started.')
source = Path(__file__).resolve().parent
for name in ('service.py', 'requirements.txt', 'manage.py'):
    shutil.copy2(source / name, root / name)
venv = root / 'venv'
subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True)
python = venv / 'bin' / 'python'
subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(root / 'requirements.txt')], check=True)
config = {
    'public_url': 'https://' + host,
    'origins': ['https://blossomgarden.design', 'https://www.blossomgarden.design'],
    'site_hostnames': ['blossomgarden.design', 'www.blossomgarden.design'],
    'database': str(root / 'enquiries.sqlite3'),
    'smtp_host': 'mail.privateemail.com', 'smtp_port': 465,
    'smtp_user': 'hello@blossomgarden.design', 'smtp_password': smtp_password,
    'recipient': 'hello@blossomgarden.design', 'turnstile_secret': turnstile_secret,
    'rate_secret': secrets.token_hex(32), 'daily_enquiries': 40, 'daily_email_attempts': 100
}
config_path.write_text(json.dumps(config, indent=2))
config_path.chmod(0o600)
token_path = root / 'tunnel-token'
token_path.write_text(tunnel_token)
token_path.chmod(0o600)
(root / 'public-settings.json').write_text(json.dumps({'endpoint': config['public_url'], 'site_key': site_key}, indent=2))
(root / 'logs').mkdir(exist_ok=True, mode=0o700)
agents = Path.home() / 'Library' / 'LaunchAgents'
agents.mkdir(exist_ok=True)
commands = {
    'design.blossom.enquiries': ['/usr/bin/caffeinate', '-i', str(python), str(root / 'service.py'), str(config_path)],
    'design.blossom.tunnel': [cloudflared, 'tunnel', '--no-autoupdate', 'run', '--token-file', str(token_path)],
}
for label, command in commands.items():
    plist = {'Label': label, 'ProgramArguments': command, 'RunAtLoad': True, 'KeepAlive': True,
             'WorkingDirectory': str(root), 'ThrottleInterval': 10,
             'StandardOutPath': str(root / 'logs' / (label + '.log')),
             'StandardErrorPath': str(root / 'logs' / (label + '.error.log'))}
    path = agents / (label + '.plist')
    path.write_bytes(plistlib.dumps(plist))
    path.chmod(0o600)
    subprocess.run(['launchctl', 'bootstrap', 'gui/' + str(os.getuid()), str(path)], check=True)
print('Installed. The services run while your Mac user is logged in and restart at login.')
print('Your website has NOT been changed. Next: check the tunnel, test confirmation, then activate the form.')
print('Public settings (safe to share) are in: ' + str(root / 'public-settings.json'))
print('Do not share config.json or tunnel-token. They contain secrets.')
