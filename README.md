# ZOFF Champions automation

Google Apps Script that runs the admin side of the **ZOFF Champions** monthly rewards programme
(the 20-slide deck): one proof form, one points tracker, Friday leaderboard, month-end winners,
certificates, archive and time-off reminders.

## Can the whole thing be automated?

**Most of the admin, yes. Checking whether people really did the engagement, no.** Two decisions
also have to be made by people before launch (see [Before launch](#before-launch)).

| Deck item | Status | How |
|---|---|---|
| One form per post: ZOFF/Akash, tick actions, links, screenshots (15) | ✅ Automated | `setup` builds the Google Form with sections. You add the 2 file-upload questions by hand, because Apps Script cannot create them |
| Points table: 1 / 4 / 5 / 5 / 5, helpful reply 5 (9) | ✅ Automated | Rules in `Config.js`, enforced at scoring |
| "First five count once per post", "once per conversation" (9) | ✅ Automated | Enforced when scoring, across months, even if a duplicate was approved by mistake |
| Originals 25 / 50 / 50, factory Reel 50 in total, each counts once (10) | ✅ Automated | The same file is caught by its Drive MD5 and the same link after normalising it. Re-edits are for the reviewer to judge |
| Quora 20 per answer, disclosure (12) | ✅ Automated / 👤 checked | Deduped per answer URL. The disclosure is a required tick box, and the reviewer confirms it |
| Google reviews outside points (12) | ✅ By design | The form has no Google-review option, and it should stay that way |
| Flag duplicate entries (19) | ✅ Automated | Flags: `ALREADY_CLAIMED`, `SAME_FILE_AS`, `SAME_LINK_AS`, `NOT_REGISTERED`, `EMAIL_DOES_NOT_MATCH_ID`, `POST_NOT_IN_DAILY_LIST`, `NO_PROOF`, `NO_CLEAN_FILE` |
| "Marketing checks" each entry (8, 15) | 👤 **Stays manual** | The reviewer picks Approved or Rejected per line. Timestamp, reviewer name and audit log are recorded automatically |
| Add points after approval (19) | ✅ Automated | |
| 100-point qualification, ranks 1–9, one prize each (14) | ✅ Automated | |
| Ties: active days, then posts supported, then recorded draw (14) | ✅ Automated | SHA-256 draw with the seed and outcome saved to **Draw log** |
| Friday scores (16) | ✅ Automated | Leaderboard rebuilt every Friday at 5 PM IST, plus a Gmail draft for Marketing. There's an optional view-only copy for staff with no emails or evidence |
| Entries close 11:59 PM IST on the last day (16) | ✅ Automated | The month is set by the IST submission time |
| Final scores by working day 2, winners by day 5 (16) | ✅ Automated | Daily run, using the holiday list and weekend days from Settings. Winners are held back while any entry is Pending |
| Queries by day 4 (16) | 👤 Manual | People reply to the final-score email, and Marketing fixes decisions before day 5 |
| ₹20,000 cap: ₹16,000 prizes + ₹4,000 allowance (18) | ✅ Automated | Checked at setup and at every winner run. Unawarded prizes stay unspent |
| Winner certificates (6, 19) | ✅ Automated | Google Slides template → PDF per winner |
| Archive each month (19) | ✅ Automated | Protected `Archive YYYY-MM` sheet |
| Time off used within 60 days (5) | ✅ Automated | Use-by date on the Winners sheet. Reminder draft to the winner, cc their manager |
| Announcements and messages (19: "people approve messages") | ✅ Drafted / 👤 sent | Everything is a Gmail **draft**, and nothing is sent automatically |
| Buying rewards, bobblehead, Champion Cup, founders' note and coffee, Wall of Fame, walk-in music (6, 7) | 👤 Manual | Tracked in the Winners sheet's `Fulfilment status` column |
| Registering employees, posting daily links (8, 16) | 👤 Manual | Marketing adds rows to **Employees** and **Posts** |

### Why checking proof can't be automated

- **Likes, story shares, WhatsApp Status, friend/group shares and WhatsApp replies** can't be read
  through any API for personal accounts. WhatsApp can't be read at all. Screenshots are the only
  proof, and a person has to look at them.
- **Instagram comments** are the one partial exception. With the Instagram Graph API on ZOFF's own
  business account, comments on ZOFF posts could be matched to registered usernames. That needs a
  Meta app and app review, so it isn't included here. LinkedIn does not expose comments on
  Akash's personal posts.
- **Quality calls stay human**: whether a comment is relevant and in the person's own words,
  whether an original is clear and on-brand, and whether screenshots hide other people's names.

## Before launch

1. **Slide 20 is a blocker, and code can't settle it.** Cash and vouchers (ranks 1–6, especially the
   ₹750 food vouchers) tied to engagement may break Meta's rules on paid engagement. Get this
   confirmed first. If paid prizes can't depend on engagement, set
   `CONFIG.PRIZE_BASIS = 'ORIGINALS_ONLY'` in `apps-script/Config.js`. Engagement points are then still
   tracked and shown on the board, but paid prizes are ranked on original content only. You'd need
   to publish those criteria, and probably a lower `QUALIFY_POINTS`.
2. **The deck leaves some rules open. Decide these and tell employees:**
   - *Working days*: is Saturday a working day? Fill in `WEEKEND_DAYS` and `HOLIDAYS` in Settings.
   - *Active days* (tie-break) currently means the IST dates on which **approved entries were
     submitted**. People who save up entries and submit them in one go lose this tie-break. Tell
     employees to submit on the day, or add an activity-date question.
   - *Can Marketing reviewers compete?* The default is that they can't: untick `Eligible` in
     Employees.
   - *Posts not on the daily list*: they're flagged `POST_NOT_IN_DAILY_LIST`. Decide whether they
     count.
   - *Bobblehead lead time*: custom bobbleheads take weeks. Winners are known on working day 5.
3. **Copy nit on slide 12**: the Quora column says "A review must reflect your experience". It
   should probably say "answer".

## Setup (about 10 minutes)

1. Create a Google Sheet, then open **Extensions → Apps Script**.
2. Replace everything in `Code.gs` with the contents of
   [`dist/ZOFF-Champions.gs`](dist/ZOFF-Champions.gs): all the code in one file. Then:
   - **Project Settings** (gear icon) → tick *Show "appsscript.json" manifest file*, and replace
     that file with [`dist/appsscript.json`](dist/appsscript.json). It sets the time zone to IST
     and turns on the Drive service used for file MD5s.
   - Save.

   (Developers can instead push `apps-script/` with [clasp](https://github.com/google/clasp).
   Run `npm run bundle` after changing code there.)
3. Reload the sheet. Choose **ZOFF Champions → Set up (run once)** and grant the permissions it asks
   for. This creates the sheets and the form, and installs four triggers (form submit, edit,
   Friday, daily).
4. In the form editor, add two **File upload** questions titled exactly:
   - `Proof screenshots`, at the end of the *Engagement* section
   - `Clean original file`, at the end of the *Your original content* section. Mark it required.
5. Fill in **Settings**: `MARKETING_EMAILS`, `HOLIDAYS`, `WEEKEND_DAYS`, and optionally
   `CERT_TEMPLATE_ID` + `CERT_FOLDER_ID`. The template is a Slides file with `{{NAME}}`,
   `{{PRIZE}}`, `{{RANK}}`, `{{MONTH}}`, `{{POINTS}}`. `PUBLIC_SHEET_ID` is optional: a
   spreadsheet shared view-only with staff.
6. Add registered staff to **Employees** and tick `Eligible`. Paste each day's links into **Posts**.

The form must be restricted to your Google Workspace domain. File uploads need sign-in, and the
signed-in email is checked against the Employee ID.

## Marketing's routine

- **Daily**: paste new post links into *Posts*. In *Review*, filter `Decision = Pending`, check
  the evidence and flags, and choose Approved or Rejected.
- **Friday**: a draft email with the leaderboard is waiting in Gmail. Check it and send it.
- **Working day 2**: a final-scores draft arrives. If entries are still pending, it says so at the top.
- **Working day 5**: once nothing is pending, winners are picked automatically. You get a
  draft announcement, Winners rows, PDF certificates, a Draw log entry and an archive sheet. Then
  arrange the rewards and update `Fulfilment status`.

## Code layout

| File | Purpose |
|---|---|
| `apps-script/Config.js` | Every number and label from the deck |
| `apps-script/Rules.js` | Pure logic: scoring, dedupe, flags, ranking and draw, IST dates, working days, link normalising. No Google APIs |
| `apps-script/Intake.js` | Form response → Review lines |
| `apps-script/Leaderboard.js` | Approval stamping and audit, leaderboard, public copy |
| `apps-script/MonthEnd.js` | Friday, final scores, winners, draw log, archive, certificates, reminders |
| `apps-script/Setup.js` | Menu, sheets, form, triggers |
| `apps-script/Store.js` | Sheet read/write helpers |

## Tests

```
npm test
```

Runs the rule tests plus a full month end to end against an in-memory fake of Sheets, Gmail and
Drive (`tests/fake-gas.js`). The Google services themselves (form creation, triggers, Slides
export) have not been run against a real Google account. Do a dry run with a test sheet before
launch.
