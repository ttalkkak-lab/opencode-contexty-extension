import type { MetricsSnapshot } from './metricsState';

type TokenMetrics = MetricsSnapshot['tokens'];
type FileMetrics = MetricsSnapshot['files'][number];
type ToolMetrics = MetricsSnapshot['tools'][number];
type AcpmMetrics = MetricsSnapshot['acpm'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function truncatePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (normalized.length <= 2) {
    return normalized.join('/');
  }
  return normalized.slice(-2).join('/');
}

function sumValues(values: Array<number | undefined>): number {
	return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function renderEmpty(message: string): string {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function renderContextGauge(tokens: TokenMetrics | null): string {
  if (!tokens) {
    return renderEmpty('No token data');
  }

  const input = Math.max(0, tokens.input ?? 0);
  const output = Math.max(0, tokens.output ?? 0);
  const reasoning = Math.max(0, tokens.reasoning ?? 0);
	const cacheRead = Math.max(0, tokens.cacheRead ?? 0);
	const cacheWrite = Math.max(0, tokens.cacheWrite ?? 0);
	const total = input + output + reasoning;
	const radius = 52;
	const circumference = Math.PI * radius;
	const arc = 'M 68 120 A 52 52 0 0 1 172 120';
  const segments = [
    { label: 'input', value: input, color: 'var(--vscode-chart-blue, var(--vscode-foreground))' },
    { label: 'output', value: output, color: 'var(--vscode-chart-green, var(--vscode-foreground))' },
    { label: 'reasoning', value: reasoning, color: 'var(--vscode-chart-yellow, var(--vscode-foreground))' }
  ];

  let dashOffset = 0;
  const strokeSegments = segments.map((segment) => {
    const segmentLength = total > 0 ? circumference * (segment.value / total) : 0;
    const markup = `<path d="${arc}" pathLength="${circumference}" fill="none" stroke="${segment.color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${segmentLength} ${circumference}" stroke-dashoffset="${dashOffset}" />`;
    dashOffset -= segmentLength;
    return markup;
  }).join('');

  const indicatorItems = segments.map((segment) => {
    return `<div class="legend-item"><span class="legend-swatch" style="background:${segment.color}"></span><span>${escapeHtml(segment.label)} ${escapeHtml(formatNumber(segment.value))}</span></div>`;
  }).join('');

  return `
    <div class="gauge-shell">
      <svg class="gauge" viewBox="0 0 240 150" role="img" aria-label="Token distribution gauge">
        <path d="${arc}" fill="none" stroke="var(--vscode-descriptionForeground)" stroke-opacity="0.25" stroke-width="10" stroke-linecap="round" />
        ${strokeSegments}
        <circle cx="120" cy="120" r="34" class="gauge-core" />
        <text x="120" y="116" text-anchor="middle" class="gauge-total">${escapeHtml(formatNumber(total))}</text>
        <text x="120" y="132" text-anchor="middle" class="gauge-label">tokens</text>
      </svg>
      <div class="metric-stack">
        <div class="metric-row"><span class="metric-name">Input</span><span class="metric-value">${escapeHtml(formatNumber(input))}</span></div>
        <div class="metric-row"><span class="metric-name">Output</span><span class="metric-value">${escapeHtml(formatNumber(output))}</span></div>
        <div class="metric-row"><span class="metric-name">Reasoning</span><span class="metric-value">${escapeHtml(formatNumber(reasoning))}</span></div>
        <div class="metric-meta">Cache read ${escapeHtml(formatNumber(cacheRead))} / write ${escapeHtml(formatNumber(cacheWrite))}</div>
        <div class="legend-grid">${indicatorItems}</div>
      </div>
    </div>
  `;
}

export function renderFileBreakdown(files: FileMetrics[] | null): string {
  if (!files || files.length === 0) {
    return renderEmpty('No file data');
  }

  const sorted = [...files].sort((a, b) => (b.tokenEstimate ?? 0) - (a.tokenEstimate ?? 0));
  const visible = sorted.slice(0, 10);
  const remaining = sorted.length - visible.length;
  const maxTokens = Math.max(1, ...visible.map((file) => Math.max(0, file.tokenEstimate ?? 0)));
  const palette = [
    'var(--vscode-chart-blue, var(--vscode-foreground))',
    'var(--vscode-chart-green, var(--vscode-foreground))',
    'var(--vscode-chart-yellow, var(--vscode-foreground))',
    'var(--vscode-chart-red, var(--vscode-foreground))'
  ];

  const rows = visible.map((file, index) => {
    const value = Math.max(0, file.tokenEstimate ?? 0);
    const width = (value / maxTokens) * 100;
    const color = palette[index % palette.length];
    return `
      <div class="bar-row">
        <div class="bar-head">
          <span class="bar-label" title="${escapeHtml(file.path)}">${escapeHtml(truncatePath(file.path))}</span>
          <span class="bar-value">${escapeHtml(formatNumber(value))}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${formatPercent(width)}; background:${color}"></div>
        </div>
        <div class="bar-subtle">estimate</div>
      </div>
    `;
  }).join('');

  const overflow = remaining > 0 ? `<div class="overflow-note">and ${escapeHtml(formatNumber(remaining))} more...</div>` : '';

  return `
    <div class="section-badge">estimate</div>
    <div class="bar-list">${rows}</div>
    ${overflow}
  `;
}

export function renderToolFrequency(tools: ToolMetrics[] | null): string {
  if (!tools || tools.length === 0) {
    return renderEmpty('No tool data');
  }

  const sorted = [...tools].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const maxCount = Math.max(1, ...sorted.map((tool) => Math.max(0, tool.count ?? 0)));

  const rows = sorted.map((tool) => {
    const count = Math.max(0, tool.count ?? 0);
    const success = Math.max(0, tool.successCount ?? 0);
    const fail = Math.max(0, tool.failCount ?? 0);
    const width = (count / maxCount) * 100;
    const successShare = count > 0 ? Math.max(0, Math.min(100, (success / count) * 100)) : 0;
    const failShare = count > 0 ? Math.max(0, Math.min(100, (fail / count) * 100)) : 0;
    const neutralShare = Math.max(0, 100 - successShare - failShare);
    return `
      <div class="bar-row">
        <div class="bar-head">
          <span class="bar-label">${escapeHtml(tool.name)} <span class="bar-count">(${escapeHtml(formatNumber(count))})</span></span>
          <span class="bar-value">${escapeHtml(formatNumber(success))} ok / ${escapeHtml(formatNumber(fail))} fail</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill bar-fill-tool" style="width:${formatPercent(width)}">
            <span class="bar-fill-success" style="width:${formatPercent(successShare)}"></span>
            <span class="bar-fill-neutral" style="width:${formatPercent(neutralShare)}"></span>
            <span class="bar-fill-fail" style="width:${formatPercent(failShare)}"></span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `<div class="bar-list">${rows}</div>`;
}

export function renderAcpmStatus(acpm: AcpmMetrics | null): string {
  if (!acpm) {
    return renderEmpty('No ACPM data');
  }

  const presetName = acpm.activePreset ? acpm.activePreset : 'No active preset';
  const deniedCategories = Object.entries(acpm.deniedByCategory ?? {})
    .map(([category, count]) => ({ category, count: Math.max(0, count ?? 0) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  const folderAccess = {
    denied: Math.max(0, acpm.folderAccessDistribution?.denied ?? 0),
    'read-only': Math.max(0, acpm.folderAccessDistribution?.['read-only'] ?? 0),
    'read-write': Math.max(0, acpm.folderAccessDistribution?.['read-write'] ?? 0)
  };
  const folderTotal = sumValues([folderAccess.denied, folderAccess['read-only'], folderAccess['read-write']]);
  const toolStatusRows = (acpm.toolCategoryStatus ?? []).map((item) => {
    return `
      <div class="status-row">
        <span class="status-dot ${item.enabled ? 'enabled' : 'disabled'}">●</span>
        <span class="status-label">${escapeHtml(item.category)}</span>
        <span class="status-value">${item.enabled ? 'on' : 'off'}</span>
      </div>
    `;
  }).join('');

  const deniedBars = deniedCategories.length > 0
    ? deniedCategories.map((entry) => {
        const maxDenied = Math.max(1, ...deniedCategories.map((item) => item.count));
        const width = (entry.count / maxDenied) * 100;
        return `
          <div class="bar-row">
            <div class="bar-head">
              <span class="bar-label">${escapeHtml(entry.category)}</span>
              <span class="bar-value">${escapeHtml(formatNumber(entry.count))}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${formatPercent(width)}; background:var(--vscode-chart-red, var(--vscode-foreground))"></div>
            </div>
          </div>
        `;
      }).join('')
    : renderEmpty('No denied categories');

  const folderBars = folderTotal > 0
    ? `
      <div class="stacked-bar" aria-label="Folder access distribution">
        <span class="stack-segment" style="width:${formatPercent((folderAccess.denied / folderTotal) * 100)}; background:var(--vscode-chart-red, var(--vscode-foreground))"></span>
        <span class="stack-segment" style="width:${formatPercent((folderAccess['read-only'] / folderTotal) * 100)}; background:var(--vscode-chart-yellow, var(--vscode-foreground))"></span>
        <span class="stack-segment" style="width:${formatPercent((folderAccess['read-write'] / folderTotal) * 100)}; background:var(--vscode-chart-green, var(--vscode-foreground))"></span>
      </div>
      <div class="stack-legend">
        <span>Denied ${escapeHtml(formatNumber(folderAccess.denied))}</span>
        <span>Read-only ${escapeHtml(formatNumber(folderAccess['read-only']))}</span>
        <span>Read-write ${escapeHtml(formatNumber(folderAccess['read-write']))}</span>
      </div>
    `
    : renderEmpty('No folder access data');

  return `
    <div class="acpm-header">
      <div class="acpm-preset">${escapeHtml(presetName)}</div>
      <div class="acpm-counts">
        <span>✅ ${escapeHtml(formatNumber(acpm.allowCount ?? 0))}</span>
        <span>🚫 ${escapeHtml(formatNumber(acpm.denyCount ?? 0))}</span>
        <span>🧹 ${escapeHtml(formatNumber(acpm.sanitizeCount ?? 0))}</span>
      </div>
    </div>
    <div class="acpm-block">
      <div class="subheading">Denied categories</div>
      ${deniedBars}
    </div>
    <div class="acpm-block">
      <div class="subheading">Folder access</div>
      ${folderBars}
    </div>
    <div class="acpm-block">
      <div class="subheading">Tool categories</div>
      <div class="status-list">${toolStatusRows || renderEmpty('No tool category data')}</div>
    </div>
  `;
}

function renderDocumentHtml(snapshot: MetricsSnapshot | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contexty Dashboard</title>
  <style>
    :root {
      color-scheme: light dark;
      --panel-gap: 8px;
      --panel-padding: 10px;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-font-family, sans-serif);
    }
    body {
      padding: 10px;
    }
    main {
      display: grid;
      gap: 10px;
    }
    .section {
      padding: var(--panel-padding);
      border: 1px solid var(--vscode-descriptionForeground);
      border-radius: 8px;
      background: var(--vscode-sideBar-background);
      overflow: hidden;
    }
    .section h2 {
      margin: 0 0 8px;
      color: var(--vscode-foreground);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .section-content {
      color: var(--vscode-sideBar-foreground);
      font-size: 12px;
      line-height: 1.35;
    }
    .empty-state {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 4px 0;
    }
    .gauge-shell {
      display: grid;
      gap: 8px;
    }
    .gauge {
      width: 100%;
      height: auto;
      display: block;
    }
    .gauge-core {
      fill: var(--vscode-sideBar-background);
      stroke: var(--vscode-descriptionForeground);
      stroke-opacity: 0.25;
    }
    .gauge-total {
      fill: var(--vscode-foreground);
      font-size: 18px;
      font-weight: 700;
    }
    .gauge-label {
      fill: var(--vscode-descriptionForeground);
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .metric-stack,
    .acpm-block,
    .bar-list,
    .status-list {
      display: grid;
      gap: 6px;
    }
    .metric-row,
    .bar-head,
    .status-row,
    .acpm-header,
    .stack-legend,
    .acpm-counts {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .metric-name,
    .subheading,
    .bar-label,
    .status-label {
      min-width: 0;
      color: var(--vscode-foreground);
    }
    .metric-value,
    .bar-value,
    .status-value,
    .metric-meta {
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .legend-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 8px;
      margin-top: 4px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--vscode-descriptionForeground);
      min-width: 0;
    }
    .legend-swatch {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex: 0 0 auto;
    }
    .bar-row {
      display: grid;
      gap: 4px;
    }
    .bar-track,
    .stacked-bar {
      width: 100%;
      height: 6px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--vscode-descriptionForeground);
      background-opacity: 0.15;
    }
    .bar-fill {
      height: 100%;
      border-radius: 999px;
    }
    .bar-fill-tool {
      display: flex;
      overflow: hidden;
      background: transparent;
    }
    .bar-fill-success {
      height: 100%;
      background: var(--vscode-chart-green, var(--vscode-foreground));
    }
    .bar-fill-neutral {
      height: 100%;
      background: var(--vscode-descriptionForeground);
      opacity: 0.35;
    }
    .bar-fill-fail {
      height: 100%;
      background: var(--vscode-chart-red, var(--vscode-foreground));
    }
    .bar-subtle,
    .overflow-note {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .section-badge {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      margin-bottom: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .stacked-bar {
      display: flex;
      background: transparent;
    }
    .stack-segment {
      height: 100%;
      display: block;
    }
    .stack-legend {
      flex-wrap: wrap;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .acpm-header {
      align-items: flex-start;
      flex-direction: column;
    }
    .acpm-preset {
      color: var(--vscode-foreground);
      font-size: 13px;
      font-weight: 700;
      word-break: break-word;
    }
    .acpm-counts {
      width: 100%;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      flex-wrap: wrap;
    }
    .status-row {
      padding: 2px 0;
    }
    .status-dot {
      display: inline-flex;
      width: 1em;
      justify-content: center;
      font-size: 11px;
      line-height: 1;
    }
    .status-dot.enabled {
      color: var(--vscode-chart-green, var(--vscode-foreground));
    }
    .status-dot.disabled {
      color: var(--vscode-chart-red, var(--vscode-foreground));
    }
    .bar-count {
      color: var(--vscode-descriptionForeground);
      font-weight: 400;
    }
  </style>
</head>
<body>
  <main>
    <section class="section">
      <h2>Context Gauge</h2>
      <div id="metrics-context" class="section-content">${renderContextGauge(snapshot?.tokens ?? null)}</div>
    </section>
    <section class="section">
      <h2>File Breakdown</h2>
      <div id="metrics-files" class="section-content">${renderFileBreakdown(snapshot?.files ?? null)}</div>
    </section>
    <section class="section">
      <h2>Tool Frequency</h2>
      <div id="metrics-tools" class="section-content">${renderToolFrequency(snapshot?.tools ?? null)}</div>
    </section>
    <section class="section">
      <h2>ACPM Status</h2>
      <div id="metrics-acpm" class="section-content">${renderAcpmStatus(snapshot?.acpm ?? null)}</div>
    </section>
  </main>
  <script>
    const initialSnapshot = ${JSON.stringify(snapshot)};
    const targets = {
      context: document.getElementById('metrics-context'),
      files: document.getElementById('metrics-files'),
      tools: document.getElementById('metrics-tools'),
      acpm: document.getElementById('metrics-acpm')
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatNumber(value) {
      if (value >= 1000000) {
        return (value / 1000000).toFixed(1) + 'M';
      }
      if (value >= 1000) {
        return (value / 1000).toFixed(1) + 'k';
      }
      return String(Math.round(value));
    }

    function truncatePath(filePath) {
      const parts = String(filePath).replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.length <= 2) {
        return parts.join('/');
      }
      return parts.slice(-2).join('/');
    }

    function renderEmpty(message) {
      return '<div class="empty-state">' + escapeHtml(message) + '</div>';
    }

    function renderContextGauge(tokens) {
      if (!tokens) {
        return renderEmpty('No token data');
      }
      const input = Math.max(0, tokens.input || 0);
      const output = Math.max(0, tokens.output || 0);
      const reasoning = Math.max(0, tokens.reasoning || 0);
      const cacheRead = Math.max(0, tokens.cacheRead || 0);
      const cacheWrite = Math.max(0, tokens.cacheWrite || 0);
      const total = input + output + reasoning;
      const radius = 52;
      const circumference = Math.PI * radius;
      const arc = 'M 68 120 A 52 52 0 0 1 172 120';
      const segments = [
        { value: input, color: 'var(--vscode-chart-blue, var(--vscode-foreground))', label: 'input' },
        { value: output, color: 'var(--vscode-chart-green, var(--vscode-foreground))', label: 'output' },
        { value: reasoning, color: 'var(--vscode-chart-yellow, var(--vscode-foreground))', label: 'reasoning' }
      ];
      let dashOffset = 0;
      const strokeSegments = segments.map((segment) => {
        const segmentLength = total > 0 ? circumference * (segment.value / total) : 0;
        const markup = '<path d="' + arc + '" pathLength="' + circumference + '" fill="none" stroke="' + segment.color + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + segmentLength + ' ' + circumference + '" stroke-dashoffset="' + dashOffset + '" />';
        dashOffset -= segmentLength;
        return markup;
      }).join('');
      const legend = segments.map((segment) => {
        return '<div class="legend-item"><span class="legend-swatch" style="background:' + segment.color + '"></span><span>' + escapeHtml(segment.label) + ' ' + escapeHtml(formatNumber(segment.value)) + '</span></div>';
      }).join('');
      return [
        '<div class="gauge-shell">',
        '<svg class="gauge" viewBox="0 0 240 150" role="img" aria-label="Token distribution gauge">',
        '<path d="' + arc + '" fill="none" stroke="var(--vscode-descriptionForeground)" stroke-opacity="0.25" stroke-width="10" stroke-linecap="round" />',
        strokeSegments,
        '<circle cx="120" cy="120" r="34" class="gauge-core" />',
        '<text x="120" y="116" text-anchor="middle" class="gauge-total">' + escapeHtml(formatNumber(total)) + '</text>',
        '<text x="120" y="132" text-anchor="middle" class="gauge-label">tokens</text>',
        '</svg>',
        '<div class="metric-stack">',
        '<div class="metric-row"><span class="metric-name">Input</span><span class="metric-value">' + escapeHtml(formatNumber(input)) + '</span></div>',
        '<div class="metric-row"><span class="metric-name">Output</span><span class="metric-value">' + escapeHtml(formatNumber(output)) + '</span></div>',
        '<div class="metric-row"><span class="metric-name">Reasoning</span><span class="metric-value">' + escapeHtml(formatNumber(reasoning)) + '</span></div>',
        '<div class="metric-meta">Cache read ' + escapeHtml(formatNumber(cacheRead)) + ' / write ' + escapeHtml(formatNumber(cacheWrite)) + '</div>',
        '<div class="legend-grid">' + legend + '</div>',
        '</div>',
        '</div>'
      ].join('');
    }

    function renderFileBreakdown(files) {
      if (!files || !files.length) {
        return renderEmpty('No file data');
      }
      const sorted = files.slice().sort((a, b) => (b.tokenEstimate || 0) - (a.tokenEstimate || 0));
      const visible = sorted.slice(0, 10);
      const remaining = sorted.length - visible.length;
      const maxTokens = Math.max.apply(null, [1].concat(visible.map((file) => Math.max(0, file.tokenEstimate || 0))));
      const palette = [
        'var(--vscode-chart-blue, var(--vscode-foreground))',
        'var(--vscode-chart-green, var(--vscode-foreground))',
        'var(--vscode-chart-yellow, var(--vscode-foreground))',
        'var(--vscode-chart-red, var(--vscode-foreground))'
      ];
      const rows = visible.map((file, index) => {
        const value = Math.max(0, file.tokenEstimate || 0);
        const width = (value / maxTokens) * 100;
        const color = palette[index % palette.length];
        return [
          '<div class="bar-row">',
          '<div class="bar-head"><span class="bar-label" title="' + escapeHtml(file.path) + '">' + escapeHtml(truncatePath(file.path)) + '</span><span class="bar-value">' + escapeHtml(formatNumber(value)) + '</span></div>',
          '<div class="bar-track"><div class="bar-fill" style="width:' + width.toFixed(1) + '%; background:' + color + '"></div></div>',
          '<div class="bar-subtle">estimate</div>',
          '</div>'
        ].join('');
      }).join('');
      const overflow = remaining > 0 ? '<div class="overflow-note">and ' + escapeHtml(formatNumber(remaining)) + ' more...</div>' : '';
      return '<div class="section-badge">estimate</div><div class="bar-list">' + rows + '</div>' + overflow;
    }

    function renderToolFrequency(tools) {
      if (!tools || !tools.length) {
        return renderEmpty('No tool data');
      }
      const sorted = tools.slice().sort((a, b) => (b.count || 0) - (a.count || 0));
      const maxCount = Math.max.apply(null, [1].concat(sorted.map((tool) => Math.max(0, tool.count || 0))));
      return '<div class="bar-list">' + sorted.map((tool) => {
        const count = Math.max(0, tool.count || 0);
        const success = Math.max(0, tool.successCount || 0);
        const fail = Math.max(0, tool.failCount || 0);
        const width = (count / maxCount) * 100;
        const successShare = count > 0 ? Math.max(0, Math.min(100, success / count * 100)) : 0;
        const failShare = count > 0 ? Math.max(0, Math.min(100, fail / count * 100)) : 0;
        const neutralShare = Math.max(0, 100 - successShare - failShare);
        return [
          '<div class="bar-row">',
          '<div class="bar-head"><span class="bar-label">' + escapeHtml(tool.name) + ' <span class="bar-count">(' + escapeHtml(formatNumber(count)) + ')</span></span><span class="bar-value">' + escapeHtml(formatNumber(success)) + ' ok / ' + escapeHtml(formatNumber(fail)) + ' fail</span></div>',
          '<div class="bar-track"><div class="bar-fill bar-fill-tool" style="width:' + width.toFixed(1) + '%"><span class="bar-fill-success" style="width:' + successShare.toFixed(1) + '%"></span><span class="bar-fill-neutral" style="width:' + neutralShare.toFixed(1) + '%"></span><span class="bar-fill-fail" style="width:' + failShare.toFixed(1) + '%"></span></div></div>',
          '</div>'
        ].join('');
      }).join('') + '</div>';
    }

    function renderAcpmStatus(acpm) {
      if (!acpm) {
        return renderEmpty('No ACPM data');
      }
      const presetName = acpm.activePreset ? acpm.activePreset : 'No active preset';
      const deniedCategories = Object.entries(acpm.deniedByCategory || {})
        .map(([category, count]) => ({ category, count: Math.max(0, count || 0) }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count);
      const folderAccess = {
        denied: Math.max(0, (acpm.folderAccessDistribution && acpm.folderAccessDistribution.denied) || 0),
        'read-only': Math.max(0, (acpm.folderAccessDistribution && acpm.folderAccessDistribution['read-only']) || 0),
        'read-write': Math.max(0, (acpm.folderAccessDistribution && acpm.folderAccessDistribution['read-write']) || 0)
      };
      const folderTotal = folderAccess.denied + folderAccess['read-only'] + folderAccess['read-write'];
      const deniedBars = deniedCategories.length > 0 ? deniedCategories.map((entry) => {
        const maxDenied = Math.max.apply(null, [1].concat(deniedCategories.map((item) => item.count)));
        const width = entry.count / maxDenied * 100;
        return [
          '<div class="bar-row">',
          '<div class="bar-head"><span class="bar-label">' + escapeHtml(entry.category) + '</span><span class="bar-value">' + escapeHtml(formatNumber(entry.count)) + '</span></div>',
          '<div class="bar-track"><div class="bar-fill" style="width:' + width.toFixed(1) + '%; background:var(--vscode-chart-red, var(--vscode-foreground))"></div></div>',
          '</div>'
        ].join('');
      }).join('') : renderEmpty('No denied categories');
      const folderBars = folderTotal > 0 ? [
        '<div class="stacked-bar" aria-label="Folder access distribution">',
        '<span class="stack-segment" style="width:' + (folderAccess.denied / folderTotal * 100).toFixed(1) + '%; background:var(--vscode-chart-red, var(--vscode-foreground))"></span>',
        '<span class="stack-segment" style="width:' + (folderAccess['read-only'] / folderTotal * 100).toFixed(1) + '%; background:var(--vscode-chart-yellow, var(--vscode-foreground))"></span>',
        '<span class="stack-segment" style="width:' + (folderAccess['read-write'] / folderTotal * 100).toFixed(1) + '%; background:var(--vscode-chart-green, var(--vscode-foreground))"></span>',
        '</div>',
        '<div class="stack-legend"><span>Denied ' + escapeHtml(formatNumber(folderAccess.denied)) + '</span><span>Read-only ' + escapeHtml(formatNumber(folderAccess['read-only'])) + '</span><span>Read-write ' + escapeHtml(formatNumber(folderAccess['read-write'])) + '</span></div>'
      ].join('') : renderEmpty('No folder access data');
      const toolStatusRows = (acpm.toolCategoryStatus || []).map((item) => {
        return '<div class="status-row"><span class="status-dot ' + (item.enabled ? 'enabled' : 'disabled') + '">●</span><span class="status-label">' + escapeHtml(item.category) + '</span><span class="status-value">' + (item.enabled ? 'on' : 'off') + '</span></div>';
      }).join('');
      return [
        '<div class="acpm-header"><div class="acpm-preset">' + escapeHtml(presetName) + '</div><div class="acpm-counts"><span>✅ ' + escapeHtml(formatNumber(acpm.allowCount || 0)) + '</span><span>🚫 ' + escapeHtml(formatNumber(acpm.denyCount || 0)) + '</span><span>🧹 ' + escapeHtml(formatNumber(acpm.sanitizeCount || 0)) + '</span></div></div>',
        '<div class="acpm-block"><div class="subheading">Denied categories</div>' + deniedBars + '</div>',
        '<div class="acpm-block"><div class="subheading">Folder access</div>' + folderBars + '</div>',
        '<div class="acpm-block"><div class="subheading">Tool categories</div><div class="status-list">' + (toolStatusRows || renderEmpty('No tool category data')) + '</div></div>'
      ].join('');
    }

    function applySnapshot(snapshot) {
      const data = snapshot || {};
      if (targets.context) { targets.context.innerHTML = renderContextGauge(data.tokens || null); }
      if (targets.files) { targets.files.innerHTML = renderFileBreakdown(data.files || null); }
      if (targets.tools) { targets.tools.innerHTML = renderToolFrequency(data.tools || null); }
      if (targets.acpm) { targets.acpm.innerHTML = renderAcpmStatus(data.acpm || null); }
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'update') {
        return;
      }
      applySnapshot(message.data || null);
    });

    applySnapshot(initialSnapshot);
  </script>
</body>
</html>`;
}

export function renderDashboard(snapshot: MetricsSnapshot | null): string {
  return renderDocumentHtml(snapshot);
}
