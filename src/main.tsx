import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

import * as Sentry from "@sentry/react";
import { buildSentryOptions, isEuDsn } from "@/lib/sentryOptions";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn && isEuDsn(sentryDsn)) {
  Sentry.init(buildSentryOptions(sentryDsn));
}

createRoot(document.getElementById("root")!).render(<App />);
