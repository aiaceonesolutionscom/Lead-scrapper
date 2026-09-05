"use client";

import { api } from "@/lib/api";

let installed = false;

type ErrorReport = {
  message: string;
  stack: string;
  href: string;
};

const recent = new Set<string>();

function send(report: ErrorReport) {
  const key = report.message + report.stack.slice(0, 80);
  if (recent.has(key)) return;
  if (recent.size > 100) recent.clear();
  recent.add(key);
  void api
    .post("/report-error", {
      message: report.message.slice(0, 500),
      stack: report.stack.slice(0, 2000),
      url: report.href.slice(0, 300),
    })
    .catch(() => {});
}

export function installErrorReporter() {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  const href = () => window.location.href;

  window.addEventListener(
    "error",
    (e: ErrorEvent) => {
      send({
        message: e.message || "Unknown window error",
        stack: e.error?.stack || "",
        href: href(),
      });
    },
    true
  );

  window.addEventListener(
    "unhandledrejection",
    (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      send({
        message:
          typeof reason === "string"
            ? reason
            : reason && typeof reason.message === "string"
              ? reason.message
              : "Unhandled promise rejection",
        stack: reason?.stack || "",
        href: href(),
      });
    }
  );
}