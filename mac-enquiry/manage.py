"""Local management. Status reports counts only, never customer details or secrets."""
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import urllib.request

root = Path.home() / 'Library' / 'Application Support' / 'BlossomEnquiries'
labels = ('design.blossom.enquiries', 'design.blossom.tunnel')
action = sys.argv[1] if len(sys.argv) > 1 else 'status'
if action == 'status':
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3) as response:
            print('Local service: ' + str(response.status))
    except Exception:
        print('Local service: not responding')
    database = root / 'enquiries.sqlite3'
    if database.exists():
        with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db:
            for state, count in db.execute('SELECT state,COUNT(*) FROM enquiries GROUP BY state'):
                print(state + ': ' + str(count))
            queued, retrying = db.execute('SELECT COUNT(*),COALESCE(SUM(attempts>0),0) FROM outbox').fetchone()
            print('Queued emails: ' + str(queued) + '; attempted/retrying: ' + str(retrying))
    print('Check Cloudflare dashboard for tunnel health. Local health does not prove email delivery.')
elif action in ('start', 'stop'):
    for label in labels:
        path = Path.home() / 'Library' / 'LaunchAgents' / (label + '.plist')
        args = ['launchctl', 'bootstrap', 'gui/' + str(os.getuid()), str(path)] if action == 'start' else ['launchctl', 'bootout', 'gui/' + str(os.getuid()) + '/' + label]
        subprocess.run(args, check=False)
else:
    raise SystemExit('Usage: python3 manage.py [status|start|stop]')
