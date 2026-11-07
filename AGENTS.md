# Maternal Continuity System — NextKind

1. Use fictional patient data only. Never real people.
2. No passwords or keys in the code. Use an `.env` file.
3. Hash passwords and PINs. Never print them in logs.
4. Check the user's role on the server for every request.
5. Every time staff open a mother's record, save who, which mother, and the reason.
6. The app shows reminders and approved information only. It never recommends or changes medicine.
7. Build only what the build brief lists. Run the tests before each commit.

## Delivery stages

Follow `BUILD_BRIEF.md`: Step 1 is setup and login. Stop at a reviewable stage before Step 2. Public hosting is a later stage. Keep the six business tables; do not add clinical decision support. Any future offline record view must remain limited to the last opened record, protect access on shared devices, and make its age visible.

## Repository practices

Track all source, migrations, tests, lockfiles and setup documentation. Keep `.env`, local databases, generated builds, logs and dependencies ignored. Never commit credentials or real patient data. Use Node 24 and the existing TypeScript/Hono/SQLite stack.
