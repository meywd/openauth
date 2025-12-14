"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { AccountSwitcher } from "./account-switcher"
import {
  type Theme,
  type ColorScheme,
  DEFAULT_THEME,
} from "./account-switcher.types"

/**
 * Helper to get color value from theme (handles string or ColorScheme)
 */
function getColor(
  color: string | ColorScheme | undefined,
  mode: "light" | "dark",
  fallback: string,
): string {
  if (!color) return fallback
  if (typeof color === "string") return color
  return color[mode] || fallback
}

/**
 * Helper to get border radius value from theme
 */
function getRadius(radius?: Theme["radius"]): string {
  switch (radius) {
    case "none":
      return "0"
    case "sm":
      return "4px"
    case "md":
      return "8px"
    case "lg":
      return "12px"
    case "full":
      return "9999px"
    default:
      return "8px"
  }
}

/**
 * AccountSwitcherDropdown Component
 *
 * A dropdown version of the AccountSwitcher that can be embedded
 * in navigation bars, headers, or anywhere you need a compact
 * account switching UI.
 *
 * This component wraps the full AccountSwitcher in a dropdown menu
 * that can be toggled open/closed.
 *
 * @example
 * ```tsx
 * import { AccountSwitcherDropdown } from "./components/account-switcher-dropdown"
 *
 * export function Header() {
 *   return (
 *     <header>
 *       <nav>
 *         <Logo />
 *         <Navigation />
 *         <AccountSwitcherDropdown />
 *       </nav>
 *     </header>
 *   )
 * }
 * ```
 */
export function AccountSwitcherDropdown({
  apiBaseUrl = "/api",
  authorizeUrl = "/authorize",
  theme: themeProp,
  onAccountSwitch,
  onSignOut,
}: {
  apiBaseUrl?: string
  authorizeUrl?: string
  theme?: Theme
  onAccountSwitch?: (userId: string) => void
  onSignOut?: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Merge provided theme with defaults
  const theme = useMemo(() => ({ ...DEFAULT_THEME, ...themeProp }), [themeProp])

  // Generate CSS variables from theme
  const themeStyles = useMemo(() => {
    const primaryLight = getColor(theme.primary, "light", "#3b82f6")
    const primaryDark = getColor(theme.primary, "dark", "#60a5fa")
    const bgLight = getColor(theme.background, "light", "#ffffff")
    const bgDark = getColor(theme.background, "dark", "#111827")
    const radius = getRadius(theme.radius)
    const fontFamily =
      theme.font?.family ||
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

    return {
      "--asd-primary-light": primaryLight,
      "--asd-primary-dark": primaryDark,
      "--asd-bg-light": bgLight,
      "--asd-bg-dark": bgDark,
      "--asd-radius": radius,
      "--asd-font-family": fontFamily,
    } as React.CSSProperties
  }, [theme])

  /**
   * Close dropdown when clicking outside
   */
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  /**
   * Close dropdown on Escape key
   */
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape)
    }

    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen])

  return (
    <div
      className="account-switcher-dropdown"
      ref={dropdownRef}
      style={themeStyles}
    >
      <style jsx>{`
        .account-switcher-dropdown {
          position: relative;
          font-family: var(--asd-font-family, inherit);
        }

        .trigger-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--asd-bg-light, white);
          border: 1px solid
            color-mix(in srgb, var(--asd-primary-light) 20%, transparent);
          border-radius: var(--asd-radius, 6px);
          cursor: pointer;
          transition: all 0.15s;
          font-size: 14px;
          font-weight: 500;
          color: #111827;
          font-family: var(--asd-font-family, inherit);
        }

        @media (prefers-color-scheme: dark) {
          .trigger-button {
            background: var(--asd-bg-dark, #111827);
            border-color: color-mix(
              in srgb,
              var(--asd-primary-dark) 30%,
              transparent
            );
            color: #f9fafb;
          }
        }

        .trigger-button:hover {
          background: color-mix(
            in srgb,
            var(--asd-primary-light) 5%,
            var(--asd-bg-light)
          );
          border-color: color-mix(
            in srgb,
            var(--asd-primary-light) 40%,
            transparent
          );
        }

        @media (prefers-color-scheme: dark) {
          .trigger-button:hover {
            background: color-mix(
              in srgb,
              var(--asd-primary-dark) 10%,
              var(--asd-bg-dark)
            );
            border-color: color-mix(
              in srgb,
              var(--asd-primary-dark) 50%,
              transparent
            );
          }
        }

        .trigger-button.open {
          background: color-mix(
            in srgb,
            var(--asd-primary-light) 5%,
            var(--asd-bg-light)
          );
          border-color: var(--asd-primary-light);
          box-shadow: 0 0 0 3px
            color-mix(in srgb, var(--asd-primary-light) 15%, transparent);
        }

        @media (prefers-color-scheme: dark) {
          .trigger-button.open {
            background: color-mix(
              in srgb,
              var(--asd-primary-dark) 10%,
              var(--asd-bg-dark)
            );
            border-color: var(--asd-primary-dark);
            box-shadow: 0 0 0 3px
              color-mix(in srgb, var(--asd-primary-dark) 20%, transparent);
          }
        }

        .avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--asd-primary-light);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          font-size: 14px;
        }

        @media (prefers-color-scheme: dark) {
          .avatar {
            background: var(--asd-primary-dark);
            color: #111827;
          }
        }

        .chevron {
          width: 16px;
          height: 16px;
          transition: transform 0.2s;
        }

        .chevron.open {
          transform: rotate(180deg);
        }

        .dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 400px;
          background: var(--asd-bg-light, white);
          border: 1px solid
            color-mix(in srgb, var(--asd-primary-light) 20%, transparent);
          border-radius: var(--asd-radius, 8px);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          z-index: 50;
          opacity: 0;
          transform: translateY(-8px);
          pointer-events: none;
          transition: all 0.2s;
        }

        @media (prefers-color-scheme: dark) {
          .dropdown-menu {
            background: var(--asd-bg-dark, #111827);
            border-color: color-mix(
              in srgb,
              var(--asd-primary-dark) 30%,
              transparent
            );
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
          }
        }

        .dropdown-menu.open {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }

        @media (max-width: 640px) {
          .dropdown-menu {
            position: fixed;
            top: auto;
            bottom: 0;
            left: 0;
            right: 0;
            min-width: 100%;
            border-radius: calc(var(--asd-radius, 8px) * 2)
              calc(var(--asd-radius, 8px) * 2) 0 0;
            transform: translateY(100%);
          }

          .dropdown-menu.open {
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Trigger Button */}
      <button
        className={`trigger-button ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Account switcher"
        aria-expanded={isOpen}
      >
        <div className="avatar">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>

        <span>Accounts</span>

        <svg
          className={`chevron ${isOpen ? "open" : ""}`}
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      <div className={`dropdown-menu ${isOpen ? "open" : ""}`}>
        <AccountSwitcher
          apiBaseUrl={apiBaseUrl}
          authorizeUrl={authorizeUrl}
          theme={themeProp}
          onAccountSwitch={(userId) => {
            setIsOpen(false)
            onAccountSwitch?.(userId)
          }}
          onSignOut={() => {
            setIsOpen(false)
            onSignOut?.()
          }}
        />
      </div>
    </div>
  )
}
