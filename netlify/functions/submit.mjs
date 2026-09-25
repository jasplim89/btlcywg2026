// Netlify Function: relays a quiz submission to a Power Automate flow, which
// writes it into an Excel table in SharePoint/OneDrive. The site never talks
// to Power Automate directly; this function is the only thing that knows the
// flow's URL, and it also whitelists + flattens the payload before relaying it.

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

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

// Exit Q3 options (format preferences), in the order they appear in the quiz.
// Keys become the flattened column names (int_*).
const INTEREST_OPTIONS = [
  ["int_workshops",    "Workshops"],
  ["int_talks",        "Talks"],
  ["int_trainings",    "Trainings"],
  ["int_booths_games", "Booths or games"],
  ["int_dropin",       "Community Drop in Space"],
  ["int_others",       "Others"],
];

// Exit Q4 options (topic preferences), in the order they appear in the quiz.
// Keys become the flattened column names (topic_*).
const TOPICS_OPTIONS = [
  ["topic_transitions",      "Managing change and transition"],
  ["topic_stress_wellbeing", "Managing stress and academic well-being"],
  ["topic_peer_support",     "Peer Support"],
  ["topic_friendships",      "Friendships and relationships"],
  ["topic_others",           "Others"],
];

const WILLINGNESS_KEYS = ["professionals", "family", "friends", "teachers", "schoolmates"];
const AWARENESS_KEYS   = ["firststop", "school", "community"];
// Single-row "grid" questions (KPI4/KPI5, research & outcomes team) -- same
// 1-6 / 1-3 column-position encoding as the multi-row grids above.
// 6 = "Prefer not to say" on the two 6-point agreement scales; not a real
// rating, so exclude it before averaging if computing a mean agreement score.

// Facts recall quiz (research & outcomes team's KPI sheet). Keep this array's
// order in sync with FACTS_QUESTIONS in index.html -- each entry becomes one
// "<key>_correct" column (0/1). Extend this list when the team adds more KPI
// questions; nothing else needs to change.
const FACTS_QUESTION_KEYS = [
  "kpi1_awareness_q1",
  "kpi1_awareness_q2",
  "kpi1_awareness_q3",
];

function inRange(n, min, max) {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid payload" }, 400);
  }

  const validDims = ["A", "B", "C", "D"].every((d) =>
    inRange(body["score" + d], DIM_MIN[d], DIM_MAX[d])
  );
  const validAge = inRange(body.age, 13, 25);
  if (!validDims || !validAge || typeof body.responseId !== "string") {
    return json({ error: "Invalid payload" }, 400);
  }

  const exit = body.exit && typeof body.exit === "object" ? body.exit : {};

  const willingness = {};
  const willSrc = exit.willingness && typeof exit.willingness === "object" ? exit.willingness : {};
  for (const k of WILLINGNESS_KEYS) {
    const v = willSrc[k];
    willingness["will_" + k] = inRange(v, 1, 5) ? v : "";
  }

  const awareness = {};
  const awareSrc = exit.awareness && typeof exit.awareness === "object" ? exit.awareness : {};
  for (const k of AWARENESS_KEYS) {
    const v = awareSrc[k];
    awareness["aware_" + k] = inRange(v, 1, 3) ? v : "";
  }

  const seekHelpSrc = exit.seekHelp && typeof exit.seekHelp === "object" ? exit.seekHelp : {};
  const intend_seek_help = inRange(seekHelpSrc.intend, 1, 6) ? seekHelpSrc.intend : "";

  const soughtSrc = exit.soughtHelpBTL && typeof exit.soughtHelpBTL === "object" ? exit.soughtHelpBTL : {};
  const sought_help_btl = inRange(soughtSrc.sought, 1, 3) ? soughtSrc.sought : "";

  const supportOthersSrc = exit.supportOthers && typeof exit.supportOthers === "object" ? exit.supportOthers : {};
  const intend_support_others = inRange(supportOthersSrc.intend, 1, 6) ? supportOthersSrc.intend : "";

  const pickedInterest = Array.isArray(exit.interest) ? exit.interest : [];
  const interest = {};
  for (const [col, label] of INTEREST_OPTIONS) {
    interest[col] = pickedInterest.includes(label) ? 1 : 0;
  }
  // Lets you tell a skipped question apart from a genuine "none of these".
  const interestCount = pickedInterest.length;
  // Only kept if "Others" was actually selected, in case it's stale from an unchecked box.
  const interestOtherText = pickedInterest.includes("Others")
    ? String(exit.interestOtherText || "").slice(0, 120)
    : "";

  const pickedTopics = Array.isArray(exit.topics) ? exit.topics : [];
  const topics = {};
  for (const [col, label] of TOPICS_OPTIONS) {
    topics[col] = pickedTopics.includes(label) ? 1 : 0;
  }
  const topicsCount = pickedTopics.length;
  const topicsOtherText = pickedTopics.includes("Others")
    ? String(exit.topicsOtherText || "").slice(0, 120)
    : "";

  // Facts recall quiz: an array of 0/1 flags, index-aligned to FACTS_QUESTION_KEYS
  // (mirrors how scenario picks are index-aligned on the frontend). Anything
  // missing or malformed just comes through as 0/blank rather than failing the
  // whole submission -- this is a bonus KPI block, not core quiz data.
  const factsCorrectArr = Array.isArray(body.factsCorrect) ? body.factsCorrect : [];
  const facts = {};
  FACTS_QUESTION_KEYS.forEach((key, i) => {
    facts[key + "_correct"] = factsCorrectArr[i] ? 1 : 0;
  });
  const factsScore = Number.isFinite(body.factsScore)
    ? body.factsScore
    : factsCorrectArr.filter(Boolean).length;
  const factsTotal = Number.isFinite(body.factsTotal)
    ? body.factsTotal
    : FACTS_QUESTION_KEYS.length;

  // Whitelisted output only -- nothing from `body` is forwarded unfiltered.
  const clean = {
    responseId: String(body.responseId).slice(0, 100),
    submittedAt: new Date().toISOString(),
    supporterStyle: String(body.supporterStyle || "").slice(0, 60),
    strongest: String(body.strongest || "").slice(0, 1),
    lowestDimension: String(body.lowestDimension || "").slice(0, 1),
    scoreA: body.scoreA, scoreB: body.scoreB, scoreC: body.scoreC, scoreD: body.scoreD,
    pctA: Math.round((body.scoreA / DIM_MAX.A) * 1000) / 10,
    pctB: Math.round((body.scoreB / DIM_MAX.B) * 1000) / 10,
    pctC: Math.round((body.scoreC / DIM_MAX.C) * 1000) / 10,
    pctD: Math.round((body.scoreD / DIM_MAX.D) * 1000) / 10,
    intend_seek_help,
    sought_help_btl,
    intend_support_others,
    ...willingness,
    ...awareness,
    ...interest,
    interestCount,
    interestOtherText,
    ...topics,
    topicsCount,
    topicsOtherText,
    ...facts,
    factsScore,
    factsTotal,
    name: String(body.name || "").slice(0, 100),
    age: body.age,
    interestedInSupport: !!body.interestedInSupport,
    contact: body.interestedInSupport ? String(body.contact || "").slice(0, 120) : "",
  };

  const flowUrl = process.env.POWER_AUTOMATE_URL;
  if (!flowUrl) return json({ error: "Pipeline not configured" }, 500);

  try {
    const upstream = await fetch(flowUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean),
    });
    if (!upstream.ok) return json({ error: "Upstream error" }, 502);
  } catch {
    return json({ error: "Relay failed" }, 502);
  }

  return json({ ok: true });
};
