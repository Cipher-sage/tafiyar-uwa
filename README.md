# Tafiyar Uwa

Tafiyar Uwa means “a mother’s journey” in Hausa. In this USPF Changemaker Challenge demo for Gombe State, a health worker registers a fictional mother, records clinic visits and schedules appointments. The mother can check her appointments in English or Hausa. With her sharing consent, a provider at the referral hospital can look up her antenatal history.

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

Choose **Clinic team** for staff or **Mother** for a maternal account. Look up the setting in the last column in your local `.env` file and enter its value as your password or PIN. If you used an earlier version of the demo, your original `@nextkind.test` staff sign-in also works with the same password.

| Account | Identifier | Credential setting |
| --- | --- | --- |
| Health worker at Community Health Centre | `worker@tafiyaruwa.test` | `SEED_WORKER_PASSWORD` |
| Health worker at Riverside Health Centre | `worker2@tafiyaruwa.test` | `SEED_WORKER2_PASSWORD` |
| Provider at Gombe Referral Hospital | `provider@tafiyaruwa.test` | `SEED_PROVIDER_PASSWORD` |
| Administrator | `admin@tafiyaruwa.test` | `SEED_ADMIN_PASSWORD` |
| Demo Mother A | `MC-7KQ4XM` | `SEED_MOTHER_PIN` |
| Demo Mother B | `MC-8RZ5TN` | `SEED_MOTHER_B_PIN` |
| Demo Mother C | `MC-6VP9KD` | `SEED_MOTHER_C_PIN` |
| Demo Mother D | `MC-3HW7SC` | `SEED_MOTHER_D_PIN` |
| Demo Mother E | `MC-9BX2RA` | `SEED_MOTHER_E_PIN` |

## Try registration, a visit and an appointment

1. Sign in as `worker@tafiyaruwa.test` and select **Register a mother**. Enter a fictional name and age, choose her preferred language and set a demo PIN. The consent tick box records whether she agrees to share her record with other participating clinics. Leaving it unchecked still allows local registration.
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

## Next review

Step 3 is ready for the team to try with fictional data. The Hausa copy is a draft for review by a fluent speaker in Gombe. The next stage in the [build brief](BUILD_BRIEF.md) covers the basic-phone simulator and reminder outbox.
