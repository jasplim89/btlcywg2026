// Netlify Function: relays anonymous quiz scores to a Power Automate flow.
// The flow URL is a secret kept in a Netlify environment variable, so it is
// never visible in the browser / page source.
//
// Netlify env var to set (Site settings → Environment variables):
//   POWER_AUTOMATE_URL = the "HTTP POST URL" from your Power Automate trigger

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const flowUrl = process.env.POWER_AUTOMATE_URL;
  if (!flowUrl) {
    return new Response(JSON.stringify({ error: "Pipeline not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ---- Validate & whitelist: only these fields ever leave the function ----
  const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  if (
    !inRange(body.scoreA, 4, 20) ||
    !inRange(body.scoreB, 5, 25) ||
    !inRange(body.scoreC, 5, 25) ||
    !inRange(body.scoreD, 4, 20) ||
    !["A", "B", "C", "D"].includes(body.lowestDimension) ||
    !inRange(body.age, 13, 25) ||
    typeof body.interestedInSupport !== "boolean"
  ) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const clean = {
    responseId: String(body.responseId || "").slice(0, 64),
    submittedAt: new Date().toISOString(), // server-side timestamp
    name: String(body.name || "").slice(0, 100),           // optional (PDPA notice shown at collection)
    age: body.age,
    interestedInSupport: body.interestedInSupport,
    contact: body.interestedInSupport
      ? String(body.contact || "").slice(0, 120)
      : "",                                                // contact only kept when follow-up was requested
    scoreA: body.scoreA,
    scoreB: body.scoreB,
    scoreC: body.scoreC,
    scoreD: body.scoreD,
    lowestDimension: body.lowestDimension,
  };

  try {
    const upstream = await fetch(flowUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean),
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "Upstream error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Relay failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
