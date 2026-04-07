import * as vscode from 'vscode';
import { renderDashboard } from './panel';
import type { MetricsSnapshot } from './metricsState';

export class DashboardProvider implements vscode.Disposable {
	private currentSnapshot: MetricsSnapshot | null = null;

	static readonly viewType = 'contexty.dashboard.insight';

	render(): string {
		return renderDashboard(this.currentSnapshot);
	}

	updateMetrics(snapshot: MetricsSnapshot | null): void {
		this.currentSnapshot = snapshot;
	}

	dispose(): void {
	}
}
