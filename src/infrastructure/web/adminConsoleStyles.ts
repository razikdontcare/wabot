export const ADMIN_CONSOLE_STYLES = `:root {
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

    .panel:nth-of-type(5) {
      animation-delay: 220ms;
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
    }`;
