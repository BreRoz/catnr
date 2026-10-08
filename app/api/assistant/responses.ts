// The few JSON answers the assistant API gives repeatedly. All are marked uncacheable: they contain rescue records.
const NO_STORE = { "cache-control": "no-store" };

export const unauthorized = () => Response.json({ message: "Sign in to access rescue records." }, { status: 401, headers: NO_STORE });

export const refuse = (message: string, status: number, outcome = "rejected") =>
  Response.json({ outcome, message }, { status, headers: NO_STORE });

export const rejectedPlan = () =>
  refuse(
    "I couldn’t safely turn that into an update, so nothing was changed. Your words are still here — try rewording it or adding detail.",
    422,
  );

export const noStoreJson = (data: unknown) => Response.json(data, { headers: NO_STORE });
