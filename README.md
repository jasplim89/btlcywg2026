# How Do I Hold Space? — Interactive quiz (Beyond the Label)

An interactive, mobile-friendly version of the peer-supporter self-reflection quiz, ready to deploy on **Netlify**, with an optional anonymous data pipeline into **Microsoft 365** (Power Automate → Excel on SharePoint/OneDrive → Power BI).

```
Browser (quiz)
   └─ POST /.netlify/functions/submit        ← only anonymous dimension scores
        └─ Netlify Function (secret env var)
             └─ Power Automate flow (HTTP trigger)
                  └─ "Add a row into a table" → Excel file on SharePoint/OneDrive
                       └─ Power BI report (scheduled refresh)
```

## Privacy by design (please read first)

The quiz tells participants their answers are theirs. The pipeline honours that:

- Only **four dimension totals, an optional age band, a random response ID, and a timestamp** are ever transmitted.
- Per-question answers, scenario picks, and all Part 3 reflections **never leave the device**.
- Submission is **opt-in** via a consent checkbox and is clearly voluntary.
- The Netlify function whitelists and validates fields, so nothing extra can be smuggled into your Excel file.
- Never use the collected scores to rank, select, or evaluate individual supporters — the tool is a reflection aid, not a validated psychometric instrument. With a random response ID and no names, individuals can't be identified anyway; keep it that way.

Participants include minors (13–17). Under Singapore's PDPA, keeping the data anonymous is your strongest position — resist any future temptation to add name/email fields.

---

## Part A — Deploy the site on Netlify (5 minutes)

**Easiest (drag & drop):**
1. Go to https://app.netlify.com → "Add new site" → "Deploy manually".
2. Drag this whole project folder in. Done — you'll get a `*.netlify.app` URL.

**Better (Git-based, recommended):**
1. Push this folder to a GitHub repo.
2. Netlify → "Add new site" → "Import an existing project" → pick the repo.
3. Build command: *(leave empty)* · Publish directory: `.`
4. Every git push now auto-deploys.

The quiz works fully at this point. The "Share anonymously" button will show a friendly error until you finish Parts B–C.

## Part B — Create the Power Automate flow (10 minutes)

Prerequisite: create an Excel file first (see Part C, step 1) so the flow has somewhere to write.

1. Go to https://make.powerautomate.com → **Create → Instant cloud flow → skip**.
2. Add trigger: **"When an HTTP request is received"** (Premium connector — needs a Power Automate Premium / per-user licence, or an M365 plan that includes it).
   - Who can trigger: "Anyone" (the URL itself contains a secret signature; we additionally hide it behind the Netlify function).
   - Request Body JSON Schema — click "Use sample payload" and paste:
     ```json
     {
       "responseId": "abc-123",
       "submittedAt": "2026-07-30T08:00:00Z",
       "ageBand": "16–18",
       "scoreA": 15,
       "scoreB": 18,
       "scoreC": 20,
       "scoreD": 12,
       "lowestDimension": "D"
     }
     ```
3. Add action: **Excel Online (Business) → "Add a row into a table"**.
   - Location: your SharePoint site (or OneDrive for Business).
   - Document Library / File: the Excel file from Part C.
   - Table: `QuizResponses`.
   - Map each column to the matching dynamic content from the trigger.
4. Add action: **"Response"** → Status code `200`, body `{"ok": true}`.
5. Save. Reopen the trigger — copy the generated **HTTP POST URL**.

> No Premium licence? Free alternative: use the **Microsoft Forms** trigger instead and embed a hidden Form — but that loses the custom UX. Another option is calling the Microsoft Graph API directly from the Netlify function with an Azure AD app registration (more setup, no Power Automate needed — ask if you want this variant).

## Part C — The Excel file & Power BI (10 minutes)

1. In SharePoint (a Team site the programme team controls) or OneDrive, create `HoldingSpace-Responses.xlsx`.
2. In row 1 add headers, select them, then **Insert → Table** (✓ "My table has headers") and name the table `QuizResponses`:

   | responseId | submittedAt | ageBand | scoreA | scoreB | scoreC | scoreD | lowestDimension |
   |---|---|---|---|---|---|---|---|

3. **Power BI Desktop** → Get Data → **Web** → paste the SharePoint file path (or Get Data → SharePoint folder), load the `QuizResponses` table.
4. Useful starter visuals (all aggregate — never per-person):
   - Average score per dimension (clustered bar), normalised to % of max since B/C max at 25 and A/D at 20.
   - Distribution of "lowest dimension" (which growth edge is most common → informs training focus).
   - Responses over time / by age band.
5. Publish to the Power BI Service and set **scheduled refresh** (the SharePoint connection refreshes without a gateway).

Security notes:
- Access to the Excel file and the Power BI workspace is controlled by normal M365 permissions — keep it restricted to the programme team.
- Data stays inside your M365 tenant; Netlify only relays it and stores nothing.

## Part D — Connect Netlify to the flow (2 minutes)

1. Netlify → your site → **Site configuration → Environment variables**.
2. Add: `POWER_AUTOMATE_URL` = the HTTP POST URL you copied in Part B.
3. Trigger a redeploy (Deploys → "Trigger deploy").
4. Test: finish the quiz, tick consent, click "Share anonymously" → a new row should appear in Excel within seconds.

## Customising

- **Colours / fonts:** all design tokens are CSS variables at the top of `index.html` (`--teal: #009BAA` is sampled from the logo).
- **Questions:** edit the `ITEMS`, `SCENARIOS`, and `DIMS` objects in the `<script>` at the bottom of `index.html`. Reverse-scored items just have `r:true` — flipping is automatic.
- **Assets:** `assets/logo.png` and `assets/mascot.png` (transparent-background versions prepared from your uploads — replace with official brand assets if you have higher-resolution ones).

## Files

```
index.html                    the whole app (landing → Part 1 → Part 2 → Part 3 → results)
assets/logo.png               Beyond the Label logo (white background removed)
assets/mascot.png             BRAVE mascot (waving pose, background removed)
netlify/functions/submit.js   secure relay to Power Automate
netlify.toml                  Netlify + security header config
```
