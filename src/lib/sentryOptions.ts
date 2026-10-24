/**
 * Sentry configuration for the browser.
 *
 * Error monitoring only. Session Replay is deliberately absent: it records
 * what a learner does on screen and there is no consent flow for that yet.
 * Tracing is sampled low, default PII is off, and `beforeSend` strips the
 * fields that identify a person or carry their content before anything
 * leaves the browser.
 */
import * as Sentry from "@sentry/react";
import type { BrowserOptions } from "@sentry/react";

const TRACES_SAMPLE_RATE = 0.1;

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

type ScrubbableEvent = {
  user?: unknown;
  request?: {
    url?: string;
    headers?: unknown;
    cookies?: unknown;
    query_string?: unknown;
    data?: unknown;
  };
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
};

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.user;
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.data;
    event.request.url = stripQuery(event.request.url);
  }
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.data) {
        // Keep the URL (minus query) so the error is still locatable; drop
        // bodies, responses and anything else that might hold user text.
        const url = stripQuery(typeof crumb.data.url === "string" ? crumb.data.url : undefined);
        crumb.data = url === undefined ? {} : { url };
      }
    }
  }
  return event;
}

export function buildSentryOptions(dsn: string): BrowserOptions {
  return {
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  };
}
