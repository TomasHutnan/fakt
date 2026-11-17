import { useState } from "preact/hooks";
import { reportFields, reportUrl, sendForm, type CardRef, type Problem } from "./links.ts";
import { Segmented } from "./Screens.tsx";
import { sk } from "./sk.ts";

// Reporting a card from inside the app: a problem type and an optional comment,
// sent in the background to the owner's form. The form page opens only as a
// fallback when sending fails (offline).

/** The design gallery (?demo=) never sends anything. */
export const DEMO = new URLSearchParams(location.search).has("demo");

export function send(fields: Parameters<typeof sendForm>[0]): Promise<boolean> {
  return DEMO ? Promise.resolve(true) : sendForm(fields);
}

type Status = "editing" | "sending" | "sent" | "failed";

export function ReportPanel({ card, onClose }: { card: CardRef; onClose: () => void }) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<Status>("editing");
  const submit = async () => {
    setStatus("sending");
    setStatus((await send(reportFields(card, problem, comment))) ? "sent" : "failed");
  };
  if (status === "sent")
    return (
      <div class="report report--sent" role="status">
        <p>{sk.reportThanks}</p>
        <button type="button" class="btn btn--small" onClick={onClose}>
          {sk.close}
        </button>
      </div>
    );
  return (
    <div class="report" role="group" aria-label={sk.reportCard}>
      <Segmented<string>
        id={`report-problem-${card.key}`}
        label={sk.reportProblem}
        value={problem ?? ""}
        options={(Object.keys(sk.problems) as Problem[]).map((p) => ({ value: p, label: sk.problems[p] }))}
        onChange={(v) => setProblem(v as Problem)}
      />
      <label class="field">
        <span class="field__label">{sk.reportComment}</span>
        <textarea class="input report__comment" rows={2} maxLength={1000} value={comment} onInput={(e) => setComment(e.currentTarget.value)} />
      </label>
      {status === "failed" && (
        <p class="error">
          {sk.reportFailed}{" "}
          <a href={reportUrl(card)} target="_blank" rel="noopener noreferrer">
            {sk.reportOpenForm}
          </a>
        </p>
      )}
      <div class="row">
        <button type="button" class="btn btn--primary btn--small" disabled={status === "sending" || (!problem && !comment.trim())} onClick={submit}>
          {sk.reportSend}
        </button>
        <button type="button" class="btn btn--ghost btn--small" onClick={onClose}>
          {sk.cancel}
        </button>
      </div>
    </div>
  );
}
