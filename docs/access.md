# Cloudflare Access: the gate in front of practice and the control room

Written 9 October 2026, with slice G. Greg does all of this on his own machine, in the Cloudflare dashboard. A cloud session never does.

Until it is done, the control room on practice and live refuses everyone. This machine does not need it: `npm run dev` uses a stand-in that treats you as the invented "Example Staff".

## What it is

Cloudflare Access is Cloudflare's own login page in front of an address. Only the email addresses on its list get through. It sends a code to the email, or uses a Google login. On every request it lets through, it adds a signed note (a JSON Web Token in the `Cf-Access-Jwt-Assertion` header). The Worker checks the note itself (`src/providers/access/cloudflare.ts`). If the note is missing, expired, for another application or not signed by Access, the Worker refuses. So a mistake in Access's set-up still does not open the control room.

The note names the member of staff's email. The Worker keeps that email in its `staff` table, on that copy's database only, so the staff log can say who did what. No email is ever in the repository or a log line.

## What it costs

Nothing for two people. Cloudflare Zero Trust's free plan covers up to 50 users. Cloudflare may ask for a card when the plan is chosen.

## Steps

1. In the Cloudflare dashboard, open **Zero Trust** and choose a team name, such as `frontline`. Choose the free plan.
2. Under **Settings → Authentication**, choose how staff log in: a one-time code sent by email (built in), or Google.
3. Under **Access → Applications**, add a **self-hosted** application for practice's whole address:
   - an **Allow** policy naming Greg's and Sophie's emails
   - a **Bypass** policy for the paths `/vapi/*`, `/twilio/*` and `/health`, which Vapi, Twilio and checks call, and which have their own secrets and signatures
4. Add a second self-hosted application for the control room's address on live, with the same Allow policy. The address waits on open question 9. Access needs the address to be on Cloudflare: a domain in Greg's account, or the Worker's `workers.dev` address with its Access switch turned on.
5. From each application's overview, copy its **Application Audience (AUD) tag**. Then set two secrets for that copy:

   ```sh
   npx wrangler secret put ACCESS_TEAM --env practice   # the team name, such as frontline
   npx wrangler secret put ACCESS_AUD --env practice    # the application's audience tag
   ```

   Do the same with `--env live` for live's control room application.
6. Put the control room's address in `CONTROL_ADDRESS` for that copy in `wrangler.jsonc`, such as `https://control.<a domain of Front-line's>`. The control room answers there and nowhere else. On practice it can be practice's own address.
7. Deploy as usual. Open the control room's address and `/control`: Access asks you to log in, then the list of firms shows.

## If it goes wrong

- **"Not allowed" after logging in:** the two secrets are missing or wrong for that copy, or the address is not behind the application whose audience tag was set.
- **"Not found":** the request did not come to `CONTROL_ADDRESS`, or it is empty.
- **Access's keys:** the Worker fetches the team's public keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. It fetches them again when a note names a key it has not seen, at most once every five minutes.

## The alternative, not chosen

The Worker could run its own staff login: a link texted to a member of staff's mobile, as owners log in. That needs no Cloudflare set-up, but the control room would sit on the open internet behind only Front-line's own code, staff mobiles would have to be held, and practice's other pages would need a gate of their own.
