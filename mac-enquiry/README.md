# Blossom email confirmation on your Mac

**Prepared and tested locally. Not installed on your Mac and not connected to the live forms yet.**

This replaces FormSubmit for the website forms when activated. Your website stays on GitHub Pages. Your Mac holds pending enquiries and sends confirmation emails through your existing Private Email mailbox. Cloudflare Tunnel provides the public HTTPS connection. There is no Render service, AI usage or new paid subscription in this setup. Existing mailbox limits, electricity and internet still apply.

## 1. Cloudflare setup

First check that `blossomgarden.design` is listed as **Active** in your Cloudflare account. Having an account alone does not mean this domain is connected. If it is not active, stop here and arrange the DNS change carefully, preserving the existing website and email records. Do not change MX records or website hosting for this service.

Create a remotely managed **Cloudflared** tunnel named `blossom-enquiries-mac`. Keep the tunnel token private. The installer below runs the connector; do not also install a second connector service using the dashboard's command.

Add a published application route:

| Setting | Value |
| --- | --- |
| Public hostname | `enquiries.blossomgarden.design` |
| Service type | HTTP |
| Service URL | `127.0.0.1:8765` |
| Path | Leave empty |

Only this subdomain should point at the tunnel. Do not protect the enquiry routes with a Cloudflare Access login: customers need to use them publicly. The application enforces spam checks, limits and email confirmation itself. Do not use a temporary Quick Tunnel for the production form.

Create a **Turnstile** widget in Managed mode for `blossomgarden.design` and `www.blossomgarden.design`. Keep the secret key private; the site key is public. The service validates each challenge server-side and checks its hostname and action.

## 2. Install on the Mac

Use a Mac you can keep connected, powered and logged in. You need Homebrew, Git and Python 3.10 or later. If Homebrew is not installed, use its official installer at https://brew.sh/ first.

In Terminal:

```sh
brew install python cloudflared
git clone --branch feature/mac-email-verification --single-branch https://github.com/hicdam/blossomgarden-site.git blossom-enquiry-mac
cd blossom-enquiry-mac
python3 mac-enquiry/setup_mac.py
```

The installer prompts for the hostname, Turnstile public key, Turnstile secret, tunnel token and the `hello@blossomgarden.design` mailbox SMTP/application password. Type secrets into the hidden prompts on your Mac, **not into chat**. It uses authenticated TLS SMTP at `mail.privateemail.com:465`. Check the mailbox plan's sending allowance before launch.

Files are installed under `~/Library/Application Support/BlossomEnquiries/`, outside the website repository. Configuration and token files are readable only by your Mac user. They are not encrypted by the application; protect the Mac account and disk. The website never receives those secrets.

The installer creates two LaunchAgents. They run after login and restart if they exit. The service prevents idle sleep while running, but does not keep a closed laptop running. Logging out, shutdown, loss of internet and some updates interrupt it. This is **not** an unattended boot-before-login setup.

Check status:

```sh
python3 mac-enquiry/manage.py status
```

Then check the tunnel is Healthy in Cloudflare and open `https://enquiries.blossomgarden.design/health`. A health response confirms the connection, not email delivery.

## 3. Test before switching the public forms

The public settings file contains only the endpoint and site key:
`~/Library/Application Support/BlossomEnquiries/public-settings.json`.
These two settings are safe to share with the site maintainer. Never share `config.json` or `tunnel-token`.

Prepare the site integration in a separate checkout using:

```sh
python3 mac-enquiry/activate_forms.py --endpoint https://enquiries.blossomgarden.design --site-key YOUR_PUBLIC_SITE_KEY
```

This generates changes locally; it does not publish. For the first live test, publish a temporary, unlinked copy of the prepared contact form named `verification-test.html` with `noindex`, together with `assets/js/verified-enquiry.js`, on the existing website. Keep the public contact and QR forms unchanged during this test. Include the new processing notice on the test page.

Use an email address you control. Confirm that:

1. The confirmation email arrives and **no enquiry notification arrives before confirmation**.
2. Opening the link displays a confirmation button without forwarding anything.
3. Pressing the button delivers the enquiry to Blossom with the verified address as Reply-To.
4. A repeated click does not create another notification.
5. Stopping the Mac service shows a helpful error and preserves entered form details.
6. Restarting the service restores operation and queued messages survive.

Do not send tests to invented addresses: they could belong to someone else.

Only after this succeeds, publish the prepared `contact.html`, `welcome.html`, `privacy.html` and `assets/js/verified-enquiry.js`, and remove the temporary test page. The QR form now requires email and a short message because phone-only enquiries cannot be email-verified. Existing direct email contact remains available, but messages sent directly are not verified by this service.

The activation tool removes FormSubmit routing and hidden provider settings. There is no automatic fallback to unverified form delivery when the Mac is offline. JavaScript is required; without it the submit button stays disabled and direct email is offered.

## Operation and limits

- Confirmation expires after 24 hours. Expired pending records and their emails are deleted by the worker, normally within five seconds while it is running; after downtime, at the next cleanup.
- Confirmed notifications retry for up to seven days. Investigate a persistent retry queue before that period expires. Check status regularly; external uptime monitoring is not included.
- After SMTP accepts a notification, its local customer payload is removed. A minimal replay-prevention record remains until expiry. Your normal inbox retention still applies; backups can retain older copies.
- Default limits: 10 validly formed requests per IP/hour, 3 confirmation requests per email/24 hours, 40 accepted enquiries per 24 hours, and 100 SMTP attempts in a rolling day. These can be adjusted locally after checking mailbox limits. Requests above the limit show an error; they are not silently accepted.
- Confirmation emails contain fixed wording, not user-supplied message content. Verified notifications go only to the configured Blossom inbox.
- IP and email rate-limit identifiers are hashed with a local secret. HTTP access logs containing confirmation tokens are not enabled. Avoid Cloudflare request logging that would unnecessarily retain token URLs.
- The SQLite queue survives restarts. SMTP cannot guarantee exactly-once delivery after an ambiguous network failure; retry emails reuse a stable Message-ID and enquiry reference. Normal duplicate confirmation clicks queue once.
- Email confirmation proves access to that mailbox, not the person's identity or the quality of their enquiry. It does not guarantee a genuine sales lead.
- Review dependency and cloudflared updates periodically. The service does not update software automatically.

Stop or restart:

```sh
python3 mac-enquiry/manage.py stop
python3 mac-enquiry/manage.py start
```

Keep the Mac awake and logged in. Display sleep is fine. Closing a laptop lid is not.

## Tests and current verification boundary

```sh
python3 -m venv /tmp/blossom-enquiry-tests
/tmp/blossom-enquiry-tests/bin/pip install -r mac-enquiry/requirements.txt
/tmp/blossom-enquiry-tests/bin/python -m unittest discover -s mac-enquiry/tests -v
```

Backend tests use a fake email sender and fake challenge results. No customer emails were sent. The actual macOS LaunchAgents, Cloudflare account, mailbox credentials and delivery still require the installation and end-to-end test above.

## Primary documentation

- Cloudflare tunnel setup: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
- Tunnel token-file parameter (cloudflared 2025.4.0+): https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/
- Turnstile server validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Private Email SMTP settings: https://www.namecheap.com/support/knowledgebase/article.aspx/1179/2175/general-private-email-configuration-for-mail-clients-and-mobile-devices/
