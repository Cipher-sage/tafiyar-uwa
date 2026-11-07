Maternal Continuity System: Codex Build Brief
Prototype for the USPF Changemaker Challenge 2026. Applications close 15 Nov 2026, 23:59. Team: two medical students and one software engineer. Pilot focus: Gombe State.
What we are building
A web app where a health worker registers a pregnant woman and records her clinic visits. Any approved clinic can then look up her history with her Maternal ID, and she can see her own appointments in English or Hausa. Nothing more is needed for the competition demo.
Setting: health centres in one area of Gombe and the hospital they refer to. It works among clinics that use the app and does not need to connect to any other health system.
The 5 things the demo must show
1. Register a fictional mother. She gets a Maternal ID, for example MC-7KQ4XM-3.
2. Record a clinic visit (date, weeks pregnant, blood pressure, weight, notes) and set the next appointment.
3. The mother logs in with her ID and a PIN and sees her appointments. A button switches English and Hausa.
4. A doctor at the referral hospital (call it Gombe Referral Hospital) logs in, types the Maternal ID and a reason, and sees her record. Every look-up is saved in an access log.
5. A phone-style page labelled SIMULATION shows how a basic phone would check the next appointment. A Send reminder button puts a message in an outbox page.
The story you tell the judges: a woman registers at her health centre, is referred to the hospital, and her antenatal history is already there.
What we are NOT building now
Say these are the next phase, not missing features: live USSD and SMS, saving new visits while offline, emergency access, referrals, encryption of stored data, QR cards, automatic reminders, voice calls, analytics.
Offline in this version means one thing: a record you already opened can still be read without internet.
Who does what
• Medical students: write the pregnancy education messages and visit fields, find a midwife to approve them, and do two or three short interviews with health workers.
• Engineer: picks the tools, runs each Codex step, tests it and fixes it.
• Codex: writes the code, one step at a time.
Rules to paste into a file called AGENTS.md
1. Use fictional patient data only. Never real people.
2. No passwords or keys in the code. Use an .env file.
3. Hash passwords and PINs. Never print them in logs.
4. Check the user's role on the server for every request.
5. Every time staff open a mother's record, save who, which mother, and the reason.
6. The app shows reminders and approved information only. It never recommends or changes medicine.
7. Build only what this page lists. Run the tests before each commit.
Tools
The engineer chooses one set on Day 1 and keeps it. Suggested: TypeScript, a Next.js or Hono web app, SQLite or Cloudflare D1 (like your Classroom Check), deployed to a public HTTPS link. The app must work well on a cheap Android phone.
The data (six tables)
• facilities: id, name, state
• users: id, role (admin, health worker, provider), name, email or phone, password hash, facility
• mothers: id, maternal ID, name, age, phone, PIN hash, language, expected delivery date, registered facility, consent to share record
• visits: id, mother, facility, visit date, weeks pregnant, blood pressure, weight, notes, next appointment, recorded by
• access_logs: id, who looked, which mother, reason, time
• sms_outbox: id, mother, message text, time
Maternal ID: MC- plus 6 random letters and numbers, leaving out look-alikes (0, O, 1, I). It is never built from a name or phone number. Knowing the ID alone gives no access: a provider must also log in and give a reason.
Four Codex steps
Give Codex one step at a time. Ask it to explain its plan first, then build, then run the tests. Check each step yourself before the next.
Step 1: Setup and login. Prompt: Read the AGENTS.md rules. Create the project with the tools we chose, the six tables, fictional seed data (three facilities, a few users, five mothers) and login for health workers, providers and mothers (ID plus PIN). Check roles on the server. Done when: each role can log in and only sees what it should.
Step 2: Register, visits, mother view. Prompt: Add the Maternal ID generator with tests. Add a registration form with a consent tick box, a visit form, and a mother page showing her appointments with an English and Hausa switch. Keep all text in en.json and ha.json. Done when: a health worker registers a fictional mother, records a visit, and the mother sees it after logging in.
Step 3: Provider look-up and log. Prompt: Add a provider page where they enter a Maternal ID and a reason, then see the record (read only). Save every look-up in access_logs and show the log to admins. Let the page keep the last opened record readable offline. Done when: it works across two browsers with two different logins.
Step 4: Phone simulator and finish. Prompt: Add a phone-style page that follows a simple menu: language, PIN, then next appointment or a short approved tip. Show a banner: SIMULATION. Add a Send reminder button that writes a short message to an outbox page without mentioning pregnancy. Finish the Hausa text, fix the layout on small screens, and deploy to a public link. Done when: the whole 5-point demo runs from the live link on a phone and a laptop.
Timeline (today is Fri 6 Nov, deadline Sun 15 Nov at 23:59)
1. Fri 6 to Sat 7 Nov: choose tools, Step 1. Medical students start the messages.
2. Sun 8 to Mon 9 Nov: Step 2. First interview.
3. Tue 10 Nov: Step 3. Checkpoint: points 1 to 4 must work on a live link. If not, switch to a simpler fallback idea.
4. Wed 11 to Thu 12 Nov: Step 4. A midwife checks the messages. A native speaker checks the Hausa.
5. Fri 13 Nov: practise the demo and record a short video.
6. Sat 14 Nov: finish the application text and submit.
7. Sun 15 Nov: spare day only.
Also needed for the application
• The official Healthcare problem statement from the USPF site, matched to the five demo points.
• A midwife or health worker who approves the pregnancy messages.
• One clinic or health centre willing to say it would pilot this.
• A one-page note on how you protect data (what is kept, who can see it, how a mother can ask for deletion), following the Nigeria Data Protection Act 2023.
Demo script (about three minutes)
1. Problem: a woman is referred from her health centre to the hospital, and her history does not go with her.
2. Register a fictional mother and show the Maternal ID.
3. Record a visit and show the mother's own view in Hausa.
4. Switch to the hospital doctor: enter the ID and a reason, show the record and the access log.
5. Show the phone simulator, and say clearly it is a simulation and that live USSD is the next phase.
6. Close with the limits and next steps: clinical review, data protection check, a clinic pilot.