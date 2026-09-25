"""Prepare website changes AFTER the service has been tested. Does not publish."""
import argparse
import html
from pathlib import Path
import re
import shutil
import urllib.parse

parser = argparse.ArgumentParser()
parser.add_argument('--endpoint', required=True)
parser.add_argument('--site-key', required=True)
parser.add_argument('--site-root', type=Path, default=Path(__file__).resolve().parent.parent)
args = parser.parse_args()
endpoint = args.endpoint.rstrip('/')
url = urllib.parse.urlsplit(endpoint)
if url.scheme != 'https' or not url.hostname or url.path or url.query or url.fragment or url.username:
    raise SystemExit('Endpoint must be an HTTPS origin without path, query or credentials.')
if not re.fullmatch(r'[A-Za-z0-9_-]{10,100}', args.site_key):
    raise SystemExit('Invalid Turnstile public site key.')
for filename in ('contact.html', 'welcome.html'):
    path = args.site_root / filename
    source = path.read_text()
    if 'data-verification-endpoint' in source:
        raise SystemExit(filename + ' already activated; review it manually.')
    replacement = ('data-enquiry data-verification-endpoint="' + html.escape(endpoint, quote=True) + '" data-turnstile-sitekey="' + args.site_key + '"')
    source, count = re.subn(r'data-enquiry', replacement, source, count=1)
    if count != 1:
        raise SystemExit('Expected enquiry form not found in ' + filename)
    # With JS blocked, submission stays disabled instead of bypassing verification.
    source = source.replace('action="https://formsubmit.co/hello@blossomgarden.design"', 'action="' + endpoint + '/enquiries"')
    source = re.sub(r'\s*<input type="hidden" name="_(?:subject|next|template)"[^>]*>', '', source)
    source = source.replace('<button class="btn btn-primary" type="submit"', '<button disabled class="btn btn-primary" type="submit"')
    source = source.replace('A spam-protection check may appear before your enquiry is sent.', 'We’ll email you a link to confirm your address. Your enquiry reaches Blossom after you confirm.')
    source = source.replace('</form>', '<div data-turnstile></div><noscript><p>Please enable JavaScript to use this form, or email hello@blossomgarden.design.</p></noscript></form>', 1)
    source = source.replace('  <script src="assets/js/enquiry-validation.js?v=1"></script>', '')
    scripts = '''<script src="assets/js/verified-enquiry.js?v=1"></script>
<script>function blossomTurnstileReady(){window.dispatchEvent(new Event('blossom-turnstile-ready'));}</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=blossomTurnstileReady&amp;render=explicit" async defer></script>'''
    source = source.replace('</body>', scripts + '\n</body>')
    if filename == 'welcome.html':
        source = source.replace('<label for="contact">Phone or email</label>', '<label for="email">Email</label>')
        source = source.replace('type="text" id="contact" name="contact"', 'type="email" id="email" name="email"')
        marker = '<div class="span-2 consent-row">'
        source = source.replace(marker, '<div class="span-2"><label for="message">What would you like done?</label><textarea id="message" name="message" required minlength="8" maxlength="4000" placeholder="For example: Need my hedge cut"></textarea></div>\n' + marker, 1)
    path.write_text(source)
shutil.copy2(Path(__file__).with_name('verified-enquiry.js'), args.site_root / 'assets/js/verified-enquiry.js')
print('Prepared contact.html, welcome.html and assets/js/verified-enquiry.js. Nothing published.')
print('Update the privacy notice using README.md before publishing these changes.')
privacy = args.site_root / 'privacy.html'
source = privacy.read_text()
notice = '''<h2>Enquiry delivery and email confirmation</h2><p>We temporarily hold form enquiries on a Blossom-managed computer and email you a confirmation link. We forward your enquiry to our inbox only after you confirm your email address. Unconfirmed enquiries expire after 24 hours and are removed when the service next processes its queue. Confirmed enquiries awaiting delivery are retained locally for up to seven days; their local content is removed once our email provider accepts delivery.</p><p>Cloudflare provides the secure connection and Turnstile spam protection. Our email provider, Namecheap Private Email, processes confirmation emails and delivered enquiries. We temporarily store hashed identifiers to limit repeated requests. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a> and <a href="https://www.namecheap.com/legal/general/privacy-policy/">Namecheap’s privacy policy</a>.</p>'''
source, count = re.subn(r'<h2>Enquiry delivery and spam protection</h2><p>FormSubmit.*?</p>', notice, source, count=1)
if count != 1:
    raise SystemExit('Review privacy.html manually: expected old processing notice was not found. Do not publish yet.')
privacy.write_text(source)
print('Updated privacy.html processing notice as well. Review all four files before publishing.')
