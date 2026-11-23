export const ADMIN_CONSOLE_COMMANDS_STYLES = `
    .commands-toolbar {
      display: grid;
      gap: 0.65rem;
      grid-template-columns: minmax(0, 2fr) minmax(140px, 1fr) minmax(140px, 1fr) auto;
      align-items: end;
    }

    .commands-toolbar .field {
      grid-column: auto;
    }

    .commands-toolbar-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .commands-badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0.08rem 0.5rem;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      background: var(--panel);
      white-space: nowrap;
    }

    .commands-badge.commands-source-builtin {
      border-color: color-mix(in srgb, var(--accent) 30%, var(--line));
      color: var(--accent);
      background: color-mix(in srgb, var(--accent-soft) 60%, white 40%);
    }

    .commands-badge.commands-source-custom {
      border-color: color-mix(in srgb, var(--warn) 32%, var(--line));
      color: var(--warn);
      background: color-mix(in srgb, var(--warn) 11%, white 89%);
    }

    .commands-badge.commands-status-enabled {
      border-color: color-mix(in srgb, var(--success) 34%, var(--line));
      color: var(--success);
      background: color-mix(in srgb, var(--success) 11%, white 89%);
    }

    .commands-badge.commands-status-disabled {
      border-color: color-mix(in srgb, var(--danger) 32%, var(--line));
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, white 90%);
    }

    .commands-actions {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
    }

    .commands-actions button {
      min-height: 30px;
      padding: 0.3rem 0.55rem;
      border-radius: 8px;
      font-size: 0.78rem;
    }

    .commands-actions button.commands-danger {
      border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 8%, white 92%);
    }

    .commands-form-panel {
      border: 1px dashed color-mix(in srgb, var(--line) 85%, white 15%);
      border-radius: 14px;
      background: color-mix(in srgb, var(--panel) 92%, white 8%);
      padding: 0.95rem;
      display: grid;
      gap: 0.75rem;
    }

    .commands-form-panel[hidden] {
      display: none;
    }

    .commands-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
    }

    .commands-form-grid .field {
      grid-column: auto;
    }

    .commands-form-grid .commands-field-wide {
      grid-column: 1 / -1;
    }

    .commands-cheatsheet {
      font-size: 0.76rem;
    }

    .commands-cheatsheet .mono {
      color: var(--text);
      background: color-mix(in srgb, var(--accent-soft) 55%, white 45%);
      border-radius: 6px;
      padding: 0 0.28rem;
    }

    .commands-empty {
      color: var(--text-muted);
      font-size: 0.84rem;
      text-align: center;
      padding: 0.9rem 0.6rem;
    }

    @media (max-width: 1100px) {
      .commands-toolbar {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .commands-toolbar .commands-toolbar-search {
        grid-column: 1 / -1;
      }

      .commands-toolbar-actions {
        grid-column: 1 / -1;
        justify-content: flex-start;
      }
    }

    @media (max-width: 780px) {
      .commands-toolbar {
        grid-template-columns: 1fr;
      }

      .commands-form-grid {
        grid-template-columns: 1fr;
      }

      .commands-form-grid .commands-field-wide {
        grid-column: auto;
      }
    }
`;
