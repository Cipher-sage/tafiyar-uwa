# NextKind Maternal Continuity

A fictional antenatal care demo for the USPF Changemaker Challenge in Gombe State, Nigeria. Step 1 lets clinic staff and mothers sign in and checks what each person can see. The pilot scenario connects two primary health centres and Gombe Referral Hospital.

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

Choose **Clinic team** for staff or **Mother** for a maternal account. Read the matching password or PIN from `.env` on your computer. The names in the last column below are settings, not credentials to type into the form.

| Account | Identifier | Credential setting |
| --- | --- | --- |
| Health worker at Community Health Centre | `worker@nextkind.test` | `SEED_WORKER_PASSWORD` |
| Health worker at Riverside Health Centre | `worker2@nextkind.test` | `SEED_WORKER2_PASSWORD` |
| Provider at Gombe Referral Hospital | `provider@nextkind.test` | `SEED_PROVIDER_PASSWORD` |
| Administrator | `admin@nextkind.test` | `SEED_ADMIN_PASSWORD` |
| Demo Mother A | `MC-7KQ4XM` | `SEED_MOTHER_PIN` |
| Demo Mother B | `MC-8RZ5TN` | `SEED_MOTHER_B_PIN` |
| Demo Mother C | `MC-6VP9KD` | `SEED_MOTHER_C_PIN` |
| Demo Mother D | `MC-3HW7SC` | `SEED_MOTHER_D_PIN` |
| Demo Mother E | `MC-9BX2RA` | `SEED_MOTHER_E_PIN` |

1. Sign in as the first health worker. Check the facility name, then open `/admin` in the same browser. You should see an access-denied page.
2. Sign out and sign in as the hospital provider. Check the hospital name. The provider workspace does not expose patient records in Step 1.
3. Sign in as Demo Mother A. Check that her page shows `MC-7KQ4XM`. Try her PIN with Demo Mother B’s ID. Sign-in should fail.
4. Sign in as administrator. The directory should show three fictional facilities and four staff accounts. Sign out and revisit `/admin` to check that a fresh sign-in is required.

## How access works

The app checks the signed session and the database on each protected request. The database stores salted scrypt hashes of staff passwords and maternal PINs. A mother’s profile uses the account in her session. Workers see their facility, providers see their own hospital workspace and administrators see the demo directory. Sessions expire after 30 minutes. Signing out revokes that account’s existing sessions.

Use fictional records throughout. Only source code, migrations, setup scripts, sample configuration and tests belong in Git. Local secrets, database files, downloaded packages and compiled output are ignored and can be created on each machine.

## Next review

After the team checks Step 1, Step 2 introduces registration with consent, generated Maternal IDs, visit recording and the mother’s English/Hausa appointment view. The [build brief](BUILD_BRIEF.md) includes the later provider lookup, access log and phone simulation.
