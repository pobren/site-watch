# Changes

## 1.3.1: Free sign-up without Stripe

- **Free plans work without Stripe.** Open sign-up and people can join your free plans straight away. Paid plans appear once the Stripe secrets are added.
- Clearer note on where alerts can go with Cloudflare Email Sending.

## 1.3.0: Browser alerts, a free plan and room for thousands of websites

- **Browser alerts.** Turn on alerts on the Alerts tab and they pop up on your computer or phone, even with the page closed. Works in Chrome, Edge, Firefox and Safari, and on iPhone once the site is on the Home Screen. Nothing to sign up for: each install makes its own keys.
- **Free plans.** When selling to clients, a plan can be free: no Stripe price, and people confirm their email address before their checks start. When a paid subscription ends, the client drops back to the free plan and anything over its limits is paused, not deleted.
- **Yearly prices.** A plan can have a yearly Stripe price beside the monthly one. Sign-up and the Account tab offer both.
- **Plan limits for alerts.** Each plan can cap alerts a day and choose where alerts can go: email only, email and browser, or every channel.
- **Sign-up limits.** Each address can make 3 accounts a day, and you choose the most new accounts a day for everyone together.
- **Lots of websites.** Add a Cloudflare Queue and checks run in batches, so thousands of websites can be checked every minute instead of about 40.
- **Your own home page.** Add static files and people who aren't signed in see your home page at /, with sign-in at /signin.
- **Feels like an app on phones.** Tabs along the bottom, a big status card that turns red when something is down, and pull down to refresh. Add it to your Home Screen and it opens full screen.
- **More white label.** Variables for the user agent websites see, the API guide link and the AI connector's name.

## 1.2.0: API, webhooks and AI connector

- **API.** Make keys on the Account tab, then read what you watch, add, pause and remove monitors, read alerts and post status page notices from your own scripts and tools, at /api/v1. Keys can be read only, or read and change.
- **AI connector.** Add Site Watch to Claude at /mcp and ask "is anything down?". It signs in with your Site Watch account and can only read.
- **Webhooks.** Your own webhook now says which event it is (such as monitor.down) and which monitor, and is signed the same way as Mail App's (Site-Watch-Signature). The old X-SiteWatch headers still come too.

Guide: https://paulobrien.dev/watch/api/

## 1.1.0: Optional robot check

Sign-in, set-up, forgotten password and client sign-up can now use Cloudflare Turnstile. It's off until you add your own widget's keys to the Worker (see Robot check in the README).

## 1.0.1: Releases straight from GitHub

New versions now go to npm straight from GitHub, with a signature you can check on npm. Nothing changes in the app.

## 1.0.0: First release

Websites, certificates, domain renewals, mail servers, ports and heartbeats. Alerts by email, Slack, Teams, Google Chat, Discord and webhook. Public status pages with notices. Your own brand, and an optional Sell to clients mode with your own Stripe account.
