import * as vscode from 'vscode';
import { renderDashboard } from './panel';
import type { MetricsSnapshot } from './metricsState';

export class DashboardProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined;
	private currentSnapshot: MetricsSnapshot | null = null;

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: []
		};

		webviewView.webview.html = renderDashboard(this.currentSnapshot);
	}

	onDidChangeVisibility?(_visibility: boolean): void {
	}

	updateMetrics(snapshot: MetricsSnapshot | null): void {
		this.currentSnapshot = snapshot;

		if (!this.view) {
			return;
		}

		this.view.webview.html = renderDashboard(snapshot);
	}

	dispose(): void {
		this.view = undefined;
	}
}
