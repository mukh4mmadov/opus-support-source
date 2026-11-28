import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Printer } from "lucide-react";
import { Button, Card, PageHeader, SectionTitle } from "../../components/ui";
import { useMe } from "../../app/auth";
import { useText } from "../../app/config";
import type { Rules as RuleValues } from "../../lib/types";

type Part = "student" | "support" | "admin" | "manager";

const SECTIONS: Record<Part, string[]> = {
  student: [
    "start",
    "booking",
    "now",
    "before",
    "cancel",
    "lesson",
    "closed",
    "after",
    "help",
  ],
  support: [
    "start",
    "day",
    "attendance",
    "marking",
    "now",
    "late",
    "closing",
    "correct",
    "history",
  ],
  admin: [
    "dashboard",
    "people",
    "schedules",
    "attendance",
    "bookings",
    "now",
    "days",
    "penalties",
    "complaints",
    "stats",
    "settings",
    "cheating",
    "routine",
    "problems",
  ],
  manager: ["people", "bookings", "days", "attendance", "reviews", "complaints"],
};
const RULES: Partial<Record<Part, string[]>> = {
  student: [
    "booking",
    "instant",
    "cancel",
    "no_move",
    "excused",
    "closed",
    "marking",
    "penalty",
    "complaint",
    "notifications",
    "honesty",
  ],
  support: [
    "close",
    "marking",
    "forgot",
    "alert",
    "instant",
    "excused",
    "correct",
    "honesty",
    "notifications",
  ],
};
const PARTS: Record<string, Part[]> = {
  student: ["student"],
  support: ["support", "student"],
  admin: ["admin", "support", "student"],
  manager: ["manager", "support", "student"],
};

export const GUIDE_SEEN = "guide-seen";

const numbersOf = (values: RuleValues) => {
  const { auto_no_show: _auto, qr_required: _qr, ...numbers } = values;
  return numbers;
};

function Body({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  const intro = lines.filter((line) => !line.startsWith("- "));
  const points = lines
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
  return (
    <div className="mt-2 flex flex-col gap-2">
      {intro.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {points.length > 0 && (
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {points.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GuidePart({ part, values }: { part: Part; values: RuleValues }) {
  const t = useText();
  const deadline = (days: number) =>
    days
      ? t("guide.deadline_days", { count: days })
      : t("guide.deadline_same_day");
  const numbers = {
    ...numbersOf(values),
    review_deadline: deadline(values.review_days),
    complaint_deadline: deadline(values.complaint_days),
  };
  const rules = RULES[part];
  return (
    <div className="flex flex-col gap-2">
      {SECTIONS[part].map((section, index) => (
        <details
          key={section}
          open={index === 0}
          className="group rounded-xl border border-line bg-surface p-4 break-inside-avoid"
        >
          <summary className="cursor-pointer list-none font-semibold marker:hidden">
            <span
              className="mr-2 inline-block text-muted transition-transform group-open:rotate-90"
              aria-hidden
            >
              ›
            </span>
            {t(`guide.${part}.${section}.title`)}
          </summary>
          <Body text={t(`guide.${part}.${section}.body`, numbers)} />
        </details>
      ))}
      {rules && (
        <>
          <SectionTitle>{t("guide.rules_title")}</SectionTitle>
          <Card>
            <ol className="flex list-decimal flex-col gap-3 pl-5">
              {rules.map((key) => (
                <li key={key}>{t(`rules.${part}.${key}`, numbers)}</li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}

export function Guide() {
  const me = useMe();
  const t = useText();
  const parts = PARTS[me.role];
  const [part, setPart] = useState<Part>(parts[0]);

  useEffect(() => {
    try {
      localStorage.setItem(GUIDE_SEEN, "1");
    } catch {
    }
  }, []);

  function print() {
    document.querySelectorAll("details").forEach((section) => {
      section.open = true;
    });
    window.print();
  }

  return (
    <>
      <PageHeader
        title={t("guide.title")}
        subtitle={t("guide.subtitle")}
        action={
          <Button variant="secondary" className="print:hidden" onClick={print}>
            <Printer className="size-4" aria-hidden />
            {t("guide.print")}
          </Button>
        }
      />
      {parts.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1 print:hidden" role="tablist">
          {parts.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === part}
              onClick={() => setPart(item)}
              className={clsx(
                "rounded-lg border px-3 py-1.5 text-sm font-medium",
                item === part
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-line bg-surface",
              )}
            >
              {t(`guide.tab_${item}`)}
            </button>
          ))}
        </div>
      )}
      <h2 className="mb-2 hidden text-lg font-semibold print:block">
        {t(`guide.tab_${part}`)}
      </h2>
      <GuidePart part={part} values={me.rules} />
    </>
  );
}
