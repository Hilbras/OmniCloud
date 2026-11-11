import {
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  FolderPlus,
  HardDrive,
  Settings,
  X,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import type { StorageHealthDTO } from "@omnicloud/shared";
import type { StorageDTO } from "@omnicloud/shared";
import type { UpdateCheckDTO } from "@omnicloud/shared";
import { healthVisual } from "../lib/health";
import { SECTIONS } from "../lib/sections";
import { UpdateNotice } from "./UpdateNotice";

interface SidebarProps {
  storage: StorageDTO | null;
  health: StorageHealthDTO | null;
  username: string | null;
  /** Latest update-check result, used for the "update available" notice. */
  update?: UpdateCheckDTO | undefined;
  onCreateFolder: () => void;
  /** Rendered inside a mobile drawer; shows a close button. */
  onClose?: () => void;
  /** Desktop icon-only mode. */
  collapsed?: boolean;
  /** Renders the collapse/expand control; omitted in the mobile drawer. */
  onToggleCollapsed?: () => void;
}

function StateDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full bg-current ${tone}`} aria-hidden="true" />
      <span className={`text-[11px] font-medium ${tone}`}>{label}</span>
    </span>
  );
}

/** Left navigation: sections, a "New folder" action and the storage card. */
export function Sidebar({
  storage,
  health,
  username,
  update,
  onCreateFolder,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const state = healthVisual(health);

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className={collapsed ? "px-3 pt-5 pb-4" : "px-5 pt-5 pb-4"}>
        <div
          className={
            collapsed
              ? "flex flex-col items-center gap-3"
              : "flex items-center justify-between gap-3"
          }
        >
          {collapsed ? (
            <div className="group relative h-8 w-8">
              <span className="relative block h-8 w-8">
                <img
                  src="/brand/logo-mark.svg"
                  alt="OmniCloud"
                  className="brand-mark-dark absolute inset-0 h-8 w-8 transition-opacity group-hover:opacity-0"
                />
                <img
                  src="/brand/logo-mark-light.svg"
                  alt=""
                  aria-hidden="true"
                  className="brand-mark-light absolute inset-0 h-8 w-8 transition-opacity group-hover:opacity-0"
                />
              </span>
              {onToggleCollapsed !== undefined ? (
                <button
                  type="button"
                  aria-label="Expand navigation"
                  aria-pressed={true}
                  onClick={onToggleCollapsed}
                  className="absolute inset-0 grid place-items-center rounded-lg bg-surface text-gold-text opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <ChevronsRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <a
                href="/drive"
                className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
              >
                <span className="relative h-8 w-8 shrink-0">
                  <img
                    src="/brand/logo-mark.svg"
                    alt=""
                    className="brand-mark-dark absolute inset-0 h-8 w-8"
                  />
                  <img
                    src="/brand/logo-mark-light.svg"
                    alt=""
                    className="brand-mark-light absolute inset-0 h-8 w-8"
                  />
                </span>
                <span>
                  Omni<span className="muted font-normal">Cloud</span>
                </span>
              </a>
              {onToggleCollapsed !== undefined ? (
                <button
                  type="button"
                  aria-label="Collapse navigation"
                  aria-pressed={false}
                  onClick={onToggleCollapsed}
                  className="muted hidden h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-surface hover:text-gold-text md:grid"
                >
                  <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </>
          )}
          {onClose !== undefined ? (
            <button
              type="button"
              aria-label="Close navigation"
              onClick={onClose}
              className="muted grid h-8 w-8 place-items-center rounded-lg  hover:bg-surface hover:text-gold-text md:hidden"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {collapsed ? null : <UpdateNotice result={update} />}
      </div>

      <nav aria-label="Main" className="px-3">
        <ul className="grid gap-0.5">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.id}>
                <NavLink
                  to={section.path}
                  end={section.path === "/drive"}
                  onClick={() => onClose?.()}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-xl py-2.5 text-[13px]  ${
                      collapsed ? "justify-center px-0" : "px-3"
                    } ${
                      isActive
                        ? "bg-gold-soft font-semibold text-gold-text"
                        : "muted hover:bg-surface hover:text-text"
                    }`
                  }
                  title={collapsed ? section.label : undefined}
                  aria-label={collapsed ? section.label : undefined}
                >
                  <Icon
                    className="h-4 w-4 shrink-0  group-hover:text-gold-text"
                    aria-hidden="true"
                  />
                  {collapsed ? null : section.label}
                </NavLink>
              </li>
            );
          })}
          <li>
            <NavLink
              to="/settings/tokens"
              onClick={() => onClose?.()}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl py-2.5 text-[13px]  ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${
                  isActive
                    ? "bg-gold-soft font-semibold text-gold-text"
                    : "muted hover:bg-surface hover:text-text"
                }`
              }
              title={collapsed ? "Settings" : undefined}
              aria-label={collapsed ? "Settings" : undefined}
            >
              <Settings
                className="h-4 w-4 shrink-0  group-hover:text-gold-text"
                aria-hidden="true"
              />
              {collapsed ? null : "Settings"}
            </NavLink>
          </li>
        </ul>
      </nav>

      <div className={collapsed ? "px-3 pt-4" : "px-4 pt-4"}>
        <button
          type="button"
          className="btn-secondary w-full justify-center"
          onClick={onCreateFolder}
          title={collapsed ? "New folder" : undefined}
          aria-label={collapsed ? "New folder" : undefined}
        >
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
          {collapsed ? null : "New folder"}
        </button>
      </div>

      <div className={collapsed ? "mt-auto p-2" : "mt-auto p-4"}>
        <div
          className={collapsed ? "drive-surface grid place-items-center p-2" : "drive-surface p-4"}
        >
          <div className="flex items-center gap-2.5">
            <Cloud className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
            {collapsed ? null : (
              <span
                className="min-w-0 truncate text-sm font-medium"
                title={storage?.title ?? undefined}
              >
                {storage?.title ?? "No storage"}
              </span>
            )}
          </div>
          <div className="mt-2">
            {health !== null ? (
              collapsed ? (
                <span
                  className={`mx-auto block h-2 w-2 rounded-full bg-current ${state.tone}`}
                  title={state.label}
                  aria-label={`Storage status: ${state.label}`}
                />
              ) : (
                <StateDot tone={state.tone} label={state.label} />
              )
            ) : (
              <span className="muted text-[11px]">{collapsed ? "?" : "Status unknown"}</span>
            )}
          </div>
          {collapsed ? null : (
            <>
              {state.hint !== null ? (
                <p className={`mt-1.5 text-[11px] leading-snug ${state.tone}`}>{state.hint}</p>
              ) : null}
              <p className="muted mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide">
                <HardDrive className="h-3 w-3" aria-hidden="true" />
                {storage?.provider ?? "—"}
              </p>
              <div className="hairline mt-3" />
              {username !== null && username !== "" ? (
                <p className="muted mt-2.5 truncate font-mono text-[11px] select-all">
                  @{username}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
