export function renderAdminConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Meow Admin Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f4f1eb;
      --bg-soft: #ece7dd;
      --panel: #fdfbf7;
      --panel-strong: #fffefb;
      --line: #d7cebf;
      --text: #1f1b17;
      --text-muted: #675f53;
      --accent: #2f5d50;
      --accent-soft: #e8f0ec;
      --success: #2c6a4d;
      --danger: #9b3f3a;
      --warn: #8b641b;
      --radius: 18px;
      --shadow: 0 24px 60px -40px rgba(31, 27, 23, 0.44);
      --shadow-soft: 0 10px 30px -22px rgba(31, 27, 23, 0.35);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      color: var(--text);
      background:
        radial-gradient(1200px 500px at 10% -10%, #f9f6f1 0%, transparent 60%),
        radial-gradient(1000px 600px at 100% 0%, #e9e4d9 0%, transparent 70%),
        var(--bg);
      font-family: 'Manrope', sans-serif;
      line-height: 1.45;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .page {
      width: min(1200px, calc(100% - 2.2rem));
      margin: 1.4rem auto 3rem;
      display: grid;
      gap: 1rem;
    }

    .topbar {
      position: sticky;
      top: 0.8rem;
      z-index: 20;
      backdrop-filter: blur(6px);
      border: 1px solid color-mix(in srgb, var(--line) 88%, white 12%);
      background: color-mix(in srgb, var(--panel-strong) 92%, transparent 8%);
      border-radius: calc(var(--radius) + 4px);
      box-shadow: var(--shadow-soft);
      padding: 1rem 1.1rem;
      display: grid;
      gap: 0.9rem;
    }

    .topbar-row {
      display: flex;
      gap: 0.7rem;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .brand {
      display: grid;
      gap: 0.18rem;
    }

    .brand h1 {
      margin: 0;
      font-family: 'Fraunces', serif;
      letter-spacing: 0.01em;
      font-size: clamp(1.35rem, 2vw, 1.85rem);
      font-weight: 700;
    }

    .brand p {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    .status-cluster {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      flex-wrap: wrap;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 33px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text-muted);
      padding: 0.24rem 0.78rem;
      font-size: 0.81rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      transition: all 0.25s ease;
    }

    .chip.connected {
      border-color: color-mix(in srgb, var(--success) 35%, var(--line));
      color: var(--success);
      background: color-mix(in srgb, var(--success) 11%, white 89%);
    }

    .chip.qr_ready,
    .chip.disconnected {
      border-color: color-mix(in srgb, var(--warn) 32%, var(--line));
      color: var(--warn);
      background: color-mix(in srgb, var(--warn) 12%, white 88%);
    }

    .chip.error,
    .chip.unavailable {
      border-color: color-mix(in srgb, var(--danger) 38%, var(--line));
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, white 90%);
    }

    .nav {
      display: flex;
      gap: 0.45rem;
      flex-wrap: wrap;
    }

    .nav a {
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 0.42rem 0.75rem;
      border-radius: 999px;
      font-size: 0.83rem;
      font-weight: 600;
      transition: all 0.2s ease;
    }

    .nav a:hover {
      border-color: var(--line);
      color: var(--text);
      background: var(--panel);
    }

    .notice {
      border-radius: 14px;
      border: 1px solid var(--line);
      padding: 0.75rem 0.9rem;
      font-size: 0.88rem;
      color: var(--text);
      background: var(--panel);
      display: none;
    }

    .notice.show {
      display: block;
      animation: rise 320ms ease both;
    }

    .notice.success {
      border-color: color-mix(in srgb, var(--success) 34%, var(--line));
      background: color-mix(in srgb, var(--success) 11%, white 89%);
      color: var(--success);
    }

    .notice.error {
      border-color: color-mix(in srgb, var(--danger) 34%, var(--line));
      background: color-mix(in srgb, var(--danger) 10%, white 90%);
      color: var(--danger);
    }

    .sections {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 1rem;
    }

    .panel {
      grid-column: 1 / -1;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: linear-gradient(180deg, var(--panel-strong), var(--panel));
      box-shadow: var(--shadow);
      padding: 1rem;
      display: grid;
      gap: 0.9rem;
      opacity: 0;
      transform: translateY(12px);
      animation: rise 560ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    }

    .panel:nth-of-type(2) {
      animation-delay: 70ms;
    }

    .panel:nth-of-type(3) {
      animation-delay: 120ms;
    }

    .panel:nth-of-type(4) {
      animation-delay: 170ms;
    }

    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 0.8rem;
      flex-wrap: wrap;
    }

    .panel-head h2 {
      margin: 0;
      font-family: 'Fraunces', serif;
      font-size: clamp(1.05rem, 1.7vw, 1.4rem);
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    .panel-head p {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    .grid {
      display: grid;
      gap: 0.8rem;
      grid-template-columns: repeat(12, minmax(0, 1fr));
    }

    .tile {
      grid-column: span 12;
      border-radius: 14px;
      border: 1px solid color-mix(in srgb, var(--line) 88%, white 12%);
      background: color-mix(in srgb, var(--panel-strong) 92%, white 8%);
      padding: 0.95rem;
      display: grid;
      gap: 0.75rem;
    }

    .tile h3 {
      margin: 0;
      font-size: 0.9rem;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--text-muted);
      font-weight: 700;
    }

    .stat-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.6rem;
    }

    .stat {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 0.65rem 0.7rem;
      background: var(--panel);
      display: grid;
      gap: 0.3rem;
    }

    .stat .label {
      color: var(--text-muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 700;
    }

    .stat .value {
      font-size: 0.93rem;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    form,
    .stack {
      display: grid;
      gap: 0.65rem;
    }

    .row {
      display: grid;
      gap: 0.62rem;
      grid-template-columns: repeat(12, minmax(0, 1fr));
    }

    .field {
      grid-column: span 12;
      display: grid;
      gap: 0.32rem;
    }

    .field.inline {
      grid-auto-flow: column;
      justify-content: start;
      align-items: center;
      gap: 0.45rem;
    }

    label {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      font-weight: 700;
    }

    input,
    textarea,
    select,
    button {
      font: inherit;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--panel-strong);
      color: var(--text);
      min-height: 38px;
      padding: 0.58rem 0.7rem;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
    }

    textarea {
      min-height: 95px;
      resize: vertical;
    }

    input:focus,
    textarea:focus,
    select:focus,
    button:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-soft) 70%, white 30%);
    }

    .btn-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    button {
      cursor: pointer;
      font-weight: 600;
      background: color-mix(in srgb, var(--panel-strong) 80%, white 20%);
    }

    button.primary {
      border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
      background: color-mix(in srgb, var(--accent) 12%, white 88%);
      color: color-mix(in srgb, var(--accent) 84%, black 16%);
    }

    button.ghost {
      background: transparent;
    }

    button:hover {
      transform: translateY(-1px);
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .meta {
      font-size: 0.79rem;
      color: var(--text-muted);
      margin: 0;
    }

    .table-wrap {
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: auto;
      background: var(--panel);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 620px;
      font-size: 0.84rem;
    }

    th,
    td {
      padding: 0.58rem 0.62rem;
      border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, white 30%);
      text-align: left;
      vertical-align: top;
    }

    th {
      font-size: 0.73rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      font-weight: 700;
      background: color-mix(in srgb, var(--bg-soft) 50%, white 50%);
      position: sticky;
      top: 0;
      z-index: 1;
    }

    tbody tr:hover {
      background: color-mix(in srgb, var(--accent-soft) 35%, white 65%);
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    }

    .qr-box {
      border: 1px dashed color-mix(in srgb, var(--line) 85%, white 15%);
      border-radius: 12px;
      min-height: 220px;
      background: var(--panel);
      display: grid;
      place-items: center;
      overflow: hidden;
    }

    .qr-box img {
      width: min(100%, 280px);
      height: auto;
      object-fit: contain;
      display: block;
    }

    .log-shell {
      border: 1px solid #2f2a22;
      border-radius: 12px;
      background: #1f1d1a;
      color: #e8e1d6;
      min-height: 280px;
      max-height: 460px;
      overflow: auto;
      padding: 0.65rem;
      display: grid;
      gap: 0.2rem;
    }

    .log-line {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.77rem;
      line-height: 1.45;
      padding: 0.12rem 0;
    }

    .level-error {
      color: #f1a7a1;
    }

    .level-warn {
      color: #e9c98e;
    }

    .level-info {
      color: #b8d7c8;
    }

    .level-debug,
    .level-verbose {
      color: #d5cfc4;
      opacity: 0.94;
    }

    .text-danger {
      color: var(--danger);
    }

    .text-success {
      color: var(--success);
    }

    .muted {
      color: var(--text-muted);
    }

    @media (min-width: 860px) {
      .tile.w4 {
        grid-column: span 4;
      }

      .tile.w6 {
        grid-column: span 6;
      }

      .tile.w8 {
        grid-column: span 8;
      }
    }

    @media (max-width: 780px) {
      .page {
        width: min(1200px, calc(100% - 1.2rem));
      }

      .topbar {
        top: 0.5rem;
      }

      table {
        min-width: 560px;
      }

      .stat-list {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
      }
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="topbar">
      <div class="topbar-row">
        <div class="brand">
          <h1>Meow Admin Console</h1>
          <p>Operational control center for bot runtime, configuration, and telemetry.</p>
        </div>
        <div class="status-cluster">
          <span id="connectionBadge" class="chip">Checking status</span>
          <button id="refreshAllBtn" class="primary" type="button">Refresh All</button>
        </div>
      </div>
      <nav class="nav" aria-label="Section Navigation">
        <a href="#overview">Overview</a>
        <a href="#analytics">Analytics</a>
        <a href="#configuration">Configuration</a>
        <a href="#logs">Logs</a>
      </nav>
      <div id="globalNotice" class="notice" role="status" aria-live="polite"></div>
    </header>

    <main class="sections">
      <section id="overview" class="panel">
        <div class="panel-head">
          <h2>Overview</h2>
          <p>Live status, QR authentication, and outbound message dispatch.</p>
        </div>
        <div class="grid">
          <article class="tile w4">
            <h3>Runtime Status</h3>
            <div class="stat-list">
              <div class="stat">
                <span class="label">Status</span>
                <span class="value" id="statusValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Connected</span>
                <span class="value" id="connectedValue">-</span>
              </div>
              <div class="stat">
                <span class="label">QR Ready</span>
                <span class="value" id="qrValue">-</span>
              </div>
              <div class="stat">
                <span class="label">Bot User</span>
                <span class="value mono" id="userValue">-</span>
              </div>
            </div>
            <div class="btn-row">
              <button id="refreshStatusBtn" class="ghost" type="button">Refresh Status</button>
            </div>
          </article>

          <article class="tile w4">
            <h3>QR Authentication</h3>
            <div class="qr-box">
              <img id="qrImage" alt="QR Code" />
            </div>
            <p class="meta" id="qrState">Waiting for data.</p>
            <div class="btn-row">
              <button id="refreshQrBtn" type="button">Refresh QR</button>
              <button id="toggleQrStreamBtn" class="primary" type="button">Start Live QR</button>
            </div>
          </article>

          <article class="tile w4">
            <h3>Send Message</h3>
            <form id="messageForm">
              <div class="field">
                <label for="messageJid">Target JID</label>
                <input id="messageJid" name="jid" placeholder="628123456789@s.whatsapp.net" required />
              </div>
              <div class="field">
                <label for="messageText">Message</label>
                <textarea id="messageText" name="text" placeholder="Write message content" required></textarea>
              </div>
              <div class="btn-row">
                <button class="primary" type="submit">Send</button>
              </div>
            </form>
            <p class="meta" id="messageFeedback">No message sent yet.</p>
          </article>
        </div>
      </section>

      <section id="analytics" class="panel">
        <div class="panel-head">
          <h2>Analytics</h2>
          <p>Command usage and game leaderboard from existing bot data stores.</p>
        </div>
        <div class="grid">
          <article class="tile w8">
            <h3>Command Usage</h3>
            <div class="row">
              <div class="field" style="grid-column: span 8;">
                <label for="usageSearch">Filter</label>
                <input id="usageSearch" placeholder="Search command name" />
              </div>
              <div class="field" style="grid-column: span 4; align-self: end;">
                <button id="refreshUsageBtn" type="button">Reload Usage</button>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Total Calls</th>
                    <th>Unique Users</th>
                    <th>Last Used</th>
                  </tr>
                </thead>
                <tbody id="usageTableBody"></tbody>
              </table>
            </div>
            <p class="meta" id="usageMeta">No data loaded.</p>
          </article>

          <article class="tile w4">
            <h3>Leaderboard</h3>
            <div class="row">
              <div class="field" style="grid-column: span 7;">
                <label for="leaderboardGame">Game</label>
                <select id="leaderboardGame">
                  <option value="hangman">hangman</option>
                  <option value="rps">rps</option>
                </select>
              </div>
              <div class="field" style="grid-column: span 5;">
                <label for="leaderboardLimit">Rows</label>
                <input id="leaderboardLimit" type="number" min="1" max="50" value="10" />
              </div>
            </div>
            <div class="btn-row">
              <button id="refreshLeaderboardBtn" type="button">Load Leaderboard</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Score</th>
                    <th>W/L/D</th>
                    <th>Last Played</th>
                  </tr>
                </thead>
                <tbody id="leaderboardBody"></tbody>
              </table>
            </div>
            <p class="meta" id="leaderboardMeta">No leaderboard loaded.</p>
          </article>
        </div>
      </section>

      <section id="configuration" class="panel">
        <div class="panel-head">
          <h2>Configuration</h2>
          <p>Edit runtime configuration and role assignments without redeploy.</p>
        </div>
        <div class="grid">
          <article class="tile w8">
            <h3>Bot Configuration</h3>
            <form id="configForm">
              <div class="row">
                <div class="field" style="grid-column: span 6;">
                  <label for="cfgName">Bot Name</label>
                  <input id="cfgName" />
                </div>
                <div class="field" style="grid-column: span 3;">
                  <label for="cfgPrefix">Primary Prefix</label>
                  <input id="cfgPrefix" />
                </div>
                <div class="field" style="grid-column: span 3;">
                  <label for="cfgAltPrefixes">Alternative Prefixes</label>
                  <input id="cfgAltPrefixes" placeholder="/, ." />
                </div>
              </div>

              <div class="row">
                <div class="field" style="grid-column: span 4;">
                  <label for="cfgMaxSessions">Max Sessions</label>
                  <input id="cfgMaxSessions" type="number" min="1" />
                </div>
                <div class="field" style="grid-column: span 4;">
                  <label for="cfgSessionTimeout">Session Timeout (ms)</label>
                  <input id="cfgSessionTimeout" type="number" min="1000" />
                </div>
              </div>

              <div class="row">
                <div class="field inline" style="grid-column: span 4;">
                  <input id="cfgAllowFromMe" type="checkbox" />
                  <label for="cfgAllowFromMe">Allow From Me</label>
                </div>
                <div class="field inline" style="grid-column: span 4;">
                  <input id="cfgAllowMentionPrefix" type="checkbox" />
                  <label for="cfgAllowMentionPrefix">Allow Mention Prefix</label>
                </div>
                <div class="field inline" style="grid-column: span 4;">
                  <input id="cfgDisableWarning" type="checkbox" />
                  <label for="cfgDisableWarning">Disable Warning</label>
                </div>
              </div>

              <div class="row">
                <div class="field inline" style="grid-column: span 6;">
                  <input id="cfgMaintenanceMode" type="checkbox" />
                  <label for="cfgMaintenanceMode">Maintenance Mode</label>
                </div>
              </div>

              <div class="btn-row">
                <button id="saveConfigBtn" class="primary" type="submit">Save Configuration</button>
                <button id="resetConfigBtn" class="ghost" type="button">Reset to Defaults</button>
              </div>
            </form>
            <p class="meta" id="configFeedback">No changes submitted.</p>
          </article>

          <article class="tile w4">
            <h3>Role Management</h3>
            <form id="roleForm">
              <div class="field">
                <label for="roleAction">Action</label>
                <select id="roleAction">
                  <option value="add">Add</option>
                  <option value="remove">Remove</option>
                </select>
              </div>
              <div class="field">
                <label for="roleType">Role</label>
                <select id="roleType">
                  <option value="admin">admin</option>
                  <option value="moderator">moderator</option>
                  <option value="vip">vip</option>
                </select>
              </div>
              <div class="field">
                <label for="roleUserJid">User JID</label>
                <input id="roleUserJid" placeholder="628123456789@s.whatsapp.net" required />
              </div>
              <div class="btn-row">
                <button class="primary" type="submit">Apply Role Change</button>
              </div>
            </form>
            <p class="meta" id="roleFeedback">No role updates yet.</p>
          </article>
        </div>
      </section>

      <section id="logs" class="panel">
        <div class="panel-head">
          <h2>Logs</h2>
          <p>Live and historical bot logs from the in-memory log buffer.</p>
        </div>
        <div class="grid">
          <article class="tile w12" style="grid-column: 1 / -1;">
            <div class="row">
              <div class="field" style="grid-column: span 3;">
                <label for="logLevel">Level</label>
                <select id="logLevel">
                  <option value="all">all</option>
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                  <option value="debug">debug</option>
                  <option value="verbose">verbose</option>
                </select>
              </div>
              <div class="field" style="grid-column: span 5;">
                <label for="logQuery">Search</label>
                <input id="logQuery" placeholder="Filter log message" />
              </div>
              <div class="field" style="grid-column: span 4; align-self: end;">
                <div class="btn-row">
                  <button id="refreshLogsBtn" type="button">Refresh Logs</button>
                  <button id="toggleLogStreamBtn" class="primary" type="button">Start Live Logs</button>
                </div>
              </div>
            </div>
            <div class="btn-row">
              <button id="clearLogViewBtn" class="ghost" type="button">Clear View</button>
              <button id="clearLogBufferBtn" class="ghost" type="button">Clear Buffer</button>
            </div>
            <div id="logsOutput" class="log-shell" role="log" aria-live="polite"></div>
            <p class="meta" id="logsMeta">No logs loaded.</p>
          </article>
        </div>
      </section>
    </main>
  </div>

  <script>
    (() => {
      const state = {
        qrEventSource: null,
        logEventSource: null,
        commandUsageRaw: [],
        currentQrObjectUrl: '',
        autoRefreshTimer: null,
      };

      const ui = {
        globalNotice: document.getElementById('globalNotice'),
        connectionBadge: document.getElementById('connectionBadge'),
        refreshAllBtn: document.getElementById('refreshAllBtn'),

        statusValue: document.getElementById('statusValue'),
        connectedValue: document.getElementById('connectedValue'),
        qrValue: document.getElementById('qrValue'),
        userValue: document.getElementById('userValue'),
        refreshStatusBtn: document.getElementById('refreshStatusBtn'),

        qrImage: document.getElementById('qrImage'),
        qrState: document.getElementById('qrState'),
        refreshQrBtn: document.getElementById('refreshQrBtn'),
        toggleQrStreamBtn: document.getElementById('toggleQrStreamBtn'),

        messageForm: document.getElementById('messageForm'),
        messageJid: document.getElementById('messageJid'),
        messageText: document.getElementById('messageText'),
        messageFeedback: document.getElementById('messageFeedback'),

        usageSearch: document.getElementById('usageSearch'),
        usageTableBody: document.getElementById('usageTableBody'),
        usageMeta: document.getElementById('usageMeta'),
        refreshUsageBtn: document.getElementById('refreshUsageBtn'),

        leaderboardGame: document.getElementById('leaderboardGame'),
        leaderboardLimit: document.getElementById('leaderboardLimit'),
        refreshLeaderboardBtn: document.getElementById('refreshLeaderboardBtn'),
        leaderboardBody: document.getElementById('leaderboardBody'),
        leaderboardMeta: document.getElementById('leaderboardMeta'),

        configForm: document.getElementById('configForm'),
        cfgName: document.getElementById('cfgName'),
        cfgPrefix: document.getElementById('cfgPrefix'),
        cfgAltPrefixes: document.getElementById('cfgAltPrefixes'),
        cfgMaxSessions: document.getElementById('cfgMaxSessions'),
        cfgSessionTimeout: document.getElementById('cfgSessionTimeout'),
        cfgAllowFromMe: document.getElementById('cfgAllowFromMe'),
        cfgAllowMentionPrefix: document.getElementById('cfgAllowMentionPrefix'),
        cfgDisableWarning: document.getElementById('cfgDisableWarning'),
        cfgMaintenanceMode: document.getElementById('cfgMaintenanceMode'),
        resetConfigBtn: document.getElementById('resetConfigBtn'),
        configFeedback: document.getElementById('configFeedback'),

        roleForm: document.getElementById('roleForm'),
        roleAction: document.getElementById('roleAction'),
        roleType: document.getElementById('roleType'),
        roleUserJid: document.getElementById('roleUserJid'),
        roleFeedback: document.getElementById('roleFeedback'),

        logLevel: document.getElementById('logLevel'),
        logQuery: document.getElementById('logQuery'),
        refreshLogsBtn: document.getElementById('refreshLogsBtn'),
        toggleLogStreamBtn: document.getElementById('toggleLogStreamBtn'),
        clearLogViewBtn: document.getElementById('clearLogViewBtn'),
        clearLogBufferBtn: document.getElementById('clearLogBufferBtn'),
        logsOutput: document.getElementById('logsOutput'),
        logsMeta: document.getElementById('logsMeta'),
      };

      let noticeTimer = 0;

      function showNotice(message, kind) {
        if (!ui.globalNotice) return;
        window.clearTimeout(noticeTimer);
        ui.globalNotice.className = 'notice show';
        if (kind === 'success') ui.globalNotice.classList.add('success');
        if (kind === 'error') ui.globalNotice.classList.add('error');
        ui.globalNotice.textContent = message;
        noticeTimer = window.setTimeout(() => {
          ui.globalNotice.className = 'notice';
          ui.globalNotice.textContent = '';
        }, 4600);
      }

      function setText(node, value) {
        if (node) node.textContent = String(value);
      }

      function setChip(status) {
        if (!ui.connectionBadge) return;
        ui.connectionBadge.className = 'chip';
        if (status) ui.connectionBadge.classList.add(status);
        const labels = {
          connected: 'Connected',
          qr_ready: 'QR Ready',
          disconnected: 'Disconnected',
          unavailable: 'Unavailable',
          error: 'Error',
        };
        setText(ui.connectionBadge, labels[status] || status || 'Unknown');
      }

      function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString();
      }

      function readJsonError(payload, fallback) {
        if (payload && typeof payload === 'object' && payload.error) {
          return String(payload.error);
        }
        return fallback;
      }

      async function api(path, options) {
        const opts = Object.assign({}, options || {});
        const headers = Object.assign({}, opts.headers || {});

        if (opts.body && typeof opts.body !== 'string') {
          headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(opts.body);
        }

        opts.headers = headers;

        const response = await fetch(path, opts);
        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const payload = isJson
          ? await response.json().catch(() => null)
          : await response.text().catch(() => '');

        if (!response.ok) {
          throw new Error(readJsonError(payload, 'Request failed') + ' (' + response.status + ')');
        }

        return payload;
      }

      async function loadStatus() {
        const data = await api('/api/status');
        setText(ui.statusValue, data.status || '-');
        setText(ui.connectedValue, data.connected ? 'yes' : 'no');
        setText(ui.qrValue, data.hasQR ? 'yes' : 'no');
        setText(ui.userValue, data.user && data.user.id ? data.user.id : '-');
        setChip(data.status || 'unavailable');
      }

      function clearQrObjectUrl() {
        if (state.currentQrObjectUrl) {
          URL.revokeObjectURL(state.currentQrObjectUrl);
          state.currentQrObjectUrl = '';
        }
      }

      async function loadQrImage() {
        const response = await fetch('/api/qr?ts=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) {
          clearQrObjectUrl();
          if (ui.qrImage) ui.qrImage.removeAttribute('src');
          setText(ui.qrState, 'No active QR code.');
          return;
        }

        const blob = await response.blob();
        clearQrObjectUrl();
        state.currentQrObjectUrl = URL.createObjectURL(blob);
        if (ui.qrImage) ui.qrImage.src = state.currentQrObjectUrl;
        setText(ui.qrState, 'QR code available.');
      }

      function stopQrStream() {
        if (state.qrEventSource) {
          state.qrEventSource.close();
          state.qrEventSource = null;
        }
        if (ui.toggleQrStreamBtn) {
          ui.toggleQrStreamBtn.textContent = 'Start Live QR';
        }
      }

      function startQrStream() {
        stopQrStream();
        const source = new EventSource('/api/qr/stream');
        state.qrEventSource = source;

        if (ui.toggleQrStreamBtn) {
          ui.toggleQrStreamBtn.textContent = 'Stop Live QR';
        }

        source.onmessage = async (event) => {
          try {
            const payload = JSON.parse(event.data || '{}');
            if (payload.type === 'new_qr' || payload.type === 'status' || payload.type === 'connected' || payload.type === 'disconnected') {
              await loadStatus();
              await loadQrImage();
            }
          } catch (_) {
            // Ignore malformed events
          }
        };

        source.onerror = () => {
          stopQrStream();
          showNotice('QR live stream disconnected.', 'error');
        };
      }

      function aggregateUsage(rows) {
        const map = new Map();
        rows.forEach((row) => {
          const command = row && row.command ? String(row.command) : 'unknown';
          const count = Number(row && row.count ? row.count : 0);
          const user = row && row.user ? String(row.user) : '';
          const lastUsed = row && row.lastUsed ? new Date(row.lastUsed) : null;

          if (!map.has(command)) {
            map.set(command, {
              command,
              totalCalls: 0,
              users: new Set(),
              lastUsed: null,
            });
          }

          const target = map.get(command);
          target.totalCalls += Number.isFinite(count) ? count : 0;
          if (user) target.users.add(user);
          if (lastUsed && !Number.isNaN(lastUsed.getTime())) {
            if (!target.lastUsed || lastUsed > target.lastUsed) {
              target.lastUsed = lastUsed;
            }
          }
        });

        return Array.from(map.values()).sort((a, b) => b.totalCalls - a.totalCalls);
      }

      function renderUsage() {
        if (!ui.usageTableBody) return;

        const query = (ui.usageSearch && ui.usageSearch.value ? ui.usageSearch.value : '').trim().toLowerCase();
        const data = aggregateUsage(state.commandUsageRaw).filter((item) => {
          if (!query) return true;
          return item.command.toLowerCase().includes(query);
        });

        ui.usageTableBody.innerHTML = '';

        if (data.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 4;
          td.className = 'muted';
          td.textContent = 'No usage data found.';
          tr.appendChild(td);
          ui.usageTableBody.appendChild(tr);
          setText(ui.usageMeta, 'No command usage available.');
          return;
        }

        data.forEach((entry) => {
          const tr = document.createElement('tr');

          const commandTd = document.createElement('td');
          commandTd.className = 'mono';
          commandTd.textContent = entry.command;

          const callsTd = document.createElement('td');
          callsTd.textContent = String(entry.totalCalls);

          const usersTd = document.createElement('td');
          usersTd.textContent = String(entry.users.size);

          const lastUsedTd = document.createElement('td');
          lastUsedTd.textContent = entry.lastUsed ? formatDate(entry.lastUsed.toISOString()) : '-';

          tr.appendChild(commandTd);
          tr.appendChild(callsTd);
          tr.appendChild(usersTd);
          tr.appendChild(lastUsedTd);
          ui.usageTableBody.appendChild(tr);
        });

        setText(ui.usageMeta, data.length + ' commands loaded. Updated at ' + formatDate(new Date().toISOString()));
      }

      async function loadCommandUsage() {
        const rows = await api('/api/command-usage');
        state.commandUsageRaw = Array.isArray(rows) ? rows : [];
        renderUsage();
      }

      async function loadLeaderboard() {
        if (!ui.leaderboardBody) return;

        const game = ui.leaderboardGame && ui.leaderboardGame.value ? ui.leaderboardGame.value : 'hangman';
        const limitRaw = Number.parseInt(ui.leaderboardLimit && ui.leaderboardLimit.value ? ui.leaderboardLimit.value : '10', 10);
        const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 10, 50));

        const rows = await api('/api/leaderboard?game=' + encodeURIComponent(game));
        const data = (Array.isArray(rows) ? rows : []).slice(0, limit);

        ui.leaderboardBody.innerHTML = '';

        if (data.length === 0) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 4;
          td.className = 'muted';
          td.textContent = 'No leaderboard entries for this game.';
          tr.appendChild(td);
          ui.leaderboardBody.appendChild(tr);
          setText(ui.leaderboardMeta, 'No leaderboard data found.');
          return;
        }

        data.forEach((row) => {
          const tr = document.createElement('tr');

          const userTd = document.createElement('td');
          userTd.className = 'mono';
          userTd.textContent = row.user || '-';

          const scoreTd = document.createElement('td');
          scoreTd.textContent = String(row.score ?? 0);

          const wldTd = document.createElement('td');
          const wins = Number(row.wins ?? 0);
          const losses = Number(row.losses ?? 0);
          const draws = Number(row.draws ?? 0);
          wldTd.textContent = wins + ' / ' + losses + ' / ' + draws;

          const lastTd = document.createElement('td');
          lastTd.textContent = row.lastPlayed ? formatDate(row.lastPlayed) : '-';

          tr.appendChild(userTd);
          tr.appendChild(scoreTd);
          tr.appendChild(wldTd);
          tr.appendChild(lastTd);
          ui.leaderboardBody.appendChild(tr);
        });

        setText(ui.leaderboardMeta, data.length + ' rows for game "' + game + '".');
      }

      function parseAltPrefixes(raw) {
        return String(raw || '')
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
      }

      async function loadConfig() {
        const config = await api('/api/config');

        if (ui.cfgName) ui.cfgName.value = config.name || '';
        if (ui.cfgPrefix) ui.cfgPrefix.value = config.prefix || '!';
        if (ui.cfgAltPrefixes) {
          const prefixes = Array.isArray(config.alternativePrefixes) ? config.alternativePrefixes : [];
          ui.cfgAltPrefixes.value = prefixes.join(', ');
        }
        if (ui.cfgMaxSessions) ui.cfgMaxSessions.value = String(config.maxSessions ?? 5);
        if (ui.cfgSessionTimeout) ui.cfgSessionTimeout.value = String(config.sessionTimeout ?? 3600000);
        if (ui.cfgAllowFromMe) ui.cfgAllowFromMe.checked = Boolean(config.allowFromMe);
        if (ui.cfgAllowMentionPrefix) ui.cfgAllowMentionPrefix.checked = Boolean(config.allowMentionPrefix);
        if (ui.cfgDisableWarning) ui.cfgDisableWarning.checked = Boolean(config.disableWarning);
        if (ui.cfgMaintenanceMode) ui.cfgMaintenanceMode.checked = Boolean(config.maintenanceMode);
      }

      function buildConfigPayload() {
        const maxSessions = Number.parseInt(ui.cfgMaxSessions && ui.cfgMaxSessions.value ? ui.cfgMaxSessions.value : '0', 10);
        const sessionTimeout = Number.parseInt(ui.cfgSessionTimeout && ui.cfgSessionTimeout.value ? ui.cfgSessionTimeout.value : '0', 10);

        if (!Number.isFinite(maxSessions) || maxSessions < 1) {
          throw new Error('Max sessions must be a positive number.');
        }

        if (!Number.isFinite(sessionTimeout) || sessionTimeout < 1000) {
          throw new Error('Session timeout must be at least 1000 ms.');
        }

        return {
          name: ui.cfgName && ui.cfgName.value ? ui.cfgName.value.trim() : '',
          prefix: ui.cfgPrefix && ui.cfgPrefix.value ? ui.cfgPrefix.value.trim() : '!',
          alternativePrefixes: parseAltPrefixes(ui.cfgAltPrefixes && ui.cfgAltPrefixes.value ? ui.cfgAltPrefixes.value : ''),
          maxSessions,
          sessionTimeout,
          allowFromMe: Boolean(ui.cfgAllowFromMe && ui.cfgAllowFromMe.checked),
          allowMentionPrefix: Boolean(ui.cfgAllowMentionPrefix && ui.cfgAllowMentionPrefix.checked),
          disableWarning: Boolean(ui.cfgDisableWarning && ui.cfgDisableWarning.checked),
          maintenanceMode: Boolean(ui.cfgMaintenanceMode && ui.cfgMaintenanceMode.checked),
        };
      }

      async function saveConfig(event) {
        event.preventDefault();
        const payload = buildConfigPayload();
        await api('/api/config', { method: 'POST', body: payload });
        setText(ui.configFeedback, 'Configuration saved at ' + formatDate(new Date().toISOString()));
        showNotice('Configuration updated successfully.', 'success');
        await Promise.all([loadConfig(), loadStatus()]);
      }

      async function resetConfig() {
        const confirmed = window.confirm('Reset configuration to defaults?');
        if (!confirmed) return;

        await api('/api/config/reset', { method: 'POST' });
        setText(ui.configFeedback, 'Configuration reset to defaults.');
        showNotice('Configuration reset completed.', 'success');
        await Promise.all([loadConfig(), loadStatus()]);
      }

      async function submitRoleChange(event) {
        event.preventDefault();
        const action = ui.roleAction && ui.roleAction.value ? ui.roleAction.value : 'add';
        const role = ui.roleType && ui.roleType.value ? ui.roleType.value : 'admin';
        const userJid = ui.roleUserJid && ui.roleUserJid.value ? ui.roleUserJid.value.trim() : '';

        if (!userJid) {
          throw new Error('User JID is required.');
        }

        await api('/api/config/roles/' + encodeURIComponent(action), {
          method: 'POST',
          body: { userJid, role },
        });

        setText(ui.roleFeedback, 'Role update applied for ' + userJid + '.');
        showNotice('Role update succeeded.', 'success');
      }

      async function submitMessage(event) {
        event.preventDefault();
        const jid = ui.messageJid && ui.messageJid.value ? ui.messageJid.value.trim() : '';
        const text = ui.messageText && ui.messageText.value ? ui.messageText.value.trim() : '';

        if (!jid || !text) {
          throw new Error('Both JID and message are required.');
        }

        await api('/api/send-message', {
          method: 'POST',
          body: { jid, text },
        });

        setText(ui.messageFeedback, 'Message sent at ' + formatDate(new Date().toISOString()));
        showNotice('Message dispatched successfully.', 'success');
      }

      function appendLogEntry(entry, preserveScroll) {
        if (!ui.logsOutput || !entry) return;

        const shouldStickToBottom = preserveScroll
          ? ui.logsOutput.scrollTop + ui.logsOutput.clientHeight >= ui.logsOutput.scrollHeight - 20
          : true;

        const line = document.createElement('div');
        line.className = 'log-line level-' + (entry.level || 'info');
        line.textContent = '[' + formatDate(entry.timestamp) + '] [' + String(entry.level || 'info').toUpperCase() + '] ' + String(entry.message || '');
        ui.logsOutput.appendChild(line);

        while (ui.logsOutput.children.length > 1800) {
          ui.logsOutput.removeChild(ui.logsOutput.firstChild);
        }

        if (shouldStickToBottom) {
          ui.logsOutput.scrollTop = ui.logsOutput.scrollHeight;
        }
      }

      function renderLogs(entries) {
        if (!ui.logsOutput) return;
        ui.logsOutput.innerHTML = '';
        (entries || []).forEach((entry) => appendLogEntry(entry, false));
        setText(ui.logsMeta, (entries || []).length + ' log entries loaded.');
      }

      async function loadLogs() {
        const params = new URLSearchParams();
        params.set('limit', '500');

        const selectedLevel = ui.logLevel && ui.logLevel.value ? ui.logLevel.value : 'all';
        if (selectedLevel !== 'all') {
          params.set('level', selectedLevel);
        }

        const query = ui.logQuery && ui.logQuery.value ? ui.logQuery.value.trim() : '';
        if (query) {
          params.set('q', query);
        }

        const payload = await api('/api/logs?' + params.toString());
        renderLogs(Array.isArray(payload.logs) ? payload.logs : []);
      }

      function stopLogStream() {
        if (state.logEventSource) {
          state.logEventSource.close();
          state.logEventSource = null;
        }
        if (ui.toggleLogStreamBtn) {
          ui.toggleLogStreamBtn.textContent = 'Start Live Logs';
        }
      }

      function startLogStream() {
        stopLogStream();

        const params = new URLSearchParams();
        params.set('historyLimit', '120');

        const selectedLevel = ui.logLevel && ui.logLevel.value ? ui.logLevel.value : 'all';
        if (selectedLevel !== 'all') {
          params.set('level', selectedLevel);
        }

        const query = ui.logQuery && ui.logQuery.value ? ui.logQuery.value.trim() : '';
        if (query) {
          params.set('q', query);
        }

        const source = new EventSource('/api/logs/stream?' + params.toString());
        state.logEventSource = source;

        if (ui.toggleLogStreamBtn) {
          ui.toggleLogStreamBtn.textContent = 'Stop Live Logs';
        }

        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data || '{}');
            if (payload.type === 'history') {
              renderLogs(Array.isArray(payload.entries) ? payload.entries : []);
              return;
            }
            if (payload.type === 'log' && payload.entry) {
              appendLogEntry(payload.entry, true);
              const count = ui.logsOutput ? ui.logsOutput.children.length : 0;
              setText(ui.logsMeta, count + ' log entries visible.');
            }
          } catch (_) {
            // Ignore malformed messages
          }
        };

        source.onerror = () => {
          stopLogStream();
          showNotice('Live log stream disconnected.', 'error');
        };
      }

      async function clearLogBuffer() {
        const confirmed = window.confirm('Clear in-memory log buffer?');
        if (!confirmed) return;

        await api('/api/logs/clear', { method: 'POST' });
        if (ui.logsOutput) ui.logsOutput.innerHTML = '';
        setText(ui.logsMeta, 'Log buffer cleared.');
        showNotice('Log buffer cleared.', 'success');
      }

      function bindEvents() {
        if (ui.refreshAllBtn) {
          ui.refreshAllBtn.addEventListener('click', async () => {
            try {
              await refreshAll();
              showNotice('All sections refreshed.', 'success');
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshStatusBtn) {
          ui.refreshStatusBtn.addEventListener('click', async () => {
            try {
              await loadStatus();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshQrBtn) {
          ui.refreshQrBtn.addEventListener('click', async () => {
            try {
              await loadQrImage();
              await loadStatus();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.toggleQrStreamBtn) {
          ui.toggleQrStreamBtn.addEventListener('click', () => {
            if (state.qrEventSource) {
              stopQrStream();
              return;
            }
            startQrStream();
          });
        }

        if (ui.messageForm) {
          ui.messageForm.addEventListener('submit', async (event) => {
            try {
              await submitMessage(event);
            } catch (error) {
              setText(ui.messageFeedback, error.message);
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshUsageBtn) {
          ui.refreshUsageBtn.addEventListener('click', async () => {
            try {
              await loadCommandUsage();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.usageSearch) {
          ui.usageSearch.addEventListener('input', renderUsage);
        }

        if (ui.refreshLeaderboardBtn) {
          ui.refreshLeaderboardBtn.addEventListener('click', async () => {
            try {
              await loadLeaderboard();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.configForm) {
          ui.configForm.addEventListener('submit', async (event) => {
            try {
              await saveConfig(event);
            } catch (error) {
              setText(ui.configFeedback, error.message);
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.resetConfigBtn) {
          ui.resetConfigBtn.addEventListener('click', async () => {
            try {
              await resetConfig();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.roleForm) {
          ui.roleForm.addEventListener('submit', async (event) => {
            try {
              await submitRoleChange(event);
            } catch (error) {
              setText(ui.roleFeedback, error.message);
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.refreshLogsBtn) {
          ui.refreshLogsBtn.addEventListener('click', async () => {
            try {
              await loadLogs();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        if (ui.logLevel) {
          ui.logLevel.addEventListener('change', async () => {
            if (state.logEventSource) {
              startLogStream();
              return;
            }
            await loadLogs();
          });
        }

        if (ui.logQuery) {
          ui.logQuery.addEventListener('keydown', async (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (state.logEventSource) {
              startLogStream();
              return;
            }
            await loadLogs();
          });
        }

        if (ui.toggleLogStreamBtn) {
          ui.toggleLogStreamBtn.addEventListener('click', () => {
            if (state.logEventSource) {
              stopLogStream();
              return;
            }
            startLogStream();
          });
        }

        if (ui.clearLogViewBtn) {
          ui.clearLogViewBtn.addEventListener('click', () => {
            if (ui.logsOutput) ui.logsOutput.innerHTML = '';
            setText(ui.logsMeta, 'Log view cleared.');
          });
        }

        if (ui.clearLogBufferBtn) {
          ui.clearLogBufferBtn.addEventListener('click', async () => {
            try {
              await clearLogBuffer();
            } catch (error) {
              showNotice(error.message, 'error');
            }
          });
        }

        window.addEventListener('beforeunload', () => {
          stopQrStream();
          stopLogStream();
          clearQrObjectUrl();
          if (state.autoRefreshTimer) {
            window.clearInterval(state.autoRefreshTimer);
            state.autoRefreshTimer = null;
          }
        });
      }

      async function refreshAll() {
        await Promise.all([
          loadStatus(),
          loadQrImage(),
          loadCommandUsage(),
          loadLeaderboard(),
          loadConfig(),
          loadLogs(),
        ]);
      }

      async function bootstrap() {
        bindEvents();

        try {
          await refreshAll();
          startQrStream();
        } catch (error) {
          showNotice(error.message, 'error');
        }

        state.autoRefreshTimer = window.setInterval(() => {
          loadStatus().catch(() => {
            // Ignore polling failures and keep loop alive
          });
        }, 20000);
      }

      bootstrap();
    })();
  </script>
</body>
</html>`;
}
