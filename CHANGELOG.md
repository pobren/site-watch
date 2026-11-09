# Changes

## 1.14.0: Teams

- **Team logins**: invite colleagues as an Admin (changes things, but not billing, the team or keys) or a Viewer (looks only). Each person has their own email and password, and can choose to get the alert emails too.
- **Alerts only**: add people who just get the alert emails, once they've confirmed their address.
- **Plans** set the logins included, the Stripe prices for extra logins (added to the same subscription and prorated) and how many alert-only people there may be (Admin tab).
- Stripe subscriptions with more than one item now find their plan by any item, not just the first.

## 1.13.0: Speed from each region

- **Websites and APIs can be timed from west Europe, east US and Asia Pacific** every 5 minutes, using the same helpers that confirm outages. The dashboard shows each region's average and slowest hour over the last 24 hours.
- **Plans say how many** get it: "Speed from 3 regions for" on the Admin tab's plan form (none unless set). The owner gets 25.

## 1.12.0: Badge, private pages, notices by email and monthly reports

- **Status badge and widget** for people's own websites, on every plan, with the code to copy on the Status pages tab.
- **Password protected status pages** for staff or clients only, on plans that allow them ("Status pages can have a password" on the Admin tab's plan form).
- **Post notices by email**: each page can have a private address. Email it from your own address and it's posted and sent to subscribers. Needs `UPDATE_DOMAIN` and Cloudflare Email Routing (see the README).
- **Monthly uptime report** by email on the first of each month for paid accounts, with uptime and outages for each monitor. It can be turned off on the Account tab.
- Deleting a status page or an account now removes its subscribers too.

## 1.11.0: Status page subscribers

- **Visitors can subscribe** to a status page by email, Slack, Discord, Microsoft Teams, Google Chat, webhook or Atom feed, for everything on the page or only the things they pick. Emails are confirmed by a link first and every email has a one click unsubscribe.
- **They hear about** notices when you post and resolve them (a tick box on the notice form), and things going down and coming back once our other regions agree (a setting on each page).
- **Status pages tab**: subscriber count, emails used this month, the list with Remove, and Add subscribers for pasting addresses from a spreadsheet.
- **Plans** set email subscribers, subscriber emails a month and chat rooms (Admin tab). Free plans have none. If a month's emails would run out, the oldest subscribers still get them and the rest are skipped until next month.
- **Amazon SES** sends subscriber emails when `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` and `SES_REGION` are set. Big lists are sent in batches through the CHECKS queue.
- Status pages now reload without losing what you're typing in the subscribe form.
- Plans and limits now say "monitors": each web address, API, DNS record, mail server, port or job is one.

## 1.10.0: API and DNS checks

- **API checks**: choose the method, add headers (such as an Authorization token) and a body, and check the status, words, time and a JSON value, such as `status` equals `ok` or `data.ready` equals `true`. Anything under 400 counts as working unless a status is set. Header values only show their first few characters once saved, and editing without touching them keeps them.
- **DNS checks**: A, AAAA, CNAME, MX, TXT, NS or CAA records through Cloudflare's 1.1.1.1. Down when they vanish, when the name no longer exists, or when they stop including the value you give. Every 5 minutes or slower.
- Both count as one monitor each, are confirmed from other regions like everything else, and show on status pages and the Live view.

## 1.9.0: Failures confirmed from other regions

- **Before a "down" alert goes**, helpers in two other Cloudflare regions (west Europe and east US, with Asia Pacific if one can't answer) try the same website, mail server or port.
- **The alert only goes if at least one agrees.** It says where: "our checks from west Europe found the same".
- **If they can all reach it**, no alert is sent. The dashboard notes that it's only failing from the main check, and the other regions are asked again every 10 minutes.
- The helpers are Durable Objects (the PROBES binding in wrangler.jsonc). They only run when something is failing, so they cost next to nothing. Without the binding, alerts work as before.

## 1.8.0: Checks every 30 seconds

- **Every 30 seconds** is a new choice for websites, mail servers and ports. The minute's run checks them, and a queue message held back half a minute checks them again. Without a queue (CHECKS) they're checked every minute.
- **Plans say how many** can use it: "Checked every 30 seconds" on the Admin tab's plan form (none unless set). The owner has no limit. Plan tiles show "Every 30 seconds for 10 of them".
- Moving to a plan with fewer keeps the oldest on 30 seconds and moves the rest to the plan's fastest.
- The API and apps still see `every` in whole minutes: 30 second checks show as `every: 1` with `fast: true`. Send `fast: true` (or `every: 0.5`) to turn them on.
- Alerts say the two tries were "30 seconds apart".

## 1.7.1: Status page notices and branding

- Status page notices show a Live or Resolved tag and their kind, when they started and, once over, when they were resolved and how long they lasted.
- Each status page can have its own logo (PNG, JPEG, WebP or SVG, up to 100 KB), shown beside its name.
- With Pro (or any plan that isn't free), each status page has its own logo, contact address and colour. Pages no longer show the install's support address, so visitors contact the page's owner, and the foot says "Monitored by" the install's name, linked to its home page.

## 1.7.0: Text message and WhatsApp alerts

- **Alerts by text and WhatsApp, through your own Twilio account.** On the Alerts tab, add a mobile number, choose WhatsApp or text message, and type the six digit code we send. Up to 3 phones an account. Only the urgent alerts go to phones: something going down, and coming back up.
- **One message, not five.** Alerts made in the same run go out together, one message per phone ("a.com, b.com and 2 more are down").
- **A monthly allowance on each plan** (Text and WhatsApp alerts a month, on the Admin tab's plan form), shown on the Alerts tab as "3 of 20 used this month". When it's used up, alerts carry on by email and on devices, and the client gets one email saying so.
- **Top ups.** Set up to three packs on the Admin tab with one off Stripe prices. Clients on a plan with phone alerts buy them from the Alerts tab; they last a year and are used after the month's allowance.
- **Limits so a bad day can't run up a bill:** 30 phone messages a day per account, PHONE_DAILY_MAX (250 unless set) for the whole install, 3 codes a day per account, phones only in the countries in PHONE_COUNTRIES (UK, US and Canada unless set). A number Twilio says is unsubscribed or not on WhatsApp is switched off, and a message Twilio turns away isn't charged to the allowance.
- New secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM, TWILIO_SMS_FROM_US, TWILIO_WHATSAPP_FROM, TWILIO_WA_DOWN, TWILIO_WA_UP and TWILIO_WA_CODE. See Text and WhatsApp alerts in the README.

## 1.6.2

- The status page name checker and the own domain wizard's progress check answered "Not found": they now work.

## 1.6.1: Live view links that run out, and status page names

- **Status pages can live at name.yourdomain** (set PAGE_DOMAIN, add a wildcard DNS record and a *.yourdomain/* route). /status/name keeps working.
- **Status pages on your own domain, with a set-up wizard** (Cloudflare for SaaS: set CF_ZONE_ID, CF_API_TOKEN and DOMAIN_TARGET). POST, GET and DELETE /api/pages/:id/domain add the domain, report whether the CNAME is in place and the certificate is ready, and remove it. Paid plans only for clients.
- **Names are checked as you type** (GET /api/pages/name?name=): free or taken, and rude names, names kept for the install (www, mail, admin and so on) and names that look like a bank, a big company or a sign-in page are refused.

- **Set how long a Live view link works**, from an hour to a year or until you turn it off (POST /api/live-link with expires in hours). After that the page says the link has run out.

## 1.6.0: Live view link

- **Watch somewhere else.** Make a private Live view link from an app (or POST /api/live-link) and open it on an office TV, a second screen or a tablet. It shows every check on one dark screen, worst first, with a clock, and refreshes itself every minute. No sign in needed, so it shows names and states only, never server addresses. Switch on **Show latest alerts** to add the latest alert headlines beside them (POST /api/live-link with alerts: true). Make a new link to stop the old one working, or turn it off (DELETE /api/live-link).

## 1.5.0: Apps on phones and computers

- **Sign in on an app.** Apps sign in with an email address and password, or by scanning a QR code from **Sign in on your phone** on the Account tab. The code works once, for 5 minutes. Each app gets its own key and works with the same API as the website.
- **Your apps on the Account tab.** See which apps are signed in and sign any of them out. Sign out everywhere and a new password sign them out too.
- **App alerts.** Alerts straight to iPhone, iPad and Mac through Apple, with down alerts marked Time Sensitive. Needs four secrets from the Apple Developer account that publishes the app (see App alerts in the README). Plans that allow browser alerts allow app alerts too.
- **Delete my account.** Clients can delete their own account and everything in it from the Account tab or an app. Any Stripe subscription is cancelled first.

## 1.4.0: Branded emails

- **Every email is branded.** Alerts, the confirm email and password resets go out as HTML in your name, logo and colour, with a button, and the plain text beside it. Down alerts get a red strip, back up a green one.
- Mail apps don't show SVG pictures, so use a PNG logo address (https://) for the logo to appear in emails.

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
