<div align="center">
  <h1>Site Watch</h1>
  <p><strong>Watch your websites, mail servers and scheduled jobs from your own Cloudflare account.</strong><br>
  Alerts by email, Slack, Teams, Google Chat, Discord or webhook, plus public status pages.</p>
  <p><a href="https://paulobrien.dev/watch/">Website</a> · <a href="#install">Install</a> · <a href="https://github.com/pobren/site-watch/releases">Releases</a> · <a href="https://github.com/pobren/site-watch/issues">Report a bug</a></p>
</div>

Site Watch runs in your own Cloudflare account, on Cloudflare's free plan. Your list of websites, their history and your alerts stay there, and nothing depends on anyone else to keep running.

**Free for personal and small business use, source available.** See [Licence](#licence) below.

<img src="docs/overview.png" alt="The Site Watch overview, with a website working, a mail server down and a nightly backup heartbeat" width="100%">

## What it watches

- **Websites.** Every 1 to 60 minutes. Down after two failed checks in a row, so one slow answer doesn't wake you. Optional rules: words the page must or mustn't contain, the status code, and a time limit.
- **Certificates.** Looked up once a day in the public Certificate Transparency logs. Reminders 14, 7 and 1 days before a certificate runs out, or only when a self-renewing one (Let's Encrypt, Cloudflare) is late renewing.
- **Domain renewals.** The registration date from the registry, with reminders 30, 7 and 1 days before.
- **Mail servers.** Checks your server answers and offers encryption, for sending (587, 465) and reading (993, 143, 995, 110). It never signs in. Port 25 can't be checked: Cloudflare doesn't allow it.
- **Ports.** Any other server and port, such as SSH or a database.
- **Heartbeats.** Your backup or scheduled job visits its own address each time it runs. If it doesn't check in on time, you hear about it.

When something keeps going up and down, you get one alert saying so instead of dozens. A daily cap you choose is the safety net.

## Status pages

Public pages showing whether things are working, 90 days of daily bars and your notices. Put one on its own domain, such as status.example.com. Only the names you choose are shown, never server addresses.

<img src="docs/status-page.png" alt="A Site Watch status page on a phone" width="320">

## Your brand, and selling to clients

On the Admin tab you can change the name, logo, colour and support address used everywhere: the app, status pages, emails and chat alerts.

You can also switch on **Sell to clients**: clients sign up, pick one of your plans and pay you with Stripe Checkout, using your own Stripe account. Each client gets their own sign-in and only sees their own things. Stripe handles cards, receipts, changing plan and cancelling; a client's checks only run while their subscription is paid. Using Site Watch this way needs a [commercial licence](#licence).

## What you need

- A Cloudflare account. The free plan is fine.
- For email alerts: a domain on that account with Email Routing switched on (see [Email alerts](#email-alerts)). Chat and webhook alerts need nothing extra.

## Install

All three ways install into your own Cloudflare account. Updating later keeps everything you've set up.

### 1. The installer (recommended)

You need [Node.js](https://nodejs.org) 20 or later.

```sh
npx @mrpwob/site-watch setup
```

It uses Wrangler, Cloudflare's own tool, which asks you to sign in to Cloudflare in your browser. It makes the database, installs Site Watch and gives you a one-time link to make your account. Run the same command again to update.

### 2. Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pobren/site-watch)

The button copies Site Watch to your GitHub account, makes its database and installs it. It asks for one thing:

- **SETUP_TOKEN:** a long secret code you make up. Replace the example: it won't work, so set-up stays locked until you choose your own.

When it's deployed, open `https://<your Site Watch address>/setup?code=<your code>` to make your account. Only someone with the code can. The same link resets your password if you ever forget it.

To update later, use **Sync fork** on your GitHub copy and Cloudflare rebuilds it.

### 3. From the code

```sh
git clone https://github.com/pobren/site-watch.git
cd site-watch
npm install
npx wrangler secret put SETUP_TOKEN   # a long secret code you make up
npm run deploy
```

To try it on your computer first: copy `.dev.vars.example` to `.dev.vars`, choose a code, then `npm run dev`.

## Email alerts

Cloudflare sends the emails through Email Routing, free.

1. In Cloudflare, open one of your domains, then **Email › Email Routing**, and switch it on.
2. Under **Destination addresses**, add the address alerts should go to and click the link Cloudflare emails you.
3. In Site Watch, open **Admin › Sending email** and enter an address on that domain for alerts to come from, such as `alerts@yourdomain.com`.
4. Open **Alerts** and send yourself a test.

Each address alerts go to must be verified in step 2. Password reset emails for clients need this too.

## Selling to clients

1. In Stripe, make a product for each plan with a monthly or yearly price.
2. In Cloudflare, open **Workers & Pages › site-watch › Settings › Variables and Secrets** and add two secrets: `STRIPE_SECRET_KEY` (your secret key) and `STRIPE_WEBHOOK_SECRET` (from step 3).
3. In Stripe, add a webhook endpoint at `https://<your Site Watch address>/stripe/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Copy its signing secret into step 2.
4. In Site Watch, open **Admin**, add your plans with their Stripe price IDs, and tick **Open sign-up to clients**. Your sign-up page is `/signup`.
5. In Stripe's settings, switch on the customer portal and email receipts.

<img src="docs/admin.png" alt="The Admin tab: sending email, branding, selling to clients, plans and clients" width="100%">

## How it works

One Cloudflare Worker and one D1 database. Every minute the Worker checks whatever is due, a few at a time, from Cloudflare's network. All checks for an install come from that one place. Ten websites checked every five minutes fit easily in Cloudflare's free plan.

The checks visit your pages with the user agent `SiteWatch/1.0`. If a firewall or security plugin blocks Cloudflare's addresses, let that through.

## Licence

Site Watch is source available under the [Business Source License 1.1](LICENSE). In plain English:

- **Free** for one person or organisation's own websites, up to 10 (with their mail servers, ports and heartbeats).
- **Needs a commercial licence:** going over 10 websites, running it for clients or other people, or offering it as a hosted, managed or white-label service. [Talk to us](https://paulobrien.dev/contact/) (choose "Let's work together").
- Each version becomes Apache 2.0 four years after it's released.

There's no licence key and nothing in the app stops you. We trust you. The [LICENSE](LICENSE) file is the legal text.

## Help

Questions and bugs go to [GitHub issues](https://github.com/pobren/site-watch/issues). Please don't send personal details there.
