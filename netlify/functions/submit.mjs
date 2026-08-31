// Netlify Function: relays anonymous quiz results to a Power Automate flow,
// flattened into one row per response so Power BI can aggregate without parsing JSON.
//
// The flow URL is a secret kept in a Netlify environment variable, so it is
// never visible in the browser / page source.
//
// Netlify env var to set (Site settings -> Environment variables):
//   POWER_AUTOMATE_URL = the "HTTP POST URL" from your Power Automate trigger
//
// Score ranges follow the 12-question build: 8 scenarios (2 per dimension, uniform
// weighting per decision D5), each option worth 1-4.
//   Welcoming  (A) 2 scenarios ->  2-8
//   Accepting  (B) 2 scenarios ->  2-8
//   Empowering (C) 2 scenarios ->  2-8
//   Openness   (D) 2 scenarios ->  2-8
// Because every dimension now shares the same range, the percentage columns are
// mostly for convenience/consistency rather than to correct for differing maxima.

const DIM_MAX = { A: 8, B: 8, C: 8, D: 8 };
const DIM_MIN = { A: 2, B: 2, C: 2, D: 2 };

const SUPPORTER_STYLES = [
  "The Open Door",
  "The Steady One",
  "The Space Maker",
  "The Real One",
];

// Exit Q14 options, in the order they appear in the quiz.
// Keys become the flattened column names (int_*).
const INTEREST_OPTIONS = [
  ["int_transitions",      "Workshops on managing life transitions"],
  ["int_stress_wellbeing", "Talks on stress and academic wellbeing"],
  ["int_peer_training",    "Peer support training"],
  ["int_booths_games",     "Interactive booths or games"],
  ["int_friendships",      "Sessions on friendships and relationships"],
  ["int_small_groups",     "Small group programmes"],
];

const WILLINGNESS_KEYS = ["professionals", "family", "friends", "schoolmates"];
const AWARENESS_KEYS   = ["firststop", "school", "community"];

const json = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const flowUrl = process.env.POWER_AUTOMATE_URL;
  if (!flowUrl) return json({ error: "Pipeline not configured" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // ---- Validate the fields we require ----
  const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  const scoresValid = ["A", "B", "C", "D"].every((d) =>
    inRange(body["score" + d], DIM_MIN[d], DIM_MAX[d])
  );

  if (
    !scoresValid ||
    !["A", "B", "C", "D"].includes(body.lowestDimension) ||
    !["A", "B", "C", "D"].includes(body.strongest) ||
    !inRange(body.age, 13, 25) ||
    typeof body.interestedInSupport !== "boolean"
  ) {
    return json({ error: "Invalid payload" }, 400);
  }

  // ---- Flatten the exit survey ----
  // Every exit answer is optional: a participant can leave any row blank.
  // Unanswered cells are sent as "" so the spreadsheet column stays empty
  // rather than defaulting to a real value that would skew averages.
  const exit = body.exit && typeof body.exit === "object" ? body.exit : {};

  const gridVal = (section, key, hi) => {
    const v = section && section[key];
    return inRange(v, 1, hi) ? v : "";
  };

  const willingness = {};
  for (const k of WILLINGNESS_KEYS) {
    willingness["will_" + k] = gridVal(exit.willingness, k, 5); // 1-5 scale
  }

  const awareness = {};
  for (const k of AWARENESS_KEYS) {
    awareness["aware_" + k] = gridVal(exit.awareness, k, 3); // 1=not aware, 2=aware, 3=used
  }

  const picked = Array.isArray(exit.interest) ? exit.interest : [];
  const interest = {};
  for (const [col, label] of INTEREST_OPTIONS) {
    interest[col] = picked.includes(label) ? 1 : 0;
  }
  // Lets you tell a skipped question apart from a genuine "none of these".
  const interestCount = picked.length;

  const pct = (d) =>
    Math.round((body["score" + d] / DIM_MAX[d]) * 1000) / 10; // one decimal

  // ---- Whitelist: only these fields ever leave the function ----
  const clean = {
    responseId: String(body.responseId || "").slice(0, 64),
    submittedAt: new Date().toISOString(), // server-side timestamp

    supporterStyle: SUPPORTER_STYLES.includes(body.supporterStyle)
      ? body.supporterStyle
      : "",
    strongest: body.strongest,
    lowestDimension: body.lowestDimension,

    scoreA: body.scoreA,
    scoreB: body.scoreB,
    scoreC: body.scoreC,
    scoreD: body.scoreD,

    // Normalised so A/D (max 8) and B/C (max 12) can be charted side by side.
    pctA: pct("A"),
    pctB: pct("B"),
    pctC: pct("C"),
    pctD: pct("D"),

    ...willingness,
    ...awareness,
    ...interest,
    interestCount,

    name: String(body.name || "").slice(0, 100), // optional; PDPA notice shown at collection
    age: body.age,
    interestedInSupport: body.interestedInSupport,
    contact: body.interestedInSupport
      ? String(body.contact || "").slice(0, 120)
      : "", // contact only kept when follow-up was requested
  };

  // Deliberately NOT sent: per-scenario picks, the Part 2 personal reflection.

  try {
    const upstream = await fetch(flowUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean),
    });

    if (!upstream.ok) return json({ error: "Upstream error" }, 502);
    return json({ ok: true }, 200);
  } catch {
    return json({ error: "Relay failed" }, 502);
  }
};
