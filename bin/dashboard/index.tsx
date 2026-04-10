import React from "react";
import { withFullScreen } from "fullscreen-ink";
import { setupLogInterceptor } from "./log-buffer";
import { Dashboard } from "./Dashboard";
import type { DashboardProps } from "./types";

export async function startDashboard(props: DashboardProps): Promise<void> {
  setupLogInterceptor();

  const startTime = Date.now();
  const ink = withFullScreen(
    <Dashboard port={props.port} host={props.host} startTime={startTime} />,
  );

  await ink.start();
  await ink.waitUntilExit();

  process.exit(0);
}
