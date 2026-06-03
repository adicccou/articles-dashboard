import { useEffect, useRef, useState } from "react";
import { Bars3Icon, ChevronDownIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { api } from "../lib/api";
import type { ArticleRecord, AuthState } from "../lib/types";
import { LoginCard } from "../components/LoginCard";
import { Shell } from "../components/Shell";
import { TopNav, getNavLabel, type NavView } from "../components/TopNav";
import { DashboardPage } from "../pages/DashboardPage";
import { useDashboardState } from "./useDashboardState";
import {
  getDashboardSurface,
  getDefaultView,
  isViewAllowedForSurface,
  normalizeStoredView,
  shouldPersistSurfaceInUrl,
  type DashboardSurface,
} from "../lib/surface";
import "../styles/app.css";

const DASHBOARD_VIEW_STORAGE_KEY_PREFIX = "dashboard:last-view";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "dashboard:sidebar-collapsed";
const FALLBACK_SIGN_PATH = "/fallbacksign";
const MOBILE_NAV_MEDIA_QUERY = "(max-width: 900px)";

function readAuthNotice(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth_error") === "google_not_configured") {
    return "Google sign-in needs OAuth credentials before it can be used. Use the password fallback for now.";
  }
  return null;
}

function readReturnTo(): string {
  if (typeof window === "undefined") return "";
  const raw = new URLSearchParams(window.location.search).get("return_to") ?? "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function readStoredView(surface: DashboardSurface): NavView {
  if (typeof window === "undefined") return getDefaultView(surface);

  const params = new URLSearchParams(window.location.search);
  const queryView = normalizeStoredView(params.get("view"));
  if (queryView && isViewAllowedForSurface(queryView, surface)) {
    return queryView;
  }

  const storageKey = `${DASHBOARD_VIEW_STORAGE_KEY_PREFIX}:${surface}`;
  const stored = normalizeStoredView(window.localStorage.getItem(storageKey));
  return stored && isViewAllowedForSurface(stored, surface) ? stored : getDefaultView(surface);
}

function syncViewUrl(surface: DashboardSurface, view: NavView) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (shouldPersistSurfaceInUrl()) {
    url.searchParams.set("surface", surface);
  } else {
    url.searchParams.delete("surface");
  }
  url.searchParams.set("view", view);

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

function userDisplayName(auth: AuthState): string {
  return auth.user?.display_name?.trim() || auth.user?.username?.trim() || auth.username?.trim() || "Account";
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
  return initials.toUpperCase();
}

export function App() {
  const [surface] = useState<DashboardSurface>(() => getDashboardSurface());
  const loginMode: "google" | "fallback" =
    surface === "articles" || (typeof window !== "undefined" && window.location.pathname === FALLBACK_SIGN_PATH)
      ? "fallback"
      : "google";
  const [returnTo] = useState<string>(() => readReturnTo());
  const [authNotice] = useState<string | null>(() => readAuthNotice());
  const [view, setView] = useState<NavView>(() => readStoredView(surface));
  const [selectedArticle, setSelectedArticle] = useState<ArticleRecord | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobileNav, setIsMobileNav] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_NAV_MEDIA_QUERY).matches;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  });
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const {
    auth,
    sites,
    articles,
    categories,
    loading,
    error,
    appSettings,
    settingsMessage,
    load,
    saveSettings,
    syncAgentSettings,
    handlePasswordLogin,
    handleLogout,
  } = useDashboardState({ loginMode, returnTo, surface });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isViewAllowedForSurface(view, surface)) {
      const defaultView = getDefaultView(surface);
      setView(defaultView);
      syncViewUrl(surface, defaultView);
      return;
    }
    window.localStorage.setItem(`${DASHBOARD_VIEW_STORAGE_KEY_PREFIX}:${surface}`, view);
    syncViewUrl(surface, view);
  }, [surface, view]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [view]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(MOBILE_NAV_MEDIA_QUERY);
    const update = () => {
      const nextIsMobile = media.matches;
      setIsMobileNav(nextIsMobile);
      if (!nextIsMobile) {
        setSidebarOpen(false);
      }
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!sidebarOpen || typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isMobileNav && sidebarOpen) {
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
  }, [isMobileNav, sidebarOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!accountMenuOpen || typeof window === "undefined") return;

    const onPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen]);

  async function handleSignOut() {
    const confirmed = window.confirm("Sign out now?");
    if (!confirmed) return;
    await handleLogout();
    setAccountMenuOpen(false);
  }

  if (loading) {
    if (surface === "marketing") {
      return (
        <div className="app-bootstrap-shell" aria-busy="true" aria-label="Loading dashboard">
          <span>Loading dashboard...</span>
        </div>
      );
    }
    return <div className="loading-screen">Loading dashboard...</div>;
  }

  if (!auth.authenticated) {
    return (
      <div className="login-screen">
        <LoginCard
          surface={surface}
          mode={loginMode}
          googleAuthConfigured={auth.google_auth_configured !== false}
          notice={authNotice}
          returnTo={returnTo}
          onSubmit={handlePasswordLogin}
        />
      </div>
    );
  }

  const accountName = userDisplayName(auth);
  const avatarUrl = auth.user?.avatar_url?.trim() || "";

  return (
    <div className="app-layout">
      <Shell
        sidebarOpen={sidebarOpen}
        sidebarCollapsed={!isMobileNav && sidebarCollapsed}
        onBackdropClick={() => setSidebarOpen(false)}
        header={
          <div className="shell-header-shell">
            <button
              type="button"
              className="shell-header-shell__menu dashboard-icon-button"
              onClick={() => setSidebarOpen((current) => !current)}
              aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={sidebarOpen}
              title={sidebarOpen ? "Close navigation" : "Open navigation"}
            >
              {sidebarOpen ? <XMarkIcon aria-hidden="true" /> : <Bars3Icon aria-hidden="true" />}
            </button>
            <div className="shell-header-shell__copy">
              <h1>{getNavLabel(view)}</h1>
            </div>
            <div className="shell-header-shell__actions">
              <div className="account-menu" ref={accountMenuRef}>
                <button
                  type="button"
                  className="account-menu__trigger"
                  onClick={() => setAccountMenuOpen((current) => !current)}
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                >
                  <span className="account-menu__avatar" aria-hidden="true">
                    {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{userInitials(accountName)}</span>}
                  </span>
                  <span className="account-menu__name">{accountName}</span>
                  <ChevronDownIcon className="account-menu__chevron" aria-hidden="true" />
                </button>
                {accountMenuOpen ? (
                  <div className="account-menu__dropdown" role="menu">
                    <button
                      type="button"
                      className="account-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setView("config");
                        setAccountMenuOpen(false);
                      }}
                    >
                      Account
                    </button>
                    <a className="account-menu__item" href="/legal/terms" target="_blank" rel="noreferrer" role="menuitem">
                      Terms of use
                    </a>
                    <button type="button" className="account-menu__item account-menu__item--danger" role="menuitem" onClick={handleSignOut}>
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        }
        sidebar={
          <TopNav
            currentView={view}
            surface={surface}
            collapsed={!isMobileNav && sidebarCollapsed}
            onNavigate={(nextView) => {
              setView(nextView);
              setSidebarOpen(false);
            }}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          />
        }
      >
        {error ? <p className="error panel">{error}</p> : null}
        <DashboardPage
          view={view}
          onNavigate={setView}
          articles={articles}
          sites={sites}
          categories={categories}
          selectedArticle={selectedArticle}
          onSelectArticle={(article) => {
            setSelectedArticle(article);
          }}
          onSaveArticle={async (payload, id) => {
            await api.saveArticle(payload, id);
            await load();
            setSelectedArticle(undefined);
          }}
          onDeleteArticle={async (id) => {
            await api.deleteArticle(id);
            await load();
          }}
          onUpload={api.uploadMedia}
          surface={surface}
          settings={appSettings}
          settingsMessage={settingsMessage}
          onSaveSettings={saveSettings}
          onSyncAgentSettings={syncAgentSettings}
        />
      </Shell>
    </div>
  );
}
