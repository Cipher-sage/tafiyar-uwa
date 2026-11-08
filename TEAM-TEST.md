# Tafiyar Uwa team test

Allow about 10 minutes. Follow one fictional mother from a community clinic in Gombe to the referral hospital.

## Before you start

1. The organiser opens the private demo login card and sends each tester their own username and four-digit PIN. Use the **Clinic team** tab for `worker`, `provider`, `admin` and the optional second-clinic worker, `riverside`.
2. Each tester opens [the demo](https://tafiyar-uwa.pages.dev/login) on their own phone or browser. If one person plays two roles, use separate browser profiles or devices. Two ordinary tabs in the same profile share a login.
3. Use a made-up name, such as **Amina Team Test**. Leave the phone number blank. The worker and mother will use a newly issued Maternal ID for this run.

## Follow the same record

| Who | What to do | What should happen |
| --- | --- | --- |
| **Worker** | Sign in as `worker`. Choose **Register a mother**, enter the fictional name and age, select Hausa, set and confirm a four-digit test PIN, and tick the sharing consent box for this scenario. Save. | A new ID beginning with `MC-` appears. Send the ID and PIN privately to the mother tester. The provider needs only the ID. |
| **Worker** | On the new record, save a visit dated today, add the note *Team referral test*, and choose a next appointment seven days from today. Then select **Send reminder**. | The visit is saved. The clinic outbox shows **SIMULATION** and a Hausa message containing the appointment date. No actual SMS is sent. |
| **Mother** | Choose **Mother**, enter the new Maternal ID and PIN, and switch between English and Hausa. Sign out. Open the [phone simulator](https://tafiyar-uwa.pages.dev/simulator), choose Hausa, sign in again, and choose the next appointment. | Both languages and the simulated phone show the same date and clinic. The private visit note stays out of the mother's appointment view. |
| **Provider** | Sign in as `provider`. Enter the new ID and a reason such as *Review for team referral*. Open the record and expand the visit. | The provider can read the note and next appointment. For a consent check, try the example ID `MC-3HW7SC` with a reason. Its record should be unavailable. |
| **Provider** | Reopen the shared test record while online. Wait for **Offline copy ready on this device**. Turn off Wi-Fi and mobile data, stay in the same tab, and select **Open last record offline**. Reconnect and leave the tab open briefly. | The last opened record shows its saved time and expiry. After reconnection, the offline access is reported. |
| **Admin** | Sign in as `admin`, open **Record access logs**, and refresh after the provider reconnects. | Find the provider's reason, the denied lookup and the offline opening. Check the clinic, time and access method. |

**Optional second-clinic check.** Sign in as `riverside` and try the newly created Maternal ID in **Open a record**. This worker should be unable to open a record registered at the first clinic. Their outbox should also exclude the first clinic's reminder.

## Send feedback

Send the organiser your **role, device/browser, language, step, expected result and actual result**. A screenshot of the fictional screen helps if a step fails. Keep PINs out of screenshots. Providers can select **Remove saved copy** after testing. Everyone should sign out.
