# Tafiyar Uwa

[Open the public demo](https://tafiyar-uwa.pages.dev) or [start the phone simulator](https://tafiyar-uwa.pages.dev/simulator).

Tafiyar Uwa means “a mother’s journey” in Hausa. In this USPF Changemaker Challenge demo for Gombe State, a health worker registers a fictional mother, records clinic visits and schedules appointments. The mother can check her appointments in English or Hausa. With her sharing consent, a provider at the referral hospital can look up her antenatal history. The basic-phone simulator and reminder outbox demonstrate how the same appointment could reach families using simpler phones.

## Run it locally

Install Node.js 24 with npm, then run these commands from the project folder.

```sh
npm ci
npm run setup
npm run dev
```

Open [the local sign-in page](http://127.0.0.1:4317/login) on the computer running the app. Setup generates a private `.env` file and creates the SQLite database in `data/`. Run setup again after updating an existing checkout. Keep the `.env` file on the demo computer. Stop the server with Ctrl+C.

To test or run the compiled app, use `npm run check` followed by `npm start`. The check runs TypeScript validation, the automated tests and the build. After dependencies are installed, the local demo needs no external services.

## Try each role

For a ten-minute test with teammates, follow the [team test guide](TEAM-TEST.md).

Choose **Clinic team** and enter a one-word username and its four-digit PIN. Choose **Mother** to use a Maternal ID and four-digit PIN, including in the phone simulator. Enter all four digits even if the PIN starts with zero. Find each PIN in the private settings below: `.env` for local use or `.env.cloud-demo` for the hosted demo.

| Account | Identifier | Credential setting |
| --- | --- | --- |
| Health worker at Community Health Centre | `worker` | `SEED_WORKER_PASSWORD` |
| Health worker at Riverside Health Centre | `riverside` | `SEED_WORKER2_PASSWORD` |
| Provider at Gombe Referral Hospital | `provider` | `SEED_PROVIDER_PASSWORD` |
| Administrator | `admin` | `SEED_ADMIN_PASSWORD` |
| Demo Mother A | `MC-7KQ4XM` | `SEED_MOTHER_PIN` |
| Demo Mother B | `MC-8RZ5TN` | `SEED_MOTHER_B_PIN` |
| Demo Mother C | `MC-6VP9KD` | `SEED_MOTHER_C_PIN` |
| Demo Mother D | `MC-3HW7SC` | `SEED_MOTHER_D_PIN` |
| Demo Mother E | `MC-9BX2RA` | `SEED_MOTHER_E_PIN` |

## Try registration, a visit and an appointment

1. Sign in as `worker` and select **Register a mother**. Enter a fictional name and age, choose her preferred language and set a four-digit PIN. The consent tick box records whether she agrees to share her record with other participating clinics. Leaving it unchecked still allows local registration.
2. Save the registration and copy the new Maternal ID. Record a visit dated today and enter the date of her next appointment. To record another visit later, use **Open a record** at the same clinic and enter the ID.
3. In a separate browser session, choose **Mother** and sign in with that ID and PIN. Check the date and clinic. Switch between **English** and **Hausa**, then sign out and back in to verify the saved preference.

The most recent visit by visit date sets the current appointment. If that visit has no next date, the page says so. Earlier plans stay in a separate list. Dates in that list do not indicate attendance.

## How access works

The app checks the signed session and the database on each protected read. The database stores salted scrypt hashes of passwords and PINs. Workers can open registered records at their own facility. A mother’s appointment page uses her signed-in identity and shows scheduling details only. Provider lookups require an ID, a reason and existing consent to share the record. Administrators can inspect staff access. Sessions expire after 30 minutes. Signing out revokes that account’s existing sessions on the server.

Use fictional records throughout. Only source code, migrations, setup scripts, sample configuration and tests belong in Git. Local secrets, database files, downloaded packages and compiled output are ignored and can be created on each machine.

## Try a hospital lookup across two browsers

1. In one browser, sign in as the **provider**. Enter `MC-7KQ4XM` and a reason such as “Review antenatal history for the referral visit.” You can also use a newly registered fictional mother whose sharing box was checked. Review the visit history, clinic and dates. The hospital view is read-only.
2. In a separate browser or private window, sign in as the **administrator** and choose **Record access logs**. Find the hospital lookup by ID or reason on the list. Each entry shows the staff member, facility, time and outcome. Try `MC-3HW7SC` in the provider browser to see the same unavailable response that an unknown ID would receive. The administrator can see the denied attempt.
3. In the provider’s original tab, open a shared record and wait for **Offline copy ready on this device**. Disconnect the browser from the network, then choose **Open last record offline**. Check the time the copy was opened online. Reconnect and refresh the administrator’s log to see the offline opening and when the server received it.

Offline viewing needs JavaScript and a browser that supports service workers on localhost or HTTPS. Only the latest opened record is available, in the same provider tab, until the sign-in expires. Opening another record replaces it. Use **Remove saved copy** or sign out before sharing the device. Offline views are reported when this browser next reaches the app online. Clearing site data before it reconnects can discard pending reports. A disconnected copy reflects the consent and visit history at the time of the online lookup.

The browser regression check runs with `node --import tsx scripts/check-provider-browser.mjs`. It uses a temporary fictional database and separate provider/admin sessions. Install Playwright in your test environment, or point `PLAYWRIGHT_MODULE_PATH` at its `index.mjs`. Set `CHROME_PATH` when using an existing Chrome installation. Optional `PROVIDER_SCREENSHOT_DIRECTORY` saves screenshots from the check.

## Try the phone simulator and reminder outbox

1. As a health worker, record a visit with a next appointment today or later. Open the mother's record and select **Send reminder**. The outbox shows the message in her saved language. The message contains the appointment date and omits her name, Maternal ID and pregnancy details. Each clinic sees its own outbox. Administrators can see reminders from all demo clinics.
2. Open **Phone simulator** from sign-in in another browser session. Select English or Hausa and sign in with the mother's Maternal ID and PIN. Choose **Next appointment** to see the date and clinic. Choose the tips option to read the short explanations and their sources. **End session** signs the mother out on that browser.
3. Both screens say **SIMULATION**. Messages stay in the outbox and the phone interface runs in the browser. The demo makes no calls to an SMS or USSD gateway.

The tips draw on WHO guidance on [antenatal visits](https://www.who.int/activities/promoting-healthy-pregnancy/promoting-healthy-pregnancy) and [nutrition counselling](https://www.who.int/tools/elena/interventions/nutrition-counselling-pregnancy). The clinical content and Hausa wording still need review by a midwife and a fluent speaker in Gombe before use with patients.

## Run on Cloudflare

The public demo uses the free `tafiyar-uwa.pages.dev` address. Its small Pages entry point calls the app through a private service binding. The app runs as a Worker with one SQLite-backed Durable Object, which keeps fictional clinic records, sign-ins, access logs and outbox across requests and deployments. Direct public Worker and preview URLs are disabled. The local Node app continues to use its SQLite file.

For a local Worker preview, run `npm run setup`, `npm run worker:prepare` and `npm run worker:dev`. For a first public deployment, sign in to the target Cloudflare account with Wrangler, verify the Worker name in `wrangler.jsonc` and run `npm run worker:deploy`. Keep the generated local `.env.cloud-demo` file private. It contains the dedicated public-demo account credentials, using the setting names in the table above. The upload contains salted credential hashes and a session secret. When updating an existing instance from another machine, use `npx wrangler deploy` to reuse its existing secrets.

The Pages project is configured in `pages/wrangler.jsonc`; its `APP` service name must match the Worker. Publish the public entry point with `npm run pages:deploy`. On a new account, first create the Pages project with `npx wrangler pages project create tafiyar-uwa --production-branch main --force` (choose another available project name if needed). The `--force` option selects Pages hosting for the free Pages address instead of Wrangler's automatic Workers conversion. Ordinary application updates need only a Worker deployment; changes under `pages/` need a Pages deployment. Neither deployment resets the saved database.

For the one-time four-digit upgrade on an existing hosted demo, set the nine seed PINs in the private `.env.cloud-demo` file and run `npm run worker:deploy`. Include a `DEMO_REGISTERED_PINS` JSON object mapping any additional fictional Maternal IDs you want to rotate to their individual four-digit strings. The upload includes salted hashes and applies the change once, keeping appointments and logs. Local `npm run setup` upgrades legacy seed settings, or run `npm run setup -- --reset-demo-pins` to apply deliberately edited private settings to the local database. Keep the private PIN directory and any old settings backups out of Git.

The full browser check runs with `node --import tsx scripts/check-step4-browser.mjs` and a Playwright Chromium installation. By default it creates a disposable local database and exercises registration, a visit, both maternal interfaces, a hospital lookup, an audit and a simulated reminder. To check a deployed demo, set `DEMO_CHECK_ORIGIN` and supply its `DEMO_CHECK_WORKER_PASSWORD`, `DEMO_CHECK_PROVIDER_PASSWORD` and `DEMO_CHECK_ADMIN_PASSWORD` privately. This creates a fictional demonstration record on the target.
