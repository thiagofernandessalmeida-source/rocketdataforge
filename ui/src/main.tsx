import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { StandaloneLogWindow } from "./features/execution/StandaloneLogWindow";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

const isLogWindow = window.location.hash.includes("/log-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isLogWindow ? <StandaloneLogWindow /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
